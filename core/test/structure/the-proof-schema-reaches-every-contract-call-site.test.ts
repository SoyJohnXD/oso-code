import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { APPLIER_PROOF_HEADER } from "../../src/prose/applier-proof.ts";
import { AGENT_ROLES, agentHosts, agentOutputPath, agentSharedBodyPath } from "../../src/prose/render.ts";
import { readTextAtCommit } from "../support/prose-inventory.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const RED_COMMIT = "9a3cab7";

const REPORT_FIELDS_BY_ROLE_ID: Readonly<Record<string, readonly string[]>> = {
  "oso-applier": ["proof:", "scan:"],
  "oso-verifier": ["claims:"],
};

const PAYLOAD_FIELDS_BY_ROLE_ID: Readonly<Record<string, readonly string[]>> = {
  "oso-verifier": ["applier_proof", APPLIER_PROOF_HEADER, "proof:", "scan:", "decisions_used:"],
};

const REPORT_BLOCK_OPENING = /^(?:status|verdict|reason|evidence):(?: |$)/;
const FENCE_LINE = /^\s*```/;
const APPLIER_REPORT_FIELDS = ["proof:", "scan:", "decisions_used:"] as const;
const verifierContract = readTrackedText("core/src/prose/agents/oso-verifier/body.md").text;

function exampleEvidenceGaps(example: string): string[] {
  const gaps: string[] = [];
  for (let gate = 1; gate <= 9; gate += 1) {
    if (!new RegExp(`gate ${gate}: (?:held|broken) — \\S`).test(example)) gaps.push(`gate ${gate}`);
  }
  const commands = example.split("\n").filter((entry) => entry.includes("cmd:"));
  if (commands.length === 0) gaps.push("command evidence");
  for (const line of commands) {
    if (!/result: \S/.test(line)) gaps.push("empty result");
    if (!/output: complete/.test(line)) gaps.push("incomplete output");
    if (!/warnings: (?:absent|present|indeterminate)/.test(line)) gaps.push("warning evidence");
  }
  if (!/inspection: \S.*property: \S.*observed: \S/.test(example)) gaps.push("inspection evidence");
  if (!/freshness: \S.*before: \S.*after: \S/.test(example)) gaps.push("freshness evidence");
  const verdicts = example.match(/^verdict: (?:pass|fail|blocked)$/gm) ?? [];
  if (verdicts.length !== 1 || !example.trimEnd().endsWith(verdicts[0] ?? "")) gaps.push("terminal verdict");
  if (/verdict: pass/.test(example) && /warnings: (?:present|indeterminate)|output: incomplete|freshness: stale/.test(example)) gaps.push("false green");
  return gaps;
}

describe("the documented verifier example supplies concrete evidence", () => {
  const example = verifierContract.match(/#### A worked verdict\n\n```\n([\s\S]*?)\n```/)?.[1] ?? "";

  test("the complete example answers every gate with command, inspection and freshness evidence", () => {
    assert.deepEqual(exampleEvidenceGaps(example), []);
  });

  test("empty labels, omitted gates, warnings and stale evidence cannot demonstrate a pass", () => {
    assert.ok(exampleEvidenceGaps(example.replace(/result: [^\n]+/, "result: ")).includes("empty result"));
    assert.ok(exampleEvidenceGaps(example.replace(/.*gate 2:.*\n/, "")).includes("gate 2"));
    const passing = example.replace("verdict: fail", "verdict: pass");
    assert.ok(exampleEvidenceGaps(passing.replace("warnings: absent", "warnings: present")).includes("false green"));
    assert.ok(exampleEvidenceGaps(passing.replace("warnings: absent", "warnings: indeterminate")).includes("false green"));
    assert.ok(exampleEvidenceGaps(passing.replace("output: complete", "output: incomplete")).includes("false green"));
    assert.ok(exampleEvidenceGaps(passing.replace("freshness: base/head", "freshness: stale base/head")).includes("false green"));
    assert.ok(exampleEvidenceGaps(example.replace(/.*inspection:.*\n/g, "")).includes("inspection evidence"));
    assert.ok(exampleEvidenceGaps(example.replace(/.*cmd:.*\n/g, "")).includes("command evidence"));
    assert.ok(exampleEvidenceGaps(`${example}\nverdict: pass`).includes("terminal verdict"));
  });

  test("reordering evidence entries preserves the complete example", () => {
    const lines = example.split("\n");
    const commands = lines.filter((line) => line.includes("cmd:")).reverse();
    const reordered = lines.map((line) => line.includes("cmd:") ? commands.shift()! : line).join("\n");
    assert.deepEqual(exampleEvidenceGaps(reordered), []);
  });
});

type BoundContract = Readonly<{
  roleId: string;
  reportFields: readonly string[];
  callSiteTokens: readonly string[];
  sharedBody: string;
  callSites: readonly string[];
}>;

type ReportBlock = Readonly<{ roleId: string; file: string; text: string; reportFields: readonly string[] }>;

type StatedNonProofBlock = Readonly<{ roleId: string; distinctiveLine: string; reason: string }>;

const REPORT_BLOCKS_THE_PROOF_SCHEMA_DOES_NOT_BIND: readonly StatedNonProofBlock[] = [
  {
    roleId: "oso-applier",
    distinctiveLine: "status: blocked",
    reason:
      "a report that stopped before the implementation existed exercised no criterion and holds no diff of its own to scan, " +
      "so what it owes the orchestrator is the questions, never evidence of work that never happened",
  },
  {
    roleId: "oso-verifier",
    distinctiveLine: "the merged tree meets the project's bar",
    reason:
      "the wave integration gate judges a merged tree rather than one applier's work, and each slice's proof was already " +
      "reconciled at that slice's own gate, so no applier claim arrives here to confirm or refute",
  },
];

const boundContracts: readonly BoundContract[] = AGENT_ROLES.flatMap((role) => {
  const reportFields = REPORT_FIELDS_BY_ROLE_ID[role.id];
  if (reportFields === undefined) return [];
  const sharedBody = agentSharedBodyPath(role);
  return [
    {
      roleId: role.id,
      reportFields,
      callSiteTokens: [...reportFields, ...(PAYLOAD_FIELDS_BY_ROLE_ID[role.id] ?? [])],
      sharedBody,
      callSites: [sharedBody, ...agentHosts(role).map((host) => agentOutputPath(role, host))],
    },
  ];
});

function reportBlocksIn(contract: BoundContract, text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let fenced: string[] | null = null;
  for (const line of text.split("\n")) {
    if (!FENCE_LINE.test(line)) {
      if (fenced !== null) fenced.push(line);
      continue;
    }
    if (fenced !== null && REPORT_BLOCK_OPENING.test(fenced[0] ?? "")) {
      blocks.push({ roleId: contract.roleId, file: contract.sharedBody, text: fenced.join("\n"), reportFields: contract.reportFields });
    }
    fenced = fenced === null ? [] : null;
  }
  return blocks;
}

function missingTokens(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !text.includes(token));
}

function presentTokens(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => text.includes(token));
}

function statedNonProofBlock(block: ReportBlock): StatedNonProofBlock | undefined {
  return REPORT_BLOCKS_THE_PROOF_SCHEMA_DOES_NOT_BIND.find(
    (stated) => stated.roleId === block.roleId && block.text.includes(stated.distinctiveLine),
  );
}

const declaredBlocks = boundContracts.flatMap((contract) => reportBlocksIn(contract, readTrackedText(contract.sharedBody).text));
const proofBearingBlocks = declaredBlocks.filter((block) => statedNonProofBlock(block) === undefined);
const boundCallSites = boundContracts.flatMap((contract) =>
  contract.callSites.map((file) => ({ file, tokens: contract.callSiteTokens })),
);

const CALL_SITES_FLOOR = 8;
const CALL_SITES_FLOOR_DERIVATION =
  "the shared body of each of the two contracts the proof schema binds, plus the claude, codex and opencode render each " +
  "of them is written out to — the routing table's own count, which grows on its own the day a fourth host is added";

const DECLARED_BLOCKS_FLOOR = 4;
const DECLARED_BLOCKS_FLOOR_DERIVATION =
  "every fenced report block in the two shared bodies — the applier's done " +
  "report and the blocked report beside it, the verifier's slice and wave verdicts, and the worked example each shows";

provedSomething(
  `${boundCallSites.length} contract call site(s) were derived from the routing table for the proof schema`,
  boundCallSites.length >= CALL_SITES_FLOOR,
  `only ${boundCallSites.length} call site(s) were derived, under the ${CALL_SITES_FLOOR}-site floor (${CALL_SITES_FLOOR_DERIVATION})`,
);

provedSomething(
  `${declaredBlocks.length} fenced report block(s) were read out of the two shared bodies themselves`,
  declaredBlocks.length >= DECLARED_BLOCKS_FLOOR,
  `only ${declaredBlocks.length} block(s) were read, under the ${DECLARED_BLOCKS_FLOOR}-block floor (${DECLARED_BLOCKS_FLOOR_DERIVATION})`,
);

describe(
  "the block inventory is read out of the two contracts themselves — every fenced report block either carries the " +
    "proof schema or is stated here, with its reason, as a block the schema does not bind; a shape added tomorrow " +
    "joins the inventory on its own, and no exclusion on its own",
  () => {
    test("each stated non-proof block matches exactly one block, so an exclusion gone stale fails rather than quietly shrinking the inventory", () => {
      const drifted = REPORT_BLOCKS_THE_PROOF_SCHEMA_DOES_NOT_BIND.map(({ roleId, distinctiveLine, reason }) => ({
        distinctiveLine,
        reason,
        matches: declaredBlocks.filter((block) => block.roleId === roleId && block.text.includes(distinctiveLine)).length,
      }))
        .filter(({ matches }) => matches !== 1)
        .map(({ distinctiveLine, matches, reason }) => `${matches} block(s) match "${distinctiveLine}" (${reason})`);
      assert.deepEqual(drifted, [], drifted.join("\n"));
    });

    test(`the ${declaredBlocks.length} declared block(s) split into proof-bearing blocks and stated non-proof blocks with none left over`, () => {
      const statedAway = declaredBlocks.filter((block) => statedNonProofBlock(block) !== undefined);
      assert.equal(proofBearingBlocks.length + statedAway.length, declaredBlocks.length);
      assert.equal(statedAway.length, REPORT_BLOCKS_THE_PROOF_SCHEMA_DOES_NOT_BIND.length);
    });

    test("every contract the schema binds declares at least one proof-bearing block, so none passes by declaring no shape at all", () => {
      const silent = boundContracts
        .filter((contract) => !proofBearingBlocks.some((block) => block.roleId === contract.roleId))
        .map((contract) => contract.roleId);
      assert.deepEqual(silent, [], silent.join("\n"));
    });
  },
);

describe("each proof-bearing block spells its report fields inside the block a delegate copies, never only in the prose around it", () => {
  for (const [index, block] of proofBearingBlocks.entries()) {
    test(`${block.roleId}'s proof-bearing block ${index} in ${block.file} spells ${block.reportFields.join(" and ")}`, () => {
      const absent = missingTokens(block.text, block.reportFields);
      assert.deepEqual(absent, [], `a proof-bearing block in ${block.file} never spells ${absent.join(", ")}`);
    });
  }
});

