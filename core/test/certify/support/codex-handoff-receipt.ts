import type { LexedCommand } from "../../../src/shell/lexed-command.ts";
import { basenameOf } from "../../../src/shell/lexer.ts";
import { lineVerdict } from "../../../src/shell/line-verdict.ts";
import { isRecord } from "./config-fields.ts";

export type HandoffExpectation = Readonly<{ slice: string; attempt: string; agentType: string }>;

type HandoffInvocation = Readonly<{ verb: "wait" | "consume"; agentId: string }>;

const HANDOFF_BASE_OPTION_KEYS = ["--slice", "--attempt", "--agent-id", "--agent-type"] as const;
const RECEIPT_KEYS = ["version", "hook_session", "slice", "attempt", "agent_id", "agent_type"] as const;

function handoffInvocationIn(command: LexedCommand, expected: HandoffExpectation): HandoffInvocation | undefined {
  const tokens = command.tokens;
  const program = tokens[0];
  if (program === undefined || basenameOf(program) !== "oso-state" || tokens[1] !== "handoff") return undefined;
  const verb = tokens[2];
  if (verb !== "wait" && verb !== "consume") return undefined;
  const optionTokens = tokens.slice(3);
  if (optionTokens.length % 2 !== 0) return undefined;
  const allowed = new Set<string>(HANDOFF_BASE_OPTION_KEYS);
  if (verb === "wait") allowed.add("--timeout");
  const parsed = new Map<string, string>();
  for (let index = 0; index < optionTokens.length; index += 2) {
    const key = optionTokens[index] as string;
    const value = optionTokens[index + 1] as string;
    if (!allowed.has(key) || parsed.has(key)) return undefined;
    parsed.set(key, value);
  }
  if (verb === "wait" && !parsed.has("--timeout")) return undefined;
  const agentId = parsed.get("--agent-id");
  if (
    agentId === undefined ||
    agentId === "" ||
    parsed.get("--slice") !== expected.slice ||
    parsed.get("--attempt") !== expected.attempt ||
    parsed.get("--agent-type") !== expected.agentType
  ) {
    return undefined;
  }
  return { verb, agentId };
}

function firstHandoffInvocation(commandLine: string, expected: HandoffExpectation): HandoffInvocation | undefined {
  let found: HandoffInvocation | undefined;
  lineVerdict<"clear">(commandLine, (command, verdict) => {
    if (found === undefined) found = handoffInvocationIn(command, expected);
    return verdict;
  });
  return found;
}

function receiptLinesOf(output: string): string[] {
  return output === "" ? [] : output.replace(/\n$/, "").split("\n");
}

function receiptFrom(output: string): Readonly<Record<string, string>> | undefined {
  const lines = receiptLinesOf(output);
  if (lines.length !== RECEIPT_KEYS.length) return undefined;
  const receipt: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator === -1) return undefined;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!(RECEIPT_KEYS as readonly string[]).includes(key) || key in receipt || value === "") return undefined;
    receipt[key] = value;
  }
  return receipt["version"] === "1" ? receipt : undefined;
}

function commandStdout(item: Readonly<Record<string, unknown>>): string {
  for (const key of ["stdout", "output", "aggregated_output"]) {
    const value = item[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function receiptMatches(item: Readonly<Record<string, unknown>>, agentId: string, expected: HandoffExpectation): boolean {
  const receipt = receiptFrom(commandStdout(item));
  return (
    receipt !== undefined &&
    receipt["slice"] === expected.slice &&
    receipt["agent_id"] === agentId &&
    receipt["agent_type"] === expected.agentType
  );
}

function completedSuccessfully(item: Readonly<Record<string, unknown>>): boolean {
  if (item["status"] !== "completed") return false;
  const exitCode = item["exit_code"];
  return exitCode === undefined || exitCode === null || exitCode === 0;
}

function spawnedAgentIdsIn(item: Readonly<Record<string, unknown>>): readonly string[] {
  if (item["tool"] !== "spawn_agent" || item["status"] !== "completed") return [];
  const receivers = item["receiver_thread_ids"];
  return Array.isArray(receivers) ? receivers.filter((id): id is string => typeof id === "string" && id !== "") : [];
}

export function integratorHandoffConsumed(jsonlOutput: string, expected: HandoffExpectation): boolean {
  const spawnedAgentIds = new Set<string>();
  const waitedAgentIds = new Set<string>();
  const consumedAgentIds = new Set<string>();

  for (const line of jsonlOutput.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event["type"] !== "item.completed") continue;
    const item = event["item"];
    if (!isRecord(item)) continue;

    if (item["type"] === "collab_tool_call") {
      for (const agentId of spawnedAgentIdsIn(item)) spawnedAgentIds.add(agentId);
      continue;
    }
    if (item["type"] !== "command_execution" || !completedSuccessfully(item)) continue;
    const command = item["command"];
    if (typeof command !== "string") continue;
    const invocation = firstHandoffInvocation(command, expected);
    if (invocation === undefined || !receiptMatches(item, invocation.agentId, expected)) continue;
    (invocation.verb === "wait" ? waitedAgentIds : consumedAgentIds).add(invocation.agentId);
  }

  for (const agentId of spawnedAgentIds) {
    if (waitedAgentIds.has(agentId) && consumedAgentIds.has(agentId)) return true;
  }
  return false;
}
