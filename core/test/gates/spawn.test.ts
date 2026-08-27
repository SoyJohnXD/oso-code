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
