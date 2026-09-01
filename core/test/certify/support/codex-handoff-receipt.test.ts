import assert from "node:assert/strict";
import { test } from "node:test";
import { integratorHandoffConsumed, type HandoffExpectation } from "./codex-handoff-receipt.ts";

const EXPECTATION: HandoffExpectation = { slice: "wave-smoke-synthetic-slice", attempt: "1", agentType: "oso-integrator" };
const AGENT_ID = "agent-42";

function receiptStdout(overrides: Readonly<Partial<Record<string, string>>> = {}): string {
  const receipt: Record<string, string> = {
    version: "1",
    hook_session: "session-1",
    slice: EXPECTATION.slice,
    attempt: EXPECTATION.attempt,
    agent_id: AGENT_ID,
    agent_type: EXPECTATION.agentType,
    ...overrides,
  };
  return Object.entries(receipt)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function spawnEvent(agentIds: readonly string[]): string {
  return JSON.stringify({ type: "item.completed", item: { type: "collab_tool_call", tool: "spawn_agent", status: "completed", receiver_thread_ids: agentIds } });
}

function commandEvent(command: string, stdout: string): string {
  return JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, status: "completed", exit_code: 0, aggregated_output: stdout } });
}

function waitCommand(agentId: string): string {
  return `oso-state handoff wait --slice ${EXPECTATION.slice} --attempt ${EXPECTATION.attempt} --agent-id ${agentId} --agent-type ${EXPECTATION.agentType} --timeout 10`;
}

function consumeCommand(agentId: string): string {
  return `oso-state handoff consume --slice ${EXPECTATION.slice} --attempt ${EXPECTATION.attempt} --agent-id ${agentId} --agent-type ${EXPECTATION.agentType}`;
}

function stream(...lines: readonly string[]): string {
  return lines.join("\n");
}

test("correlates a spawned agent's matching wait and consume receipts into a consumed handoff, skipping a malformed line along the way", () => {
  const s = stream(
    spawnEvent([AGENT_ID]),
    "{this is not json",
    commandEvent(waitCommand(AGENT_ID), receiptStdout()),
    commandEvent(consumeCommand(AGENT_ID), receiptStdout()),
  );
  assert.equal(integratorHandoffConsumed(s, EXPECTATION), true);
});

test("reports not consumed for the missing piece of a spawn and a wait with no matching consume", () => {
  const s = stream(spawnEvent([AGENT_ID]), commandEvent(waitCommand(AGENT_ID), receiptStdout()));
  assert.equal(integratorHandoffConsumed(s, EXPECTATION), false);
});

test("reports not consumed when the wait and consume receipts name an agent id no spawn ever produced", () => {
  const s = stream(spawnEvent(["a-different-agent"]), commandEvent(waitCommand(AGENT_ID), receiptStdout()), commandEvent(consumeCommand(AGENT_ID), receiptStdout()));
  assert.equal(integratorHandoffConsumed(s, EXPECTATION), false);
});

test("reports not consumed when the consume receipt is malformed — missing the version field a real receipt always carries", () => {
  const s = stream(spawnEvent([AGENT_ID]), commandEvent(waitCommand(AGENT_ID), receiptStdout()), commandEvent(consumeCommand(AGENT_ID), receiptStdout({ version: "2" })));
  assert.equal(integratorHandoffConsumed(s, EXPECTATION), false);
});

test("reports not consumed for an empty stream", () => {
  assert.equal(integratorHandoffConsumed("", EXPECTATION), false);
});
