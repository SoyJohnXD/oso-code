import { appendFileSync, closeSync, constants, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import {
  completedAgentsLogOf,
  entriesOfDirectory,
  isErrnoException,
  isNameToken,
  isoTimestamp,
  readFileIfPresent,
  readStateFile,
  stateValue,
  withOwnerOnlyUmask,
  writeFileAtomically,
} from "./store.ts";

type StartedAgent = Readonly<{
  agentId: string;
  agentType: string;
  transcriptPath: string;
  startedAt: string;
}>;

export type RegisteredAgent = StartedAgent & Readonly<{ reported: boolean; endedWithoutNotice: boolean }>;

export type UnreadableEntry = Readonly<{ agentId: string; cause: string }>;

export type RegistryReading = Readonly<{
  agents: readonly RegisteredAgent[];
  unreadable: readonly UnreadableEntry[];
}>;

type EntryReading =
  | Readonly<{ kind: "registered"; agent: RegisteredAgent }>
  | Readonly<{ kind: "unreadable"; entry: UnreadableEntry }>
  | Readonly<{ kind: "gone" }>;

const MARK_SET = "true";
const APPEND_WITHOUT_CREATING = constants.O_WRONLY | constants.O_APPEND;

export function readRegistry(registry: string): RegistryReading {
  const readings = entriesOfDirectory(registry)
    .filter(isNameToken)
    .map((agentId) => entryReading(registry, agentId));
  return {
    agents: readings.flatMap((reading) => (reading.kind === "registered" ? [reading.agent] : [])),
    unreadable: readings.flatMap((reading) => (reading.kind === "unreadable" ? [reading.entry] : [])),
  };
}

function entryReading(registry: string, agentId: string): EntryReading {
  const entryFile = path.join(registry, agentId);
  const read = readStateFile(entryFile);
  if (read.kind === "absent") return { kind: "gone" };
  if (read.kind === "unreadable") return { kind: "unreadable", entry: { agentId, cause: read.cause } };
  const startedAt = stateValue(read.content, "started_at");
  if (Number.isNaN(Date.parse(startedAt))) {
    return { kind: "unreadable", entry: { agentId, cause: `no started_at timestamp in ${entryFile}` } };
  }
  const agent = {
    agentId,
    agentType: stateValue(read.content, "agent_type"),
    transcriptPath: stateValue(read.content, "transcript"),
    startedAt,
    reported: stateValue(read.content, "reported") === MARK_SET,
    endedWithoutNotice: stateValue(read.content, "ended_without_notice") === MARK_SET,
  };
  return { kind: "registered", agent };
}

export function registeredIdsIn(reading: RegistryReading): string[] {
  return [...reading.agents, ...reading.unreadable].map((entry) => entry.agentId);
}

export function writeRegisteredAgent(registry: string, agent: StartedAgent): void {
  const record =
    `agent_id=${agent.agentId}\nagent_type=${oneLine(agent.agentType)}\n` +
    `transcript=${oneLine(agent.transcriptPath)}\nstarted_at=${agent.startedAt}\n`;
  withOwnerOnlyUmask(() => writeFileAtomically(registry, path.join(registry, agent.agentId), record, ".registering-"));
}

export function markReported(registry: string, agentId: string): void {
  appendMark(registry, agentId, "reported");
}

export function markEndedWithoutNotice(registry: string, agentId: string): void {
  appendMark(registry, agentId, "ended_without_notice");
}

function appendMark(registry: string, agentId: string, mark: string): void {
  let entry: number;
  try {
    entry = openSync(path.join(registry, agentId), APPEND_WITHOUT_CREATING);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  try {
    writeSync(entry, `${mark}=${MARK_SET}\n`);
  } finally {
    closeSync(entry);
  }
}

export function forgetAgent(registry: string, agentId: string): void {
  rmSync(path.join(registry, agentId), { recursive: true, force: true });
}

export function recordCompletion(completedAgentsLog: string, agentId: string): void {
  withOwnerOnlyUmask(() => {
    mkdirSync(path.dirname(completedAgentsLog), { recursive: true });
    appendFileSync(completedAgentsLog, `${isoTimestamp()} ${agentId}\n`);
  });
}

export function completedAgentCount(stateFile: string, sessionId: string): number {
  const completedAgentsLog = completedAgentsLogOf(stateFile, sessionId);
  return (readFileIfPresent(completedAgentsLog) ?? "").split("\n").filter((line) => line !== "").length;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}
