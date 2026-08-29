import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const ARMED_RUN = "auto=running\nauto_change=auto-continuity\nsession=test-session\n";
const STATE_FILE = ".local/state/oso-code/{repo}.state";
const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const DENIED_OUTSIDE_PLAN_MODE = "oso-code: the approval document must be presented while Codex is still in Plan Mode.";

const REASON_A_SUFFIX_ANCHORED_READER_TAKES = /.*"reason":"(.*)"}$/;

function stopRun(gate: string, state: Record<string, string>, payload: string) {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(state);
    return withHookEnvironment({ HOME: sandbox.home }, () => runGate([gate], sandbox.expandJson(payload)));
  });
}

function continuationPush() {
  return stopRun(
    "autocontinue",
    { [STATE_FILE]: ARMED_RUN },
    '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}',
  );
}

provedSomething(
  "the Stop push envelope carries a reason a suffix-anchored reader can still take",
  REASON_A_SUFFIX_ANCHORED_READER_TAKES.exec(continuationPush().stdout.trimEnd())?.[1] !== undefined,
  "no reason could be read out of the push envelope, so the field-order claims below compared nothing",
);

describe(
  "core/src/hosts/stop.ts: the Stop push emits BOTH fields per C2-D7. The orchestrator measured the pinned " +
    "client at 2.1.250, where plugin/hooks/auto-continue.sh:36 emits the older decision/reason form alone and " +
    "a push written by that hook is recorded in this run's own tally; whether shouldContinue: true ALSO works " +
    "on 2.1.250 was not measured, since establishing it would perturb the Stop rail carrying the run",
  () => {
    test("a continuation push carries the older decision: block form the pinned client is known to honour", () => {
      const push = JSON.parse(continuationPush().stdout) as Record<string, unknown>;
      assert.equal(push["decision"], "block");
      assert.match(String(push["reason"]), /this run is unattended and still in flight/);
    });

    test("a continuation push carries shouldContinue: true beside it, never instead of it", () => {
      const push = JSON.parse(continuationPush().stdout) as Record<string, unknown>;
      assert.equal(push["shouldContinue"], true);
    });

    test(
      "shouldContinue precedes the reason, so the suffix-anchored reader tests/hooks-test.sh:4749 uses still " +
        "takes the whole order out of the envelope",
      () => {
        const reason = REASON_A_SUFFIX_ANCHORED_READER_TAKES.exec(continuationPush().stdout.trimEnd())?.[1];
        assert.match(String(reason), /wait for that instead\.$/);
      },
    );

    test("a Stop that allows the stop says {} and nothing else (measured: auto-continue.sh:18)", () => {
      const run = stopRun(
        "autocontinue",
        { [STATE_FILE]: "auto=parked\nauto_change=auto-continuity\nsession=test-session\n" },
        '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}',
      );
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "{}\n", stderr: "" });
    });

    test("a Stop denial is the block envelope while the rail is not already active (capture-plan-approval.sh:20)", () => {
      const run = stopRun(
        "planstop",
        {},
        '{"session_id":"test-session","cwd":"{cwd}","permission_mode":"default","hook_event_name":"Stop",' +
          `"stop_hook_active":false,"last_assistant_message":"Repaso\\n${PLAN_MARKER}"}`,
      );
      assert.equal(run.stdout, `{"decision":"block","reason":"${DENIED_OUTSIDE_PLAN_MODE}"}\n`);
    });

    test("the same denial ends the turn once the rail is already active (capture-plan-approval.sh:16-19)", () => {
      const run = stopRun(
        "planstop",
        {},
        '{"session_id":"test-session","cwd":"{cwd}","permission_mode":"default","hook_event_name":"Stop",' +
          `"stop_hook_active":true,"last_assistant_message":"Repaso\\n${PLAN_MARKER}"}`,
      );
      const ended = JSON.parse(run.stdout) as Record<string, unknown>;
      assert.deepEqual(ended, {
        continue: false,
        stopReason: DENIED_OUTSIDE_PLAN_MODE,
        systemMessage: DENIED_OUTSIDE_PLAN_MODE,
      });
    });
  },
);
