import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH,
  mcpServerWildcard,
  mergeOpenCodeConfig,
  openCodeAgentModels,
  OPENCODE_AGENTS_THE_PROFILE_DRIVES,
  OWNED_MCP_NAMES,
  type ConfigDocument,
} from "../../src/install/opencode-config.ts";
import { opencodePathsFor } from "../../src/install/opencode.ts";
import {
  openCodeAgentMcpSurfaceStatus,
  openCodeServersReachableBeyondTheOwnedSet,
  operatorConfigSeed,
  OPERATOR_CONFIG_PROBE,
} from "../../src/install/verify-opencode.ts";
import { AGENT_ROLES } from "../../src/prose/routes.ts";
import { fixtureEnvironment, pathWithoutOpenCode, stageInstalledFixture } from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-agent-posture-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

const SHIPPED_AGENTS = path.join(repositoryRoot, "opencode", "agents");

const CUSTOM_APPLIER_MODEL = "ollama/a-model-the-profile-names-outright";

const OPERATOR_DECLARED_SERVER = "blender";

const BOUNDED_EDIT_AGENT = "oso-applier";

const NORMAL_PROFILE_ROLES = {
  applier: { tier: "default", model: undefined },
  verifier: { tier: "default", model: undefined },
  judges: { tier: "strong", model: undefined },
} as const;

