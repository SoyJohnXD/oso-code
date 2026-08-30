import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { THE_GATE_ENTRY_POINT } from "../../src/gates/dispatch.ts";
import { GATE_ERROR_EXIT, gateErrorText } from "../../src/hosts/hook-run.ts";
import { spawnAsHookHost, type SpawnedRun } from "../support/hook-invocation.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot, STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

const SESSION = "test-session";
const NESTING_PAST_THE_RECURSION = 20000;
const ARMED_RED_STATE = `mode=plan\nactive_slice=none\nverify_green=false\nsession=${SESSION}\n`;
const TOOL_NAMES = ["Bash", "mcp__deployer__ship"];
const A_CONSTRUCTION_FAILURE = "a construction failure no gate has met";

const THE_REAL_ENTRY_POINT = path.join(repositoryRoot, "core", "src", "bin", "gate.ts");

const CORE_WHOSE_ENVELOPE_THROWS = mkdtempSync(path.join(tmpdir(), "oso-throwing-core-"));
const AN_ENTRY_POINT_WHOSE_ENVELOPE_THROWS = path.join(CORE_WHOSE_ENVELOPE_THROWS, "src", "bin", "gate.ts");

const A_SPAWNED_MODULE_THAT_THROWS =
  'import type { HookEnvelope } from "./envelope.ts";\n\n' +
  "export function spawnedEnvelope(_payload: string, _environment: NodeJS.ProcessEnv): HookEnvelope {\n" +
  `  throw new Error(${JSON.stringify(A_CONSTRUCTION_FAILURE)});\n` +
  "}\n";

cpSync(path.join(repositoryRoot, "core", "src"), path.join(CORE_WHOSE_ENVELOPE_THROWS, "src"), { recursive: true });
writeFileSync(path.join(CORE_WHOSE_ENVELOPE_THROWS, "src", "hosts", "spawned.ts"), A_SPAWNED_MODULE_THAT_THROWS);

after(() => {
  rmSync(CORE_WHOSE_ENVELOPE_THROWS, { recursive: true, force: true });
});

function nestedUnder(depth: number, leaf: string): string {
  return `${'{"nested":'.repeat(depth)}${leaf}${"}".repeat(depth)}`;
}

function envelopeBurying(toolName: string, command: string, depth: number): string {
  return (
    `{"session_id":"${SESSION}","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"${toolName}",` +
    `"tool_input":${nestedUnder(depth, `{"command":${JSON.stringify(command)}}`)}}`
  );
}

const A_DEEP_BENIGN_CALL = envelopeBurying("Bash", "npm run build", NESTING_PAST_THE_RECURSION);
const A_DEEP_COMMIT = envelopeBurying("Bash", "git commit -m x", NESTING_PAST_THE_RECURSION);

function runEntryPoint(entryPoint: string, seed: string | undefined, envelope: string): SpawnedRun {
  return withStateSandbox("workspace", (sandbox) => {
    if (seed !== undefined) sandbox.seed({ [STATE_FILE]: seed });
    return spawnAsHookHost(sandbox, { command: process.execPath, args: [entryPoint, "commit"] }, envelope);
  });
}

provedSomething(
  `the probe envelope buries its command under ${NESTING_PAST_THE_RECURSION} object level(s), ` +
    `${A_DEEP_COMMIT.length} bytes of payload`,
  A_DEEP_COMMIT.split('{"nested":').length - 1 === NESTING_PAST_THE_RECURSION,
  "the probe envelope nests shallower than it claims, so nothing here was measured past a call stack",
);

describe(
  "core/src/bin/gate.ts: a payload nested past any stack the entry point could walk still reaches the gate's " +
    "own verdict, because building the envelope no longer recurses once per level",
  () => {
    test("a benign command buried that deep is allowed silently while the verify is red", () => {
      const run = runEntryPoint(THE_REAL_ENTRY_POINT, ARMED_RED_STATE, A_DEEP_BENIGN_CALL);
      assert.deepEqual(
        { status: run.status, stdout: run.stdout, stderr: run.stderr },
        { status: 0, stdout: "", stderr: "" },
      );
    });

    test("a git commit buried that deep is denied while the verify is red, so the deep command was read", () => {
      const run = runEntryPoint(THE_REAL_ENTRY_POINT, ARMED_RED_STATE, A_DEEP_COMMIT);
      assert.equal(run.status, 0);
      assert.equal(run.stderr, "");
      assert.match(run.stdout, /"permissionDecision":"deny"/);
    });
  },
);

describe(
  "core/src/bin/gate.ts: a throw while the entry point builds its envelope blocks the call closed on the same " +
    "transport a gate's own failure takes — never the bare exit 1 an uncaught throw leaves, which is no verdict " +
    "any host reads as a block",
  () => {
    for (const toolName of TOOL_NAMES) {
      test(`a ${toolName} call meets exit ${GATE_ERROR_EXIT}, the fixed line on stderr and no stdout`, () => {
        const run = runEntryPoint(
          AN_ENTRY_POINT_WHOSE_ENVELOPE_THROWS,
          ARMED_RED_STATE,
          envelopeBurying(toolName, "git commit -m x", 0),
        );
        assert.equal(run.status, GATE_ERROR_EXIT);
        assert.equal(run.stdout, "");
        assert.equal(run.stderr, `${gateErrorText(THE_GATE_ENTRY_POINT)}oso-code: cause: ${A_CONSTRUCTION_FAILURE}\n`);
      });
    }
  },
);
