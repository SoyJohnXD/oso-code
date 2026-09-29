import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { logEvent } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  REPOSITORY_RUNS_DIR,
  STATE_FILE,
  withStateSandbox,
  type SeededEntry,
  type StateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "sess-verdict";
const VERDICTS = `${REPOSITORY_RUNS_DIR}/verdicts.jsonl`;
const ATTENDED_SLICE_TWO = `mode=plan\nactive_slice=2\nverify_green=false\nsession=${SESSION}\n`;
const ARMED_SLICE_TWO = `${JSON.stringify({ kind: "arm", slice: "2", session: SESSION, change: null, time: "2026-09-29T00:00:00Z" })}\n`;
const VERIFIER_META = `projects/proj/${SESSION}/subagents/agent-v1.meta.json`;

function subagentStop(agentType: string, lastMessage: string): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: `{home}/projects/proj/${SESSION}.jsonl`,
    cwd: "{cwd}",
    agent_id: "v1",
    agent_type: agentType,
    hook_event_name: "SubagentStop",
    last_assistant_message: lastMessage,
  });
}

const VERIFIER_FAIL = subagentStop("oso-code:oso-verifier", "## Verification\nverdict: fail\nfindings: one");

type Captured = Readonly<{ runs: GateRun[]; records: Record<string, unknown>[]; events: string[] }>;

function capturedAfter(seed: Readonly<Record<string, SeededEntry>>, payloads: readonly string[]): Captured {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    const runs = payloads.map((payload) => stopRunIn(sandbox, payload));
    return { runs, records: recordsIn(sandbox), events: sandbox.eventLogLines() };
  });
}

function stopRunIn(sandbox: StateSandbox, payload: string): GateRun {
  return withHookEnvironment({ HOME: sandbox.home }, () => {
    const run = runGate(["subagentstop"], spawnedEnvelope(sandbox.expandJson(payload), process.env));
    for (const event of run.events) logEvent(event);
    return run;
  });
}

function recordsIn(sandbox: StateSandbox): Record<string, unknown>[] {
  const log = sandbox.read(VERDICTS);
  if (log.kind !== "file") return [];
  return log.content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry["kind"] !== "arm");
}

function exitsOf(runs: readonly GateRun[]): number[] {
  return runs.map((run) => run.exit);
}

describe("the SubagentStop gate records every oso-verifier report, armed run or not", () => {
  test("a verifier's fail lands as attempt 1 on the state's active slice, and a second report as attempt 2", () => {
    const { runs, records } = capturedAfter(
      { [STATE_FILE]: ATTENDED_SLICE_TWO, [VERDICTS]: ARMED_SLICE_TWO, [VERIFIER_META]: '{"model":"sonnet"}' },
      [VERIFIER_FAIL, VERIFIER_FAIL],
    );
    assert.deepEqual(exitsOf(runs), [0, 0]);
    assert.deepEqual(
      records.map(({ host, session, change, slice, attempt, role, model, verdict, verdict_shape, escalated }) => ({
        host,
        session,
        change,
        slice,
        attempt,
        role,
        model,
        verdict,
        verdict_shape,
        escalated,
      })),
      [1, 2].map((attempt) => ({
        host: "claude",
        session: SESSION,
        change: null,
        slice: "2",
        attempt,
        role: "verifier",
        model: "sonnet",
        verdict: "fail",
        verdict_shape: "valid",
        escalated: false,
      })),
    );
  });

  test("the bare agent name is a verifier too, and a report with no verdict line lands as none and malformed", () => {
    const { records } = capturedAfter({ [STATE_FILE]: ATTENDED_SLICE_TWO }, [subagentStop("oso-verifier", "done")]);
    assert.deepEqual(
      records.map(({ verdict, verdict_shape, model }) => ({ verdict, verdict_shape, model })),
      [{ verdict: "none", verdict_shape: "malformed", model: null }],
    );
  });

  test("an applier's stop appends nothing", () => {
    const { runs, records } = capturedAfter({ [STATE_FILE]: ATTENDED_SLICE_TWO }, [
      subagentStop("oso-code:oso-applier", "status: done\nverdict: pass"),
    ]);
    assert.deepEqual(exitsOf(runs), [0]);
    assert.deepEqual(records, []);
  });

  test("a state file with no active_slice records the slice as null, never an invented value", () => {
    const { records } = capturedAfter({ [STATE_FILE]: `mode=quick\nsession=${SESSION}\n` }, [VERIFIER_FAIL]);
    assert.deepEqual(
      records.map(({ slice, attempt }) => ({ slice, attempt })),
      [{ slice: null, attempt: 1 }],
    );
  });

  test("a repository with no state file appends nothing", () => {
    const { records } = capturedAfter({}, [VERIFIER_FAIL]);
    assert.deepEqual(records, []);
  });

  test("an unwritable runs directory yields one telemetry-write-failed event and a silent exit 0", () => {
    const { runs, events } = capturedAfter(
      { [STATE_FILE]: ATTENDED_SLICE_TWO, [REPOSITORY_RUNS_DIR]: "a file where the runs directory belongs\n" },
      [VERIFIER_FAIL],
    );
    assert.deepEqual(
      runs.map(({ exit, stdout, stderr }) => ({ exit, stdout, stderr })),
      [{ exit: 0, stdout: "", stderr: "" }],
    );
    assert.equal(events.filter((line) => line.includes('"telemetry-write-failed"')).length, 1, events.join("\n"));
  });
});
