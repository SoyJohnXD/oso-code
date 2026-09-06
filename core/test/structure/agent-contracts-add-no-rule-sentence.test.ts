import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sentenceWordCountsIn, type SentenceWordCount } from "../support/prose-sentences.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const AGENT_PROSE_ROOT = "core/src/prose/agents/";
const VERIFIER_CONTRACT = `${AGENT_PROSE_ROOT}oso-verifier/body.md`;
const SENTENCE_CAP = 60;
const FENCE_LINE = /^\s*```/;

const RULE_SENTENCE_CEILINGS: Readonly<Record<string, number>> = {
  "oso-applier/body.md": 40,
  "oso-applier/codex.md": 5,
  "oso-applier/opencode.md": 6,
  "oso-debt-sweep/body.md": 10,
  "oso-debt-sweep/codex.md": 6,
  "oso-debt-sweep/opencode.md": 4,
  "oso-doubt-pass/body.md": 8,
  "oso-doubt-pass/codex.md": 5,
  "oso-doubt-pass/opencode.md": 3,
  "oso-integrator/body.md": 32,
  "oso-integrator/claude.md": 1,
  "oso-integrator/codex.md": 5,
  "oso-integrator/opencode.md": 6,
  "oso-security-reviewer/body.md": 7,
  "oso-security-reviewer/codex.md": 8,
  "oso-security-reviewer/opencode.md": 6,
  "oso-triage/body.md": 10,
  "oso-triage/codex.md": 7,
  "oso-triage/opencode.md": 5,
  "oso-verifier/body.md": 45,
  "oso-verifier/codex.md": 7,
  "oso-verifier/opencode.md": 5,
};

const CEILINGS_DERIVATION =
  `each file's own sentence count on the tracked tree at 9a3cab7, read by this file's walk — the fenced blocks stripped ` +
  "first, then the paragraphs, bullets and table rows left over segmented into sentences; 231 across the 22 files, of " +
  "which the applier's 40 and the verifier's 45 are the two the proof schema rewrote and the other 20 are untouched";

type AgentSentence = SentenceWordCount & Readonly<{ contractPath: string }>;

function proseOutsideFencedBlocks(text: string): string {
  const prose: string[] = [];
  let insideFence = false;
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (!insideFence) prose.push(line);
  }
  return prose.join("\n");
}

function ruleSentencesIn(file: string, text: string): AgentSentence[] {
  const contractPath = file.startsWith(AGENT_PROSE_ROOT) ? file.slice(AGENT_PROSE_ROOT.length) : file;
  return sentenceWordCountsIn(file, proseOutsideFencedBlocks(text)).map((counted) => ({ ...counted, contractPath }));
}

const agentProseFiles = trackedRepositoryFiles()
  .filter((file) => file.startsWith(AGENT_PROSE_ROOT) && file.endsWith(".md"))
  .sort();
const agentSentences = agentProseFiles.flatMap((file) => ruleSentencesIn(file, readTrackedText(file).text));
const countsByContractPath = new Map<string, number>();
for (const { contractPath } of agentSentences) countsByContractPath.set(contractPath, (countsByContractPath.get(contractPath) ?? 0) + 1);

const FILES_FLOOR = 22;
const FILES_FLOOR_DERIVATION =
  "the seven agent roles' shared bodies and the host deltas beside them — every tracked markdown file under " +
  `${AGENT_PROSE_ROOT}, which is the same set ${Object.keys(RULE_SENTENCE_CEILINGS).length} ceilings are recorded for`;

const verifierContract = readTrackedText(VERIFIER_CONTRACT).text;

provedSomething(
  `${agentProseFiles.length} agent prose file(s) were walked for the rule sentences they carry`,
  agentProseFiles.length >= FILES_FLOOR,
  `only ${agentProseFiles.length} file(s) were found, under the ${FILES_FLOOR}-file floor (${FILES_FLOOR_DERIVATION})`,
);

const SENTENCES_FLOOR = 160;
const SENTENCES_FLOOR_DERIVATION =
  "well under the 231 sentences this walk segments across those files at this writing, so a later, legitimate prose " +
  "edit never has to chase this number — only a walk that segments nothing, which passes every ceiling below " +
  "vacuously, should fail it";

provedSomething(
  `${agentSentences.length} rule sentence(s) were segmented across those files`,
  agentSentences.length >= SENTENCES_FLOOR,
  `only ${agentSentences.length} sentence(s) were segmented, under the ${SENTENCES_FLOOR}-sentence floor (${SENTENCES_FLOOR_DERIVATION})`,
);

describe(
  "no agent contract carries more rule sentences than it carried before the proof schema landed; a schema field or a " +
    "worked example is fenced and therefore not a sentence, which is what lets the schema grow while the prose does not",
  () => {
    test("every walked file carries a recorded ceiling, so a new contract is measured in rather than admitted unbounded", () => {
      const unmeasured = [...countsByContractPath.keys()].filter((contractPath) => !(contractPath in RULE_SENTENCE_CEILINGS));
      assert.deepEqual(unmeasured, [], `${unmeasured.join(", ")} carry no ceiling (${CEILINGS_DERIVATION})`);
    });

    test("every recorded ceiling names a file the walk still finds, so a ceiling gone stale fails rather than sitting unused", () => {
      const orphaned = Object.keys(RULE_SENTENCE_CEILINGS).filter((contractPath) => !countsByContractPath.has(contractPath));
      assert.deepEqual(orphaned, [], `${orphaned.join(", ")} carry a ceiling but the walk found no such file`);
    });

    for (const [contractPath, ceiling] of Object.entries(RULE_SENTENCE_CEILINGS)) {
      test(`${contractPath} holds ${countsByContractPath.get(contractPath) ?? 0} rule sentence(s), at or under its ${ceiling}`, () => {
        const counted = countsByContractPath.get(contractPath) ?? 0;
        assert.ok(counted <= ceiling, `${contractPath} holds ${counted} rule sentence(s), over its ${ceiling}-sentence ceiling`);
      });
    }
  },
);

describe(`no rule sentence in an agent contract runs past ${SENTENCE_CAP} words`, () => {
  test(`zero of the ${agentSentences.length} sentences exceed the cap; a sentence sitting exactly at ${SENTENCE_CAP} passes`, () => {
    const oversized = agentSentences.filter((counted) => counted.words > SENTENCE_CAP);
    assert.deepEqual(oversized, [], oversized.map((counted) => `${counted.file}: ${counted.words} words: ${counted.sentence}`).join("\n"));
  });
});

describe("the verifier's empirical scan and decisions checks stay in their existing gates", () => {
  test("gate 7 and its worked verdict name the shared comment scanner", () => {
    const gate7 = verifierContract.match(/^7\. (.+)$/m)?.[1] ?? "";
    assert.match(gate7, /oso-state scan comments <ref>/);
    assert.match(verifierContract, /cmd: oso-state scan comments 4f21a0c/);
    assert.doesNotMatch(gate7, /whatever shape covers/);
    assert.doesNotMatch(verifierContract, /rg -c \"\^\[\+\]\[ \]\*\(\/\|#\)\"/);
  });

  test("gate 8 checks every decisions_used id against the supplied decision block", () => {
    const gate8 = verifierContract.match(/^8\. (.+)$/m)?.[1] ?? "";
    assert.match(gate8, /decisions_used/);
    assert.match(gate8, /every .* id .* supplied decision block/);
    assert.match(gate8, /absent id as a finding/);
  });

  test("the decisions check remains within the nine numbered contract gates", () => {
    assert.equal([...verifierContract.matchAll(/^\d+\. /gm)].length, 9);
  });
});

describe("the walk, read over planted contracts this repository does not ship", () => {
  const PLANTED_FILE = `${AGENT_PROSE_ROOT}oso-planted/body.md`;

  test("a contract given one extra sentence counts one more than the same contract without it, and lands over its own ceiling", () => {
    const contractPath = "oso-applier/body.md";
    const ceiling = RULE_SENTENCE_CEILINGS[contractPath];
    assert.ok(ceiling !== undefined, `${contractPath} carries no recorded ceiling to plant against`);
    const applier = `${AGENT_PROSE_ROOT}${contractPath}`;
    const text = readTrackedText(applier).text;
    const planted = `${text}\nA planted rule sentence this contract does not ship.\n`;
    assert.equal(ruleSentencesIn(applier, planted).length, ruleSentencesIn(applier, text).length + 1);
    assert.ok(ruleSentencesIn(applier, planted).length > ceiling, "a planted extra sentence stayed within the applier's ceiling");
  });

  test("a sentence inside a fenced schema block is not counted, and the same words outside one are", () => {
    const sentence = "A planted schema line this contract does not ship.";
    assert.deepEqual(ruleSentencesIn(PLANTED_FILE, `\`\`\`\n${sentence}\n\`\`\`\n`), []);
    assert.equal(ruleSentencesIn(PLANTED_FILE, `${sentence}\n`).length, 1);
  });

  test(`a planted ${SENTENCE_CAP + 1}-word sentence is counted over the cap, so a zero above is a zero this walk looked for`, () => {
    const planted = `${Array.from({ length: SENTENCE_CAP + 1 }, (_, index) => `w${index + 1}`).join(" ")}.\n`;
    assert.deepEqual(
      ruleSentencesIn(PLANTED_FILE, planted).map((counted) => counted.words),
      [SENTENCE_CAP + 1],
    );
  });
});
