import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_STUBS, sharedReferencePath, skillReferencePath } from "../../src/prose/render.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const HEADING_LINE = /^#{1,6}\s/;

type Triple = Readonly<{ group: string; claude: string; codex: string; opencode: string }>;

type IdenticalSentence = Readonly<{ group: string; sentence: string }>;

function sentencesOf(text: string): string[] {
  const prose = text
    .split("\n")
    .filter((line) => !HEADING_LINE.test(line))
    .join(" ");
  return prose
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function identicalAcrossTriple({ group, claude, codex, opencode }: Triple): IdenticalSentence[] {
  const codexSentences = new Set(sentencesOf(readTrackedText(codex).text));
  const opencodeSentences = new Set(sentencesOf(readTrackedText(opencode).text));
  return sentencesOf(readTrackedText(claude).text)
    .filter((sentence) => codexSentences.has(sentence) && opencodeSentences.has(sentence))
    .map((sentence) => ({ group, sentence }));
}

const triples: Triple[] = [
  ...SKILL_STUBS.filter((stub) => stub.referenceHosts.length > 0).map((stub) => ({
    group: stub.id,
    claude: `plugin/skills/${stub.id}/references/claude.md`,
    codex: skillReferencePath(stub, "codex"),
    opencode: skillReferencePath(stub, "opencode"),
  })),
  {
    group: "_shared",
    claude: "plugin/skills/_shared/references/claude.md",
    codex: sharedReferencePath("codex"),
    opencode: sharedReferencePath("opencode"),
  },
];

const TRIPLES_FLOOR = 9;
const TRIPLES_FLOOR_DERIVATION = "the 8 SKILL_STUBS entries carrying all three host references, plus the shared layer's own triple";

const CLAUDE_SENTENCES_FLOOR = 100;
const CLAUDE_SENTENCES_FLOOR_DERIVATION =
  "well under the 120 Claude-side sentences this walk segments across the nine triples at this writing, so a " +
  "later, legitimate prose edit never has to chase this number — only a walk that segments nothing, leaving " +
  "`found` vacuously empty no matter what the three bindings say, should fail it";

const found = triples.flatMap(identicalAcrossTriple);
const claudeSentenceCount = triples.reduce((total, triple) => total + sentencesOf(readTrackedText(triple.claude).text).length, 0);

provedSomething(
  `${triples.length} skill-or-shared reference triple(s) (claude/codex/opencode) were diffed for an identical sentence`,
  triples.length >= TRIPLES_FLOOR,
  `only ${triples.length} triple(s) were found, under the ${TRIPLES_FLOOR} this repository names (${TRIPLES_FLOOR_DERIVATION})`,
);

provedSomething(
  `${claudeSentenceCount} Claude-side sentence(s) were segmented across those triples for the identical-sentence diff to compare`,
  claudeSentenceCount >= CLAUDE_SENTENCES_FLOOR,
  `only ${claudeSentenceCount} Claude-side sentence(s) were segmented, under the ${CLAUDE_SENTENCES_FLOOR}-sentence ` +
    `floor (${CLAUDE_SENTENCES_FLOOR_DERIVATION})`,
);

describe(
  "the diff is three-way, never pairwise, since a fact shared by exactly two hosts is host-specific and " +
    "legitimate; a sentence identical across all three of a skill's bindings (or the shared layer's) is a " +
    "duplicate every last one of which has already retired to a host-neutral home, so none is accepted and none " +
    "is named",
  () => {
    test("no sentence is identical across all three of a skill's bindings, or the shared layer's", () => {
      assert.deepEqual(found, [], found.map((item) => `${item.group}: "${item.sentence}"`).join("\n"));
    });
  },
);
