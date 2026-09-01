import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  COMPACT_PROMPT_KEY,
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  MODEL_INSTRUCTIONS_KEY,
} from "../../src/install/codex-config.ts";
import { codexPathsFor, installCodex, type CodexCommandInput, type CodexPaths } from "../../src/install/codex.ts";
import { VerifyReport } from "../../src/install/report.ts";
import {
  checkAgentPayload,
  checkCommitHookDeniesRed,
  checkEngramWiring,
  checkGlobalGuidance,
  checkManagedConfigRegion,
  checkMarketplacePayload,
  checkPlanArtifactRoundTrip,
  checkPluginInstalled,
  checkStateRoundTrip,
  hardcodedRowsWithNoMandatedRoute,
  KNOWN_MCP_SERVERS,
  mandatedAgreementStatus,
  mandatedRoutesNoServerHardcodes,
  mcpServersOf,
  PROTOCOL_MANDATED_TOOLS,
  verifyCodex,
} from "../../src/install/verify-codex.ts";
import { TOOL_ROWS } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessGitRunsShebangHooks } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-verify-codex-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

let homeCounter = 0;

function fixtureHome(): string {
  homeCounter += 1;
  const home = path.join(sandbox, `home-${homeCounter}`);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

function inputFor(home: string): CodexCommandInput {
  return {
    homeDirectory: home,
    repositoryRoot: fixtureRepositoryRoot(),
    environment: { PATH: "", CODEX_HOME: path.join(home, ".codex") },
    platform: "linux",
    host: pinnedHost(),
    assumeYes: true,
    installGitHook: false,
  };
}

function installedRuntimeFixture(paths: CodexPaths): void {
  mkdirSync(path.join(paths.runtimeRoot, "bin"), { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "bin", "oso-state"), path.join(paths.runtimeRoot, "bin", "oso-state"));
  chmodSync(path.join(paths.runtimeRoot, "bin", "oso-state"), 0o755);
  mkdirSync(path.join(paths.runtimeRoot, "dist"), { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "dist", "gate.js"), path.join(paths.runtimeRoot, "dist", "gate.js"));
}

function silentStateBinFixture(paths: CodexPaths): void {
  mkdirSync(path.join(paths.runtimeRoot, "bin"), { recursive: true });
  writeFileSync(path.join(paths.runtimeRoot, "bin", "oso-state"), "#!/usr/bin/env node\n");
}

function installedGitHookFixture(paths: CodexPaths): void {
  mkdirSync(path.join(paths.runtimeRoot, "git-hooks"), { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "git-hooks", "pre-commit"), path.join(paths.runtimeRoot, "git-hooks", "pre-commit"));
  chmodSync(path.join(paths.runtimeRoot, "git-hooks", "pre-commit"), 0o755);
  mkdirSync(path.join(paths.runtimeRoot, "dist"), { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "dist", "precommit.js"), path.join(paths.runtimeRoot, "dist", "precommit.js"));
}

const codexPluginManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "codex", ".codex-plugin", "plugin.json"), "utf8")) as {
  name: string;
  version: string;
};

function pluginListingJson(paths: CodexPaths, overrides: Partial<{ version: string }> = {}): string {
  return JSON.stringify({
    installed: [
      {
        pluginId: `${codexPluginManifest.name}@${codexPluginManifest.name}`,
        marketplaceName: codexPluginManifest.name,
        version: overrides.version ?? codexPluginManifest.version,
        installed: true,
        enabled: true,
        source: { source: "local", path: path.join(paths.marketplaceRoot, "codex") },
      },
    ],
  });
}

