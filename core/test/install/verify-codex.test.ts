import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CONFIG_MARKER_END, CONFIG_MARKER_START, GLOBAL_MARKER_END, GLOBAL_MARKER_START } from "../../src/install/codex-config.ts";
import { codexPathsFor, installCodex, type CodexCommandInput, type CodexPaths } from "../../src/install/codex.ts";
import { VerifyReport } from "../../src/install/report.ts";
import {
  checkAgentPayload,
  checkCommitHookDeniesRed,
  checkGlobalGuidance,
  checkManagedConfigRegion,
  checkPlanArtifactRoundTrip,
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

describe("checkCommitHookDeniesRed drives the installed PreToolUse gate the same way for both hosts, through runInstalledHookProbe", () => {
  test("denies a red agent commit through the installed gate bundle (e2e)", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    installedRuntimeFixture(paths);
    const report = new VerifyReport();
    checkCommitHookDeniesRed(report, paths, process.env);
    assert.match(report.render(), /ok: {3}installed git hook denies a red agent commit \(denied\)/);
  });

  test("a missing gate bundle fails the denial check rather than passing on absence", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    const report = new VerifyReport();
    checkCommitHookDeniesRed(report, paths, process.env);
    assert.doesNotMatch(report.render(), /ok: {3}installed git hook denies a red agent commit/);
  });
});
