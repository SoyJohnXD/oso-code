import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  classifyMarketplaceAddFailure,
  clearOsoOutputStyle,
  ensureOutputStyle,
  fallowWiredCommand,
  gitHooksOwner,
  installClaude,
  localMarketplacePath,
  mergeGlobalClaudeMd,
  purgeClaude,
  removeClientEnv,
  removeLegacySettingsEntries,
  repairClaude,
  resolveFallowMcpCommand,
  storeClientEnv,
  stripClaudeMdRegion,
  wireGitCommitHook,
  withoutMarkerRegion,
  type ClaudeCommandInput,
} from "../../src/install/claude.ts";
import type { EngramTransport } from "../../src/install/engram.ts";
import { SUPPORTED_ENGRAM_VERSION } from "../../src/install/pins.ts";
import { sha256Hex } from "../../src/state/store.ts";
import { buildTarGzFixture } from "../support/engram-archive-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-claude-command-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const gitOnlyBinDir = mkdtempSync(path.join(sandbox, "path-git-only-"));
symlinkSync(realGitBinary(), path.join(gitOnlyBinDir, "git"));

const fakeBinDir = mkdtempSync(path.join(sandbox, "path-"));
symlinkSync(realGitBinary(), path.join(fakeBinDir, "git"));
writeFakeClaudeStub(path.join(fakeBinDir, "claude"));

function writeFakeClaudeStub(destination: string): void {
  const body = [
    "const args = process.argv.slice(2);",
    'const key = args.join(" ");',
    'const failing = (process.env.FAKE_CLAUDE_FAIL || "").split("|").filter(Boolean);',
    "if (failing.includes(key)) {",
    '  process.stderr.write(`fake-claude: ${key} failed\\n`);',
    "  process.exit(1);",
    "}",
    'if (key === "mcp list") process.stdout.write("context7: npx context7-mcp - Connected\\n");',
    'else if (key === "plugin marketplace list --json") process.stdout.write("[]\\n");',
    'else if (key === "plugin list") process.stdout.write("oso-code\\nimpeccable\\n");',
    'else if (key === "mcp get fallow") process.stdout.write("Command: fallow-mcp\\n");',
    "process.exit(0);",
  ].join("\n");
  writeFileSync(destination, `#!${process.execPath}\n${body}\n`);
  chmodSync(destination, 0o755);
}

function realGitBinary(): string {
  const entries = (process.env["PATH"] ?? "").split(path.delimiter);
  const found = entries.map((entry) => path.join(entry, "git")).find(isExecutable);
  return found ?? "/usr/bin/git";
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const STUBS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  "the fake claude stub every guarded case below spawns answers here, so those cases are skipped for the platform rather than passed over a fixture that stopped working",
  STUBS_UNREACHABLE_ON_THE_INJECTED_PATH !== false ||
    spawnSync("claude", ["plugin", "list"], { env: { PATH: fakeBinDir }, encoding: "utf8" }).status === 0,
  `${path.join(fakeBinDir, "claude")} did not answer \`plugin list\` with exit 0, so every install case here would report the client missing rather than the wiring it means to assert`,
);

