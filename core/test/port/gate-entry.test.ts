import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const ARMED_RED_STATE = {
  ".local/state/oso-code/{repo}.state": "mode=plan\nverify_green=false\nsession=test-session\n",
};
const ARMED_RUN_STATE = {
  ".local/state/oso-code/{repo}.state": "auto=running\nauto_change=auto-continuity\nsession=test-session\n",
};

const CODEX_TOOL_ENVELOPE =
  '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{}}';

const MISCONFIGURED_ALLOWLISTS: readonly (readonly [string, readonly string[], string])[] = [
  ["no argument at all", [], "missing allowlist"],
  ["--allow with no list behind it", ["--allow"], "missing allowlist"],
  ["a flag that is not --allow", ["--deny", "Bash"], "missing allowlist"],
  ["a third argument", ["--allow", "Bash", "extra"], "missing allowlist"],
  ["an empty list", ["--allow", ""], "empty allowlist"],
  ["a name carrying a space", ["--allow", "Bash|has space"], "invalid allowlist"],
  ["an empty name between two separators", ["--allow", "Bash||apply_patch"], "invalid allowlist"],
];

const HOME_A_GATE_CANNOT_RESOLVE = "";

const A_PATTERN_GREP_EXITS_TWO_ON = "[abc-prod";
const A_PCRE_SPELLING_GREP_READS_AS_ERE = "(?:deploy|ship)-prod";

const HOLE_ONE_WRAPPERS: readonly string[] = [
  "script -qc 'vercel --prod' /dev/null",
  "ssh build-host 'vercel --prod'",
  "tmux new-session -d 'vercel --prod'",
];

provedSomething(
  `at least one of ${MISCONFIGURED_ALLOWLISTS.length} misconfigured allowlists is exercised`,
  MISCONFIGURED_ALLOWLISTS.length > 0,
  "the gate entry-point suite carries no case, so it proved nothing about how a gate fails closed",
);

describe("core/src/gates/dispatch.ts: port tests read from the gate scripts, never parity evidence", () => {
  test("an unknown gate name blocks the call instead of opening the gate (read from plugin/hooks/lib.sh:383-386)", () => {
    const run = judge(["frobnicate"], ARMED_RED_STATE, bashEnvelope("git commit -m x"));
    assert.equal(run.exit, 2);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /the gate entry point \(unknown gate 'frobnicate'\)/);
    assert.deepEqual(run.events, []);
  });

  for (const [reads, argv, cause] of MISCONFIGURED_ALLOWLISTS) {
    test(`${reads} blocks the unknown-tool gate on one line (read from plugin/hooks/block-unknown-tool.sh:7-18)`, () => {
      const run = judge(["unknown", ...argv], ARMED_RED_STATE, CODEX_TOOL_ENVELOPE);
      assert.equal(run.exit, 2);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, gateErrorLineTheBashPrints(`the unknown-tool gate configuration (${cause})`));
      assert.deepEqual(run.events, []);
    });
  }

  test("a gate that throws blocks on two lines, the fixed one and the cause (read from plugin/hooks/lib.sh:383-386)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(ARMED_RED_STATE);
      const envelope = sandbox.expandJson(bashEnvelope("git commit -m x"));
      return withHookEnvironment({ HOME: HOME_A_GATE_CANNOT_RESOLVE }, () => runGate(["commit"], envelope));
    });
    assert.equal(run.exit, 2);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, `${gateErrorLineTheBashPrints("the commit gate")}oso-code: cause: HOME is not set\n`);
    assert.deepEqual(run.events, []);
  });
});

describe("core/src/gates/proddeploy.ts: PINNED HOLE — a command-string-carrying wrapper reaches no deploy CLI", () => {
  for (const command of HOLE_ONE_WRAPPERS) {
    test(`${command} passes the production boundary allowed and uncounted (read from plugin/hooks/block-prod-deploy.sh:41-54)`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events, []);
    });
  }

  test("the same payload unquoted still reaches no deploy CLI, because the command word is the wrapper (read from plugin/hooks/block-prod-deploy.sh:48-51)", () => {
    const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope("ssh build-host vercel --prod"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
    assert.deepEqual(run.events, []);
  });
});

describe("core/src/gates/proddeploy.ts: a deny pattern grep exits 2 on denies nothing, as the bash gate's own grep does", () => {
  test(`${A_PATTERN_GREP_EXITS_TWO_ON} leaves a command it aims squarely at alone (read from plugin/hooks/block-prod-deploy.sh:130,134)`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PATTERN_GREP_EXITS_TWO_ON), bashEnvelope("abc-prod"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
    assert.deepEqual(run.events, []);
  });

  test("a later pattern still bites, because grep's exit 2 ends the pattern and not the file (read from plugin/hooks/block-prod-deploy.sh:129-133)", () => {
    const run = judge(
      ["proddeploy"],
      armedRunDenying(`${A_PATTERN_GREP_EXITS_TWO_ON}\n^ship-it`),
      bashEnvelope("ship-it now"),
    );
    assert.equal(run.exit, 0);
    assert.equal(run.stderr, "");
    assert.match(run.stdout, /"permissionDecision":"deny"/);
    assert.match(run.stdout, /this repository denies this command while one is/);
  });

  test(`${A_PCRE_SPELLING_GREP_READS_AS_ERE} bites the command grep's own ERE reading bites (read from plugin/hooks/block-prod-deploy.sh:130)`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PCRE_SPELLING_GREP_READS_AS_ERE), bashEnvelope("ship-prod"));
    assert.equal(run.exit, 0);
    assert.match(run.stdout, /"permissionDecision":"deny"/);
  });

  test(`${A_PCRE_SPELLING_GREP_READS_AS_ERE} spares the command that reading spares`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PCRE_SPELLING_GREP_READS_AS_ERE), bashEnvelope("npm run build"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
  });

  test("a pattern the port does read leaves a command it does not aim at alone", () => {
    const run = judge(["proddeploy"], armedRunDenying("^ship-it"), bashEnvelope("npm run build"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
  });
});

function gateErrorLineTheBashPrints(subject: string): string {
  return `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.\n`;
}

function armedRunDenying(pattern: string): Readonly<Record<string, string>> {
  return { ...ARMED_RUN_STATE, ".local/state/oso-code/deploy-deny/{repo}.patterns": `${pattern}\n` };
}

function bashEnvelope(command: string): string {
  return (
    '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
    `"tool_input":{"command":${JSON.stringify(command)}}}`
  );
}

function judge(argv: readonly string[], seed: Readonly<Record<string, string>>, envelope: string) {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home }, () => runGate(argv, sandbox.expandJson(envelope)));
  });
}
