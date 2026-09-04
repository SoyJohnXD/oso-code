import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const SCANNED_PREFIXES = ["plugin/", "docs/"];
const SCANNED_EXACT_FILES = new Set(["CHANGELOG.md"]);
const PLACEHOLDER_PIN = "impeccable@X";

const FILES_SCANNED_FLOOR = 150;
const FILES_SCANNED_FLOOR_DERIVATION = "git ls-files under plugin/, docs/ plus CHANGELOG.md, measured at C5-S5b: 221";

function isScanned(file: string): boolean {
  return SCANNED_EXACT_FILES.has(file) || SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const scannedFiles = trackedRepositoryFiles().filter(isScanned);

provedSomething(
  `${scannedFiles.length} tracked file(s) under plugin/, docs/ and CHANGELOG.md were scanned for the ` +
    `unresolvable pin placeholder ${PLACEHOLDER_PIN}`,
  scannedFiles.length >= FILES_SCANNED_FLOOR,
  `only ${scannedFiles.length} file(s) were found, under the ${FILES_SCANNED_FLOOR}-file floor (${FILES_SCANNED_FLOOR_DERIVATION})`,
);

const hits = scannedFiles.map(readTrackedText).flatMap(({ file, text }) =>
  text
    .split("\n")
    .flatMap((line, index) => (line.includes(PLACEHOLDER_PIN) ? [`${file}:${index + 1} carries the unresolvable pin placeholder ${PLACEHOLDER_PIN}`] : [])),
);

describe("the impeccable detect pin, resolved at runtime, never regresses to its unresolvable placeholder", () => {
  test(`no scanned file carries the literal ${PLACEHOLDER_PIN}`, () => {
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});