let sequence = 0;
function freshHome(): string {
  sequence += 1;
  const home = path.join(sandbox, `home-${sequence}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function scratchRepositoryRoot(): string {
  sequence += 1;
  const root = path.join(sandbox, `repo-${sequence}`);
  mkdirSync(path.join(root, "bootstrap"), { recursive: true });
  writeFileSync(path.join(root, "bootstrap", "gentle-manifest.txt"), "# legacy gentle-ai artifacts\ncommands/sdd-apply.md\n");
  writeFileSync(path.join(root, "bootstrap", "claude-global.md"), "the oso-code global body\n");
  mkdirSync(path.join(root, "plugin", "git-hooks"), { recursive: true });
  writeFileSync(path.join(root, "plugin", "git-hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  gitSync(root, ["init", "-q"]);
  return root;
}

function gitSync(root: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { env: { PATH: fakeBinDir }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function commandInput(overrides: Partial<ClaudeCommandInput> & { homeDirectory: string; repositoryRoot: string }): ClaudeCommandInput {
  return {
    environment: { PATH: fakeBinDir },
    platform: "linux",
    architecture: "x64",
    assumeYes: true,
    engramTransport: unfixturedEngramTransport(),
    ...overrides,
  };
}

function unfixturedEngramTransport(): EngramTransport {
  return (url) => {
    throw new Error(`stub engram transport: no fixture wired for ${url}`);
  };
}

function readSettings(claudeDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(claudeDir, "settings.json"), "utf8"));
}

function seedInstalledPlugin(claudeDir: string, homeDirectory: string): string {
  const installRoot = path.join(homeDirectory, "plugin-install-root");
  mkdirSync(path.join(installRoot, "bin"), { recursive: true });
  writeFileSync(path.join(installRoot, "bin", "oso-state"), "#!/usr/bin/env node\n");
  chmodSync(path.join(installRoot, "bin", "oso-state"), 0o755);
  mkdirSync(path.join(claudeDir, "plugins"), { recursive: true });
  writeFileSync(
    path.join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "oso-code@oso-code": [{ installPath: installRoot }] } }),
  );
  return installRoot;
}

describe("ownership table: env.OSO_STATE_BIN is set", () => {
  test("publishes the resolved bin/oso-state path when the plugin manifest names an executable one", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    const installRoot = seedInstalledPlugin(claudeDir, homeDirectory);
    const outcome = installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(outcome.exitCode, 0);
    const env = readSettings(claudeDir)["env"] as Record<string, string> | undefined;
    assert.equal(env?.["OSO_STATE_BIN"], path.join(installRoot, "bin", "oso-state"));
  });

  test("reports the row as failed rather than writing a key when no installed plugin manifest resolves", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    const outcome = installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.report, /oso-state path: FAILED/);
    const env = readSettings(claudeDir)["env"] as Record<string, string> | undefined;
    assert.equal(env?.["OSO_STATE_BIN"], undefined);
  });
});

describe("ownership table: env.CLAUDE_CODE_GIT_BASH_PATH is set (win32 only)", () => {
  test("publishes CLAUDE_CODE_GIT_BASH_PATH from the environment candidate when it resolves on disk", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    seedInstalledPlugin(claudeDir, homeDirectory);
    const bashExe = path.join(homeDirectory, "git-bash.exe");
    writeFileSync(bashExe, "not a real binary");
    const outcome = installClaude(
      commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot(), platform: "win32", environment: { PATH: fakeBinDir, CLAUDE_CODE_GIT_BASH_PATH: bashExe } }),
    );
    assert.equal(outcome.exitCode, 0);
    const env = readSettings(claudeDir)["env"] as Record<string, string>;
    assert.equal(env["CLAUDE_CODE_GIT_BASH_PATH"], bashExe);
  });

  test("never touches the key off win32, matching the row's platform guard", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    seedInstalledPlugin(claudeDir, homeDirectory);
    installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot(), platform: "linux" }));
    const env = readSettings(claudeDir)["env"] as Record<string, string> | undefined;
    assert.equal(env?.["CLAUDE_CODE_GIT_BASH_PATH"], undefined);
  });
});

describe("ownership table: outputStyle is set, guarded on the known-value set", () => {
  test("sets Oso when the key is absent", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(readSettings(claudeDir)["outputStyle"], "Oso");
  });

  test("leaves an operator's own custom style alone", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ outputStyle: "MyStyle" }));
    installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(readSettings(claudeDir)["outputStyle"], "MyStyle");
  });

  test("directly: ensureOutputStyle rewrites Gentleman to Oso and reports written", () => {
    const homeDirectory = freshHome();
    const settingsFile = path.join(homeDirectory, "settings.json");
    writeFileSync(settingsFile, JSON.stringify({ outputStyle: "Gentleman" }));
    const outcome = ensureOutputStyle(settingsFile);
    assert.equal(outcome.kind, "written");
    assert.equal(JSON.parse(readFileSync(settingsFile, "utf8"))["outputStyle"], "Oso");
  });
});

describe("ownership table: .hooks[] is remove-only", () => {
  test("drops legacy-command entries and prunes an event left with an empty array, keeping other entries", () => {
    const homeDirectory = freshHome();
    const settingsFile = path.join(homeDirectory, "settings.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ command: "bash plugin/hooks/check-plan-contract.sh" }] }, { hooks: [{ command: "node plugin/dist/gate.js commit" }] }],
          SessionStart: [{ hooks: [{ command: "bash /old/gentle-ai/hook.sh" }] }],
        },
      }),
    );
    const outcome = removeLegacySettingsEntries(settingsFile);
    assert.equal(outcome.kind, "written");
    const hooks = JSON.parse(readFileSync(settingsFile, "utf8"))["hooks"];
    assert.equal(hooks["PreToolUse"].length, 1);
    assert.equal(hooks["PreToolUse"][0].hooks[0].command, "node plugin/dist/gate.js commit");
    assert.equal(hooks["SessionStart"], undefined);
  });

  test("never adds or edits an entry — a settings.json with no legacy pattern is reported unchanged", () => {
    const homeDirectory = freshHome();
    const settingsFile = path.join(homeDirectory, "settings.json");
    const original = { hooks: { PreToolUse: [{ hooks: [{ command: "node plugin/dist/gate.js commit" }] }] } };
    writeFileSync(settingsFile, JSON.stringify(original));
    const outcome = removeLegacySettingsEntries(settingsFile);
    assert.equal(outcome.kind, "unchanged");
    assert.deepEqual(JSON.parse(readFileSync(settingsFile, "utf8")), original);
  });
});

describe("ownership table: CLAUDE.md marker region is region-rebuilt", () => {
  test("preserves content outside the markers in its original relative order and appends a fresh region at the end", () => {
    const before = "# my own notes\nkeep me\n<!-- oso-code:start -->\nold body\n<!-- oso-code:end -->\nafter the block, keep me too\n";
    const merged = withoutMarkerRegion(before);
    assert.equal(merged, "# my own notes\nkeep me\nafter the block, keep me too");
  });

  test("CRLF-normalises on strip", () => {
    const before = "keep me\r\n<!-- oso-code:start -->\r\nold\r\n<!-- oso-code:end -->\r\n";
    assert.equal(withoutMarkerRegion(before), "keep me");
  });

  test("mergeGlobalClaudeMd writes a fresh file when none exists yet", () => {
    const homeDirectory = freshHome();
    const claudeMd = path.join(homeDirectory, "CLAUDE.md");
    mergeGlobalClaudeMd(claudeMd, "fresh body\n", { replace: false });
    assert.equal(readFileSync(claudeMd, "utf8"), "<!-- oso-code:start -->\nfresh body\n<!-- oso-code:end -->\n");
  });

  test("mergeGlobalClaudeMd merges around an existing region on a second run (idempotent)", () => {
    const homeDirectory = freshHome();
    const claudeMd = path.join(homeDirectory, "CLAUDE.md");
    writeFileSync(claudeMd, "operator notes\n<!-- oso-code:start -->\nstale body\n<!-- oso-code:end -->\n");
    mergeGlobalClaudeMd(claudeMd, "fresh body\n", { replace: false });
    assert.equal(readFileSync(claudeMd, "utf8"), "operator notes\n<!-- oso-code:start -->\nfresh body\n<!-- oso-code:end -->\n");
  });

  test("installClaude merges the oso-code block into an existing CLAUDE.md rather than replacing it by default", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "my own project notes\n");
    installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    const content = readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8");
    assert.match(content, /my own project notes/);
    assert.match(content, /the oso-code global body/);
  });

  test("installClaude with replaceClaudeMd drops the operator's prior content entirely", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "my own project notes\n");
    installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot(), replaceClaudeMd: true }));
    const content = readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(content, /my own project notes/);
  });
});

describe("ownership table: .mcpServers.<name> is insert-if-missing, mediated through the claude CLI", () => {
  test("classifyMarketplaceAddFailure names each branch the bash classifier names", () => {
    assert.equal(classifyMarketplaceAddFailure("this source is seed-managed"), "seed-managed");
    assert.equal(classifyMarketplaceAddFailure("blocked by enterprise policy"), "policy-blocked");
    assert.equal(classifyMarketplaceAddFailure("Invalid marketplace source format"), "invalid-source");
    assert.equal(classifyMarketplaceAddFailure("Marketplace file not found"), "invalid-manifest");
    assert.equal(classifyMarketplaceAddFailure("Failed to clone marketplace repository"), "unreachable");
    assert.equal(classifyMarketplaceAddFailure("something else entirely"), "unknown");
  });

  test("localMarketplacePath finds the directory-sourced oso-code entry and nothing else", () => {
    const registry = JSON.stringify([
      { name: "oso-code", source: "directory", path: "/home/op/oso-code" },
      { name: "oso-code", source: "github", path: "" },
    ]);
    assert.equal(localMarketplacePath(registry), "/home/op/oso-code");
    assert.equal(localMarketplacePath("not json"), "");
    assert.equal(localMarketplacePath("[]"), "");
  });

  test("resolveFallowMcpCommand falls back through PATH and the cargo bin, never throwing when nothing resolves", () => {
    const homeDirectory = freshHome();
    assert.equal(resolveFallowMcpCommand({ PATH: gitOnlyBinDir }, homeDirectory, "linux"), undefined);
    const cargoBin = path.join(homeDirectory, ".cargo", "bin");
    mkdirSync(cargoBin, { recursive: true });
    writeFileSync(path.join(cargoBin, "fallow-mcp"), "#!/bin/sh\n");
    chmodSync(path.join(cargoBin, "fallow-mcp"), 0o755);
    assert.equal(resolveFallowMcpCommand({ PATH: gitOnlyBinDir }, homeDirectory, "linux"), path.join(cargoBin, "fallow-mcp"));
  });

  test("fallowWiredCommand reads empty when claude cannot be spawned, never throwing", () => {
    assert.equal(fallowWiredCommand({ PATH: gitOnlyBinDir }), "");
  });

  test("installClaude reports the fallow row as failed rather than silently skipping it when npm is unavailable", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const outcome = installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.match(outcome.report, /fallow: FAILED — no npm/);
  });
});

describe("installClaude: the engram row provisions the pinned release when detection finds nothing", () => {
  test("reports installed once a checksum-matched release is fetched, replacing the old install-by-hand failure", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const installDirectory = path.join(homeDirectory, ".local", "bin");
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const releaseSizedBinary = Buffer.from(`#!${process.execPath}\nprocess.exit(0);\n`.padEnd(2 * 1024 * 1024, " "), "utf8");
    const archive = buildTarGzFixture([{ name: "engram", content: releaseSizedBinary }]);
    const digest = sha256Hex(archive);
    const engramTransport: EngramTransport = (url) => {
      if (url.endsWith("/checksums.txt")) return Buffer.from(`${digest}  ${asset}\n`, "utf8");
      if (url.endsWith(`/${asset}`)) return archive;
      throw new Error(`no fixture wired for ${url}`);
    };

    const outcome = installClaude(
      commandInput({
        homeDirectory,
        repositoryRoot: scratchRepositoryRoot(),
        environment: { PATH: `${fakeBinDir}${path.delimiter}${installDirectory}` },
        engramTransport,
      }),
    );

    assert.equal(outcome.exitCode, 0);
    assert.ok(
      outcome.report.includes(`engram (binary): OK — installed ${SUPPORTED_ENGRAM_VERSION} at ${path.join(installDirectory, "engram")}`),
      outcome.report,
    );
  });

  test("reports the row as failed, naming the reason, when the fixtured transport cannot reach the release", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const outcome = installClaude(
      commandInput({
        homeDirectory,
        repositoryRoot: scratchRepositoryRoot(),
        engramTransport: () => {
          throw new Error("network unreachable");
        },
      }),
    );
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.report, /engram \(binary\): FAILED — could not download .*checksums\.txt/);
  });
});

