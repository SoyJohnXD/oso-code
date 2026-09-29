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

export const SLICE_MARKS = ["diagnosed", "escalated", "empty-result"] as const;

const MARKER_KINDS = ["arm", ...SLICE_MARKS] as const;

export type Marker = Readonly<{
  kind: (typeof MARKER_KINDS)[number];
  slice: string;
  session: string;
  change: string | null;
  time: string;
}>;

export type VerdictLogEntry = VerdictRecord | Marker;

export type VerdictLog = Readonly<{ entries: readonly VerdictLogEntry[]; skippedLines: number }>;

export type VerdictCapture = Omit<VerdictRecord, "time" | "attempt" | "escalated">;

export type MarkerCapture = Omit<Marker, "time">;

export function verdictsFileFor(stateFile: string): string {
  return path.join(runsDirectoryOf(stateFile), "verdicts.jsonl");
}

export function appendVerdict(verdictsFile: string, capture: VerdictCapture): boolean {
  return appendEntry(verdictsFile, capture.session, () => ({
    time: isoTimestamp(),
    host: capture.host,
    session: capture.session,
    change: capture.change,
    slice: capture.slice,
    attempt: verifierRecordsSinceArm(readVerdicts(verdictsFile).entries, capture.slice).length + 1,
    role: capture.role,
    model: capture.model,
    verdict: capture.verdict,
    verdict_shape: capture.verdict_shape,
    escalated: false,
  }));
}

export function appendMarker(verdictsFile: string, marker: MarkerCapture): boolean {
  return appendEntry(verdictsFile, marker.session, () => ({
    kind: marker.kind,
    slice: marker.slice,
    session: marker.session,
    change: marker.change,
    time: isoTimestamp(),
  }));
}

export function newlyArmedSliceOf(preWriteSlice: string, written: ReadonlyMap<string, string>): string | undefined {
  const slice = written.get("active_slice");
  if (slice === undefined || slice === "none" || slice === preWriteSlice) return undefined;
  return written.get("verify_green") === "false" ? slice : undefined;
}

export function readVerdicts(verdictsFile: string): VerdictLog {
  const lines = (readFileIfPresent(verdictsFile) ?? "").split("\n").filter((line) => line !== "");
  const entries = lines.flatMap((line) => {
    const entry = logEntryOf(line);
    return entry === undefined ? [] : [entry];
  });
  return { entries, skippedLines: lines.length - entries.length };
}

export function verifierRecordsSinceArm(entries: readonly VerdictLogEntry[], slice: string | null): VerdictRecord[] {
  return newestArmingOf(entries, slice).filter(isVerifierRecord);
}

export function newestArmingOf(entries: readonly VerdictLogEntry[], slice: string | null): VerdictLogEntry[] {
  if (slice === null) return [];
  return armingsOf(entries).newestArmingOfSlice.get(slice) ?? [];
}

export function isMarkerOf(kind: Marker["kind"], entry: VerdictLogEntry): entry is Marker {
  return "kind" in entry && entry.kind === kind;
}

export function isVerifierRecord(entry: VerdictLogEntry): entry is VerdictRecord {
  return !("kind" in entry) && entry.role === VERIFIER_ROLE;
}

type Armings = Readonly<{
  everyArming: VerdictLogEntry[][];
  newestArmingOfSlice: ReadonlyMap<string, VerdictLogEntry[]>;
}>;

export function armingsOf(entries: readonly VerdictLogEntry[]): Armings {
  const everyArming: VerdictLogEntry[][] = [];
  const newestArmingOfSlice = new Map<string, VerdictLogEntry[]>();
  for (const entry of entries) {
    if (isMarkerOf("arm", entry)) {
      const arming: VerdictLogEntry[] = [];
      everyArming.push(arming);
      newestArmingOfSlice.set(entry.slice, arming);
      continue;
    }
    if (entry.slice !== null) newestArmingOfSlice.get(entry.slice)?.push(entry);
  }
  return { everyArming, newestArmingOfSlice };
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
  if ("kind" in parsed) return markerOf(parsed);
  return verdictRecordOf(parsed);
}

function markerOf(fields: Record<string, unknown>): Marker | undefined {
  const { slice, session, change, time } = fields;
  const kind = MARKER_KINDS.find((value) => value === fields["kind"]);
  if (kind === undefined || !isText(slice) || !isText(session) || !isTextOrNull(change) || !isText(time)) return undefined;
  return { kind, slice, session, change, time };
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
