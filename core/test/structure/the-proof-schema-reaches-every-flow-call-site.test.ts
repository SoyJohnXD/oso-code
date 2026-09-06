import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { delegateSentencesIn, flowBodyLines, flowProseAmong, FLOW_PROSE_ROOT, type DelegateSentence } from "../support/flow-launches.ts";
import { readTextAtCommit, sourceFilesAtCommit } from "../support/prose-inventory.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const RED_COMMIT = "2d61863";

const APPLIER = "oso-applier";
const VERIFIER = "oso-verifier";

const DECISION_BLOCK = "DECISION BLOCK";
const COPIED_BY_ID = "BY ID";
const RED_EXCEPTION = "red: exception";
const APPLIER_PROOF = "applier_proof";
const PROOF_BLOCK = "proof:";
const SCAN_BLOCK = "scan:";
const DECISIONS_USED_BLOCK = "decisions_used:";
const REFUTED_CLAIM = "refuted claim";

const PAYLOAD_TOKENS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  [APPLIER]: [DECISION_BLOCK, COPIED_BY_ID, RED_EXCEPTION],
  [VERIFIER]: [DECISION_BLOCK, APPLIER_PROOF, PROOF_BLOCK, SCAN_BLOCK, DECISIONS_USED_BLOCK, REFUTED_CLAIM],
};

const INDENTED_LINE = /^\s+\S/;

type StatedNonPayload = Readonly<{ file: string; fragment: string; reason: string }>;

const NAMES_A_DELEGATE_BUT_HANDS_NO_SLICE_PAYLOAD: readonly StatedNonPayload[] = [
  {
    file: `${FLOW_PROSE_ROOT}_shared/front-surface.md`,
    fragment: "handed over as the `judge findings` assignment kind",
    reason:
      "the design audit's fix route hands the judge-findings kind, whose payload the applier contract declares self-contained " +
      "and ledger-free, so no decision block and no failing check of its own travel with it",
  },
  {
    file: `${FLOW_PROSE_ROOT}_shared/parallel.md`,
    fragment: "launch `oso-verifier` on the merged main checkout with its INTEGRATION verdict shape",
    reason:
      "the integration gate judges the merged tree rather than one applier's work, and every slice's proof was reconciled at " +
      "that slice's own gate, so no applier claim arrives here to confirm or refute",
  },
  {
    file: `${FLOW_PROSE_ROOT}_shared/reporting.md`,
    fragment: "name the role handed the work",
    reason: "the Launching milestone names the roles a report must name and hands out no payload of its own",
  },
  {
    file: `${FLOW_PROSE_ROOT}debug/SKILL.md`,
    fragment: "the list goes to the `oso-applier` agent as a debt cleanup assignment",
    reason:
      "a debt cleanup is behaviour-preserving and carries findings rather than criteria, so it has no failing check to red and " +
      "no ledger decision to cite",
  },
  {
    file: `${FLOW_PROSE_ROOT}debug/SKILL.md`,
    fragment: "runs no `oso-verifier`",
    reason: "a negation — debug's close launches nothing, which is the whole point of the sentence",
  },
  {
    file: `${FLOW_PROSE_ROOT}debug/SKILL.md`,
    fragment: "Fixes the operator accepts go through the `oso-applier` agent as judge findings",
    reason: "the security pass's fix route hands the judge-findings kind, self-contained and ledger-free like the design audit's",
  },
  {
    file: `${FLOW_PROSE_ROOT}plan/SKILL.md`,
    fragment: "launch the `oso-applier` agent as a debt-cleanup assignment",
    reason: "the close's debt axis, the same behaviour-preserving cleanup kind debug's close hands out",
  },
  {
    file: `${FLOW_PROSE_ROOT}plan/SKILL.md`,
    fragment: "the CODE diverged (fix through the `oso-applier` agent as judge findings)",
    reason: "the close's conformance axis, which routes a finding rather than a slice and carries the ledger as the bar it diverged from",
  },
  {
    file: `${FLOW_PROSE_ROOT}plan/SKILL.md`,
    fragment: "lands the edit through the `oso-applier` agent",
    reason: "a late edit re-arms as its own slice, so the payload it reaches is §6 step 2's and the enumeration is that step's",
  },
  {
    file: `${FLOW_PROSE_ROOT}plan/SKILL.md`,
    fragment: "Fixes the operator accepts go through the `oso-applier` agent as judge findings",
    reason: "the security pass's fix route again, one flow over, on the same judge-findings kind",
  },
  {
    file: `${FLOW_PROSE_ROOT}quick/SKILL.md`,
    fragment: "Fixes the operator accepts go through the `oso-applier` agent as judge findings",
    reason: "the security pass's fix route in the flow that freezes no ledger and arms no slice at all",
  },
];

type StatedInheritance = Readonly<{ file: string; fragment: string; token: string; reason: string }>;

