import path from "node:path";
import type { BackgroundTasks } from "../hosts/background-tasks.ts";
import { NO_VERDICT, type GateOutcome, type HookEnvelope, type NoVerdictVerdict } from "../hosts/envelope.ts";
import { gateRow, type GateId } from "../routes/routes.ts";
import {
  forgetAgent,
  markEndedWithoutNotice,
  readRegistry,
  recordCompletion,
  registeredIdsIn,
  writeRegisteredAgent,
  type RegisteredAgent,
  type RegistryReading,
  type UnreadableEntry,
} from "../state/in-flight-registry.ts";
import {
  completedAgentsLogOf,
  inFlightRegistryOf,
  isDirectory,
  isNameToken,
  isoTimestamp,
  jsonObjectOf,
  readFileIfPresent,
  stateFileFor,
} from "../state/store.ts";
import { captureVerifierReport, isVerifierAgent } from "../verdict/capture.ts";
import {
  hookSessionId,
  ownRunState,
  RUN_ARMED,
  sanitizeSession,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

export type InFlightResolution = Readonly<{
  agentIds: readonly string[];
  endedWithoutNotice: readonly string[];
  unreadable: readonly UnreadableEntry[];
}>;

type SessionRun = Readonly<{ sessionId: string; stateFile: string }>;

type ReportedAgent = Readonly<{ agentId: string; agentType: string }>;

type Sighting = Readonly<{
  registry: string | undefined;
  registered: RegistryReading;
  reported: readonly ReportedAgent[] | undefined;
  stoppingAgentId: string | undefined;
}>;

const SUBAGENT_TASK = "subagent";
const SUBAGENT_STOP_EVENT = "SubagentStop";
const NOTHING_REGISTERED: RegistryReading = { agents: [], unreadable: [] };

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
  const run = armedRunOf(envelope);
  if (run === undefined) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstart");
  writeRegisteredAgent(inFlightRegistryOf(run.stateFile, run.sessionId), {
    agentId: envelope.agentId,
    agentType: envelope.agentType,
    transcriptPath: derivedTranscriptPath(envelope, envelope.agentId),
    startedAt: isoTimestamp(),
  });
  return NO_VERDICT;
}

function forgetStoppedAgent({ envelope }: GateRequest): GateOutcome<NoVerdictVerdict> {
  captureVerifierStop(envelope);
  const run = armedRunOf(envelope);
  if (run === undefined) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstop");
  forgetAgent(inFlightRegistryOf(run.stateFile, run.sessionId), envelope.agentId);
  recordCompletion(completedAgentsLogOf(run.stateFile, run.sessionId), envelope.agentId);
  flagEndedWithoutNotice(envelope);
  return NO_VERDICT;
}

function captureVerifierStop(envelope: HookEnvelope): void {
  if (!isVerifierAgent(envelope.agentType)) return;
  captureVerifierReport({
    host: envelope.caller.host,
    cwd: envelope.cwd,
    session: hookSessionId(envelope),
    model: launchedModelOf(envelope),
    report: envelope.lastAssistantMessage,
  });
}

function launchedModelOf(envelope: HookEnvelope): string | null {
  if (!isNameToken(envelope.agentId)) return null;
  const transcript = derivedTranscriptPath(envelope, envelope.agentId);
  if (transcript === "") return null;
  const meta = readFileIfPresent(transcript.replace(/\.jsonl$/, ".meta.json"), "skip");
  const model = meta === undefined ? undefined : jsonObjectOf(meta)?.["model"];
  return typeof model === "string" ? model : null;
}

export function resolveInFlight(envelope: HookEnvelope): InFlightResolution {
  const sighting = sightingOf(envelope);
  const { agents, unreadable } = sighting.registered;
  if (sighting.reported === undefined) {
    const agentIds = registeredIdsIn(sighting.registered).filter((agentId) => agentId !== sighting.stoppingAgentId);
    return { agentIds, endedWithoutNotice: [], unreadable };
  }
  return {
    agentIds: sighting.reported.map((agent) => agent.agentId),
    endedWithoutNotice: [...flaggedIn(agents), ...newlyEndedIn(sighting)],
    unreadable,
  };
}

