import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { writeJsonFile } from "../../src/install/json.ts";
import { VerifyReport } from "../../src/install/report.ts";
import {
  checkClaudeMdBudget,
  checkEngramBinaryResolves,
  checkGitBashPath,
  checkGitCommitHook,
  checkHookRegressionSuite,
  checkImpeccableCliRunnable,
  checkImpeccablePluginInstalled,
  checkInstalledHookDeniesRedCommit,
  checkLegacyArtifactsRemoved,
  checkMcpConnectivity,
  checkNoCarriageReturnBytes,
  checkOsoStateBinRoundTrips,
  checkPluginInstalled,
  checkSettingsFreeOfGentleHooks,
  checkWindowsHomeDirectory,
  compareVersionsAscending,
  engramBinaryRuns,
  ENGRAM_PROBE_TIMEOUT_MS,
  noteClaudeDesktop,
  normalizedPath,
  verifyClaude,
} from "../../src/install/verify-claude.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-verify-claude-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

let sandboxSequence = 0;
function freshDirectory(): string {
  sandboxSequence += 1;
  const directory = path.join(sandbox, `case-${sandboxSequence}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function linesOf(report: VerifyReport): string[] {
  return report.render().split("\n");
}

describe("verifyClaude", () => {
  test("takes platform as an explicit input rather than reading process.platform, so the composed report is exercisable on its win32 branch from any host", () => {
    const homeDirectory = freshDirectory();
    const outcome = verifyClaude({
      homeDirectory,
      repositoryRoot,
      environment: { OSO_VERIFY_SKIP_SLOW: "1", HOME: homeDirectory, USERPROFILE: homeDirectory, PATH: "" },
      platform: "win32",
    });
    assert.ok(outcome.report.split("\n").some((line) => line.includes("engram binary the client resolves and runs")));
  });
});

describe("checkPluginInstalled", () => {
  test("passes when the plugin listing names oso-code", () => {
    const report = new VerifyReport();
    checkPluginInstalled(report, "oso-code   1.0.0  enabled\n");
    assert.ok(linesOf(report).includes("ok:   oso-code plugin installed (1)"));
  });

  test("fails on an empty listing", () => {
    const report = new VerifyReport();
    checkPluginInstalled(report, "");
    assert.ok(linesOf(report).includes("FAIL: oso-code plugin installed — expected 1, got 0"));
  });
});

describe("checkMcpConnectivity", () => {
  test("a bare server name line counts as connected", () => {
    const report = new VerifyReport();
    checkMcpConnectivity(report, "engram: node engram-mcp - Connected\ncontext7: npx context7 - Connected\nfallow: fallow-mcp - Connected\n");
    assert.ok(linesOf(report).includes("ok:   engram MCP connected (1)"));
    assert.ok(linesOf(report).includes("ok:   context7 MCP connected (1)"));
    assert.ok(linesOf(report).includes("ok:   fallow MCP connected (1)"));
  });

  test("a plugin-namespaced line still counts as connected", () => {
    const report = new VerifyReport();
    checkMcpConnectivity(report, "plugin:oso-code:context7: npx context7 - Connected\n", );
    assert.ok(linesOf(report).some((line) => line === "ok:   context7 MCP connected (1)"));
  });

  test("a line naming the server but not Connected fails, with its fix suffix intact", () => {
    const report = new VerifyReport();
    checkMcpConnectivity(report, "engram: node engram-mcp - Failed to connect\n");
    assert.ok(linesOf(report).some((line) => line.startsWith("FAIL: engram MCP connected — expected 1, got 0 — fix: ")));
  });
});

describe("checkLegacyArtifactsRemoved", () => {
  function seedRepo(manifest: string): string {
    const root = freshDirectory();
    mkdirSync(path.join(root, "bootstrap"), { recursive: true });
    writeFileSync(path.join(root, "bootstrap", "gentle-manifest.txt"), manifest);
    return root;
  }

  test("passes at zero when none of the manifest's paths are present", () => {
    const root = seedRepo("# a comment\n\nold-hooks/clean-code-gate.sh\n");
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkLegacyArtifactsRemoved(report, root, claudeDir);
    assert.ok(linesOf(report).includes("ok:   legacy artifacts removed (0)"));
  });

  test("counts a present entry and details its path, tolerating a CR-terminated line", () => {
    const root = seedRepo("old-hooks/clean-code-gate.sh\r\n");
    const claudeDir = freshDirectory();
    mkdirSync(path.join(claudeDir, "old-hooks"), { recursive: true });
    writeFileSync(path.join(claudeDir, "old-hooks", "clean-code-gate.sh"), "#!/bin/sh\n");
    const report = new VerifyReport();
    checkLegacyArtifactsRemoved(report, root, claudeDir);
    const lines = linesOf(report);
    assert.ok(lines.includes("FAIL: legacy artifacts removed — expected 0, got 1"));
    assert.ok(lines.includes("      still present: old-hooks/clean-code-gate.sh"));
  });

  test("a broken symlink still counts as present, matching -e || -L", () => {
    const root = seedRepo("dangling-link\n");
    const claudeDir = freshDirectory();
    symlinkSync(path.join(claudeDir, "nowhere"), path.join(claudeDir, "dangling-link"));
    const report = new VerifyReport();
    checkLegacyArtifactsRemoved(report, root, claudeDir);
    assert.ok(linesOf(report).includes("FAIL: legacy artifacts removed — expected 0, got 1"));
  });
});

describe("checkSettingsFreeOfGentleHooks", () => {
  test("reports the grep-style missing-file message when settings.json is absent", () => {
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkSettingsFreeOfGentleHooks(report, claudeDir);
    assert.ok(
      linesOf(report).some(
        (line) => line.startsWith("FAIL: settings.json free of gentle hooks — expected 0, got grep: ") && line.endsWith("No such file or directory"),
      ),
    );
  });

  test("passes at zero when no legacy pattern appears", () => {
    const claudeDir = freshDirectory();
    writeJsonFile(path.join(claudeDir, "settings.json"), { env: { OSO_STATE_BIN: "/bin/oso-state" } });
    const report = new VerifyReport();
    checkSettingsFreeOfGentleHooks(report, claudeDir);
    assert.ok(linesOf(report).includes("ok:   settings.json free of gentle hooks (0)"));
  });

  test("counts one matching line per pattern hit, not per pattern", () => {
    const claudeDir = freshDirectory();
    writeFileSync(path.join(claudeDir, "settings.json"), '{"command":"clean-code-gate.sh and gentle-ai too"}\n{"other":"line"}\n');
    const report = new VerifyReport();
    checkSettingsFreeOfGentleHooks(report, claudeDir);
    assert.ok(linesOf(report).includes("FAIL: settings.json free of gentle hooks — expected 0, got 1"));
  });
});

describe("checkClaudeMdBudget", () => {
  test("reports unreadable when CLAUDE.md is absent", () => {
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkClaudeMdBudget(report, claudeDir);
    assert.ok(linesOf(report).some((line) => line.startsWith("FAIL: CLAUDE.md under budget — expected 1, got unreadable ")));
  });

  test("passes and reports the byte size when under budget", () => {
    const claudeDir = freshDirectory();
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "short\n");
    const report = new VerifyReport();
    checkClaudeMdBudget(report, claudeDir);
    const lines = linesOf(report);
    assert.ok(lines.includes("ok:   CLAUDE.md under budget (1)"));
    assert.ok(lines.includes("      CLAUDE.md size: 6 bytes"));
  });

  test("fails once the byte size reaches the 8000-byte budget", () => {
    const claudeDir = freshDirectory();
    writeFileSync(path.join(claudeDir, "CLAUDE.md"), "x".repeat(8000));
    const report = new VerifyReport();
    checkClaudeMdBudget(report, claudeDir);
    assert.ok(linesOf(report).includes("FAIL: CLAUDE.md under budget — expected 1, got 0"));
  });
});

describe("checkInstalledHookDeniesRedCommit", () => {
  test("reports no install path when the plugin cache and manifest are both empty", () => {
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkInstalledHookDeniesRedCommit(report, claudeDir, process.env);
    assert.ok(linesOf(report).includes("FAIL: plugin install path found — expected 1, got 0"));
  });

  test("reports the hook as not executable when the install path carries no dist/gate.js", () => {
    const claudeDir = freshDirectory();
    const installRoot = freshDirectory();
    seedInstalledPluginsManifest(claudeDir, installRoot);
    const report = new VerifyReport();
    checkInstalledHookDeniesRedCommit(report, claudeDir, process.env);
    assert.ok(linesOf(report).includes("FAIL: installed hook executable — expected 1, got 0"));
  });

  test("denies a red commit through the real committed gate bundle (e2e)", () => {
    const claudeDir = freshDirectory();
    const installRoot = freshDirectory();
    seedInstalledPluginsManifest(claudeDir, installRoot);
    mkdirSync(path.join(installRoot, "dist"), { recursive: true });
    cpSync(path.join(repositoryRoot, "plugin", "dist", "gate.js"), path.join(installRoot, "dist", "gate.js"));
    const report = new VerifyReport();
    checkInstalledHookDeniesRedCommit(report, claudeDir, process.env);
    assert.ok(linesOf(report).includes("ok:   installed hook denies red commit (e2e) (1)"));
  });

  function seedInstalledPluginsManifest(claudeDir: string, installRoot: string): void {
    mkdirSync(path.join(claudeDir, "plugins"), { recursive: true });
    writeJsonFile(path.join(claudeDir, "plugins", "installed_plugins.json"), {
      plugins: { "oso-code@oso-code": [{ installPath: installRoot }] },
    });
  }
});

describe("checkOsoStateBinRoundTrips", () => {
  const realStateBin = path.join(repositoryRoot, "plugin", "bin", "oso-state");

  test("fails naming settings.json when no OSO_STATE_BIN is stored", () => {
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkOsoStateBinRoundTrips(report, claudeDir, process.env);
    assert.ok(linesOf(report).some((line) => line.startsWith("FAIL: OSO_STATE_BIN round-trips oso-state (e2e) — expected probe, got no OSO_STATE_BIN in ")));
  });

  test("round-trips through the real oso-state binary and reports the stored path (e2e)", () => {
    const claudeDir = freshDirectory();
    writeJsonFile(path.join(claudeDir, "settings.json"), { env: { OSO_STATE_BIN: realStateBin } });
    const report = new VerifyReport();
    checkOsoStateBinRoundTrips(report, claudeDir, process.env);
    const lines = linesOf(report);
    assert.ok(lines.includes("ok:   OSO_STATE_BIN round-trips oso-state (e2e) (probe)"));
    assert.ok(lines.includes(`      OSO_STATE_BIN: ${realStateBin}`));
  });
});

describe("checkHookRegressionSuite", () => {
  test("skips with the exact switch line when OSO_VERIFY_SKIP_SLOW=1", () => {
    const report = new VerifyReport();
    checkHookRegressionSuite(report, repositoryRoot, { OSO_VERIFY_SKIP_SLOW: "1" });
    assert.ok(linesOf(report).includes("skip: hook regression suite — OSO_VERIFY_SKIP_SLOW (CI runs the suite as its own step)"));
  });

  test("fails when the suite script is not there to run", () => {
    const root = freshDirectory();
    const report = new VerifyReport();
    checkHookRegressionSuite(report, root, {});
    assert.ok(linesOf(report).includes("FAIL: hook regression suite — expected pass, got fail"));
  });
});

describe("checkImpeccablePluginInstalled", () => {
  test("notes the opt-out marker rather than checking the plugin listing", () => {
    const homeDirectory = freshDirectory();
    mkdirSync(path.join(homeDirectory, ".local", "state", "oso-code"), { recursive: true });
    writeFileSync(path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out"), "skipped\n");
    const report = new VerifyReport();
    checkImpeccablePluginInstalled(report, homeDirectory, "");
    assert.ok(linesOf(report).some((line) => line.startsWith("note: impeccable plugin skipped")));
  });

  test("checks the plugin listing when no opt-out marker is present", () => {
    const homeDirectory = freshDirectory();
    const report = new VerifyReport();
    checkImpeccablePluginInstalled(report, homeDirectory, "impeccable   1.0.0\n");
    assert.ok(linesOf(report).includes("ok:   impeccable plugin installed (1)"));
  });
});

describe("checkImpeccableCliRunnable", () => {
  test("skips with the exact switch line when OSO_VERIFY_SKIP_SLOW=1", () => {
    const report = new VerifyReport();
    checkImpeccableCliRunnable(report, { OSO_VERIFY_SKIP_SLOW: "1" });
    assert.ok(linesOf(report).includes("skip: impeccable CLI runnable via npx — OSO_VERIFY_SKIP_SLOW (the probe would fetch the package from npm)"));
  });
});

describe("checkGitCommitHook", () => {
  function seedRepo(): string {
    const root = freshDirectory();
    mkdirSync(path.join(root, "plugin", "git-hooks"), { recursive: true });
    writeFileSync(path.join(root, "plugin", "git-hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
    gitSync(root, ["init", "-q"]);
    return root;
  }

  test("notes the unwired core.hooksPath rather than checking executability", () => {
    const root = seedRepo();
    const report = new VerifyReport();
    checkGitCommitHook(report, root, process.env);
    assert.ok(linesOf(report).some((line) => line.startsWith("note: core.hooksPath is unset in ")));
  });

  test("checks executability once core.hooksPath is wired at the shipped location", () => {
    const root = seedRepo();
    gitSync(root, ["config", "core.hooksPath", path.join(root, "plugin", "git-hooks")]);
    chmodSync(path.join(root, "plugin", "git-hooks", "pre-commit"), 0o755);
    const report = new VerifyReport();
    checkGitCommitHook(report, root, process.env);
    assert.ok(linesOf(report).includes("ok:   git commit hook executable at the wired core.hooksPath (1)"));
  });

  function gitSync(root: string, args: readonly string[]): void {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

describe("checkNoCarriageReturnBytes", () => {
  test("passes at none when nothing under the shipped paths carries a CR byte", () => {
    const root = freshDirectory();
    mkdirSync(path.join(root, "plugin", "hooks"), { recursive: true });
    writeFileSync(path.join(root, "plugin", "hooks", "commit.sh"), "#!/bin/sh\nexit 0\n");
    const report = new VerifyReport();
    checkNoCarriageReturnBytes(report, root);
    assert.ok(linesOf(report).includes("ok:   shipped executables carry no CR bytes (none)"));
  });

  test("names a CR-carrying file, space-terminated as tr would leave it", () => {
    const root = freshDirectory();
    mkdirSync(path.join(root, "bootstrap"), { recursive: true });
    writeFileSync(path.join(root, "bootstrap", "install.ps1"), "Write-Host 'hi'\r\n");
    const report = new VerifyReport();
    checkNoCarriageReturnBytes(report, root);
    assert.ok(linesOf(report).includes("FAIL: shipped executables carry no CR bytes — expected none, got bootstrap/install.ps1 "));
  });

  test("fails on an empty scan rather than reporting ok: by having looked at nothing", () => {
    const root = freshDirectory();
    const report = new VerifyReport();
    checkNoCarriageReturnBytes(report, root);
    assert.ok(
      linesOf(report).includes(
        "FAIL: shipped executables carry no CR bytes — expected at least one file scanned, got 0 files scanned",
      ),
    );
  });
});

describe("checkWindowsHomeDirectory", () => {
  test("notes rather than checking when USERPROFILE is unset", () => {
    const report = new VerifyReport();
    checkWindowsHomeDirectory(report, { HOME: "/home/op" });
    assert.ok(linesOf(report).some((line) => line.startsWith("note: home dir the Windows client reads — %USERPROFILE% is unset")));
  });

  test("fails naming the divergence when USERPROFILE and HOME normalize differently", () => {
    const report = new VerifyReport();
    checkWindowsHomeDirectory(report, { HOME: "/c/Users/op", USERPROFILE: "C:\\Users\\other" });
    assert.ok(
      linesOf(report).some((line) => line.startsWith("FAIL: home dir the Windows client reads — expected C:\\Users\\other, got /c/Users/op")),
    );
  });

  test("passes once USERPROFILE and HOME normalize to the same drive path", () => {
    const report = new VerifyReport();
    checkWindowsHomeDirectory(report, { HOME: "/c/Users/op", USERPROFILE: "C:\\Users\\op" });
    assert.ok(linesOf(report).includes("ok:   home dir the Windows client reads (/c/Users/op)"));
  });
});

describe("checkEngramBinaryResolves", () => {
  test("notes rather than checking off Windows, pinning the platform rather than reading process.platform", () => {
    const report = new VerifyReport();
    checkEngramBinaryResolves(report, {}, "darwin");
    assert.ok(linesOf(report).some((line) => line.startsWith("note: engram binary the client resolves and runs")));
  });

  test("fails naming the persisted-PATH miss on win32, without touching the real PATH", () => {
    const pathDirectory = freshDirectory();
    const report = new VerifyReport();
    checkEngramBinaryResolves(report, { PATH: pathDirectory }, "win32");
    assert.ok(
      linesOf(report).some((line) =>
        line.startsWith("FAIL: engram binary the client resolves and runs — expected 1, got no engram.exe on the persisted machine or user PATH"),
      ),
    );
  });

  test("passes and details the resolved path on win32 when the injected PATH's engram.exe runs", () => {
    const pathDirectory = freshDirectory();
    const engramExe = path.join(pathDirectory, "engram.exe");
    writeFileSync(engramExe, "#!/bin/sh\nexit 0\n");
    chmodSync(engramExe, 0o755);
    const report = new VerifyReport();
    checkEngramBinaryResolves(report, { PATH: pathDirectory }, "win32");
    const lines = linesOf(report);
    assert.ok(lines.includes("ok:   engram binary the client resolves and runs (1)"));
    assert.ok(lines.includes(`      engram binary: ${engramExe}`));
  });

  test("fails naming the resolved-but-not-running binary on win32", () => {
    const pathDirectory = freshDirectory();
    const engramExe = path.join(pathDirectory, "engram.exe");
    writeFileSync(engramExe, "#!/bin/sh\nexit 1\n");
    chmodSync(engramExe, 0o755);
    const report = new VerifyReport();
    checkEngramBinaryResolves(report, { PATH: pathDirectory }, "win32");
    assert.ok(
      linesOf(report).some((line) =>
        line.startsWith(`FAIL: engram binary the client resolves and runs — expected 1, got ${engramExe} does not run`),
      ),
    );
  });
});

describe("engramBinaryRuns: the run probe stands between a downloaded, unsigned binary and this machine", () => {
  const PLANTED_AMBIENT_SECRET = "planted-by-this-test-and-never-to-reach-the-binary";
  const PROBE_BOUND_SLACK_MS = 2_000;

  function probeFixture(name: string, content: string): string {
    const binary = path.join(freshDirectory(), name);
    writeFileSync(binary, content);
    chmodSync(binary, 0o755);
    return binary;
  }

  test("refuses a zero-byte file that the kernel's own /bin/sh fallback would otherwise certify as exit 0", () => {
    const binary = probeFixture("engram", "");

    assert.equal(spawnSync(binary, ["version"]).status, 0, "the fallback under test must still certify this file when spawned raw");
    assert.equal(engramBinaryRuns(binary, {}), false);
  });

  test("refuses a shebang-less `exit 0` script the same fallback would otherwise certify", () => {
    const binary = probeFixture("engram", "exit 0\n");

    assert.equal(spawnSync(binary, ["version"]).status, 0, "the fallback under test must still certify this script when spawned raw");
    assert.equal(engramBinaryRuns(binary, {}), false);
  });

  test("hands the binary the allowed variables and nothing else the operator's environment carries", () => {
    const directory = freshDirectory();
    const seenEnvironment = path.join(directory, "seen-environment.json");
    const spy = path.join(directory, "engram");
    writeFileSync(spy, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(seenEnvironment)}, JSON.stringify(process.env));\n`);
    chmodSync(spy, 0o755);

    assert.equal(engramBinaryRuns(spy, { PATH: directory, OSO_AMBIENT_SECRET: PLANTED_AMBIENT_SECRET }), true);

    const seen = JSON.parse(readFileSync(seenEnvironment, "utf8")) as Record<string, string>;
    assert.deepEqual(Object.keys(seen), ["PATH"]);
    assert.equal(seen["OSO_AMBIENT_SECRET"], undefined);
  });

  test("returns inside its own declared bound on a binary that never exits, rather than blocking the installer forever", () => {
    const binary = probeFixture("engram", "#!/bin/sh\nsleep 3600\n");
    const startedAt = Date.now();

    assert.equal(engramBinaryRuns(binary, {}), false);

    const elapsed = Date.now() - startedAt;
    assert.ok(
      elapsed < ENGRAM_PROBE_TIMEOUT_MS + PROBE_BOUND_SLACK_MS,
      `the probe took ${elapsed} ms, past its ${ENGRAM_PROBE_TIMEOUT_MS} ms bound plus ${PROBE_BOUND_SLACK_MS} ms of teardown`,
    );
  });
});

