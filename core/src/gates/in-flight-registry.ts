import { closeSync, constants, openSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { NO_VERDICT, type GateOutcome, type HookEnvelope, type NoVerdictVerdict } from "../hosts/envelope.ts";
import { gateRow, type GateId } from "../routes/routes.ts";
import {
  entriesOfDirectory,
  inFlightRegistryOf,
  isDirectory,
  isErrnoException,
  isNameToken,
  isoTimestamp,
  readStateFile,
  stateFileFor,
  withOwnerOnlyUmask,
  writeFileAtomically,
} from "../state/store.ts";
import {
  hookSessionId,
  RUN_ARMED,
  sanitizeSession,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

type StartedAgent = Readonly<{
  agentId: string;
  agentType: string;
  transcriptPath: string;
  startedAt: string;
}>;

export type RegisteredAgent = StartedAgent & Readonly<{ reported: boolean; endedWithoutNotice: boolean }>;

const MARK_SET = "true";
const APPEND_WITHOUT_CREATING = constants.O_WRONLY | constants.O_APPEND;

export const SUBAGENT_START_GATE: GateDefinition<NoVerdictVerdict> = {
  gate: "subagentstart",
  errorSubject: "the in-flight registry's subagent-start gate",
  judge: registerStartedAgent,
};

export const SUBAGENT_STOP_GATE: GateDefinition<NoVerdictVerdict> = {
  gate: "subagentstop",
  errorSubject: "the in-flight registry's subagent-stop gate",
  judge: forgetStoppedAgent,
};

function registerStartedAgent({ envelope }: GateRequest): GateOutcome<NoVerdictVerdict> {
  const registry = armedRegistryOf(envelope);
  if (registry === undefined) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstart");
  writeRegisteredAgent(registry, {
    agentId: envelope.agentId,
    agentType: envelope.agentType,
    transcriptPath: derivedTranscriptPath(envelope, envelope.agentId),
    startedAt: isoTimestamp(),
  });
  return NO_VERDICT;
}

function forgetStoppedAgent({ envelope }: GateRequest): GateOutcome<NoVerdictVerdict> {
  const registry = armedRegistryOf(envelope);
  if (registry === undefined) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstop");
  forgetAgent(registry, envelope.agentId);
  return NO_VERDICT;
}

export function registryOf(envelope: HookEnvelope): string | undefined {
  const run = sessionRunOf(envelope);
  return run === undefined ? undefined : inFlightRegistryOf(run.stateFile, run.sessionId);
}

function armedRegistryOf(envelope: HookEnvelope): string | undefined {
  const run = sessionRunOf(envelope);
  if (run === undefined) return undefined;
  const read = readStateFile(run.stateFile);
  if (read.kind !== "ok") return undefined;
  if (stateValue(read.content, "session") !== run.sessionId) return undefined;
  if (stateValue(read.content, "auto") !== RUN_ARMED) return undefined;
  return inFlightRegistryOf(run.stateFile, run.sessionId);
}

function sessionRunOf(envelope: HookEnvelope): Readonly<{ sessionId: string; stateFile: string }> | undefined {
  const sessionId = hookSessionId(envelope);
  if (sessionId === "" || !isDirectory(envelope.cwd)) return undefined;
  return { sessionId, stateFile: stateFileFor(envelope.cwd) };
}

export function derivedTranscriptPath(envelope: HookEnvelope, agentId: string): string {
  const sessionId = sanitizeSession(envelope.sessionId);
  if (envelope.transcriptPath === "" || sessionId === "" || !isNameToken(agentId)) return "";
  return path.join(path.dirname(envelope.transcriptPath), sessionId, "subagents", `agent-${agentId}.jsonl`);
}

export function registeredAgentsIn(registry: string): RegisteredAgent[] {
  return entriesOfDirectory(registry)
    .filter(isNameToken)
    .map((agentId) => registeredAgent(registry, agentId));
}

function registeredAgent(registry: string, agentId: string): RegisteredAgent {
  const read = readStateFile(path.join(registry, agentId));
  const content = read.kind === "ok" ? read.content : "";
  return {
    agentId,
    agentType: stateValue(content, "agent_type"),
    transcriptPath: stateValue(content, "transcript"),
    startedAt: stateValue(content, "started_at"),
    reported: stateValue(content, "reported") === MARK_SET,
    endedWithoutNotice: stateValue(content, "ended_without_notice") === MARK_SET,
  };
}

function writeRegisteredAgent(registry: string, agent: StartedAgent): void {
  const record =
    `agent_id=${agent.agentId}\nagent_type=${oneLine(agent.agentType)}\n` +
    `transcript=${oneLine(agent.transcriptPath)}\nstarted_at=${agent.startedAt}\n`;
  withOwnerOnlyUmask(() => writeFileAtomically(registry, path.join(registry, agent.agentId), record, ".registering-"));
}

export function markReported(registry: string, agentId: string): void {
  let entry: number;
  try {
    entry = openSync(path.join(registry, agentId), APPEND_WITHOUT_CREATING);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  try {
    writeSync(entry, `reported=${MARK_SET}\n`);
  } finally {
    closeSync(entry);
  }
}

export function forgetAgent(registry: string, agentId: string): void {
  rmSync(path.join(registry, agentId), { force: true });
}

function unregistered(envelope: HookEnvelope, gate: GateId): GateOutcome<NoVerdictVerdict> {
  const route = gateRow(gate);
  return {
    verdict: { kind: "noVerdict" },
    events: [
      {
        event: "in-flight-unregistered",
        session: hookSessionId(envelope),
        command: envelope.agentId,
        gate: route.script,
        hookEvent: route.event,
      },
    ],
  };
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}
