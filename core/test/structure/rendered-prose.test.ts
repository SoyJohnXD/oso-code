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
  type SkillHost,
} from "../../src/prose/render.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const SKILL_HOSTS: readonly SkillHost[] = ["codex", "opencode"];

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
    for (const host of SKILL_HOSTS) {
      test(`${stub.id} on ${host} renders the committed bytes, twice, identically`, () => {
        const body = readRepoText(skillBodyPath(stub, host));
        const flow = stub.flowFromClaudeSkill ? readRepoText(skillFlowPath(stub)) : null;
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
