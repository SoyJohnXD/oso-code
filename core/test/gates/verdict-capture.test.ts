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

const AGENT_TRANSCRIPT = `projects/proj/${SESSION}/subagents/agent-v1.jsonl`;

function handbackLine(message: string): string {
  return JSON.stringify({
    isSidechain: true,
    agentId: "v1",
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "SubagentHandback", input: { message } }],
    },
  });
}

const HANDBACK_RESULT_LINE = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"success":true}' }],
  },
});

const TEXT_ONLY_LINE = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: "verdict: pass" }] },
});

function transcriptOf(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function verdictsAfter(transcript: string | undefined, lastMessage: string): unknown[] {
  const seed: Record<string, SeededEntry> = { [STATE_FILE]: ATTENDED_SLICE_TWO };
  if (transcript !== undefined) seed[AGENT_TRANSCRIPT] = transcript;
  const { runs, records } = capturedAfter(seed, [subagentStop("oso-code:oso-verifier", lastMessage)]);
  assert.deepEqual(exitsOf(runs), [0]);
  return records.map(({ verdict, verdict_shape }) => ({ verdict, verdict_shape }));
}

const PASS_VALID = [{ verdict: "pass", verdict_shape: "valid" }];
const NONE_MALFORMED = [{ verdict: "none", verdict_shape: "malformed" }];

describe("a verifier that delivers its report through SubagentHandback is captured from its own transcript", () => {
  test("an empty final message reads the last handback's message and records pass as valid", () => {
    const transcript = transcriptOf(
      handbackLine("verdict: fail\nfindings: stale"),
      handbackLine("verdict: pass\nevidence: one"),
      HANDBACK_RESULT_LINE,
    );
    assert.deepEqual(verdictsAfter(transcript, ""), PASS_VALID);
  });

  test("a transcript with no handback and an empty final message still records none and malformed", () => {
    assert.deepEqual(verdictsAfter(transcriptOf(TEXT_ONLY_LINE, HANDBACK_RESULT_LINE), ""), NONE_MALFORMED);
  });

  test("a non-empty final message wins over a different handback", () => {
    const transcript = transcriptOf(handbackLine("verdict: pass"));
    assert.deepEqual(verdictsAfter(transcript, "verdict: fail\nfindings: one"), [
      { verdict: "fail", verdict_shape: "valid" },
    ]);
  });

  test("a handback whose message has no verdict line records none and malformed", () => {
    assert.deepEqual(verdictsAfter(transcriptOf(handbackLine("all good, shipped")), ""), NONE_MALFORMED);
  });

  test("a missing transcript file records none and malformed without throwing", () => {
    assert.deepEqual(verdictsAfter(undefined, ""), NONE_MALFORMED);
  });

  test("a malformed transcript line is skipped and the handback before it still counts", () => {
    assert.deepEqual(verdictsAfter(transcriptOf(handbackLine("verdict: pass"), "{not json"), ""), PASS_VALID);
  });
});
