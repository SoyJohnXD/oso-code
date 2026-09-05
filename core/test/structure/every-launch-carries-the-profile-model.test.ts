import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { readTextAtCommit, sourceFilesAtCommit } from "../support/prose-inventory.ts";
import { sentencesOf } from "../support/prose-sentences.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const RED_COMMIT = "eee0898";

const MODEL_CLAUSE = "the model the profile names for its role";
const NAMING_CLAUSE = "named in the Launching milestone";

const FLOW_PROSE_ROOT = "plugin/skills/";
const HOST_BINDING_DIRECTORY = "references";
const CLAUDE_BINDING_LEAF = `${HOST_BINDING_DIRECTORY}/claude.md`;
const DELEGATE_ROLE = /oso-applier|oso-verifier|oso-integrator/;

const MODEL_SECTION_HEADING = "The model a launch carries";
const MODEL_PARAMETER = "`model` parameter";
const CLAUDE_TIER_SPELLINGS = ["sonnet", "opus"];

type StatedNonLaunch = Readonly<{ fragment: string; reason: string }>;

const NAMES_A_DELEGATE_BUT_LAUNCHES_NONE: readonly StatedNonLaunch[] = [
  {
    fragment: "Launch `oso-verifier` once per slice with step 3's payload",
    reason: "the wave loop inherits plan §6 step 3's enumeration whole; its em-dash list restates that payload rather than building a second one",
  },
  {
    fragment: "re-invoke `oso-integrator` with the corrected wave payload",
    reason: "a re-invocation of the merge launch two paragraphs above, on the payload that launch already enumerated",
  },
  {
    fragment: "lands the edit through the `oso-applier` agent",
    reason: "a late edit re-arms as its own slice, so the launch it reaches is plan §6 step 2's and the enumeration is that step's",
  },
  {
    fragment: "runs no `oso-verifier`",
    reason: "a negation — debug's close launches nothing, which is the whole point of the sentence",
  },
  {
    fragment: "name the role handed the work",
    reason: "the Launching milestone's own contract, which names the roles a report must name and launches none of them",
  },
];

type DelegateSentence = Readonly<{ file: string; sentence: string; sentenceAndFollowOn: string }>;

function flowProseAmong(files: readonly string[]): string[] {
  return files.filter((file) => file.startsWith(FLOW_PROSE_ROOT) && file.endsWith(".md") && !file.includes(`/${HOST_BINDING_DIRECTORY}/`)).sort();
}

function sentencesLineByLine(rawFlowText: string): string[][] {
  return flowBody(rawFlowText).split("\n").map(sentencesOf);
}

function delegateSentencesIn(file: string, rawFlowText: string): DelegateSentence[] {
  return sentencesLineByLine(rawFlowText).flatMap((sentences) =>
    sentences
      .map((sentence, index) => ({ file, sentence, sentenceAndFollowOn: `${sentence} ${sentences[index + 1] ?? ""}` }))
      .filter(({ sentence }) => DELEGATE_ROLE.test(sentence)),
  );
}

function statedNonLaunch(sentence: string): StatedNonLaunch | undefined {
  return NAMES_A_DELEGATE_BUT_LAUNCHES_NONE.find(({ fragment }) => sentence.includes(fragment));
}

function launchEnumerations(delegateSentences: readonly DelegateSentence[]): DelegateSentence[] {
  return delegateSentences.filter(({ sentence }) => statedNonLaunch(sentence) === undefined);
}

function withoutClause(launches: readonly DelegateSentence[], clause: string): string[] {
  return launches
    .filter(({ sentenceAndFollowOn }) => !sentenceAndFollowOn.includes(clause))
    .map(({ file, sentence }) => `${file}: ${sentence}`);
}

function claudeBindingOf(flowFile: string): string {
  return `${flowFile.slice(0, flowFile.lastIndexOf("/") + 1)}${CLAUDE_BINDING_LEAF}`;
}

const trackedFlowProse = flowProseAmong(trackedRepositoryFiles());
const trackedDelegateSentences = trackedFlowProse.flatMap((file) => delegateSentencesIn(file, readTrackedText(file).text));
const trackedLaunches = launchEnumerations(trackedDelegateSentences);
const segmentedSentenceCount = trackedFlowProse.reduce((total, file) => total + sentencesLineByLine(readTrackedText(file).text).flat().length, 0);

const redLaunches = launchEnumerations(
  flowProseAmong(sourceFilesAtCommit(RED_COMMIT)).flatMap((file) => delegateSentencesIn(file, readTextAtCommit(RED_COMMIT, file))),
);

const claudeBindings = [...new Set(trackedLaunches.map(({ file }) => claudeBindingOf(file)))].sort();

const FLOW_PROSE_FLOOR = 15;
const FLOW_PROSE_FLOOR_DERIVATION =
  "the 9 plugin/skills/<skill>/SKILL.md flows plus the 6 shared bodies under plugin/skills/_shared/ — every markdown " +
  `file the walk finds under ${FLOW_PROSE_ROOT} that is not a host's own binding under ${HOST_BINDING_DIRECTORY}/`;

const SENTENCES_FLOOR = 900;
const SENTENCES_FLOOR_DERIVATION =
  "well under the 1,217 sentences this walk segments line by line across that flow prose at this writing, so a " +
  "later, legitimate prose edit never has to chase this number — only a walk that segments nothing, leaving every " +
  "launch below vacuously unfound, should fail it";

