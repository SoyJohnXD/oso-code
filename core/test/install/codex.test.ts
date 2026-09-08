import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  renderCodexManagedConfig,
  tomlQuote,
} from "../../src/install/codex-config.ts";
import {
  codexPathsFor,
  installCodex,
  managedFeaturesStatus,
  purgeCodex,
  rebuildGlobalGuidance,
  repairCodex,
  type CodexCommandInput,
} from "../../src/install/codex.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
import { CODEX_WRITER_HOME_SEGMENT, fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-install-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const CONFIG_TOML_CLOSURE_ROOTS = ["core/src/install/codex.ts", "core/src/install/codex-config.ts"] as const;
const NATIVE_JOIN_PATTERN = /path\.join\(|path\.resolve\(/g;
const RELATIVE_IMPORT_PATTERN = /from "(\.[^"]*)"/g;

const THE_CONFIG_TOML_CLOSURE = [
  { file: "core/src/install/backup.ts", nativeJoins: 10 },
  { file: "core/src/install/codex-config.ts", nativeJoins: 0 },
  { file: "core/src/install/codex-host.ts", nativeJoins: 2 },
  { file: "core/src/install/codex-payload.ts", nativeJoins: 15 },
  { file: "core/src/install/codex.ts", nativeJoins: 47 },
  { file: "core/src/install/json.ts", nativeJoins: 0 },
  { file: "core/src/install/pins.ts", nativeJoins: 0 },
  { file: "core/src/install/report.ts", nativeJoins: 0 },
  { file: "core/src/install/toml-regions.ts", nativeJoins: 0 },
  { file: "core/src/install/toml.ts", nativeJoins: 0 },
  { file: "core/src/install/trust.ts", nativeJoins: 0 },
  { file: "core/src/install/verify-claude.ts", nativeJoins: 29 },
  { file: "core/src/install/version-line.ts", nativeJoins: 0 },
  { file: "core/src/state/store.ts", nativeJoins: 8 },
] as const;

const SITES_REACHING_CONFIG_TOML_BYTES = [
  {
    file: "core/src/install/codex.ts",
    producer: "codexPathsFor",
    expression: 'const codexHome = environment["CODEX_HOME"] ?? path.join(homeDirectory, ".codex");',
    carries: "the prefix the two engram pointer values below are joined onto, and nothing else since the region re-anchored on homeDirectory",
  },
  {
    file: "core/src/install/codex.ts",
    producer: "codexPathsFor",
    expression: 'runtimeRoot: path.join(homeDirectory, ".local", "share", "oso-code", "runtime"),',
    carries: "OSO_STATE_BIN",
  },
  {
    file: "core/src/install/codex.ts",
    producer: "normalizedEngramPointerConfig",
    expression: 'modelValue: path.join(paths.codexHome, "engram-instructions.md"),',
    carries: MODEL_INSTRUCTIONS_KEY,
  },
  {
    file: "core/src/install/codex.ts",
    producer: "normalizedEngramPointerConfig",
    expression: 'compactValue: path.join(paths.codexHome, "engram-compact-prompt.md"),',
    carries: COMPACT_PROMPT_KEY,
  },
  {
    file: "core/src/install/verify-claude.ts",
    producer: "firstExecutableOnPath",
    expression: "const candidate = path.join(entry, binaryName);",
    carries: "the [mcp_servers.fallow] command, verbatim through resolveFallowMcpCommand's firstOnPath branch",
  },
] as const;

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

describe("oso install --host codex over a fixture HOME", () => {
  test("without --yes it reports what it needs and touches nothing", () => {
    const home = fixtureHome();
    const outcome = installCodex(inputFor(home, { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /requires --yes/);
    assert.equal(existsInHome(home, ".codex/config.toml"), false);
  });

  test("it writes the managed region into a fixture CODEX_HOME and reports exit 0", () => {
    const home = fixtureHome();
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const config = readFileSync(codexPathsFor(home, inputFor(home).environment).configFile, "utf8");
    assert.ok(config.includes(`${CONFIG_MARKER_START}\n`));
    assert.ok(config.includes(`${CONFIG_MARKER_END}\n`));
    assert.equal(managedFeaturesStatus(config), "valid");
  });

  test("it deploys the published marketplace, runtime hooks, and seven agents", () => {
    const home = fixtureHome();
    const environment = inputFor(home).environment;
    const paths = codexPathsFor(home, environment);
    const outcome = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(readFileSync(path.join(paths.marketplaceRoot, ".agents", "plugins", "marketplace.json"), "utf8"), readFileSync(path.join(fixtureRepositoryRoot(), ".agents", "plugins", "marketplace.json"), "utf8"));
    assert.equal(readFileSync(paths.hooksManifest, "utf8").includes("__OSO_HOOKS_DIR__"), false);
    assert.equal(readFileSync(path.join(paths.runtimeRoot, "bin", "oso-state"), "utf8"), readFileSync(path.join(fixtureRepositoryRoot(), "plugin", "bin", "oso-state"), "utf8"));
    assert.deepEqual(readdirSync(path.join(paths.codexHome, "agents")).sort(), readdirSync(path.join(fixtureRepositoryRoot(), "codex", "agents")).sort());
    assert.equal(existsSync(path.join(paths.runtimeRoot, "git-hooks", "pre-commit")), true);
  });

  test("it refuses a published skill wrapper whose required SKILL.md entrypoint is missing before staging", () => {
    const home = fixtureHome();
    const repository = path.join(sandbox, `incomplete-payload-${homeCounter}`);
    cpSync(fixtureRepositoryRoot(), repository, { recursive: true });
    const missing = path.join(repository, "codex", "skills", "quick", "SKILL.md");
    rmSync(missing);
    const outcome = installCodex(inputFor(home, { repositoryRoot: repository, installImpeccable: false }));
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, new RegExp(`Codex skill wrapper is missing or invalid: ${escapeRegExp(missing)}`));
    assert.equal(existsSync(path.join(codexPathsFor(home, inputFor(home).environment).marketplaceRoot, "codex", "skills", "quick", "SKILL.md")), false);
  });

  test("it escapes a native runtime path before writing the JSON hooks manifest", () => {
    const home = path.join(sandbox, CODEX_WRITER_HOME_SEGMENT);
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    const outcome = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const paths = codexPathsFor(home, inputFor(home).environment);
    const runtimeHooksDirectory = path.posix.join(paths.runtimeRoot, "dist");
    const manifestText = readFileSync(paths.hooksManifest, "utf8");
    const escapedRuntimeHooksDirectory = runtimeHooksDirectory.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    assert.ok(manifestText.includes(escapedRuntimeHooksDirectory));
    const manifest = JSON.parse(manifestText) as { hooks: unknown };
    assert.ok(manifest.hooks);
    const commands = Object.values(manifest.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)));
    assert.ok(commands.length > 0 && commands.every((command) => command.includes(runtimeHooksDirectory)));
  });

  test("updating replaces stale owned generations and preserves unrelated state", () => {
    const home = fixtureHome();
    const environment = inputFor(home).environment;
    const paths = codexPathsFor(home, environment);
    const configFile = paths.configFile;
    const operatorConfig = '# operator sentinel\nmodel = "operator"\n';
    writeFileSync(configFile, operatorConfig);
    mkdirSync(path.join(paths.codexHome, "agents"), { recursive: true });
    writeFileSync(path.join(paths.codexHome, "agents", "oso-applier.toml"), "stale generation\n");
    writeFileSync(path.join(paths.codexHome, "agents", "operator.toml"), "operator agent\n");
    mkdirSync(path.join(paths.codexHome, "plugins", "cache", "operator"), { recursive: true });
    writeFileSync(path.join(paths.codexHome, "plugins", "cache", "operator", "keep.txt"), "keep plugin\n");
    mkdirSync(path.join(home, ".engram"), { recursive: true });
    writeFileSync(path.join(home, ".engram", "memory.db"), "operator memory\n");

    const outcome = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(readFileSync(configFile, "utf8").includes('# operator sentinel\nmodel = "operator"'), true);
    assert.equal(readFileSync(path.join(paths.codexHome, "agents", "oso-applier.toml"), "utf8"), readFileSync(path.join(fixtureRepositoryRoot(), "codex", "agents", "oso-applier.toml"), "utf8"));
    assert.equal(readFileSync(path.join(paths.codexHome, "agents", "operator.toml"), "utf8"), "operator agent\n");
    assert.equal(readFileSync(path.join(paths.codexHome, "plugins", "cache", "operator", "keep.txt"), "utf8"), "keep plugin\n");
    assert.equal(readFileSync(path.join(home, ".engram", "memory.db"), "utf8"), "operator memory\n");
  });

  test("direct Engram normalization leaves feature ownership valid and a second install succeeds", () => {
    const home = fixtureHome();
    const first = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(first.exitCode, 0, first.report);
    const configFile = codexPathsFor(home, inputFor(home).environment).configFile;
    assert.equal(managedFeaturesStatus(readFileSync(configFile, "utf8")), "valid");
    const second = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(second.exitCode, 0, second.report);
    assert.equal(managedFeaturesStatus(readFileSync(configFile, "utf8")), "valid");
  });

  test("direct Engram normalization preserves operator environment and timeout leaves", () => {
    const home = fixtureHome();
    const configFile = codexPathsFor(home, inputFor(home).environment).configFile;
    writeFileSync(
      configFile,
      '[mcp_servers.engram]\ncommand = "operator-engram"\nargs = ["operator"]\nenv = { ENGRAM_DATA_DIR = "operator-memory", OPERATOR_FLAG = "keep" }\nstartup_timeout_sec = 45\n',
    );
    const outcome = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const document = parseTomlDocument(readFileSync(configFile, "utf8"), configFile);
    const engram = (document["mcp_servers"] as Record<string, unknown>)["engram"] as Record<string, unknown>;
    assert.deepEqual(engram["env"], { ENGRAM_DATA_DIR: "operator-memory", OPERATOR_FLAG: "keep" });
    assert.equal(engram["startup_timeout_sec"], 45);
  });

  test("direct Engram normalization preserves nested operator environment leaves", () => {
    const home = fixtureHome();
    const configFile = codexPathsFor(home, inputFor(home).environment).configFile;
    writeFileSync(
      configFile,
      '[mcp_servers.engram]\ncommand = "operator-engram"\nargs = ["operator"]\nstartup_timeout_sec = 45\n\n[mcp_servers.engram.env]\nENGRAM_DATA_DIR = "operator-memory"\nOPERATOR_FLAG = "keep"\n',
    );
    const outcome = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const document = parseTomlDocument(readFileSync(configFile, "utf8"), configFile);
    const engram = (document["mcp_servers"] as Record<string, unknown>)["engram"] as Record<string, unknown>;
    assert.deepEqual(engram["env"], { ENGRAM_DATA_DIR: "operator-memory", OPERATOR_FLAG: "keep" });
    assert.equal(engram["startup_timeout_sec"], 45);
  });

  test("pointer ownership preserves multiline, literal, nested, spaced, and duplicate decoys", () => {
    const home = fixtureHome();
    const configFile = codexPathsFor(home, inputFor(home).environment).configFile;
    const decoy = [
      'notes = """',
      'model_instructions_file = "keep basic"',
      'experimental_compact_prompt_file = "keep basic compact"',
      '"""',
      "literal_notes = '''",
      "model_instructions_file = 'keep literal'",
      "experimental_compact_prompt_file = 'keep literal compact'",
      "'''",
      "[operator]",
      'model_instructions_file = "keep nested"',
      'experimental_compact_prompt_file = "keep nested compact"',
      "",
    ].join("\n");
    writeFileSync(configFile, decoy);
    const installed = installCodex(inputFor(home, { installImpeccable: false }));
    assert.equal(installed.exitCode, 0, installed.report);
    const preserved = readFileSync(configFile, "utf8");
    assert.match(preserved, /keep basic compact/);
    assert.match(preserved, /keep literal compact/);
    assert.match(preserved, /keep nested compact/);

    const foreignHome = fixtureHome();
    const foreignFile = codexPathsFor(foreignHome, inputFor(foreignHome).environment).configFile;
    const foreign = 'model_instructions_file    = "personal.md"\n';
    writeFileSync(foreignFile, foreign);
    const refused = installCodex(inputFor(foreignHome, { installImpeccable: false }));
    assert.equal(refused.exitCode, 1, refused.report);
    assert.equal(readFileSync(foreignFile, "utf8"), foreign);

    const duplicateHome = fixtureHome();
    const duplicateFile = codexPathsFor(duplicateHome, inputFor(duplicateHome).environment).configFile;
    const duplicate = 'model_instructions_file = "one.md"\nmodel_instructions_file = "two.md"\n';
    writeFileSync(duplicateFile, duplicate);
    const duplicateRefused = installCodex(inputFor(duplicateHome, { installImpeccable: false }));
    assert.equal(duplicateRefused.exitCode, 1, duplicateRefused.report);
    assert.equal(readFileSync(duplicateFile, "utf8"), duplicate);
  });

  test("an unknown inactive Engram cache is preserved without blocking installation", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    const cache = path.join(paths.codexHome, ".tmp", "marketplaces", "engram");
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, "operator-sentinel"), "preserve this unrecognized cache\n");
    const outcome = installCodex(
      inputFor(home, {
        environment: { PATH: process.env["PATH"] ?? "", CODEX_HOME: paths.codexHome },
        installImpeccable: false,
      }),
    );
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(readFileSync(path.join(cache, "operator-sentinel"), "utf8"), "preserve this unrecognized cache\n");
    assert.equal(existsSync(paths.configFile), true);
  });

  test("an inactive Git cache whose configured worktree is foreign remains untouched", () => {
    const home = fixtureHome();
    const paths = codexPathsFor(home, inputFor(home).environment);
    const cache = path.join(paths.codexHome, ".tmp", "marketplaces", "engram");
    mkdirSync(cache, { recursive: true });
    assert.equal(gitIn(cache, ["init", "-q"]).status, 0);
    const foreignWorktree = path.join(home, "foreign-worktree");
    mkdirSync(foreignWorktree);
    assert.equal(gitIn(cache, ["config", "core.worktree", foreignWorktree]).status, 0);
    const cacheIdentity = statSync(cache, { bigint: true });
    const foreignIdentity = statSync(foreignWorktree, { bigint: true });
    assert.notDeepEqual([foreignIdentity.dev, foreignIdentity.ino], [cacheIdentity.dev, cacheIdentity.ino]);
    const outcome = installCodex(inputFor(home, {
      environment: { PATH: process.env["PATH"] ?? "", CODEX_HOME: paths.codexHome },
      installImpeccable: false,
    }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(existsSync(cache), true);
  });

  test("dirty unregistered caches never execute local or environment Git filters", () => {
    for (const mode of ["local-filter", "environment-filter"] as const) {
      const home = fixtureHome();
      const environment = {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: path.join(home, ".codex"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        XDG_DATA_HOME: path.join(home, ".data"),
        XDG_STATE_HOME: path.join(home, ".state"),
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const cache = path.join(environment.CODEX_HOME, ".tmp", "marketplaces", "engram");
      mkdirSync(cache, { recursive: true });
      writeFileSync(path.join(cache, "witness.txt"), "original\n");
      assert.equal(gitIn(cache, ["init", "-q"]).status, 0);
      assert.equal(gitIn(cache, ["config", "user.email", "oso-test@example.invalid"]).status, 0);
      assert.equal(gitIn(cache, ["config", "user.name", "Oso test"]).status, 0);
      assert.equal(gitIn(cache, ["add", "witness.txt"]).status, 0);
      assert.equal(gitIn(cache, ["commit", "-qm", "baseline"]).status, 0);
      assert.equal(gitIn(cache, ["remote", "add", "origin", "https://github.com/Gentleman-Programming/engram.git"]).status, 0);
      assert.equal(gitIn(cache, ["update-ref", "refs/remotes/origin/main", "HEAD"]).status, 0);
      assert.equal(gitIn(cache, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]).status, 0);
      mkdirSync(path.join(cache, ".git", "info"), { recursive: true });
      writeFileSync(path.join(cache, ".git", "info", "attributes"), "*.txt filter=witness\n");
      const marker = path.join(home, "executed-marker");
      const helper = `touch '${marker}'; cat`;
      if (mode === "local-filter") assert.equal(gitIn(cache, ["config", "filter.witness.clean", helper]).status, 0);
      else Object.assign(environment, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "filter.witness.clean", GIT_CONFIG_VALUE_0: helper });
      writeFileSync(path.join(cache, "witness.txt"), "mutated!\n");

      const outcome = installCodex(inputFor(home, { environment, installImpeccable: false }));
      assert.equal(outcome.exitCode, 0, outcome.report);
      assert.equal(existsSync(marker), false, `${mode} Git filter executed before refusal`);
    }
  });

  test("an inactive cache gitlink remains untouched and its nested filter never executes", () => {
    const home = fixtureHome();
    const environment = {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, ".codex"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      XDG_DATA_HOME: path.join(home, ".data"),
      XDG_STATE_HOME: path.join(home, ".state"),
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const cache = path.join(environment.CODEX_HOME, ".tmp", "marketplaces", "engram");
    mkdirSync(path.join(cache, ".agents", "plugins"), { recursive: true });
    mkdirSync(path.join(cache, "plugin", "codex", ".codex-plugin"), { recursive: true });
    writeFileSync(path.join(cache, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "engram", plugins: [{ name: "engram", source: { source: "local", path: "./plugin/codex" } }] }));
    writeFileSync(path.join(cache, "plugin", "codex", ".codex-plugin", "plugin.json"), '{"name":"engram"}\n');
    writeFileSync(path.join(cache, "witness.txt"), "original\n");
    assert.equal(gitIn(cache, ["init", "-q"], environment).status, 0);
    assert.equal(gitIn(cache, ["config", "user.email", "oso-test@example.invalid"], environment).status, 0);
    assert.equal(gitIn(cache, ["config", "user.name", "Oso test"], environment).status, 0);
    assert.equal(gitIn(cache, ["add", "."], environment).status, 0);
    assert.equal(gitIn(cache, ["commit", "-qm", "parent"], environment).status, 0);
    const nested = path.join(cache, "nested");
    mkdirSync(nested);
    writeFileSync(path.join(nested, "witness.txt"), "original\n");
    assert.equal(gitIn(nested, ["init", "-q"], environment).status, 0);
    assert.equal(gitIn(nested, ["config", "user.email", "oso-test@example.invalid"], environment).status, 0);
    assert.equal(gitIn(nested, ["config", "user.name", "Oso test"], environment).status, 0);
    assert.equal(gitIn(nested, ["add", "."], environment).status, 0);
    assert.equal(gitIn(nested, ["commit", "-qm", "nested"], environment).status, 0);
    assert.equal(gitIn(cache, ["add", "nested"], environment).status, 0);
    assert.equal(gitIn(cache, ["commit", "-qm", "gitlink"], environment).status, 0);
    assert.equal(gitIn(cache, ["remote", "add", "origin", "https://github.com/Gentleman-Programming/engram.git"], environment).status, 0);
    assert.equal(gitIn(cache, ["update-ref", "refs/remotes/origin/main", "HEAD"], environment).status, 0);
    assert.equal(gitIn(cache, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], environment).status, 0);
    const marker = path.join(home, "nested-filter-executed");
    writeFileSync(path.join(nested, ".git", "info", "attributes"), "*.txt filter=nestedwitness\n");
    assert.equal(gitIn(nested, ["config", "filter.nestedwitness.clean", `touch '${marker}'; cat`], environment).status, 0);
    writeFileSync(path.join(nested, "witness.txt"), "mutated!\n");
    const outcome = installCodex(inputFor(home, { environment, installImpeccable: false }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(cache), true);
  });

  test("an exact clean inactive Engram cache is preserved without invoking removal", () => {
    const home = fixtureHome();
    const environment = { PATH: process.env["PATH"] ?? "", CODEX_HOME: path.join(home, ".codex") };
    const paths = codexPathsFor(home, environment);
    const cache = path.join(paths.codexHome, ".tmp", "marketplaces", "engram");
    mkdirSync(path.join(cache, ".agents", "plugins"), { recursive: true });
    mkdirSync(path.join(cache, "plugin", "codex", ".codex-plugin"), { recursive: true });
    writeFileSync(
      path.join(cache, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({ name: "engram", plugins: [{ name: "engram", source: { source: "local", path: "./plugin/codex" } }] }) + "\n",
    );
    writeFileSync(path.join(cache, "plugin", "codex", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "engram" }) + "\n");
    assert.equal(gitIn(cache, ["init", "-q"]).status, 0);
    assert.equal(gitIn(cache, ["config", "user.email", "oso-test@example.invalid"]).status, 0);
    assert.equal(gitIn(cache, ["config", "user.name", "Oso test"]).status, 0);
    assert.equal(gitIn(cache, ["add", "."]).status, 0);
    assert.equal(gitIn(cache, ["commit", "-qm", "fixture"]).status, 0);
    assert.equal(gitIn(cache, ["remote", "add", "origin", "https://github.com/Gentleman-Programming/engram.git"]).status, 0);
    assert.equal(gitIn(cache, ["update-ref", "refs/remotes/origin/main", "HEAD"]).status, 0);
    assert.equal(gitIn(cache, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]).status, 0);
    const gitRoot = gitIn(cache, ["rev-parse", "--show-toplevel"]);
    assert.equal(gitRoot.status, 0, gitRoot.stderr);
    const cacheIdentity = statSync(cache, { bigint: true });
    const rootIdentity = statSync(gitRoot.stdout.trim(), { bigint: true });
    assert.deepEqual([rootIdentity.dev, rootIdentity.ino], [cacheIdentity.dev, cacheIdentity.ino]);
    const outcome = installCodex(
      inputFor(home, {
        environment,
        installImpeccable: false,
        host: pinnedHost({ marketplaceRemove: () => {
          rmSync(cache, { recursive: true, force: true });
          return { ok: true, output: "removed", stderr: "" };
        } }),
      }),
    );
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(existsSync(cache), true);
    assert.match(readFileSync(paths.configFile, "utf8"), /\[plugins\."engram@engram"\]/);
  });

  test("the obsolete Engram setup path is not invoked", () => {
    const home = fixtureHome();
    const configFile = codexPathsFor(home, inputFor(home).environment).configFile;
    const before = 'model = "operator"\n';
    writeFileSync(configFile, before);
    const host = { ...pinnedHost(), setupEngram: () => { throw new Error("obsolete Engram setup invoked"); } };
    const outcome = installCodex(
      inputFor(home, {
        installImpeccable: false,
        host,
      }),
    );
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.ok(readFileSync(configFile, "utf8").includes(before));
  });

  test("a registration failure rolls back config and every staged owned target", () => {
    const home = fixtureHome();
    const environment = inputFor(home).environment;
    const paths = codexPathsFor(home, environment);
    const configFile = paths.configFile;
    const globalFile = paths.globalFile;
    writeFileSync(configFile, 'model = "operator"\n');
    writeFileSync(globalFile, "operator guidance\n");
    mkdirSync(path.join(paths.codexHome, "agents"), { recursive: true });
    writeFileSync(path.join(paths.codexHome, "agents", "operator.toml"), "operator agent\n");
    mkdirSync(path.join(paths.marketplaceRoot, "codex"), { recursive: true });
    writeFileSync(path.join(paths.marketplaceRoot, "codex", "stale.txt"), "stale marketplace\n");
    mkdirSync(paths.runtimeRoot, { recursive: true });
    writeFileSync(path.join(paths.runtimeRoot, "stale.txt"), "stale runtime\n");
    const original = {
      config: readFileSync(configFile, "utf8"),
      global: readFileSync(globalFile, "utf8"),
      agents: readFileSync(path.join(paths.codexHome, "agents", "operator.toml"), "utf8"),
      marketplace: readFileSync(path.join(paths.marketplaceRoot, "codex", "stale.txt"), "utf8"),
      runtime: readFileSync(path.join(paths.runtimeRoot, "stale.txt"), "utf8"),
    };
    const outcome = installCodex(
      inputFor(home, {
        installImpeccable: false,
        host: pinnedHost({
          pluginAdd: () => ({ ok: false, output: "plugin registration failed" }),
        }),
      }),
    );
    assert.equal(outcome.exitCode, 1, outcome.report);
    assert.match(outcome.report, /rolled back to the pre-run snapshot/);
    assert.equal(readFileSync(configFile, "utf8"), original.config);
    assert.equal(readFileSync(globalFile, "utf8"), original.global);
    assert.equal(readFileSync(path.join(paths.codexHome, "agents", "operator.toml"), "utf8"), original.agents);
    assert.equal(readFileSync(path.join(paths.marketplaceRoot, "codex", "stale.txt"), "utf8"), original.marketplace);
    assert.equal(readFileSync(path.join(paths.runtimeRoot, "stale.txt"), "utf8"), original.runtime);
  });

  test("the default Impeccable path registers the pinned plugin and mounts its published skill", () => {
    const home = fixtureHome();
    const calls: string[] = [];
    const host = pinnedHost({
      marketplaceAdd: (source, ref) => {
        calls.push(`marketplace:${source}:${ref ?? ""}`);
        return {
          ok: true,
          output: JSON.stringify({
            marketplaceName: source === "pbakaus/impeccable" ? "impeccable" : "oso-code",
            installedRoot: source === "pbakaus/impeccable" ? path.join(fixtureRepositoryRoot(), "impeccable-source") : source,
          }),
        };
      },
      pluginAdd: (pluginId) => {
        calls.push(`plugin:${pluginId}`);
        return { ok: true, output: JSON.stringify({ pluginId }) };
      },
    });
    const outcome = installCodex(inputFor(home, { host }));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(readFileSync(path.join(home, ".agents", "skills", "impeccable", "SKILL.md"), "utf8").includes("version: 4.0.2"), true);
    assert.ok(calls.some((call) => call.includes("marketplace:pbakaus/impeccable:skill-v4.0.2")), calls.join("\n"));
    assert.ok(calls.includes("plugin:impeccable@impeccable"), calls.join("\n"));
  });

  test("it preserves an operator's existing config byte for byte outside the region", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const operator = '# keep this comment\nmodel = "gpt-5"\n\n[history]\npersistence = "save-all"\n';
    writeFileSync(configFile, operator);
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const rewritten = readFileSync(configFile, "utf8");
    assert.ok(rewritten.includes('# keep this comment\nmodel = "gpt-5"\n'));
    assert.ok(rewritten.includes('[history]\npersistence = "save-all"\n'));
  });

  test("it refuses an oso-owned key already living outside the region, and leaves that config unwritten", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const hostile = '[permissions.oso]\nextends = ":workspace"\n';
    writeFileSync(configFile, hostile);
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /oso-code-owned key permissions\.oso outside the managed region/);
    assert.equal(readFileSync(configFile, "utf8"), hostile);
  });

  test("it refuses a config with malformed markers rather than rewriting it", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const broken = `${CONFIG_MARKER_START}\nx = 1\n${CONFIG_MARKER_START}\ny = 2\n${CONFIG_MARKER_END}\n`;
    writeFileSync(configFile, broken);
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /malformed oso-code markers/);
    assert.equal(readFileSync(configFile, "utf8"), broken);
  });

  test("it takes a pre-install backup naming the config it is about to rewrite", () => {
    const home = fixtureHome();
    writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    const outcome = installCodex(inputFor(home));
    const backupLine = outcome.report.split("\n").find((line) => line.startsWith("backup: "));
    assert.ok(backupLine !== undefined, outcome.report);
    const backupRoot = backupLine.slice("backup: ".length);
    assert.equal(readFileSync(path.join(backupRoot, "items", "config"), "utf8"), 'model = "x"\n');
    assert.match(readFileSync(path.join(backupRoot, "manifest"), "utf8"), /^present\tconfig\t/m);
  });

  test("--no-git-hook is reported rather than silently skipped", () => {
    const outcome = installCodex(inputFor(fixtureHome(), { installGitHook: false }));
    assert.match(outcome.report, /skipping the git commit hook \(--no-git-hook\)/);
  });

  test("--no-impeccable is reported rather than silently skipped", () => {
    const outcome = installCodex(inputFor(fixtureHome(), { installImpeccable: false }));
    assert.match(outcome.report, /skipping impeccable \(--no-impeccable\)/);
  });

  test("it merges global AGENTS.md between its own marker pair, keeping the operator's prose", () => {
    const home = fixtureHome();
    const globalFile = path.join(home, ".codex", "AGENTS.md");
    writeFileSync(globalFile, "# my own notes\n\nkeep me\n");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const merged = readFileSync(globalFile, "utf8");
    assert.ok(merged.startsWith("# my own notes\n\nkeep me\n"));
    assert.ok(merged.includes(`${GLOBAL_MARKER_START}\n`) && merged.includes(`${GLOBAL_MARKER_END}\n`));
  });
});