function marketplaceSkillNames(): string[] {
  return readdirSync(path.join(repositoryRoot, "codex", "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
    .map((entry) => entry.name);
}

function fullMarketplacePayloadFixture(paths: CodexPaths): void {
  mkdirSync(path.join(paths.marketplaceRoot, ".agents", "plugins"), { recursive: true });
  cpSync(path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"), path.join(paths.marketplaceRoot, ".agents", "plugins", "marketplace.json"));
  mkdirSync(path.join(paths.marketplaceRoot, "codex", ".codex-plugin"), { recursive: true });
  cpSync(path.join(repositoryRoot, "codex", ".codex-plugin", "plugin.json"), path.join(paths.marketplaceRoot, "codex", ".codex-plugin", "plugin.json"));
  for (const skill of marketplaceSkillNames()) {
    mkdirSync(path.join(paths.marketplaceRoot, "codex", "skills", skill), { recursive: true });
    cpSync(path.join(repositoryRoot, "codex", "skills", skill, "SKILL.md"), path.join(paths.marketplaceRoot, "codex", "skills", skill, "SKILL.md"));
  }
  cpSync(path.join(repositoryRoot, "plugin", "skills", "_shared"), path.join(paths.marketplaceRoot, "codex", "skills", "_shared"), { recursive: true });
}

function engramConfigFixture(paths: CodexPaths, modelInstructionsValue: string): void {
  writeFileSync(
    paths.configFile,
    [
      `${MODEL_INSTRUCTIONS_KEY} = "${modelInstructionsValue}"`,
      `${COMPACT_PROMPT_KEY} = "${path.join(paths.codexHome, "engram-compact-prompt.md")}"`,
      "",
      "[mcp_servers.engram]",
      'command = "engram"',
      'args = ["mcp"]',
      "",
      CONFIG_MARKER_START,
      CONFIG_MARKER_END,
      "",
    ].join("\n"),
  );
}

const mandatedRows = TOOL_ROWS.filter((row) => row.mandated === "yes" && row.names.codex.startsWith("mcp__"));

provedSomething(
  `${mandatedRows.length} mandated MCP tool row(s) were read out of core/src/routes/routes.ts across ` +
    `${KNOWN_MCP_SERVERS.length} known server(s)`,
  mandatedRows.length >= 8 && Object.values(PROTOCOL_MANDATED_TOOLS).flat().length >= 8,
  `only ${mandatedRows.length} mandated MCP row(s) were found, so an agreeing verdict would agree about nothing`,
);

describe("the MCP tool-drift checks read core/src/routes/routes.ts, the one table carrying the mandated column", () => {
  test("the hardcoded mandated list and the route table agree in both directions today", () => {
    assert.equal(mandatedAgreementStatus(), "agree");
  });

  test("routes.ts carries the mandated bit the check reads, which is the column only this net had", () => {
    assert.ok(TOOL_ROWS.every((row) => row.mandated === "yes" || row.mandated === "no"));
    assert.deepEqual(
      mandatedRows.map((row) => row.names.codex).sort(),
      (PROTOCOL_MANDATED_TOOLS["engram"] ?? []).map((bare) => `mcp__engram__${bare}`).sort(),
    );
  });

  test("a mandated tool with no yes-row in routes.ts is caught by name, so the net cannot go dark", () => {
    const withAnExtraHardcode = { ...PROTOCOL_MANDATED_TOOLS, engram: [...(PROTOCOL_MANDATED_TOOLS["engram"] ?? []), "mem_invented"] };
    assert.deepEqual(hardcodedRowsWithNoMandatedRoute(withAnExtraHardcode), ["mcp__engram__mem_invented(hardcoded-not-a-yes-row)"]);
  });

  test("a yes-row in routes.ts with no hardcoded counterpart is caught by name, so the net runs both ways", () => {
    const withOneRemoved = { ...PROTOCOL_MANDATED_TOOLS, engram: (PROTOCOL_MANDATED_TOOLS["engram"] ?? []).filter((bare) => bare !== "mem_judge") };
    assert.deepEqual(mandatedRoutesNoServerHardcodes(withOneRemoved), ["mcp__engram__mem_judge(yes-row-not-hardcoded)"]);
  });

  test("both directions report an empty mismatch list against the tree as it stands", () => {
    assert.deepEqual(hardcodedRowsWithNoMandatedRoute(), []);
    assert.deepEqual(mandatedRoutesNoServerHardcodes(), []);
  });

  test("a mandated role row that is no MCP tool is left alone, so the filter is the bash's own", () => {
    const roleRows = TOOL_ROWS.filter((row) => row.mandated === "yes" && !row.names.codex.startsWith("mcp__"));
    assert.ok(roleRows.length > 0);
    assert.deepEqual(mandatedRoutesNoServerHardcodes(), []);
  });
});

describe("the MCP server inventory is read by parsing config.toml, never by scraping it", () => {
  test("a local command server and a URL-only server are told apart", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    writeFileSync(
      configFile,
      '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n[mcp_servers.engram]\ncommand = "engram"\nargs = ["mcp"]\n',
    );
    const servers = mcpServersOf(configFile);
    assert.deepEqual(servers.map((server) => server.name).sort(), ["context7", "engram"]);
    assert.equal(servers.find((server) => server.name === "context7")?.command, undefined);
    assert.deepEqual(servers.find((server) => server.name === "engram")?.args, ["mcp"]);
  });

  test("a config the parser cannot read yields no servers rather than a scraped guess", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    writeFileSync(configFile, "[mcp_servers.engram\ncommand =\n");
    assert.deepEqual(mcpServersOf(configFile), []);
  });

  test("a server header inside a multiline string is no server, which a line scrape would have counted", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    writeFileSync(configFile, "notice = '''\n[mcp_servers.ghost]\ncommand = \"x\"\n'''\n");
    assert.deepEqual(mcpServersOf(configFile), []);
  });
});

