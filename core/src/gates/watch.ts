import { readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import {
  inFlightRegistryOf,
  isErrnoException,
  sleepSync,
  watchPidFileOf,
  withOwnerOnlyUmask,
  writeFileAtomically,
} from "../state/store.ts";
import { forgetAgent, markReported, registeredAgentsIn, type RegisteredAgent } from "./in-flight-registry.ts";

export type WatchEnd = Readonly<{ exitCode: number; lines: readonly string[] }>;

type WatchLimits = Readonly<{ pollMs: number; silenceMs: number; longRunningMs: number }>;

type WatchedAgent = Readonly<{ agent: RegisteredAgent; lastWriteMs: number; startedMs: number }>;

type ReportKind = "stuck" | "long-running" | "ended-without-notice";

type AgentReport = Readonly<{ agent: RegisteredAgent; kind: ReportKind; line: string }>;

const MINUTE_MS = 60_000;
const DEFAULT_POLL_MS = 30_000;
const SILENCE_LIMIT_MS = 60 * MINUTE_MS;
const LONG_RUNNING_LIMIT_MS = 180 * MINUTE_MS;
const DELEGATION_NEEDS_ATTENTION_EXIT = 3;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const ALL_ENDED: WatchEnd = { exitCode: 0, lines: ["all delegations ended"] };

export function watchInFlight(stateFile: string, sessionId: string): WatchEnd {
  const registry = inFlightRegistryOf(stateFile, sessionId);
  const pidFile = watchPidFileOf(stateFile, sessionId);
  const limits = watchLimitsFrom(process.env);
  withOwnerOnlyUmask(() => writeFileAtomically(path.dirname(pidFile), pidFile, `${process.pid}\n`, ".watch-"));
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
  const pid = recordedPid(watchPidFileOf(stateFile, sessionId));
  return pid !== undefined && processLives(pid);
}

function pollOnce(registry: string, limits: WatchLimits): WatchEnd | undefined {
  const agents = registeredAgentsIn(registry);
  if (agents.length === 0) return ALL_ENDED;
  const nowMs = Date.now();
  const reports = agents
    .filter((agent) => !agent.reported)
    .flatMap((agent) => reportOf(watched(agent), nowMs, limits) ?? []);
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
  return { agent, kind, line: `${kind}: ${agent.agentId} (${agent.agentType})${measure}` };
}

function settle(registry: string, report: AgentReport): void {
  if (report.kind === "ended-without-notice") forgetAgent(registry, report.agent.agentId);
  else markReported(registry, report.agent.agentId);
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

function recordedPid(pidFile: string): number | undefined {
  try {
    const recorded = readFileSync(pidFile, "utf8").trim();
    return POSITIVE_INTEGER.test(recorded) ? Number(recorded) : undefined;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function processLives(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "EPERM") return true;
    if (isErrnoException(error) && error.code === "ESRCH") return false;
    throw error;
  }
}
