import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  agentPermissionField,
  agentPermissionVerdicts,
  externalDirectoryRules,
  externalDirectoryVerdict,
  fieldOf,
} from "./config-fields.ts";

const AGENT = "oso-verifier";
const FIX_APPLY_TOOL_ID = "fallow_fix_apply";

function configWhoseAgentSpells(...rules: readonly (readonly [string, unknown])[]): unknown {
  return { agent: { [AGENT]: { permission: Object.fromEntries(rules) } } };
}

describe("agentPermissionVerdicts resolves the verdict the host reaches for a tool, where agentPermissionField reads only the key's spelling", () => {
  test("a server wildcard covers the tool it subsumes, which the literal key alone reports absent", () => {
    const document = configWhoseAgentSpells(["fallow_*", "deny"]);
    assert.equal(fieldOf(agentPermissionVerdicts(document, FIX_APPLY_TOOL_ID), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionField(document, FIX_APPLY_TOOL_ID), AGENT), "absent");
  });

  test("the literal key resolves the same verdict as the wildcard that would have covered it", () => {
    const document = configWhoseAgentSpells([FIX_APPLY_TOOL_ID, "deny"]);
    assert.equal(fieldOf(agentPermissionVerdicts(document, FIX_APPLY_TOOL_ID), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionField(document, FIX_APPLY_TOOL_ID), AGENT), "deny");
  });

  test("a later key reopening the tool wins over the earlier wildcard that denied it, as the host's findLast does", () => {
    const reopened = configWhoseAgentSpells(["fallow_*", "deny"], [FIX_APPLY_TOOL_ID, "allow"]);
    assert.equal(fieldOf(agentPermissionVerdicts(reopened, FIX_APPLY_TOOL_ID), AGENT), "allow");
    const denied = configWhoseAgentSpells([FIX_APPLY_TOOL_ID, "allow"], ["fallow_*", "deny"]);
    assert.equal(fieldOf(agentPermissionVerdicts(denied, FIX_APPLY_TOOL_ID), AGENT), "deny");
  });

  test("a block naming no rule that covers the tool reads absent, so a deny the block never spelled is never reported", () => {
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["engram_*", "deny"]), FIX_APPLY_TOOL_ID), AGENT), "absent");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(), FIX_APPLY_TOOL_ID), AGENT), "absent");
    assert.equal(fieldOf(agentPermissionVerdicts({}, FIX_APPLY_TOOL_ID), AGENT), "absent");
  });

  test("a rule carrying an allowlist object rather than a verdict string reads allowlist, the reading the literal key already gave it", () => {
    const document = configWhoseAgentSpells(["bash", { "*": "allow" }]);
    assert.equal(fieldOf(agentPermissionVerdicts(document, "bash"), AGENT), "allowlist");
  });
});

describe("the wildcard translation this resolver borrows from the host's own matcher", () => {
  test("a bare * covers every tool and a ? covers exactly one character of one", () => {
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["*", "deny"]), FIX_APPLY_TOOL_ID), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["oso_wav?", "deny"]), "oso_wave"), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["oso_wav?", "deny"]), "oso_wavee"), AGENT), "absent");
  });

  test("a dot in a key is a dot and not any character, so a neighbouring tool id is not swept up with it", () => {
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["oso.wave", "deny"]), "oso.wave"), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["oso.wave", "deny"]), "osoXwave"), AGENT), "absent");
  });

  test("a key ending in a space and a star also covers the bare verb, the tail the host's matcher makes optional", () => {
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["git *", "deny"]), "git"), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["git *", "deny"]), "git commit"), AGENT), "deny");
    assert.equal(fieldOf(agentPermissionVerdicts(configWhoseAgentSpells(["git *", "deny"]), "gita"), AGENT), "absent");
  });
});

const SANDBOX_HOME = "/sandbox/home";
const INSTALLED_SKILL_FILE = `${SANDBOX_HOME}/.config/opencode/skill/oso-plan/SKILL.md`;

function configWhoseExternalDirectoryBlockSpells(...rules: readonly (readonly [string, unknown])[]): unknown {
  return { permission: { external_directory: Object.fromEntries(rules) } };
}

describe("externalDirectoryVerdict resolves a host path through the external_directory block the rendered config spells", () => {
  test("a config spelling no external_directory block resolves the harness's own paths to nothing at all", () => {
    assert.deepEqual([...externalDirectoryRules({ permission: {} })], []);
    assert.equal(externalDirectoryVerdict({ permission: {} }, SANDBOX_HOME, INSTALLED_SKILL_FILE), "absent");
    assert.equal(externalDirectoryVerdict({}, SANDBOX_HOME, INSTALLED_SKILL_FILE), "absent");
  });

  test("a ~/ pattern is expanded against the home it is resolved under, the way the host expands it before matching", () => {
    const document = configWhoseExternalDirectoryBlockSpells(["~/.config/opencode/**", "allow"]);
    assert.equal(externalDirectoryVerdict(document, SANDBOX_HOME, INSTALLED_SKILL_FILE), "allow");
    assert.equal(externalDirectoryVerdict(document, "/sandbox/another-home", INSTALLED_SKILL_FILE), "absent");
    assert.equal(externalDirectoryVerdict(document, SANDBOX_HOME, "~/.config/opencode/skill/oso-plan/SKILL.md"), "absent");
  });

  test("the block reads back as the patterns it spells, tilde and all, rather than as the paths they expand to", () => {
    const document = configWhoseExternalDirectoryBlockSpells(["~/.local/state/oso-code/**", "allow"]);
    assert.deepEqual([...externalDirectoryRules(document)], [["~/.local/state/oso-code/**", "allow"]]);
  });

  test("a later pattern covering the same path wins over the earlier one, as the host's findLast does", () => {
    const reopened = configWhoseExternalDirectoryBlockSpells(["~/.config/**", "ask"], ["~/.config/opencode/**", "allow"]);
    assert.equal(externalDirectoryVerdict(reopened, SANDBOX_HOME, INSTALLED_SKILL_FILE), "allow");
    const narrowed = configWhoseExternalDirectoryBlockSpells(["~/.config/opencode/**", "allow"], ["~/.config/**", "ask"]);
    assert.equal(externalDirectoryVerdict(narrowed, SANDBOX_HOME, INSTALLED_SKILL_FILE), "ask");
  });

  test("a path under no pattern the block spells reads absent, so an allow the block never gave is never reported", () => {
    const document = configWhoseExternalDirectoryBlockSpells(["~/.config/opencode/**", "allow"]);
    assert.equal(externalDirectoryVerdict(document, SANDBOX_HOME, `${SANDBOX_HOME}/Documents/private-notes.md`), "absent");
  });
});
