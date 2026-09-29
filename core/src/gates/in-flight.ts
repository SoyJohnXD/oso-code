import { statSync } from "node:fs";
import type { BackgroundTasks } from "../hosts/background-tasks.ts";
import type { HookEnvelope } from "../hosts/envelope.ts";
import {
  derivedTranscriptPath,
  markEndedWithoutNotice,
  registeredAgentsIn,
  registryOf,
  type RegisteredAgent,
} from "./in-flight-registry.ts";

export type AgentTranscript = Readonly<{ path: string; modifiedAtMs: number | undefined }>;

export type InFlightAgent = Readonly<{ agentId: string; agentType: string; transcript: AgentTranscript }>;

export type InFlightSource = "background_tasks" | "registry";

export type InFlightResolution = Readonly<{
  source: InFlightSource;
  agents: readonly InFlightAgent[];
  endedWithoutNotice: readonly RegisteredAgent[];
}>;

type ListedAgent = Readonly<{ agentId: string; agentType: string; transcriptPath: string }>;

type InFlightListing = Readonly<{
  source: InFlightSource;
  agents: readonly ListedAgent[];
  endedWithoutNotice: readonly RegisteredAgent[];
}>;

const SUBAGENT_TASK = "subagent";
const SUBAGENT_STOP_EVENT = "SubagentStop";

export function resolveInFlight(envelope: HookEnvelope): InFlightResolution {
  const registry = registryOf(envelope);
  const listing = inFlightFrom(
    envelope.backgroundTasks,
    registry === undefined ? [] : registeredAgentsIn(registry),
    stoppingAgentOf(envelope),
  );
  if (registry !== undefined) {
    for (const ended of listing.endedWithoutNotice) markEndedWithoutNotice(registry, ended.agentId);
  }
  return {
    ...listing,
    agents: listing.agents.map(({ agentId, agentType, transcriptPath }) => ({
      agentId,
      agentType,
      transcript: transcriptOf(transcriptPath || derivedTranscriptPath(envelope, agentId)),
    })),
  };
}

function stoppingAgentOf(envelope: HookEnvelope): string | undefined {
  return envelope.hookEventName === SUBAGENT_STOP_EVENT ? envelope.agentId : undefined;
}

function inFlightFrom(
  backgroundTasks: BackgroundTasks,
  registered: readonly RegisteredAgent[],
  stoppingAgentId: string | undefined,
): InFlightListing {
  const stillRunning = (agent: ListedAgent): boolean => agent.agentId !== stoppingAgentId;
  const reported = reportedInFlight(backgroundTasks);
  if (reported === undefined) {
    return { source: "registry", agents: registered.filter(stillRunning), endedWithoutNotice: [] };
  }
  const reportedIds = new Set(reported.map((agent) => agent.agentId));
  const registeredById = new Map(registered.map((agent) => [agent.agentId, agent]));
  return {
    source: "background_tasks",
    agents: reported.filter(stillRunning).map((agent) => withRegistered(agent, registeredById.get(agent.agentId))),
    endedWithoutNotice: registered.filter(
      (agent) => !agent.endedWithoutNotice && !reportedIds.has(agent.agentId) && stillRunning(agent),
    ),
  };
}

function reportedInFlight(backgroundTasks: BackgroundTasks): ListedAgent[] | undefined {
  switch (backgroundTasks.kind) {
    case "array":
      return backgroundTasks.tasks
        .filter((task) => task.type === SUBAGENT_TASK)
        .map((task) => ({ agentId: task.id, agentType: task.agentType, transcriptPath: "" }));
    case "object":
      return backgroundTasks.active.map((agentId) => ({ agentId, agentType: "", transcriptPath: "" }));
    case "absent":
    case "unrecognized":
      return undefined;
  }
}

function withRegistered(reported: ListedAgent, registered: RegisteredAgent | undefined): ListedAgent {
  return {
    agentId: reported.agentId,
    agentType: reported.agentType || (registered?.agentType ?? ""),
    transcriptPath: registered?.transcriptPath ?? "",
  };
}

function transcriptOf(transcriptPath: string): AgentTranscript {
  if (transcriptPath === "") return { path: "", modifiedAtMs: undefined };
  return { path: transcriptPath, modifiedAtMs: statSync(transcriptPath, { throwIfNoEntry: false })?.mtimeMs };
}
