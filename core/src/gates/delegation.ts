import { rmSync } from "node:fs";
import path from "node:path";
import {
  causeOf,
  entriesOfDirectory,
  isErrnoException,
  isRegularNonSymlinkFile,
  runsDirectoryOf,
  stateFileFor,
} from "../state/store.ts";
import { sanitizeSession } from "./preflight.ts";

const COUNT_PATTERN = /^[0-9]+$/;
const MARK_SUFFIX = ".waiting";

export function isCount(value: string): boolean {
  return COUNT_PATTERN.test(value);
}

export function waitMarkFileFor(cwd: string, runSession: string): string {
  return path.join(runsDirectoryOf(stateFileFor(cwd)), `${sanitizeSession(runSession)}${MARK_SUFFIX}`);
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
