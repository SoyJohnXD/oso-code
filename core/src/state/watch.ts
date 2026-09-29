import { rmSync, statSync } from "node:fs";
import path from "node:path";
import {
  forgetAgent,
  markReported,
  readRegistry,
  type RegisteredAgent,
  type UnreadableEntry,
} from "./in-flight-registry.ts";
import {
  inFlightRegistryOf,
  readFileIfPresent,
  sleepSync,
  stateValue,
  watchPidFileOf,
  withOwnerOnlyUmask,
  writeFileAtomically,
} from "./store.ts";

export type WatchEnd = Readonly<{ exitCode: number; lines: readonly string[] }>;

type WatchLimits = Readonly<{ pollMs: number; silenceMs: number; longRunningMs: number }>;

type WatchedAgent = Readonly<{ agent: RegisteredAgent; lastWriteMs: number; startedMs: number }>;

type ReportKind = "stuck" | "long-running" | "ended-without-notice" | "unreadable";

type AgentReport = Readonly<{ agentId: string; kind: ReportKind; line: string }>;

type WatchdogRecord = Readonly<{ pid: number; start: string }>;

const MINUTE_MS = 60_000;
const DEFAULT_POLL_MS = 30_000;
const SILENCE_LIMIT_MS = 60 * MINUTE_MS;
const LONG_RUNNING_LIMIT_MS = 180 * MINUTE_MS;
const DELEGATION_NEEDS_ATTENTION_EXIT = 3;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const WATCHDOG_RECORD = /^([1-9]\d*):(\d+)$/;
const START_TIME_FIELD_AFTER_COMMAND = 19;
const ALL_ENDED: WatchEnd = { exitCode: 0, lines: ["all delegations ended"] };

export function watchInFlight(stateFile: string, sessionId: string): WatchEnd {
  const registry = inFlightRegistryOf(stateFile, sessionId);
  const pidFile = watchPidFileOf(stateFile, sessionId);
  const limits = watchLimitsFrom(process.env);
  const record = `watch=${process.pid}:${processStartOf(process.pid) ?? ""}\n`;
  withOwnerOnlyUmask(() => writeFileAtomically(path.dirname(pidFile), pidFile, record, ".watch-"));
  try {
    for (;;) {
      const end = pollOnce(registry, limits);
      if (end !== undefined) return end;
      sleepSync(limits.pollMs);
    }
  } finally {
    rmSync(pidFile, { force: true });
  }
}

export function watchdogAlive(stateFile: string, sessionId: string): boolean {
  const watchdog = recordedWatchdog(watchPidFileOf(stateFile, sessionId));
  return watchdog !== undefined && processStartOf(watchdog.pid) === watchdog.start;
}

function pollOnce(registry: string, limits: WatchLimits): WatchEnd | undefined {
  const { agents, unreadable } = readRegistry(registry);
  if (agents.length === 0 && unreadable.length === 0) return ALL_ENDED;
  const nowMs = Date.now();
  const unreported = agents.filter((agent) => !agent.reported);
  const reports = [
    ...unreadable.map(unreadableReport),
    ...unreported.flatMap((agent) => reportOf(watched(agent), nowMs, limits) ?? []),
  ];
  if (reports.length === 0) return undefined;
  for (const report of reports) settle(registry, report);
  return { exitCode: DELEGATION_NEEDS_ATTENTION_EXIT, lines: reports.map((report) => report.line) };
}

function watched(agent: RegisteredAgent): WatchedAgent {
  const startedMs = Date.parse(agent.startedAt);
  const transcript = agent.transcriptPath === "" ? undefined : statSync(agent.transcriptPath, { throwIfNoEntry: false });
  return { agent, startedMs, lastWriteMs: transcript?.mtimeMs ?? startedMs };
}

function reportOf(watchedAgent: WatchedAgent, nowMs: number, limits: WatchLimits): AgentReport | undefined {
  const { agent, lastWriteMs, startedMs } = watchedAgent;
  if (agent.endedWithoutNotice) return reported(agent, "ended-without-notice", "");
  const silentMs = nowMs - lastWriteMs;
  if (silentMs >= limits.silenceMs) return reported(agent, "stuck", ` silent ${minutes(silentMs)} min`);
  const inFlightMs = nowMs - startedMs;
  if (inFlightMs < limits.longRunningMs) return undefined;
  return reported(agent, "long-running", ` in flight ${minutes(inFlightMs)} min`);
}

function reported(agent: RegisteredAgent, kind: ReportKind, measure: string): AgentReport {
  return { agentId: agent.agentId, kind, line: `${kind}: ${agent.agentId} (${agent.agentType})${measure}` };
}

function unreadableReport({ agentId }: UnreadableEntry): AgentReport {
  return { agentId, kind: "unreadable", line: `unreadable: ${agentId}` };
}

function settle(registry: string, report: AgentReport): void {
  if (report.kind === "stuck" || report.kind === "long-running") markReported(registry, report.agentId);
  else forgetAgent(registry, report.agentId);
}

function minutes(milliseconds: number): number {
  return Math.floor(milliseconds / MINUTE_MS);
}

function watchLimitsFrom(environment: NodeJS.ProcessEnv): WatchLimits {
  return {
    pollMs: testOverride(environment["OSO_WATCH_POLL_MS"]) ?? DEFAULT_POLL_MS,
    silenceMs: testOverride(environment["OSO_WATCH_SILENCE_MS"]) ?? SILENCE_LIMIT_MS,
    longRunningMs: testOverride(environment["OSO_WATCH_LONG_MS"]) ?? LONG_RUNNING_LIMIT_MS,
  };
}

function testOverride(value: string | undefined): number | undefined {
  if (value === undefined || !POSITIVE_INTEGER.test(value)) return undefined;
  return Number(value);
}

function recordedWatchdog(pidFile: string): WatchdogRecord | undefined {
  const recorded = WATCHDOG_RECORD.exec(stateValue(readFileIfPresent(pidFile) ?? "", "watch"));
  if (recorded === null) return undefined;
  return { pid: Number(recorded[1]), start: recorded[2] as string };
}

export function processStartOf(pid: number): string | undefined {
  const stat = readFileIfPresent(`/proc/${pid}/stat`);
  if (stat === undefined) return undefined;
  const fieldsAfterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fieldsAfterCommand[START_TIME_FIELD_AFTER_COMMAND];
}
