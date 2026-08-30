// core/src/bin/oso.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// core/src/state/store.ts
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function isDirectory(target) {
  const stats = statOrUndefined(target);
  return stats !== void 0 && stats.isDirectory();
}
function isRegularNonSymlinkFile(target) {
  const stats = lstatOrUndefined(target);
  return stats !== void 0 && stats.isFile();
}
function isReadableRegularFile(target) {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
function isExecutableRegularFile(target) {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function homeDirectoryFrom(platform, environment) {
  if (platform === "win32") {
    const profile = environment["USERPROFILE"] ?? homedir();
    if (profile === "") throw new Error("USERPROFILE is not set");
    return profile;
  }
  const home = environment["HOME"];
  if (home === void 0 || home === "") throw new Error("HOME is not set");
  return home;
}
function lstatOrUndefined(target) {
  try {
    return lstatSync(target);
  } catch {
    return void 0;
  }
}
function statOrUndefined(target) {
  try {
    return statSync(target);
  } catch {
    return void 0;
  }
}
function isErrnoException(error) {
  return error instanceof Error && "code" in error;
}

// core/src/install/verify-claude.ts
import { spawnSync } from "node:child_process";
import { lstatSync as lstatSync3, mkdirSync as mkdirSync3, mkdtempSync, readFileSync as readFileSync4, readdirSync as readdirSync2, rmSync as rmSync3, statSync as statSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// core/src/install/backup.ts
import { cpSync, lstatSync as lstatSync2, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, rmSync as rmSync2, statSync as statSync2 } from "node:fs";
var DISK_BLOCK_SIZE_BYTES = 512;
var BYTES_PER_KIB = 1024;
var DISK_BLOCKS_PER_KIB = BYTES_PER_KIB / DISK_BLOCK_SIZE_BYTES;
function childDirectoryNames(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

// core/src/install/json.ts
import { readFileSync as readFileSync3 } from "node:fs";
var JsonParseError = class extends Error {
  file;
  constructor(file, cause) {
    super(`cannot parse JSON at ${file}`, { cause });
    this.name = "JsonParseError";
    this.file = file;
  }
};
function readJsonFile(file) {
  if (!isReadableRegularFile(file)) return void 0;
  try {
    return JSON.parse(readFileSync3(file, "utf8"));
  } catch (cause) {
    throw new JsonParseError(file, cause);
  }
}
function readJsonObject(file) {
  const value = readJsonFile(file);
  if (value === void 0) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JsonParseError(file, new Error("top-level value is not a JSON object"));
  }
  return value;
}

// core/src/install/report.ts
var OK_PREFIX = "ok:   ";
var FAIL_PREFIX = "FAIL: ";
var NOTE_PREFIX = "note: ";
var SKIP_PREFIX = "skip: ";
var DETAIL_INDENT = "      ";
var SUMMARY_RULE = "----";
var VerifyReport = class {
  lines = [];
  passed = 0;
  failed = 0;
  check(name, expected, actual, fix) {
    if (expected === actual) {
      this.lines.push(`${OK_PREFIX}${name} (${actual})`);
      this.passed += 1;
      return;
    }
    const fixSuffix = fix === void 0 || fix === "" ? "" : ` \u2014 fix: ${fix}`;
    this.lines.push(`${FAIL_PREFIX}${name} \u2014 expected ${expected}, got ${actual}${fixSuffix}`);
    this.failed += 1;
  }
  note(text) {
    this.lines.push(`${NOTE_PREFIX}${text}`);
  }
  skip(text) {
    this.lines.push(`${SKIP_PREFIX}${text}`);
  }
  detail(text) {
    this.lines.push(`${DETAIL_INDENT}${text}`);
  }
  get exitCode() {
    return this.failed === 0 ? 0 : 1;
  }
  render() {
    return [...this.lines, SUMMARY_RULE, `passed: ${this.passed}, failed: ${this.failed}`].map((line) => `${line}
`).join("");
  }
};

// core/src/install/verify-claude.ts
var ENGRAM_FIX = "bash bootstrap/install.sh installs the engram plugin AND the pinned engram binary its .mcp.json spawns by name; where that binary is installed but the client still cannot start it, either the directory holding it is not on the PATH Claude Code reads or the copy there does not run at all \u2014 that run's wiring summary says which and names the command for it (check 13 below discriminates the two on Windows), and Claude Code has to be restarted after";
var CONTEXT7_FIX = "claude plugin install oso-code@oso-code registers it (it ships in the plugin's .mcp.json, so there is no mcp add to run), and it starts through npx \u2014 so install Node.js if npx is missing, then restart Claude Code";
var FALLOW_FIX = "bash bootstrap/install.sh installs the pinned fallow package from npm and wires a missing entry; an existing one it never touches, so repoint that with claude mcp remove fallow -s user && claude mcp add --scope user fallow -- the command that run names";
var STATE_BIN_FIX = "bash bootstrap/install.sh publishes the installed plugin's absolute bin/oso-state there, then restart Claude Code";
var GIT_BASH_FIX = "point CLAUDE_CODE_GIT_BASH_PATH at the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe) \u2014 bootstrap\\install.ps1 finds it and hands it to install.sh, which repairs the stored value; then restart Claude Code";
var HOME_DIR_FIX = 're-run from PowerShell (bootstrap/install.ps1 sets HOME to %USERPROFILE% for you), or export HOME="$USERPROFILE" in Git Bash and re-run bootstrap/install.sh';
var ENGRAM_BINARY_FIX = "bash bootstrap/install.sh downloads the pinned engram release into ~/.local/bin and reports it only once it answers; where one is already installed elsewhere, the verdict above says which half is missing \u2014 a directory not on the persisted PATH, which that run's wiring summary names the command to add (a new terminal plus a Claude Code restart is what picks it up), or a copy that does not run, which an antivirus may have quarantined and which that run tells you how to replace";
function verifyClaude(input) {
  const { homeDirectory, repositoryRoot: repositoryRoot2, environment, platform } = input;
  const claudeDir = path.join(homeDirectory, ".claude");
  const report2 = new VerifyReport();
  const pluginListing = spawnClaudeStdout(environment, ["plugin", "list"]);
  const mcpListing = spawnClaudeStdout(environment, ["mcp", "list"]);
  checkPluginInstalled(report2, pluginListing);
  checkMcpConnectivity(report2, mcpListing);
  checkLegacyArtifactsRemoved(report2, repositoryRoot2, claudeDir);
  checkSettingsFreeOfGentleHooks(report2, claudeDir);
  checkClaudeMdBudget(report2, claudeDir);
  checkInstalledHookDeniesRedCommit(report2, claudeDir, environment);
  checkOsoStateBinRoundTrips(report2, claudeDir, environment);
  checkHookRegressionSuite(report2, repositoryRoot2, environment);
  checkImpeccablePluginInstalled(report2, homeDirectory, pluginListing);
  checkImpeccableCliRunnable(report2, environment);
  checkGitCommitHook(report2, repositoryRoot2, environment);
  checkNoCarriageReturnBytes(report2, repositoryRoot2);
  checkWindowsHomeDirectory(report2, environment);
  checkEngramBinaryResolves(report2, environment, platform);
  checkGitBashPath(report2, claudeDir);
  noteClaudeDesktop(report2, homeDirectory, environment);
  return { report: report2.render(), exitCode: report2.exitCode };
}
function checkPluginInstalled(report2, pluginListing) {
  report2.check("oso-code plugin installed", "1", countMatchingLines(pluginListing, "oso-code") >= 1 ? "1" : "0");
}
function checkMcpConnectivity(report2, mcpListing) {
  report2.check("engram MCP connected", "1", mcpConnected(mcpListing, "engram"), ENGRAM_FIX);
  report2.check("context7 MCP connected", "1", mcpConnected(mcpListing, "context7"), CONTEXT7_FIX);
  report2.check("fallow MCP connected", "1", mcpConnected(mcpListing, "fallow"), FALLOW_FIX);
}
function checkLegacyArtifactsRemoved(report2, repositoryRoot2, claudeDir) {
  const manifest = path.join(repositoryRoot2, "bootstrap", "gentle-manifest.txt");
  let content;
  try {
    content = readFileSync4(manifest, "utf8");
  } catch (cause) {
    report2.check("legacy artifacts removed", "0", errorMessageOf(cause));
    return;
  }
  let left = 0;
  for (const rel of manifestEntries(content)) {
    if (!existsAtAll(path.join(claudeDir, rel))) continue;
    left += 1;
    report2.detail(`still present: ${rel}`);
  }
  report2.check("legacy artifacts removed", "0", String(left));
}
function checkSettingsFreeOfGentleHooks(report2, claudeDir) {
  const legacyHookCommandPatterns = ["check-plan-contract", "clean-code-gate", "skill-registry-refresh", "gentle-ai"];
  const settings = path.join(claudeDir, "settings.json");
  report2.check("settings.json free of gentle hooks", "0", grepCountOrErrorMessage(settings, legacyHookCommandPatterns));
}
function checkClaudeMdBudget(report2, claudeDir) {
  const claudeMdBudgetBytes = 8e3;
  const claudeMd = path.join(claudeDir, "CLAUDE.md");
  if (!isReadableRegularFile(claudeMd)) {
    report2.check("CLAUDE.md under budget", "1", `unreadable ${claudeMd}`);
    return;
  }
  const byteSize = statSync3(claudeMd).size;
  report2.check("CLAUDE.md under budget", "1", byteSize < claudeMdBudgetBytes ? "1" : "0");
  report2.detail(`CLAUDE.md size: ${byteSize} bytes`);
}
function checkInstalledHookDeniesRedCommit(report2, claudeDir, environment) {
  const installRoot = resolveInstallRoot(claudeDir);
  if (installRoot === "") {
    report2.check("plugin install path found", "1", "0");
    return;
  }
  const gate = findGateBundle(installRoot);
  if (gate === void 0) {
    report2.check("installed hook executable", "1", "0");
    return;
  }
  const outcome = runInstalledHookProbe(gate, environment);
  if (outcome.includes('"permissionDecision":"deny"')) {
    report2.check("installed hook denies red commit (e2e)", "1", "1");
    return;
  }
  report2.check("installed hook denies red commit (e2e)", "deny", outcome === "" ? "empty" : outcome);
}
function checkOsoStateBinRoundTrips(report2, claudeDir, environment) {
  const settingsFile = path.join(claudeDir, "settings.json");
  const storedStateBin = clientEnvValue(settingsFile, "OSO_STATE_BIN");
  if (storedStateBin === "") {
    report2.check("OSO_STATE_BIN round-trips oso-state (e2e)", "probe", `no OSO_STATE_BIN in ${settingsFile}`, STATE_BIN_FIX);
    return;
  }
  const probe = runOsoStateProbe(storedStateBin, environment);
  report2.check("OSO_STATE_BIN round-trips oso-state (e2e)", "probe", probe === "" ? "empty" : probe, STATE_BIN_FIX);
  report2.detail(`OSO_STATE_BIN: ${storedStateBin}`);
}
function checkHookRegressionSuite(report2, repositoryRoot2, environment) {
  if (environment["OSO_VERIFY_SKIP_SLOW"] === "1") {
    report2.skip("hook regression suite \u2014 OSO_VERIFY_SKIP_SLOW (CI runs the suite as its own step)");
    return;
  }
  const result = spawnSync("bash", [path.join(repositoryRoot2, "tests", "hooks-test.sh")], {
    cwd: repositoryRoot2,
    env: environment,
    stdio: "ignore"
  });
  report2.check("hook regression suite", "pass", result.status === 0 ? "pass" : "fail");
}
function checkImpeccablePluginInstalled(report2, homeDirectory, pluginListing) {
  const marker = path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
  if (isReadableRegularFile(marker)) {
    report2.note(
      "impeccable plugin skipped \u2014 install.sh ran with --no-impeccable, so the design bar has no plugin half here; re-run install.sh without the flag to wire it"
    );
    return;
  }
  report2.check("impeccable plugin installed", "1", countMatchingLines(pluginListing, "impeccable") >= 1 ? "1" : "0");
}
function checkImpeccableCliRunnable(report2, environment) {
  if (environment["OSO_VERIFY_SKIP_SLOW"] === "1") {
    report2.skip("impeccable CLI runnable via npx \u2014 OSO_VERIFY_SKIP_SLOW (the probe would fetch the package from npm)");
    return;
  }
  report2.check("impeccable CLI runnable via npx", "1", impeccableCliRunnable(environment));
}
function checkGitCommitHook(report2, repositoryRoot2, environment) {
  const gitHook = path.join(repositoryRoot2, "plugin", "git-hooks", "pre-commit");
  const wiredHooksPath = gitConfigValue(repositoryRoot2, "core.hooksPath", environment);
  if (normalizedPath(wiredHooksPath) === normalizedPath(path.dirname(gitHook))) {
    report2.check("git commit hook executable at the wired core.hooksPath", "1", isExecutableRegularFile(gitHook) ? "1" : "0");
    return;
  }
  report2.note(
    `core.hooksPath is ${wiredHooksPath === "" ? "unset" : wiredHooksPath} in ${repositoryRoot2} \u2014 the git commit layer is not wired here, so only the PreToolUse gate applies`
  );
}
function checkNoCarriageReturnBytes(report2, repositoryRoot2) {
  const candidates = [
    ...filesUnderRelative(repositoryRoot2, "plugin", "hooks"),
    ...filesUnderRelative(repositoryRoot2, "plugin", "bin"),
    ...filesUnderRelative(repositoryRoot2, "plugin", "git-hooks"),
    ...directChildrenWithExtension(repositoryRoot2, "bootstrap", ".sh"),
    ...directChildrenWithExtension(repositoryRoot2, "bootstrap", ".ps1"),
    ...directChildrenWithExtension(repositoryRoot2, "bootstrap", ".bat")
  ];
  if (candidates.length === 0) {
    report2.check("shipped executables carry no CR bytes", "at least one file scanned", "0 files scanned");
    return;
  }
  const matched = candidates.filter((relative) => containsCarriageReturn(path.join(repositoryRoot2, relative)));
  report2.check("shipped executables carry no CR bytes", "none", matched.length === 0 ? "none" : `${matched.join(" ")} `);
}
function checkWindowsHomeDirectory(report2, environment) {
  const userProfile = environment["USERPROFILE"];
  const home = environment["HOME"] ?? "";
  if (userProfile === void 0 || userProfile === "") {
    report2.note(
      `home dir the Windows client reads \u2014 %USERPROFILE% is unset, so no Windows-native client reads a home dir here and $HOME (${home}) is the only tree in play`
    );
    return;
  }
  const clientHome = normalizedPath(userProfile) === normalizedPath(home) ? home : userProfile;
  report2.check("home dir the Windows client reads", clientHome, home, HOME_DIR_FIX);
}
function checkEngramBinaryResolves(report2, environment, platform) {
  if (platform !== "win32") {
    report2.note(
      "engram binary the client resolves and runs \u2014 this is not Git Bash on Windows, so the client resolves a bare `engram` against this same PATH and starting the server exercises both, which check 2 already does"
    );
    return;
  }
  const binaryName = "engram.exe";
  const resolved = firstExecutableOnPath(environment, binaryName);
  const state = resolved === void 0 ? `no ${binaryName} on the persisted machine or user PATH` : engramBinaryRuns(resolved) ? "1" : `${resolved} does not run`;
  report2.check("engram binary the client resolves and runs", "1", state, ENGRAM_BINARY_FIX);
  if (resolved !== void 0) report2.detail(`engram binary: ${resolved}`);
}
function checkGitBashPath(report2, claudeDir) {
  const settingsFile = path.join(claudeDir, "settings.json");
  const storedGitBash = clientEnvValue(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH");
  if (storedGitBash === "") {
    report2.note(
      "Git Bash path the client spawns hooks with \u2014 settings.json publishes no CLAUDE_CODE_GIT_BASH_PATH, so Claude Code locates Git Bash itself; bootstrap/install.ps1 is what discovers a path and hands it to install.sh to publish"
    );
    return;
  }
  const resolves = isRegularNonSymlinkFile(storedGitBash);
  report2.check("Git Bash path the client spawns hooks with", "1", resolves ? "1" : `${storedGitBash} is not there any more`, GIT_BASH_FIX);
  if (resolves) report2.detail(`Git Bash: ${storedGitBash}`);
}
function noteClaudeDesktop(report2, homeDirectory, environment) {
  const locations = claudeDesktopLocations(homeDirectory, environment);
  const installed = locations.find(existsFollowingSymlinks);
  if (installed === void 0) {
    report2.note(
      `Claude Desktop \u2014 none of ${locations.join(" ")} is here, so this machine runs the CLI alone and the checks above are the whole install; Desktop is an application to download from claude.ai/download, not something this bootstrap installs, and it would need nothing installed here that is not already`
    );
    return;
  }
  report2.note(
    `Claude Desktop \u2014 ${installed}; its Code tab runs the CLI's engine and shares this ~/.claude \u2014 CLAUDE.md, MCP servers, hooks, skills and settings \u2014 so every check above answers for it too; what no shell can see is whether a running Desktop has loaded them, and the chat tab is a separate surface nothing here writes`
  );
}
function spawnClaudeStdout(environment, args) {
  const result = spawnSync("claude", args, { env: environment, encoding: "utf8" });
  return result.error === void 0 ? result.stdout : "";
}
function countMatchingLines(text, substring) {
  return text.split("\n").filter((line) => line.includes(substring)).length;
}
function mcpConnected(mcpListing, name) {
  const pattern = new RegExp(`^(plugin:[^:]+:)?${name}:`);
  return mcpListing.split("\n").some((line) => pattern.test(line) && line.includes("Connected")) ? "1" : "0";
}
function manifestEntries(content) {
  return content.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line !== "" && !line.startsWith("#"));
}
function existsAtAll(target) {
  try {
    lstatSync3(target);
    return true;
  } catch {
    return false;
  }
}
function grepCountOrErrorMessage(file, patterns) {
  let content;
  try {
    content = readFileSync4(file, "utf8");
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === "ENOENT") return `grep: ${file}: No such file or directory`;
    if (isErrnoException(cause) && cause.code === "EISDIR") return `grep: ${file}: Is a directory`;
    throw cause;
  }
  const matches = content.split("\n").filter((line) => patterns.some((pattern) => line.includes(pattern))).length;
  return String(matches);
}
function resolveInstallRoot(claudeDir) {
  const installedPlugins = path.join(claudeDir, "plugins", "installed_plugins.json");
  const fromManifest = installRootFromManifest(installedPlugins);
  if (fromManifest !== void 0 && isDirectory(fromManifest)) return fromManifest;
  return highestVersionedCacheDirectory(path.join(claudeDir, "plugins", "cache", "oso-code", "oso-code"));
}
function installRootFromManifest(installedPluginsFile) {
  if (!isReadableRegularFile(installedPluginsFile)) return void 0;
  try {
    const parsed = readJsonObject(installedPluginsFile);
    const plugins = parsed["plugins"];
    const entries = isRecord(plugins) ? plugins["oso-code@oso-code"] : void 0;
    const first = Array.isArray(entries) ? entries[0] : void 0;
    const installPath = isRecord(first) ? first["installPath"] : void 0;
    return typeof installPath === "string" && installPath !== "" ? installPath : void 0;
  } catch {
    return void 0;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function highestVersionedCacheDirectory(cacheDirectory) {
  const names = childDirectoryNames(cacheDirectory);
  if (names.length === 0) return "";
  const highest = [...names].sort(compareVersionsAscending).at(-1);
  return highest === void 0 ? "" : path.join(cacheDirectory, highest);
}
function compareVersionsAscending(a, b) {
  const segmentsOf = (value) => value.split(/(\d+)/).filter((segment) => segment !== "");
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index] ?? "";
    const rightSegment = right[index] ?? "";
    const bothNumeric = /^\d+$/.test(leftSegment) && /^\d+$/.test(rightSegment);
    const compared = bothNumeric ? Number(leftSegment) - Number(rightSegment) : leftSegment.localeCompare(rightSegment);
    if (compared !== 0) return compared;
  }
  return 0;
}
function findGateBundle(installRoot) {
  const suffix = `${path.sep}dist${path.sep}gate.js`;
  const found = allFilesUnder(installRoot).find((absolute) => absolute.endsWith(suffix));
  return found;
}
function allFilesUnder(directory) {
  if (!isDirectory(directory)) return [];
  return readdirSync2(directory, { recursive: true }).map((entry) => path.join(directory, entry.toString())).filter((absolute) => isRegularNonSymlinkFile(absolute));
}
function runInstalledHookProbe(gate, environment) {
  const hookHome = mkdtempSync(path.join(tmpdir(), "oso-verify-hook-"));
  try {
    const stateKey = sha256Hex(hookHome);
    const stateDir = path.join(hookHome, ".local", "state", "oso-code");
    mkdirSync3(stateDir, { recursive: true });
    writeFileSync2(path.join(stateDir, `${stateKey}.state`), "mode=plan\nverify_green=false\n");
    const stdin = JSON.stringify({
      session_id: "e2e",
      cwd: hookHome,
      tool_input: { command: "git commit -m x" }
    });
    const result = spawnSync("node", [gate, "commit"], {
      input: stdin,
      env: { ...environment, HOME: hookHome, USERPROFILE: hookHome, OSO_AGENT: "1" },
      encoding: "utf8"
    });
    return collapsedNewlines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  } finally {
    rmSync3(hookHome, { recursive: true, force: true });
  }
}
function clientEnvValue(settingsFile, key) {
  if (!isReadableRegularFile(settingsFile)) return "";
  try {
    const value = readJsonObject(settingsFile)["env"];
    const found = isRecord(value) ? value[key] : void 0;
    return typeof found === "string" ? found : "";
  } catch {
    return "";
  }
}
function runOsoStateProbe(stateBin, environment) {
  const probeHome = mkdtempSync(path.join(tmpdir(), "oso-verify-probe-"));
  try {
    const env = { ...environment, HOME: probeHome, USERPROFILE: probeHome, OSO_STATE_BIN: stateBin };
    const setResult = spawnSync(stateBin, ["--session", "verify-probe", "set", "mode=probe"], { env, encoding: "utf8" });
    if (setResult.error !== void 0 || setResult.status !== 0) return collapsedNewlines(errorOutputOf(setResult));
    const getResult = spawnSync(stateBin, ["--session", "verify-probe", "get", "mode"], { env, encoding: "utf8" });
    if (getResult.error !== void 0 || getResult.status !== 0) return collapsedNewlines(errorOutputOf(getResult));
    spawnSync(stateBin, ["--session", "verify-probe", "clear"], { env, encoding: "utf8" });
    return collapsedNewlines(getResult.stdout);
  } finally {
    rmSync3(probeHome, { recursive: true, force: true });
  }
}
function errorOutputOf(result) {
  if (result.error !== void 0) return result.error.message;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
function collapsedNewlines(text) {
  return text.replace(/\n+$/, "").replace(/\n/g, " ");
}
function impeccableCliRunnable(environment) {
  const npxProbeBoundSeconds = 20;
  const result = spawnSync("npx", ["impeccable", "--version"], {
    env: environment,
    encoding: "utf8",
    timeout: npxProbeBoundSeconds * 1e3,
    stdio: "ignore"
  });
  if (result.error !== void 0 && isErrnoException(result.error) && result.error.code === "ETIMEDOUT") {
    return `no answer within ${npxProbeBoundSeconds}s`;
  }
  return result.status === 0 ? "1" : "0";
}
function gitConfigValue(repositoryRoot2, key, environment) {
  const result = spawnSync("git", ["-C", repositoryRoot2, "config", "--get", key], { env: environment, encoding: "utf8" });
  return result.error === void 0 && result.status === 0 ? result.stdout.replace(/\n+$/, "") : "";
}
function normalizedPath(input) {
  let value = input.replaceAll("\\", "/");
  if (/^\/[A-Za-z](\/.*)?$/.test(value)) {
    const withoutLeadingSlash = value.slice(1);
    const firstSegment = withoutLeadingSlash.split("/")[0] ?? "";
    value = `${firstSegment}:${withoutLeadingSlash.slice(1)}`;
  }
  if (/^[a-z]:/.test(value)) {
    const colonIndex = value.indexOf(":");
    value = `${value.slice(0, colonIndex).toUpperCase()}:${value.slice(colonIndex + 1)}`;
  }
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value;
}
function filesUnderRelative(repositoryRoot2, ...segments) {
  const directory = path.join(repositoryRoot2, ...segments);
  return allFilesUnder(directory).map((absolute) => toPosix(path.relative(repositoryRoot2, absolute)));
}
function directChildrenWithExtension(repositoryRoot2, dir, extension) {
  const absolute = path.join(repositoryRoot2, dir);
  if (!isDirectory(absolute)) return [];
  return readdirSync2(absolute).filter((name) => name.endsWith(extension) && isRegularNonSymlinkFile(path.join(absolute, name))).map((name) => toPosix(path.join(dir, name)));
}
function containsCarriageReturn(file) {
  return readFileSync4(file).includes(13);
}
function toPosix(value) {
  return value.split(path.sep).join("/");
}
function firstExecutableOnPath(environment, binaryName) {
  const entries = (environment["PATH"] ?? "").split(path.delimiter).filter((entry) => entry !== "");
  for (const entry of entries) {
    const candidate = path.join(entry, binaryName);
    if (isExecutableRegularFile(candidate)) return candidate;
  }
  return void 0;
}
function engramBinaryRuns(binary) {
  const result = spawnSync(binary, ["version"], { encoding: "utf8" });
  return result.error === void 0 && result.status === 0;
}
function claudeDesktopLocations(homeDirectory, environment) {
  return [
    "/Applications/Claude.app",
    path.join(homeDirectory, "Library", "Application Support", "Claude"),
    path.join(environment["LOCALAPPDATA"] ?? path.join(homeDirectory, "AppData", "Local"), "AnthropicClaude"),
    path.join(environment["APPDATA"] ?? path.join(homeDirectory, "AppData", "Roaming"), "Claude"),
    path.join(homeDirectory, ".config", "Claude")
  ];
}
function existsFollowingSymlinks(target) {
  return statSync3(target, { throwIfNoEntry: false }) !== void 0;
}
function errorMessageOf(cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const collapsed = collapsedNewlines(message);
  return collapsed === "" ? "empty" : collapsed;
}

// core/src/install/cli.ts
var USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [--yes]

Only \`oso verify --host claude\` runs real checks in this slice; every other
verb/host pair is not yet implemented.
`;
var VERBS = ["install", "verify", "repair", "purge"];
var HOSTS = ["claude", "codex", "opencode"];
var UsageError = class extends Error {
};
var VerbNotImplementedError = class extends Error {
  verb;
  host;
  constructor(verb, host) {
    super(`${verb} --host ${host} is not yet implemented in this slice`);
    this.name = "VerbNotImplementedError";
    this.verb = verb;
    this.host = host;
  }
};
function main(argv, repositoryRoot2) {
  try {
    return dispatch(argv, repositoryRoot2);
  } catch (error) {
    return report(error);
  }
}
function dispatch(argv, repositoryRoot2) {
  const parsed = parseArgv(argv);
  if (parsed.verb === "verify" && parsed.host === "claude") {
    const outcome = verifyClaude({
      homeDirectory: homeDirectoryFrom(process.platform, process.env),
      repositoryRoot: repositoryRoot2,
      environment: process.env,
      platform: process.platform
    });
    process.stdout.write(outcome.report);
    return outcome.exitCode;
  }
  throw new VerbNotImplementedError(parsed.verb, parsed.host);
}
function report(error) {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (error instanceof VerbNotImplementedError) {
    process.stderr.write(`oso: ${error.message}
`);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso: ${message}
`);
  return 1;
}
function parseArgv(argv) {
  const [verbToken, ...rest] = argv;
  if (!isVerb(verbToken)) throw new UsageError();
  let host;
  let assumeYes = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--host") {
      host = rest[index + 1];
      index += 1;
      continue;
    }
    if (token === "--yes") {
      assumeYes = true;
      continue;
    }
    throw new UsageError();
  }
  if (!isHost(host)) throw new UsageError();
  return { verb: verbToken, host, assumeYes };
}
function isVerb(value) {
  return value !== void 0 && VERBS.includes(value);
}
function isHost(value) {
  return value !== void 0 && HOSTS.includes(value);
}

// core/src/bin/oso.ts
var REPOSITORY_ROOT_MARKERS = ["core", "bootstrap"];
function repositoryRootFrom(startDirectory) {
  let candidate = startDirectory;
  while (!REPOSITORY_ROOT_MARKERS.every((marker) => isDirectory(join(candidate, marker)))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`cannot locate the repository root above ${startDirectory}`);
    candidate = parent;
  }
  return candidate;
}
var repositoryRoot = repositoryRootFrom(dirname(fileURLToPath(import.meta.url)));
process.exit(main(process.argv.slice(2), repositoryRoot));
export {
  repositoryRootFrom
};