export function flagEndedWithoutNotice(envelope: HookEnvelope): void {
  const sighting = sightingOf(envelope);
  const { registry } = sighting;
  if (registry === undefined) return;
  for (const agentId of newlyEndedIn(sighting)) markEndedWithoutNotice(registry, agentId);
}

export function adoptUnregistered(envelope: HookEnvelope): void {
  const sighting = sightingOf(envelope);
  const { registry, reported } = sighting;
  if (registry === undefined || reported === undefined) return;
  const known = registeredIdsIn(sighting.registered);
  const unregisteredAgents = reported.filter(({ agentId }) => isNameToken(agentId) && !known.includes(agentId));
  for (const agent of unregisteredAgents) {
    writeRegisteredAgent(registry, {
      ...agent,
      transcriptPath: derivedTranscriptPath(envelope, agent.agentId),
      startedAt: isoTimestamp(),
    });
  }
}

function sightingOf(envelope: HookEnvelope): Sighting {
  const registry = registryOf(envelope);
  const stoppingAgentId = stoppingAgentOf(envelope);
  return {
    registry,
    registered: registry === undefined ? NOTHING_REGISTERED : readRegistry(registry),
    reported: reportedInFlight(envelope.backgroundTasks)?.filter((agent) => agent.agentId !== stoppingAgentId),
    stoppingAgentId,
  };
}

function newlyEndedIn({ registered, reported, stoppingAgentId }: Sighting): string[] {
  if (reported === undefined) return [];
  const stillReported = (agentId: string): boolean => reported.some((agent) => agent.agentId === agentId);
  return registered.agents
    .filter((agent) => !agent.endedWithoutNotice && agent.agentId !== stoppingAgentId && !stillReported(agent.agentId))
    .map((agent) => agent.agentId);
}

function stoppingAgentOf(envelope: HookEnvelope): string | undefined {
  return envelope.hookEventName === SUBAGENT_STOP_EVENT ? envelope.agentId : undefined;
}

function reportedInFlight(backgroundTasks: BackgroundTasks): ReportedAgent[] | undefined {
  switch (backgroundTasks.kind) {
    case "array":
      return backgroundTasks.tasks
        .filter((task) => task.type === SUBAGENT_TASK)
        .map((task) => ({ agentId: task.id, agentType: task.agentType }));
    case "object":
      return backgroundTasks.active.map((agentId) => ({ agentId, agentType: "" }));
    case "absent":
    case "unrecognized":
      return undefined;
  }
}

function flaggedIn(registered: readonly RegisteredAgent[]): string[] {
  return registered.filter((agent) => agent.endedWithoutNotice).map((agent) => agent.agentId);
}

function registryOf(envelope: HookEnvelope): string | undefined {
  const run = sessionRunOf(envelope);
  return run === undefined ? undefined : inFlightRegistryOf(run.stateFile, run.sessionId);
}

function armedRunOf(envelope: HookEnvelope): SessionRun | undefined {
  const run = sessionRunOf(envelope);
  if (run === undefined) return undefined;
  const content = ownRunState(run.stateFile, run.sessionId);
  return content !== undefined && stateValue(content, "auto") === RUN_ARMED ? run : undefined;
}

function sessionRunOf(envelope: HookEnvelope): SessionRun | undefined {
  const sessionId = hookSessionId(envelope);
  if (sessionId === "" || !isDirectory(envelope.cwd)) return undefined;
  return { sessionId, stateFile: stateFileFor(envelope.cwd) };
}

function derivedTranscriptPath(envelope: HookEnvelope, agentId: string): string {
  const sessionId = sanitizeSession(envelope.sessionId);
  if (envelope.transcriptPath === "" || sessionId === "") return "";
  return path.join(path.dirname(envelope.transcriptPath), sessionId, "subagents", `agent-${agentId}.jsonl`);
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
