import {
  appendJournal,
  delegationOverdueAtMs,
  hostEnvelope,
  journalFileFor,
  logEvent,
  overdueDelegation,
  runGate,
  RUN_HELD_EVENT,
  type OverdueDelegation,
} from "@oso-code/core";
import { callerFor } from "./gates.ts";
import { recordTrace } from "./trace.ts";
import { messageOf } from "./wave.ts";

export interface ContinuationRequest {
  sessionID: string;
  directory: string;
  admitTurn: (order: string) => Promise<void>;
  now?: () => number;
}

export type ContinuationOutcome =
  | { kind: "stood-down" }
  | { kind: "admitted"; order: string }
  | { kind: "failed"; reason: string }
  | { kind: "not-this-runs-session" }
  | { kind: "already-driving" };

export interface SessionEvent {
  type: string;
  properties?: Record<string, unknown>;
}

type ChildPhase = "running" | "reported" | "completed";

interface ChildSession {
  parentID: string;
  startedMs: number;
  lastActivityMs: number;
  phase: ChildPhase;
}

type ChildSessionsOfRun = Readonly<{ active: readonly string[]; completed: readonly string[] }>;

type ContinuationStep =
  | { kind: "push"; order: string }
  | { kind: "held"; children: readonly string[] }
  | { kind: "stop" };

interface HeldRun {
  request: ContinuationRequest;
  wake: ReturnType<typeof setTimeout>;
}

const ENDING_EVENTS: ReadonlySet<string> = new Set([
  "session.idle",
  "session.deleted",
  "session.execution.failed",
  "session.execution.interrupted",
]);

const childSessions = new Map<string, ChildSession>();
const driving = new Set<string>();
const heldRuns = new Map<string, HeldRun>();

export function trackSessionEvent(event: SessionEvent, nowMs: number = Date.now()): void {
  if (event.type === "session.created") {
    recordLaunchedChild(event.properties, nowMs);
    return;
  }
  const child = childSessions.get(sessionNamedBy(event));
  if (child === undefined || child.phase === "completed") {
    return;
  }
  if (endsTheSession(event)) {
    child.phase = "completed";
    redriveHeldRun(child.parentID);
    return;
  }
  child.lastActivityMs = nowMs;
}

function recordLaunchedChild(properties: SessionEvent["properties"], nowMs: number): void {
  const info = (properties as { info?: { id?: unknown; parentID?: unknown } } | undefined)?.info;
  const id = info?.id;
  const parentID = info?.parentID;
  if (typeof id === "string" && id !== "" && typeof parentID === "string" && parentID !== "") {
    childSessions.set(id, { parentID, startedMs: nowMs, lastActivityMs: nowMs, phase: "running" });
  }
}

function sessionNamedBy(event: SessionEvent): string {
  const id = (event.properties as { sessionID?: unknown } | undefined)?.sessionID;
  return typeof id === "string" ? id : "";
}

function endsTheSession(event: SessionEvent): boolean {
  return ENDING_EVENTS.has(event.type);
}

export function continueUnattendedRun(request: ContinuationRequest): Promise<ContinuationOutcome> {
  if (request.sessionID === "" || childSessions.has(request.sessionID)) {
    return Promise.resolve({ kind: "not-this-runs-session" });
  }
  if (driving.has(request.sessionID)) {
    return Promise.resolve({ kind: "already-driving" });
  }
  driving.add(request.sessionID);
  return postUntilTheRunStops(request)
    .catch((error: unknown) => standDownTraced(request, `the continuation rail failed: ${messageOf(error)}`))
    .finally(() => {
      driving.delete(request.sessionID);
    });
}

export function releaseHeldRuns(): void {
  for (const held of heldRuns.values()) {
    clearTimeout(held.wake);
  }
  heldRuns.clear();
}

