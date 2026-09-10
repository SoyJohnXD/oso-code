import assert from "node:assert/strict";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { StateRootUnwritableError, writeStateValues } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_ROOT_THESE_TESTS_SPELL, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";
import { skipUnlessChmodDeniesDirectoryWrites } from "../support/win32-skip-guards.ts";

const READ_EXECUTE_ONLY_DIRECTORY = 0o555;
const OWNER_ONLY_DIRECTORY = 0o700;
const ARMING_A_SLICE = ["mode=plan", "active_slice=s7", "verify_green=false"];

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
