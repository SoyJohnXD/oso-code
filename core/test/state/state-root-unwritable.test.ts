import assert from "node:assert/strict";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { isPlanRailFailure } from "../../src/gates/planrail.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { runAmendPlan, runApprovePlan, runCancelPlan, runCapturePlan, runRejectPlanPresentation } from "../../src/state/plan.ts";
import { StateRootUnwritableError, writeStateValues } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  repositoryRoot,
  STATE_ROOT_THESE_TESTS_SPELL,
  withStateSandbox,
  type StateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";
import { skipUnlessChmodDeniesDirectoryWrites } from "../support/win32-skip-guards.ts";

const READ_EXECUTE_ONLY_DIRECTORY = 0o555;
const OWNER_ONLY_DIRECTORY = 0o700;
const ARMING_A_SLICE = ["mode=plan", "active_slice=s7", "verify_green=false"];
const SESSION = "sweep-probe";
const PLAN_DIGEST = "f".repeat(64);
const NOT_A_RAW_ERRNO = /^(oso-state: )?(EACCES|EPERM|EROFS):/m;
const NAMES_A_REMEDY = /workspace roots|--add-dir|read-only/;

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts")],
};

function withUnwritableStateRoot<T>(read: (sandbox: StateSandbox, stateRoot: string) => T): T {
  return withStateSandbox("workspace", (sandbox) => {
    const stateRoot = path.join(sandbox.home, ...STATE_ROOT_THESE_TESTS_SPELL.split("/"));
    mkdirSync(stateRoot, { recursive: true });
    chmodSync(stateRoot, READ_EXECUTE_ONLY_DIRECTORY);
    try {
      return withHookEnvironment(sandbox.hookEnvironment(), () => read(sandbox, stateRoot));
    } finally {
      chmodSync(stateRoot, OWNER_ONLY_DIRECTORY);
    }
  });
}

describe(
  "a state directory the active permission mode cannot write is a diagnosis at arm time, never a gate that stops biting",
  { skip: skipUnlessChmodDeniesDirectoryWrites() },
  () => {
    test("arming a slice names the directory, the cause, and the remedy rather than dying on a bare errno", () => {
      const failure = withUnwritableStateRoot((sandbox, stateRoot) => {
        try {
          writeStateValues(sandbox.cwd, "arm-probe", ARMING_A_SLICE);
        } catch (error) {
          return { error, stateRoot };
        }
        return { error: undefined, stateRoot };
      });
      assert.ok(failure.error instanceof StateRootUnwritableError, String(failure.error));
      assert.equal(failure.error.directory, failure.stateRoot);
      assert.ok(failure.error.message.includes(failure.stateRoot), failure.error.message);
      assert.match(failure.error.message, /EACCES|EPERM|EROFS/);
      assert.match(failure.error.message, /workspace roots.*--add-dir.*can write/);
    });

    test("the commit gate that would otherwise hide it reads the unwritten state as absent and allows the commit", () => {
      const run = withUnwritableStateRoot((sandbox) => {
        const stdin = sandbox.expandJson(
          '{"session_id":"arm-probe","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
            '"tool_input":{"command":"git commit -m \\"work\\""}}',
        );
        return runGate(["commit"], spawnedEnvelope(stdin, process.env));
      });
      assert.equal(run.exit, 0);
      assert.equal(run.stderr, "");
    });

    test("a writable state directory arms without a word, so the diagnosis fires on the failure alone", () => {
      withStateSandbox("workspace", (sandbox) => {
        withHookEnvironment(sandbox.hookEnvironment(), () => {
          assert.doesNotThrow(() => writeStateValues(sandbox.cwd, "arm-probe", ARMING_A_SLICE));
        });
      });
    });
  },
);

type SweptRun = Readonly<{ exit: number; stderr: string }>;
type SweptVerb = Readonly<{ label: string; drive: (sandbox: StateSandbox) => SweptRun }>;

function spawnedVerb(sandbox: StateSandbox, argv: readonly string[]): SweptRun {
  const result = sandbox.run(CLI_SUBJECT, ["--session", SESSION, ...argv]);
  return { exit: result.exit, stderr: result.stderr };
}

function thrownVerb(run: () => void): SweptRun {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof StateRootUnwritableError, String(error));
    return { exit: 1, stderr: error.message };
  }
  throw new Error("expected StateRootUnwritableError, but the call under test wrote to an unwritable state root");
}