provedSomething(
  `the profile drives ${OPENCODE_AGENTS_THE_PROFILE_DRIVES.length} of the ${AGENT_ROLES.length} OpenCode agents, over ${OWNED_MCP_NAMES.length} declared MCP server(s)`,
  OPENCODE_AGENTS_THE_PROFILE_DRIVES.length > 0 && OWNED_MCP_NAMES.length > 0 && AGENT_ROLES.length > 0,
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
    assert.deepEqual(OPENCODE_AGENTS_THE_PROFILE_DRIVES.filter((agent) => !rendered.includes(agent)), []);
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

describe("the edit verdict every rendered block now carries, the applier's bounded and the other six outright", () => {
  test("the six that never edit keep the scalar deny, and the applier is no longer the one block without an edit verdict", () => {
    const scalarDenials = AGENT_ROLES.filter((role) => permissionBlockOf(path.join(SHIPPED_AGENTS, `${role.id}.md`)).includes("edit: deny"));
    assert.deepEqual(
      scalarDenials.map((role) => role.id),
      AGENT_ROLES.filter((role) => role.id !== BOUNDED_EDIT_AGENT).map((role) => role.id),
    );
  });

  test("the applier's block carries the rules the host resolves by last match, the broad allow first and the denies after it", () => {
    assert.deepEqual(
      editBlockOf(path.join(SHIPPED_AGENTS, `${BOUNDED_EDIT_AGENT}.md`)),
      EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.map((rule) => `    "${rule.pattern}": ${rule.verdict}`),
    );
  });

  test("every denied surface is spelled in both shapes, the bare one the host derives in-project and the **/ one it derives for an absolute path", () => {
    const atAnyDepth = "**/";
    const denied = EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter((rule) => rule.verdict === "deny").map((rule) => rule.pattern);
    const unpaired = denied.filter((pattern) =>
      pattern.startsWith(atAnyDepth)
        ? !denied.includes(pattern.slice(atAnyDepth.length))
        : !denied.includes(`${atAnyDepth}${pattern}`),
    );
    assert.deepEqual(unpaired, []);
    assert.ok(denied.includes(".local/state/oso-code/**"), denied.join(" "));
  });

  test("every deny sits after the broad allow, which is the order the host's last-match read needs for any of them to bind", () => {
    const ordered = EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH;
    const broadAllow = ordered.findIndex((rule) => rule.pattern === "*" && rule.verdict === "allow");
    const denies = ordered.flatMap((rule, index) => (rule.verdict === "deny" ? [{ pattern: rule.pattern, index }] : []));
    assert.ok(broadAllow !== -1 && denies.length > 0, ordered.map((rule) => rule.pattern).join(" "));
    assert.deepEqual(denies.filter(({ index }) => index < broadAllow), []);
  });

  test("the nested edit block leaves the MCP denials readable wherever it sits, so reordering the block cannot blind the owned-server row", () => {
    const configHome = agentTreeCopy("nested-edit-block-hoisted");
    hoistTheEditBlockIn(path.join(configHome, "agent", `${BOUNDED_EDIT_AGENT}.md`));
    assert.equal(openCodeAgentMcpSurfaceStatus(configHome), "closed");
  });
});

describe("the owned-server row is red before it is believed green", () => {
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

describe("what the row cannot close it prints: a server the operator declared is information, never a failure", () => {
  test("a config declaring only the owned three closes green with nothing left to print", () => {
    const configHome = agentTreeCopy("owned-set-only");
    const configFile = configDeclaring(configHome, OWNED_MCP_NAMES);
    assert.equal(openCodeAgentMcpSurfaceStatus(configHome), "closed");
    assert.deepEqual(openCodeServersReachableBeyondTheOwnedSet(configFile, configHome), []);
  });

  test("an operator server declared beside them leaves the row green and names the agents it stays reachable on", () => {
    const configHome = agentTreeCopy("an-operator-server");
    const configFile = configDeclaring(configHome, [...OWNED_MCP_NAMES, OPERATOR_DECLARED_SERVER]);
    assert.equal(openCodeAgentMcpSurfaceStatus(configHome), "closed");
    assert.deepEqual(openCodeServersReachableBeyondTheOwnedSet(configFile, configHome), [
      `${mcpServerWildcard(OPERATOR_DECLARED_SERVER)} (${AGENT_ROLES.length} of ${AGENT_ROLES.length} agents)`,
    ]);
  });

  test("a block that does deny it drops out of the tally, so the line reads the blocks rather than counting the roster", () => {
    const configHome = agentTreeCopy("an-operator-server-denied-once");
    const configFile = configDeclaring(configHome, [...OWNED_MCP_NAMES, OPERATOR_DECLARED_SERVER]);
    denyServerIn(path.join(configHome, "agent", "oso-triage.md"), OPERATOR_DECLARED_SERVER);
    assert.deepEqual(openCodeServersReachableBeyondTheOwnedSet(configFile, configHome), [
      `${mcpServerWildcard(OPERATOR_DECLARED_SERVER)} (${AGENT_ROLES.length - 1} of ${AGENT_ROLES.length} agents)`,
    ]);
  });

  test("a config no reader can reach prints no line, the config contract row above being the one that goes red on it", () => {
    const configHome = agentTreeCopy("an-unreadable-config");
    assert.deepEqual(openCodeServersReachableBeyondTheOwnedSet(path.join(configHome, "opencode.json"), configHome), []);
  });
});

describe("an install carrying a profile writes the agent model keys the mirror names", () => {
  test("the six keys resolve through the operator's own session model fields", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const root = path.join(sandbox, "profiled-install");
    const home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
    assert.equal(profileSetIn(home, root, "normal").status, 0);
    const staged = stageInstalledFixture(root, { config: `${JSON.stringify(operatorConfigSeed(), null, 2)}\n` });
    const installed = JSON.parse(readFileSync(staged.configFile, "utf8")) as ConfigDocument;
    const agents = installed["agent"] as ConfigDocument;
    assert.deepEqual(Object.keys(agents).sort(), [...OPENCODE_AGENTS_THE_PROFILE_DRIVES, OPERATOR_CONFIG_PROBE.agentName].sort());
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

function editBlockOf(agentContract: string): readonly string[] {
  const lines = readFileSync(agentContract, "utf8").split("\n");
  const heading = lines.indexOf("  edit:");
  return heading === -1 ? [] : lines.slice(heading + 1, lines.indexOf("---", 1));
}

function hoistTheEditBlockIn(agentContract: string): void {
  const contract = readFileSync(agentContract, "utf8");
  const block = editBlockOf(agentContract);
  const hoisted = ["  edit:", ...block, ""].join("\n");
  writeFileSync(agentContract, contract.replace(hoisted, "").replace("permission:\n", `permission:\n${hoisted}`));
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

function configDeclaring(configHome: string, servers: readonly string[]): string {
  const configFile = path.join(configHome, "opencode.json");
  const declarations = servers.map((name) => [name, { type: "local", command: [name] }]);
  writeFileSync(configFile, `${JSON.stringify({ mcp: Object.fromEntries(declarations) }, null, 2)}\n`);
  return configFile;
}

function denyServerIn(agentContract: string, server: string): void {
  const block = "permission:\n";
  const contract = readFileSync(agentContract, "utf8");
  writeFileSync(agentContract, contract.replace(block, `${block}  ${mcpServerWildcard(server)}: deny\n`));
}

function profileSetIn(home: string, root: string, name: string) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, "bootstrap", "oso.js"), "profile", "set", name], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...fixtureEnvironment(home, pathWithoutOpenCode(), root), OSO_STATE_DIR: opencodePathsFor(home, {}).stateRoot },
  });
}
