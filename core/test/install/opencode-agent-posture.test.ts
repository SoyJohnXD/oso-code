import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  mcpServerWildcard,
  mergeOpenCodeConfig,
  openCodeAgentModels,
  OPENCODE_AGENTS_PER_PROFILE_ROLE,
  OWNED_MCP_NAMES,
  type ConfigDocument,
} from "../../src/install/opencode-config.ts";
import { openCodeAgentMcpSurfaceStatus, operatorConfigSeed, OPERATOR_CONFIG_PROBE } from "../../src/install/verify-opencode.ts";
import { AGENT_ROLES } from "../../src/prose/routes.ts";
import { stageInstalledFixture } from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-agent-posture-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

const SHIPPED_AGENTS = path.join(repositoryRoot, "opencode", "agents");

const CUSTOM_APPLIER_MODEL = "ollama/a-model-the-profile-names-outright";

const NORMAL_PROFILE_ROLES = {
  applier: { tier: "default", model: undefined },
  verifier: { tier: "default", model: undefined },
  judges: { tier: "strong", model: undefined },
} as const;

const AGENTS_THE_PROFILE_DRIVES = Object.values(OPENCODE_AGENTS_PER_PROFILE_ROLE).flat();

provedSomething(
  `the profile drives ${AGENTS_THE_PROFILE_DRIVES.length} of the ${AGENT_ROLES.length} OpenCode agents, over ${OWNED_MCP_NAMES.length} declared MCP server(s)`,
  AGENTS_THE_PROFILE_DRIVES.length > 0 && OWNED_MCP_NAMES.length > 0 && AGENT_ROLES.length > 0,
  "no agent, role or server was read, so an empty walk below would report what a complete one does",
);

describe("the OpenCode spelling of a tier: it resolves through the operator's own session model fields, and a named model overrides both", () => {
  test("default reads small_model and strong reads model, so the normal preset splits the judges from the applier and verifier", () => {
    assert.deepEqual(openCodeAgentModels(operatorConfigSeed(), NORMAL_PROFILE_ROLES), {
      "oso-applier": OPERATOR_CONFIG_PROBE.sessionSmallModel,
      "oso-verifier": OPERATOR_CONFIG_PROBE.sessionSmallModel,
      "oso-debt-sweep": OPERATOR_CONFIG_PROBE.sessionModel,
      "oso-doubt-pass": OPERATOR_CONFIG_PROBE.sessionModel,
      "oso-security-reviewer": OPERATOR_CONFIG_PROBE.sessionModel,
      "oso-triage": OPERATOR_CONFIG_PROBE.sessionModel,
    });
  });

  test("a custom profile's own model string overrides the tier field it would otherwise have read", () => {
    const models = openCodeAgentModels(operatorConfigSeed(), {
      ...NORMAL_PROFILE_ROLES,
      applier: { tier: "strong", model: CUSTOM_APPLIER_MODEL },
    });
    assert.equal(models["oso-applier"], CUSTOM_APPLIER_MODEL);
    assert.equal(models["oso-verifier"], OPERATOR_CONFIG_PROBE.sessionSmallModel);
  });

  test("a config naming neither session model degrades to no key at all rather than to an empty one", () => {
    assert.deepEqual(openCodeAgentModels({ theme: OPERATOR_CONFIG_PROBE.theme }, NORMAL_PROFILE_ROLES), {});
  });

  test("a mirror naming no role leaves every agent on the host session model", () => {
    assert.deepEqual(openCodeAgentModels(operatorConfigSeed(), {}), {});
  });

  test("every agent the profile drives is an agent this repository renders for OpenCode", () => {
    const rendered = AGENT_ROLES.map((role) => role.id);
    assert.deepEqual(AGENTS_THE_PROFILE_DRIVES.filter((agent) => !rendered.includes(agent)), []);
  });
});

describe("the leaf merge into agent: the installer owns each oso agent's model key and nothing else under it", () => {
  test("the six keys land while an operator agent, its own keys and the rest of the document stay put", () => {
    const merged = mergeOpenCodeConfig(seedWithOperatorAgent(), "fallow-mcp", NORMAL_PROFILE_ROLES);
    const agents = merged.document["agent"] as ConfigDocument;
    assert.equal((agents["oso-applier"] as ConfigDocument)["model"], OPERATOR_CONFIG_PROBE.sessionSmallModel);
    assert.equal((agents["oso-applier"] as ConfigDocument)["temperature"], 0.1);
    assert.deepEqual(agents["operator-agent"], { model: "operator/own-model" });
    assert.equal(merged.document["small_model"], OPERATOR_CONFIG_PROBE.sessionSmallModel);
  });

  test("the operator's own agent is recorded as preserved and the six the installer wrote are not", () => {
    const merged = mergeOpenCodeConfig(seedWithOperatorAgent(), "fallow-mcp", NORMAL_PROFILE_ROLES);
    assert.ok(merged.preservedKeys.includes("agent.operator-agent"), merged.preservedKeys.join(" "));
    assert.deepEqual(merged.preservedKeys.filter((key) => key.startsWith("agent.oso-")), []);
  });

  test("with no profile the whole agent container stays an untouched operator key", () => {
    const merged = mergeOpenCodeConfig(seedWithOperatorAgent(), "fallow-mcp");
    assert.deepEqual(merged.agentModels, {});
    assert.deepEqual(merged.document["agent"], seedWithOperatorAgent()["agent"]);
    assert.ok(merged.preservedKeys.includes("agent"), merged.preservedKeys.join(" "));
  });
});