describe("oso verify --host codex over a fixture HOME", () => {
  test("a home with nothing installed reports missing rather than crashing, and exits nonzero", () => {
    const outcome = verifyCodex(inputFor(fixtureHome()));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /FAIL: managed Codex config — expected valid, got missing/);
    assert.match(outcome.report, /passed: \d+, failed: \d+/);
  });

  test("the region this slice's own installer writes verifies as valid", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const report = new VerifyReport();
    checkManagedConfigRegion(report, codexPathsFor(home, inputFor(home).environment), inputFor(home).environment);
    assert.match(report.render(), /ok: {3}managed Codex config \(valid\)/);
  });

  test("one edited byte inside the region reads as divergent, so the check is not a presence test", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const paths = codexPathsFor(home, inputFor(home).environment);
    writeFileSync(paths.configFile, readFileSync(paths.configFile, "utf8").replace("max_threads = 4", "max_threads = 8"));
    const report = new VerifyReport();
    checkManagedConfigRegion(report, paths, inputFor(home).environment);
    assert.match(report.render(), /FAIL: managed Codex config — expected valid, got divergent/);
  });

  test("a doubled marker reads as malformed rather than as divergent", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    writeFileSync(paths.configFile, `${CONFIG_MARKER_START}\nx = 1\n${CONFIG_MARKER_END}\n${CONFIG_MARKER_START}\n${CONFIG_MARKER_END}\n`);
    const report = new VerifyReport();
    checkManagedConfigRegion(report, paths, inputFor(home).environment);
    assert.match(report.render(), /FAIL: managed Codex config — expected valid, got malformed/);
  });

  test("the global guidance the installer writes verifies as exact, and one edited byte does not", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const paths = codexPathsFor(home, inputFor(home).environment);
    const exact = new VerifyReport();
    checkGlobalGuidance(exact, paths, repositoryRoot);
    assert.match(exact.render(), /ok: {3}global Codex guidance \(exact\)/);

    writeFileSync(paths.globalFile, `${readFileSync(paths.globalFile, "utf8")}`.replace(/\n/, "\nan edit nobody published\n"));
    const edited = new VerifyReport();
    checkGlobalGuidance(edited, paths, repositoryRoot);
    assert.match(edited.render(), /FAIL: global Codex guidance/);
  });

  test("an empty installed region against an unpublished source fails, so two absences never agree", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    writeFileSync(paths.globalFile, `${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_END}\n`);
    const repositoryWithoutGuidance = path.join(sandbox, "repository-without-published-guidance");
    mkdirSync(repositoryWithoutGuidance, { recursive: true });
    const report = new VerifyReport();
    checkGlobalGuidance(report, paths, repositoryWithoutGuidance);
    assert.match(report.render(), /FAIL: global Codex guidance/);
    assert.equal(report.exitCode, 1);
  });

  test("a repository root that publishes no agents at all fails rather than attesting an exact copy", () => {
    const repositoryWithoutAgents = path.join(sandbox, "repository-without-a-codex-agents-directory");
    mkdirSync(repositoryWithoutAgents, { recursive: true });
    const report = new VerifyReport();
    checkAgentPayload(report, codexPathsFor(fixtureHome(), {}), repositoryWithoutAgents);
    assert.match(report.render(), /FAIL: seven Codex agents copied exactly/);
    assert.equal(report.exitCode, 1);
  });

  test("an empty published agents directory fails too, so nothing to compare is never a pass", () => {
    const repositoryWithNoAgentFiles = path.join(sandbox, "repository-with-an-empty-codex-agents-directory");
    mkdirSync(path.join(repositoryWithNoAgentFiles, "codex", "agents"), { recursive: true });
    const report = new VerifyReport();
    checkAgentPayload(report, codexPathsFor(fixtureHome(), {}), repositoryWithNoAgentFiles);
    assert.match(report.render(), /FAIL: seven Codex agents copied exactly/);
    assert.equal(report.exitCode, 1);
  });

  test("no check in the report spawns a host binary: the live tool list is announced as a skip", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const outcome = verifyCodex(inputFor(home));
    assert.match(outcome.report, /skip: fallow MCP tool drift/);
    assert.match(outcome.report, /the hardcoded mandated tool list agrees with the routes table in both directions/);
  });
});

