import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";

const MEASURED_STOP_WITH_ONE_AGENT_RUNNING = JSON.stringify({
  session_id: "sess-1",
  transcript_path: "/p/proj/sess-1.jsonl",
  cwd: "/r",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "waiting",
  background_tasks: [
    { id: "a1", type: "subagent", status: "running", description: "apply S2", agent_type: "oso-code:applier" },
  ],
  session_crons: [],
});

function payloadCarrying(backgroundTasks: unknown): string {
  return JSON.stringify({ session_id: "sess-1", cwd: "/r", hook_event_name: "Stop", background_tasks: backgroundTasks });
}

function backgroundTasksOf(payload: string): unknown {
  return spawnedEnvelope(payload, {}).backgroundTasks;
}

describe("core/src/hosts/envelope.ts reads background_tasks off a Stop or SubagentStop payload", () => {
  test("the measured array shape is read whole, each entry's agent_type carried as agentType", () => {
    assert.deepEqual(backgroundTasksOf(MEASURED_STOP_WITH_ONE_AGENT_RUNNING), {
      kind: "array",
      tasks: [{ id: "a1", type: "subagent", status: "running", description: "apply S2", agentType: "oso-code:applier" }],
    });
  });

  test("the empty array a Stop carries once every agent completed is an array with no tasks, not absent", () => {
    assert.deepEqual(backgroundTasksOf(payloadCarrying([])), { kind: "array", tasks: [] });
  });

  test("the tolerated object shape reads its active and completed ids", () => {
    assert.deepEqual(backgroundTasksOf(payloadCarrying({ active: ["a1", "a2"], completed: ["a0"] })), {
      kind: "object",
      active: ["a1", "a2"],
      completed: ["a0"],
    });
  });

  test("a payload naming no background_tasks reads as absent", () => {
    assert.deepEqual(backgroundTasksOf('{"session_id":"sess-1","hook_event_name":"Stop"}'), { kind: "absent" });
  });

  test("a payload that is not JSON reads as absent", () => {
    assert.deepEqual(backgroundTasksOf('{"session_id":"sess-1","background_tasks":['), { kind: "absent" });
  });

  const UNRECOGNIZED_SHAPES: readonly Readonly<{ shape: string; value: unknown }>[] = [
    { shape: "a string", value: "a1" },
    { shape: "a number", value: 3 },
    { shape: "null", value: null },
    { shape: "an array holding a bare id", value: ["a1"] },
    { shape: "an array entry naming no id", value: [{ type: "subagent", status: "running" }] },
    { shape: "an object whose active is no list of ids", value: { active: "a1" } },
    { shape: "an object carrying neither list", value: { running: ["a1"] } },
  ];

  for (const { shape, value } of UNRECOGNIZED_SHAPES) {
    test(`${shape} is reported unrecognized, which the in-flight resolver treats as absent`, () => {
      assert.deepEqual(backgroundTasksOf(payloadCarrying(value)), { kind: "unrecognized" });
    });
  }

  test("the hook event the payload names is read too, so a SubagentStop can be told from a Stop", () => {
    assert.equal(spawnedEnvelope(MEASURED_STOP_WITH_ONE_AGENT_RUNNING, {}).hookEventName, "Stop");
  });
});
