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
import { messageOf, unwrap, type HostSessionApi } from "./wave.ts";

export interface ContinuationRequest {
  sessionID: string;
  directory: string;
  session?: HostSessionApi;
  client?: unknown;
  now?: () => number;
}

export type ContinuationOutcome =
  | { kind: "stood-down"; turns: number }
  | { kind: "failed"; reason: string; turns: number }
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

interface SessionNamingProperties {
  sessionID?: unknown;
  part?: { sessionID?: unknown };
  info?: { id?: unknown; sessionID?: unknown };
}

function sessionNamedBy(event: SessionEvent): string {
  const named = event.properties as SessionNamingProperties | undefined;
  const infoIsTheSession = event.type.startsWith("session.");
  const id = named?.sessionID
    ?? named?.part?.sessionID
    ?? named?.info?.sessionID
    ?? (infoIsTheSession ? named?.info?.id : undefined);
  return typeof id === "string" ? id : "";
}

function endsTheSession(event: SessionEvent): boolean {
  if (event.type === "session.idle" || event.type === "session.deleted") {
    return true;
  }
  const status = (event.properties as { status?: { type?: unknown } } | undefined)?.status;
  return event.type === "session.status" && status?.type === "idle";
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
    .catch((error: unknown) => standDownTraced(request, `the continuation rail failed: ${messageOf(error)}`, 0))
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
  let turns = 0;
  for (;;) {
    let step: ContinuationStep;
    try {
      step = nextContinuationStep(request);
    } catch (error) {
      endHold(request.sessionID);
      return standDownTraced(request, `the unattended run could not be read: ${messageOf(error)}`, turns);
    }
    if (step.kind === "held") {
      holdUntilAChildSettles(request, step.children);
      return { kind: "stood-down", turns };
    }
    endHold(request.sessionID);
    if (step.kind === "stop") {
      return { kind: "stood-down", turns };
    }
    try {
      await postContinuationTurn(request, step.order);
    } catch (error) {
      return standDownTraced(request, `the continuation turn did not land: ${messageOf(error)}`, turns);
    }
    turns += 1;
  }
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
    recordTrace({
      origin: "auto-continue",
      detail: `the run is held while child sessions run: ${children.join(", ")}`,
      severity: "advisory",
      sessionID: request.sessionID,
      client: request.client,
    });
  } else {
    clearTimeout(previous.wake);
  }
  const untilOverdueMs = Math.max(0, earliestOverdueMs(children) - (request.now ?? Date.now)());
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
  const nowMs = (request.now ?? Date.now)();
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
  recordTrace({
    origin: "auto-continue",
    detail: report,
    severity: "advisory",
    sessionID: request.sessionID,
    client: request.client,
  });
  try {
    appendJournal(journalFileFor(request.directory), `auto-continue: ${report}`);
  } catch (error) {
    recordTrace({
      origin: "auto-continue",
      detail: `the report on child session ${childID} could not be journaled: ${messageOf(error)}`,
      severity: "advisory",
      sessionID: request.sessionID,
      client: request.client,
    });
  }
}

function childSessionsOf(parentID: string): ChildSessionsOfRun {
  const children = [...childSessions].filter(([, child]) => child.parentID === parentID);
  return {
    active: children.filter(([, child]) => child.phase === "running").map(([childID]) => childID),
    completed: children.filter(([, child]) => child.phase === "completed").map(([childID]) => childID),
  };
}

async function postContinuationTurn(request: ContinuationRequest, order: string): Promise<void> {
  const session = request.session;
  if (session === undefined) {
    throw new Error("this host handed the plugin no session api to post a continuation turn through");
  }
  await unwrap(session.prompt({
    path: { id: request.sessionID },
    body: { parts: [{ type: "text", text: order }] },
  }));
}

function standDownTraced(request: ContinuationRequest, reason: string, turns: number): ContinuationOutcome {
  recordTrace({
    origin: "auto-continue",
    detail: reason,
    severity: "advisory",
    sessionID: request.sessionID,
    client: request.client,
  });
  return { kind: "failed", reason, turns };
}