describe("checkStateRoundTrip drives the installed oso-state binary under a probe HOME, reading no host binary", () => {
  test("round-trips mode=probe through the installed binary and reports probe (e2e)", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    installedRuntimeFixture(paths);
    const report = new VerifyReport();
    checkStateRoundTrip(report, paths, inputFor(home).environment);
    assert.match(report.render(), /ok: {3}installed oso-state round-trip \(probe\)/);
  });

  test("an installed state binary that prints nothing fails the round-trip rather than passing on emptiness", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    silentStateBinFixture(paths);
    const report = new VerifyReport();
    checkStateRoundTrip(report, paths, inputFor(home).environment);
    assert.match(report.render(), /FAIL: installed oso-state round-trip — expected probe, got round-trip-failed:empty/);
  });
});

describe("checkPlanArtifactRoundTrip captures, approves and amends a plan through the installed oso-state binary", () => {
  test("proves the snapshot and amendment artifacts the CLI writes rather than only that a command exits zero (e2e)", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    installedRuntimeFixture(paths);
    const report = new VerifyReport();
    checkPlanArtifactRoundTrip(report, paths, inputFor(home).environment);
    assert.match(report.render(), /ok: {3}installed Codex plan artifact round-trip \(artifacts\)/);
  });

  test("an installed state binary that prints nothing fails the artifact round-trip rather than passing on emptiness", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    silentStateBinFixture(paths);
    const report = new VerifyReport();
    checkPlanArtifactRoundTrip(report, paths, inputFor(home).environment);
    assert.match(report.render(), /FAIL: installed Codex plan artifact round-trip — expected artifacts, got artifact-contract-mismatch/);
  });
});

describe("checkPluginInstalled cross-checks the installed listing against the repository's own Codex plugin manifest", () => {
  test("an installed listing whose plugin id, marketplace name and version all agree with the manifest passes", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    const host = pinnedHost({ pluginListing: () => ({ ok: true, output: pluginListingJson(paths) }) });
    const report = new VerifyReport();
    checkPluginInstalled(report, paths, repositoryRoot, host);
    assert.match(report.render(), /ok: {3}oso-code plugin installed \(installed\)/);
  });

  test("a listing whose version has drifted from the manifest fails, so a stale plugin cache is never a pass", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    const host = pinnedHost({ pluginListing: () => ({ ok: true, output: pluginListingJson(paths, { version: "0.0.0-stale" }) }) });
    const report = new VerifyReport();
    checkPluginInstalled(report, paths, repositoryRoot, host);
    assert.match(report.render(), /FAIL: oso-code plugin installed — expected installed, got absent-or-invalid/);
  });
});

