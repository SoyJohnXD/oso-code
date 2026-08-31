import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { installCodex } from "../../src/install/codex.ts";
import { codexHostProbes } from "../../src/install/codex-host.ts";
import { verifyCodex } from "../../src/install/verify-codex.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { bashIsAvailable } from "../support/codex-config-oracle.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { SMOKE_SECTION, reportLines, withoutTheSmokeSection, type ReportLine } from "../support/verify-report-lines.ts";
import { skipUnlessBashRunsTheInstallerPipeline } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-parity-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const THE_PARITY_CORPUS =
  "one fixture HOME staged by the PORT's own oso install --host codex --yes --no-git-hook, then read by both " +
  "core/src/install/verify-codex.ts and bootstrap/verify-codex.sh with OSO_VERIFY_SKIP_SMOKE=1 and a fixture PATH " +
  "whose codex and fallow-mcp are shims, so neither leg spawns an installed host binary (G4)";

const HOSTS_THE_FIXTURE_SHADOWS = ["codex", "fallow-mcp"] as const;

const THE_C4_ROUTED_BLOCK = {
  intent: "the Codex smoke parts of `verify-codex.sh`",
  section: SMOKE_SECTION,
  functions: [
    "integrator_handoff_consumed",
    "populate_smoke_codex_home",
    "create_integrator_fixture",
    "cleanup_smoke_on_exit",
    "run_integrator_fixture",
    "run_authenticated_smoke",
  ],
  lines: 249,
  ofFile: 1021,
} as const;

provedSomething(
  `the parity corpus is ${THE_PARITY_CORPUS}, with the ${THE_C4_ROUTED_BLOCK.section} section excluded by name as ` +
    `${THE_C4_ROUTED_BLOCK.intent} — ${THE_C4_ROUTED_BLOCK.functions.length} bash function(s), ` +
    `${THE_C4_ROUTED_BLOCK.lines} of ${THE_C4_ROUTED_BLOCK.ofFile} lines`,
  THE_C4_ROUTED_BLOCK.functions.length === 6 && THE_C4_ROUTED_BLOCK.lines > 0,
  "the C4-routed block was not measured, so the exclusion below is asserted rather than enumerated",
);

describe("check-for-check parity: one port-installed fixture HOME, read by the port's verifier and by the bash verifier", () => {
  test("the bash verifier still carries the section this harness excludes, so the exclusion names something real", () => {
    const source = spawnSync("cat", [path.join(repositoryRoot, "bootstrap", "verify-codex.sh")], { encoding: "utf8" }).stdout;
    for (const named of THE_C4_ROUTED_BLOCK.functions) assert.ok(source.includes(`${named}()`), named);
    assert.ok(source.includes(THE_C4_ROUTED_BLOCK.section), THE_C4_ROUTED_BLOCK.section);
  });

  test("both verifiers report the same lines, verdict for verdict", { skip: skipUnlessBashParity() }, () => {
    const driven = drivenFixture();
    assert.deepEqual(driven.port, driven.bash, sideBySide(driven.port, driven.bash));
  });

  test("both verifiers report the same pass and fail counts", { skip: skipUnlessBashParity() }, () => {
    const driven = drivenFixture();
    assert.equal(countsIn(driven.portReport), countsIn(driven.bashReport));
  });

  test("a port verifier that drops one row is caught, so the agreement above is not two empty lists", { skip: skipUnlessBashParity() }, () => {
    const driven = drivenFixture();
    assert.notDeepEqual(driven.port.slice(1), driven.bash);
    assert.ok(driven.port.length > 15, `${driven.port.length} line(s) compared`);
  });
});

function skipUnlessBashParity(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  if (!bashIsAvailable()) return "bash cannot be spawned here, so bootstrap/verify-codex.sh cannot be read as the oracle";
  return false;
}

type Driven = Readonly<{ port: ReportLine[]; bash: ReportLine[]; portReport: string; bashReport: string }>;

let driven: Driven | undefined;

function drivenFixture(): Driven {
  if (driven !== undefined) return driven;
  const home = path.join(sandbox, "home");
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  const environment: NodeJS.ProcessEnv = { PATH: `${shimDirectory()}${path.delimiter}${process.env["PATH"] ?? ""}`, HOME: home, USERPROFILE: home };
  const install = installCodex({
    homeDirectory: home,
    repositoryRoot: fixtureRepositoryRoot(),
    environment,
    platform: "linux",
    host: pinnedHost(),
    assumeYes: true,
    installGitHook: false,
  });
  assert.equal(install.exitCode, 0, install.report);
  const portReport = verifyCodex({
    homeDirectory: home,
    repositoryRoot,
    environment,
    platform: "linux",
    host: codexHostProbes(environment),
  }).report;
  const bash = spawnSync("bash", [path.join(repositoryRoot, "bootstrap", "verify-codex.sh")], {
    encoding: "utf8",
    env: { ...environment, OSO_VERIFY_SKIP_SMOKE: "1" },
    maxBuffer: 1024 * 1024 * 8,
  });
  assert.equal(bash.error, undefined, `bootstrap/verify-codex.sh could not be spawned: ${bash.error?.message}`);
  assert.notEqual(bash.stdout, "", `bootstrap/verify-codex.sh printed nothing: ${bash.stderr}`);
  driven = {
    port: reportLines(portReport),
    bash: withoutTheSmokeSection(reportLines(bash.stdout)),
    portReport,
    bashReport: bash.stdout,
  };
  return driven;
}

let shims: string | undefined;

function shimDirectory(): string {
  if (shims !== undefined) return shims;
  const directory = path.join(sandbox, "shim-bin");
  mkdirSync(directory, { recursive: true });
  for (const name of HOSTS_THE_FIXTURE_SHADOWS) {
    const shim = path.join(directory, name);
    writeFileSync(shim, `#!/bin/sh\nprintf '%s is a parity fixture shim, not an installed host\\n' "${name}" >&2\nexit 127\n`);
    chmodSync(shim, 0o700);
  }
  shims = directory;
  return directory;
}

function countsIn(report: string): string {
  return report.split("\n").find((line) => line.startsWith("passed: ")) ?? "no counts";
}

function sideBySide(port: readonly ReportLine[], bash: readonly ReportLine[]): string {
  const rows = Math.max(port.length, bash.length);
  return Array.from({ length: rows }, (_unused, index) => {
    const left = port[index];
    const right = bash[index];
    const same = left?.kind === right?.kind && left?.key === right?.key;
    return `${same ? "  " : "!!"} port=${JSON.stringify(left)} bash=${JSON.stringify(right)}`;
  }).join("\n");
}
