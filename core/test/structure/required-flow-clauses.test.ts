import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { APPLIER_PROOF_HEADER } from "../../src/prose/applier-proof.ts";
import { AGENT_ROLES, agentHosts, agentOutputPath, agentSharedBodyPath } from "../../src/prose/render.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type Target = Readonly<{ files: readonly string[]; tokens: readonly string[] }>;
type Row = Readonly<{ contract: string; targets: readonly Target[] }>;

const PLAN_FLOWS = ["plugin/skills/plan/SKILL.md", "opencode/skills/oso-plan/SKILL.md"];
const DEBUG_FLOWS = ["plugin/skills/debug/SKILL.md", "opencode/skills/oso-debug/SKILL.md"];
const CLOSING_FLOWS = ["plugin/skills/plan/SKILL.md", "plugin/skills/quick/SKILL.md", "plugin/skills/debug/SKILL.md"];
const PLAN_AND_DEBUG_FLOWS = [...PLAN_FLOWS, ...DEBUG_FLOWS];
const FLOWS_THAT_LAUNCH_DELEGATES = [
  "plugin/skills/plan/SKILL.md",
  "plugin/skills/debug/SKILL.md",
  "plugin/skills/quick/SKILL.md",
  "plugin/skills/_shared/parallel.md",
  "plugin/skills/_shared/front-surface.md",
];
const CLAUDE_BINDINGS = [
  "plugin/skills/plan/references/claude.md",
  "plugin/skills/debug/references/claude.md",
  "plugin/skills/quick/references/claude.md",
  "plugin/skills/_shared/references/claude.md",
];
const REPORTING = "plugin/skills/_shared/reporting.md";
const PARALLEL = "plugin/skills/_shared/parallel.md";
const RUBRIC = "plugin/skills/_shared/rubric.md";
const VERIFIER_BODY = "core/src/prose/agents/oso-verifier/body.md";
const APPLIER_BODY = "core/src/prose/agents/oso-applier/body.md";
const VERIFIER_CONTRACTS = [VERIFIER_BODY, "plugin/agents/oso-verifier.md", "opencode/agents/oso-verifier.md"];

function contractFiles(roleId: string): string[] {
  return AGENT_ROLES.filter((role) => role.id === roleId).flatMap((role) => [
    agentSharedBodyPath(role),
    ...agentHosts(role).map((host) => agentOutputPath(role, host)),
  ]);
}

