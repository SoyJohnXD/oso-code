import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CONFIG_MARKER_END, CONFIG_MARKER_START, renderCodexManagedConfig } from "../../src/install/codex-config.ts";
import { codexPathsFor, installCodex, type CodexCommandInput, type CodexPaths } from "../../src/install/codex.ts";
import { regionBetween, verifyCodex } from "../../src/install/verify-codex.ts";
import { provedSomething } from "../support/proved.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { repositoryRoot, STATE_ROOT_THESE_TESTS_SPELL } from "../support/state-sandbox.ts";

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

const A_WIN32_SHAPED_HOME = "C:\\Users\\operator\\home";
const A_WIN32_SHAPED_CODEX_HOME = path.win32.join(A_WIN32_SHAPED_HOME, ".codex");
const A_WIN32_SHAPED_REGION = renderCodexManagedConfig(
  A_WIN32_SHAPED_HOME,
  path.win32.join(A_WIN32_SHAPED_HOME, ".local", "share", "oso-code", "runtime"),
  "fallow-mcp",
);

provedSomething(
  "the win32-shaped render spells its grant differently from a posix join over the same HOME, so the grant checks read " +
    "through the separator shape rather than around it",
  !A_WIN32_SHAPED_REGION.includes(`"${path.posix.join(A_WIN32_SHAPED_HOME, STATE_ROOT_THESE_TESTS_SPELL)}" = true`),
  `${A_WIN32_SHAPED_REGION} spells its grant exactly as path.posix.join does, so this fixture cannot tell a ` +
    "separator-blind comparison from a byte-for-byte one and the case below would pass either way",
);

provedSomething(
  `${HOME_SHAPES.length} fixture HOME shape(s) were installed and then read back through the region their own HOME anchors`,
  HOME_SHAPES.length >= 5 && SHAPES_MOVING_CODEX_HOME.length >= 2,
  `${HOME_SHAPES.length} shape(s), of which ${SHAPES_MOVING_CODEX_HOME.length} move CODEX_HOME — a corpus that never moves ` +
    "CODEX_HOME holds the two anchors equal by construction and cannot tell them apart at all",
);

describe("the managed region is anchored on HOME, never on the Codex home the operator may move", () => {
  for (const shape of HOME_SHAPES) {
    test(`${shape.named}: the region grants the state root under HOME and names no root under the Codex home`, () => {
      const installed = installedFixture(shape, NO_PATH_AT_ALL);
      const region = regionOf(installed.paths);
      assert.ok(grantsWriteTo(region, path.join(installed.home, STATE_ROOT_THESE_TESTS_SPELL)), region);
      assert.ok(!namesPath(region, path.join(installed.paths.codexHome, STATE_ROOT_THESE_TESTS_SPELL)), region);
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
    const stateRoot = path.join(installed.home, STATE_ROOT_THESE_TESTS_SPELL);
    const region = regionOf(installed.paths);
    assert.ok(grantsWriteTo(region, stateRoot), region);
    assert.ok(grantsWriteTo(region, path.join(stateRoot, "worktrees")), region);
    assert.ok(!namesPath(region, path.join(installed.paths.codexHome, STATE_ROOT_THESE_TESTS_SPELL)), region);
  });

  test("a win32-shaped HOME grants the same anchor, under separators the anchor does not depend on", () => {
    const stateRoot = path.win32.join(A_WIN32_SHAPED_HOME, STATE_ROOT_THESE_TESTS_SPELL);
    assert.ok(grantsWriteTo(A_WIN32_SHAPED_REGION, stateRoot), A_WIN32_SHAPED_REGION);
    assert.ok(grantsWriteTo(A_WIN32_SHAPED_REGION, path.win32.join(stateRoot, "worktrees")), A_WIN32_SHAPED_REGION);
    const nestedUnderCodexHome = path.win32.join(A_WIN32_SHAPED_CODEX_HOME, STATE_ROOT_THESE_TESTS_SPELL);
    assert.ok(!namesPath(A_WIN32_SHAPED_REGION, nestedUnderCodexHome), A_WIN32_SHAPED_REGION);
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

describe("the fallow-mcp cargo fallback probes HOME, never the Codex home", () => {
  test("a cargo fallow-mcp under HOME is the command the install renders", () => {
    const home = stagedHome("cargo-under-home");
    stageExecutable(path.join(home, ".cargo", "bin", "fallow-mcp"));
    assert.equal(installedFallowCommandOf(home), path.posix.join(home, ".cargo", "bin", "fallow-mcp"));
  });

  test("a HOME with no cargo fallow-mcp anywhere falls back to the bare name", () => {
    assert.equal(installedFallowCommandOf(stagedHome("cargo-absent")), "fallow-mcp");
  });

  test("a fallow-mcp planted under the Codex home is not a command the probe may reach", () => {
    const home = stagedHome("cargo-under-codex-home");
    stageExecutable(path.join(home, ".codex", ".cargo", "bin", "fallow-mcp"));
    assert.equal(installedFallowCommandOf(home), "fallow-mcp");
  });
});

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

const EVERY_RUN_OF_SEPARATORS = /[\\/]+/g;

function separatorBlind(text: string): string {
  return text.replace(EVERY_RUN_OF_SEPARATORS, "/");
}

function grantsWriteTo(regionText: string, root: string): boolean {
  return separatorBlind(regionText).includes(`"${separatorBlind(root)}" = true`);
}

function namesPath(regionText: string, somePath: string): boolean {
  return separatorBlind(regionText).includes(separatorBlind(somePath));
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