describe("checkMarketplacePayload compares the installed _shared skills tree file against file, reusing filesHoldTheSameBytes", () => {
  provedSomething(
    `${marketplaceSkillNames().length} published Codex skill(s) sit alongside plugin/skills/_shared in this repository`,
    marketplaceSkillNames().length > 0,
    "codex/skills has no non-_shared skill directory, so the marketplace payload fixture would compare nothing",
  );

  test("a marketplace root that copies every published file, including the full _shared tree, reports exact", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    fullMarketplacePayloadFixture(paths);
    const report = new VerifyReport();
    checkMarketplacePayload(report, paths, repositoryRoot);
    assert.match(report.render(), /ok: {3}staged marketplace payload \(exact\)/);
  });

  test("one edited byte nested inside the installed _shared tree is caught by name, so a present directory is never enough", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    fullMarketplacePayloadFixture(paths);
    const nested = path.join(paths.marketplaceRoot, "codex", "skills", "_shared", "rubric.md");
    writeFileSync(nested, `${readFileSync(nested, "utf8")}\nan edit nobody published\n`);
    const report = new VerifyReport();
    checkMarketplacePayload(report, paths, repositoryRoot);
    assert.match(report.render(), /FAIL: staged marketplace payload — expected exact, got divergent: shared/);
  });
});

describe("checkEngramWiring's verdict depends on the pointer values, computed through codex.ts's shared pure normalizer", () => {
  test("readable instruction files, a wired mcp_servers.engram table and pointers already normalized above the region report wired", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    mkdirSync(paths.codexHome, { recursive: true });
    writeFileSync(path.join(paths.codexHome, "engram-instructions.md"), "instructions\n");
    writeFileSync(path.join(paths.codexHome, "engram-compact-prompt.md"), "compact\n");
    engramConfigFixture(paths, path.join(paths.codexHome, "engram-instructions.md"));
    const report = new VerifyReport();
    checkEngramWiring(report, paths);
    assert.match(report.render(), /ok: {3}Engram Codex integration \(wired\)/);
  });

  test("a pointer value drifted from the installed instructions file reports incomplete, though both files and the mcp server are present", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    mkdirSync(paths.codexHome, { recursive: true });
    writeFileSync(path.join(paths.codexHome, "engram-instructions.md"), "instructions\n");
    writeFileSync(path.join(paths.codexHome, "engram-compact-prompt.md"), "compact\n");
    engramConfigFixture(paths, path.join(paths.codexHome, "stale-engram-instructions.md"));
    const report = new VerifyReport();
    checkEngramWiring(report, paths);
    assert.match(report.render(), /FAIL: Engram Codex integration — expected wired, got incomplete/);
  });
});

describe("checkCommitHookDeniesRed drives a real git commit against the installed hook, wired through core.hooksPath", () => {
  test(
    "denies a red agent commit end-to-end: HEAD holds and the refusal names the reason the gate matched on (e2e)",
    { skip: skipUnlessGitRunsShebangHooks() },
    () => {
      const home = fixtureHome();
      const paths = codexPathsFor(home, inputFor(home).environment);
      installedRuntimeFixture(paths);
      installedGitHookFixture(paths);
      const report = new VerifyReport();
      checkCommitHookDeniesRed(report, paths, process.env);
      assert.match(report.render(), /ok: {3}installed git hook denies a red agent commit \(denied\)/);
    },
  );

  test("a hooksPath that resolves to no installed hook lets the commit through, so the row proves wiring and not only gate logic", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    installedRuntimeFixture(paths);
    const report = new VerifyReport();
    checkCommitHookDeniesRed(report, paths, process.env);
    assert.match(report.render(), /FAIL: installed git hook denies a red agent commit — expected denied, got commit-was-allowed/);
  });
});
