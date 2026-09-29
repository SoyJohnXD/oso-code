import { rmSync } from "node:fs";
import path from "node:path";
import { entriesOfDirectory, isRegularNonSymlinkFile, runsDirectoryOf } from "../state/store.ts";

const COUNT_PATTERN = /^[0-9]+$/;
const MARK_SUFFIX = ".waiting";

export function isCount(value: string): boolean {
  return COUNT_PATTERN.test(value);
}

export function removeLegacyWaitMarks(stateFile: string): void {
  const runs = runsDirectoryOf(stateFile);
  for (const mark of entriesOfDirectory(runs).filter((name) => name.endsWith(MARK_SUFFIX))) {
    const markFile = path.join(runs, mark);
    if (isRegularNonSymlinkFile(markFile)) rmSync(markFile, { force: true });
  }
}