describe("installClaude: backup/transaction and legacy artifact removal", () => {
  test("backs up settings.json, CLAUDE.md and every present legacy artifact before mutating, then removes the legacy ones", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(path.join(claudeDir, "commands"), { recursive: true });
    writeFileSync(path.join(claudeDir, "commands", "sdd-apply.md"), "legacy content");
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ outputStyle: "Gentleman" }));

    const outcome = installClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(outcome.exitCode, 0);
    assert.equal(existsSync(path.join(claudeDir, "commands", "sdd-apply.md")), false);
    assert.match(outcome.report, /removed 1 legacy artifact\(s\)/);

    const backupsRoot = path.join(homeDirectory, ".local", "state", "oso-code", "claude-backups");
    const backup = readdirSync(backupsRoot).at(0);
    assert.ok(backup !== undefined, "installClaude should have created exactly one backup directory");
    const manifest = readFileSync(path.join(backupsRoot, backup, "manifest"), "utf8");
    assert.match(manifest, /present\tsettings\t/);
    assert.match(manifest, /present\tcommands\/sdd-apply\.md\t/);
    assert.equal(
      readFileSync(path.join(backupsRoot, backup, "items", "commands/sdd-apply.md"), "utf8"),
      "legacy content",
    );
  });

  test("rolls back the legacy artifact removal and the settings.json rows already written once the CLAUDE.md body cannot be read, and reports the failure", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(path.join(claudeDir, "commands"), { recursive: true });
    writeFileSync(path.join(claudeDir, "commands", "sdd-apply.md"), "legacy content");
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ outputStyle: "Gentleman" }));
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "operator content\n");

    const repositoryRoot = scratchRepositoryRoot();
    const claudeGlobalMd = path.join(repositoryRoot, "bootstrap", "claude-global.md");
    chmodSync(claudeGlobalMd, 0o000);

    try {
      const outcome = installClaude(commandInput({ homeDirectory, repositoryRoot }));
      assert.equal(outcome.exitCode, 1);
      assert.match(outcome.report, /could not write CLAUDE\.md/);
      assert.match(outcome.report, /rolled back to the pre-run snapshot/);
      assert.equal(existsSync(path.join(claudeDir, "commands", "sdd-apply.md")), true, "the removed legacy artifact should have been restored by the rollback");
      assert.equal(readSettings(claudeDir)["outputStyle"], "Gentleman", "the output style row already written by this run should have been restored by the rollback");
      assert.equal(readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8"), "operator content\n");
    } finally {
      chmodSync(claudeGlobalMd, 0o644);
    }
  });

  test("treats the oso-code plugin install itself as fatal and rolls back settings.json to its pre-run content", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ outputStyle: "MyOwnStyle" }));

    const outcome = installClaude(
      commandInput({
        homeDirectory,
        repositoryRoot: scratchRepositoryRoot(),
        environment: { PATH: fakeBinDir, FAKE_CLAUDE_FAIL: "plugin install oso-code@oso-code" },
      }),
    );
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /the oso-code plugin itself failed to install/);
    assert.match(outcome.report, /rolled back to the pre-run snapshot/);
    assert.deepEqual(readSettings(claudeDir), { outputStyle: "MyOwnStyle" });
  });

  test("is idempotent on a second run over the same fixture HOME", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const repositoryRoot = scratchRepositoryRoot();
    const first = installClaude(commandInput({ homeDirectory, repositoryRoot }));
    const second = installClaude(commandInput({ homeDirectory, repositoryRoot }));
    assert.equal(first.exitCode, 0);
    assert.equal(second.exitCode, 0);
    const claudeDir = path.join(homeDirectory, ".claude");
    assert.equal(readSettings(claudeDir)["outputStyle"], "Oso");
    const content = readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8");
    assert.equal(content.match(/oso-code:start/g)?.length, 1);
  });
});

