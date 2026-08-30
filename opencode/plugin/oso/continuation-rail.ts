import { hostEnvelope, logEvent, runGate } from "@oso-code/core";
import { callerFor } from "./gates.ts";
import { recordTrace } from "./trace.ts";
import { messageOf, unwrap, type HostSessionApi } from "./wave.ts";

export interface ContinuationRequest {
  sessionID: string;
  directory: string;
  session?: HostSessionApi;
  client?: unknown;
}

export type ContinuationOutcome =
  | { kind: "stood-down"; turns: number }
  | { kind: "failed"; reason: string; turns: number }
  | { kind: "not-this-runs-session" }
  | { kind: "already-driving" };

const childSessions = new Set<string>();
const driving = new Set<string>();

export function recordSessionLineage(properties: unknown): void {
  const info = (properties as { info?: { id?: unknown; parentID?: unknown } } | null | undefined)?.info;
  const id = info?.id;
  const parentID = info?.parentID;
  if (typeof id === "string" && id !== "" && typeof parentID === "string" && parentID !== "") {
    childSessions.add(id);
  }
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

async function postUntilTheRunStops(request: ContinuationRequest): Promise<ContinuationOutcome> {
  let turns = 0;
  for (;;) {
    let order: string | undefined;
    try {
      order = nextContinuationOrder(request);
    } catch (error) {
      return standDownTraced(request, `the unattended run could not be read: ${messageOf(error)}`, turns);
    }
    if (order === undefined) {
      return { kind: "stood-down", turns };
    }
    try {
      await postContinuationTurn(request, order);
    } catch (error) {
      return standDownTraced(request, `the continuation turn did not land: ${messageOf(error)}`, turns);
    }
    turns += 1;
  }
}

function nextContinuationOrder(request: ContinuationRequest): string | undefined {
  const envelope = hostEnvelope(callerFor(request.directory), {
    sessionId: request.sessionID,
    cwd: request.directory,
  });
  const run = runGate(["autocontinue"], envelope);
  for (const event of run.events) {
    logEvent(event);
  }
  return run.verdict.kind === "push" ? run.verdict.reason : undefined;
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
