import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { runStateCommand } from "./plan-state.ts";

export const PUSHES_WITHOUT_PROGRESS_CAP = 3;
export const DELEGATION_WAIT_CEILING_MINUTES = 45;
export const DELEGATION_WAIT_RENEWALS_CAP = 3;

const DELEGATION_WAIT_CEILING_SECONDS = DELEGATION_WAIT_CEILING_MINUTES * 60;
const DELEGATION_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const NO_DELEGATION_LABEL = "none";
const RUNNING_MARKER = "running";

export const CONTINUATION_ORDER = "oso-code: this run is unattended and still in flight, and this turn ended"
  + " without parking or closing it. Continue it: re-read the position from the change's oso/index NEXT: line"
  + " and from active_slice in oso-state, append every milestone to the run journal with oso-state journal,"
  + " and park the run per the flow's own rules if a decision needs the operator. A delegation on this host"
  + " returns inside the turn that launched it, so a turn that has ended left none in flight: read the report"
  + " the launch itself returned rather than waiting for a notification this host never sends.";

export const EXPIRED_DELEGATION_ORDER = `${CONTINUATION_ORDER} A delegation is marked in flight and that mark`
  + ` is older than ${DELEGATION_WAIT_CEILING_MINUTES} minutes with no milestone journaled since, so treat it`
  + " as lost: disarm it with oso-state set auto_wait=none before continuing.";

export const CAP_MILESTONE = `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} posted turns that`
  + " moved the journal nowhere — this host posts no further turn until a milestone lands";

export const EXPIRED_DELEGATION_CAP_MILESTONE = `auto-continue: cap reached after`
  + ` ${PUSHES_WITHOUT_PROGRESS_CAP} posted turns with a delegation marked in flight past`
  + ` ${DELEGATION_WAIT_CEILING_MINUTES} minutes — this host posts no further turn until a milestone lands`;

export interface RunSighting {
  label: string;
  session: string;
  journalBytes: number;
  renewals: number;
}

export interface StandingSighting {
  mark: RunSighting;
  ageSeconds: number;
}

export interface PushTally {
  pushes: number;
  journalBytes: number;
}

export type PushTallyReading =
  | { kind: "absent" }
  | { kind: "counted"; tally: PushTally }
  | { kind: "unusable"; cause: string };

export interface UnattendedRunReading {
  sessionID: string;
  journalFile: string;
  unattendedRunMarker: string;
  delegationLabel: string;
  journalBytes: number;
  tally: PushTallyReading;
  sighting: StandingSighting | null;
}

export type SightingUpdate =
  | { kind: "record"; mark: RunSighting }
  | { kind: "leave" }
  | { kind: "clear" };

export type ContinuationStep =
  | { kind: "push"; order: string; tally: PushTally }
  | { kind: "cap-reached"; milestone: string; tally: PushTally }
  | { kind: "cap-held"; milestone: string; tally: PushTally }
  | { kind: "hold"; label: string }
  | { kind: "stop"; reason: string };

export interface ContinuationDecision {
  sighting: SightingUpdate;
  step: ContinuationStep;
}

export interface RunLookup {
  directory: string;
  owner: string;
  sessionID: string;
}

export function decideContinuation(reading: UnattendedRunReading): ContinuationDecision {
  if (reading.unattendedRunMarker !== RUNNING_MARKER) {
    return { sighting: { kind: "clear" }, step: { kind: "stop", reason: markerReadsNothing(reading) } };
  }
  if (!isDelegationLabel(reading.delegationLabel)) {
    return { sighting: { kind: "clear" }, step: pushOrCap(reading, CONTINUATION_ORDER, CAP_MILESTONE) };
  }
  const held = { kind: "hold", label: reading.delegationLabel } as const;
  const standing = reading.sighting;
  if (standing === null || !namesTheSameDelegation(standing.mark, reading)) {
    return { sighting: { kind: "record", mark: firstSightingOf(reading) }, step: held };
  }
  if (standing.ageSeconds < DELEGATION_WAIT_CEILING_SECONDS) {
    return { sighting: { kind: "leave" }, step: held };
  }
  const renewed = renewalFor(standing.mark, reading);
  if (renewed !== null) {
    return { sighting: { kind: "record", mark: renewed }, step: held };
  }
  return {
    sighting: { kind: "leave" },
    step: pushOrCap(reading, EXPIRED_DELEGATION_ORDER, EXPIRED_DELEGATION_CAP_MILESTONE),
  };
}

function firstSightingOf(reading: UnattendedRunReading): RunSighting {
  return {
    label: reading.delegationLabel,
    session: reading.sessionID,
    journalBytes: reading.journalBytes,
    renewals: 0,
  };
}

function renewalFor(standing: RunSighting, reading: UnattendedRunReading): RunSighting | null {
  const runMovedSinceTheSighting = reading.journalBytes > standing.journalBytes;
  if (!runMovedSinceTheSighting || standing.renewals >= DELEGATION_WAIT_RENEWALS_CAP) {
    return null;
  }
  return { ...standing, journalBytes: reading.journalBytes, renewals: standing.renewals + 1 };
}

function markerReadsNothing(reading: UnattendedRunReading): string {
  const marker = reading.unattendedRunMarker;
  return `this repository's unattended run marker reads ${marker === "" ? "nothing at all" : `"${marker}"`}`;
}