provedSomething(
  `${trackedFlowProse.length} flow prose file(s) were walked for a sentence launching a delegate`,
  trackedFlowProse.length >= FLOW_PROSE_FLOOR,
  `only ${trackedFlowProse.length} file(s) were found, under the ${FLOW_PROSE_FLOOR}-file floor (${FLOW_PROSE_FLOOR_DERIVATION})`,
);

provedSomething(
  `${segmentedSentenceCount} sentence(s) were segmented across those files for the launch walk to read`,
  segmentedSentenceCount >= SENTENCES_FLOOR,
  `only ${segmentedSentenceCount} sentence(s) were segmented, under the ${SENTENCES_FLOOR}-sentence floor (${SENTENCES_FLOOR_DERIVATION})`,
);

describe(
  "the launch inventory is read out of the flow prose itself — every sentence naming `oso-applier`, `oso-verifier` " +
    "or `oso-integrator` is a launch enumeration owing the clause, unless this file states, with its reason, why it " +
    "launches nothing; a launch added tomorrow joins the inventory on its own, and no exclusion on its own",
  () => {
    test("each stated non-launch matches exactly one sentence, so an exclusion gone stale fails rather than quietly shrinking the inventory", () => {
      const drifted = NAMES_A_DELEGATE_BUT_LAUNCHES_NONE.map(({ fragment, reason }) => ({
        fragment,
        reason,
        matches: trackedDelegateSentences.filter(({ sentence }) => sentence.includes(fragment)).length,
      }))
        .filter(({ matches }) => matches !== 1)
        .map(({ fragment, matches, reason }) => `${matches} sentence(s) match "${fragment}" (${reason})`);
      assert.deepEqual(drifted, [], drifted.join("\n"));
    });

    test(`the ${trackedDelegateSentences.length} delegate-naming sentence(s) split into launches and stated non-launches with none left over`, () => {
      const statedAway = trackedDelegateSentences.filter(({ sentence }) => statedNonLaunch(sentence) !== undefined);
      assert.equal(trackedLaunches.length + statedAway.length, trackedDelegateSentences.length);
      assert.equal(statedAway.length, NAMES_A_DELEGATE_BUT_LAUNCHES_NONE.length);
    });
  },
);

describe("a launch enumeration carries the model the profile names for its role, and the milestone announcing it names that model", () => {
  test(`RED at ${RED_COMMIT}: not one of the ${redLaunches.length} launch enumerations names the model its launch runs on`, () => {
    assert.equal(withoutClause(redLaunches, MODEL_CLAUSE).length, redLaunches.length);
  });

  test(`RED at ${RED_COMMIT}: not one of the ${redLaunches.length} launch enumerations makes the announcing milestone name it`, () => {
    assert.equal(withoutClause(redLaunches, NAMING_CLAUSE).length, redLaunches.length);
  });

  test(`GREEN on the tracked tree: every one of the ${trackedLaunches.length} launch enumerations carries the model the profile names`, () => {
    const silent = withoutClause(trackedLaunches, MODEL_CLAUSE);
    assert.deepEqual(silent, [], silent.join("\n"));
  });

  test("GREEN on the tracked tree: every launch enumeration makes the announcing milestone name that model", () => {
    const silent = withoutClause(trackedLaunches, NAMING_CLAUSE);
    assert.deepEqual(silent, [], silent.join("\n"));
  });
});

describe("the host spelling lives in the Claude binding beside each flow whose launches carry the model, never in a flow body every host reads", () => {
  test("no flow body spells a Claude tier as a model name", () => {
    const hits = trackedFlowProse.flatMap((file) => {
      const body = flowBody(readTrackedText(file).text);
      return CLAUDE_TIER_SPELLINGS.filter((spelling) => body.includes(spelling)).map((spelling) => `${file}: "${spelling}"`);
    });
    assert.deepEqual(hits, [], hits.join("\n"));
  });

  test(`RED at ${RED_COMMIT}: not one of the ${claudeBindings.length} bindings names the Agent tool's ${MODEL_PARAMETER}, nor the section spelling it`, () => {
    const named = claudeBindings.flatMap((file) =>
      [MODEL_PARAMETER, MODEL_SECTION_HEADING]
        .filter((token) => readTextAtCommit(RED_COMMIT, file).includes(token))
        .map((token) => `${file}: "${token}"`),
    );
    assert.deepEqual(named, [], named.join("\n"));
  });

  test(`GREEN: every Claude binding beside a clause-carrying flow names the Agent tool's ${MODEL_PARAMETER}`, () => {
    const silent = claudeBindings.filter((file) => !readTrackedText(file).text.includes(MODEL_PARAMETER));
    assert.deepEqual(silent, [], silent.join("\n"));
  });

  test(`GREEN: every one of those bindings reaches the **${MODEL_SECTION_HEADING}** section that spells the tiers`, () => {
    const unreached = claudeBindings.filter((file) => !readTrackedText(file).text.includes(MODEL_SECTION_HEADING));
    assert.deepEqual(unreached, [], unreached.join("\n"));
  });

  test("GREEN: the shared Claude binding, where that section lives, spells both tiers as this host's own model aliases", () => {
    const shared = readTrackedText(`${FLOW_PROSE_ROOT}_shared/${CLAUDE_BINDING_LEAF}`).text;
    const unspelled = CLAUDE_TIER_SPELLINGS.filter((spelling) => !shared.includes(spelling));
    assert.deepEqual(unspelled, [], unspelled.join("\n"));
  });
});