const SWEPT_VERBS: readonly SweptVerb[] = [
  { label: "clear", drive: (sandbox) => spawnedVerb(sandbox, ["clear"]) },
  { label: "close-slice", drive: (sandbox) => spawnedVerb(sandbox, ["close-slice", "s1"]) },
  { label: "deny-pattern add", drive: (sandbox) => spawnedVerb(sandbox, ["deny-pattern", "add", "npm test"]) },
  { label: "reject-plan-presentation", drive: (sandbox) => thrownVerb(() => runRejectPlanPresentation(sandbox.cwd, SESSION, PLAN_DIGEST)) },
  { label: "approve-plan", drive: (sandbox) => thrownVerb(() => runApprovePlan(sandbox.cwd, SESSION, PLAN_DIGEST)) },
  { label: "cancel-plan", drive: (sandbox) => thrownVerb(() => runCancelPlan(sandbox.cwd, SESSION, PLAN_DIGEST)) },
  { label: "amend-plan", drive: (sandbox) => thrownVerb(() => runAmendPlan(sandbox.cwd, SESSION, "s1", "text")) },
  { label: "capture-plan", drive: (sandbox) => thrownVerb(() => runCapturePlan(sandbox.cwd, SESSION, PLAN_DIGEST, "text")) },
];

describe(
  "the seven state-writing verbs, plus capture-plan's own directory path, all name the remedy rather than a raw errno",
  { skip: skipUnlessChmodDeniesDirectoryWrites() },
  () => {
    for (const { label, drive } of SWEPT_VERBS) {
      test(label, () => {
        const run = withUnwritableStateRoot((sandbox) => drive(sandbox));
        assert.notEqual(run.exit, 0);
        assert.doesNotMatch(run.stderr, NOT_A_RAW_ERRNO, run.stderr);
        assert.match(run.stderr, NAMES_A_REMEDY, run.stderr);
      });
    }
  },
);

test("the plan rail's own classification recognizes an unwritable state root, so the marker-based Stop path degrades it too", () => {
  const cause = new StateRootUnwritableError("/state", Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
  assert.equal(isPlanRailFailure(cause), true);
});

type UnwritableRemedyCase = Readonly<{
  codes: readonly string[];
  mustMatch: readonly RegExp[];
  mustNotMatch: readonly RegExp[];
}>;

const NAMES_NO_CAUSE = /not one this rail can name/;
const NAMES_A_LOOP = /symlink loop/;
const NAMES_AN_OCCUPANT = /occupies/;

const UNWRITABLE_REMEDY_CASES: readonly UnwritableRemedyCase[] = [
  { codes: ["EROFS"], mustMatch: [/read-only/], mustNotMatch: [/workspace roots|--add-dir/, NAMES_AN_OCCUPANT, NAMES_A_LOOP, NAMES_NO_CAUSE] },
  { codes: ["EACCES", "EPERM"], mustMatch: [/workspace roots.*--add-dir.*can write/], mustNotMatch: [NAMES_AN_OCCUPANT, NAMES_A_LOOP, NAMES_NO_CAUSE] },
  { codes: ["EEXIST", "ENOTDIR"], mustMatch: [NAMES_AN_OCCUPANT], mustNotMatch: [NAMES_A_LOOP, NAMES_NO_CAUSE] },
  { codes: ["ELOOP"], mustMatch: [NAMES_A_LOOP], mustNotMatch: [/read-only/, /workspace roots|--add-dir/, NAMES_AN_OCCUPANT, NAMES_NO_CAUSE] },
  { codes: ["ENAMETOOLONG"], mustMatch: [/too long a path/], mustNotMatch: [/read-only/, /workspace roots|--add-dir/, NAMES_AN_OCCUPANT, NAMES_A_LOOP, NAMES_NO_CAUSE] },
  { codes: ["ENOSPC", "EDQUOT"], mustMatch: [/no room left/], mustNotMatch: [/read-only/, /workspace roots|--add-dir/, NAMES_AN_OCCUPANT, NAMES_A_LOOP, NAMES_NO_CAUSE] },
  { codes: ["ENOENT"], mustMatch: [NAMES_NO_CAUSE], mustNotMatch: [NAMES_AN_OCCUPANT, NAMES_A_LOOP] },
];

describe("every errno the state root can fail with earns its own remedy, or an honest admission it names none", () => {
  for (const { codes, mustMatch, mustNotMatch } of UNWRITABLE_REMEDY_CASES) {
    test(codes.join("/"), () => {
      for (const code of codes) {
        const cause = Object.assign(new Error(`${code}: probe`), { code });
        const message = new StateRootUnwritableError("/state", cause).message;
        for (const pattern of mustMatch) assert.match(message, pattern);
        for (const pattern of mustNotMatch) assert.doesNotMatch(message, pattern);
      }
    });
  }
});