function pushOrCap(reading: UnattendedRunReading, order: string, milestone: string): ContinuationStep {
  if (reading.tally.kind === "unusable") {
    return { kind: "stop", reason: reading.tally.cause };
  }
  const pushes = pushesWithoutProgress(reading) + 1;
  const tally: PushTally = { pushes, journalBytes: reading.journalBytes };
  if (pushes === PUSHES_WITHOUT_PROGRESS_CAP + 1) {
    return { kind: "cap-reached", milestone, tally };
  }
  if (pushes > PUSHES_WITHOUT_PROGRESS_CAP) {
    return { kind: "cap-held", milestone, tally };
  }
  return { kind: "push", order, tally };
}

function pushesWithoutProgress(reading: UnattendedRunReading): number {
  const read = reading.tally;
  if (read.kind !== "counted") {
    return 0;
  }
  return reading.journalBytes > read.tally.journalBytes ? 0 : read.tally.pushes;
}

function namesTheSameDelegation(standing: RunSighting, reading: UnattendedRunReading): boolean {
  return standing.label === reading.delegationLabel && standing.session === reading.sessionID;
}

function isDelegationLabel(label: string): boolean {
  return label !== NO_DELEGATION_LABEL && DELEGATION_LABEL_PATTERN.test(label);
}

export function readUnattendedRun(lookup: RunLookup): UnattendedRunReading {
  const state = stateRecords(lookup);
  const journalFile = runStateCommand(lookup.directory, lookup.owner, ["journal", "--path"]).trim();
  return {
    sessionID: lookup.sessionID,
    journalFile,
    unattendedRunMarker: unattendedRunMarkerOf(state, lookup.owner),
    delegationLabel: state.get("auto_wait") ?? "",
    journalBytes: byteCountOf(journalFile),
    tally: readTally(tallyPath(journalFile)),
    sighting: readSighting(sightingPath(journalFile)),
  };
}

function unattendedRunMarkerOf(state: Map<string, string>, owner: string): string {
  if (state.get("session") !== owner) {
    return "";
  }
  return state.get("auto") ?? "";
}

export function applySighting(journalFile: string, update: SightingUpdate): void {
  if (update.kind === "leave") {
    return;
  }
  const path = sightingPath(journalFile);
  if (update.kind === "clear") {
    rmSync(path, { force: true });
    return;
  }
  writeRecords(path, [
    `label=${update.mark.label}`,
    `session=${update.mark.session}`,
    `journal_bytes=${update.mark.journalBytes}`,
    `renewals=${update.mark.renewals}`,
  ]);
}

export function recordContinuationStep(lookup: RunLookup, journalFile: string, step: ContinuationStep): void {
  if (step.kind === "hold" || step.kind === "stop") {
    return;
  }
  if (step.kind === "cap-reached") {
    runStateCommand(lookup.directory, lookup.owner, ["journal", step.milestone]);
    rememberPush(journalFile, { pushes: step.tally.pushes, journalBytes: byteCountOf(journalFile) });
    return;
  }
  rememberPush(journalFile, step.tally);
}

function rememberPush(journalFile: string, tally: PushTally): void {
  writeRecords(tallyPath(journalFile), [`pushes=${tally.pushes}`, `journal_bytes=${tally.journalBytes}`]);
}

const NO_STATE_PREFIX = "no state at ";

function stateRecords(lookup: RunLookup): Map<string, string> {
  const shown = runStateCommand(lookup.directory, lookup.owner, ["show"]);
  return shown.startsWith(NO_STATE_PREFIX) ? new Map() : parseRecords(shown);
}

function sightingPath(journalFile: string): string {
  return runSidecar(journalFile, "waiting");
}

function tallyPath(journalFile: string): string {
  return runSidecar(journalFile, "pushes");
}

function runSidecar(journalFile: string, suffix: string): string {
  const stem = journalFile.endsWith(".log") ? journalFile.slice(0, -".log".length) : journalFile;
  return `${stem}.${suffix}`;
}

function readSighting(path: string): StandingSighting | null {
  const records = readRecords(path);
  if (records === null) {
    return null;
  }
  const label = records.get("label");
  const session = records.get("session");
  if (label === undefined || session === undefined) {
    return null;
  }
  const ageSeconds = secondsSinceModified(path);
  if (ageSeconds === null) {
    return null;
  }
  const journalBytes = countOf(records.get("journal_bytes")) ?? 0;
  const renewals = countOf(records.get("renewals")) ?? 0;
  return { mark: { label, session, journalBytes, renewals }, ageSeconds };
}

function readTally(path: string): PushTallyReading {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unusable", cause: "the push tally is not a readable file" };
  }
  const records = parseRecords(text);
  const pushes = countOf(records.get("pushes"));
  if (pushes === null) {
    return { kind: "unusable", cause: `the push tally holds no count of pushes: ${records.get("pushes") ?? ""}` };
  }
  const journalBytes = countOf(records.get("journal_bytes"));
  if (journalBytes === null) {
    return {
      kind: "unusable",
      cause: `the push tally holds no count of journal bytes: ${records.get("journal_bytes") ?? ""}`,
    };
  }
  return { kind: "counted", tally: { pushes, journalBytes } };
}

function countOf(value: string | undefined): number | null {
  return value !== undefined && /^[0-9]+$/.test(value) ? Number(value) : null;
}

function byteCountOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function secondsSinceModified(path: string): number | null {
  try {
    return Math.max(0, Math.floor((Date.now() - statSync(path).mtimeMs) / 1000));
  } catch {
    return null;
  }
}

function readRecords(path: string): Map<string, string> | null {
  try {
    return parseRecords(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const PRIVATE_TO_THIS_USER = 0o600;

function writeRecords(path: string, pairs: readonly string[]): void {
  writeFileSync(path, `${pairs.join("\n")}\n`, { mode: PRIVATE_TO_THIS_USER });
}

function parseRecords(text: string): Map<string, string> {
  const records = new Map<string, string>();
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      records.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return records;
}
