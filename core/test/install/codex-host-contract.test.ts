import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { HOST_REJECTED_CONFIG, installCodex, repairCodex, type CodexCommandInput } from "../../src/install/codex.ts";
import { versionFieldsOf } from "../../src/install/codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-host-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const VERSION_REFUSAL_TEMPLATE =
  `Codex CLI must already be exactly ${SUPPORTED_CODEX_VERSION} (found \${current:-not installed}); ` +
  `run: npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`;
const SANDBOX_REFUSAL = "Codex rejected the merged config; the original config is unchanged";

const VERSIONS_THE_PIN_REFUSES = ["0.150.1", "0.145.9", "", "codex@0.146.0\n0.146.0"] as const;

const GIT_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  `the two refusal sentences below are spelled here rather than read back from the code under test, and ${VERSIONS_THE_PIN_REFUSES.length} rejected version(s) were driven`,
  VERSION_REFUSAL_TEMPLATE.includes("npm install --global") && VERSION_REFUSAL_TEMPLATE.includes(SUPPORTED_CODEX_VERSION),
  `version refusal ${JSON.stringify(VERSION_REFUSAL_TEMPLATE)} names neither the install command nor the pin, so every ` +
    "comparison below would hold a sentence against itself",
);

describe("the pinned Codex version is an input the composition root reads, and a mismatch refuses before anything is written", () => {
  for (const found of VERSIONS_THE_PIN_REFUSES) {
    const reported = found === "" ? undefined : found;
    test(`install refuses ${JSON.stringify(found === "" ? "no codex at all" : found)} with the sentence the bash fails with`, () => {
      const home = fixtureHome();
      const outcome = installCodex(inputFor(home, { host: pinnedHost({ version: reported }) }));
      assert.equal(outcome.exitCode, 1);
      assert.ok(outcome.report.includes(expectedVersionRefusal(reported)), `${outcome.report}\n--- wanted ---\n${expectedVersionRefusal(reported)}`);
      assert.equal(existsSync(path.join(home, ".codex", "config.toml")), false);
    });

    test(`repair refuses ${JSON.stringify(found === "" ? "no codex at all" : found)} the same way`, () => {
      const outcome = repairCodex(inputFor(fixtureHome(), { host: pinnedHost({ version: reported }) }));
      assert.equal(outcome.exitCode, 1);
      assert.ok(outcome.report.includes(expectedVersionRefusal(reported)), outcome.report);
    });
  }

  test("the pinned version installs, so the refusal above is a version gate rather than a rail that never runs", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    assert.equal(existsSync(path.join(home, ".codex", "config.toml")), true);
  });

  test("the version reader folds codex --version to the last field of every line", () => {
    assert.equal(versionFieldsOf("codex-cli 0.146.0\n"), "0.146.0");
    assert.equal(versionFieldsOf("codex@0.150.1\n0.150.1\n"), "codex@0.150.1\n0.150.1");
    assert.equal(versionFieldsOf(""), "");
  });
});

describe("the host's own acceptance of the merged config is the gate a candidate must pass before anything is written", () => {
  test("a host that rejects the candidate leaves the operator's config exactly as it was", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const operator = 'model = "gpt-5"\n\n[history]\nx = 1\n';
    writeFileSync(configFile, operator);
    const outcome = installCodex(inputFor(home, { host: pinnedHost({ acceptsConfig: () => false }) }));
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.report.includes(SANDBOX_REFUSAL), outcome.report);
    assert.equal(readFileSync(configFile, "utf8"), operator);
  });

  test("the port's rejection sentence is the sentence this suite spells, never one read back from the port", () => {
    assert.equal(HOST_REJECTED_CONFIG, SANDBOX_REFUSAL);
  });

  test("the prober is handed the candidate bytes about to be written, never a token standing in for them", () => {
    const home = fixtureHome();
    const offered: string[] = [];
    const outcome = installCodex(
      inputFor(home, {
        host: pinnedHost({
          acceptsConfig: (_codexHome, configText) => {
            offered.push(configText);
            return true;
          },
        }),
      }),
    );
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.deepEqual(offered, [readFileSync(path.join(home, ".codex", "config.toml"), "utf8")]);
  });
});