const ROWS: readonly Row[] = [
  {
    contract: "fix loops are capped at two rounds with a marked diagnosis, escalation and empty-result route",
    targets: [
      {
        files: PLAN_AND_DEBUG_FLOWS,
        tokens: ["at most TWO fix rounds", "`oso-state mark diagnosed`", "`oso-state mark escalated`", "`oso-state mark empty-result`"],
      },
      { files: [PARALLEL], tokens: ["two-round cap"] },
    ],
  },
  {
    contract: "an operator ruling is recorded verbatim and settles a finding before a fresh verifier is relaunched",
    targets: [
      { files: [RUBRIC], tokens: ["binds once recorded as an `Operator ruling`", "except for a hardcoded secret"] },
      { files: VERIFIER_CONTRACTS, tokens: ["may include an `Operator ruling`", "`held — operator ruling <id>`"] },
      { files: PLAN_AND_DEBUG_FLOWS, tokens: ["verbatim as a dated `Operator ruling` amendment", "then relaunch a FRESH verifier"] },
    ],
  },
  {
    contract: "every slice launch spells the decision block, the red exception and the refuted-claim route",
    targets: [
      { files: PLAN_AND_DEBUG_FLOWS, tokens: ["DECISION BLOCK", "red: exception", "refuted claim"] },
      { files: [REPORTING], tokens: ["proof:", "scan:", "decisions_used:"] },
    ],
  },
  {
    contract: "the agent contracts carry the proof schema in their reports and the verifier handoff",
    targets: [
      { files: contractFiles("oso-applier"), tokens: ["proof:", "scan:"] },
      { files: contractFiles("oso-verifier"), tokens: ["claims:", APPLIER_PROOF_HEADER, "decisions_used:"] },
    ],
  },
  {
    contract: "the verifier contract carries the batch shape and the applier reports its risk surface",
    targets: [
      { files: VERIFIER_CONTRACTS, tokens: ["slice: <id>", "token: <name>", "risk: high <reason>", "up to 3 slice packets"] },
      { files: contractFiles("oso-applier"), tokens: ["risk-surface:"] },
    ],
  },
  {
    contract: "the verifier contract gives each batched slice its own verdict",
    targets: [{ files: VERIFIER_CONTRACTS, tokens: ["verify a BATCH of up to 3 implemented slices and give each slice its own verdict"] }],
  },
  {
    contract: "every launch carries the model the profile names and the milestone names it",
    targets: [
      { files: FLOWS_THAT_LAUNCH_DELEGATES, tokens: ["the model the profile names for its role", "named in the Launching milestone"] },
      { files: CLAUDE_BINDINGS, tokens: ["`model` parameter"] },
    ],
  },
  {
    contract: "work is routed by size and every slice gets its own verifier verdict, fresh and solo where the debug flow or high risk asks for it",
    targets: [
      { files: [REPORTING], tokens: ["one non-trivial file", "mechanical edit of any breadth", "applier agent"] },
      { files: PLAN_AND_DEBUG_FLOWS, tokens: ["threshold defined at `_shared/reporting.md`"] },
      { files: PLAN_FLOWS, tokens: ["its OWN verifier verdict", "fresh solo verifier"] },
      { files: DEBUG_FLOWS, tokens: ["FRESH verifier"] },
    ],
  },
  {
    contract: "plan slices state a risk and the execution mode is chosen automatically and overridable at approval",
    targets: [{ files: PLAN_FLOWS, tokens: ["**Risk**", "AUTOMATIC", "doubt is high"] }],
  },
  {
    contract: "the wave loop registers launch tokens, names the green slice and arms the wave with its slices",
    targets: [{ files: [PARALLEL], tokens: ["launch-token", "green_slice", "wave start"] }],
  },
  {
    contract: "plan, quick and debug release the gates with oso-state close",
    targets: [{ files: CLOSING_FLOWS, tokens: ["`oso-state close`"] }],
  },
  {
    contract: "registered generated-output comments stay visible candidates that need regeneration evidence",
    targets: [
      { files: [RUBRIC], tokens: ["verified builder-inserted annotation in a registered generated output", "no exemption"] },
      { files: [APPLIER_BODY], tokens: ["registered generated-output candidates", "regeneration evidence"] },
      { files: [VERIFIER_BODY], tokens: ["registered generated-output hits separately as candidates"] },
    ],
  },
];

function missingFrom(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !text.includes(token));
}

function problemsOf(targets: readonly Target[], read: (file: string) => string): string[] {
  return targets.flatMap(({ files, tokens }) =>
    files.flatMap((file) => missingFrom(read(file), tokens).map((token) => `${file} lacks "${token}"`)),
  );
}

const readFromTree = (file: string): string => readTrackedText(file).text;

for (const { contract, targets } of ROWS) {
  provedSomething(
    `${contract}: every target of the row lists files to read`,
    targets.length > 0 && targets.every(({ files }) => files.length > 0),
    `the row for "${contract}" resolved a target with no files`,
  );
}

describe("the flow prose keeps every required clause", () => {
  for (const { contract, targets } of ROWS) {
    test(contract, () => {
      const problems = problemsOf(targets, readFromTree);
      assert.deepEqual(problems, [], problems.join("\n"));
    });
  }
});

describe("the row matcher reports what it cannot find", () => {
  const synthetic = (text: string) => () => text;
  const targets: readonly Target[] = [{ files: ["synthetic.md"], tokens: ["alpha", "beta"] }];

  test("a required token missing from a synthetic text is reported, and a complete text is not", () => {
    assert.deepEqual(problemsOf(targets, synthetic("alpha only")), ['synthetic.md lacks "beta"']);
    assert.deepEqual(problemsOf(targets, synthetic("alpha and beta")), []);
  });
});

describe("the verifier contract never calls a batch independent", () => {
  for (const file of VERIFIER_CONTRACTS) {
    test(file, () => {
      const opening = readFromTree(file).split("\n").find((line) => line.includes("BATCH")) ?? "";
      const afterBatch = opening.slice(opening.indexOf("BATCH"));
      assert.doesNotMatch(afterBatch.split(". ")[0] ?? "", /independent/i);
    });
  }
});