describe("oso repair --host codex over a fixture HOME", () => {
  test("without --yes it reports what it needs", () => {
    const outcome = repairCodex(inputFor(fixtureHome(), { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /requires --yes/);
  });

  test("it removes recognized legacy Engram root pointers", () => {
    const home = fixtureHome();
    const codexHome = path.join(home, ".codex");
    const configFile = path.join(codexHome, "config.toml");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const installed = withoutEngramPointers(readFileSync(configFile, "utf8"));
    writeFileSync(
      configFile,
      `model_instructions_file = ${tomlQuote(path.join(codexHome, "engram-instructions.md"))}\n` +
        `experimental_compact_prompt_file = ${tomlQuote(path.join(codexHome, "engram-compact-prompt.md"))}\n${installed}`,
    );
    const outcome = repairCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const repaired = readFileSync(configFile, "utf8");
    assert.equal(parseTomlDocument(repaired, configFile)["model_instructions_file"], undefined);
  });

  test("legacy pointers are removed and a second repair is byte-idempotent", () => {
    const home = fixtureHome();
    const codexHome = path.join(home, ".codex");
    const configFile = path.join(codexHome, "config.toml");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const installed = withoutEngramPointers(readFileSync(configFile, "utf8"));
    writeFileSync(
      configFile,
      `model_instructions_file = ${tomlQuote(path.join(codexHome, "engram-instructions.md"))}\n` +
        `experimental_compact_prompt_file = ${tomlQuote(path.join(codexHome, "engram-compact-prompt.md"))}\n${installed}`,
    );
    assert.equal(repairCodex(inputFor(home)).exitCode, 0);
    const repaired = readFileSync(configFile, "utf8");
    assert.equal(parseTomlDocument(repaired, configFile)["model_instructions_file"], undefined);

    const secondPass = repairCodex(inputFor(home));
    assert.equal(secondPass.exitCode, 0, secondPass.report);
    assert.equal(readFileSync(configFile, "utf8"), repaired);
  });

  test("it accepts native defaults without inventing pointers", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const configFile = path.join(home, ".codex", "config.toml");
    writeFileSync(configFile, withoutEngramPointers(readFileSync(configFile, "utf8")));
    const outcome = repairCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
  });
});

describe("oso purge --host codex over a fixture HOME", () => {
  test("without --yes it removes nothing", () => {
    const home = fixtureHome();
    const outcome = purgeCodex(inputFor(home, { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.equal(existsInHome(home, ".codex"), true);
  });

  test("it backs the Codex home up before removing it, and reports the restore path", () => {
    const home = fixtureHome();
    writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    const outcome = purgeCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(existsInHome(home, ".codex"), false);
    const backupRoot = (outcome.report.split("\n").find((line) => line.startsWith("backup: ")) ?? "").slice("backup: ".length);
    assert.equal(readFileSync(path.join(backupRoot, "items", "codex-home", "config.toml"), "utf8"), 'model = "x"\n');
    assert.match(outcome.report, /restore with:/);
  });

  test("an already-absent home is reported as absent rather than as a failure", () => {
    const home = fixtureHome();
    rmSync(path.join(home, ".codex"), { recursive: true, force: true });
    const outcome = purgeCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.report, /Codex home: OK — already absent/);
  });
});

describe(
  `the ${SITES_REACHING_CONFIG_TOML_BYTES.length} native-join expression(s) that reach config.toml bytes, across the ` +
    `${THE_CONFIG_TOML_CLOSURE.length} file(s) of the closure that can — the row's whole win32 surface`,
  () => {
    test("the rendered body is byte-identical for the same two path strings whatever platform renders it", () => {
      const posix = renderCodexManagedConfig("/home/x/.codex", "/home/x/rt", "/usr/bin/fallow-mcp");
      const again = renderCodexManagedConfig("/home/x/.codex", "/home/x/rt", "/usr/bin/fallow-mcp");
      assert.equal(posix, again);
      assert.ok(posix.includes('OSO_STATE_BIN = "/home/x/rt/bin/oso-state"'));
    });

    test("a native win32-shaped home renders its separators back verbatim, backslash-escaped by the TOML quoter", () => {
      const rendered = renderCodexManagedConfig("C:\\Users\\x\\.codex", "C:\\Users\\x\\rt", "fallow-mcp.cmd");
      assert.ok(rendered.includes('OSO_STATE_BIN = "C:\\\\Users\\\\x\\\\rt/bin/oso-state"'));
    });

    test("the config.toml render closure is exactly the files recorded here, so no site hides in a file this walk never opens", () => {
      assert.deepEqual(
        importClosureOf(CONFIG_TOML_CLOSURE_ROOTS),
        THE_CONFIG_TOML_CLOSURE.map((entry) => entry.file),
        "the transitive relative-import closure of the config.toml renderers changed; classify the new file's native joins here",
      );
    });

    test("every closure file composes exactly the recorded number of native path.join/path.resolve expressions", () => {
      assert.deepEqual(
        THE_CONFIG_TOML_CLOSURE.map((entry) => ({ file: entry.file, nativeJoins: nativeJoinCountOf(entry.file) })),
        THE_CONFIG_TOML_CLOSURE.map((entry) => ({ file: entry.file, nativeJoins: entry.nativeJoins })),
        "a native path composition was added or removed inside the config.toml closure; record it below as reaching config.toml bytes or not, then update this count",
      );
    });

    test("every recorded site that reaches config.toml bytes still stands inside the producer named for it", () => {
      const missing = SITES_REACHING_CONFIG_TOML_BYTES.filter(
        (site) => !bodyLinesOf(sourceOf(site.file), site.producer).some((line) => line.trim() === site.expression),
      );
      assert.deepEqual(missing, [], missing.map((site) => `${site.file} ${site.producer}: ${site.expression} — carries ${site.carries}`).join("\n"));
    });
  },
);

describe("the walk this inventory rests on, read over synthetic sources this repository does not ship", () => {
  test("nativeJoinCountOf counts every occurrence rather than every line, and passes over path.posix.join", () => {
    assert.equal(countNativeJoinsIn('a = path.join(x, path.join(y, z));\nb = path.posix.join(p, q);\nc = path.resolve(r);\n'), 3);
  });

  test("bodyLinesOf returns the named function alone, and nothing for a name the source does not declare", () => {
    const source = "function first() {\n  const a = 1;\n}\n\nfunction second() {\n  const b = 2;\n}\n";
    assert.deepEqual(bodyLinesOf(source, "first"), ["function first() {", "  const a = 1;", "}"]);
    assert.deepEqual(bodyLinesOf(source, "third"), []);
  });
});

describe("the global AGENTS.md region rebuild", () => {
  test("an absent file becomes the region alone", () => {
    assert.equal(rebuildGlobalGuidance("", "body\n"), `${GLOBAL_MARKER_START}\nbody\n${GLOBAL_MARKER_END}\n`);
  });

  test("an existing region is replaced rather than duplicated", () => {
    const first = rebuildGlobalGuidance("keep\n", "one\n");
    const second = rebuildGlobalGuidance(first, "two\n");
    assert.equal(second, `keep\n\n${GLOBAL_MARKER_START}\ntwo\n${GLOBAL_MARKER_END}\n`);
    assert.equal(second.split(GLOBAL_MARKER_START).length - 1, 1);
  });

  test("a body with no trailing newline still closes on its own line", () => {
    assert.equal(rebuildGlobalGuidance("", "body"), `${GLOBAL_MARKER_START}\nbody\n${GLOBAL_MARKER_END}\n`);
  });

  test("a doubled start marker is refused rather than rebuilt", () => {
    assert.throws(() => rebuildGlobalGuidance(`${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_END}\n`, "x\n"), /malformed/);
  });
});

function existsInHome(home: string, relative: string): boolean {
  try {
    readFileSync(path.join(home, relative));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EISDIR";
  }
}

function withoutEngramPointers(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith(`${MODEL_INSTRUCTIONS_KEY} =`) && !line.startsWith(`${COMPACT_PROMPT_KEY} =`))
    .join("\n");
}

function sourceOf(repoRelativePath: string): string {
  return readFileSync(path.join(repositoryRoot, ...repoRelativePath.split("/")), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importClosureOf(roots: readonly string[]): string[] {
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.shift() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const match of sourceOf(file).matchAll(RELATIVE_IMPORT_PATTERN)) {
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] as string)));
    }
  }
  return [...reached].sort();
}

function countNativeJoinsIn(source: string): number {
  return [...source.matchAll(NATIVE_JOIN_PATTERN)].length;
}

function nativeJoinCountOf(repoRelativePath: string): number {
  return countNativeJoinsIn(sourceOf(repoRelativePath));
}

function gitIn(root: string, argv: readonly string[], environment?: NodeJS.ProcessEnv) {
  const run = spawnSync("git", ["-C", root, ...argv], { env: environment, encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

function bodyLinesOf(source: string, functionName: string): string[] {
  const lines = source.split("\n");
  const opening = lines.findIndex((line) => line.includes(`function ${functionName}(`));
  if (opening === -1) return [];
  const closing = lines.findIndex((line, index) => index > opening && line === "}");
  return lines.slice(opening, closing === -1 ? lines.length : closing + 1);
}
