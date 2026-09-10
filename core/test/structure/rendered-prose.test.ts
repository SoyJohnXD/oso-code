import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  AGENT_ROLES,
  type AgentRole,
  SHARED_REFERENCE_HOSTS,
  SKILL_STUBS,
  agentBodyPath,
  agentHosts,
  agentOutputPath,
  agentSharedBodyPath,
  renderAgent,
  renderReference,
  renderSkill,
  sharedReferenceOutputPath,
  sharedReferencePath,
  skillBodyPath,
  skillFlowPath,
  skillOutputPath,
  skillReferenceOutputPath,
  skillReferencePath,
} from "../../src/prose/render.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";

test("all seven native custom roles declare a valid disabled Engram transport without replacing their instructions", () => {
  assert.equal(AGENT_ROLES.length, 7);
  for (const role of AGENT_ROLES) {
    const rendered = parseTomlDocument(renderAgent(role, "codex", "body\n", null), role.id);
    assert.deepEqual(rendered["mcp_servers"], { engram: { command: "engram", args: ["mcp", "--tools=agent"], enabled: false } });
    assert.equal(rendered["developer_instructions"], "body\n");
  }
});

function readRepoText(file: string): string {
  return readFileSync(path.join(repositoryRoot, file), "utf8");
}

function readRepoTextOrNull(file: string): string | null {
  const absolute = path.join(repositoryRoot, file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

function shippedArtifactsOf(role: AgentRole): string[] {
  return [agentSharedBodyPath(role), ...agentHosts(role).map((host) => agentOutputPath(role, host))];
}

function testCodexOwnerObligations(concern: string, obligations: readonly RegExp[]): void {
  for (const owner of [sharedReferencePath("codex"), sharedReferenceOutputPath("codex")]) {
    test(`${owner} carries independent ${concern} obligations`, () => {
      const policy = readRepoText(owner);
      for (const obligation of obligations) assert.match(policy, obligation);
    });
  }
}

describe("prospective Codex command authoring delivers instructions, not native certification", () => {
  testCodexOwnerObligations("command-authoring", [
    /native hookable `apply_patch` for source edits/,
    /short, literal, foreground invocations of existing checks/,
    /separate from source edits/,
    /explicit WORKTREE PATH/,
    /whole invocation.*UTF-8.*lexer-owned LF/,
    /3072 bytes.*3071 raw bytes/,
    /unread.*not evidence of an observed deploy/,
    /Avoid shell-embedded editing programs.*unsupported wrapper-option introspection/,
    /Native tools, short commands and existing checks.*not blanket authorization/,
    /rejection.*stop for diagnosis/,
    /Never split, encode, create wrappers or scripts, retry through alternative tools, or change AUTO or permissions/,
  ]);

  for (const role of ["oso-applier", "oso-verifier"]) {
    test(`${role}'s actual native instructions require the shared owner before commands`, () => {
      const file = `codex/agents/${role}.toml`;
      const instructions = parseTomlDocument(readRepoText(file), file)["developer_instructions"];
      assert.equal(typeof instructions, "string");
      assert.match(instructions as string, /Before (?:editing or )?running commands, read and follow/);
      const route = (instructions as string).match(/`([^`]+)#command-authoring`/);
      assert.equal(route?.[1], sharedReferenceOutputPath("codex"));
      assert.match(readRepoText(route![1]!), /^## Command authoring$/m);
      assert.match(instructions as string, /owned.*handles.*completion/);
    });
  }
});

describe("a refused semantic-memory write leaves a delegated child an instruction, never a stop", () => {
  testCodexOwnerObligations("refused-memory-write", [
    /A refusal is an instruction, not a failure/,
    /continue the slice and hand the observation to the parent/,
    /never retry it, reword it, or route it through another tool/,
  ]);
});

provedSomething("core/src/prose/routes.ts names at least one agent role", AGENT_ROLES.length > 0, "AGENT_ROLES is empty, so this suite compared nothing");
provedSomething("core/src/prose/routes.ts names at least one skill stub", SKILL_STUBS.length > 0, "SKILL_STUBS is empty, so this suite compared nothing");

describe("every rendered agent file equals a fresh, deterministic render of its source", () => {
  for (const role of AGENT_ROLES) {
    for (const host of agentHosts(role)) {
      test(`${role.id} on ${host} renders the committed bytes, twice, identically`, () => {
        const sharedBody = readRepoText(agentSharedBodyPath(role));
        const delta = readRepoTextOrNull(agentBodyPath(role, host));
        const committed = readRepoText(agentOutputPath(role, host));
        assert.equal(renderAgent(role, host, sharedBody, delta), committed);
        assert.equal(renderAgent(role, host, sharedBody, delta), committed);
      });
    }
  }
});

describe("every rendered skill wrapper equals a fresh, deterministic render of its stub", () => {
  for (const stub of SKILL_STUBS) {
    for (const host of SHARED_REFERENCE_HOSTS) {
      test(`${stub.id} on ${host} renders the committed bytes, twice, identically`, () => {
        const body = readRepoText(skillBodyPath(stub, host));
        const flow = readRepoText(skillFlowPath(stub));
        const committed = readRepoText(skillOutputPath(stub, host));
        assert.equal(renderSkill(stub, host, body, flow), committed);
        assert.equal(renderSkill(stub, host, body, flow), committed);
      });
    }
  }
});

describe("every rendered skill reference equals a fresh, deterministic render of its source", () => {
  for (const stub of SKILL_STUBS) {
    for (const host of stub.referenceHosts) {
      test(`${stub.id}'s ${host} reference renders the committed bytes, twice, identically`, () => {
        const body = readRepoText(skillReferencePath(stub, host));
        const committed = readRepoText(skillReferenceOutputPath(stub, host));
        assert.equal(renderReference(body), committed);
        assert.equal(renderReference(body), committed);
      });
    }
  }
});

describe("every rendered shared-layer reference equals a fresh, deterministic render of its source", () => {
  for (const host of SHARED_REFERENCE_HOSTS) {
    test(`the shared layer's ${host} reference renders the committed bytes, twice, identically`, () => {
      const body = readRepoText(sharedReferencePath(host));
      const committed = readRepoText(sharedReferenceOutputPath(host));
      assert.equal(renderReference(body), committed);
      assert.equal(renderReference(body), committed);
    });
  }
});

test("Codex alone delivers the identity and corrective-quiescence binding; this is not native behavior evidence", () => {
  const binding = readRepoText(sharedReferencePath("codex"));
  const start = binding.indexOf("## Completion handshake\n");
  const end = binding.indexOf("## Owned verification scratch\n", start);
  assert.ok(start >= 0 && end > start);
  const policy = binding.slice(start, end);
  const rendered = readRepoText(sharedReferenceOutputPath("codex"));
  assert.ok(rendered.includes(policy));
  assert.ok(policy.includes("## Correction and quiescence\n"));
  assert.equal(readRepoText(sharedReferenceOutputPath("opencode")).includes(policy), false);
  for (const mode of ["plan", "debug"]) {
    const reference = readRepoText(`codex/skills/${mode}/references/codex.md`);
    assert.ok(reference.includes("**Completion handshake** and **Correction and quiescence**"));
    assert.ok(reference.includes("../_shared/references/codex.md"));
  }
});

describe("plugin/agents/ never gains a fourth file", () => {
  test("exactly three roles carry a claude spec", () => {
    const claudeRoles = AGENT_ROLES.filter((role) => role.claude !== null);
    assert.equal(claudeRoles.length, 3);
  });
});

describe("the renderer holds no per-role special case", () => {
  test("core/src/prose/render.ts names no role id or skill id as a literal", () => {
    const source = readRepoText("core/src/prose/render.ts");
    for (const id of [...AGENT_ROLES.map((role) => role.id), ...SKILL_STUBS.map((stub) => stub.id)]) {
      assert.ok(!source.includes(`"${id}"`), `render.ts names ${id} directly, which is a per-role special case`);
    }
  });
});
describe("Codex strict closure rendered contract", () => {
  test("all close bindings select the shared strict policy without changing other hosts", () => {
    for (const mode of ["plan", "roadmap", "quick", "debug", "debt-sweep"]) {
      const binding = readRepoText(`core/src/prose/skills/${mode}/references/codex.md`);
      assert.match(binding, /Strict closure/);
      assert.equal(readRepoText(`codex/skills/${mode}/references/codex.md`), renderReference(binding));
      assert.doesNotMatch(readRepoText(`core/src/prose/skills/${mode}/references/opencode.md`), /Strict closure/);
    }
  });

  test("closure routes resolve to one rendered owner without leaking into other hosts", () => {
    const owner = "plugin/skills/_shared/references/codex.md";
    const closure = readRepoText(owner);
    assert.equal(closure, renderReference(readRepoText("core/src/prose/shared/codex.md")));
    assert.equal(closure.split("## Strict closure\n").length - 1, 1);
    for (const mode of ["plan", "roadmap", "quick", "debug", "debt-sweep"]) {
      const skill = readRepoText(`codex/skills/${mode}/SKILL.md`);
      assert.ok(skill.includes("`references/codex.md`"));
      const binding = readRepoText(`codex/skills/${mode}/references/codex.md`);
      const route = binding.match(/`([^`]+)`'s \*\*Strict closure\*\*/);
      assert.ok(route?.[1], `${mode} has no shared closure route`);
      const target = path.posix.normalize(path.posix.join(`plugin/skills/${mode}`, route[1]));
      assert.equal(target, owner);
      assert.equal(binding.split("## Strict closure\n").length - 1, 0);
      assert.doesNotMatch(readRepoText(`plugin/skills/${mode}/references/claude.md`), /Strict closure/);
      assert.doesNotMatch(readRepoText(`opencode/skills/oso-${mode}/references/opencode.md`), /Strict closure/);
    }
  });

  test("closure rendering preserves each mode's existing frontmatter field", () => {
    for (const mode of ["plan", "roadmap", "quick", "debug", "debt-sweep"]) {
      const source = readRepoText(`plugin/skills/${mode}/SKILL.md`).split("---")[1];
      const rendered = readRepoText(`codex/skills/${mode}/SKILL.md`).split("---")[1];
      assert.ok(source, `${mode} source frontmatter is missing`);
      assert.ok(rendered, `${mode} rendered frontmatter is missing`);
      const preservedField = /^disable-model-invocation:.*$/m;
      assert.equal(rendered.match(preservedField)?.[0], source.match(preservedField)?.[0]);
    }
  });
});

const READINESS_SECTION = "## Readiness and freshness";

describe("readiness-driven Codex verification delivers instructions, not native scheduling", () => {
  testCodexOwnerObligations("readiness and freshness", [
    /A ready, isolated and quiescent slice may be verified while unrelated wave work is still in flight/,
    /inside the wave's existing dependency and isolation barriers and never in place of them/,
    /Default to one heavy suite or scratch materialization at a time/,
    /proven port, cache, output and environment isolation/,
    /existing sequential no-export route above once quiescence is proven, never a reduced check/,
    /shared verifier contract's \*\*Evidence and acceptance\*\* freshness binding/,
    /no-export runs included/,
    /Reconcile that binding again before the commit window/,
    /affected evidence must be current before green or commit/,
    /Every source writer and owned process of the slice has ended before a serialized green or commit window opens/,
    /the actual assembled tree at the integration gate; earlier slice greens never stand in for it/,
  ]);

  test("the readiness policy is owned once and reaches no other host", () => {
    const authored = readRepoText(sharedReferencePath("codex"));
    const start = authored.indexOf(`${READINESS_SECTION}\n`);
    const end = authored.indexOf("\n## ", start + 1);
    assert.ok(start >= 0 && end > start);
    assert.equal(authored.split(`${READINESS_SECTION}\n`).length - 1, 1);
    const policy = authored.slice(start, end);
    assert.ok(readRepoText(sharedReferenceOutputPath("codex")).includes(policy));
    assert.equal(readRepoText(sharedReferenceOutputPath("opencode")).includes(policy), false);
    assert.doesNotMatch(readRepoText(sharedReferencePath("opencode")), new RegExp(READINESS_SECTION, "m"));
  });

  test("oso-verifier's actual native instructions route to the readiness owner and declare no report shape of their own", () => {
    const file = "codex/agents/oso-verifier.toml";
    const instructions = parseTomlDocument(readRepoText(file), file)["developer_instructions"];
    assert.equal(typeof instructions, "string");
    const route = (instructions as string).match(/`([^`]+)#readiness-and-freshness`/);
    assert.equal(route?.[1], sharedReferenceOutputPath("codex"));
    assert.match(readRepoText(route![1]!), new RegExp(`^${READINESS_SECTION}$`, "m"));
    assert.match(instructions as string, /evidence:\n[\s\S]*freshness:/);
    assert.doesNotMatch(readRepoText("core/src/prose/agents/oso-verifier/codex.md"), /^```/m);
  });

  test("the shared wave loop gates readiness on a host binding and leaves its launch-order default intact", () => {
    const wave = readRepoText("plugin/skills/_shared/parallel.md");
    assert.ok(wave.includes("**Launch the appliers — N of them, read before anything moves, in ONE message.**"));
    assert.ok(wave.includes("These go in one message too, unless the concurrency answer below says this project's bar cannot be run N times at once."));
    const readiness = wave.split("\n\n").filter((paragraph) => paragraph.startsWith("**Readiness,"));
    assert.equal(readiness.length, 1);
    const [paragraph] = readiness as [string];
    assert.doesNotMatch(paragraph, /\bClaude(?: Code)?\b|\bCodex\b|\bOpenCode\b/);
    assert.match(paragraph, /A reference file that states no such route reads this paragraph as inapplicable, and the default above stands unchanged for it/);
    assert.match(paragraph, /A verification opens only against a slot actually free, never one a finished agent is assumed to have released/);
  });

  test("no host opts that wave loop in, so its slot rule binds nobody and every host keeps the unconditional default", () => {
    const binding = readRepoText("core/src/prose/skills/plan/references/codex.md");
    assert.doesNotMatch(binding, /`\.\.\/_shared\/parallel\.md`'s readiness paragraph is opted in HERE/);
    assert.equal(readRepoText("codex/skills/plan/references/codex.md"), renderReference(binding));
    for (const opter of ["core/src/prose/skills/plan/references/opencode.md", "plugin/skills/plan/references/claude.md"]) {
      assert.doesNotMatch(readRepoText(opter), /readiness/i);
    }
  });
});

const FRESHNESS_EVIDENCE_LINE = /^ *- freshness: (.+?)  before: (.+?)  after: (.+)$/gm;
const VERIFIER_FRESHNESS_LINES = 3;

const FRESHNESS_OBLIGATIONS: readonly RegExp[] = [
  /Bind evidence before and after checks to base, pending and staged content, dependencies and effective nonsecret environment; drift invalidates affected checks/,
  /Generated outputs are no freshness input — the bar regenerates them/,
  /the git index's raw bytes are never a cause on their own/,
  /An incidental index change is neither automatically a code change nor automatically ignorable: establish its effect on those inputs/,
];

describe("freshness compares the inputs the bar never rewrites, so an index-byte change alone refutes no check", () => {
  const verifier = AGENT_ROLES.find((role) => role.id === "oso-verifier")!;

  for (const artifact of shippedArtifactsOf(verifier)) {
    test(`${artifact} binds the effective inputs, excludes generated outputs and rules the index bytes out as a cause`, () => {
      const shipped = readRepoText(artifact);
      for (const obligation of FRESHNESS_OBLIGATIONS) assert.match(shipped, obligation);
      const bound = [...shipped.matchAll(FRESHNESS_EVIDENCE_LINE)];
      assert.equal(
        bound.length,
        VERIFIER_FRESHNESS_LINES,
        `${artifact} carries ${bound.length} freshness line(s) in freshness/before/after order, not the ${VERIFIER_FRESHNESS_LINES} its two verdict shapes and worked verdict carry`,
      );
      for (const [line, identities = ""] of bound) {
        assert.doesNotMatch(identities, /generated/i, `${line} still binds a generated identity the bar rewrites beneath it`);
      }
    });
  }
});

describe("Codex rations no child-agent capacity of its own", () => {
  const RETIRED = [
    /Reserve an actually free verifier slot/,
    /a completed agent's status is not proof that capacity was released/,
    /slot reservation/i,
    /uncertain capacity or an unavailable capability/,
  ];

  for (const owner of [sharedReferencePath("codex"), sharedReferenceOutputPath("codex"), "codex/agents/oso-verifier.toml", "core/src/prose/agents/oso-verifier/codex.md"]) {
    test(`${owner} rations no verifier slot and parks on no exhausted child capacity`, () => {
      const policy = readRepoText(owner);
      for (const retired of RETIRED) assert.doesNotMatch(policy, retired);
    });
  }
});

const UNKNOWN_FIELD_REPORT_NAME = "unknown_fields:";
const REPORT_LINE_NAMING_THE_FIELD = new RegExp(`^${UNKNOWN_FIELD_REPORT_NAME}`, "gm");
const REPORT_SHAPE_DECLARATION = new RegExp(`^${UNKNOWN_FIELD_REPORT_NAME} <`, "m");

type ClosedPayloadRule = Readonly<{ continues: RegExp; aborts: RegExp; reportLinesNamingTheField: number }>;

const SKILL_EXECUTOR_RULE: ClosedPayloadRule = {
  continues: /name a field beyond those two under `unknown_fields:` rather than stopping for it/,
  aborts: /if either field is absent, empty or renamed, report blocked before any work/,
  reportLinesNamingTheField: 0,
};

const CLOSED_PAYLOAD_RULES: Readonly<Record<string, ClosedPayloadRule>> = {
  "oso-applier": {
    continues: /a field no kind declares is not one of those and never stops you — name it under `unknown_fields:` and work past it/,
    aborts: /a field a kind declares that arrives missing, empty or renamed, so report blocked before any work/,
    reportLinesNamingTheField: 2,
  },
  "oso-verifier": {
    continues: /A field this contract does not declare is named under `unknown_fields:` and verified past, never a refusal on its name alone/,
    aborts: /a field it does declare that arrives missing, empty or renamed is `blocked` before any check runs/,
    reportLinesNamingTheField: 3,
  },
  "oso-integrator": {
    continues: /a field this contract does not declare stops nothing and rides in the report under `unknown_fields:`/,
    aborts: /`status: blocked` — the payload does not match what git actually holds, or a field it declares above is missing, empty or renamed, which stops you before the first merge/,
    reportLinesNamingTheField: 2,
  },
  "oso-triage": SKILL_EXECUTOR_RULE,
  "oso-security-reviewer": SKILL_EXECUTOR_RULE,
  "oso-doubt-pass": SKILL_EXECUTOR_RULE,
  "oso-debt-sweep": SKILL_EXECUTOR_RULE,
};

describe("an undeclared payload field costs the parent one named line; a declared one gone missing still costs the child its session", () => {
  test("every delegated role carries the rule, so a role added later is measured in rather than admitted unruled", () => {
    assert.deepEqual(Object.keys(CLOSED_PAYLOAD_RULES).sort(), AGENT_ROLES.map((role) => role.id).sort());
  });

  for (const role of AGENT_ROLES) {
    const rule = CLOSED_PAYLOAD_RULES[role.id];
    for (const artifact of shippedArtifactsOf(role)) {
      test(`${artifact} names an undeclared field and works past it, and stops on a declared one missing, empty or renamed`, () => {
        assert.ok(rule !== undefined, `${role.id} carries no recorded closed-payload rule`);
        const shipped = readRepoText(artifact);
        const continued = shipped.match(rule.continues)?.[0] ?? "";
        const aborted = shipped.match(rule.aborts)?.[0] ?? "";
        assert.ok(continued.includes(UNKNOWN_FIELD_REPORT_NAME), `${artifact} never names an undeclared field and works past it`);
        assert.ok(aborted.includes("blocked"), `${artifact} never refuses a declared field that arrives missing, empty or renamed`);
        assert.ok(!aborted.includes(UNKNOWN_FIELD_REPORT_NAME), `${artifact} spells both outcomes with one name a parent cannot tell apart`);
        const reportLines = shipped.match(REPORT_LINE_NAMING_THE_FIELD) ?? [];
        assert.equal(
          reportLines.length,
          rule.reportLinesNamingTheField,
          `${artifact} names ${UNKNOWN_FIELD_REPORT_NAME} on ${reportLines.length} report line(s), not the ${rule.reportLinesNamingTheField} its report shapes and worked reports carry`,
        );
        if (rule.reportLinesNamingTheField > 0) assert.match(shipped, REPORT_SHAPE_DECLARATION);
      });
    }
  }
});