describe("repairClaude: narrow re-assertion of the ownership table rows", () => {
  test("re-asserts settings.json and CLAUDE.md rows without touching legacy artifacts, which install alone owns", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    const installRoot = seedInstalledPlugin(claudeDir, homeDirectory);
    mkdirSync(path.join(claudeDir, "commands"), { recursive: true });
    writeFileSync(path.join(claudeDir, "commands", "sdd-apply.md"), "still here");
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "bash /old/gentle-ai/hook.sh" }] }] } }),
    );

    const outcome = repairClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(outcome.exitCode, 0);
    assert.equal(existsSync(path.join(claudeDir, "commands", "sdd-apply.md")), true);

    const settings = readSettings(claudeDir);
    assert.equal((settings["env"] as Record<string, string>)["OSO_STATE_BIN"], path.join(installRoot, "bin", "oso-state"));
    assert.equal(settings["outputStyle"], "Oso");
    assert.deepEqual(settings["hooks"], {});
    assert.match(readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8"), /the oso-code global body/);
  });
});

describe("purgeClaude: narrow removal of the ownership table rows", () => {
  test("removes the env keys it owns, clears an Oso output style, and strips the CLAUDE.md region, backing up first", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ env: { OSO_STATE_BIN: "/old/path", CLAUDE_CODE_GIT_BASH_PATH: "/old/bash.exe" }, outputStyle: "Oso" }),
    );
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "operator notes\n<!-- oso-code:start -->\nbody\n<!-- oso-code:end -->\n");

    const outcome = purgeClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(outcome.exitCode, 0);
    const settings = readSettings(claudeDir);
    assert.deepEqual(settings["env"], {});
    assert.equal(settings["outputStyle"], undefined);
    assert.equal(readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf8"), "operator notes\n");

    const backupsRoot = path.join(homeDirectory, ".local", "state", "oso-code", "claude-backups");
    assert.equal(readdirSync(backupsRoot).length, 1);
  });

  test("leaves a non-Oso output style alone, since purge only reverses what install would have set", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const homeDirectory = freshHome();
    const claudeDir = path.join(homeDirectory, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({ outputStyle: "MyOwnStyle" }));
    purgeClaude(commandInput({ homeDirectory, repositoryRoot: scratchRepositoryRoot() }));
    assert.equal(readSettings(claudeDir)["outputStyle"], "MyOwnStyle");
  });
});

