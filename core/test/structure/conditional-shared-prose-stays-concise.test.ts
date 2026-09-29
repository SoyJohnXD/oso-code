import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wordCountOf } from "../support/prose-sentences.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;

const CONDITIONAL_SHARED_FILES = [
  "plugin/skills/_shared/unattended.md",
  "plugin/skills/_shared/parallel.md",
  "plugin/skills/_shared/front-surface.md",
];

const COMBINED_WORD_CEILING = 6000;
const COMBINED_WORD_CEILING_DERIVATION =
  "the three conditional shared files measured 7,117 words combined at b33d019 (2,472 + 2,646 + 1,999); the ledger's concision " +
  "decision sets the target at 6,000, a cut of about 16 percent that drops rationale and restated justifications";

function combinedWords(read: ReadFile): number {
  return CONDITIONAL_SHARED_FILES.reduce((sum, file) => sum + wordCountOf(read(file)), 0);
}

function emptyFiles(read: ReadFile): string[] {
  return CONDITIONAL_SHARED_FILES.filter((file) => wordCountOf(read(file)) === 0);
}

const readFromTree: ReadFile = (file) => readTrackedText(file).text;

const perFile = CONDITIONAL_SHARED_FILES.map((file) => `${file}=${wordCountOf(readFromTree(file))}`).join(", ");

provedSomething(
  `the checker measured all ${CONDITIONAL_SHARED_FILES.length} conditional shared files`,
  emptyFiles(readFromTree).length === 0 && combinedWords(readFromTree) > 0,
  `measured only: ${perFile}`,
);

describe("the conditional shared files stay concise", () => {
  test(`the three files total ${combinedWords(readFromTree)} words, within ${COMBINED_WORD_CEILING} (${COMBINED_WORD_CEILING_DERIVATION})`, () => {
    const total = combinedWords(readFromTree);
    assert.ok(total <= COMBINED_WORD_CEILING, `the three files total ${total} words, over ${COMBINED_WORD_CEILING}: ${perFile}`);
  });

  test("each file still exists and is non-empty", () => {
    assert.deepEqual(emptyFiles(readFromTree), []);
  });
});

describe("the checker reports a planted regression", () => {
  test("an in-memory text over budget is reported", () => {
    const padding = "padding ".repeat(COMBINED_WORD_CEILING);
    const mutated: ReadFile = (file) => (file === CONDITIONAL_SHARED_FILES[0] ? `${readFromTree(file)}\n${padding}` : readFromTree(file));
    assert.ok(combinedWords(mutated) > COMBINED_WORD_CEILING);
  });

  test("an emptied file is reported", () => {
    const mutated: ReadFile = (file) => (file === CONDITIONAL_SHARED_FILES[1] ? "" : readFromTree(file));
    assert.deepEqual(emptyFiles(mutated), [CONDITIONAL_SHARED_FILES[1]]);
  });
});