const INHERITS_A_TOKEN_FROM_THE_STEP_IT_RESTATES: readonly StatedInheritance[] = [
  {
    file: `${FLOW_PROSE_ROOT}_shared/parallel.md`,
    fragment: "Launch `oso-verifier` once per slice with step 3's payload",
    token: REFUTED_CLAIM,
    reason:
      "the wave loop restates step 3's payload FIELDS and none of its routes: a red slice loops apply → verify exactly as step 3 " +
      "does, so the route a refuted claim takes is inherited rather than written twice",
  },
];

type PayloadCallSite = Readonly<{ file: string; role: string; sentence: string; block: string }>;

function statedNonPayload(candidate: DelegateSentence): StatedNonPayload | undefined {
  return NAMES_A_DELEGATE_BUT_HANDS_NO_SLICE_PAYLOAD.find(
    ({ file, fragment }) => file === candidate.file && candidate.sentence.includes(fragment),
  );
}

function namesARole(sentence: string): boolean {
  return sentence.includes(APPLIER) || sentence.includes(VERIFIER);
}

function roleNamedIn(sentence: string): string {
  const named = [APPLIER, VERIFIER].filter((role) => sentence.includes(role));
  return named.length === 1 ? (named[0] as string) : named.join(" and ");
}

function blockAt(bodyLines: readonly string[], lineIndex: number): string {
  const block = [bodyLines[lineIndex] ?? ""];
  for (let next = lineIndex + 1; next < bodyLines.length && INDENTED_LINE.test(bodyLines[next] as string); next += 1) {
    block.push(bodyLines[next] as string);
  }
  return block.join("\n");
}

function roleNamingSentencesIn(file: string, rawFlowText: string): DelegateSentence[] {
  return delegateSentencesIn(file, rawFlowText).filter(({ sentence }) => namesARole(sentence));
}

function payloadCallSitesIn(file: string, rawFlowText: string): PayloadCallSite[] {
  const bodyLines = flowBodyLines(rawFlowText);
  return roleNamingSentencesIn(file, rawFlowText)
    .filter((candidate) => statedNonPayload(candidate) === undefined)
    .map(({ sentence, lineIndex }) => ({ file, role: roleNamedIn(sentence), sentence, block: blockAt(bodyLines, lineIndex) }));
}

function waivedAt(site: PayloadCallSite, token: string): boolean {
  return INHERITS_A_TOKEN_FROM_THE_STEP_IT_RESTATES.some(
    (stated) => stated.file === site.file && stated.token === token && site.sentence.includes(stated.fragment),
  );
}

function tokensOwedBy(site: PayloadCallSite): readonly string[] {
  return (PAYLOAD_TOKENS_BY_ROLE[site.role] ?? []).filter((token) => !waivedAt(site, token));
}

function tokensMissingFrom(site: PayloadCallSite): string[] {
  return tokensOwedBy(site).filter((token) => !site.block.includes(token));
}

function tokensPresentIn(site: PayloadCallSite): string[] {
  return tokensOwedBy(site).filter((token) => site.block.includes(token));
}

const trackedFlowProse = flowProseAmong(trackedRepositoryFiles());
const trackedRoleNamingSentences = trackedFlowProse.flatMap((file) => roleNamingSentencesIn(file, readTrackedText(file).text));
const trackedCallSites = trackedFlowProse.flatMap((file) => payloadCallSitesIn(file, readTrackedText(file).text));

const redCallSites = flowProseAmong(sourceFilesAtCommit(RED_COMMIT)).flatMap((file) =>
  payloadCallSitesIn(file, readTextAtCommit(RED_COMMIT, file)),
);

const FLOW_PROSE_FLOOR = 15;
const FLOW_PROSE_FLOOR_DERIVATION =
  "the 9 plugin/skills/<skill>/SKILL.md flows plus the 6 shared bodies under plugin/skills/_shared/ — every markdown file " +
  `the walk finds under ${FLOW_PROSE_ROOT} that is not a host's own binding`;

const ROLE_NAMING_FLOOR = 12;
const ROLE_NAMING_FLOOR_DERIVATION =
  "well under the 16 sentences naming one of the two roles a slice payload is handed to at this writing, so a later, " +
  "legitimate prose edit never has to chase this number — only a walk that segments nothing should fail it";

const CALL_SITES_FLOOR = 4;
const CALL_SITES_FLOOR_DERIVATION =
  "the apply and the verify step of each of the two flows that hand out a slice payload — /plan §6 steps 2–3 and /debug §4 " +
  "steps 1–2 — before the wave loop's own restatement of the verify payload is counted";

provedSomething(
  `${trackedFlowProse.length} flow prose file(s) were walked for a payload handed to an applier or a verifier`,
  trackedFlowProse.length >= FLOW_PROSE_FLOOR,
  `only ${trackedFlowProse.length} file(s) were found, under the ${FLOW_PROSE_FLOOR}-file floor (${FLOW_PROSE_FLOOR_DERIVATION})`,
);

provedSomething(
  `${trackedRoleNamingSentences.length} sentence(s) naming one of those two roles were segmented across those files`,
  trackedRoleNamingSentences.length >= ROLE_NAMING_FLOOR,
  `only ${trackedRoleNamingSentences.length} sentence(s) were found, under the ${ROLE_NAMING_FLOOR}-sentence floor (${ROLE_NAMING_FLOOR_DERIVATION})`,
);

