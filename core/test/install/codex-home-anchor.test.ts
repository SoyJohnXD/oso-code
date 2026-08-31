import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CONFIG_MARKER_END, CONFIG_MARKER_START, renderCodexManagedConfig } from "../../src/install/codex-config.ts";
import { codexPathsFor, installCodex, type CodexCommandInput, type CodexPaths } from "../../src/install/codex.ts";
import { regionBetween, verifyCodex } from "../../src/install/verify-codex.ts";
import {
  bashFallowCommandForHome,
  bashIsAvailable,
  bashManagedRegionForHome,
  THE_HOME_ANCHOR_ORACLE,
} from "../support/codex-config-oracle.ts";
import { provedSomething } from "../support/proved.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { repositoryRoot, STATE_ROOT_THESE_TESTS_SPELL } from "../support/state-sandbox.ts";
import { skipUnlessBashRunsTheInstallerPipeline } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-anchor-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const NO_PATH_AT_ALL = "";
const FALLOW_STUB = "#!/bin/sh\nexit 0\n";

type HomeShape = Readonly<{ named: string; codexHome?: (home: string) => string; payload?: (home: string) => void }>;

const HOME_SHAPES: readonly HomeShape[] = [
  { named: "a HOME whose Codex home sits at its default place" },
  { named: "a HOME whose CODEX_HOME the operator moved elsewhere inside it", codexHome: (home) => path.join(home, "elsewhere", "codex") },
  { named: "a HOME whose CODEX_HOME the operator moved outside it entirely", codexHome: (home) => path.join(`${home}-detached`, "codex") },
  { named: "a HOME carrying a cargo-installed fallow-mcp", payload: (home) => stageExecutable(path.join(home, ".cargo", "bin", "fallow-mcp")) },
  {
    named: "a HOME whose operator config already carries unmanaged keys",
    payload: (home) => writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "gpt-5"\n\n[history]\nx = 1\n'),
  },
];

const SHAPES_MOVING_CODEX_HOME = HOME_SHAPES.filter((shape) => shape.codexHome !== undefined);

provedSomething(
  `${HOME_SHAPES.length} fixture HOME shape(s) were installed and then differentialled against ${THE_HOME_ANCHOR_ORACLE}`,
  HOME_SHAPES.length >= 5 && SHAPES_MOVING_CODEX_HOME.length >= 2,
  `${HOME_SHAPES.length} shape(s), of which ${SHAPES_MOVING_CODEX_HOME.length} move CODEX_HOME — a corpus that never moves ` +
    "CODEX_HOME holds the two anchors equal by construction and cannot tell them apart at all",
);

describe("the managed region is anchored on HOME, the anchor all three bash callers pass", () => {
  for (const shape of HOME_SHAPES) {
    test(`${shape.named}: the installed region is what bash renders from that HOME alone`, { skip: skipUnlessBashOracle() }, () => {
      const installed = installedFixture(shape, oracleOnlyPath());
      const oracle = bashManagedRegionForHome(installed.home, oracleOnlyPath());
      assert.equal(oracle.status, 0, oracle.stderr);
      assert.equal(regionOf(installed.paths), oracle.text);
    });

    test(`${shape.named}: the Codex home renders something else, so that agreement is not one anchor agreeing with itself`, {
      skip: skipUnlessBashOracle(),
    }, () => {
      const installed = installedFixture(shape, oracleOnlyPath());
      const oracle = bashManagedRegionForHome(installed.home, oracleOnlyPath());
      assert.equal(oracle.status, 0, oracle.stderr);
      const fromCodexHome = renderCodexManagedConfig(installed.paths.codexHome, installed.paths.runtimeRoot, fallowCommandIn(oracle.text));
      assert.notEqual(fromCodexHome, oracle.text);
    });
  }

  test("moving CODEX_HOME moves the file the region lives in and leaves the region itself byte for byte the same", () => {
    const home = stagedHome("one-home-many-codex-homes");
    const regions = [undefined, path.join(home, "elsewhere", "codex"), path.join(`${home}-detached`, "codex")].map((codexHome) =>
      regionOf(installedInto(home, codexHome, NO_PATH_AT_ALL).paths),
    );
    assert.equal(new Set(regions).size, 1, regions.join("\n----\n"));
  });

  test("the write grant names the state root this suite spells, never one nested under the Codex home", () => {
    const installed = installedFixture(HOME_SHAPES[0] as HomeShape, NO_PATH_AT_ALL);
    const stateRoot = path.posix.join(installed.home, STATE_ROOT_THESE_TESTS_SPELL);
    const region = regionOf(installed.paths);
    assert.ok(region.includes(`"${stateRoot}" = true`), region);
    assert.ok(region.includes(`"${path.posix.join(stateRoot, "worktrees")}" = true`), region);
    assert.ok(!region.includes(path.posix.join(installed.paths.codexHome, STATE_ROOT_THESE_TESTS_SPELL)), region);
  });

  test("the verifier reads its own installer's region back as valid rather than divergent", () => {
    const installed = installedFixture(HOME_SHAPES[1] as HomeShape, NO_PATH_AT_ALL);
    const outcome = verifyCodex({
      homeDirectory: installed.home,
      repositoryRoot,
      environment: installed.environment,
      platform: "linux",
      host: pinnedHost(),
    });
    assert.match(outcome.report, /^ok: {3}managed Codex config \(valid\)$/m, outcome.report);
  });
});

