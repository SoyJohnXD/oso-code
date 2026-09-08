import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { VerifyReport } from "../../src/install/report.ts";
import { checkAgentPayload, checkEngramWiring, checkMarketplacePayload, checkPublishedRuntimeBytes } from "../../src/install/verify-codex.ts";
import { codexPathsFor, installCodex, repairCodex } from "../../src/install/codex.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";

const home = mkdtempSync(path.join(tmpdir(), "oso-essential-memory-"));
after(() => rmSync(home, { recursive: true, force: true }));

test("fresh install and repair use native defaults and direct MCP without invoking Engram setup", () => {
  const codexHome = path.join(home, ".codex");
  mkdirSync(codexHome);
  let setupCalls = 0;
  const host = { ...pinnedHost(), setupEngram: () => { setupCalls += 1; return { ok: false, output: "setup must not execute" }; } };
  const input = { homeDirectory: home, repositoryRoot: fixtureRepositoryRoot(), environment: { PATH: "", CODEX_HOME: codexHome }, platform: "linux" as const, host, assumeYes: true, installGitHook: false };
  for (const run of [installCodex, repairCodex, installCodex]) {
    const outcome = run(input);
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(setupCalls, 0);
    const config = parseTomlDocument(readFileSync(path.join(codexHome, "config.toml"), "utf8"), "fixture");
    assert.equal(config["model_instructions_file"], undefined);
    assert.equal(config["experimental_compact_prompt_file"], undefined);
    assert.deepEqual((config["mcp_servers"] as Record<string, unknown>)["engram"], { command: "engram", args: ["mcp", "--tools=agent"] });
    assert.deepEqual((config["plugins"] as Record<string, unknown>)["engram@engram"], { enabled: false });
  }
});


test("managed essential-memory verification accepts native defaults separately from direct MCP functionality", () => {
  const paths = codexPathsFor(home, { CODEX_HOME: path.join(home, "verification") });
  mkdirSync(paths.codexHome);
  writeFileSync(paths.configFile, '[mcp_servers.engram]\ncommand = "engram"\nargs = ["mcp", "--tools=agent"]\n[plugins."engram@engram"]\nenabled = false\n');
  const report = new VerifyReport();
  checkEngramWiring(report, paths, true);
  assert.equal(report.exitCode, 0, report.render());
  assert.match(report.render(), /managed essential-memory configuration/);
});

for (const reject of [false, true, "registration"] as const) {
  test(`legacy repair refreshes owned payload transactionally with post-stage rejection=${reject}`, () => {
    const fixture = path.join(home, `repair-${reject}`);
    const repositoryRoot = fixtureRepositoryRoot();
    const paths = codexPathsFor(fixture, {});
    const input = { homeDirectory: fixture, repositoryRoot, environment: { PATH: "", HOME: fixture, USERPROFILE: fixture }, platform: "linux" as const, host: pinnedHost(), assumeYes: true, installGitHook: false, installImpeccable: false };
    assert.equal(installCodex(input).exitCode, 0);
    const staleTargets = [
      path.join(paths.agentsTarget, "oso-applier.toml"),
      path.join(paths.runtimeRoot, "dist", "gate.js"),
      path.join(paths.marketplaceRoot, "codex", "skills", "_shared", "references", "codex.md"),
    ];
    for (const target of staleTargets) writeFileSync(target, "stale owned payload\n");
    for (const check of [checkAgentPayload, checkMarketplacePayload, checkPublishedRuntimeBytes]) {
      const report = new VerifyReport();
      check(report, paths, repositoryRoot);
      assert.equal(report.exitCode, 1, report.render());
    }
    const mcp = new VerifyReport();
    checkEngramWiring(mcp, paths, true);
    assert.equal(mcp.exitCode, 0, mcp.render());
    writeFileSync(path.join(paths.agentsTarget, "user.toml"), 'name = "user"\n');
    const cachedPlugin = path.join(paths.codexHome, "plugins", "cache", "operator.txt");
    mkdirSync(path.dirname(cachedPlugin), { recursive: true });
    writeFileSync(cachedPlugin, "original plugin bytes\n");
    const snapshot = () => Object.fromEntries([paths.codexHome, paths.marketplaceRoot, paths.runtimeRoot].flatMap((root) => readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
      const target = path.join(entry.parentPath, entry.name);
      return [target, readFileSync(target).toString("base64")];
    })));
    const before = snapshot();
    let staged = false;
    let pluginCalls = 0;
    const host = pinnedHost({
      acceptsConfig: () => {
        staged = staleTargets.every((target) => readFileSync(target, "utf8") !== "stale owned payload\n");
        return reject !== true;
      },
      marketplaceAdd: (source) => {
        assert.equal(source, paths.marketplaceRoot);
        return { ok: true, output: JSON.stringify({ marketplaceName: "oso-code", installedRoot: source }) };
      },
      pluginAdd: (pluginId) => {
        assert.equal(pluginId, "oso-code@oso-code");
        pluginCalls += 1;
        if (reject === "registration") {
          writeFileSync(cachedPlugin, "host registration wrote before failing\n");
          return { ok: false, output: "forced post-stage registration failure" };
        }
        return { ok: true, output: JSON.stringify({ pluginId }) };
      },
    });
    const outcome = repairCodex({ ...input, host });
    assert.equal(staged, true, `repair must stage all owned M1 payloads before config acceptance: ${outcome.report}`);
    assert.equal(outcome.exitCode, reject ? 1 : 0, outcome.report);
    if (reject) {
      assert.deepEqual(snapshot(), before);
      assert.match(outcome.report, /rolled back/);
    } else {
      assert.equal(pluginCalls, 1);
      assert.equal(readFileSync(path.join(paths.agentsTarget, "user.toml"), "utf8"), 'name = "user"\n');
      const repaired = snapshot();
      for (const check of [checkAgentPayload, checkMarketplacePayload, checkPublishedRuntimeBytes]) {
        const report = new VerifyReport();
        check(report, paths, repositoryRoot);
        assert.equal(report.exitCode, 0, report.render());
      }
      assert.equal(repairCodex({ ...input, host }).exitCode, 0);
      assert.deepEqual(snapshot(), repaired);
    }
  });
}

