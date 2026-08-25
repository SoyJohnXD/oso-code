import { spawnSync } from "node:child_process";

export type TraceSeverity = "enforcement" | "advisory";
export type TraceSinkName = "state" | "log" | "toast";

export interface TraceInput {
  origin: string;
  detail: string;
  severity?: TraceSeverity;
  sessionID?: string;
  client?: unknown;
}

export interface TraceSinkResult {
  sink: TraceSinkName;
  ok: boolean;
}

export const TRACE_SINK_ORDER: readonly TraceSinkName[] = ["state", "log", "toast"];

const STATE_TRACE_TIMEOUT_MS = 5_000;

export function recordTrace(input: TraceInput): TraceSinkResult[] {
  const severity = input.severity ?? "advisory";
  const results: TraceSinkResult[] = [];
  let stateSinkBroken = false;
  for (const sink of TRACE_SINK_ORDER) {
    if (sink === "state") {
      const ok = tryStateSink(input.origin, input.detail, input.sessionID);
      stateSinkBroken = !ok;
      results.push({ sink, ok });
      continue;
    }
    if (sink === "log") {
      results.push({ sink, ok: tryLogSink(input.origin, input.detail, severity, stateSinkBroken) });
      continue;
    }
    results.push({ sink, ok: tryToastSink(input.origin, input.detail, severity, input.client) });
  }
  return results;
}

function tryStateSink(origin: string, detail: string, sessionID: string | undefined): boolean {
  if (sessionID === undefined || sessionID === "") {
    return false;
  }
  try {
    const bin = process.env.OSO_STATE_BIN ?? "oso-state";
    const result = spawnSync(bin, ["--session", sessionID, "event", origin, detail], {
      encoding: "utf8",
      timeout: STATE_TRACE_TIMEOUT_MS,
    });
    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

function tryLogSink(origin: string, detail: string, severity: TraceSeverity, stateSinkBroken: boolean): boolean {
  try {
    const stateNote = stateSinkBroken ? " (state sink also failed)" : "";
    console.error(`oso-code: [${severity}] ${origin}: ${detail}${stateNote}`);
    return true;
  } catch {
    return false;
  }
}

function tryToastSink(origin: string, detail: string, severity: TraceSeverity, client: unknown): boolean {
  const showToast = toastFnOf(client);
  if (showToast === undefined) {
    return false;
  }
  try {
    const outcome = showToast({
      body: {
        title: "oso-code",
        message: `${origin}: ${detail}`,
        variant: severity === "enforcement" ? "error" : "warning",
      },
    });
    settleQuietly(outcome);
    return true;
  } catch {
    return false;
  }
}

function settleQuietly(outcome: unknown): void {
  if (typeof outcome !== "object" || outcome === null) {
    return;
  }
  const thenable = (outcome as { catch?: unknown }).catch;
  if (typeof thenable === "function") {
    (thenable as (onRejected: (reason: unknown) => void) => unknown).call(outcome, () => {});
  }
}

function toastFnOf(client: unknown): ((input: unknown) => unknown) | undefined {
  if (typeof client !== "object" || client === null) {
    return undefined;
  }
  const tui = (client as { tui?: unknown }).tui;
  if (typeof tui !== "object" || tui === null) {
    return undefined;
  }
  const showToast = (tui as { showToast?: unknown }).showToast;
  return typeof showToast === "function" ? (showToast as (input: unknown) => unknown) : undefined;
}
