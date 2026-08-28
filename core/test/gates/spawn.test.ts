import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";
import { provedSomething } from "../support/proved.ts";
import {
  repositoryRoot,
  skipUnlessSpawnable,
  withStateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const GATE_ENTRY_POINT: StateSubject = {
  name: "node core/src/bin/gate.ts",
  command: [process.execPath, "--experimental-strip-types", path.join(repositoryRoot, "core", "src", "bin", "gate.ts")],
};

const ARMED_RED_STATE = {
  ".local/state/oso-code/{repo}.state": "mode=plan\nverify_green=false\nsession=test-session\n",
};

const COMMIT_ENVELOPE =
  '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
  '"tool_input":{"command":"git commit -m x"}}';

const ARMED_RUN_STATE = {
  ".local/state/oso-code/{repo}.state": "auto=running\nauto_change=auto-continuity\nsession=test-session\n",
};

const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";

function stopEnvelope(active: boolean): string {
  return `{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":${active}}`;
}

const PLAN_STOP_ENVELOPE =
  '{"session_id":"test-session","transcript_path":null,"cwd":"{cwd}","permission_mode":"default",' +
  `"hook_event_name":"Stop","turn_id":"t","stop_hook_active":true,"last_assistant_message":"Repaso\\n${PLAN_MARKER}"}`;

const CANCEL_ENVELOPE =
  '{"session_id":"test-session","transcript_path":null,"cwd":"{cwd}","permission_mode":"default",' +
  '"hook_event_name":"UserPromptSubmit","turn_id":"t","prompt":"CANCEL OSO PLAN"}';

const HANDOFF_ENVELOPE =
  '{"session_id":"","cwd":"{cwd}","hook_event_name":"SubagentStop","agent_id":"agent-hook",' +
  '"agent_type":"oso-verifier","last_assistant_message":"oso-handoff: v=1 slice=slice-hook attempt=1"}';

provedSomething(
  `${GATE_ENTRY_POINT.name} is spawnable here`,
  skipUnlessSpawnable(GATE_ENTRY_POINT) === false,
  `${GATE_ENTRY_POINT.name} cannot be spawned here, so no transport shape crossed a real process boundary`,
);

describe(
  "the three transport shapes of a PreToolUse gate, crossing a real process boundary",
  { skip: skipUnlessSpawnable(GATE_ENTRY_POINT) },
  () => {
    test("a deny is one JSON line on stdout and exit 0 (read from plugin/hooks/lib.sh:373-381)", () => {
      const run = withStateSandbox("workspace", (sandbox) => {
        sandbox.seed(ARMED_RED_STATE);
        return sandbox.run(GATE_ENTRY_POINT, ["commit"], { stdin: sandbox.expandJson(COMMIT_ENVELOPE) });
      });
      assert.equal(run.exit, 0);
      assert.equal(run.stderr, "");
      const verdict: unknown = JSON.parse(run.stdout);
      assert.deepEqual(verdict, {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "oso-code: the session verify is not green. Resume plan mode's apply → verify loop until the verifier returns pass, then retry the commit.",
        },
      });
    });

    test("a gate error is plain text on stderr and exit 2 (read from plugin/hooks/lib.sh:383-386)", () => {
      const run = withStateSandbox("workspace", (sandbox) => {
        sandbox.seed(ARMED_RED_STATE);
        return sandbox.run(GATE_ENTRY_POINT, ["frobnicate"], { stdin: sandbox.expandJson(COMMIT_ENVELOPE) });
      });
      assert.equal(run.exit, 2);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /^oso-code: the gate entry point \(unknown gate 'frobnicate'\) failed unexpectedly/);
      assert.match(run.stderr, /No remedy is known for this failure\.\n$/);
    });

    test("an allow is silence and exit 0 (read from plugin/hooks/lib.sh:329-331)", () => {
      const run = withStateSandbox("workspace", (sandbox) =>
        sandbox.run(GATE_ENTRY_POINT, ["commit"], { stdin: sandbox.expandJson(COMMIT_ENVELOPE) }),
      );
      assert.equal(run.exit, 0);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, "");
    });
  },
);

describe(
  "the five transport shapes this slice's three host serialisers add, crossing a real process boundary",
  { skip: skipUnlessSpawnable(GATE_ENTRY_POINT) },
  () => {
    test("a Stop push is one JSON line carrying both fields on stdout and exit 0", () => {
      const run = withStateSandbox("workspace", (sandbox) => {
        sandbox.seed(ARMED_RUN_STATE);
        return sandbox.run(GATE_ENTRY_POINT, ["autocontinue"], { stdin: sandbox.expandJson(stopEnvelope(false)) });
      });
      assert.equal(run.exit, 0);
      assert.equal(run.stderr, "");
      const push = JSON.parse(run.stdout) as Record<string, unknown>;
      assert.equal(push["shouldContinue"], true);
      assert.equal(push["decision"], "block");
    });

    test("a Stop that allows the stop is the empty object on stdout and exit 0", () => {
      const run = withStateSandbox("workspace", (sandbox) =>
        sandbox.run(GATE_ENTRY_POINT, ["autocontinue"], { stdin: sandbox.expandJson(stopEnvelope(false)) }),
      );
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "{}\n", stderr: "" });
    });

    test("a Stop denial on an already-active rail ends the turn instead of blocking it again", () => {
      const run = withStateSandbox("workspace", (sandbox) =>
        sandbox.run(GATE_ENTRY_POINT, ["planstop"], { stdin: sandbox.expandJson(PLAN_STOP_ENVELOPE) }),
      );
      assert.equal(run.exit, 0);
      assert.equal((JSON.parse(run.stdout) as Record<string, unknown>)["continue"], false);
    });

    test("a UserPromptSubmit refusal is one JSON line on stdout and exit 0", () => {
      const run = withStateSandbox("workspace", (sandbox) =>
        sandbox.run(GATE_ENTRY_POINT, ["planprompt"], { stdin: sandbox.expandJson(CANCEL_ENVELOPE) }),
      );
      assert.equal(run.exit, 0);
      assert.equal((JSON.parse(run.stdout) as Record<string, unknown>)["decision"], "block");
    });

    test("a SubagentStop whose publish failed carries the cause on stderr beside an exit-0 empty object", () => {
      const run = withStateSandbox("workspace", (sandbox) =>
        sandbox.run(GATE_ENTRY_POINT, ["handoff"], { stdin: sandbox.expandJson(HANDOFF_ENVELOPE) }),
      );
      assert.deepEqual(
        { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
        {
          exit: 0,
          stdout: "{}\n",
          stderr: "oso-code: SubagentStop could not publish its handoff: missing session_id\n",
        },
      );
    });
  },
);