describe("the fallow-mcp cargo fallback probes HOME, the anchor install-codex.sh:804 passes", () => {
  test("a cargo fallow-mcp under HOME is the command both the port and bash render", { skip: skipUnlessBashOracle() }, () => {
    const home = stagedHome("cargo-under-home");
    stageExecutable(path.join(home, ".cargo", "bin", "fallow-mcp"));
    const oracle = bashFallowCommandForHome(home, NO_PATH_AT_ALL);
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.text.trim(), path.posix.join(home, ".cargo", "bin", "fallow-mcp"));
    assert.equal(installedFallowCommandOf(home), oracle.text.trim());
  });

  test("a HOME with no cargo fallow-mcp anywhere falls back to the bare name on both sides", { skip: skipUnlessBashOracle() }, () => {
    const home = stagedHome("cargo-absent");
    const oracle = bashFallowCommandForHome(home, NO_PATH_AT_ALL);
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.text.trim(), "fallow-mcp");
    assert.equal(installedFallowCommandOf(home), "fallow-mcp");
  });

  test("a fallow-mcp planted under the Codex home is not a command the probe may reach", () => {
    const home = stagedHome("cargo-under-codex-home");
    stageExecutable(path.join(home, ".codex", ".cargo", "bin", "fallow-mcp"));
    assert.equal(installedFallowCommandOf(home), "fallow-mcp");
  });
});

const THE_RENDERERS_ONLY_EXTERNAL_TOOL = "cat";

let oracleBinDirectory: string | undefined;

function oracleOnlyPath(): string {
  if (oracleBinDirectory !== undefined) return oracleBinDirectory;
  const directory = path.join(sandbox, "oracle-bin");
  mkdirSync(directory, { recursive: true });
  const resolved = spawnSync("sh", ["-c", `command -v ${THE_RENDERERS_ONLY_EXTERNAL_TOOL}`], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(resolved, "", `${THE_RENDERERS_ONLY_EXTERNAL_TOOL} is nowhere on this machine, so the bash renderer cannot be spawned as the oracle`);
  symlinkSync(resolved, path.join(directory, THE_RENDERERS_ONLY_EXTERNAL_TOOL));
  oracleBinDirectory = directory;
  return directory;
}

function skipUnlessBashOracle(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  if (!bashIsAvailable()) return "bash cannot be spawned here, so the installer's own renderer cannot be read as the oracle";
  return false;
}

let homeCounter = 0;

function stagedHome(label: string): string {
  homeCounter += 1;
  const home = path.join(sandbox, `${label}-${homeCounter}`);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

type InstalledFixture = Readonly<{ home: string; paths: CodexPaths; environment: NodeJS.ProcessEnv }>;

function installedFixture(shape: HomeShape, pathValue: string): InstalledFixture {
  const home = stagedHome("home");
  shape.payload?.(home);
  return installedInto(home, shape.codexHome?.(home), pathValue);
}

function installedInto(home: string, codexHome: string | undefined, pathValue: string): InstalledFixture {
  if (codexHome !== undefined) mkdirSync(codexHome, { recursive: true });
  const environment: NodeJS.ProcessEnv = codexHome === undefined ? { PATH: pathValue } : { PATH: pathValue, CODEX_HOME: codexHome };
  const input: CodexCommandInput = { homeDirectory: home, repositoryRoot: fixtureRepositoryRoot(), environment, platform: "linux", host: pinnedHost(), assumeYes: true, installGitHook: false };
  const outcome = installCodex(input);
  assert.equal(outcome.exitCode, 0, outcome.report);
  return { home, paths: codexPathsFor(home, environment), environment };
}

function installedFallowCommandOf(home: string): string {
  const environment: NodeJS.ProcessEnv = { PATH: NO_PATH_AT_ALL };
  const input: CodexCommandInput = { homeDirectory: home, repositoryRoot: fixtureRepositoryRoot(), environment, platform: "linux", host: pinnedHost(), assumeYes: true, installGitHook: false };
  const outcome = installCodex(input);
  assert.equal(outcome.exitCode, 0, outcome.report);
  return fallowCommandIn(regionOf(codexPathsFor(home, environment)));
}

function regionOf(paths: CodexPaths): string {
  const region = regionBetween(readFileSync(paths.configFile, "utf8"), CONFIG_MARKER_START, CONFIG_MARKER_END);
  assert.ok(region !== undefined, `no single managed region in ${paths.configFile}`);
  return region;
}

function fallowCommandIn(regionText: string): string {
  const row = regionText.split("\n").find((line) => line.startsWith("command = "));
  assert.ok(row !== undefined, regionText);
  return row.slice("command = ".length).trim().replace(/^"|"$/g, "");
}

function stageExecutable(target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, FALLOW_STUB);
  chmodSync(target, 0o700);
}
