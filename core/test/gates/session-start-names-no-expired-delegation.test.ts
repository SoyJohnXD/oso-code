import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_RUNS_DIR, STATE_FILE, withStateSandbox, type ObservedEntry } from "../support/state-sandbox.ts";

const RUN_SESSION = "test-session";
const LEGACY_MARK = `${REPOSITORY_RUNS_DIR}/${RUN_SESSION}.waiting`;
const WELL_PAST_THE_OLD_CEILING = 3 * 60 * 60;

const UNATTENDED_RUN_WAITING_ON_A_WAVE =
  `mode=plan\nauto=running\nauto_change=hanko\nactive_slice=18\nverify_green=false\n` +
  `auto_wait=wave-2\nsession=${RUN_SESSION}\n`;

const EXPIRY_WORDING = /lost|still marked as waiting|older than 45 minutes|auto_wait/;

type SessionStartOutcome = Readonly<{ run: GateRun; markAfter: ObservedEntry }>;

function sessionStartBy(sessionId: string): SessionStartOutcome {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({
      [STATE_FILE]: UNATTENDED_RUN_WAITING_ON_A_WAVE,
      [LEGACY_MARK]: {
        kind: "file",
        content: `run=hanko\nsession=${RUN_SESSION}\njournal_bytes=0\nrenewals=0\n`,
        agedSeconds: WELL_PAST_THE_OLD_CEILING,
      },
    });
    const payload = JSON.stringify({ session_id: sessionId, cwd: "{cwd}", source: "startup" });
    const run = withHookEnvironment({ HOME: sandbox.home, OSO_STATE_BIN: "oso-state" }, () =>
      runGate(["stale"], spawnedEnvelope(sandbox.expandJson(payload), process.env)),
    );
    return { run, markAfter: sandbox.read(LEGACY_MARK) };
  });
}

describe("SessionStart on the Claude route names no expired delegation: a legacy wait mark is removed without a word", () => {
  test("the run's own session resuming over an old mark hears nothing and finds the mark gone", () => {
    const { run, markAfter } = sessionStartBy(RUN_SESSION);
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
    assert.equal(markAfter.kind, "absent");
  });

  test("another session starting over the same run hears only the stale-state advisory, never a delegation called lost", () => {
    const { run, markAfter } = sessionStartBy("another-session");
    assert.match(run.stdout, /was left by another session/);
    assert.doesNotMatch(run.stdout, EXPIRY_WORDING);
    assert.equal(markAfter.kind, "absent");
  });
});