describe("checkGitBashPath", () => {
  test("notes when settings.json publishes no CLAUDE_CODE_GIT_BASH_PATH", () => {
    const claudeDir = freshDirectory();
    const report = new VerifyReport();
    checkGitBashPath(report, claudeDir);
    assert.ok(linesOf(report).some((line) => line.startsWith("note: Git Bash path the client spawns hooks with")));
  });

  test("fails naming the stored path once it no longer resolves", () => {
    const claudeDir = freshDirectory();
    writeJsonFile(path.join(claudeDir, "settings.json"), { env: { CLAUDE_CODE_GIT_BASH_PATH: "/nowhere/bash.exe" } });
    const report = new VerifyReport();
    checkGitBashPath(report, claudeDir);
    assert.ok(
      linesOf(report).some((line) =>
        line.startsWith("FAIL: Git Bash path the client spawns hooks with — expected 1, got /nowhere/bash.exe is not there any more"),
      ),
    );
  });

  test("passes and details the stored path once it resolves", () => {
    const claudeDir = freshDirectory();
    const bash = path.join(claudeDir, "bash.exe");
    writeFileSync(bash, "");
    writeJsonFile(path.join(claudeDir, "settings.json"), { env: { CLAUDE_CODE_GIT_BASH_PATH: bash } });
    const report = new VerifyReport();
    checkGitBashPath(report, claudeDir);
    const lines = linesOf(report);
    assert.ok(lines.includes("ok:   Git Bash path the client spawns hooks with (1)"));
    assert.ok(lines.includes(`      Git Bash: ${bash}`));
  });
});

