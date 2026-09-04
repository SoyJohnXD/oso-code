import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const TEST_TREE_PREFIX = "core/test/";
const SUPPORT_TREE_PREFIX = "core/test/support/";
const RAW_POINTER_PATTERN = /= "\$\{path\./;
const MINIMUM_SCANNED_FILES = 70;

type RawPointerSite = Readonly<{ file: string; line: number; text: string }>;

function rawPointerSitesIn({ file, text }: TrackedFileText): RawPointerSite[] {
  return text
    .split("\n")
    .map((lineText, index) => ({ file, line: index + 1, text: lineText.trim() }))
    .filter((site) => RAW_POINTER_PATTERN.test(site.text));
}

function meetsScannedFloor(scannedCount: number): boolean {
  return scannedCount >= MINIMUM_SCANNED_FILES;
}

const scanned = trackedRepositoryFiles()
  .filter((file) => file.startsWith(TEST_TREE_PREFIX) && file.endsWith(".ts") && !file.startsWith(SUPPORT_TREE_PREFIX))
  .map(readTrackedText);
const sites = scanned.flatMap(rawPointerSitesIn);

provedSomething(
  `${scanned.length} tracked *.ts file(s) under ${TEST_TREE_PREFIX} outside ${SUPPORT_TREE_PREFIX} were scanned for a native path interpolated raw into a quoted TOML value`,
  meetsScannedFloor(scanned.length),
  `only ${scanned.length} file(s) were scanned, under the ${MINIMUM_SCANNED_FILES} this tree holds, so this check ` +
    "looked at a tree it did not recognise rather than finding nothing",
);

describe(
  "a TOML pointer value built from a native path is written through tomlQuote, never interpolated raw between quotes — " +
    "the emitter defect this round fixed; this gate reaches only the `= \"${path.` shape and no further",
  () => {
    test(`no tracked *.ts file under ${TEST_TREE_PREFIX} outside ${SUPPORT_TREE_PREFIX} interpolates a native path raw into a quoted TOML value`, () => {
      assert.deepEqual(sites, [], sites.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });
  },
);

describe("meetsScannedFloor, read against an empty walk", () => {
  test("an empty walk — the shape a broken scan would produce — fails the floor rather than passing it vacuously", () => {
    assert.equal(meetsScannedFloor(0), false);
  });
});
