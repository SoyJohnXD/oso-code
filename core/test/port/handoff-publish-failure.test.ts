import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox, type SeededEntry } from "../support/state-sandbox.ts";

const REPORT = "oso-handoff: v=1 slice=slice-hook attempt=1\\nverdict: pass";
const WATERMARK = ".local/state/oso-code/.handoffs/{repo}/{sha256:agent-hook}.watermark";

type Payload = Readonly<{ session?: string; cwd?: string; agentId?: string; agentType?: string }>;

function payloadFor({ session = "test-session", cwd = "{cwd}", agentId = "agent-hook", agentType = "oso-verifier" }: Payload): string {
  return (
    `{"session_id":"${session}","cwd":"${cwd}","hook_event_name":"SubagentStop","turn_id":"turn-hook",` +
    `"agent_id":"${agentId}","agent_type":"${agentType}","stop_hook_active":false,` +
    `"last_assistant_message":"${REPORT}"}`
  );
}

function published(payload: Payload, seed: Readonly<Record<string, SeededEntry>> = {}): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home }, () => runGate(["handoff"], spawnedEnvelope(sandbox.expandJson(payloadFor(payload)), process.env)));
  });
}

const REFUSALS: readonly (readonly [string, Payload, string, string])[] = [
  ["no session id", { session: "" }, "missing session_id", ""],
  ["a working directory that is not there", { cwd: "{cwd}/gone" }, "missing or unreadable cwd", "test-session"],
  ["no agent id", { agentId: "" }, "missing agent_id", "test-session"],
  ["no agent type", { agentType: "" }, "missing agent_type", "test-session"],
];

provedSomething(
  `all ${REFUSALS.length} publish refusals name a distinct cause`,
  new Set(REFUSALS.map(([, , reason]) => reason)).size === REFUSALS.length,
  "two refusals share a cause, so this suite cannot tell which check refused",
);

describe(
  "core/src/gates/handoff.ts: the SubagentStop is never blocked — a failed publish is a diagnostic on stderr " +
    "beside an exit-0 {} (measured against plugin/hooks/publish-subagent-handoff.sh:12-17,30-34: no session_id " +
    "gives exit 0, stdout {}, stderr 'oso-code: SubagentStop could not publish its handoff: missing session_id' " +
    "and one appended handoff-publish-failed event)",
  () => {
    for (const [reads, payload, reason, session] of REFUSALS) {
      test(`${reads} fails the publish and lets the SubagentStop through`, () => {
        const run = published(payload);
        assert.deepEqual(
          { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
          { exit: 0, stdout: "{}\n", stderr: `oso-code: SubagentStop could not publish its handoff: ${reason}\n` },
        );
        assert.deepEqual(run.events, [{ event: "handoff-publish-failed", session, command: payload.agentType ?? "oso-verifier" }]);
      });
    }

    test("a receipt oso-state refuses fails the publish the same way, and blocks the SubagentStop no more than the rest", () => {
      const run = published({}, { [WATERMARK]: "version=1\nattempt=5\n" });
      assert.deepEqual(
        { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
        {
          exit: 0,
          stdout: "{}\n",
          stderr: "oso-code: SubagentStop could not publish its handoff: oso-state rejected the receipt\n",
        },
      );
      assert.deepEqual(run.events, [{ event: "handoff-publish-failed", session: "test-session", command: "oso-verifier" }]);
    });

    test("the failure event carries no gate and no hook event, exactly as its two-argument log_event call writes it", () => {
      const [event] = published({ session: "" }).events;
      assert.deepEqual(Object.keys(event ?? {}).sort(), ["command", "event", "session"]);
    });
  },
);