async function postUntilTheRunStops(request: ContinuationRequest): Promise<ContinuationOutcome> {
  let step: ContinuationStep;
  try {
    step = nextContinuationStep(request);
  } catch (error) {
    endHold(request.sessionID);
    return standDownTraced(request, `the unattended run could not be read: ${messageOf(error)}`);
  }
  if (step.kind === "held") {
    holdUntilAChildSettles(request, step.children);
    return { kind: "stood-down" };
  }
  endHold(request.sessionID);
  if (step.kind === "stop") {
    return { kind: "stood-down" };
  }
  try {
    await request.admitTurn(step.order);
  } catch (error) {
    return standDownTraced(request, `the continuation turn did not land: ${messageOf(error)}`);
  }
  return { kind: "admitted", order: step.order };
}

function nextContinuationStep(request: ContinuationRequest): ContinuationStep {
  releaseOverdueChildren(request);
  const children = childSessionsOf(request.sessionID);
  const envelope = hostEnvelope(callerFor(request.directory), {
    sessionId: request.sessionID,
    cwd: request.directory,
    backgroundTasks: { kind: "object", ...children },
  });
  const run = runGate(["autocontinue"], envelope);
  for (const event of run.events) {
    logEvent(event);
  }
  if (run.verdict.kind === "push") {
    return { kind: "push", order: run.verdict.reason };
  }
  const held = children.active.length > 0 && run.events.some((event) => event.event === RUN_HELD_EVENT);
  return held ? { kind: "held", children: children.active } : { kind: "stop" };
}

function holdUntilAChildSettles(request: ContinuationRequest, children: readonly string[]): void {
  const previous = heldRuns.get(request.sessionID);
  if (previous === undefined) {
    traceRun(request, `the run is held while child sessions run: ${children.join(", ")}`);
  } else {
    clearTimeout(previous.wake);
  }
  const untilOverdueMs = Math.max(0, earliestOverdueMs(children) - nowOf(request));
  const wake = setTimeout(() => redriveHeldRun(request.sessionID), untilOverdueMs).unref();
  heldRuns.set(request.sessionID, { request, wake });
}

function earliestOverdueMs(children: readonly string[]): number {
  const clocks = children.flatMap((childID) => childSessions.get(childID) ?? []);
  return Math.min(...clocks.map(delegationOverdueAtMs));
}

function redriveHeldRun(parentID: string): void {
  const held = heldRuns.get(parentID);
  if (held !== undefined) {
    void continueUnattendedRun(held.request);
  }
}

function endHold(parentID: string): void {
  const held = heldRuns.get(parentID);
  if (held !== undefined) {
    clearTimeout(held.wake);
    heldRuns.delete(parentID);
  }
}

function releaseOverdueChildren(request: ContinuationRequest): void {
  const nowMs = nowOf(request);
  for (const [childID, child] of childSessions) {
    if (child.parentID !== request.sessionID || child.phase !== "running") {
      continue;
    }
    const overdue = overdueDelegation(child, nowMs);
    if (overdue !== undefined) {
      child.phase = "reported";
      reportOverdueChild(request, childID, overdue);
    }
  }
}

function reportOverdueChild(request: ContinuationRequest, childID: string, overdue: OverdueDelegation): void {
  const report = `child session ${childID} ${overdue.kind}:${overdue.measure} — released from the hold`;
  traceRun(request, report);
  try {
    appendJournal(journalFileFor(request.directory), `auto-continue: ${report}`);
  } catch (error) {
    traceRun(request, `the report on child session ${childID} could not be journaled: ${messageOf(error)}`);
  }
}

function childSessionsOf(parentID: string): ChildSessionsOfRun {
  const children = [...childSessions].filter(([, child]) => child.parentID === parentID);
  return {
    active: children.filter(([, child]) => child.phase === "running").map(([childID]) => childID),
    completed: children.filter(([, child]) => child.phase === "completed").map(([childID]) => childID),
  };
}

function standDownTraced(request: ContinuationRequest, reason: string): ContinuationOutcome {
  traceRun(request, reason);
  return { kind: "failed", reason };
}

function traceRun(request: ContinuationRequest, detail: string): void {
  recordTrace({ origin: "auto-continue", detail, severity: "advisory", sessionID: request.sessionID });
}

function nowOf(request: ContinuationRequest): number {
  return (request.now ?? Date.now)();
}
