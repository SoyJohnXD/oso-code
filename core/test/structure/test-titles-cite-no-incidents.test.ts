import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const TEST_FILE = /^(core\/test|opencode\/plugin)\/.*\.test\.(ts|mts|js|mjs)$/;
const TITLE_OPENING = /^\s*(?:test|it|describe)(?:\.\w+)?\(/;
const TITLE_CLOSING = /,\s*(?:async\s*)?(?:\(|function\b|\{)/;
const TITLE_WINDOW_LINES = 8;
const INCIDENT_ID = /\bADR-\d{4}\b|\b[CDFGS]\d+(?:-[A-Z]?\d+)+(?:\([a-z]\))?(?![\w-])|\b[CDFGS]\d{1,2}\b|\bported from/;

type TitleHit = Readonly<{ file: string; line: number; title: string }>;

function titleStartingAt(lines: readonly string[], index: number): string {
  const window = lines.slice(index, index + TITLE_WINDOW_LINES).join("\n");
  const closing = window.search(TITLE_CLOSING);
  return closing === -1 ? window : window.slice(0, closing);
}

function incidentTitlesIn({ file, text }: TrackedFileText): TitleHit[] {
  const lines = text.split("\n");
  return lines.flatMap((lineText, index) => {
    if (!TITLE_OPENING.test(lineText)) return [];
    const title = titleStartingAt(lines, index);
    return INCIDENT_ID.test(title) ? [{ file, line: index + 1, title: title.replace(/\s+/g, " ").trim() }] : [];
  });
}

const testFiles = trackedRepositoryFiles().filter((file) => TEST_FILE.test(file));
const hitsFound = testFiles.map(readTrackedText).flatMap(incidentTitlesIn);

provedSomething(
  "a tracked test file under core/test or opencode/plugin was read for a title naming an incident or a decision",
  testFiles.length > 0,
  "no test file was read, so this check looked at a tree it did not recognise rather than finding nothing",
);

describe("a test title says what the code does, never which incident, decision or earlier suite it came from", () => {
  test("no test or describe title carries a decision id, a slice id or a ported-from note", () => {
    assert.deepEqual(
      hitsFound,
      [],
      hitsFound.map((hit) => `${hit.file}:${hit.line}: ${hit.title}`).join("\n"),
    );
  });
});

const PLANTED_TITLES = [
  '  test("a commit while verify is red is refused, see ADR-0087", () => {',
  "  describe(",
  '    "the cap holds " +',
  '    "(C0-D5(a) fixed it)",',
  "    () => {",
  '  test("the gate refuses a commit (ported from the hook regression suite)", () => {',
  '  it("keeps the G4 floor", () => {',
];

const PLANTED_LOOKALIKES = [
  '  test("a commit while verify is red is refused", () => {',
  '  test("hashes the SHA256 of the bundle", () => {',
  '  const note = "ADR-0087 stays in a string that is no title";',
  '  test("reads the title, 3 of them", () => {',
];

function hitsInPlantedFile(lines: readonly string[]): number[] {
  return incidentTitlesIn({ file: "planted.test.ts", text: lines.join("\n") }).map((hit) => hit.line);
}

describe("incidentTitlesIn, read over a planted file this repository does not ship", () => {
  test("flags a decision id, a slice id, a ported-from note and a title that spans several lines", () => {
    assert.deepEqual(hitsInPlantedFile(PLANTED_TITLES), [1, 2, 6, 7]);
  });

  test("passes over a plain title, a hash name, a string that is no title and a bare number", () => {
    assert.deepEqual(hitsInPlantedFile(PLANTED_LOOKALIKES), []);
  });
});