describe("the verifier handoff header carries only the three applier report blocks", () => {
  test("the shared header lists proof, scan, and decisions_used in order and no other report fields", () => {
    const handoff = verifierContract.match(/```\n=== applier_proof ===\n([\s\S]*?)\n```/)?.[1] ?? "";
    assert.deepEqual(
      handoff.split("\n").filter((line) => APPLIER_REPORT_FIELDS.some((field) => line === field)),
      [...APPLIER_REPORT_FIELDS],
    );
    assert.doesNotMatch(handoff, /^(?:status|files|findings|self_check):/m);
  });
});

describe(`the schema reaches every call site the routing table names, and reached none of them at ${RED_COMMIT}`, () => {
  for (const { file, tokens } of boundCallSites) {
    test(`RED at ${RED_COMMIT}: ${file} spells none of ${tokens.join(", ")}`, () => {
      const spelled = presentTokens(readTextAtCommit(RED_COMMIT, file), tokens);
      assert.deepEqual(spelled, [], `${file} already spelled ${spelled.join(", ")} at ${RED_COMMIT}`);
    });

    test(`GREEN on the tracked tree: ${file} spells every one of ${tokens.join(", ")}`, () => {
      const absent = missingTokens(readTrackedText(file).text, tokens);
      assert.deepEqual(absent, [], `${file} never spells ${absent.join(", ")}`);
    });
  }

  for (const file of boundContracts.find((contract) => contract.roleId === "oso-verifier")!.callSites) {
    test(`${file} delivers the complete worked verdict`, () => {
      const example = readTrackedText(file).text.match(/#### A worked verdict\n\n```\n([\s\S]*?)\n```/)?.[1] ?? "";
      assert.deepEqual(exampleEvidenceGaps(example), []);
    });
  }
});

describe("the walk, read over a planted contract this repository does not ship", () => {
  const planted: BoundContract = {
    roleId: "oso-planted",
    reportFields: ["proof:", "scan:"],
    callSiteTokens: ["proof:", "scan:"],
    sharedBody: "planted/body.md",
    callSites: ["planted/body.md"],
  };

  test("a fenced block opening `status: ` is read as a report block and a shell transcript beside it is not", () => {
    const text = "```\nstatus: done\nproof:\n```\n\ntext\n\n```\nnpm test\n```\n";
    assert.deepEqual(
      reportBlocksIn(planted, text).map((block) => block.text),
      ["status: done\nproof:"],
    );
  });

  test("a planted block that dropped `scan:` is reported missing it, so a dropped field cannot pass unseen", () => {
    const [block] = reportBlocksIn(planted, "```\nstatus: done\nproof:\n```\n");
    assert.deepEqual(missingTokens(block?.text ?? "", planted.reportFields), ["scan:"]);
  });
});
