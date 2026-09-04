import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_STUBS, flowBody, skillFlowPath, skillOutputPath } from "../../src/prose/render.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const SENTENCE_CAP = 60;
const HEADING_LINE = /^#{1,6}\s/;
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+\.)\s+/;
const TABLE_LINE = /^\s*\|/;
const SENTENCE_END = /[.!?](?:\*\*|`|\)|")*(?=\s|$)/g;

const SHARED_FLOW_FILES = ["plugin/skills/_shared/unattended.md", "plugin/skills/_shared/parallel.md"];

const boundFiles = [
  ...SKILL_STUBS.map((stub) => skillFlowPath(stub)),
  ...SHARED_FLOW_FILES,
  ...SKILL_STUBS.map((stub) => skillOutputPath(stub, "codex")),
  ...SKILL_STUBS.map((stub) => skillOutputPath(stub, "opencode")),
];

const FILES_FLOOR = 29;
const FILES_FLOOR_DERIVATION =
  "the 9 plugin/skills/<skill>/SKILL.md flows, the 2 shared bodies (_shared/unattended.md, _shared/parallel.md), " +
  "and the 18 codex/opencode rendered wrappers that inherit each flow verbatim — Decision 62's file set";

const SENTENCES_FLOOR = 2000;
const SENTENCES_FLOOR_DERIVATION =
  "well under the 2,895 sentences this walk counts across the 29 bound files at this writing (2,718 from " +
  "paragraphs and bullets plus the 177 the 117 table lines contribute as runs of their own), so a later, " +
  "legitimate prose edit never has to chase this number — only a walk that segments nothing should fail it";

function runsIn(text: string): string[] {
  const runs: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) runs.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    if (HEADING_LINE.test(line)) {
      flushParagraph();
      continue;
    }
    if (TABLE_LINE.test(line)) {
      flushParagraph();
      runs.push(line.trim());
      continue;
    }
    const listMarker = line.match(LIST_ITEM_LINE);
    if (listMarker !== null) {
      flushParagraph();
      runs.push(line.slice(listMarker[0].length).trim());
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return runs;
}

function sentencesIn(run: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of run.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    sentences.push(run.slice(start, end).trim());
    start = end;
  }
  const remainder = run.slice(start).trim();
  if (remainder !== "") sentences.push(remainder);
  return sentences;
}

function wordCountOf(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => token !== "").length;
}

type SentenceWordCount = Readonly<{ file: string; words: number; sentence: string }>;

function sentenceWordCountsIn(file: string, text: string): SentenceWordCount[] {
  return runsIn(flowBody(text)).flatMap((run) =>
    sentencesIn(run).map((sentence) => ({ file, words: wordCountOf(sentence), sentence })),
  );
}

const boundSentenceCounts = boundFiles.flatMap((file) => sentenceWordCountsIn(file, readTrackedText(file).text));
const oversized = boundSentenceCounts.filter((item) => item.words > SENTENCE_CAP);

provedSomething(
  `${boundFiles.length} file(s) bound by Decision 62's sentence cap were scanned`,
  boundFiles.length >= FILES_FLOOR,
  `only ${boundFiles.length} file(s) were found, under the ${FILES_FLOOR}-file floor (${FILES_FLOOR_DERIVATION})`,
);

provedSomething(
  `${boundSentenceCounts.length} sentence(s) were segmented across those files`,
  boundSentenceCounts.length >= SENTENCES_FLOOR,
  `only ${boundSentenceCounts.length} sentence(s) were segmented, under the ${SENTENCES_FLOOR}-sentence floor ` +
    `(${SENTENCES_FLOOR_DERIVATION})`,
);

describe(
  "no sentence bound by Decision 62 — a flow, its two shared bodies, or their rendered wrappers — runs past 60 " +
    "words; a bullet's leading marker is syntax stripped before the count, exactly as a heading's `#` is, and is " +
    "never itself counted as a word; a markdown table row is a run of its own, never joined to the lines around " +
    "it, so a table's collapsed word count never misfires against this cap",
  () => {
    test("zero sentences exceed the cap; a sentence sitting exactly at 60 passes", () => {
      assert.deepEqual(
        oversized,
        [],
        oversized.map((item) => `${item.file}: ${item.words} words: ${item.sentence}`).join("\n"),
      );
    });
  },
);

function wordTokenSentence(wordCount: number): string {
  return `${Array.from({ length: wordCount }, (_, index) => `w${index + 1}`).join(" ")}.`;
}

const PLANTED_FILE = "planted.md";

function plantedCapFixture(wordCount: number): string {
  return `# Planted cap fixture — a heading, never a sentence\n\n${wordTokenSentence(wordCount)}\n`;
}

describe("sentenceWordCountsIn, read over planted markdown this repository does not ship", () => {
  test("a planted 61-token sentence (`w1 w2 … w61.`) counts 61 words, over the cap", () => {
    const [counted] = sentenceWordCountsIn(PLANTED_FILE, plantedCapFixture(61));
    assert.equal(counted?.words, 61);
  });

  test("a planted 60-token sentence (`w1 w2 … w60.`) counts 60 words, exactly at the cap and passing", () => {
    const [counted] = sentenceWordCountsIn(PLANTED_FILE, plantedCapFixture(60));
    assert.equal(counted?.words, 60);
  });
});

describe("sentencesIn, read directly over a run its own SENTENCE_END never matches", () => {
  test("a run with no closing `.`/`!`/`?` is still returned whole, as its own trailing sentence", () => {
    const unterminated = wordTokenSentence(61).slice(0, -1);
    assert.deepEqual(sentencesIn(unterminated), [unterminated]);
  });
});

describe("sentenceWordCountsIn, read over a planted markdown table this repository does not ship", () => {
  test("a 73-token table row is counted as one run of its own — 75 words with its two cell pipes — and lands over the cap", () => {
    const cell = wordTokenSentence(73).slice(0, -1);
    const planted = `# Planted table fixture — a table row, a run of its own\n\n| Col |\n|---|\n| ${cell} |\n`;
    const overCap = sentenceWordCountsIn(PLANTED_FILE, planted).filter((counted) => counted.words > SENTENCE_CAP);
    assert.deepEqual(overCap.map((counted) => counted.words), [75]);
  });
});

describe("sentenceWordCountsIn, read over a planted bullet list item this repository does not ship", () => {
  test(
    "a planted 60-word bullet (`- w1 w2 … w60.`) counts 60 words with its leading marker stripped, passing at " +
      "the cap; left unstripped, `-` would count as the sentence's 61st word and fail it",
    () => {
      const planted = `# Planted list fixture — a bullet, never a bare paragraph\n\n- ${wordTokenSentence(60)}\n`;
      const [counted] = sentenceWordCountsIn(PLANTED_FILE, planted);
      assert.equal(counted?.words, 60);
      assert.equal(wordCountOf(`- ${wordTokenSentence(60)}`), 61);
    },
  );
});
