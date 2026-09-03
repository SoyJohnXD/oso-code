import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";
import { homeDirectoryFrom } from "../../src/state/store.ts";

const MINIMUM_TRACKED_FILES = 1000;
const MINIMUM_TRACKED_FILES_DERIVATION =
  "git ls-files --cached --others --exclude-standard, repo-wide, measured at C5-S5b-2: 1,199";

function firstLineCarrying(text: string, needle: string): number | undefined {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  return index === -1 ? undefined : index + 1;
}

const trackedFiles = trackedRepositoryFiles();
function homeDirectoryOrUnset(): string | undefined {
  try {
    return homeDirectoryFrom(process.platform, process.env);
  } catch {
    return undefined;
  }
}

const home = homeDirectoryOrUnset();
const homeNamesADirectory = home !== undefined && home !== "" && home !== "/";

provedSomething(
  `${trackedFiles.length} tracked file(s) were read for the absolute home directory of whoever runs this check`,
  trackedFiles.length >= MINIMUM_TRACKED_FILES,
  `only ${trackedFiles.length} tracked file(s) were found, under the ${MINIMUM_TRACKED_FILES}-file floor ` +
    `(${MINIMUM_TRACKED_FILES_DERIVATION})`,
);

provedSomething(
  "this run's home directory resolves to a real path, neither empty nor the filesystem root, so the scan for it is not vacuous",
  homeNamesADirectory,
  `the home directory resolved to ${JSON.stringify(home)} — USERPROFILE on win32 and HOME elsewhere, by core/src/state/store.ts's own resolver — which this rule's bash original treats as no home directory to look for, so the scan would search for nothing`,
);

const carriers = homeNamesADirectory
  ? trackedFiles.flatMap((file) => {
      const line = firstLineCarrying(readTrackedText(file).text, home as string);
      return line === undefined ? [] : [`${file}:${line}`];
    })
  : [];

describe(
  "no tracked or otherwise unignored file carries the absolute home directory of whoever runs this check, so a " +
    "publish never ships one machine's layout and whatever its path names about its owner",
  () => {
    test("no scanned file's content includes the literal HOME path", () => {
      assert.deepEqual(carriers, [], carriers.join("\n"));
    });
  },
);
