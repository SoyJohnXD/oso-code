import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const CERTIFY_PREFIX = "core/test/certify/";
const EXEMPT_FILES = new Set(["core/test/certify/support/not-run.ts", "core/test/certify/support/certify-guard.ts"]);
const MINIMUM_SCANNED_FILES = 5;

const BARE_T_SKIP_PATTERN = /\bt\.skip\(/;
const BARE_SKIP_OPTION_PATTERN = /(?<![.\w])skip:/;

type BareSkipSite = Readonly<{ file: string; line: number; text: string }>;

function bareSkipSitesIn({ file, text }: TrackedFileText): BareSkipSite[] {
  return text
    .split("\n")
    .map((lineText, index) => ({ file, line: index + 1, text: lineText.trim() }))
    .filter((site) => BARE_T_SKIP_PATTERN.test(site.text) || BARE_SKIP_OPTION_PATTERN.test(site.text));
}

function isScanned(file: string): boolean {
  return file.startsWith(CERTIFY_PREFIX) && file.endsWith(".ts") && !EXEMPT_FILES.has(file);
}

function meetsScannedFloor(scannedCount: number): boolean {
  return scannedCount >= MINIMUM_SCANNED_FILES;
}

function plantedCertifyFile(lines: readonly string[]): TrackedFileText {
  const directory = mkdtempSync(path.join(tmpdir(), "oso-planted-certify-skip-"));
  const file = path.join(directory, "planted.test.ts");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return { file, text: readFileSync(file, "utf8") };
}

function disposePlanted(planted: TrackedFileText): void {
  rmSync(path.dirname(planted.file), { recursive: true, force: true });
}

const scannedFiles = trackedRepositoryFiles().filter(isScanned);
const sitesFound = scannedFiles.map(readTrackedText).flatMap(bareSkipSitesIn);

provedSomething(
  `${scannedFiles.length} tracked *.ts file(s) under ${CERTIFY_PREFIX} outside the recorder and the OSO_CERTIFY guard were scanned for a bare skip`,
  meetsScannedFloor(scannedFiles.length),
  `only ${scannedFiles.length} file(s) were scanned, under the ${MINIMUM_SCANNED_FILES} this tree holds, so this check ` +
    "looked at a tree it did not recognise rather than finding nothing",
);

describe(
  "a certification row reports a gate it could not drive only through core/test/certify/support/not-run.ts's " +
    "notRun, gated by core/test/certify/support/certify-guard.ts's CERTIFY_GUARD alone — a bare t.skip( or a " +
    "skip: option written anywhere else under core/test/certify is red, in both lanes",
  () => {
    test("no scanned file under core/test/certify writes a bare t.skip( or a skip: option outside the recorder and the guard", () => {
      assert.deepEqual(sitesFound, [], sitesFound.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });
  },
);

describe("bareSkipSitesIn, read over a planted tree this repository does not ship", () => {
  test("flags a bare t.skip( call and a skip: option written outside the guard shape", () => {
    const planted = plantedCertifyFile([
      'import type { TestContext } from "node:test";',
      "export function notRunLookalike(t: TestContext, reason: string): void {",
      "  t.skip(`not-run: ${reason}`);",
      "}",
      'test("a row with its own ad hoc skip", { skip: "because" }, () => {});',
    ]);
    try {
      assert.deepEqual(
        bareSkipSitesIn(planted).map((site) => site.line),
        [3, 5],
      );
    } finally {
      disposePlanted(planted);
    }
  });

  test("passes over a row that reuses the exported CERTIFY_GUARD and notRun by name, writing neither token itself", () => {
    const planted = plantedCertifyFile([
      'import { CERTIFY_GUARD } from "./support/certify-guard.ts";',
      'import { notRun } from "./support/not-run.ts";',
      'test("a row that never writes the tokens itself", CERTIFY_GUARD, (t) => { notRun(t, "reason"); });',
    ]);
    try {
      assert.deepEqual(bareSkipSitesIn(planted), []);
    } finally {
      disposePlanted(planted);
    }
  });

  test("an empty walk — the shape a broken scan would produce — fails meetsScannedFloor rather than passing it vacuously", () => {
    assert.equal(meetsScannedFloor(0), false);
  });
});
