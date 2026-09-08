import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

const RUNNING_STATE = "auto=running\nauto_change=auto-continuity\nsession=test-session\n";
const STOP_PAYLOAD =
  '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}';
const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const PLANSTOP_REASON = "oso-code: the approval document must be presented while Codex is still in Plan Mode.";

function runStop(
  host: "claude" | "codex" | "opencode",
  gate: string,
  state: Record<string, string>,
  payload = STOP_PAYLOAD,
) {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(state);
    const environment: Record<string, string> =
      host === "opencode" ? { HOME: sandbox.home, OSO_HOST: host } : { HOME: sandbox.home, OSO_AGENT: host === "codex" ? "test-session" : "" };
    return withHookEnvironment(environment, () => runGate([gate], spawnedEnvelope(sandbox.expandJson(payload), process.env)));
  });
}

describe("Codex Stop transport keeps pushes native while preserving shared Stop decisions", () => {
  test("a Codex push exits 2 with only the continuation prompt on stderr", () => {
    const run = runStop("codex", "autocontinue", { [STATE_FILE]: RUNNING_STATE });

    assert.equal(run.exit, 2);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /^oso-code: this run is unattended and still in flight[\s\S]*\n$/);
  });

  test("Claude and OpenCode keep the JSON push on stdout", () => {
    for (const host of ["claude", "opencode"] as const) {
      const run = runStop(host, "autocontinue", { [STATE_FILE]: RUNNING_STATE });
      assert.equal(run.exit, 0);
      assert.equal(run.stderr, "");
      const push = JSON.parse(run.stdout) as Record<string, unknown>;
      assert.equal(push["shouldContinue"], true);
      assert.equal(push["decision"], "block");
    }
  });

  test("Codex allow remains the empty JSON response", () => {
    const run = runStop("codex", "autocontinue", { [STATE_FILE]: "auto=parked\nsession=test-session\n" });
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "{}\n", stderr: "" });
  });

  test("Codex plan approval denial keeps the block JSON response", () => {
    const payload =
      '{"session_id":"test-session","cwd":"{cwd}","permission_mode":"default","hook_event_name":"Stop",' +
      `"stop_hook_active":false,"last_assistant_message":"Repaso\\n${PLAN_MARKER}"}`;
    const run = runStop("codex", "planstop", {}, payload);
    assert.deepEqual(JSON.parse(run.stdout), { decision: "block", reason: PLANSTOP_REASON });
    assert.equal(run.exit, 0);
    assert.equal(run.stderr, "");
  });

  test("Codex active plan approval denial keeps the ended-turn JSON response", () => {
    const payload =
      '{"session_id":"test-session","cwd":"{cwd}","permission_mode":"default","hook_event_name":"Stop",' +
      `"stop_hook_active":true,"last_assistant_message":"Repaso\\n${PLAN_MARKER}"}`;
    const run = runStop("codex", "planstop", {}, payload);
    assert.deepEqual(JSON.parse(run.stdout), {
      continue: false,
      stopReason: PLANSTOP_REASON,
      systemMessage: PLANSTOP_REASON,
    });
    assert.equal(run.exit, 0);
    assert.equal(run.stderr, "");
  });
});
