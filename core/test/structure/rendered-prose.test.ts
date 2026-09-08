import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  AGENT_ROLES,
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

test("all seven native custom roles disable Engram without replacing their instructions", () => {
  assert.equal(AGENT_ROLES.length, 7);
  for (const role of AGENT_ROLES) {
    const rendered = parseTomlDocument(renderAgent(role, "codex", "body\n", null), role.id);
    assert.deepEqual(rendered["mcp_servers"], { engram: { enabled: false } });
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
