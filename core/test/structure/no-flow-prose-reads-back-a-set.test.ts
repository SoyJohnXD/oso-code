import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const SCANNED_PREFIXES = ["plugin/skills/", "opencode/skills/", "core/src/prose/"];
const SHOW_MENTION = /`(?:oso-state )?show`/;
const READ_BACK_WORDING = /\b(?:back|confirm)/i;
const NOT_A_SET_WRITE = /amend-plan/;

const SHOW_MENTIONS_FLOOR = 8;

const scannedFiles = trackedRepositoryFiles().filter(
  (file) => file.endsWith(".md") && SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)),
);

const sentences = scannedFiles.map(readTrackedText).flatMap(({ file, text }) =>
  text.split("\n").flatMap((line, index) =>
    line.split(/(?<=[.!?])\s+/).map((sentence) => ({ site: `${file}:${index + 1}`, sentence })),
  ),
);

const showMentions = sentences.filter(({ sentence }) => SHOW_MENTION.test(sentence));

provedSomething(
  `${showMentions.length} sentence(s) naming oso-state show were found across ${scannedFiles.length} scanned file(s)`,
  showMentions.length >= SHOW_MENTIONS_FLOOR,
  `only ${showMentions.length} show mention(s) were found, under the ${SHOW_MENTIONS_FLOOR} floor`,
);

const readBacks = showMentions
  .filter(({ sentence }) => READ_BACK_WORDING.test(sentence) && !NOT_A_SET_WRITE.test(sentence))
  .map(({ site, sentence }) => `${site}: ${sentence.slice(0, 120)}`);

describe("no flow prose reads a set back with oso-state show", () => {
  test("a sentence naming show beside back or confirm (the read-back after a set, which set's own echo replaces) appears nowhere", () => {
    assert.deepEqual(readBacks, [], readBacks.join("\n"));
  });
});