provedSomething(
  `${trackedCallSites.length} of them hand out a slice payload and are read for the fields it carries`,
  trackedCallSites.length >= CALL_SITES_FLOOR,
  `only ${trackedCallSites.length} call site(s) were derived, under the ${CALL_SITES_FLOOR}-site floor (${CALL_SITES_FLOOR_DERIVATION})`,
);

describe(
  "the call-site inventory is read out of the flow prose itself — every sentence naming `oso-applier` or `oso-verifier` " +
    "hands out a slice payload unless this file states, with its reason, what it hands out instead; a call site added " +
    "tomorrow joins the inventory on its own, and no exclusion on its own",
  () => {
    test("each stated non-payload matches exactly one sentence in its own file, so an exclusion gone stale fails rather than quietly shrinking the inventory", () => {
      const drifted = NAMES_A_DELEGATE_BUT_HANDS_NO_SLICE_PAYLOAD.map(({ file, fragment, reason }) => ({
        fragment,
        reason,
        matches: trackedRoleNamingSentences.filter((candidate) => candidate.file === file && candidate.sentence.includes(fragment)).length,
      }))
        .filter(({ matches }) => matches !== 1)
        .map(({ fragment, matches, reason }) => `${matches} sentence(s) match "${fragment}" (${reason})`);
      assert.deepEqual(drifted, [], drifted.join("\n"));
    });

    test(`the ${trackedRoleNamingSentences.length} role-naming sentence(s) split into call sites and stated non-payloads with none left over`, () => {
      const statedAway = trackedRoleNamingSentences.filter((candidate) => statedNonPayload(candidate) !== undefined);
      assert.equal(trackedCallSites.length + statedAway.length, trackedRoleNamingSentences.length);
      assert.equal(statedAway.length, NAMES_A_DELEGATE_BUT_HANDS_NO_SLICE_PAYLOAD.length);
    });

    test("every call site names exactly one of the two roles, so none passes by naming both and owing neither's fields", () => {
      const unresolved = trackedCallSites
        .filter((site) => PAYLOAD_TOKENS_BY_ROLE[site.role] === undefined)
        .map((site) => `${site.file}: "${site.role}" is no role a payload field list is recorded for`);
      assert.deepEqual(unresolved, [], unresolved.join("\n"));
    });

    test("each stated inheritance names a token its call site's role actually owes, so a waiver cannot cover a field nobody was owed", () => {
      const groundless = INHERITS_A_TOKEN_FROM_THE_STEP_IT_RESTATES.filter(
        ({ file, fragment, token }) =>
          !trackedCallSites.some(
            (site) => site.file === file && site.sentence.includes(fragment) && (PAYLOAD_TOKENS_BY_ROLE[site.role] ?? []).includes(token),
          ),
      ).map(({ fragment, token, reason }) => `"${fragment}" waives ${token}, which no call site of that role owes (${reason})`);
      assert.deepEqual(groundless, [], groundless.join("\n"));
    });
  },
);

describe(
  "a slice payload names the decision block copied by id, the applier's three-block proof package on the way to the verifier, the " +
    "Verify line's exception in the red leg's place, and the route a refuted claim takes",
  () => {
    test(`RED at ${RED_COMMIT}: not one of the ${redCallSites.length} call sites spells a single field of the payload it hands out`, () => {
      const spelled = redCallSites.flatMap((site) => tokensPresentIn(site).map((token) => `${site.file}: "${token}"`));
      assert.deepEqual(spelled, [], spelled.join("\n"));
    });

    for (const site of trackedCallSites) {
      test(`GREEN: ${site.file}'s ${site.role} payload spells ${tokensOwedBy(site).join(", ")}`, () => {
        const absent = tokensMissingFrom(site);
        assert.deepEqual(absent, [], `${site.file} never spells ${absent.join(", ")} in the step that launches ${site.role}`);
      });
    }
  },
);

describe("the block reader, over planted flow prose this repository does not ship", () => {
  const planted = [
    `2. **Apply (subagent)** — launch the \`${APPLIER}\` agent with the ${DECISION_BLOCK}, copied ${COPIED_BY_ID}.`,
    `   - the sub-bullet of that same step, where \`${RED_EXCEPTION} — <the reason>\` lands`,
    "3. the next numbered step, which belongs to no block above it",
  ];
  const plantedSite = (block: string): PayloadCallSite => ({ file: "planted.md", role: APPLIER, sentence: planted[0] as string, block });

  test("a numbered step's block runs through its indented sub-bullets and stops before the next step", () => {
    assert.equal(blockAt(planted, 0), `${planted[0]}\n${planted[1]}`);
  });

  test(`a planted step whose sub-bullet was dropped is reported missing ${RED_EXCEPTION}, so a zero above is a zero this walk looked for`, () => {
    assert.deepEqual(tokensMissingFrom(plantedSite(planted[0] as string)), [RED_EXCEPTION]);
    assert.deepEqual(tokensMissingFrom(plantedSite(blockAt(planted, 0))), []);
  });
});
