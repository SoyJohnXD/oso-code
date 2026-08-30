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
import path from "node:path";
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
function writeFileAtomically(directory, finalPath, content, tempPrefix) {
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(directory, `${tempPrefix}${randomBytes(3).toString("hex")}`);
    try {
      writeFileSync(candidate, content, { flag: "wx", mode: 384 });
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") continue;
      throw error;
    }
    renameSync(candidate, finalPath);
    return;
  }
  throw new Error(`could not create a temp file under ${directory}`);
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
function isoTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
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

// core/src/install/claude.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { cpSync as cpSync2, mkdirSync as mkdirSync5, readFileSync as readFileSync6, readdirSync as readdirSync3, rmSync as rmSync5, statSync as statSync4, writeFileSync as writeFileSync4 } from "node:fs";
import path6 from "node:path";

// core/src/install/backup.ts
import { cpSync, lstatSync as lstatSync2, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, rmSync as rmSync2, statSync as statSync2 } from "node:fs";
import path2 from "node:path";
var BACKUP_NAME_PATTERN = /^install-backup-\d{8}-\d{6}-.+$/;
var DEFAULT_BUDGET_KIB = 307200;
var BUDGET_ENV_KEY = "OSO_INSTALL_BACKUP_BUDGET_KIB";
var DISK_BLOCK_SIZE_BYTES = 512;
var BYTES_PER_KIB = 1024;
var DISK_BLOCKS_PER_KIB = BYTES_PER_KIB / DISK_BLOCK_SIZE_BYTES;
function isInstallBackupName(name) {
  return BACKUP_NAME_PATTERN.test(name);
}
function installBackupDirsNewestFirst(root) {
  return childDirectoryNames(root).filter(isInstallBackupName).map((name) => path2.join(root, name)).sort().reverse();
}
function installBackupBudgetKib(environment = process.env) {
  const configured = environment[BUDGET_ENV_KEY];
  if (configured === void 0 || configured === "") return DEFAULT_BUDGET_KIB;
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? parsed : DEFAULT_BUDGET_KIB;
}
function backupSizeKib(directory) {
  return Math.ceil(recursiveDiskBlocks(directory) / DISK_BLOCKS_PER_KIB);
}
function installBackupsOverBudget(newestFirst, budgetKib, sizeOf = backupSizeKib) {
  let runningKib = 0;
  let kept = 0;
  const over = [];
  for (const backup of newestFirst) {
    const sizeKib = sizeOf(backup);
    if (kept === 0 || runningKib + sizeKib <= budgetKib) {
      runningKib += sizeKib;
      kept += 1;
      continue;
    }
    over.push(backup);
  }
  return over;
}
function restoreBackupManifest(manifest, itemsDirectory) {
  const failedItems = [];
  for (const row of parseManifestRows(manifest)) {
    if (row.target === "") continue;
    if (!removeTarget(row.target) || row.status === "present" && !restoreItem(itemsDirectory, row)) {
      failedItems.push(row.target);
    }
  }
  return { failedCount: failedItems.length, failedItems };
}
function parseManifestRows(manifest) {
  return manifest.split("\n").filter((line) => line !== "").map(manifestRowOf);
}
function serializeManifestRow(row) {
  return `${row.status}	${row.label}	${row.target}`;
}
function manifestRowOf(line) {
  const [status, label = "", target = ""] = line.split("	");
  return { status: status === "present" ? "present" : "absent", label, target };
}
function removeTarget(target) {
  try {
    rmSync2(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
function restoreItem(itemsDirectory, row) {
  try {
    mkdirSync2(path2.dirname(row.target), { recursive: true });
    cpSync(path2.join(itemsDirectory, row.label), row.target, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
function childDirectoryNames(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
function recursiveDiskBlocks(target) {
  const stats = lstatSync2(target, { throwIfNoEntry: false });
  if (stats === void 0) return 0;
  if (!stats.isDirectory()) return stats.blocks;
  const childBlocks = readdirSync(target).reduce((total, child) => total + recursiveDiskBlocks(path2.join(target, child)), 0);
  return stats.blocks + childBlocks;
}

// core/src/install/engram.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync as mkdirSync4, mkdtempSync as mkdtempSync2, readFileSync as readFileSync5, renameSync as renameSync2, rmSync as rmSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import path5 from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

// core/src/install/pins.ts
var SUPPORTED_ENGRAM_VERSION = "1.20.0";

// core/src/install/trust.ts
var SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
var ROW_PATTERN = /^(\S+)\s+(.*)$/;
function parseTrustManifest(text) {
  return text.split("\n").filter((line) => line !== "" && !line.startsWith("#")).map((line) => {
    const row = ROW_PATTERN.exec(line);
    return row === null ? { digest: line, file: "" } : { digest: row[1], file: row[2] };
  });
}

// core/src/install/verify-claude.ts
import { spawnSync } from "node:child_process";
import { closeSync, lstatSync as lstatSync3, mkdirSync as mkdirSync3, mkdtempSync, openSync, readFileSync as readFileSync4, readSync, readdirSync as readdirSync2, rmSync as rmSync3, statSync as statSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir } from "node:os";
import path4 from "node:path";

// core/src/install/json.ts
import { readFileSync as readFileSync3 } from "node:fs";
import path3 from "node:path";
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
function writeJsonFile(file, value) {
  writeFileAtomically(path3.dirname(file), file, `${JSON.stringify(value, null, 2)}
`, ".oso-json-");
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
var LEGACY_HOOK_COMMAND_PATTERNS = ["check-plan-contract", "clean-code-gate", "skill-registry-refresh", "gentle-ai"];
var CLAUDE_MD_BUDGET_BYTES = 8e3;
var HOME_DIR_FIX = 're-run from PowerShell (bootstrap/install.ps1 sets HOME to %USERPROFILE% for you), or export HOME="$USERPROFILE" in Git Bash and re-run bootstrap/install.sh';
var ENGRAM_BINARY_FIX = "bash bootstrap/install.sh downloads the pinned engram release into ~/.local/bin and reports it only once it answers; where one is already installed elsewhere, the verdict above says which half is missing \u2014 a directory not on the persisted PATH, which that run's wiring summary names the command to add (a new terminal plus a Claude Code restart is what picks it up), or a copy that does not run, which an antivirus may have quarantined and which that run tells you how to replace";
function verifyClaude(input) {
  const { homeDirectory, repositoryRoot: repositoryRoot2, environment, platform } = input;
  const claudeDir = path4.join(homeDirectory, ".claude");
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
  const manifest = path4.join(repositoryRoot2, "bootstrap", "gentle-manifest.txt");
  let content;
  try {
    content = readFileSync4(manifest, "utf8");
  } catch (cause) {
    report2.check("legacy artifacts removed", "0", errorMessageOf(cause));
    return;
  }
  let left = 0;
  for (const rel of manifestEntries(content)) {
    if (!existsAtAll(path4.join(claudeDir, rel))) continue;
    left += 1;
    report2.detail(`still present: ${rel}`);
  }
  report2.check("legacy artifacts removed", "0", String(left));
}
function checkSettingsFreeOfGentleHooks(report2, claudeDir) {
  const settings = path4.join(claudeDir, "settings.json");
  report2.check("settings.json free of gentle hooks", "0", grepCountOrErrorMessage(settings, LEGACY_HOOK_COMMAND_PATTERNS));
}
function checkClaudeMdBudget(report2, claudeDir) {
  const claudeMd = path4.join(claudeDir, "CLAUDE.md");
  if (!isReadableRegularFile(claudeMd)) {
    report2.check("CLAUDE.md under budget", "1", `unreadable ${claudeMd}`);
    return;
  }
  const byteSize = statSync3(claudeMd).size;
  report2.check("CLAUDE.md under budget", "1", byteSize < CLAUDE_MD_BUDGET_BYTES ? "1" : "0");
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
  const settingsFile = path4.join(claudeDir, "settings.json");
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
  const result = spawnSync("bash", [path4.join(repositoryRoot2, "tests", "hooks-test.sh")], {
    cwd: repositoryRoot2,
    env: environment,
    stdio: "ignore"
  });
  report2.check("hook regression suite", "pass", result.status === 0 ? "pass" : "fail");
}
function impeccableOptOutMarker(homeDirectory) {
  return path4.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
}
function checkImpeccablePluginInstalled(report2, homeDirectory, pluginListing) {
  const marker = impeccableOptOutMarker(homeDirectory);
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
  const gitHook = path4.join(repositoryRoot2, "plugin", "git-hooks", "pre-commit");
  const wiredHooksPath = gitConfigValue(repositoryRoot2, "core.hooksPath", environment);
  if (normalizedPath(wiredHooksPath) === normalizedPath(path4.dirname(gitHook))) {
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
  const matched = candidates.filter((relative) => containsCarriageReturn(path4.join(repositoryRoot2, relative)));
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
  const state = resolved === void 0 ? `no ${binaryName} on the persisted machine or user PATH` : engramBinaryRuns(platform, resolved, environment) ? "1" : `${resolved} does not run`;
  report2.check("engram binary the client resolves and runs", "1", state, ENGRAM_BINARY_FIX);
  if (resolved !== void 0) report2.detail(`engram binary: ${resolved}`);
}
function checkGitBashPath(report2, claudeDir) {
  const settingsFile = path4.join(claudeDir, "settings.json");
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
  const installedPlugins = path4.join(claudeDir, "plugins", "installed_plugins.json");
  const fromManifest = installRootFromManifest(installedPlugins);
  if (fromManifest !== void 0 && isDirectory(fromManifest)) return fromManifest;
  return highestVersionedCacheDirectory(path4.join(claudeDir, "plugins", "cache", "oso-code", "oso-code"));
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
  return highest === void 0 ? "" : path4.join(cacheDirectory, highest);
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
  const suffix = `${path4.sep}dist${path4.sep}gate.js`;
  const found = allFilesUnder(installRoot).find((absolute) => absolute.endsWith(suffix));
  return found;
}
function allFilesUnder(directory) {
  if (!isDirectory(directory)) return [];
  return readdirSync2(directory, { recursive: true }).map((entry) => path4.join(directory, entry.toString())).filter((absolute) => isRegularNonSymlinkFile(absolute));
}
function runInstalledHookProbe(gate, environment) {
  const hookHome = mkdtempSync(path4.join(tmpdir(), "oso-verify-hook-"));
  try {
    const stateKey = sha256Hex(hookHome);
    const stateDir = path4.join(hookHome, ".local", "state", "oso-code");
    mkdirSync3(stateDir, { recursive: true });
    writeFileSync2(path4.join(stateDir, `${stateKey}.state`), "mode=plan\nverify_green=false\n");
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
  const probeHome = mkdtempSync(path4.join(tmpdir(), "oso-verify-probe-"));
  try {
    const env = { ...environment, HOME: probeHome, USERPROFILE: probeHome, OSO_STATE_BIN: stateBin };
    const runStateScript = (...args) => spawnSync(process.execPath, [stateBin, ...args], { env, encoding: "utf8" });
    const setResult = runStateScript("--session", "verify-probe", "set", "mode=probe");
    if (setResult.error !== void 0 || setResult.status !== 0) return collapsedNewlines(errorOutputOf(setResult));
    const getResult = runStateScript("--session", "verify-probe", "get", "mode");
    if (getResult.error !== void 0 || getResult.status !== 0) return collapsedNewlines(errorOutputOf(getResult));
    runStateScript("--session", "verify-probe", "clear");
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
  const directory = path4.join(repositoryRoot2, ...segments);
  return allFilesUnder(directory).map((absolute) => toPosix(path4.relative(repositoryRoot2, absolute)));
}
function directChildrenWithExtension(repositoryRoot2, dir, extension) {
  const absolute = path4.join(repositoryRoot2, dir);
  if (!isDirectory(absolute)) return [];
  return readdirSync2(absolute).filter((name) => name.endsWith(extension) && isRegularNonSymlinkFile(path4.join(absolute, name))).map((name) => toPosix(path4.join(dir, name)));
}
function containsCarriageReturn(file) {
  return readFileSync4(file).includes(13);
}
function toPosix(value) {
  return value.split(path4.sep).join("/");
}
function firstExecutableOnPath(environment, binaryName) {
  const entries = (environment["PATH"] ?? "").split(path4.delimiter).filter((entry) => entry !== "");
  for (const entry of entries) {
    const candidate = path4.join(entry, binaryName);
    if (isExecutableRegularFile(candidate)) return candidate;
  }
  return void 0;
}
var ENGRAM_PROBE_TIMEOUT_MS = 1e4;
var ENGRAM_PROBE_ENVIRONMENT_KEYS = ["PATH", "SystemRoot", "windir"];
var POSIX_KERNEL_EXECUTABLE_MAGICS = ["\x7FELF", "#!", "\xCF\xFA\xED\xFE", "\xCE\xFA\xED\xFE", "\xCA\xFE\xBA\xBE"];
var WIN32_KERNEL_EXECUTABLE_MAGICS = ["MZ"];
var WIDEST_EXECUTABLE_MAGIC_BYTES = Math.max(
  ...[...POSIX_KERNEL_EXECUTABLE_MAGICS, ...WIN32_KERNEL_EXECUTABLE_MAGICS].map((magic) => magic.length)
);
function engramBinaryRuns(platform, binary, environment) {
  if (!kernelExecutesDirectly(platform, binary)) return false;
  const result = spawnSync(binary, ["version"], {
    encoding: "utf8",
    timeout: ENGRAM_PROBE_TIMEOUT_MS,
    env: probeEnvironment(environment)
  });
  return result.error === void 0 && result.status === 0;
}
function kernelExecutesDirectly(platform, binary) {
  if (!isReadableRegularFile(binary)) return false;
  const leading = Buffer.alloc(WIDEST_EXECUTABLE_MAGIC_BYTES);
  const handle = openSync(binary, "r");
  try {
    readSync(handle, leading);
  } finally {
    closeSync(handle);
  }
  const opening = leading.toString("latin1");
  const magicsThisKernelStarts = platform === "win32" ? WIN32_KERNEL_EXECUTABLE_MAGICS : POSIX_KERNEL_EXECUTABLE_MAGICS;
  return magicsThisKernelStarts.some((magic) => opening.startsWith(magic));
}
function probeEnvironment(environment) {
  const carried = ENGRAM_PROBE_ENVIRONMENT_KEYS.map((key) => [key, environment[key]]);
  return Object.fromEntries(carried.filter(([, value]) => value !== void 0));
}
function claudeDesktopLocations(homeDirectory, environment) {
  return [
    "/Applications/Claude.app",
    path4.join(homeDirectory, "Library", "Application Support", "Claude"),
    path4.join(environment["LOCALAPPDATA"] ?? path4.join(homeDirectory, "AppData", "Local"), "AnthropicClaude"),
    path4.join(environment["APPDATA"] ?? path4.join(homeDirectory, "AppData", "Roaming"), "Claude"),
    path4.join(homeDirectory, ".config", "Claude")
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

// core/src/install/engram.ts
var ENGRAM_SOURCE_REPO = "Gentleman-Programming/engram";
var DOWNLOAD_BOUND_SECONDS = 120;
var MEBIBYTE = 1024 * 1024;
var SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES = MEBIBYTE;
var ARCHIVE_EXPANSION_CEILING_BYTES = 128 * MEBIBYTE;
var EngramProvisionError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "EngramProvisionError";
  }
};
function provisionEngramBinary(input) {
  const installDirectory = path5.join(input.homeDirectory, ".local", "bin");
  const binaryName = engramBinaryName(input.platform);
  const transport = input.transport ?? curlOrWgetTransport(input.environment);
  let placedBinary;
  try {
    const content = fetchVerifiedEngramBinary(input.platform, input.architecture, binaryName, transport);
    placedBinary = placeEngramBinary({ content, installDirectory, binaryName, environment: input.environment, platform: input.platform });
  } catch (error) {
    return { kind: "failed", reason: errorMessageOf(error) };
  }
  return firstExecutableOnPath(input.environment, binaryName) === placedBinary ? { kind: "installed-on-path", binary: placedBinary } : { kind: "installed-off-path", binary: placedBinary, installDirectory };
}
function engramBinaryName(platform) {
  return platform === "win32" ? "engram.exe" : "engram";
}
function engramReleaseAsset(platform, architecture, version) {
  const os = engramReleaseOs(platform);
  const arch = engramReleaseArch(architecture);
  if (os === void 0 || arch === void 0) return void 0;
  return os === "windows" ? `engram_${version}_windows_${arch}.zip` : `engram_${version}_${os}_${arch}.tar.gz`;
}
function fetchVerifiedEngramBinary(platform, architecture, binaryName, transport) {
  const asset = engramReleaseAsset(platform, architecture, SUPPORTED_ENGRAM_VERSION);
  if (asset === void 0) {
    throw new EngramProvisionError(`engram publishes no official release for ${platform}/${architecture}`);
  }
  const releaseBase = `https://github.com/${ENGRAM_SOURCE_REPO}/releases/download/v${SUPPORTED_ENGRAM_VERSION}`;
  const checksums = downloadOrThrow(transport, `${releaseBase}/checksums.txt`);
  const archive = downloadOrThrow(transport, `${releaseBase}/${asset}`);
  verifyEngramChecksum(checksums, archive, asset);
  return engramBinaryFromArchive(archive, asset, binaryName);
}
function downloadOrThrow(transport, url) {
  try {
    return transport(url);
  } catch (cause) {
    throw new EngramProvisionError(`could not download ${url}: ${errorMessageOf(cause)}`, { cause });
  }
}
function verifyEngramChecksum(checksumsText, archive, asset) {
  const rows = parseTrustManifest(checksumsText.toString("utf8")).filter((row2) => row2.file === asset);
  if (rows.length !== 1) {
    throw new EngramProvisionError(`checksums.txt does not carry exactly one row for ${asset} (found ${rows.length})`);
  }
  const [row] = rows;
  if (!SHA256_HEX_PATTERN.test(row.digest)) {
    throw new EngramProvisionError(`the published checksum for ${asset} is not a SHA-256 digest`);
  }
  if (sha256Hex(archive) !== row.digest) {
    throw new EngramProvisionError(`${asset} does not match its published SHA-256 checksum, so nothing was installed`);
  }
}
function placeEngramBinary({ content, installDirectory, binaryName, environment, platform }) {
  if (content.length < SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES) {
    throw new EngramProvisionError(
      `the ${binaryName} entry holds ${content.length} bytes, under the ${SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES} bytes below which it is a script or a text file rather than the Go binary this release publishes, so nothing was placed`
    );
  }
  mkdirSync4(installDirectory, { recursive: true });
  const target = path5.join(installDirectory, binaryName);
  const pending = path5.join(installDirectory, `.oso-pending-${process.pid}-${binaryName}`);
  writeFileSync3(pending, content, { mode: 493 });
  try {
    if (!engramBinaryRuns(platform, pending, environment)) {
      throw new EngramProvisionError(
        `engram ${SUPPORTED_ENGRAM_VERSION} was verified but would not run from ${installDirectory}, so ${target} was left exactly as it was \u2014 an antivirus may have quarantined it, which upstream documents happening to its unsigned prebuilt releases`
      );
    }
    renameSync2(pending, target);
  } catch (error) {
    rmSync4(pending, { force: true });
    throw error;
  }
  return target;
}
function curlOrWgetTransport(environment) {
  return (url) => {
    const scratch = mkdtempSync2(path5.join(tmpdir2(), "oso-engram-download-"));
    try {
      const destination = path5.join(scratch, "download");
      downloadToFile(url, destination, environment);
      return readFileSync5(destination);
    } finally {
      rmSync4(scratch, { recursive: true, force: true });
    }
  };
}
function downloadToFile(url, destination, environment) {
  const bound = String(DOWNLOAD_BOUND_SECONDS);
  const curl = spawnSync2(
    "curl",
    ["-fsSL", "--retry", "3", "--retry-delay", "2", "--connect-timeout", bound, "--max-time", bound, "-o", destination, url],
    { env: environment, encoding: "utf8" }
  );
  if (curl.error === void 0) {
    if (curl.status !== 0) throw new Error(fetcherRefusal("curl", curl));
    return;
  }
  const wget = spawnSync2("wget", ["-nv", "--tries=3", `--timeout=${bound}`, "-O", destination, url], {
    env: environment,
    encoding: "utf8"
  });
  if (wget.error !== void 0) throw new Error("neither curl nor wget is installed here");
  if (wget.status !== 0) throw new Error(fetcherRefusal("wget", wget));
}
function fetcherRefusal(fetcher, result) {
  const said = collapsedNewlines(result.stderr).trim();
  return said === "" ? `${fetcher} exited ${result.status}` : `${fetcher} exited ${result.status}: ${said}`;
}
function engramReleaseOs(platform) {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "windows";
  return void 0;
}
function engramReleaseArch(architecture) {
  if (architecture === "x64") return "amd64";
  if (architecture === "arm64") return "arm64";
  return void 0;
}
function engramBinaryFromArchive(archive, asset, binaryName) {
  const entries = asset.endsWith(".zip") ? zipEntries(archive) : tarGzEntries(archive);
  const named = entries.filter((entry) => path5.posix.basename(entry.name) === binaryName);
  const [only] = named;
  if (only === void 0) throw new EngramProvisionError(`${asset} carries no ${binaryName}`);
  if (named.length > 1) {
    throw new EngramProvisionError(
      `${asset} carries ${named.length} entries named ${binaryName} (${named.map((entry) => entry.name).join(", ")}), so which one is the release binary is ambiguous and nothing was installed`
    );
  }
  return only.readContent();
}
var TAR_BLOCK_BYTES = 512;
var TAR_NAME_OFFSET = 0;
var TAR_NAME_BYTES = 100;
var TAR_SIZE_OFFSET = 124;
var TAR_SIZE_BYTES = 12;
var TAR_TYPEFLAG_OFFSET = 156;
var TAR_PREFIX_OFFSET = 345;
var TAR_PREFIX_BYTES = 155;
var TAR_REGULAR_FILE_TYPEFLAG = 48;
var TAR_IMPLICIT_REGULAR_FILE_TYPEFLAG = 0;
function tarGzEntries(archive) {
  return tarEntries(gunzipSync(archive, { maxOutputLength: ARCHIVE_EXPANSION_CEILING_BYTES }));
}
function tarEntries(tar) {
  const entries = [];
  let offset = 0;
  while (offset + TAR_BLOCK_BYTES <= tar.length && !isZeroBlock(tar, offset)) {
    const name = tarField(tar, offset, TAR_NAME_OFFSET, TAR_NAME_BYTES);
    const prefix = tarField(tar, offset, TAR_PREFIX_OFFSET, TAR_PREFIX_BYTES);
    const size = tarDeclaredSize(tar, offset);
    const contentStart = offset + TAR_BLOCK_BYTES;
    if (contentStart + size > tar.length) {
      throw new EngramProvisionError(
        `a tar header declares ${size} content bytes but the archive holds only ${tar.length - contentStart} past it`
      );
    }
    if (isTarRegularFile(tar[offset + TAR_TYPEFLAG_OFFSET])) {
      entries.push({
        name: prefix === "" ? name : `${prefix}/${name}`,
        readContent: () => Buffer.from(tar.subarray(contentStart, contentStart + size))
      });
    }
    offset = contentStart + roundUpToBlock(size);
  }
  return entries;
}
function tarDeclaredSize(tar, blockOffset) {
  const field = tarField(tar, blockOffset, TAR_SIZE_OFFSET, TAR_SIZE_BYTES).trim();
  const size = field === "" ? 0 : Number.parseInt(field, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new EngramProvisionError(`a tar header declares ${JSON.stringify(field)} as its octal content size, which is no byte count`);
  }
  return size;
}
function isTarRegularFile(typeflag) {
  return typeflag === TAR_REGULAR_FILE_TYPEFLAG || typeflag === TAR_IMPLICIT_REGULAR_FILE_TYPEFLAG;
}
function tarField(tar, blockOffset, fieldOffset, length) {
  const field = tar.subarray(blockOffset + fieldOffset, blockOffset + fieldOffset + length);
  const terminator = field.indexOf(0);
  return (terminator === -1 ? field : field.subarray(0, terminator)).toString("latin1");
}
function isZeroBlock(tar, offset) {
  return tar.subarray(offset, offset + TAR_BLOCK_BYTES).every((byte) => byte === 0);
}
function roundUpToBlock(size) {
  return Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
}
var ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 101010256;
var ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
var ZIP_TOTAL_ENTRY_COUNT_OFFSET = 10;
var ZIP_DIRECTORY_START_OFFSET = 16;
var ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 33639248;
var ZIP_CENTRAL_FILE_HEADER_BYTES = 46;
var ZIP_CENTRAL_METHOD_OFFSET = 10;
var ZIP_CENTRAL_COMPRESSED_SIZE_OFFSET = 20;
var ZIP_CENTRAL_NAME_LENGTH_OFFSET = 28;
var ZIP_CENTRAL_EXTRA_LENGTH_OFFSET = 30;
var ZIP_CENTRAL_COMMENT_LENGTH_OFFSET = 32;
var ZIP_CENTRAL_LOCAL_HEADER_START_OFFSET = 42;
var ZIP_LOCAL_FILE_HEADER_SIGNATURE = 67324752;
var ZIP_LOCAL_FILE_HEADER_BYTES = 30;
var ZIP_LOCAL_NAME_LENGTH_OFFSET = 26;
var ZIP_LOCAL_EXTRA_LENGTH_OFFSET = 28;
var ZIP_STORED_METHOD = 0;
function zipEntries(zip) {
  const trailer = findZipEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(trailer + ZIP_TOTAL_ENTRY_COUNT_OFFSET);
  const entries = [];
  let offset = zip.readUInt32LE(trailer + ZIP_DIRECTORY_START_OFFSET);
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new EngramProvisionError("not a zip archive: central directory entry signature mismatch");
    }
    const method = zip.readUInt16LE(offset + ZIP_CENTRAL_METHOD_OFFSET);
    const compressedSize = zip.readUInt32LE(offset + ZIP_CENTRAL_COMPRESSED_SIZE_OFFSET);
    const nameLength = zip.readUInt16LE(offset + ZIP_CENTRAL_NAME_LENGTH_OFFSET);
    const extraLength = zip.readUInt16LE(offset + ZIP_CENTRAL_EXTRA_LENGTH_OFFSET);
    const commentLength = zip.readUInt16LE(offset + ZIP_CENTRAL_COMMENT_LENGTH_OFFSET);
    const localHeaderStart = zip.readUInt32LE(offset + ZIP_CENTRAL_LOCAL_HEADER_START_OFFSET);
    const nameStart = offset + ZIP_CENTRAL_FILE_HEADER_BYTES;
    entries.push({
      name: zip.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      readContent: () => zipEntryContent(zip, localHeaderStart, method, compressedSize)
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}
function zipEntryContent(zip, localHeaderStart, method, compressedSize) {
  if (zip.readUInt32LE(localHeaderStart) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new EngramProvisionError("not a zip archive: local file header signature mismatch");
  }
  if (compressedSize > ARCHIVE_EXPANSION_CEILING_BYTES) {
    throw new EngramProvisionError(
      `a zip entry declares ${compressedSize} compressed bytes, past the ${ARCHIVE_EXPANSION_CEILING_BYTES}-byte ceiling this installer expands an archive under`
    );
  }
  const nameLength = zip.readUInt16LE(localHeaderStart + ZIP_LOCAL_NAME_LENGTH_OFFSET);
  const extraLength = zip.readUInt16LE(localHeaderStart + ZIP_LOCAL_EXTRA_LENGTH_OFFSET);
  const dataStart = localHeaderStart + ZIP_LOCAL_FILE_HEADER_BYTES + nameLength + extraLength;
  if (dataStart + compressedSize > zip.length) {
    throw new EngramProvisionError(
      `a zip entry declares ${compressedSize} compressed bytes but the archive holds only ${zip.length - dataStart} past its local file header`
    );
  }
  const raw = zip.subarray(dataStart, dataStart + compressedSize);
  return method === ZIP_STORED_METHOD ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: ARCHIVE_EXPANSION_CEILING_BYTES });
}
function findZipEndOfCentralDirectory(zip) {
  for (let offset = zip.length - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new EngramProvisionError("not a zip archive: no end-of-central-directory record");
}

// core/src/install/claude.ts
var MARKETPLACE_SOURCE = "SoyJohnXD/oso-code";
var SUPPORTED_FALLOW_VERSION = "3.14.0";
var CLAUDE_MD_MARKER_START = "<!-- oso-code:start -->";
var CLAUDE_MD_MARKER_END = "<!-- oso-code:end -->";
var OUTPUT_STYLE_KNOWN_VALUES = ["Gentleman", "Oso"];
var CLAUDE_INSTALL_BACKUP_FORMAT = "oso-code-claude-install-v1";
var CLAUDE_REPAIR_BACKUP_FORMAT = "oso-code-claude-repair-v1";
var CLAUDE_PURGE_BACKUP_FORMAT = "oso-code-claude-purge-v1";
var ClaudePluginInstallError = class extends Error {
  output;
  constructor(output) {
    super(`claude plugin install oso-code@oso-code failed: ${output}`);
    this.name = "ClaudePluginInstallError";
    this.output = output;
  }
};
function installClaude(input) {
  if (!input.assumeYes) return requiresYesOutcome("install");
  const claudeDir = path6.join(input.homeDirectory, ".claude");
  const settingsFile = path6.join(claudeDir, "settings.json");
  const claudeMdFile = path6.join(claudeDir, "CLAUDE.md");
  const legacyTargets = legacyArtifactTargets(input.repositoryRoot, claudeDir);
  let tx;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_INSTALL_BACKUP_FORMAT);
    for (const { label, target } of backupClientConfigTargets(input.homeDirectory, claudeDir)) backupTarget(tx, label, target);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    for (const { label, target } of legacyTargets) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("install", "could not create the pre-install backup", error);
  }
  const infoLines = [`backup: ${tx.backupRoot}`];
  const wiring = [];
  wiring.push(wireEngramPlugin(input.environment));
  wiring.push(resolveOrProvisionEngram(input));
  wiring.push(wireFallow(input.environment, input.homeDirectory, input.platform));
  try {
    wiring.push(installOsoPluginCore(input.environment, input.repositoryRoot));
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("install", "the oso-code plugin itself failed to install", error, restore);
  }
  softPluginMaintenance(input.environment);
  wiring.push(...migrateContext7(input.environment));
  wiring.push(publishStateBinPath(claudeDir, settingsFile));
  const gitBash = publishGitBashPath(input.platform, input.environment, settingsFile);
  if (gitBash !== void 0) wiring.push(gitBash);
  if (input.installGitHook ?? true) {
    wiring.push(wireGitCommitHook(input.repositoryRoot, input.environment));
  } else {
    infoLines.push("skipping the git commit hook (--no-git-hook)");
  }
  if (input.installImpeccable ?? true) {
    wiring.push(wireImpeccable(input.environment, input.homeDirectory));
  } else {
    skipImpeccable(input.homeDirectory);
    infoLines.push("skipping impeccable (--no-impeccable)");
  }
  try {
    const legacyOutcome = removeLegacyArtifacts(legacyTargets);
    infoLines.push(`removed ${legacyOutcome.removed} legacy artifact(s)`);
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("install", "could not remove a legacy artifact", error, restore);
  }
  wiring.push(toWiringEntry("legacy settings hooks", removeLegacySettingsEntries(settingsFile)));
  wiring.push(toWiringEntry("output style", ensureOutputStyle(settingsFile)));
  try {
    mergeGlobalClaudeMd(claudeMdFile, claudeGlobalBody(input.repositoryRoot), { replace: input.replaceClaudeMd ?? false });
    infoLines.push(claudeMdSizeNote(claudeMdFile));
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("install", "could not write CLAUDE.md", error, restore);
  }
  const pruned = pruneInstallBackups(backupsRootOf(input.homeDirectory), input.environment);
  for (const backup of pruned) infoLines.push(`backup retention: removed ${backup}`);
  return { report: renderCommandReport("install", infoLines, wiring), exitCode: 0 };
}
function repairClaude(input) {
  if (!input.assumeYes) return requiresYesOutcome("repair");
  const claudeDir = path6.join(input.homeDirectory, ".claude");
  const settingsFile = path6.join(claudeDir, "settings.json");
  const claudeMdFile = path6.join(claudeDir, "CLAUDE.md");
  let tx;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_REPAIR_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("repair", "could not create the pre-repair backup", error);
  }
  const infoLines = [`backup: ${tx.backupRoot}`];
  const wiring = [];
  wiring.push(publishStateBinPath(claudeDir, settingsFile));
  const gitBash = publishGitBashPath(input.platform, input.environment, settingsFile);
  if (gitBash !== void 0) wiring.push(gitBash);
  wiring.push(toWiringEntry("legacy settings hooks", removeLegacySettingsEntries(settingsFile)));
  wiring.push(toWiringEntry("output style", ensureOutputStyle(settingsFile)));
  try {
    mergeGlobalClaudeMd(claudeMdFile, claudeGlobalBody(input.repositoryRoot), { replace: false });
    infoLines.push(claudeMdSizeNote(claudeMdFile));
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("repair", "could not rewrite CLAUDE.md", error, restore);
  }
  wiring.push(wireFallow(input.environment, input.homeDirectory, input.platform));
  return { report: renderCommandReport("repair", infoLines, wiring), exitCode: 0 };
}
function purgeClaude(input) {
  if (!input.assumeYes) return requiresYesOutcome("purge");
  const claudeDir = path6.join(input.homeDirectory, ".claude");
  const settingsFile = path6.join(claudeDir, "settings.json");
  const claudeMdFile = path6.join(claudeDir, "CLAUDE.md");
  let tx;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_PURGE_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "could not create the pre-purge backup", error);
  }
  const infoLines = [`backup: ${tx.backupRoot}`, "no login or installation command was run"];
  const wiring = [];
  wiring.push(toWiringEntry("OSO_STATE_BIN", removeClientEnv(settingsFile, "OSO_STATE_BIN")));
  wiring.push(toWiringEntry("CLAUDE_CODE_GIT_BASH_PATH", removeClientEnv(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH")));
  wiring.push(toWiringEntry("output style", clearOsoOutputStyle(settingsFile)));
  infoLines.push("legacy hook entries: remove-only in the ownership table \u2014 nothing recorded as ours to reverse");
  try {
    const stripped = stripClaudeMdRegion(claudeMdFile);
    wiring.push(stripped ? wiringOk("CLAUDE.md region", "removed") : wiringOk("CLAUDE.md region", "nothing to remove"));
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("purge", "could not rewrite CLAUDE.md", error, restore);
  }
  const mcpRemove = spawnSync3("claude", ["mcp", "remove", "--scope", "user", "fallow"], { env: input.environment, encoding: "utf8" });
  wiring.push(
    mcpRemove.error === void 0 && mcpRemove.status === 0 ? wiringOk("fallow (mcp)", "removed") : wiringFail("fallow (mcp)", `nothing removed, or already absent: ${collapsedOutput(mcpRemove)}`)
  );
  return { report: renderCommandReport("purge", infoLines, wiring), exitCode: 0 };
}
function backupsRootOf(homeDirectory) {
  return path6.join(homeDirectory, ".local", "state", "oso-code", "claude-backups");
}
function beginTransaction(backupsRoot, format) {
  const backupRoot = path6.join(backupsRoot, `install-backup-${compactTimestamp()}-${process.pid}`);
  const itemsDirectory = path6.join(backupRoot, "items");
  mkdirSync5(itemsDirectory, { recursive: true });
  writeFileSync4(path6.join(backupRoot, "format"), `${format}
`);
  return { backupRoot, itemsDirectory, manifest: [] };
}
function backupTarget(tx, label, target) {
  if (!existsAtAll(target)) {
    tx.manifest.push({ status: "absent", label, target });
    return;
  }
  const destination = path6.join(tx.itemsDirectory, label);
  mkdirSync5(path6.dirname(destination), { recursive: true });
  cpSync2(target, destination, { recursive: true });
  tx.manifest.push({ status: "present", label, target });
}
function commitManifest(tx) {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  writeFileSync4(path6.join(tx.backupRoot, "manifest"), text === "" ? "" : `${text}
`);
}
function rollback(tx) {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  return restoreBackupManifest(text, tx.itemsDirectory);
}
function compactTimestamp() {
  const iso = isoTimestamp();
  const [datePart = "", timePart = ""] = iso.replace("Z", "").split("T");
  return `${datePart.replaceAll("-", "")}-${timePart.replaceAll(":", "")}`;
}
function pruneInstallBackups(backupsRoot, environment) {
  const budgetKib = installBackupBudgetKib(environment);
  const over = installBackupsOverBudget(installBackupDirsNewestFirst(backupsRoot), budgetKib);
  for (const backup of over) rmSync5(backup, { recursive: true, force: true });
  return over;
}
function backupClientConfigTargets(homeDirectory, claudeDir) {
  const targets = [{ label: "claude-json", target: path6.join(homeDirectory, ".claude.json") }];
  const pluginsDir = path6.join(claudeDir, "plugins");
  if (!isDirectory(pluginsDir)) return targets;
  for (const name of readdirSync3(pluginsDir).filter((entry) => entry.endsWith(".json"))) {
    targets.push({ label: `plugins-json-${name}`, target: path6.join(pluginsDir, name) });
  }
  return targets;
}
function legacyArtifactTargets(repositoryRoot2, claudeDir) {
  const manifestFile = path6.join(repositoryRoot2, "bootstrap", "gentle-manifest.txt");
  const content = readFileSync6(manifestFile, "utf8");
  return manifestEntries(content).map((relative) => ({ label: relative, target: path6.join(claudeDir, relative) }));
}
function removeLegacyArtifacts(targets) {
  let removed = 0;
  for (const { target } of targets) {
    if (!existsAtAll(target)) continue;
    rmSync5(target, { recursive: true, force: true });
    removed += 1;
  }
  return { removed };
}
function storeClientEnv(settingsFile, key, value) {
  const settings = readJsonObject(settingsFile);
  const env = isPlainRecord(settings["env"]) ? settings["env"] : {};
  writeJsonFile(settingsFile, { ...settings, env: { ...env, [key]: value } });
}
function removeClientEnv(settingsFile, key) {
  if (!isReadableRegularFile(settingsFile)) return { kind: "unchanged", note: `no settings.json to remove ${key} from` };
  try {
    const settings = readJsonObject(settingsFile);
    const env = settings["env"];
    if (!isPlainRecord(env) || !(key in env)) return { kind: "unchanged", note: `${key} was not set` };
    const rest = { ...env };
    delete rest[key];
    writeJsonFile(settingsFile, { ...settings, env: rest });
    return { kind: "written", note: `${key} removed` };
  } catch (error) {
    return { kind: "failed", note: `left settings.json as it was \u2014 ${errorMessageOf(error)}` };
  }
}
function removeLegacySettingsEntries(settingsFile) {
  if (!isReadableRegularFile(settingsFile)) return { kind: "unchanged", note: "no settings.json yet" };
  try {
    const settings = readJsonObject(settingsFile);
    const hooks = settings["hooks"];
    if (!isPlainRecord(hooks)) return { kind: "unchanged", note: "no .hooks object to clean" };
    const { filtered, changed } = withoutLegacyHookEntries(hooks);
    if (!changed) return { kind: "unchanged", note: "no legacy hook entries found" };
    writeJsonFile(settingsFile, { ...settings, hooks: filtered });
    return { kind: "written", note: "cleaned legacy hook entries from settings.json" };
  } catch (error) {
    return { kind: "failed", note: `left settings.json exactly as it was \u2014 ${errorMessageOf(error)}` };
  }
}
function withoutLegacyHookEntries(hooks) {
  let changed = false;
  const filtered = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      filtered[event] = entries;
      continue;
    }
    const kept = entries.filter((entry) => !isLegacyHookEntry(entry));
    if (kept.length !== entries.length) changed = true;
    if (kept.length > 0) filtered[event] = kept;
    else changed = true;
  }
  return { filtered, changed };
}
function isLegacyHookEntry(entry) {
  if (!isPlainRecord(entry) || !Array.isArray(entry["hooks"])) return false;
  return entry["hooks"].some(
    (nested) => isPlainRecord(nested) && typeof nested["command"] === "string" && LEGACY_HOOK_COMMAND_PATTERNS.some((pattern) => nested["command"].includes(pattern))
  );
}
function ensureOutputStyle(settingsFile) {
  try {
    const settings = isReadableRegularFile(settingsFile) ? readJsonObject(settingsFile) : {};
    const current = settings["outputStyle"];
    if (typeof current === "string" && current !== "" && !OUTPUT_STYLE_KNOWN_VALUES.includes(current)) {
      return { kind: "unchanged", note: `keeping your output style "${current}" \u2014 switch to Oso anytime via /config \u2192 output style` };
    }
    writeJsonFile(settingsFile, { ...settings, outputStyle: "Oso" });
    return { kind: "written", note: "output style set to Oso" };
  } catch (error) {
    return { kind: "failed", note: `left your output style as it was \u2014 ${errorMessageOf(error)}` };
  }
}
function clearOsoOutputStyle(settingsFile) {
  if (!isReadableRegularFile(settingsFile)) return { kind: "unchanged", note: "no settings.json to clear" };
  try {
    const settings = readJsonObject(settingsFile);
    if (settings["outputStyle"] !== "Oso") return { kind: "unchanged", note: "output style is not Oso \u2014 left alone" };
    const rest = { ...settings };
    delete rest["outputStyle"];
    writeJsonFile(settingsFile, rest);
    return { kind: "written", note: "output style cleared" };
  } catch (error) {
    return { kind: "failed", note: `left your output style as it was \u2014 ${errorMessageOf(error)}` };
  }
}
function mergeGlobalClaudeMd(claudeMdFile, blockBody, options) {
  const shouldMerge = !options.replace && isReadableRegularFile(claudeMdFile);
  const prefix = shouldMerge ? `${withoutMarkerRegion(readFileSync6(claudeMdFile, "utf8"))}
` : "";
  const content = `${prefix}${CLAUDE_MD_MARKER_START}
${blockBody}${CLAUDE_MD_MARKER_END}
`;
  writeFileAtomically(path6.dirname(claudeMdFile), claudeMdFile, content, ".oso-claude-md-");
}
function stripClaudeMdRegion(claudeMdFile) {
  if (!isReadableRegularFile(claudeMdFile)) return false;
  const content = readFileSync6(claudeMdFile, "utf8");
  if (!content.includes(CLAUDE_MD_MARKER_START)) return false;
  const withoutBlock = withoutMarkerRegion(content);
  writeFileAtomically(path6.dirname(claudeMdFile), claudeMdFile, withoutBlock === "" ? "" : `${withoutBlock}
`, ".oso-claude-md-");
  return true;
}
function withoutMarkerRegion(content) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const kept = [];
  let skipping = false;
  for (const line of normalized.split("\n")) {
    if (line === CLAUDE_MD_MARKER_START) {
      skipping = true;
      continue;
    }
    if (line === CLAUDE_MD_MARKER_END) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  while (kept.length > 0 && kept.at(-1) === "") kept.pop();
  return kept.join("\n");
}
function claudeGlobalBody(repositoryRoot2) {
  return readFileSync6(path6.join(repositoryRoot2, "bootstrap", "claude-global.md"), "utf8");
}
function claudeMdSizeNote(claudeMdFile) {
  const size = statSync4(claudeMdFile, { throwIfNoEntry: false })?.size ?? 0;
  return size > CLAUDE_MD_BUDGET_BYTES ? `CLAUDE.md is still ${size} bytes \u2014 review the non-oso content; every session pays for it` : `CLAUDE.md merged (${size} bytes)`;
}
function wireEngramPlugin(environment) {
  spawnSync3("claude", ["plugin", "marketplace", "add", ENGRAM_SOURCE_REPO], { env: environment, encoding: "utf8" });
  const install = spawnSync3("claude", ["plugin", "install", "engram@engram"], { env: environment, encoding: "utf8" });
  if (install.error === void 0 && install.status === 0) return wiringOk("engram (plugin)", "installed");
  return wiringFail("engram (plugin)", `plugin install failed: ${collapsedOutput(install)} \u2014 fix: claude plugin install engram@engram`);
}
function resolveOrProvisionEngram(input) {
  const binaryName = engramBinaryName(input.platform);
  const resolved = firstExecutableOnPath(input.environment, binaryName);
  if (resolved !== void 0) {
    return engramBinaryRuns(input.platform, resolved, input.environment) ? wiringOk("engram (binary)", `already installed where Claude Code resolves it: ${resolved}`) : wiringFail(
      "engram (binary)",
      `${resolved} does not run \u2014 an antivirus may have quarantined it, which upstream documents happening to unsigned prebuilt releases \u2014 fix: remove it, then re-run this installer to provision the pinned release, or ${engramManualInstallCommand(input.platform)}`
    );
  }
  const outcome = provisionEngramBinary({
    homeDirectory: input.homeDirectory,
    environment: input.environment,
    platform: input.platform,
    architecture: input.architecture,
    transport: input.engramTransport
  });
  return engramProvisionWiringEntry(outcome, input.platform);
}
function engramProvisionWiringEntry(outcome, platform) {
  if (outcome.kind === "installed-on-path") {
    return wiringOk("engram (binary)", `installed ${SUPPORTED_ENGRAM_VERSION} at ${outcome.binary}`);
  }
  if (outcome.kind === "installed-off-path") {
    return wiringFail(
      "engram (binary)",
      `installed ${SUPPORTED_ENGRAM_VERSION} at ${outcome.binary}, which is not what a bare \`engram\` resolves to on the PATH Claude Code reads \u2014 the plugin spawns that bare name, so its MCP cannot start until ${outcome.installDirectory} is on that PATH ahead of any other engram \u2014 fix: add ${outcome.installDirectory} to your PATH (in ~/.profile, say), then restart Claude Code`
    );
  }
  return wiringFail("engram (binary)", `${outcome.reason} \u2014 fix: ${engramManualInstallCommand(platform)}`);
}
function engramManualInstallCommand(platform) {
  return platform === "win32" ? `install engram yourself \u2014 go install github.com/${ENGRAM_SOURCE_REPO}/cmd/engram@v${SUPPORTED_ENGRAM_VERSION}, or unpack the release zip from https://github.com/${ENGRAM_SOURCE_REPO}/releases/tag/v${SUPPORTED_ENGRAM_VERSION} onto the PATH Claude Code reads` : `install engram yourself \u2014 brew install gentleman-programming/tap/engram, or go install github.com/${ENGRAM_SOURCE_REPO}/cmd/engram@v${SUPPORTED_ENGRAM_VERSION}`;
}
function wireFallow(environment, homeDirectory, platform) {
  const fallowCommand = resolveFallowMcpCommand(environment, homeDirectory, platform) ?? "fallow-mcp";
  const fix = `npm install --global fallow@${SUPPORTED_FALLOW_VERSION}, then claude mcp add --scope user fallow -- ${fallowCommand}`;
  const npmProbe = spawnSync3("npm", ["--version"], { env: environment, encoding: "utf8" });
  if (npmProbe.error !== void 0) {
    return wiringFail("fallow", `no npm to install the fallow package with \u2014 fix: install Node.js 22 or newer, then ${fix}`);
  }
  const install = spawnSync3("npm", ["install", "--global", `fallow@${SUPPORTED_FALLOW_VERSION}`], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) {
    return wiringFail(
      "fallow",
      `could not install fallow@${SUPPORTED_FALLOW_VERSION}: ${collapsedOutput(install)} \u2014 a fallow already wired here keeps working, at whatever version it is \u2014 fix: ${fix}`
    );
  }
  return addOrConfirmFallowMcp(environment, fallowCommand);
}
function addOrConfirmFallowMcp(environment, fallowCommand) {
  const add = spawnSync3("claude", ["mcp", "add", "--scope", "user", "fallow", "--", fallowCommand], { env: environment, encoding: "utf8" });
  if (add.error === void 0 && add.status === 0) return wiringOk("fallow", `wired (user scope): ${fallowCommand}`);
  const wired = fallowWiredCommand(environment);
  if (wired === fallowCommand) return wiringOk("fallow", `already wired: ${fallowCommand}`);
  if (wired !== "") {
    return wiringFail(
      "fallow",
      `wired to ${wired}, not the ${fallowCommand} this host resolves \u2014 no re-run of this installer can repoint it \u2014 fix: claude mcp remove fallow -s user && claude mcp add --scope user fallow -- ${fallowCommand}`
    );
  }
  return wiringFail("fallow", `mcp add failed: ${collapsedOutput(add)} \u2014 fix: claude mcp add --scope user fallow -- ${fallowCommand}`);
}
function fallowWiredCommand(environment) {
  const result = spawnSync3("claude", ["mcp", "get", "fallow"], { env: environment, encoding: "utf8" });
  const text = result.error === void 0 ? result.stdout : "";
  const match = /^[ \t]*Command:[ \t]*(.*?)[ \t]*$/m.exec(text);
  return match?.[1] ?? "";
}
function resolveFallowMcpCommand(environment, homeDirectory, platform) {
  if (platform === "win32") {
    const appdata = environment["APPDATA"];
    if (appdata !== void 0 && appdata !== "") {
      const prefix = npmGlobalPrefix(environment) ?? path6.join(appdata, "npm");
      const candidate = path6.join(prefix, "fallow-mcp.cmd");
      if (isExecutableRegularFile(candidate)) return candidate;
    }
  }
  const onPath = firstExecutableOnPath(environment, "fallow-mcp");
  if (onPath !== void 0) return onPath;
  const cargoCandidates = [path6.join(homeDirectory, ".cargo", "bin", "fallow-mcp"), path6.join(homeDirectory, ".cargo", "bin", "fallow-mcp.exe")];
  return cargoCandidates.find((candidate) => isExecutableRegularFile(candidate));
}
function npmGlobalPrefix(environment) {
  const result = spawnSync3("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (result.error !== void 0 || result.status !== 0) return void 0;
  const trimmed = result.stdout.trim();
  return trimmed === "" ? void 0 : trimmed.replaceAll("\\", "/");
}
function installOsoPluginCore(environment, repositoryRoot2) {
  registerOsoMarketplace(environment, repositoryRoot2);
  const install = spawnSync3("claude", ["plugin", "install", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) throw new ClaudePluginInstallError(collapsedOutput(install));
  return wiringOk("oso-code plugin", "installed");
}
function softPluginMaintenance(environment) {
  spawnSync3("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
  spawnSync3("claude", ["plugin", "update", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
}
function registerOsoMarketplace(environment, repositoryRoot2) {
  const registry = spawnSync3("claude", ["plugin", "marketplace", "list", "--json"], { env: environment, encoding: "utf8" });
  const localPath = registry.error === void 0 ? localMarketplacePath(registry.stdout) : "";
  if (localPath !== "" && !githubMarketplaceIsReachable(environment)) return;
  const added = spawnSync3("claude", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], { env: environment, encoding: "utf8" });
  if (added.error === void 0 && added.status === 0) return;
  const failure = classifyMarketplaceAddFailure(added.stdout ?? "");
  if (failure === "unreachable") {
    spawnSync3("claude", ["plugin", "marketplace", "add", repositoryRoot2], { env: environment, encoding: "utf8" });
    return;
  }
  spawnSync3("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
}
function classifyMarketplaceAddFailure(output) {
  if (output.includes("is seed-managed")) return "seed-managed";
  if (output.includes("blocked by enterprise policy") || output.includes("not in the allowed marketplace list")) return "policy-blocked";
  if (output.includes("Invalid marketplace source format")) return "invalid-source";
  if (output.includes("Failed to parse marketplace file") || output.includes("Marketplace file not found")) return "invalid-manifest";
  if (output.includes("Failed to clone marketplace repository")) return "unreachable";
  return "unknown";
}
function localMarketplacePath(registryJson) {
  try {
    const parsed = JSON.parse(registryJson);
    if (!Array.isArray(parsed)) return "";
    const match = parsed.find((entry) => isPlainRecord(entry) && entry["name"] === "oso-code" && entry["source"] === "directory");
    return isPlainRecord(match) && typeof match["path"] === "string" ? match["path"] : "";
  } catch {
    return "";
  }
}
function githubMarketplaceIsReachable(environment) {
  const result = spawnSync3("git", ["ls-remote", "--exit-code", `https://github.com/${MARKETPLACE_SOURCE}.git`, "HEAD"], {
    env: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8"
  });
  return result.error === void 0 && result.status === 0;
}
function migrateContext7(environment) {
  const listing = spawnSync3("claude", ["mcp", "list"], { env: environment, encoding: "utf8" });
  const entry = pluginContext7Entry(listing.error === void 0 ? listing.stdout : "");
  if (entry === "") {
    return [
      wiringFail(
        "context7",
        "the oso-code plugin's context7 server is not registered with the client, so a legacy user-scope entry, if any, was left standing rather than removed \u2014 fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer"
      )
    ];
  }
  if (!entry.includes("Connected")) {
    return [
      wiringFail(
        "context7",
        `the oso-code plugin's context7 is registered but did not answer (${entry}) \u2014 fix: install Node.js (context7 starts through npx), restart Claude Code, then re-run this installer`
      )
    ];
  }
  spawnSync3("claude", ["mcp", "remove", "--scope", "user", "context7"], { env: environment, encoding: "utf8" });
  return [wiringOk("context7", "ships with the oso-code plugin, registered and connected")];
}
function pluginContext7Entry(listing) {
  return listing.split("\n").find((line) => line.includes("context7") && line.includes("plugin:")) ?? "";
}
function publishStateBinPath(claudeDir, settingsFile) {
  const installedPluginsFile = path6.join(claudeDir, "plugins", "installed_plugins.json");
  const installRoot = installRootFromManifest(installedPluginsFile);
  const fix = "fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer";
  if (installRoot === void 0) {
    return wiringFail(
      "oso-state path",
      `the client records no installed oso-code plugin carrying a runnable bin/oso-state, so there is no absolute path to publish \u2014 ${fix}`
    );
  }
  const stateBin = path6.join(installRoot, "bin", "oso-state");
  if (!isExecutableRegularFile(stateBin)) {
    return wiringFail("oso-state path", `the resolved install path carries no runnable bin/oso-state at ${stateBin} \u2014 ${fix}`);
  }
  try {
    storeClientEnv(settingsFile, "OSO_STATE_BIN", stateBin);
    return wiringOk("oso-state path", `every session reads OSO_STATE_BIN=${stateBin}`);
  } catch (error) {
    return wiringFail(
      "oso-state path",
      `${errorMessageOf(error)} \u2014 fix: add "env": { "OSO_STATE_BIN": "${stateBin}" } to ${settingsFile} by hand, then restart Claude Code`
    );
  }
}
function publishGitBashPath(platform, environment, settingsFile) {
  if (platform !== "win32") return void 0;
  const stored = clientEnvValue(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH");
  if (isRegularNonSymlinkFile(stored)) return wiringOk("Git Bash path", `left as you set it: ${stored}`);
  const candidate = environment["CLAUDE_CODE_GIT_BASH_PATH"] ?? "";
  if (!isRegularNonSymlinkFile(candidate)) {
    if (stored === "") return void 0;
    return wiringFail(
      "Git Bash path",
      `settings.json points CLAUDE_CODE_GIT_BASH_PATH at ${stored}, which is not there any more, and this run was handed no Git Bash to repair it with \u2014 fix: re-run from PowerShell via bootstrap\\install.ps1, which finds Git Bash and hands it to this installer, or set the key yourself to the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe)`
    );
  }
  const outcome = stored === "" ? "published" : `repaired from ${stored}`;
  try {
    storeClientEnv(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH", candidate);
    return wiringOk("Git Bash path", `${outcome}: ${candidate}`);
  } catch (error) {
    return wiringFail(
      "Git Bash path",
      `${errorMessageOf(error)} \u2014 fix: add "env": { "CLAUDE_CODE_GIT_BASH_PATH": "${candidate}" } to ${settingsFile} by hand, then restart Claude Code`
    );
  }
}
function gitHooksOwner(repositoryRoot2, environment, gitHooksDir) {
  const configured = gitConfigValue(repositoryRoot2, "core.hooksPath", environment);
  if (configured !== "" && normalizedPath(configured) !== normalizedPath(gitHooksDir)) return `core.hooksPath=${configured}`;
  const gitDir = gitAbsoluteGitDir(repositoryRoot2, environment);
  if (gitDir === "") return "";
  const hooksDir = path6.join(gitDir, "hooks");
  if (!isDirectory(hooksDir)) return "";
  const hookFile = readdirSync3(hooksDir).find((name) => !name.endsWith(".sample") && isRegularNonSymlinkFile(path6.join(hooksDir, name)));
  return hookFile === void 0 ? "" : path6.join(hooksDir, hookFile);
}
function gitAbsoluteGitDir(repositoryRoot2, environment) {
  const result = spawnSync3("git", ["-C", repositoryRoot2, "rev-parse", "--absolute-git-dir"], { env: environment, encoding: "utf8" });
  return result.error === void 0 && result.status === 0 ? result.stdout.replace(/\n+$/, "") : "";
}
function wireGitCommitHook(repositoryRoot2, environment) {
  const gitHooksDir = path6.join(repositoryRoot2, "plugin", "git-hooks");
  const owner = gitHooksOwner(repositoryRoot2, environment, gitHooksDir);
  if (owner !== "") {
    return wiringFail(
      "git commit hook",
      `not wired in ${repositoryRoot2} \u2014 ${owner} already owns this repo's hooks and core.hooksPath would take it out of git's reach; the PreToolUse commit gate still applies here \u2014 fix: to run both, call ${path6.join(gitHooksDir, "pre-commit")} from your own pre-commit`
    );
  }
  const result = spawnSync3("git", ["-C", repositoryRoot2, "config", "core.hooksPath", gitHooksDir], { env: environment, encoding: "utf8" });
  if (result.error === void 0 && result.status === 0) {
    return wiringOk("git commit hook", `core.hooksPath wired in ${repositoryRoot2} \u2014 for another repo: git -C <repo> config core.hooksPath ${gitHooksDir}`);
  }
  return wiringFail("git commit hook", `git config failed: ${collapsedOutput(result)} \u2014 fix: git -C ${repositoryRoot2} config core.hooksPath ${gitHooksDir}`);
}
function wireImpeccable(environment, homeDirectory) {
  rmSync5(impeccableOptOutMarker(homeDirectory), { force: true });
  spawnSync3("claude", ["plugin", "marketplace", "add", "pbakaus/impeccable"], { env: environment, encoding: "utf8" });
  const install = spawnSync3("claude", ["plugin", "install", "impeccable@impeccable"], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) {
    return wiringFail("impeccable (plugin)", `install failed: ${collapsedOutput(install)} \u2014 fix: claude plugin install impeccable@impeccable`);
  }
  const listing = spawnSync3("claude", ["plugin", "list"], { env: environment, encoding: "utf8" });
  const installed = listing.error === void 0 && listing.stdout.includes("impeccable");
  return installed ? wiringOk("impeccable (plugin)", "installed") : wiringFail("impeccable (plugin)", "the install reported success but the client lists no impeccable plugin \u2014 fix: claude plugin install impeccable@impeccable, then restart Claude Code");
}
function skipImpeccable(homeDirectory) {
  const marker = impeccableOptOutMarker(homeDirectory);
  mkdirSync5(path6.dirname(marker), { recursive: true });
  writeFileSync4(marker, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}
`);
}
function wiringOk(component, note) {
  return { ok: true, component, note };
}
function wiringFail(component, note) {
  return { ok: false, component, note };
}
function toWiringEntry(component, outcome) {
  return outcome.kind === "failed" ? wiringFail(component, outcome.note) : wiringOk(component, outcome.note);
}
function collapsedOutput(result) {
  return collapsedNewlines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}
function renderCommandReport(verb, infoLines, wiring) {
  const summaryLines = wiring.map((entry) => `  ${entry.component}: ${entry.ok ? "OK" : "FAILED"} \u2014 ${entry.note}`);
  const failedCount = wiring.filter((entry) => !entry.ok).length;
  const lines = [`oso ${verb} --host claude`, ...infoLines, "wiring summary:", ...summaryLines, "----", `wired: ${wiring.length - failedCount}, failed: ${failedCount}`];
  return lines.map((line) => `${line}
`).join("");
}
function requiresYesOutcome(verb) {
  return { report: `oso ${verb} --host claude requires --yes in this slice \u2014 no interactive confirmation prompt is wired yet
`, exitCode: 1 };
}
function fatalOutcome(verb, summary, error, restore) {
  const restoreNote = restore === void 0 ? "" : restore.failedCount === 0 ? " \u2014 rolled back to the pre-run snapshot" : ` \u2014 rollback incomplete: ${restore.failedItems.join(", ")} still need restoring by hand`;
  return { report: `oso ${verb} --host claude: ${summary}: ${errorMessageOf(error)}${restoreNote}
`, exitCode: 1 };
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// core/src/install/cli.ts
var USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [--yes]

Only the claude host runs real checks/mutations in this slice; every other
host is not yet implemented.
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
  if (parsed.host !== "claude") throw new VerbNotImplementedError(parsed.verb, parsed.host);
  const claudeContext = {
    homeDirectory: homeDirectoryFrom(process.platform, process.env),
    repositoryRoot: repositoryRoot2,
    environment: process.env,
    platform: process.platform,
    architecture: process.arch,
    assumeYes: parsed.assumeYes
  };
  const outcome = parsed.verb === "verify" ? verifyClaude(claudeContext) : parsed.verb === "install" ? installClaude(claudeContext) : parsed.verb === "repair" ? repairClaude(claudeContext) : purgeClaude(claudeContext);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
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