describe("directly: removeClientEnv and storeClientEnv", () => {
  test("storeClientEnv creates settings.json and its env object from nothing", () => {
    const homeDirectory = freshHome();
    const settingsFile = path.join(homeDirectory, "settings.json");
    storeClientEnv(settingsFile, "OSO_STATE_BIN", "/abs/bin/oso-state");
    assert.deepEqual(JSON.parse(readFileSync(settingsFile, "utf8")), { env: { OSO_STATE_BIN: "/abs/bin/oso-state" } });
  });

  test("removeClientEnv reports unchanged rather than writing when the key is not set", () => {
    const homeDirectory = freshHome();
    const settingsFile = path.join(homeDirectory, "settings.json");
    writeFileSync(settingsFile, JSON.stringify({ env: { OTHER: "x" } }));
    const outcome = removeClientEnv(settingsFile, "OSO_STATE_BIN");
    assert.equal(outcome.kind, "unchanged");
  });
});

describe("gitHooksOwner / wireGitCommitHook", () => {
  test("wires core.hooksPath at the shipped location when nothing else owns it", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repositoryRoot = scratchRepositoryRoot();
    const outcome = wireGitCommitHook(repositoryRoot, { PATH: gitOnlyBinDir });
    assert.equal(outcome.ok, true);
    assert.equal(gitSync(repositoryRoot, ["config", "--get", "core.hooksPath"]).trim(), path.join(repositoryRoot, "plugin", "git-hooks"));
  });

  test("refuses to wire when another tool already owns core.hooksPath", { skip: STUBS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const repositoryRoot = scratchRepositoryRoot();
    const otherHooks = path.join(repositoryRoot, "other-hooks");
    mkdirSync(otherHooks, { recursive: true });
    gitSync(repositoryRoot, ["config", "core.hooksPath", otherHooks]);
    const owner = gitHooksOwner(repositoryRoot, { PATH: gitOnlyBinDir }, path.join(repositoryRoot, "plugin", "git-hooks"));
    assert.equal(owner, `core.hooksPath=${otherHooks}`);
    const outcome = wireGitCommitHook(repositoryRoot, { PATH: gitOnlyBinDir });
    assert.equal(outcome.ok, false);
  });
});

describe("stripClaudeMdRegion", () => {
  test("reports false and leaves the file untouched when there is no region to strip", () => {
    const homeDirectory = freshHome();
    const claudeMd = path.join(homeDirectory, "CLAUDE.md");
    writeFileSync(claudeMd, "operator content only\n");
    assert.equal(stripClaudeMdRegion(claudeMd), false);
    assert.equal(readFileSync(claudeMd, "utf8"), "operator content only\n");
  });
});

describe("clearOsoOutputStyle", () => {
  test("reports unchanged when there is no settings.json at all", () => {
    const homeDirectory = freshHome();
    const outcome = clearOsoOutputStyle(path.join(homeDirectory, "settings.json"));
    assert.equal(outcome.kind, "unchanged");
  });
});