describe("a rolled-back install leaves the repository's own core.hooksPath as it found it", () => {
  for (const preset of [undefined, "/some/operator/hooks"]) {
    test(`a repository whose core.hooksPath is ${preset === undefined ? "unset" : "already set"} comes back unchanged`, { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const repository = gitFixtureRepository(preset);
      assert.equal(hooksPathOf(repository), preset, "the fixture did not start in the shape this case drives");
      const outcome = installCodex(
        inputFor(fixtureHome(), { repositoryRoot: repository, environment: gitReachableEnvironment(), host: pinnedHost({ acceptsConfig: () => false }) }),
      );
      assert.equal(outcome.exitCode, 1);
      assert.match(outcome.report, /rolled back to the pre-run snapshot/, outcome.report);
      assert.equal(hooksPathOf(repository), preset);
    });
  }

  test("a drive that does wire the hook writes it into the fixture repository it was handed, never the one under test", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const outcome = installCodex(
      inputFor(fixtureHome(), { repositoryRoot: repository, environment: gitReachableEnvironment(), installGitHook: true }),
    );
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.match(hooksPathOf(repository) ?? "", /git-hooks$/);
  });

  test("a git commit gate that cannot be wired rolls the install back rather than reporting a wiring row and exiting 0", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const notARepository = path.join(sandbox, `bare-${(repositoryCounter += 1)}`);
    mkdirSync(path.join(notARepository, "bootstrap"), { recursive: true });
    writeFileSync(path.join(notARepository, "bootstrap", "codex-global.md"), readFileSync(path.join(repositoryRoot, "bootstrap", "codex-global.md")));
    const home = fixtureHome();
    const outcome = installCodex(
      inputFor(home, { repositoryRoot: notARepository, environment: gitReachableEnvironment(), installGitHook: true }),
    );
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /could not wire the git commit gate/, outcome.report);
    assert.match(outcome.report, /rolled back to the pre-run snapshot/, outcome.report);
  });
});

function expectedVersionRefusal(found: string | undefined): string {
  return VERSION_REFUSAL_TEMPLATE.replace("${current:-not installed}", found ?? "not installed");
}

let homeCounter = 0;

function fixtureHome(): string {
  homeCounter += 1;
  const home = path.join(sandbox, `home-${homeCounter}`);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

function inputFor(home: string, overrides: Partial<CodexCommandInput> = {}): CodexCommandInput {
  return {
    homeDirectory: home,
    repositoryRoot: fixtureRepositoryRoot(),
    environment: { PATH: "", CODEX_HOME: path.join(home, ".codex") },
    platform: "linux",
    host: pinnedHost(),
    assumeYes: true,
    installGitHook: false,
    ...overrides,
  };
}

let repositoryCounter = 0;

function gitReachableEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"] ?? "" };
}

function gitFixtureRepository(hooksPath: string | undefined): string {
  repositoryCounter += 1;
  const root = path.join(sandbox, `repo-${repositoryCounter}`);
  mkdirSync(path.join(root, "bootstrap"), { recursive: true });
  writeFileSync(path.join(root, "bootstrap", "codex-global.md"), readFileSync(path.join(repositoryRoot, "bootstrap", "codex-global.md")));
  assert.equal(gitIn(root, ["init", "-q"]).status, 0);
  if (hooksPath !== undefined) assert.equal(gitIn(root, ["config", "--local", "core.hooksPath", hooksPath]).status, 0);
  return root;
}

function hooksPathOf(root: string): string | undefined {
  const run = gitIn(root, ["config", "--local", "--get", "core.hooksPath"]);
  return run.status === 0 ? run.stdout.trim() : undefined;
}

function gitIn(root: string, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}
