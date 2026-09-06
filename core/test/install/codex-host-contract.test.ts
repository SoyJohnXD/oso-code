import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { codexPathsFor, HOST_REJECTED_CONFIG, installCodex, repairCodex, type CodexCommandInput } from "../../src/install/codex.ts";
import { versionFieldsOf } from "../../src/install/codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { VerifyReport } from "../../src/install/report.ts";
import { checkPinnedCodexVersion } from "../../src/install/verify-codex.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-host-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const VERSION_REFUSAL_TEMPLATE =
  `Codex CLI must already be ${SUPPORTED_CODEX_VERSION} or newer (found \${current:-not installed}); ` +
  `run: npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`;
const SANDBOX_REFUSAL = "Codex rejected the merged config; the original config is unchanged";

const VERSIONS_THE_PIN_REFUSES = ["0.145.9", "", "codex@0.146.0\n0.146.0"] as const;
const VERSIONS_THE_FLOOR_ADMITS = ["0.146.0", "0.150.1", "1.0.0"] as const;

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

  for (const found of VERSIONS_THE_FLOOR_ADMITS) {
    test(`the floor admits ${JSON.stringify(found)}, so a host that moved past the tested version no longer blocks an install`, () => {
      const home = fixtureHome();
      assert.equal(installCodex(inputFor(home, { host: pinnedHost({ version: found }) })).exitCode, 0);
      assert.equal(existsSync(path.join(home, ".codex", "config.toml")), true);
    });
  }

  test("the pinned version installs, so the refusal above is a version gate rather than a rail that never runs", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    assert.equal(existsSync(path.join(home, ".codex", "config.toml")), true);
  });

  test("a clean codex-cli version line is matched with nothing left to discard", () => {
    assert.deepEqual(versionFieldsOf("codex-cli 0.146.0\n"), { kind: "matched", version: "0.146.0", discarded: [] });
  });

  test("a two-line output with no codex-cli-shaped line is unmatched rather than silently joined into a version — the pin this repairs once froze that join in place, and now the shape it looked for is what the row names", () => {
    assert.deepEqual(versionFieldsOf("codex@0.150.1\n0.150.1\n"), { kind: "unmatched", raw: "codex@0.150.1\n0.150.1\n" });
  });

  test("empty output is unmatched rather than an empty version", () => {
    assert.deepEqual(versionFieldsOf(""), { kind: "unmatched", raw: "" });
  });

  test("a Codex measured behind the mise wrapper's banner meets the floor, so install proceeds and verify reads above-pin", () => {
    const reading = versionFieldsOf("mise ~/.config/mise/config.toml tools: codex@0.152.0\ncodex-cli 0.152.0\n");
    assert.equal(reading.kind, "matched");
    const measured = reading.kind === "matched" ? reading.version : undefined;
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home, { host: pinnedHost({ version: measured }) })).exitCode, 0);
    const report = new VerifyReport();
    checkPinnedCodexVersion(report, pinnedHost({ version: measured }));
    const rendered = report.render();
    assert.match(rendered, /^ok:\s+Codex CLI version \(0\.152\.0\)/m);
    assert.match(rendered, /is newer than the 0\.146\.0 this release was verified against/);
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
    const finalConfig = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    assert.ok(offered.length >= 1);
    assert.equal(offered[offered.length - 1], finalConfig);
    assert.ok(finalConfig.includes("[mcp_servers.engram]"));
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

  test("migrates the exact published checkout hook to the self-contained runtime", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const legacyHooks = path.join(repository, "plugin", "git-hooks");
    const legacyHook = path.join(legacyHooks, "pre-commit");
    chmodSync(legacyHook, 0o700);
    assert.equal(gitIn(repository, ["config", "--local", "core.hooksPath", legacyHooks]).status, 0);
    const home = fixtureHome();
    const environment = gitReachableEnvironment();
    const outcome = installCodex(inputFor(home, { repositoryRoot: repository, environment, installGitHook: true }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.match(outcome.report, /git commit hook: OK/);
    assert.equal(hooksPathOf(repository), path.join(codexPathsFor(home, environment).runtimeRoot, "git-hooks"));
    assert.equal(readFileSync(legacyHook, "utf8"), readFileSync(path.join(fixtureRepositoryRoot(), "plugin", "git-hooks", "pre-commit"), "utf8"));
  });

  test("refuses a relative checkout hook path even when it resolves to the published directory", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const legacyHooks = path.join(repository, "plugin", "git-hooks");
    assert.equal(gitIn(repository, ["config", "--local", "core.hooksPath", "plugin/git-hooks"]).status, 0);
    const outcome = installCodex(inputFor(fixtureHome(), { repositoryRoot: repository, environment: gitReachableEnvironment(), installGitHook: true }));
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /core\.hooksPath=plugin\/git-hooks.*already owns this checkout's hooks/);
    assert.equal(hooksPathOf(repository), "plugin/git-hooks");
    assert.equal(readFileSync(path.join(legacyHooks, "pre-commit"), "utf8"), readFileSync(path.join(fixtureRepositoryRoot(), "plugin", "git-hooks", "pre-commit"), "utf8"));
  });

  test("refuses a lookalike checkout hook directory with an extra operator file", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const legacyHooks = path.join(repository, "plugin", "git-hooks");
    writeFileSync(path.join(legacyHooks, "operator-hook"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    assert.equal(gitIn(repository, ["config", "--local", "core.hooksPath", legacyHooks]).status, 0);
    const outcome = installCodex(inputFor(fixtureHome(), { repositoryRoot: repository, environment: gitReachableEnvironment(), installGitHook: true }));
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /already owns this checkout's hooks/);
    assert.equal(hooksPathOf(repository), legacyHooks);
  });

  test("a failure after exact checkout-hook migration restores the captured legacy path", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const legacyHooks = path.join(repository, "plugin", "git-hooks");
    assert.equal(gitIn(repository, ["config", "--local", "core.hooksPath", legacyHooks]).status, 0);
    const outcome = installCodex(
      inputFor(fixtureHome(), {
        repositoryRoot: repository,
        environment: gitReachableEnvironment(),
        installGitHook: true,
        host: pinnedHost({ pluginAdd: () => ({ ok: false, output: "plugin registration failed" }) }),
      }),
    );
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /rolled back to the pre-run snapshot/);
    assert.equal(hooksPathOf(repository), legacyHooks);
  });

  test("an Oso hooksPath leaves unrelated default hooks untouched on update", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const home = fixtureHome();
    const environment = gitReachableEnvironment();
    const paths = codexPathsFor(home, environment);
    const unrelated = path.join(repository, ".git", "hooks", "pre-push");
    writeFileSync(unrelated, "#!/bin/sh\nexit 0\n");
    assert.equal(gitIn(repository, ["config", "--local", "core.hooksPath", path.join(paths.runtimeRoot, "git-hooks")]).status, 0);
    const outcome = installCodex(inputFor(home, { repositoryRoot: repository, environment, installGitHook: true }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(readFileSync(unrelated, "utf8"), "#!/bin/sh\nexit 0\n");
  });

  test("a git commit gate that cannot be wired rolls the install back rather than reporting a wiring row and exiting 0", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const notARepository = path.join(sandbox, `bare-${(repositoryCounter += 1)}`);
    mkdirSync(notARepository, { recursive: true });
    copyCodexPayload(notARepository);
    const home = fixtureHome();
    const outcome = installCodex(
      inputFor(home, { repositoryRoot: notARepository, environment: gitReachableEnvironment(), installGitHook: true }),
    );
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /could not wire the git commit gate/, outcome.report);
    assert.match(outcome.report, /rolled back to the pre-run snapshot/, outcome.report);
  });

  test("a symlinked foreign hook is treated as an owner and survives the refused install", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const hook = path.join(repository, ".git", "hooks", "pre-commit");
    const target = path.join(repository, "operator-pre-commit");
    writeFileSync(target, "#!/bin/sh\nexit 0\n");
    symlinkSync(target, hook);
    const outcome = installCodex(
      inputFor(fixtureHome(), { repositoryRoot: repository, environment: gitReachableEnvironment(), installGitHook: true }),
    );
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /already owns this checkout's hooks/, outcome.report);
    assert.equal(readFileSync(target, "utf8"), "#!/bin/sh\nexit 0\n");
  });

  test("an effective global core.hooksPath is preserved and blocks the installer", { skip: GIT_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repository = gitFixtureRepository(undefined);
    const globalConfig = path.join(sandbox, `global-${(repositoryCounter += 1)}.gitconfig`);
    const foreignHooks = path.join(sandbox, `global-hooks-${repositoryCounter}`);
    mkdirSync(foreignHooks, { recursive: true });
    writeFileSync(globalConfig, `[core]\n\thooksPath = ${foreignHooks}\n`);
    const environment = { ...gitReachableEnvironment(), GIT_CONFIG_GLOBAL: globalConfig };
    const outcome = installCodex(inputFor(fixtureHome(), { repositoryRoot: repository, environment, installGitHook: true }));
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /core\.hooksPath=/, outcome.report);
    assert.ok(outcome.report.includes(foreignHooks), outcome.report);
    assert.equal(readFileSync(globalConfig, "utf8"), `[core]\n\thooksPath = ${foreignHooks}\n`);
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
  copyCodexPayload(root);
  assert.equal(gitIn(root, ["init", "-q"]).status, 0);
  if (hooksPath !== undefined) assert.equal(gitIn(root, ["config", "--local", "core.hooksPath", hooksPath]).status, 0);
  return root;
}

function copyCodexPayload(root: string): void {
  for (const relative of [".agents", "bootstrap", "codex", "plugin"]) {
    cpSync(path.join(fixtureRepositoryRoot(), relative), path.join(root, relative), { recursive: true });
  }
}

function hooksPathOf(root: string): string | undefined {
  const run = gitIn(root, ["config", "--local", "--get", "core.hooksPath"]);
  return run.status === 0 ? run.stdout.trim() : undefined;
}

function gitIn(root: string, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}