describe("the closed surface: each shipped block denies every declared MCP server outside its Claude twin's list", () => {
  for (const role of AGENT_ROLES) {
    test(`${role.id} keeps ${role.opencode.mcpServersTheClaudeTwinLists.join(", ") || "no server"} and denies the rest by wildcard`, () => {
      const denied = permissionBlockOf(path.join(SHIPPED_AGENTS, `${role.id}.md`));
      const kept: readonly string[] = role.opencode.mcpServersTheClaudeTwinLists;
      for (const server of OWNED_MCP_NAMES) {
        assert.equal(denied.includes(`${mcpServerWildcard(server)}: deny`), !kept.includes(server), `${role.id} on ${server}`);
      }
    });
  }

  test("the applier is the one role that keeps context7, and the debt-sweep the one that keeps fallow with its fix tool still denied", () => {
    assert.deepEqual(rolesKeeping("context7"), ["oso-applier"]);
    assert.deepEqual(rolesKeeping("engram"), []);
    assert.deepEqual(rolesKeeping("fallow"), ["oso-debt-sweep"]);
    assert.ok(permissionBlockOf(path.join(SHIPPED_AGENTS, "oso-debt-sweep.md")).includes("fallow_fix_apply: deny"));
  });
});

describe("the MCP surface row is red before it is believed green", () => {
  test("the shipped agent tree reads closed", () => {
    assert.equal(openCodeAgentMcpSurfaceStatus(agentTreeCopy("clean")), "closed");
  });

  test("a tree whose verifier block lets the engram server back through reads open, naming the agent and the server", () => {
    const configHome = agentTreeCopy("engram-reopened");
    const contract = path.join(configHome, "agent", "oso-verifier.md");
    writeFileSync(contract, readFileSync(contract, "utf8").replace(`  ${mcpServerWildcard("engram")}: deny\n`, ""));
    assert.equal(openCodeAgentMcpSurfaceStatus(configHome), "open: oso-verifier.md:engram_*");
  });

  test("a tree short one agent reads its count rather than the emptiness a shorter walk would report", () => {
    const configHome = agentTreeCopy("one-agent-short");
    rmSync(path.join(configHome, "agent", "oso-triage.md"), { force: true });
    assert.equal(openCodeAgentMcpSurfaceStatus(configHome), `count:${AGENT_ROLES.length - 1}!=${AGENT_ROLES.length}`);
  });
});

describe("an install carrying a profile writes the agent model keys the mirror names", () => {
  test("the six keys resolve through the operator's own session model fields", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const root = path.join(sandbox, "profiled-install");
    const home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
    assert.equal(profileSetIn(home, "normal").status, 0);
    const staged = stageInstalledFixture(root, { config: `${JSON.stringify(operatorConfigSeed(), null, 2)}\n` });
    const installed = JSON.parse(readFileSync(staged.configFile, "utf8")) as ConfigDocument;
    const agents = installed["agent"] as ConfigDocument;
    assert.deepEqual(Object.keys(agents).sort(), [...AGENTS_THE_PROFILE_DRIVES].sort());
    assert.equal((agents["oso-verifier"] as ConfigDocument)["model"], OPERATOR_CONFIG_PROBE.sessionSmallModel);
    assert.equal((agents["oso-triage"] as ConfigDocument)["model"], OPERATOR_CONFIG_PROBE.sessionModel);
  });
});

function rolesKeeping(server: string): string[] {
  return AGENT_ROLES.filter((role) => (role.opencode.mcpServersTheClaudeTwinLists as readonly string[]).includes(server)).map((role) => role.id);
}

function seedWithOperatorAgent(): ConfigDocument {
  return { ...operatorConfigSeed(), agent: { "operator-agent": { model: "operator/own-model" }, "oso-applier": { temperature: 0.1 } } };
}

function permissionBlockOf(agentContract: string): readonly string[] {
  const lines = readFileSync(agentContract, "utf8").split("\n");
  return lines
    .slice(1, lines.indexOf("---", 1))
    .map((line) => line.trim())
    .filter((line) => line.endsWith(": deny"));
}

function agentTreeCopy(name: string): string {
  const configHome = path.join(sandbox, name);
  cpSync(SHIPPED_AGENTS, path.join(configHome, "agent"), { recursive: true });
  return configHome;
}

function profileSetIn(home: string, name: string) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, "bootstrap", "oso.js"), "profile", "set", name], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}
