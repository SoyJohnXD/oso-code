import { rmSync, statSync } from "node:fs";
import path from "node:path";
import {
  causeOf,
  entriesOfDirectory,
  isErrnoException,
  isRegularNonSymlinkFile,
  readStateFile,
  repositoryIdFor,
  runsDirectoryOf,
  stateFileFor,
  stateRootDirectory,
} from "../state/store.ts";
import { sanitizeSession } from "./preflight.ts";

const DELEGATION_WAIT_CEILING_MINUTES = 45;
const DELEGATION_WAIT_CEILING_SECONDS = DELEGATION_WAIT_CEILING_MINUTES * 60;

const DELEGATION_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DISARMED_LABEL = "none";
const COUNT_PATTERN = /^[0-9]+$/;
const MARK_SUFFIX = ".waiting";

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

type StandingWaitMark = Readonly<{ markedAtEpochSeconds: number }>;

export function readWaitMark(markFile: string): StandingWaitMark | undefined {
  const stats = statSync(markFile, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) return undefined;
  const read = readStateFile(markFile);
  if (read.kind !== "ok") return undefined;
  return { markedAtEpochSeconds: Math.floor(stats.mtimeMs / 1000) };
}

export function removeWaitMark(markFile: string): string | undefined {
  try {
    rmSync(markFile, { force: true });
    return undefined;
  } catch (cause) {
    return noDirectoryHoldsTheMark(cause) ? undefined : causeOf(cause);
  }
}

export function removeLegacyWaitMarks(stateFile: string): void {
  const runs = runsDirectoryOf(stateFile);
  for (const mark of entriesOfDirectory(runs).filter((name) => name.endsWith(MARK_SUFFIX))) {
    const markFile = path.join(runs, mark);
    if (isRegularNonSymlinkFile(markFile)) rmSync(markFile, { force: true });
  }
}

function noDirectoryHoldsTheMark(cause: unknown): boolean {
  return isErrnoException(cause) && cause.code === "ENOTDIR";
}