for (const run of [installCodex, repairCodex]) {
  test(`${run.name} normalizes host rewrites while preserving unrelated policy and operator MCP leaves`, () => {
    const fixture = path.join(home, `post-host-${run.name}`);
    const paths = codexPathsFor(fixture, {});
    mkdirSync(paths.codexHome, { recursive: true });
    writeFileSync(paths.configFile, [
      'developer_instructions = "operator text mentions engram"',
      '[plugins."operator-engram@custom"]',
      'enabled = true',
      '[[skills.config]]',
      'path = "/operator/engram-skill"',
      'enabled = true',
      '[mcp_servers.engram]',
      'command = "operator-engram"',
      'args = ["operator"]',
      'env = { ENGRAM_DATA_DIR = "operator-memory" }',
      'startup_timeout_sec = 45',
      '',
    ].join("\n"));
    let hostWrites = 0;
    const host = pinnedHost({ pluginAdd: (pluginId) => {
      hostWrites += 1;
      const config = readFileSync(paths.configFile, "utf8");
      writeFileSync(paths.configFile,
        `model_instructions_file = ${JSON.stringify(path.join(paths.codexHome, "engram-instructions.md"))}\n` +
        `experimental_compact_prompt_file = ${JSON.stringify(path.join(paths.codexHome, "engram-compact-prompt.md"))}\n` +
        config.replace('command = "engram"', 'command = "host-engram"').replace('["mcp", "--tools=agent"]', '["host"]')
          .replace('enabled = false', 'enabled = true').replace('operator-memory', 'host-memory'));
      return { ok: true, output: JSON.stringify({ pluginId }) };
    } });
    const outcome = run({ homeDirectory: fixture, repositoryRoot: fixtureRepositoryRoot(), environment: { PATH: "" }, platform: "linux", host, assumeYes: true, installGitHook: false, installImpeccable: false });
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(hostWrites, 1);
    const config = parseTomlDocument(readFileSync(paths.configFile, "utf8"), paths.configFile);
    assert.equal(config["model_instructions_file"], undefined);
    assert.equal(config["experimental_compact_prompt_file"], undefined);
    assert.deepEqual((config["mcp_servers"] as Record<string, unknown>)["engram"], { command: "engram", args: ["mcp", "--tools=agent"], env: { ENGRAM_DATA_DIR: "operator-memory" }, startup_timeout_sec: 45 });
    assert.deepEqual((config["plugins"] as Record<string, unknown>)["engram@engram"], { enabled: false });
    assert.deepEqual((config["plugins"] as Record<string, unknown>)["operator-engram@custom"], { enabled: true });
    assert.equal(config["developer_instructions"], "operator text mentions engram");
    assert.deepEqual(config["skills"], { config: [{ path: "/operator/engram-skill", enabled: true }] });
  });
}