describe("noteClaudeDesktop", () => {
  test("names none-is-here when no candidate location exists", () => {
    const homeDirectory = freshDirectory();
    const report = new VerifyReport();
    noteClaudeDesktop(report, homeDirectory, {});
    assert.ok(linesOf(report).some((line) => line.startsWith("note: Claude Desktop — none of ") && line.includes(" is here, so this machine runs the CLI alone")));
  });
});

describe("normalizedPath", () => {
  test("turns a POSIX-style drive path into an uppercase Windows drive path", () => {
    assert.equal(normalizedPath("/c/Users/op/project"), "C:/Users/op/project");
  });

  test("uppercases a bare lowercase drive letter", () => {
    assert.equal(normalizedPath("c:\\Users\\op"), "C:/Users/op");
  });

  test("strips one trailing slash but leaves a bare drive root alone", () => {
    assert.equal(normalizedPath("C:/Users/op/"), "C:/Users/op");
    assert.equal(normalizedPath("/c"), "C:");
  });

  test("leaves an ordinary POSIX path untouched", () => {
    assert.equal(normalizedPath("/home/op/project"), "/home/op/project");
  });
});

describe("compareVersionsAscending", () => {
  test("orders numeric segments numerically rather than lexically", () => {
    assert.ok(compareVersionsAscending("0.9.0", "0.10.0") < 0);
  });

  test("the highest of a sorted set lands last, matching sort -V | tail -1", () => {
    const highest = ["0.9.0", "0.25.0", "0.3.0"].sort(compareVersionsAscending).at(-1);
    assert.equal(highest, "0.25.0");
  });
});
