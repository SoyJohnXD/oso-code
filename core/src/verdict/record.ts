import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { HostName } from "../routes/routes.ts";
import {
  causeOf,
  isoTimestamp,
  jsonObjectOf,
  logEvent,
  readFileIfPresent,
  runsDirectoryOf,
  withOwnerOnlyUmask,
} from "../state/store.ts";
import { RECORDED_VERDICTS, type RecordedVerdict, VERDICT_SHAPES, type VerdictShape } from "./grammar.ts";

export const VERIFIER_ROLE = "verifier";

export const TELEMETRY_WRITE_FAILED = "telemetry-write-failed";

export const VERIFY_GREEN_UNRECEIPTED = "verify-green-unreceipted";

export type VerdictRecord = Readonly<{
  time: string;
  host: HostName;
  session: string;
  change: string | null;
  slice: string | null;
  attempt: number;
  role: string;
  model: string | null;
  verdict: RecordedVerdict;
  verdict_shape: VerdictShape;
  escalated: boolean;
}>;

export type ArmMarker = Readonly<{ kind: "arm"; slice: string; session: string; change: string | null; time: string }>;

export type VerdictLogEntry = VerdictRecord | ArmMarker;

export type VerdictLog = Readonly<{ entries: readonly VerdictLogEntry[]; skippedLines: number }>;

export type VerdictCapture = Omit<VerdictRecord, "time" | "attempt">;

export type ArmCapture = Omit<ArmMarker, "kind" | "time">;

export function verdictsFileFor(stateFile: string): string {
  return path.join(runsDirectoryOf(stateFile), "verdicts.jsonl");
}

export function appendVerdict(verdictsFile: string, capture: VerdictCapture): boolean {
  return appendEntry(verdictsFile, capture.session, () => {
    const attempt = verifierRecordsSinceArm(readVerdicts(verdictsFile).entries, capture.slice).length + 1;
    return {
      time: isoTimestamp(),
      host: capture.host,
      session: capture.session,
      change: capture.change,
      slice: capture.slice,
      attempt,
      role: capture.role,
      model: capture.model,
      verdict: capture.verdict,
      verdict_shape: capture.verdict_shape,
      escalated: capture.escalated,
    };
  });
}

export function appendArmMarker(verdictsFile: string, marker: ArmCapture): boolean {
  return appendEntry(verdictsFile, marker.session, () => ({
    kind: "arm",
    slice: marker.slice,
    session: marker.session,
    change: marker.change,
    time: isoTimestamp(),
  }));
}

export function armedSliceOf(written: ReadonlyMap<string, string>): string | undefined {
  const slice = written.get("active_slice");
  return slice !== undefined && slice !== "none" && written.get("verify_green") === "false" ? slice : undefined;
}

export function readVerdicts(verdictsFile: string): VerdictLog {
  const lines = (readFileIfPresent(verdictsFile) ?? "").split("\n").filter((line) => line !== "");
  const entries = lines.flatMap((line) => {
    const entry = logEntryOf(line);
    return entry === undefined ? [] : [entry];
  });
  return { entries, skippedLines: lines.length - entries.length };
}

export function recordsSinceArm(entries: readonly VerdictLogEntry[]): VerdictRecord[] {
  const armedSlices = new Map<string, VerdictRecord[]>();
  for (const entry of entries) {
    if (isArmMarker(entry)) {
      armedSlices.set(entry.slice, []);
      continue;
    }
    if (entry.slice !== null) armedSlices.get(entry.slice)?.push(entry);
  }
  return [...armedSlices.values()].flat();
}

export function verifierRecordsSinceArm(entries: readonly VerdictLogEntry[], slice: string | null): VerdictRecord[] {
  return recordsSinceArm(entries).filter((record) => record.slice === slice && record.role === VERIFIER_ROLE);
}

export function isArmMarker(entry: VerdictLogEntry): entry is ArmMarker {
  return "kind" in entry;
}

function appendEntry(verdictsFile: string, session: string, entryOf: () => VerdictLogEntry): boolean {
  try {
    const line = `${JSON.stringify(entryOf())}\n`;
    withOwnerOnlyUmask(() => {
      mkdirSync(path.dirname(verdictsFile), { recursive: true });
      appendFileSync(verdictsFile, line);
    });
    return true;
  } catch (error) {
    logEvent({ event: TELEMETRY_WRITE_FAILED, session, command: causeOf(error) });
    return false;
  }
}

function logEntryOf(line: string): VerdictLogEntry | undefined {
  const parsed = jsonObjectOf(line);
  if (parsed === undefined) return undefined;
  if (parsed["kind"] === "arm") return armMarkerOf(parsed);
  return verdictRecordOf(parsed);
}

function armMarkerOf(fields: Record<string, unknown>): ArmMarker | undefined {
  const { slice, session, change, time } = fields;
  if (!isText(slice) || !isText(session) || !isTextOrNull(change) || !isText(time)) return undefined;
  return { kind: "arm", slice, session, change, time };
}

function verdictRecordOf(fields: Record<string, unknown>): VerdictRecord | undefined {
  const { time, host, session, change, slice, attempt, role, model, verdict, verdict_shape, escalated } = fields;
  if (!isText(time) || !isText(session) || !isTextOrNull(change) || !isTextOrNull(slice) || !isText(role)) return undefined;
  if (!isHostName(host) || typeof attempt !== "number") return undefined;
  if (!isTextOrNull(model) || typeof escalated !== "boolean") return undefined;
  const recorded = RECORDED_VERDICTS.find((value) => value === verdict);
  const shape = VERDICT_SHAPES.find((value) => value === verdict_shape);
  if (recorded === undefined || shape === undefined) return undefined;
  return {
    time,
    host,
    session,
    change,
    slice,
    attempt,
    role,
    model,
    verdict: recorded,
    verdict_shape: shape,
    escalated,
  };
}

const HOST_NAMES: Readonly<Record<HostName, true>> = { claude: true, opencode: true };

function isHostName(value: unknown): value is HostName {
  return isText(value) && Object.hasOwn(HOST_NAMES, value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
