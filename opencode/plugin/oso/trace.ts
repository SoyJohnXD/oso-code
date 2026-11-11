import { logEvent } from "@oso-code/core";

export type TraceSeverity = "enforcement" | "advisory";
export type TraceSinkName = "state" | "log";

export interface TraceInput {
  origin: string;
  detail: string;
  severity?: TraceSeverity;
  sessionID?: string;
}

export interface TraceSinkResult {
  sink: TraceSinkName;
  ok: boolean;
}

export const TRACE_SINK_ORDER: readonly TraceSinkName[] = ["state", "log"];

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
    results.push({ sink, ok: tryLogSink(input.origin, input.detail, severity, stateSinkBroken) });
  }
  return results;
}

function tryStateSink(origin: string, detail: string, sessionID: string | undefined): boolean {
  if (sessionID === undefined || sessionID === "") {
    return false;
  }
  try {
    return logEvent({ event: origin, session: sessionID, command: detail });
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
