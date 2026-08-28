import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readStateFile, repositoryIdFor, stateFileFor, stateRootDirectory } from "../state/store.ts";
import { sanitizeSession, stateValue } from "./preflight.ts";

export const DELEGATION_WAIT_CEILING_MINUTES = 45;
const DELEGATION_WAIT_CEILING_SECONDS = DELEGATION_WAIT_CEILING_MINUTES * 60;
export const DELEGATION_WAIT_RENEWALS_CAP = 3;

const DELEGATION_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DISARMED_LABEL = "none";
const COUNT_PATTERN = /^[0-9]+$/;
const MARK_SUFFIX = ".waiting";
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

export const EXPIRED_DELEGATION_CLAUSE =
  `A delegation is marked in flight and that mark is older than ${DELEGATION_WAIT_CEILING_MINUTES} minutes, ` +
  "so treat it as lost unless its completion notification still arrives.";

export function waitExpired(now: number, markedAtEpochSeconds: number): boolean {
  return now - markedAtEpochSeconds >= DELEGATION_WAIT_CEILING_SECONDS;
}

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isDelegationLabel(label: string): boolean {
  return label !== DISARMED_LABEL && DELEGATION_LABEL_PATTERN.test(label);
}

export function isCount(value: string): boolean {
  return COUNT_PATTERN.test(value);
}

export function waitMarkFileFor(cwd: string, runSession: string): string {
  const repository = repositoryIdFor(stateFileFor(cwd));
  return path.join(stateRootDirectory(), "runs", repository, `${sanitizeSession(runSession)}${MARK_SUFFIX}`);
}

export type WaitMark = Readonly<{
  run: string;
  session: string;
  journalBytes: number;
  renewals: number;
}>;

export type StandingWaitMark = WaitMark & Readonly<{ markedAtEpochSeconds: number }>;

export function readWaitMark(markFile: string): StandingWaitMark | undefined {
  const stats = statSync(markFile, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) return undefined;
  const read = readStateFile(markFile);
  if (read.kind !== "ok") return undefined;
  return {
    run: stateValue(read.content, "run"),
    session: stateValue(read.content, "session"),
    journalBytes: countIn(read.content, "journal_bytes"),
    renewals: countIn(read.content, "renewals"),
    markedAtEpochSeconds: Math.floor(stats.mtimeMs / 1000),
  };
}

export function writeWaitMark(markFile: string, mark: WaitMark): void {
  mkdirSync(path.dirname(markFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  writeFileSync(markFile, serializedMark(mark), { mode: OWNER_ONLY_FILE });
}

export function adoptMarkIntoRun(markFile: string, mark: WaitMark, run: string): void {
  const clock = statSync(markFile).mtime;
  writeWaitMark(markFile, { ...mark, run });
  utimesSync(markFile, clock, clock);
}

export function removeWaitMark(markFile: string): void {
  try {
    rmSync(markFile, { force: true });
  } catch {
    return;
  }
}

function serializedMark(mark: WaitMark): string {
  return (
    `run=${mark.run}\nsession=${mark.session}\n` + `journal_bytes=${mark.journalBytes}\nrenewals=${mark.renewals}\n`
  );
}

function countIn(content: string, key: string): number {
  const value = stateValue(content, key);
  return isCount(value) ? Number(value) : 0;
}
