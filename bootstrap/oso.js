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
function stateRecords(content, key) {
  const prefix = `${key}=`;
  return content.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}
function stateValue(content, key) {
  return stateRecords(content, key).join("\n");
}
function isSymlink(target) {
  const stats = lstatOrUndefined(target);
  return stats !== void 0 && stats.isSymbolicLink();
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
function filesHoldTheSameBytes(one, other) {
  if (!isReadableRegularFile(one) || !isReadableRegularFile(other)) return false;
  return readFileSync(one).equals(readFileSync(other));
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
function withOwnerOnlyUmask(run) {
  const previous = process.umask(63);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
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

// core/src/install/codex-host.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdtempSync as mkdtempSync2, rmSync as rmSync4, writeFileSync as writeFileSync4 } from "node:fs";
import path5 from "node:path";

// core/src/install/verify-claude.ts
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync as mkdirSync3, mkdtempSync, openSync, readFileSync as readFileSync4, readSync, readdirSync as readdirSync2, rmSync as rmSync3, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir } from "node:os";
import path4 from "node:path";

// core/src/install/backup.ts
import { chmodSync, cpSync, lstatSync as lstatSync2, mkdirSync as mkdirSync2, readdirSync, readFileSync as readFileSync2, rmSync as rmSync2, statSync as statSync2, writeFileSync as writeFileSync2 } from "node:fs";
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
function installBackupDeclares(backup, format, label) {
  if (!isDirectoryNotSymlink(backup)) return false;
  if (formatMarkerOf(backup) === format) return true;
  return manifestRowsOf(backup).some((row) => row.label === label);
}
function installBackupsDeclaring(root, format, label) {
  return installBackupDirsNewestFirst(root).filter((backup) => installBackupDeclares(backup, format, label));
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
function existsAtAll(target) {
  try {
    lstatSync2(target);
    return true;
  } catch {
    return false;
  }
}
function beginTransaction(backupsRoot, format) {
  const backupRoot = path2.join(backupsRoot, `install-backup-${compactTimestamp()}-${process.pid}`);
  const itemsDirectory = path2.join(backupRoot, "items");
  mkdirSync2(itemsDirectory, { recursive: true });
  chmodSync(backupRoot, 448);
  writeFileSync2(path2.join(backupRoot, "format"), `${format}
`);
  return { backupRoot, itemsDirectory, manifest: [] };
}
function backupTarget(tx, label, target) {
  if (!existsAtAll(target)) {
    tx.manifest.push({ status: "absent", label, target });
    return;
  }
  const destination = path2.join(tx.itemsDirectory, label);
  mkdirSync2(path2.dirname(destination), { recursive: true });
  cpSync(target, destination, { recursive: true });
  tx.manifest.push({ status: "present", label, target });
}
function commitManifest(tx) {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  writeFileSync2(path2.join(tx.backupRoot, "manifest"), text === "" ? "" : `${text}
`);
}
function rollback(tx) {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  return restoreBackupManifest(text, tx.itemsDirectory);
}
function pruneInstallBackups(backupsRoot, environment) {
  const over = installBackupsOverBudget(installBackupDirsNewestFirst(backupsRoot), installBackupBudgetKib(environment));
  for (const backup of over) rmSync2(backup, { recursive: true, force: true });
  return over;
}
function compactTimestamp() {
  const [datePart = "", timePart = ""] = isoTimestamp().replace("Z", "").split("T");
  return `${datePart.replaceAll("-", "")}-${timePart.replaceAll(":", "")}`;
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
function formatMarkerOf(backup) {
  return readableLinesOf(path2.join(backup, "format"))[0];
}
function manifestRowsOf(backup) {
  const lines = readableLinesOf(path2.join(backup, "manifest"));
  return lines.length === 0 ? [] : parseManifestRows(lines.join("\n"));
}
function readableLinesOf(file) {
  try {
    return readFileSync2(file, "utf8").split("\n");
  } catch {
    return [];
  }
}
function childDirectoryNames(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
function isDirectoryNotSymlink(target) {
  try {
    return statSync2(target).isDirectory();
  } catch {
    return false;
  }
}
function recursiveDiskBlocks(target) {
  const stats = lstatSync2(target, { throwIfNoEntry: false });
  if (stats === void 0) return 0;
  if (!stats.isDirectory()) return stats.blocks;
  const childBlocks = readdirSync(target).reduce((total, child) => total + recursiveDiskBlocks(path2.join(target, child)), 0);
  return stats.blocks + childBlocks;
}

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
var UNVERIFIED_PREFIX = "unverified: ";
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
  unverified(text) {
    this.lines.push(`${UNVERIFIED_PREFIX}${text}`);
  }
  section(text) {
    this.lines.push(text);
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
function wiringOk(component, note) {
  return { ok: true, component, note };
}
function wiringFail(component, note) {
  return { ok: false, component, note };
}
function renderCommandReport(verb, host, infoLines, wiring) {
  const summaryLines = wiring.map((entry) => `  ${entry.component}: ${entry.ok ? "OK" : "FAILED"} \u2014 ${entry.note}`);
  const failedCount = wiring.filter((entry) => !entry.ok).length;
  const lines = [
    `oso ${verb} --host ${host}`,
    ...infoLines,
    "wiring summary:",
    ...summaryLines,
    SUMMARY_RULE,
    `wired: ${wiring.length - failedCount}, failed: ${failedCount}`
  ];
  return lines.map((line) => `${line}
`).join("");
}
function requiresYesOutcome(verb, host) {
  return {
    report: `oso ${verb} --host ${host} requires --yes in this slice \u2014 no interactive confirmation prompt is wired yet
`,
    exitCode: 1
  };
}
function usageErrorOutcome(verb, host, message) {
  return { report: `oso ${verb} --host ${host}: ${message}
`, exitCode: 2 };
}
function fatalOutcome(verb, host, summary, detail, restoreNote = "") {
  return { report: `oso ${verb} --host ${host}: ${summary}: ${detail}${restoreNote}
`, exitCode: 1 };
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function restoreNoteOf(restore) {
  if (restore === void 0) return "";
  return restore.failedCount === 0 ? " \u2014 rolled back to the pre-run snapshot" : ` \u2014 rollback incomplete: ${restore.failedItems.join(", ")} still need restoring by hand`;
}

// core/src/install/verify-claude.ts
var ENGRAM_FIX = "bash bootstrap/install.sh installs the engram plugin AND the pinned engram binary its .mcp.json spawns by name; where that binary is installed but the client still cannot start it, either the directory holding it is not on the PATH Claude Code reads or the copy there does not run at all \u2014 that run's wiring summary says which and names the command for it (check 13 below discriminates the two on Windows), and Claude Code has to be restarted after";
var CONTEXT7_FIX = "claude plugin install oso-code@oso-code registers it (it ships in the plugin's .mcp.json, so there is no mcp add to run), and it starts through npx \u2014 so install Node.js if npx is missing, then restart Claude Code";
var FALLOW_FIX = "bash bootstrap/install.sh installs the pinned fallow package from npm and wires a missing entry; an existing one it never touches, so repoint that with claude mcp remove fallow -s user && claude mcp add --scope user fallow -- the command that run names";
var STATE_BIN_FIX = "bash bootstrap/install.sh publishes the installed plugin's absolute bin/oso-state there, then restart Claude Code";
var GIT_BASH_FIX = "point CLAUDE_CODE_GIT_BASH_PATH at the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe) \u2014 bootstrap\\install.ps1 finds it and hands it to install.sh, which repairs the stored value; then restart Claude Code";
var LEGACY_HOOK_COMMAND_PATTERNS = ["check-plan-contract", "clean-code-gate", "skill-registry-refresh", "gentle-ai"];
var CLAUDE_MD_BUDGET_BYTES = 8e3;
var HOME_DIR_FIX = 'export HOME="$USERPROFILE" in Git Bash and re-run bootstrap/install.sh';
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
    writeFileSync3(path4.join(stateDir, `${stateKey}.state`), "mode=plan\nverify_green=false\n");
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
  const collapsed2 = collapsedNewlines(message);
  return collapsed2 === "" ? "empty" : collapsed2;
}

// core/src/install/pins.ts
var SUPPORTED_ENGRAM_VERSION = "1.20.0";
var SUPPORTED_CODEX_VERSION = "0.146.0";
var SUPPORTED_OPENCODE_VERSION = "1.18.22";
var DOTTED_NUMERIC_VERSION = /^\d+(\.\d+)*$/;
function meetsVersionFloor(found, floor) {
  if (found === void 0 || !DOTTED_NUMERIC_VERSION.test(found)) return false;
  return compareVersionsAscending(found, floor) >= 0;
}
function isAboveTestedVersion(found, tested) {
  if (found === void 0 || !DOTTED_NUMERIC_VERSION.test(found)) return false;
  return compareVersionsAscending(found, tested) > 0;
}

// core/src/install/codex-host.ts
var CODEX_BINARY = "codex";
var OSO_PERMISSION_PROFILE = "oso";
var VALIDATION_HOME_PREFIX = ".validate.";
function pinnedVersionRefusal(found) {
  const current = found === void 0 || found === "" ? "not installed" : found;
  return `Codex CLI must already be ${SUPPORTED_CODEX_VERSION} or newer (found ${current}); run: npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`;
}
function versionFieldsOf(versionOutput) {
  return versionOutput.replace(/\n+$/, "").split("\n").map((line) => line.trim().split(/\s+/).at(-1) ?? "").join("\n").replace(/\n+$/, "");
}
function codexHostProbes(environment) {
  const binaryPath = firstExecutableOnPath(environment, CODEX_BINARY);
  const version = binaryPath === void 0 ? void 0 : probedVersion(environment);
  return {
    version,
    binaryPath,
    acceptsConfig: (codexHome, configText) => sandboxAcceptsConfig(environment, codexHome, configText),
    sandbox: (argv) => hostRun(environment, ["sandbox", "-P", OSO_PERMISSION_PROFILE, "--", ...argv]),
    pluginListing: () => hostRun(environment, ["plugin", "list", "--json"])
  };
}
function probedVersion(environment) {
  const run = spawnSync2(CODEX_BINARY, ["--version"], { env: environment, encoding: "utf8" });
  if (run.error !== void 0 || run.status !== 0) return void 0;
  return versionFieldsOf(run.stdout);
}
function hostRun(environment, argv) {
  const run = spawnSync2(CODEX_BINARY, [...argv], { env: environment, encoding: "utf8" });
  if (run.error !== void 0) return { ok: false, output: run.error.message };
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}
function sandboxAcceptsConfig(environment, codexHome, configText) {
  const validationHome = mkdtempSync2(path5.join(codexHome, VALIDATION_HOME_PREFIX));
  try {
    writeFileSync4(path5.join(validationHome, "config.toml"), configText, { mode: 384 });
    const run = spawnSync2(CODEX_BINARY, ["sandbox", "-P", OSO_PERMISSION_PROFILE, "--", "/bin/true"], {
      env: { ...environment, CODEX_HOME: validationHome },
      encoding: "utf8"
    });
    return run.error === void 0 && run.status === 0;
  } finally {
    rmSync4(validationHome, { recursive: true, force: true });
  }
}

// core/src/install/claude.ts
import { spawnSync as spawnSync4 } from "node:child_process";
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7, readdirSync as readdirSync3, rmSync as rmSync6, statSync as statSync4, writeFileSync as writeFileSync6 } from "node:fs";
import path7 from "node:path";

// core/src/install/engram.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { mkdirSync as mkdirSync4, mkdtempSync as mkdtempSync3, readFileSync as readFileSync6, renameSync as renameSync2, rmSync as rmSync5, writeFileSync as writeFileSync5 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import path6 from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

// core/src/install/trust.ts
import { readFileSync as readFileSync5 } from "node:fs";
var SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
var ROW_PATTERN = /^(\S+)\s+(.*)$/;
function parseTrustManifest(text) {
  return text.split("\n").filter((line) => line !== "" && !line.startsWith("#")).map((line) => {
    const row = ROW_PATTERN.exec(line);
    return row === null ? { digest: line, file: "" } : { digest: row[1], file: row[2] };
  });
}
var RAW_INSTALLED_BYTES = (_relative, target) => readFileSync5(target);
function trustDivergences(manifestFile, isExcluded, resolveTarget, bytesOf = RAW_INSTALLED_BYTES) {
  if (!isReadableRegularFile(manifestFile)) return [{ file: manifestFile, state: { kind: "missing-manifest" } }];
  const trusted = parseTrustManifest(readFileSync5(manifestFile, "utf8")).filter((row) => !isExcluded(row.file));
  return trusted.flatMap((row) => divergenceOf(row, resolveTarget, bytesOf));
}
function divergenceOf(row, resolveTarget, bytesOf) {
  if (!SHA256_HEX_PATTERN.test(row.digest)) return [{ file: row.file, state: { kind: "malformed-published-hash" } }];
  const target = resolveTarget(row.file);
  if (target === void 0) return [{ file: row.file, state: { kind: "outside-the-trust-set" } }];
  if (!isReadableRegularFile(target)) return [{ file: row.file, state: { kind: "missing" } }];
  const actual = sha256Hex(bytesOf(row.file, target));
  return actual === row.digest ? [] : [{ file: row.file, state: { kind: "mismatch", actual } }];
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
  const installDirectory = path6.join(input.homeDirectory, ".local", "bin");
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
  const target = path6.join(installDirectory, binaryName);
  const pending = path6.join(installDirectory, `.oso-pending-${process.pid}-${binaryName}`);
  writeFileSync5(pending, content, { mode: 493 });
  try {
    if (!engramBinaryRuns(platform, pending, environment)) {
      throw new EngramProvisionError(
        `engram ${SUPPORTED_ENGRAM_VERSION} was verified but would not run from ${installDirectory}, so ${target} was left exactly as it was \u2014 an antivirus may have quarantined it, which upstream documents happening to its unsigned prebuilt releases`
      );
    }
    renameSync2(pending, target);
  } catch (error) {
    rmSync5(pending, { force: true });
    throw error;
  }
  return target;
}
function curlOrWgetTransport(environment) {
  return (url) => {
    const scratch = mkdtempSync3(path6.join(tmpdir2(), "oso-engram-download-"));
    try {
      const destination = path6.join(scratch, "download");
      downloadToFile(url, destination, environment);
      return readFileSync6(destination);
    } finally {
      rmSync5(scratch, { recursive: true, force: true });
    }
  };
}
function downloadToFile(url, destination, environment) {
  const bound = String(DOWNLOAD_BOUND_SECONDS);
  const curl = spawnSync3(
    "curl",
    ["-fsSL", "--retry", "3", "--retry-delay", "2", "--connect-timeout", bound, "--max-time", bound, "-o", destination, url],
    { env: environment, encoding: "utf8" }
  );
  if (curl.error === void 0) {
    if (curl.status !== 0) throw new Error(fetcherRefusal("curl", curl));
    return;
  }
  const wget = spawnSync3("wget", ["-nv", "--tries=3", `--timeout=${bound}`, "-O", destination, url], {
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
  const named = entries.filter((entry) => path6.posix.basename(entry.name) === binaryName);
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
  if (!input.assumeYes) return requiresYes("install");
  const claudeDir = path7.join(input.homeDirectory, ".claude");
  const settingsFile = path7.join(claudeDir, "settings.json");
  const claudeMdFile = path7.join(claudeDir, "CLAUDE.md");
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
    return claudeFatal("install", "could not create the pre-install backup", error);
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
    return claudeFatal("install", "the oso-code plugin itself failed to install", error, restore);
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
    return claudeFatal("install", "could not remove a legacy artifact", error, restore);
  }
  wiring.push(toWiringEntry("legacy settings hooks", removeLegacySettingsEntries(settingsFile)));
  wiring.push(toWiringEntry("output style", ensureOutputStyle(settingsFile)));
  try {
    mergeGlobalClaudeMd(claudeMdFile, claudeGlobalBody(input.repositoryRoot), { replace: input.replaceClaudeMd ?? false });
    infoLines.push(claudeMdSizeNote(claudeMdFile));
  } catch (error) {
    const restore = rollback(tx);
    return claudeFatal("install", "could not write CLAUDE.md", error, restore);
  }
  const pruned = pruneInstallBackups(backupsRootOf(input.homeDirectory), input.environment);
  for (const backup of pruned) infoLines.push(`backup retention: removed ${backup}`);
  return { report: claudeReport("install", infoLines, wiring), exitCode: 0 };
}
function repairClaude(input) {
  if (!input.assumeYes) return requiresYes("repair");
  const claudeDir = path7.join(input.homeDirectory, ".claude");
  const settingsFile = path7.join(claudeDir, "settings.json");
  const claudeMdFile = path7.join(claudeDir, "CLAUDE.md");
  let tx;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_REPAIR_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return claudeFatal("repair", "could not create the pre-repair backup", error);
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
    return claudeFatal("repair", "could not rewrite CLAUDE.md", error, restore);
  }
  wiring.push(wireFallow(input.environment, input.homeDirectory, input.platform));
  return { report: claudeReport("repair", infoLines, wiring), exitCode: 0 };
}
function purgeClaude(input) {
  if (!input.assumeYes) return requiresYes("purge");
  const claudeDir = path7.join(input.homeDirectory, ".claude");
  const settingsFile = path7.join(claudeDir, "settings.json");
  const claudeMdFile = path7.join(claudeDir, "CLAUDE.md");
  let tx;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_PURGE_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return claudeFatal("purge", "could not create the pre-purge backup", error);
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
    return claudeFatal("purge", "could not rewrite CLAUDE.md", error, restore);
  }
  const mcpRemove = spawnSync4("claude", ["mcp", "remove", "--scope", "user", "fallow"], { env: input.environment, encoding: "utf8" });
  wiring.push(
    mcpRemove.error === void 0 && mcpRemove.status === 0 ? wiringOk("fallow (mcp)", "removed") : wiringFail("fallow (mcp)", `nothing removed, or already absent: ${collapsedOutput(mcpRemove)}`)
  );
  return { report: claudeReport("purge", infoLines, wiring), exitCode: 0 };
}
function backupsRootOf(homeDirectory) {
  return path7.join(homeDirectory, ".local", "state", "oso-code", "claude-backups");
}
function backupClientConfigTargets(homeDirectory, claudeDir) {
  const targets = [{ label: "claude-json", target: path7.join(homeDirectory, ".claude.json") }];
  const pluginsDir = path7.join(claudeDir, "plugins");
  if (!isDirectory(pluginsDir)) return targets;
  for (const name of readdirSync3(pluginsDir).filter((entry) => entry.endsWith(".json"))) {
    targets.push({ label: `plugins-json-${name}`, target: path7.join(pluginsDir, name) });
  }
  return targets;
}
function legacyArtifactTargets(repositoryRoot2, claudeDir) {
  const manifestFile = path7.join(repositoryRoot2, "bootstrap", "gentle-manifest.txt");
  const content = readFileSync7(manifestFile, "utf8");
  return manifestEntries(content).map((relative) => ({ label: relative, target: path7.join(claudeDir, relative) }));
}
function removeLegacyArtifacts(targets) {
  let removed = 0;
  for (const { target } of targets) {
    if (!existsAtAll(target)) continue;
    rmSync6(target, { recursive: true, force: true });
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
  const prefix = shouldMerge ? `${withoutMarkerRegion(readFileSync7(claudeMdFile, "utf8"))}
` : "";
  const content = `${prefix}${CLAUDE_MD_MARKER_START}
${blockBody}${CLAUDE_MD_MARKER_END}
`;
  writeFileAtomically(path7.dirname(claudeMdFile), claudeMdFile, content, ".oso-claude-md-");
}
function stripClaudeMdRegion(claudeMdFile) {
  if (!isReadableRegularFile(claudeMdFile)) return false;
  const content = readFileSync7(claudeMdFile, "utf8");
  if (!content.includes(CLAUDE_MD_MARKER_START)) return false;
  const withoutBlock = withoutMarkerRegion(content);
  writeFileAtomically(path7.dirname(claudeMdFile), claudeMdFile, withoutBlock === "" ? "" : `${withoutBlock}
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
  return readFileSync7(path7.join(repositoryRoot2, "bootstrap", "claude-global.md"), "utf8");
}
function claudeMdSizeNote(claudeMdFile) {
  const size = statSync4(claudeMdFile, { throwIfNoEntry: false })?.size ?? 0;
  return size > CLAUDE_MD_BUDGET_BYTES ? `CLAUDE.md is still ${size} bytes \u2014 review the non-oso content; every session pays for it` : `CLAUDE.md merged (${size} bytes)`;
}
function wireEngramPlugin(environment) {
  spawnSync4("claude", ["plugin", "marketplace", "add", ENGRAM_SOURCE_REPO], { env: environment, encoding: "utf8" });
  const install = spawnSync4("claude", ["plugin", "install", "engram@engram"], { env: environment, encoding: "utf8" });
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
  const npmProbe = spawnSync4("npm", ["--version"], { env: environment, encoding: "utf8" });
  if (npmProbe.error !== void 0) {
    return wiringFail("fallow", `no npm to install the fallow package with \u2014 fix: install Node.js 22 or newer, then ${fix}`);
  }
  const install = spawnSync4("npm", ["install", "--global", `fallow@${SUPPORTED_FALLOW_VERSION}`], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) {
    return wiringFail(
      "fallow",
      `could not install fallow@${SUPPORTED_FALLOW_VERSION}: ${collapsedOutput(install)} \u2014 a fallow already wired here keeps working, at whatever version it is \u2014 fix: ${fix}`
    );
  }
  return addOrConfirmFallowMcp(environment, fallowCommand);
}
function addOrConfirmFallowMcp(environment, fallowCommand) {
  const add = spawnSync4("claude", ["mcp", "add", "--scope", "user", "fallow", "--", fallowCommand], { env: environment, encoding: "utf8" });
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
  const result = spawnSync4("claude", ["mcp", "get", "fallow"], { env: environment, encoding: "utf8" });
  const text = result.error === void 0 ? result.stdout : "";
  const match = /^[ \t]*Command:[ \t]*(.*?)[ \t]*$/m.exec(text);
  return match?.[1] ?? "";
}
function resolveFallowMcpCommand(environment, homeDirectory, platform) {
  if (platform === "win32") {
    const appdata = environment["APPDATA"];
    if (appdata !== void 0 && appdata !== "") {
      const prefix = npmGlobalPrefix(environment) ?? path7.join(appdata, "npm");
      const candidate = path7.join(prefix, "fallow-mcp.cmd");
      if (isExecutableRegularFile(candidate)) return candidate;
    }
  }
  const onPath2 = firstExecutableOnPath(environment, "fallow-mcp");
  if (onPath2 !== void 0) return onPath2;
  const cargoCandidates = [path7.join(homeDirectory, ".cargo", "bin", "fallow-mcp"), path7.join(homeDirectory, ".cargo", "bin", "fallow-mcp.exe")];
  return cargoCandidates.find((candidate) => isExecutableRegularFile(candidate));
}
function npmGlobalPrefix(environment) {
  const result = spawnSync4("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (result.error !== void 0 || result.status !== 0) return void 0;
  const trimmed = result.stdout.trim();
  return trimmed === "" ? void 0 : trimmed.replaceAll("\\", "/");
}
function installOsoPluginCore(environment, repositoryRoot2) {
  registerOsoMarketplace(environment, repositoryRoot2);
  const install = spawnSync4("claude", ["plugin", "install", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) throw new ClaudePluginInstallError(collapsedOutput(install));
  return wiringOk("oso-code plugin", "installed");
}
function softPluginMaintenance(environment) {
  spawnSync4("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
  spawnSync4("claude", ["plugin", "update", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
}
function registerOsoMarketplace(environment, repositoryRoot2) {
  const registry = spawnSync4("claude", ["plugin", "marketplace", "list", "--json"], { env: environment, encoding: "utf8" });
  const localPath = registry.error === void 0 ? localMarketplacePath(registry.stdout) : "";
  if (localPath !== "" && !githubMarketplaceIsReachable(environment)) return;
  const added = spawnSync4("claude", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], { env: environment, encoding: "utf8" });
  if (added.error === void 0 && added.status === 0) return;
  const failure = classifyMarketplaceAddFailure(added.stdout ?? "");
  if (failure === "unreachable") {
    spawnSync4("claude", ["plugin", "marketplace", "add", repositoryRoot2], { env: environment, encoding: "utf8" });
    return;
  }
  spawnSync4("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
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
  const result = spawnSync4("git", ["ls-remote", "--exit-code", `https://github.com/${MARKETPLACE_SOURCE}.git`, "HEAD"], {
    env: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8"
  });
  return result.error === void 0 && result.status === 0;
}
function migrateContext7(environment) {
  const listing = spawnSync4("claude", ["mcp", "list"], { env: environment, encoding: "utf8" });
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
  spawnSync4("claude", ["mcp", "remove", "--scope", "user", "context7"], { env: environment, encoding: "utf8" });
  return [wiringOk("context7", "ships with the oso-code plugin, registered and connected")];
}
function pluginContext7Entry(listing) {
  return listing.split("\n").find((line) => line.includes("context7") && line.includes("plugin:")) ?? "";
}
function publishStateBinPath(claudeDir, settingsFile) {
  const installedPluginsFile = path7.join(claudeDir, "plugins", "installed_plugins.json");
  const installRoot = installRootFromManifest(installedPluginsFile);
  const fix = "fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer";
  if (installRoot === void 0) {
    return wiringFail(
      "oso-state path",
      `the client records no installed oso-code plugin carrying a runnable bin/oso-state, so there is no absolute path to publish \u2014 ${fix}`
    );
  }
  const stateBin = path7.join(installRoot, "bin", "oso-state");
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
  const hooksDir = path7.join(gitDir, "hooks");
  if (!isDirectory(hooksDir)) return "";
  const hookFile = readdirSync3(hooksDir).find((name) => !name.endsWith(".sample") && isRegularNonSymlinkFile(path7.join(hooksDir, name)));
  return hookFile === void 0 ? "" : path7.join(hooksDir, hookFile);
}
function gitAbsoluteGitDir(repositoryRoot2, environment) {
  const result = spawnSync4("git", ["-C", repositoryRoot2, "rev-parse", "--absolute-git-dir"], { env: environment, encoding: "utf8" });
  return result.error === void 0 && result.status === 0 ? result.stdout.replace(/\n+$/, "") : "";
}
function wireGitCommitHook(repositoryRoot2, environment) {
  const gitHooksDir = path7.join(repositoryRoot2, "plugin", "git-hooks");
  const owner = gitHooksOwner(repositoryRoot2, environment, gitHooksDir);
  if (owner !== "") {
    return wiringFail(
      "git commit hook",
      `not wired in ${repositoryRoot2} \u2014 ${owner} already owns this repo's hooks and core.hooksPath would take it out of git's reach; the PreToolUse commit gate still applies here \u2014 fix: to run both, call ${path7.join(gitHooksDir, "pre-commit")} from your own pre-commit`
    );
  }
  const result = spawnSync4("git", ["-C", repositoryRoot2, "config", "core.hooksPath", gitHooksDir], { env: environment, encoding: "utf8" });
  if (result.error === void 0 && result.status === 0) {
    return wiringOk("git commit hook", `core.hooksPath wired in ${repositoryRoot2} \u2014 for another repo: git -C <repo> config core.hooksPath ${gitHooksDir}`);
  }
  return wiringFail("git commit hook", `git config failed: ${collapsedOutput(result)} \u2014 fix: git -C ${repositoryRoot2} config core.hooksPath ${gitHooksDir}`);
}
function wireImpeccable(environment, homeDirectory) {
  rmSync6(impeccableOptOutMarker(homeDirectory), { force: true });
  spawnSync4("claude", ["plugin", "marketplace", "add", "pbakaus/impeccable"], { env: environment, encoding: "utf8" });
  const install = spawnSync4("claude", ["plugin", "install", "impeccable@impeccable"], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) {
    return wiringFail("impeccable (plugin)", `install failed: ${collapsedOutput(install)} \u2014 fix: claude plugin install impeccable@impeccable`);
  }
  const listing = spawnSync4("claude", ["plugin", "list"], { env: environment, encoding: "utf8" });
  const installed = listing.error === void 0 && listing.stdout.includes("impeccable");
  return installed ? wiringOk("impeccable (plugin)", "installed") : wiringFail("impeccable (plugin)", "the install reported success but the client lists no impeccable plugin \u2014 fix: claude plugin install impeccable@impeccable, then restart Claude Code");
}
function skipImpeccable(homeDirectory) {
  const marker = impeccableOptOutMarker(homeDirectory);
  mkdirSync5(path7.dirname(marker), { recursive: true });
  writeFileSync6(marker, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}
`);
}
function toWiringEntry(component, outcome) {
  return outcome.kind === "failed" ? wiringFail(component, outcome.note) : wiringOk(component, outcome.note);
}
function collapsedOutput(result) {
  return collapsedNewlines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}
function claudeReport(verb, infoLines, wiring) {
  return renderCommandReport(verb, "claude", infoLines, wiring);
}
function requiresYes(verb) {
  return requiresYesOutcome(verb, "claude");
}
function claudeFatal(verb, summary, error, restore) {
  return fatalOutcome(verb, "claude", summary, errorMessageOf(error), restoreNoteOf(restore));
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// core/src/install/codex.ts
import { spawnSync as spawnSync5 } from "node:child_process";
import { mkdirSync as mkdirSync6, readFileSync as readFileSync9, rmSync as rmSync7, writeFileSync as writeFileSync7 } from "node:fs";
import path9 from "node:path";

// core/src/install/codex-config.ts
import path8 from "node:path";
var CONFIG_MARKER_START = "# oso-code:start";
var CONFIG_MARKER_END = "# oso-code:end";
var FEATURE_MARKER_START = "# oso-code:features:start";
var FEATURE_MARKER_END = "# oso-code:features:end";
var GLOBAL_MARKER_START = "<!-- oso-code:start -->";
var GLOBAL_MARKER_END = "<!-- oso-code:end -->";
var MODEL_INSTRUCTIONS_KEY = "model_instructions_file";
var COMPACT_PROMPT_KEY = "experimental_compact_prompt_file";
var FALLOW_FALLBACK_COMMAND = "fallow-mcp";
var DENIED_WORKSPACE_GLOBS = [
  "**/secrets/*",
  "**/*.key",
  "**/*.pem",
  "**/.env.*.local",
  "**/.env.local",
  "**/.env",
  "**/.env.production",
  "**/.npmrc",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ecdsa_sk",
  "**/id_ed25519",
  "**/id_ed25519_sk",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.config/gcloud/**",
  "**/.azure/**",
  "**/.kube/**"
];
function tomlQuote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function renderCodexManagedFeatures() {
  return "hooks = true\nmulti_agent = true\n";
}
function renderCodexManagedConfig(targetHome, runtimeRoot, fallowCommand) {
  const stateBin = tomlQuote(path8.posix.join(runtimeRoot, "bin", "oso-state"));
  const stateRoot = tomlQuote(path8.posix.join(targetHome, ".local", "state", "oso-code"));
  const worktreeRoot = tomlQuote(path8.posix.join(targetHome, ".local", "state", "oso-code", "worktrees"));
  return [
    'default_permissions = "oso"',
    "",
    "[agents]",
    "max_threads = 4",
    "max_depth = 2",
    "job_max_runtime_seconds = 1800",
    "",
    "[shell_environment_policy.set]",
    'OSO_AGENT = "1"',
    `OSO_STATE_BIN = ${stateBin}`,
    "",
    "[permissions.oso]",
    'extends = ":workspace"',
    "",
    'description = "oso-code workspace profile"',
    "",
    "[permissions.oso.workspace_roots]",
    `${stateRoot} = true`,
    `${worktreeRoot} = true`,
    "",
    "[permissions.oso.filesystem]",
    "glob_scan_max_depth = 6",
    "",
    '[permissions.oso.filesystem.":workspace_roots"]',
    ...DENIED_WORKSPACE_GLOBS.map((glob) => `"${glob}" = "deny"`),
    '".git/**" = "write"',
    '".git/config" = "read"',
    "",
    "[permissions.oso.network]",
    "enabled = true",
    "",
    "[permissions.oso.network.domains]",
    '"*" = "allow"',
    '"169.254.169.254" = "deny"',
    '"metadata.google.internal" = "deny"',
    "",
    "[mcp_servers.context7]",
    'url = "https://mcp.context7.com/mcp"',
    "",
    "[mcp_servers.fallow]",
    `command = ${tomlQuote(fallowCommand)}`,
    ""
  ].join("\n");
}
function resolveFallowMcpCommand2(targetHome, environment, npmPrefixOf, firstOnPath) {
  const appData = environment["APPDATA"] ?? "";
  if (appData !== "") {
    const prefix = (npmPrefixOf() ?? path8.posix.join(appData, "npm")).replaceAll("\\", "/");
    const shim = path8.posix.join(prefix, "fallow-mcp.cmd");
    if (isExecutableRegularFile(shim)) return { command: shim, resolved: true };
  }
  const onPath2 = firstOnPath(FALLOW_FALLBACK_COMMAND);
  if (onPath2 !== void 0 && onPath2 !== "") return { command: onPath2, resolved: true };
  for (const name of ["fallow-mcp", "fallow-mcp.exe"]) {
    const cargo = path8.posix.join(targetHome, ".cargo", "bin", name);
    if (isExecutableRegularFile(cargo)) return { command: cargo, resolved: true };
  }
  return { command: FALLOW_FALLBACK_COMMAND, resolved: false };
}

// core/src/install/toml.ts
import { readFileSync as readFileSync8 } from "node:fs";

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
};

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// core/src/install/toml.ts
var TomlParseError = class extends Error {
  file;
  constructor(file, cause) {
    super(`cannot parse TOML at ${file}`, { cause });
    this.name = "TomlParseError";
    this.file = file;
  }
};
function parseTomlDocument(text, file) {
  try {
    return parse(text);
  } catch (cause) {
    if (cause instanceof TomlError) throw new TomlParseError(file, cause);
    throw cause;
  }
}
function readTomlFile(file) {
  if (!isReadableRegularFile(file)) return void 0;
  return parseTomlDocument(readFileSync8(file, "utf8"), file);
}

// core/src/install/toml-regions.ts
var POSIX_SPACE = " \\t\\n\\v\\f\\r";
var TABLE_HEADER = new RegExp(`^[${POSIX_SPACE}]*\\[`);
var FEATURE_MARKER_COMMENT = new RegExp(`^[${POSIX_SPACE}]*#[${POSIX_SPACE}]*oso-code:features:(start|end)`);
var TRAILING_COMMENT = new RegExp(`[${POSIX_SPACE}]*#.*`);
var EVERY_SPACE = new RegExp(`[${POSIX_SPACE}]`, "g");
var OWNED_FEATURE_KEYS = "hooks|multi_agent";
var UNKNOWN_ACTION_EXIT = 64;
var REGION_EXIT = 5;
var FEATURES_EXIT = 6;
var POINTER_REGION_EXIT = 10;
var POINTER_ROW_EXIT = 11;
var DUPLICATE_TABLE_EXIT = 12;
var TOML_REGION_ACTIONS = [
  "strip",
  "extract",
  "split",
  "root-symbols",
  "features-strip",
  "features-merge",
  "engram-pointers",
  "remove-table"
];
function runTomlRegion(text, request) {
  if (!isTomlRegionAction(request.action)) return outputOf(UNKNOWN_ACTION_EXIT, [], [], []);
  const records = recordsOf(text);
  switch (request.action) {
    case "strip":
    case "extract":
      return splitAtMarkers(records, request, request.action);
    case "split":
      return splitRootFromSections(records);
    case "root-symbols":
      return rootSymbols(records);
    case "features-strip":
      return stripFeatureRegion(records, request);
    case "features-merge":
      return mergeFeatureRegion(records, request);
    case "engram-pointers":
      return moveEngramPointers(records, request);
    case "remove-table":
      return removeTable(records, request);
  }
}
function isTomlRegionAction(value) {
  return TOML_REGION_ACTIONS.includes(value);
}
function recordsOf(text) {
  const records = text.split("\n");
  if (records[records.length - 1] === "") records.pop();
  return records;
}
function newScanner() {
  return { stringMode: "", arrayDepth: 0, braceDepth: 0 };
}
function atRoot(scanner) {
  return scanner.stringMode === "" && scanner.arrayDepth === 0 && scanner.braceDepth === 0;
}
function scanRoot(scanner, text) {
  const length = text.length;
  let cursor = 0;
  while (cursor < length) {
    const triple = text.slice(cursor, cursor + 3);
    if (scanner.stringMode === "multiline-basic") {
      if (triple === '"""' && !escapedBefore(text, cursor)) {
        scanner.stringMode = "";
        cursor += 3;
      } else cursor += 1;
      continue;
    }
    if (scanner.stringMode === "multiline-literal") {
      if (triple === "'''") {
        scanner.stringMode = "";
        cursor += 3;
      } else cursor += 1;
      continue;
    }
    const character = text[cursor];
    if (character === "#") return;
    if (triple === '"""') {
      scanner.stringMode = "multiline-basic";
      cursor += 3;
      continue;
    }
    if (triple === "'''") {
      scanner.stringMode = "multiline-literal";
      cursor += 3;
      continue;
    }
    if (character === '"') {
      cursor = afterBasicString(text, cursor);
      continue;
    }
    if (character === "'") {
      cursor = afterLiteralString(text, cursor);
      continue;
    }
    if (character === "[") scanner.arrayDepth += 1;
    else if (character === "]" && scanner.arrayDepth > 0) scanner.arrayDepth -= 1;
    else if (character === "{") scanner.braceDepth += 1;
    else if (character === "}" && scanner.braceDepth > 0) scanner.braceDepth -= 1;
    cursor += 1;
  }
}
function escapedBefore(text, position) {
  let count = 0;
  for (let cursor = position - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}
function afterBasicString(text, openingQuote) {
  let cursor = openingQuote + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === '"') return cursor + 1;
    cursor += 1;
  }
  return cursor;
}
function afterLiteralString(text, openingQuote) {
  let cursor = openingQuote + 1;
  while (cursor < text.length && text[cursor] !== "'") cursor += 1;
  return cursor + 1;
}
function compactHeader(text) {
  return text.replace(TRAILING_COMMENT, "").replace(EVERY_SPACE, "");
}
function isFeaturesHeader(text) {
  return compactHeader(text) === "[features]";
}
function isFeaturesShape(text) {
  const compact = compactHeader(text);
  return /^\[\[?features(\]|[.]|$)/.test(compact) || /^\[\[?"features"(\]|[.]|$)/.test(compact) || /^\[\[?'features'(\]|[.]|$)/.test(compact);
}
function namesKeyAtRoot(text, keys) {
  const withoutComment = text.replace(TRAILING_COMMENT, "");
  const bare = new RegExp(`^[${POSIX_SPACE}]*(${keys})[${POSIX_SPACE}]*([.=])`);
  const quoted = new RegExp(`^[${POSIX_SPACE}]*"(${keys})"[${POSIX_SPACE}]*([.=])`);
  const literal = new RegExp(`^[${POSIX_SPACE}]*'(${keys})'[${POSIX_SPACE}]*([.=])`);
  return bare.test(withoutComment) || quoted.test(withoutComment) || literal.test(withoutComment);
}
function isPointer(text, key) {
  return new RegExp(`^${key}[${POSIX_SPACE}]*=`).test(text);
}
function isStringPointer(text, key) {
  return new RegExp(`^${key}[${POSIX_SPACE}]*=[${POSIX_SPACE}]*"[^"]*"[${POSIX_SPACE}]*$`).test(text);
}
function pointerValue(text) {
  return text.replace(new RegExp(`^[^=]*=[${POSIX_SPACE}]*"`), "").replace(new RegExp(`"[${POSIX_SPACE}]*$`), "");
}
function outputOf(exitCode, stdout, root, sections) {
  return { exitCode, stdout: printed(stdout), root: printed(root), sections: printed(sections) };
}
function printed(lines) {
  return lines.map((line) => `${line}
`).join("");
}
function splitAtMarkers(records, request, action) {
  const scanner = newScanner();
  const emitted = [];
  let inside = false;
  let malformed = false;
  let seenStart = 0;
  let seenEnd = 0;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (rootLine && record === request.startMarker) {
      if (inside) malformed = true;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (rootLine && record === request.endMarker) {
      if (!inside) malformed = true;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (action === "strip" ? !inside : inside) emitted.push(record);
    scanRoot(scanner, record);
  }
  const broken = malformed || inside || seenStart !== seenEnd || seenStart > 1 || (request.requireRegion ?? false) && seenStart !== 1;
  return outputOf(broken ? REGION_EXIT : 0, emitted, [], []);
}
function splitRootFromSections(records) {
  const scanner = newScanner();
  const root = [];
  const sections = [];
  let reachedSections = false;
  for (const record of records) {
    if (!reachedSections && atRoot(scanner) && TABLE_HEADER.test(record)) reachedSections = true;
    if (reachedSections) {
      sections.push(record);
      continue;
    }
    root.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(0, [], root, sections);
}
function rootSymbols(records) {
  const scanner = newScanner();
  const emitted = [];
  let inTableContext = false;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (rootLine && TABLE_HEADER.test(record)) {
      emitted.push(record);
      inTableContext = true;
      continue;
    }
    if (rootLine && !inTableContext) emitted.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(0, emitted, [], []);
}
function scanFeatureRegion(records, request, action) {
  const scanner = newScanner();
  const emitted = [];
  const featureLines = request.featureText === void 0 ? [] : recordsOf(request.featureText);
  let section = "";
  let inside = false;
  let malformed = false;
  let seenStart = 0;
  let seenEnd = 0;
  let tables = 0;
  let inserted = false;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (action === "features-strip" && rootLine && record === request.featureStartMarker) {
      if (section !== "features" || inside) malformed = true;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (action === "features-strip" && rootLine && record === request.featureEndMarker) {
      if (section !== "features" || !inside) malformed = true;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (action === "features-strip" && rootLine && FEATURE_MARKER_COMMENT.test(record)) {
      malformed = true;
      continue;
    }
    if (rootLine && TABLE_HEADER.test(record)) {
      if (isFeaturesHeader(record)) {
        tables += 1;
        section = "features";
        if (action === "features-merge") {
          emitted.push(record, ...featureLines);
          inserted = true;
          continue;
        }
      } else {
        if (isFeaturesShape(record)) malformed = true;
        section = "other";
      }
    } else if (rootLine && section === "" && namesKeyAtRoot(record, "features")) {
      malformed = true;
    } else if (rootLine && section === "features" && !inside && namesKeyAtRoot(record, OWNED_FEATURE_KEYS)) {
      malformed = true;
    }
    if (!inside) emitted.push(record);
    scanRoot(scanner, record);
  }
  return { emitted, malformed, inside, seenStart, seenEnd, tables, inserted };
}
function stripFeatureRegion(records, request) {
  const scan = scanFeatureRegion(records, request, "features-strip");
  const broken = scan.malformed || scan.inside || scan.seenStart !== scan.seenEnd || scan.seenStart > 1 || scan.tables > 1 || scan.seenStart > 0 && scan.tables !== 1;
  return outputOf(broken ? FEATURES_EXIT : 0, scan.emitted, [], []);
}
function mergeFeatureRegion(records, request) {
  const scan = scanFeatureRegion(records, request, "features-merge");
  if (scan.malformed || scan.tables > 1) return outputOf(FEATURES_EXIT, scan.emitted, [], []);
  if (scan.inserted) return outputOf(0, scan.emitted, [], []);
  const featureLines = request.featureText === void 0 ? [] : recordsOf(request.featureText);
  const appended = records.length > 0 ? [""] : [];
  return outputOf(0, [...scan.emitted, ...appended, "[features]", ...featureLines], [], []);
}
function removeTable(records, request) {
  const scanner = newScanner();
  const emitted = [];
  let insideTarget = false;
  let seen = 0;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (insideTarget && rootLine && TABLE_HEADER.test(record)) insideTarget = false;
    if (!insideTarget && rootLine && record === request.targetHeader) {
      seen += 1;
      insideTarget = true;
      scanRoot(scanner, record);
      continue;
    }
    if (!insideTarget) emitted.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(seen > 1 ? DUPLICATE_TABLE_EXIT : 0, emitted, [], []);
}
function moveEngramPointers(records, request) {
  const scanner = newScanner();
  const modelKey = request.modelKey ?? "";
  const compactKey = request.compactKey ?? "";
  const pointerRows = /* @__PURE__ */ new Set();
  let starts = 0;
  let ends = 0;
  let startLine = 0;
  let endLine = 0;
  let modelRows = 0;
  let compactRows = 0;
  let modelLine = 0;
  let compactLine = 0;
  let invalidModel = false;
  let invalidCompact = false;
  records.forEach((record, index) => {
    const number = index + 1;
    const rootLine = atRoot(scanner);
    if (rootLine && record === request.startMarker) {
      starts += 1;
      startLine = number;
    }
    if (rootLine && record === request.endMarker) {
      ends += 1;
      endLine = number;
    }
    if (rootLine && isPointer(record, modelKey)) {
      modelRows += 1;
      modelLine = number;
      pointerRows.add(number);
      if (!isStringPointer(record, modelKey) || pointerValue(record) !== request.modelValue) invalidModel = true;
    }
    if (rootLine && isPointer(record, compactKey)) {
      compactRows += 1;
      compactLine = number;
      pointerRows.add(number);
      if (!isStringPointer(record, compactKey) || pointerValue(record) !== request.compactValue) invalidCompact = true;
    }
    scanRoot(scanner, record);
  });
  if (modelRows !== 1 || compactRows !== 1 || invalidModel || invalidCompact) return outputOf(POINTER_ROW_EXIT, [], [], []);
  if (starts === 0 && ends === 0 && !(request.requireRegion ?? false)) return outputOf(0, records, [], []);
  if (starts !== 1 || ends !== 1 || startLine >= endLine) return outputOf(POINTER_REGION_EXIT, [], [], []);
  if (modelLine < startLine && compactLine < startLine) return outputOf(0, records, [], []);
  const separatorLine = startLine - 1;
  const skippedSeparator = separatorLine > 0 && records[separatorLine - 1] === "" ? separatorLine : 0;
  const emitted = [];
  records.forEach((record, index) => {
    const number = index + 1;
    if (pointerRows.has(number) || number === skippedSeparator) return;
    if (number === startLine) {
      emitted.push(`${modelKey} = "${request.modelValue ?? ""}"`, `${compactKey} = "${request.compactValue ?? ""}"`);
    }
    emitted.push(record);
  });
  return outputOf(0, emitted, [], []);
}

// core/src/install/codex.ts
var CODEX_INSTALL_BACKUP_FORMAT = "oso-code-codex-install-v1";
var CODEX_REPAIR_BACKUP_FORMAT = "oso-code-codex-repair-v1";
var CODEX_PURGE_BACKUP_FORMAT = "oso-code-codex-purge-v1";
var OSO_OWNED_CONFIG_PATHS = [
  ["default_permissions"],
  ["agents"],
  ["shell_environment_policy", "set"],
  ["mcp_servers", "context7"],
  ["mcp_servers", "fallow"],
  ["permissions", "oso"]
];
function codexPathsFor(homeDirectory, environment) {
  const codexHome = environment["CODEX_HOME"] ?? path9.join(homeDirectory, ".codex");
  return {
    homeDirectory,
    codexHome,
    configFile: path9.join(codexHome, "config.toml"),
    globalFile: path9.join(codexHome, "AGENTS.md"),
    runtimeRoot: path9.join(homeDirectory, ".local", "share", "oso-code", "runtime"),
    agentsHome: path9.join(homeDirectory, ".agents"),
    marketplaceRoot: path9.join(homeDirectory, ".local", "share", "oso-code", "codex-marketplace"),
    backupsRoot: path9.join(homeDirectory, ".local", "state", "oso-code", "codex-backups")
  };
}
function managedFeaturesStatus(text) {
  const stripped = runTomlRegion(text, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END
  });
  if (stripped.exitCode !== 0) return "malformed";
  const extracted = runTomlRegion(text, {
    action: "extract",
    startMarker: FEATURE_MARKER_START,
    endMarker: FEATURE_MARKER_END,
    requireRegion: true
  });
  if (extracted.exitCode !== 0) return "missing";
  return extracted.stdout === renderCodexManagedFeatures() ? "valid" : "divergent";
}
function ownedKeyPathsOutsideTheRegion(unmanagedText, file) {
  const document = parseTomlDocument(unmanagedText, file);
  return OSO_OWNED_CONFIG_PATHS.filter((keyPath) => holdsKeyPath(document, keyPath)).map((keyPath) => keyPath.join("."));
}
function inspectCodexConfig(text, file) {
  const clean = runTomlRegion(text, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (clean.exitCode !== 0) return { kind: "malformed-markers" };
  const features = managedFeaturesStatus(clean.stdout);
  if (features === "malformed") return { kind: "malformed-features" };
  if (features === "divergent") return { kind: "divergent-features" };
  const withoutFeatures = runTomlRegion(clean.stdout, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END
  });
  if (withoutFeatures.exitCode !== 0) return { kind: "malformed-features" };
  try {
    parseTomlDocument(text, file);
    const owned = ownedKeyPathsOutsideTheRegion(withoutFeatures.stdout, file);
    const first = owned[0];
    if (first !== void 0) return { kind: "owned-key-outside-the-region", keyPath: first };
  } catch (error) {
    if (error instanceof TomlParseError) return { kind: "unparseable", detail: error.message };
    throw error;
  }
  return void 0;
}
function refusalMessage(refusal) {
  switch (refusal.kind) {
    case "malformed-markers":
      return "Codex config has malformed oso-code markers";
    case "malformed-features":
      return "Codex config has conflicting features ownership or malformed oso-code feature markers";
    case "divergent-features":
      return "Codex config has a divergent oso-code features region; it must contain only the published hooks and multi_agent values";
    case "unparseable":
      return refusal.detail;
    case "owned-key-outside-the-region":
      return `Codex config already defines the oso-code-owned key ${refusal.keyPath} outside the managed region`;
  }
}
function rebuildManagedConfig(existingText, targetHome, runtimeRoot, fallowCommand) {
  const clean = runTomlRegion(existingText, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (clean.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-markers" }));
  const withoutFeatures = runTomlRegion(clean.stdout, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END
  });
  if (withoutFeatures.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  const parts = runTomlRegion(withoutFeatures.stdout, { action: "split" });
  const featureBlock = `${FEATURE_MARKER_START}
${renderCodexManagedFeatures()}${FEATURE_MARKER_END}
`;
  const merged = runTomlRegion(parts.sections, { action: "features-merge", featureText: featureBlock });
  if (merged.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  return [
    withoutTrailingBlankLines(parts.root),
    parts.root === "" ? "" : "\n",
    `${CONFIG_MARKER_START}
`,
    renderCodexManagedConfig(targetHome, runtimeRoot, fallowCommand),
    `${CONFIG_MARKER_END}
`,
    merged.stdout === "" ? "" : "\n",
    merged.stdout
  ].join("");
}
function rebuildGlobalGuidance(existingText, body) {
  const clean = stripLineRegion(existingText, GLOBAL_MARKER_START, GLOBAL_MARKER_END);
  if (clean === void 0) throw new Error("global AGENTS.md has malformed oso-code markers");
  return [
    withoutTrailingBlankLines(clean),
    clean === "" ? "" : "\n",
    `${GLOBAL_MARKER_START}
`,
    body.endsWith("\n") || body === "" ? body : `${body}
`,
    `${GLOBAL_MARKER_END}
`
  ].join("");
}
function installCodex(input) {
  return withOwnerOnlyUmask(() => writeCodexInstall(input));
}
function writeCodexInstall(input) {
  if (!input.assumeYes) return requiresYesOutcome("install", "codex");
  const unpinned = pinnedVersionOutcome("install", input.host.version);
  if (unpinned !== void 0) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const refusal = configRefusalOf(paths.configFile);
  if (refusal !== void 0) return fatalOutcome("install", "codex", "the Codex config refuses this install", refusalMessage(refusal));
  if (existsAtAll(paths.globalFile) && !isRegularNonSymlinkFile(paths.globalFile)) {
    return fatalOutcome("install", "codex", "global AGENTS.md is not a regular file", paths.globalFile);
  }
  let tx;
  let capturedHooksPath = { captured: false, present: false, value: "" };
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_INSTALL_BACKUP_FORMAT);
    for (const { label, target } of backupCandidatesOf(paths)) backupTarget(tx, label, target);
    commitManifest(tx);
    capturedHooksPath = capturedGitHooksPath(input.repositoryRoot, input.environment);
  } catch (error) {
    return fatalOutcome("install", "codex", "could not create the pre-install backup", messageOf(error));
  }
  const infoLines = [`backup: ${tx.backupRoot}`];
  const wiring = [];
  const fallow = resolveFallowCommandFor(input, paths);
  wiring.push(
    fallow.resolved ? wiringOk("fallow (mcp)", fallow.command) : wiringFail("fallow (mcp)", "fallow-mcp is not installed; debt-sweep will use its rubric-only fallback")
  );
  try {
    writeManagedConfig(paths, fallow.command, input.host);
    wiring.push(wiringOk("managed config region", paths.configFile));
  } catch (error) {
    return rolledBack("install", "could not rewrite the managed Codex config region", error, tx, capturedHooksPath, input);
  }
  try {
    writeGlobalGuidance(paths, input.repositoryRoot);
    wiring.push(wiringOk("global AGENTS.md region", paths.globalFile));
  } catch (error) {
    return rolledBack("install", "could not rewrite global AGENTS.md", error, tx, capturedHooksPath, input);
  }
  if (input.installGitHook ?? true) {
    const wired = wireGitCommitHook2(input.repositoryRoot, paths.runtimeRoot, input.environment);
    if (!wired.ok) return rolledBack("install", "could not wire the git commit gate", new Error(wired.note), tx, capturedHooksPath, input);
    wiring.push(wired);
  } else infoLines.push("skipping the git commit hook (--no-git-hook)");
  if ((input.installImpeccable ?? true) === false) infoLines.push("skipping impeccable (--no-impeccable)");
  for (const backup of pruneInstallBackups(paths.backupsRoot, input.environment)) {
    infoLines.push(`backup retention: removed ${backup}`);
  }
  return { report: renderCommandReport("install", "codex", infoLines, wiring), exitCode: 0 };
}
function repairCodex(input) {
  if (!input.assumeYes) return requiresYesOutcome("repair", "codex");
  const unpinned = pinnedVersionOutcome("repair", input.host.version);
  if (unpinned !== void 0) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  let tx;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_REPAIR_BACKUP_FORMAT);
    backupTarget(tx, "config", paths.configFile);
    backupTarget(tx, "global", paths.globalFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("repair", "codex", "could not create the pre-repair backup", messageOf(error));
  }
  const infoLines = [`backup: ${tx.backupRoot}`];
  const wiring = [];
  wiring.push(normalizeEngramPointers(paths));
  const fallow = resolveFallowCommandFor(input, paths);
  try {
    writeManagedConfig(paths, fallow.command, input.host);
    wiring.push(wiringOk("managed config region", paths.configFile));
  } catch (error) {
    return rolledBack("repair", "could not rewrite the managed Codex config region", error, tx, NO_HOOKS_CAPTURE, input);
  }
  try {
    writeGlobalGuidance(paths, input.repositoryRoot);
    wiring.push(wiringOk("global AGENTS.md region", paths.globalFile));
  } catch (error) {
    return rolledBack("repair", "could not rewrite global AGENTS.md", error, tx, NO_HOOKS_CAPTURE, input);
  }
  return { report: renderCommandReport("repair", "codex", infoLines, wiring), exitCode: 0 };
}
function purgeCodex(input) {
  return withOwnerOnlyUmask(() => writeCodexPurge(input));
}
function writeCodexPurge(input) {
  if (!input.assumeYes) return requiresYesOutcome("purge", "codex");
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  if (paths.codexHome === path9.parse(paths.codexHome).root || input.homeDirectory === path9.parse(input.homeDirectory).root) {
    return fatalOutcome("purge", "codex", "refusing to purge a filesystem root", paths.codexHome);
  }
  let tx;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_PURGE_BACKUP_FORMAT);
    backupTarget(tx, "codex-home", paths.codexHome);
    backupTarget(tx, "agents-home", paths.agentsHome);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "codex", "could not create the pre-purge backup", messageOf(error));
  }
  const infoLines = [`backup: ${tx.backupRoot}`, "no login or installation command was run"];
  const wiring = [];
  for (const [component, target] of [
    ["Codex home", paths.codexHome],
    ["agents home", paths.agentsHome]
  ]) {
    if (!existsAtAll(target)) {
      wiring.push(wiringOk(component, "already absent"));
      continue;
    }
    try {
      rmSync7(target, { recursive: true, force: true });
      wiring.push(existsAtAll(target) ? wiringFail(component, `still present: ${target}`) : wiringOk(component, `removed ${target}`));
    } catch (error) {
      wiring.push(wiringFail(component, messageOf(error)));
    }
  }
  infoLines.push(`restore with: oso install --host codex --yes, or by hand from ${tx.backupRoot}`);
  return { report: renderCommandReport("purge", "codex", infoLines, wiring), exitCode: 0 };
}
function configRefusalOf(configFile) {
  if (existsAtAll(configFile) && !isRegularNonSymlinkFile(configFile)) return { kind: "unparseable", detail: `not a regular file: ${configFile}` };
  if (!isReadableRegularFile(configFile)) return void 0;
  return inspectCodexConfig(readFileSync9(configFile, "utf8"), configFile);
}
function writeManagedConfig(paths, fallowCommand, host) {
  const existing = isReadableRegularFile(paths.configFile) ? readFileSync9(paths.configFile, "utf8") : "";
  const rebuilt = rebuildManagedConfig(existing, paths.homeDirectory, paths.runtimeRoot, fallowCommand);
  mkdirSync6(paths.codexHome, { recursive: true });
  if (!host.acceptsConfig(paths.codexHome, rebuilt)) throw new Error(HOST_REJECTED_CONFIG);
  writeFileSync7(paths.configFile, rebuilt, { mode: 384 });
}
function writeGlobalGuidance(paths, repositoryRoot2) {
  const existing = isReadableRegularFile(paths.globalFile) ? readFileSync9(paths.globalFile, "utf8") : "";
  const body = readFileSync9(path9.join(repositoryRoot2, "bootstrap", "codex-global.md"), "utf8");
  mkdirSync6(paths.codexHome, { recursive: true });
  writeFileSync7(paths.globalFile, rebuildGlobalGuidance(existing, body), { mode: 384 });
}
function normalizeEngramPointers(paths) {
  if (!isReadableRegularFile(paths.configFile)) return wiringFail("engram pointers", `no config at ${paths.configFile}`);
  const text = readFileSync9(paths.configFile, "utf8");
  const moved = runTomlRegion(text, {
    action: "engram-pointers",
    startMarker: CONFIG_MARKER_START,
    endMarker: CONFIG_MARKER_END,
    modelKey: MODEL_INSTRUCTIONS_KEY,
    compactKey: COMPACT_PROMPT_KEY,
    modelValue: path9.join(paths.codexHome, "engram-instructions.md"),
    compactValue: path9.join(paths.codexHome, "engram-compact-prompt.md"),
    requireRegion: true
  });
  if (moved.exitCode === 10) return wiringFail("engram pointers", "the Codex config markers are missing or malformed");
  if (moved.exitCode !== 0) return wiringFail("engram pointers", "Engram's instruction pointers are missing, duplicated, or unexpected");
  if (moved.stdout === text) return wiringOk("engram pointers", "already normalized");
  writeFileSync7(paths.configFile, moved.stdout, { mode: 384 });
  return wiringOk("engram pointers", "moved above the managed region");
}
function wireGitCommitHook2(repositoryRoot2, runtimeRoot, environment) {
  const hooksPath = path9.join(runtimeRoot, "git-hooks");
  const run = spawnSync5("git", ["-C", repositoryRoot2, "config", "--local", "core.hooksPath", hooksPath], { env: environment, encoding: "utf8" });
  if (run.error !== void 0 || run.status !== 0) return wiringFail("git commit hook", `${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  return wiringOk("git commit hook", `core.hooksPath=${hooksPath}`);
}
function resolveFallowCommandFor(input, paths) {
  return resolveFallowMcpCommand2(
    paths.homeDirectory,
    input.environment,
    () => npmGlobalPrefix2(input.environment),
    (name) => firstExecutableOnPath(input.environment, name)
  );
}
function npmGlobalPrefix2(environment) {
  const run = spawnSync5("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (run.error !== void 0 || run.status !== 0) return void 0;
  const value = run.stdout.trim();
  return value === "" ? void 0 : value;
}
function backupCandidatesOf(paths) {
  return [
    { label: "config", target: paths.configFile },
    { label: "global", target: paths.globalFile },
    { label: "hooks-manifest", target: path9.join(paths.codexHome, "hooks.json") },
    { label: "agents", target: path9.join(paths.codexHome, "agents") },
    { label: "runtime", target: paths.runtimeRoot }
  ];
}
function rolledBack(verb, summary, error, tx, hooksPath, input) {
  const restore = rollback(tx);
  const hooks = restoreGitHooksPath(hooksPath, input.repositoryRoot, input.environment);
  return fatalOutcome(verb, "codex", summary, messageOf(error), restoreNoteOf(bothRestored(restore, hooks)));
}
var HOST_REJECTED_CONFIG = "Codex rejected the merged config; the original config is unchanged";
var NO_HOOKS_CAPTURE = { captured: false, present: false, value: "" };
var NOTHING_LEFT_TO_RESTORE = { failedCount: 0, failedItems: [] };
var GIT_CONFIG_UNSET_MATCHED_NOTHING = 5;
function pinnedVersionOutcome(verb, found) {
  if (meetsVersionFloor(found, SUPPORTED_CODEX_VERSION)) return void 0;
  return fatalOutcome(verb, "codex", "the installed Codex CLI is not the pinned one", pinnedVersionRefusal(found));
}
function capturedGitHooksPath(repositoryRoot2, environment) {
  const inRepository = gitRun(repositoryRoot2, environment, ["rev-parse", "--git-dir"]);
  if (inRepository.status !== 0) return NO_HOOKS_CAPTURE;
  const configured = gitRun(repositoryRoot2, environment, ["config", "--local", "--get", "core.hooksPath"]);
  return configured.status === 0 ? { captured: true, present: true, value: configured.stdout.trim() } : { captured: true, present: false, value: "" };
}
function restoreGitHooksPath(capture, repositoryRoot2, environment) {
  if (!capture.captured) return NOTHING_LEFT_TO_RESTORE;
  const argv = capture.present ? ["config", "--local", "core.hooksPath", capture.value] : ["config", "--local", "--unset-all", "core.hooksPath"];
  const { status } = gitRun(repositoryRoot2, environment, argv);
  const restored = status === 0 || !capture.present && status === GIT_CONFIG_UNSET_MATCHED_NOTHING;
  return restored ? NOTHING_LEFT_TO_RESTORE : { failedCount: 1, failedItems: [`core.hooksPath in ${repositoryRoot2}`] };
}
function bothRestored(transaction, hooks) {
  return {
    failedCount: transaction.failedCount + hooks.failedCount,
    failedItems: [...transaction.failedItems, ...hooks.failedItems]
  };
}
function gitRun(repositoryRoot2, environment, argv) {
  const run = spawnSync5("git", ["-C", repositoryRoot2, ...argv], { env: environment, encoding: "utf8" });
  return { status: run.error === void 0 ? run.status ?? 1 : 1, stdout: run.stdout ?? "" };
}
function stripLineRegion(text, start, end) {
  const kept = [];
  let inside = false;
  let seenStart = 0;
  let seenEnd = 0;
  for (const line of text === "" ? [] : text.replace(/\n$/, "").split("\n")) {
    if (line === start) {
      if (inside) return void 0;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (line === end) {
      if (!inside) return void 0;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (!inside) kept.push(line);
  }
  if (inside || seenStart !== seenEnd || seenStart > 1) return void 0;
  return kept.length === 0 ? "" : `${kept.join("\n")}
`;
}
var FIELDLESS_LINE = /^[ \t]*$/;
function withoutTrailingBlankLines(text) {
  if (text === "") return "";
  const lines = text.replace(/\n$/, "").split("\n");
  let last = lines.length;
  while (last > 0 && FIELDLESS_LINE.test(lines[last - 1] ?? "")) last -= 1;
  return last === 0 ? "" : `${lines.slice(0, last).join("\n")}
`;
}
function holdsKeyPath(document, keyPath) {
  let cursor = document;
  for (const key of keyPath) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
    if (!Object.hasOwn(cursor, key)) return false;
    cursor = cursor[key];
  }
  return true;
}

// core/src/install/opencode.ts
import { readFileSync as readFileSync10 } from "node:fs";
import path10 from "node:path";

// core/src/install/opencode-config.ts
var OPENCODE_CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";
var CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";
var OWNED_SKILL_MODES = ["oso-plan", "oso-quick", "oso-debug", "oso-roadmap"];
var OWNED_SKILL_VERDICT = "deny";
var OWNED_TASK_PATTERN = "*";
var OWNED_TASK_VERDICT = "allow";
var OWNED_PERMISSION_VALUES = {
  question: "allow",
  plan_enter: "allow",
  plan_exit: "allow",
  oso_plan_approve: "ask",
  oso_plan_cancel: "ask"
};
var OWNED_MCP_NAMES = ["context7", "engram", "fallow"];
var SCHEMA_KEY = "$schema";
var PLUGIN_KEY = "plugin";
var PERMISSION_KEY = "permission";
var MCP_KEY = "mcp";
var SKILL_KEY = "skill";
var TASK_KEY = "task";
var NEVER_PRESERVED_KEYS = [PERMISSION_KEY, MCP_KEY, PLUGIN_KEY];
var OpenCodeConfigRefusal = class extends Error {
  reason;
  constructor(reason) {
    super(refusalMessage2(reason));
    this.name = "OpenCodeConfigRefusal";
    this.reason = reason;
  }
};
function ownedMcpServers(fallowCommand) {
  return {
    context7: { type: "remote", url: CONTEXT7_MCP_URL, enabled: true },
    engram: { type: "local", command: ["engram", "mcp", "--tools=agent"], enabled: true, environment: {} },
    fallow: { type: "local", command: [fallowCommand], enabled: true, environment: {} }
  };
}
function mergeOpenCodeConfig(existing, fallowCommand) {
  const document = parsedConfigObject(existing);
  const preservedKeys = Object.keys(document).filter((key) => !NEVER_PRESERVED_KEYS.includes(key));
  insertIfMissing(document, SCHEMA_KEY, OPENCODE_CONFIG_SCHEMA_URL);
  createPluginArrayIfAbsent(document);
  const permission = ownedContainer(document, PERMISSION_KEY);
  preservedKeys.push(
    ...Object.keys(permission).filter((name) => !(name in OWNED_PERMISSION_VALUES) && name !== SKILL_KEY && name !== TASK_KEY).map((name) => `${PERMISSION_KEY}.${name}`)
  );
  const skills = ownedContainer(permission, SKILL_KEY);
  preservedKeys.push(
    ...Object.keys(skills).filter((name) => !OWNED_SKILL_MODES.includes(name)).map((name) => `${PERMISSION_KEY}.${SKILL_KEY}.${name}`)
  );
  for (const mode of OWNED_SKILL_MODES) skills[mode] = OWNED_SKILL_VERDICT;
  const delegations = ownedContainer(permission, TASK_KEY);
  preservedKeys.push(
    ...Object.keys(delegations).filter((pattern) => pattern !== OWNED_TASK_PATTERN).map((pattern) => `${PERMISSION_KEY}.${TASK_KEY}.${pattern}`)
  );
  delegations[OWNED_TASK_PATTERN] = OWNED_TASK_VERDICT;
  Object.assign(permission, OWNED_PERMISSION_VALUES);
  const servers = ownedContainer(document, MCP_KEY);
  const owned = ownedMcpServers(fallowCommand);
  preservedKeys.push(
    ...Object.keys(servers).filter((name) => !(name in owned)).map((name) => `${MCP_KEY}.${name}`)
  );
  for (const [name, declaration] of Object.entries(owned)) insertIfMissing(servers, name, declaration);
  return { document, preservedKeys };
}
function hostContractViolationOf(document) {
  if (!isPlainObject(document)) return "the rendered config is not a JSON object";
  if (!Array.isArray(document[PLUGIN_KEY])) return "plugin must be an array";
  const permission = isPlainObject(document[PERMISSION_KEY]) ? document[PERMISSION_KEY] : {};
  if (permission["oso_plan_approve"] !== "ask") return "the plan approval tool must carry permission ask";
  if (permission["oso_plan_cancel"] !== "ask") return "the plan cancel tool must carry permission ask";
  const servers = isPlainObject(document[MCP_KEY]) ? document[MCP_KEY] : {};
  for (const name of OWNED_MCP_NAMES) {
    if (!declaresAnything(servers[name])) return `${name} MCP server is missing`;
  }
  for (const [name, server] of Object.entries(servers)) {
    if (!isPlainObject(server)) return `malformed MCP server: ${name}`;
    if ("env" in server) return `MCP server uses the env key, not environment: ${name}`;
  }
  return void 0;
}
function refusalMessage2(reason) {
  switch (reason.kind) {
    case "config-not-an-object":
      return "the existing opencode.json is not a JSON object";
    case "owned-container-not-an-object":
      return `the existing opencode.json holds a non-object "${reason.key}"; fix it and re-run`;
    case "plugin-not-an-array":
      return `the existing opencode.json holds a non-array "${PLUGIN_KEY}"; fix it and re-run`;
  }
}
function parsedConfigObject(existing) {
  if (existing === void 0) return {};
  if (!isPlainObject(existing)) throw new OpenCodeConfigRefusal({ kind: "config-not-an-object" });
  return existing;
}
function createPluginArrayIfAbsent(document) {
  const plugins = document[PLUGIN_KEY];
  if (plugins === void 0 || plugins === null) {
    document[PLUGIN_KEY] = [];
    return;
  }
  if (!Array.isArray(plugins)) throw new OpenCodeConfigRefusal({ kind: "plugin-not-an-array" });
}
function ownedContainer(container, key) {
  const value = container[key];
  if (value === void 0 || value === null) {
    const created = {};
    container[key] = created;
    return created;
  }
  if (!isPlainObject(value)) throw new OpenCodeConfigRefusal({ kind: "owned-container-not-an-object", key });
  return value;
}
function insertIfMissing(container, key, value) {
  if (key in container) return;
  container[key] = value;
}
function declaresAnything(value) {
  if (value === void 0 || value === null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// core/src/install/opencode.ts
var OPENCODE_INSTALL_BACKUP_FORMAT = "oso-code-opencode-install-v1";
var OPENCODE_INSTALL_BACKUP_LABEL = "commands";
var CONFIG_BACKUP_LABEL = "config";
var GLOBAL_MARKER_START2 = "<!-- oso-code:start -->";
var GLOBAL_MARKER_END2 = "<!-- oso-code:end -->";
var AWK_BLANK_LINE = /^[ \t]*$/;
var REPAIRABLE_NESTED_PATHS = [["permission"], ["permission", "skill"], ["permission", "task"], ["mcp"]];
function opencodePathsFor(homeDirectory, environment) {
  const configHome = path10.join(environment["XDG_CONFIG_HOME"] ?? path10.join(homeDirectory, ".config"), "opencode");
  const stateRoot = path10.join(homeDirectory, ".local", "state", "oso-code");
  return {
    homeDirectory,
    configHome,
    configFile: path10.join(configHome, "opencode.json"),
    globalFile: path10.join(configHome, "AGENTS.md"),
    stateRoot,
    backupsRoot: stateRoot
  };
}
function configHomeRefusal(homeDirectory, environment, verb) {
  const configuredHome = environment["XDG_CONFIG_HOME"];
  if (configuredHome === void 0 || configuredHome === "" || configuredHome === path10.join(homeDirectory, ".config")) return void 0;
  return {
    kind: "usage",
    message: `XDG_CONFIG_HOME (${configuredHome}) is not the default for HOME (${path10.join(homeDirectory, ".config")}), so this ${verb} would write outside the home it was pointed at; unset it or point both at the same account`
  };
}
function configFileRefusal(configFile) {
  if (existsAtAll(configFile) && !isRegularNonSymlinkFile(configFile)) {
    return { kind: "fatal", message: `OpenCode config is not a regular file: ${configFile}` };
  }
  if (!isReadableRegularFile(configFile)) return void 0;
  if (readableJsonDocument(configFile) !== void 0) return void 0;
  return { kind: "fatal", message: `the existing OpenCode config is not valid JSON: ${configFile} (back it up and fix it, then re-run)` };
}
function globalFileRefusal(globalFile) {
  if (existsAtAll(globalFile) && !isRegularNonSymlinkFile(globalFile)) {
    return { kind: "fatal", message: `the global guidance file is not a regular file: ${globalFile}` };
  }
  if (!isReadableRegularFile(globalFile)) return void 0;
  if (withoutOpenCodeMarkerRegion(readFileSync10(globalFile, "utf8")).kind === "clean") return void 0;
  return { kind: "fatal", message: malformedMarkersMessage(globalFile) };
}
function withoutOpenCodeMarkerRegion(content) {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const kept = [];
  let inside = false;
  let regions = 0;
  for (const record of records) {
    if (record === GLOBAL_MARKER_START2) {
      if (inside) return { kind: "malformed" };
      inside = true;
      regions += 1;
      continue;
    }
    if (record === GLOBAL_MARKER_END2) {
      if (!inside) return { kind: "malformed" };
      inside = false;
      continue;
    }
    if (!inside) kept.push(record);
  }
  if (inside || regions > 1) return { kind: "malformed" };
  return { kind: "clean", text: kept.length === 0 ? "" : `${kept.join("\n")}
` };
}
function renderGlobalAgents(strippedContent, blockBody) {
  const separator = strippedContent === "" ? "" : "\n";
  return `${withoutTrailingBlankLines2(strippedContent)}${separator}${GLOBAL_MARKER_START2}
${blockBody}${GLOBAL_MARKER_END2}
`;
}
function mergeGlobalAgents(globalFile, blockBody) {
  const existing = isReadableRegularFile(globalFile) ? readFileSync10(globalFile, "utf8") : "";
  const stripped = withoutOpenCodeMarkerRegion(existing);
  if (stripped.kind === "malformed") throw new Error(malformedMarkersMessage(globalFile));
  writeFileAtomically(path10.dirname(globalFile), globalFile, renderGlobalAgents(stripped.text, blockBody), ".oso-agents-md-");
}
function snapshotsHoldingAConfig(backupsRoot) {
  return installBackupsDeclaring(backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL).filter(
    (backup) => isReadableRegularFile(recordedConfigOf(backup))
  );
}
function keysRecordedButMissing(recorded, live) {
  const restorable = [];
  for (const nested of [[], ...REPAIRABLE_NESTED_PATHS]) {
    const recordedAt = objectAt(recorded, nested);
    const liveAt = objectAt(live, nested);
    for (const [name, value] of Object.entries(recordedAt)) {
      if (name in liveAt) continue;
      if (namesANestedContainer([...nested, name])) continue;
      restorable.push({ keyPath: [...nested, name].join("."), value });
    }
  }
  return restorable;
}
function restoreBlockedBy(live, restorable) {
  for (const { keyPath } of restorable) {
    const names = keyPath.split(".");
    let cursor = live;
    for (const name of names.slice(0, -1)) {
      const next = cursor[name];
      if (next !== void 0 && next !== null && !isPlainObject(next)) return keyPath;
      cursor = isPlainObject(next) ? next : {};
    }
  }
  return void 0;
}
function withRestoredKeys(live, restorable) {
  for (const { keyPath, value } of restorable) {
    const names = keyPath.split(".");
    let target = live;
    for (const name of names.slice(0, -1)) {
      const existing = target[name];
      if (isPlainObject(existing)) {
        target = existing;
        continue;
      }
      const created = {};
      target[name] = created;
      target = created;
    }
    target[names.at(-1)] = value;
  }
  return live;
}
function repairOpenCode(input) {
  const paths = opencodePathsFor(input.homeDirectory, input.environment);
  const homeRefusal = configHomeRefusal(input.homeDirectory, input.environment, "repair");
  if (homeRefusal !== void 0) return usageErrorOutcome("repair", "opencode", homeRefusal.message);
  if (input.listBackups === true) return backupListingOutcome(paths.backupsRoot);
  const live = liveConfigOf(paths.configFile);
  if (live.kind === "unreadable") return fatalOutcome("repair", "opencode", "cannot read the OpenCode config", live.message);
  const snapshot = resolveSnapshot(paths.backupsRoot, input.backupName);
  if (snapshot.kind === "unusable") return fatalOutcome("repair", "opencode", "cannot read a recorded config", snapshot.message);
  const snapshotName = path10.basename(snapshot.directory);
  const restorable = keysRecordedButMissing(snapshot.recorded, live.document);
  if (restorable.length === 0) {
    const settled = `nothing to repair: ${paths.configFile} already holds every key ${snapshotName} recorded`;
    return snapshotOutcome(snapshotName, [], settled);
  }
  const blocked = restoreBlockedBy(live.document, restorable);
  if (blocked !== void 0) {
    const detail = `${paths.configFile} holds a non-object where ${blocked} would be written back`;
    return fatalOutcome("repair", "opencode", "cannot write a recorded key back", detail);
  }
  if (!input.assumeYes) return requiresYesOutcome("repair", "opencode");
  writeJsonFile(paths.configFile, withRestoredKeys(live.document, restorable));
  const namedKeys = [
    `these keys are in ${snapshotName} and missing from ${paths.configFile}:`,
    ...restorable.map(({ keyPath, value }) => `  ${keyPath} = ${JSON.stringify(value)}`),
    "restart OpenCode to load the repaired config"
  ];
  return snapshotOutcome(snapshotName, namedKeys, `returned ${restorable.length} key(s) to ${paths.configFile}`);
}
function snapshotOutcome(snapshotName, infoLines, note) {
  const lines = [`snapshot: ${snapshotName}`, ...infoLines];
  return { report: renderCommandReport("repair", "opencode", lines, [wiringOk("operator config keys", note)]), exitCode: 0 };
}
function backupListingOutcome(backupsRoot) {
  const snapshots = snapshotsHoldingAConfig(backupsRoot);
  const listing = snapshots.map((backup) => `${path10.basename(backup)}	${backupSizeKib(backup)} KiB`);
  const note = snapshots.length === 0 ? `no OpenCode install backup under ${backupsRoot} holds a config to repair from` : `${snapshots.length} snapshot(s) under ${backupsRoot}`;
  return { report: renderCommandReport("repair", "opencode", listing, [wiringOk("install backups holding a config", note)]), exitCode: 0 };
}
function liveConfigOf(configFile) {
  if (!isReadableRegularFile(configFile)) {
    return { kind: "unreadable", message: `there is no OpenCode config to repair at ${configFile}` };
  }
  const document = readableJsonDocument(configFile);
  if (document === void 0) return { kind: "unreadable", message: `the live OpenCode config is not valid JSON: ${configFile}` };
  return { kind: "readable", document };
}
function resolveSnapshot(backupsRoot, backupName) {
  const located = backupName === void 0 ? newestSnapshot(backupsRoot) : namedSnapshot(backupsRoot, backupName);
  if (located.kind === "unusable") return located;
  const recorded = readableJsonDocument(recordedConfigOf(located.directory));
  if (recorded === void 0) {
    return {
      kind: "unusable",
      message: `the config recorded in ${located.directory} is not valid JSON, so nothing can be read back from it`
    };
  }
  return { kind: "usable", directory: located.directory, recorded };
}
function newestSnapshot(backupsRoot) {
  const newest = snapshotsHoldingAConfig(backupsRoot)[0];
  if (newest === void 0) {
    return { kind: "unusable", message: `no OpenCode install backup under ${backupsRoot} holds a config to repair from` };
  }
  return { kind: "located", directory: newest };
}
function namedSnapshot(backupsRoot, backupName) {
  if (backupName.includes("/") || backupName === "." || backupName === "..") {
    return { kind: "unusable", message: `backup name must be a bare directory name: ${backupName}` };
  }
  const directory = path10.join(backupsRoot, backupName);
  if (!installBackupDeclares(directory, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL)) {
    return { kind: "unusable", message: `not an OpenCode install backup: ${directory}` };
  }
  if (!isReadableRegularFile(recordedConfigOf(directory))) {
    return { kind: "unusable", message: `that backup holds no opencode.json to repair from: ${directory}` };
  }
  return { kind: "located", directory };
}
function recordedConfigOf(backup) {
  return path10.join(backup, "items", CONFIG_BACKUP_LABEL);
}
function readableJsonDocument(file) {
  try {
    const value = readJsonFile(file);
    return isPlainObject(value) ? value : void 0;
  } catch (error) {
    if (error instanceof JsonParseError) return void 0;
    throw error;
  }
}
function objectAt(document, keyPath) {
  let cursor = document;
  for (const name of keyPath) {
    cursor = isPlainObject(cursor) ? cursor[name] : void 0;
    if (!isPlainObject(cursor)) return {};
  }
  return isPlainObject(cursor) ? cursor : {};
}
function namesANestedContainer(keyPath) {
  return REPAIRABLE_NESTED_PATHS.some((nested) => nested.length === keyPath.length && nested.every((name, index) => name === keyPath[index]));
}
function withoutTrailingBlankLines2(content) {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  while (records.length > 0 && AWK_BLANK_LINE.test(records.at(-1))) records.pop();
  return records.length === 0 ? "" : `${records.join("\n")}
`;
}
function malformedMarkersMessage(globalFile) {
  return `the existing global guidance has malformed oso-code markers: ${globalFile} (repair the marker pair, then re-run)`;
}

// core/src/install/opencode-host.ts
import { spawnSync as spawnSync6 } from "node:child_process";
import { mkdtempSync as mkdtempSync4, rmSync as rmSync8 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import path11 from "node:path";
var OPENCODE_BINARY_NAME = "opencode";
var PROBE_HOME_PREFIX = "oso-opencode-probe.";
var ANSI_SELECT_GRAPHIC_RENDITION = /\u001b\[[0-9;]*m/g;
var POSIX_SPACE_CLASS = /[ \t\n\v\f\r]/g;
function openCodeHostProbes(environment) {
  const binaryPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  return { version: binaryPath === void 0 ? void 0 : probedVersion2(environment, binaryPath) };
}
function versionFieldOf(probeOutput) {
  return probeOutput.replace(ANSI_SELECT_GRAPHIC_RENDITION, "").replace(POSIX_SPACE_CLASS, "");
}
function probedVersion2(environment, binaryPath) {
  const probeHome = mkdtempSync4(path11.join(environment["TMPDIR"] ?? tmpdir3(), PROBE_HOME_PREFIX));
  try {
    const run = spawnSync6(binaryPath, ["--version"], { env: probeEnvironment2(environment, probeHome), encoding: "utf8" });
    return versionFieldOf(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  } finally {
    rmSync8(probeHome, { recursive: true, force: true });
  }
}
function probeEnvironment2(environment, probeHome) {
  return {
    ...environment,
    HOME: probeHome,
    USERPROFILE: probeHome,
    TMPDIR: probeHome,
    XDG_CONFIG_HOME: path11.join(probeHome, ".config"),
    XDG_STATE_HOME: path11.join(probeHome, ".local", "state"),
    XDG_CACHE_HOME: path11.join(probeHome, ".cache"),
    XDG_DATA_HOME: path11.join(probeHome, ".local", "share")
  };
}

// core/src/install/opencode-install.ts
import { chmodSync as chmodSync2, cpSync as cpSync2, lstatSync as lstatSync3, mkdirSync as mkdirSync7, mkdtempSync as mkdtempSync5, readdirSync as readdirSync4, readFileSync as readFileSync12, renameSync as renameSync3, rmSync as rmSync9, writeFileSync as writeFileSync8 } from "node:fs";
import { spawnSync as spawnSync7 } from "node:child_process";
import path13 from "node:path";

// core/src/install/opencode-trust.ts
import { readFileSync as readFileSync11 } from "node:fs";
import path12 from "node:path";
var OPENCODE_TRUST_FILE_COUNT = 19;
var CODEX_TRUST_PREFIX = "codex/";
var INSTALLED_TREE_MAP = [
  { published: "opencode/dist/oso-code.js", installed: "plugin/oso-code.js" },
  { published: "plugin/dist/", installed: "dist/" },
  { published: "plugin/hooks/", installed: "hooks/" },
  { published: "plugin/git-hooks/", installed: "git-hooks/" },
  { published: "plugin/bin/", installed: "bin/" }
];
function openCodeTrustTargetUnder(rootKind, root, published) {
  if (rootKind === "source") return path12.join(root, ...published.split("/"));
  const mapped = INSTALLED_TREE_MAP.find((row) => row.published === published || row.published.endsWith("/") && published.startsWith(row.published));
  if (mapped === void 0) return void 0;
  const relative = mapped.published.endsWith("/") ? `${mapped.installed}${published.slice(mapped.published.length)}` : mapped.installed;
  return path12.join(root, ...relative.split("/"));
}
function openCodeTrustReading(manifestFile, rootKind, root) {
  return {
    filesRead: openCodeTrustedFiles(manifestFile).length,
    divergences: trustDivergences(manifestFile, isCodexTrustFile, (published) => openCodeTrustTargetUnder(rootKind, root, published))
  };
}
function publishedGateScriptNames(manifestFile) {
  return openCodeTrustedFiles(manifestFile).filter((published) => published.startsWith("plugin/hooks/") && published.endsWith(".sh")).map((published) => published.slice("plugin/hooks/".length));
}
function publishedDistFileNames(manifestFile) {
  return openCodeTrustedFiles(manifestFile).filter((published) => published.startsWith("plugin/dist/")).map((published) => published.slice("plugin/dist/".length));
}
function trustDivergenceLine(divergence) {
  const state = divergence.state;
  return `${divergence.file} ${state.kind === "mismatch" ? state.actual : state.kind}`;
}
function openCodeTrustedFiles(manifestFile) {
  if (!isReadableRegularFile(manifestFile)) return [];
  return parseTrustManifest(readFileSync11(manifestFile, "utf8")).map((row) => row.file).filter((file) => !isCodexTrustFile(file));
}
function isCodexTrustFile(published) {
  return published.startsWith(CODEX_TRUST_PREFIX);
}

// core/src/install/opencode-install.ts
var OWNER_INSTALLER = "installer";
var OWNER_OPERATOR = "operator";
var EXPECTED_SKILL_WRAPPER_COUNT = 9;
var PRESERVED_KEYS_FILE = "operator-preserved-keys";
var PRIVATE_FILE_MODE = 384;
var EXECUTABLE_FILE_MODE = 448;
var OWNER_ONLY_MASK = 4032;
var MIGRATED_SESSION_PATTERN = /^ses[A-Za-z0-9]+$/;
var AGENT_IDENTITY_LENGTH = 16;
var ENGRAM_BINARY_NAME = "engram";
var FALLOW_FALLBACK_COMMAND2 = "fallow-mcp";
function openCodeInstallTargets(paths) {
  return {
    skills: path13.join(paths.configHome, "skill"),
    agents: path13.join(paths.configHome, "agent"),
    commands: path13.join(paths.configHome, "command"),
    plugin: path13.join(paths.configHome, "plugin"),
    hooks: path13.join(paths.configHome, "hooks"),
    gitHooks: path13.join(paths.configHome, "git-hooks"),
    stateBin: path13.join(paths.configHome, "bin"),
    dist: path13.join(paths.configHome, "dist"),
    engramPlugin: path13.join(paths.configHome, "plugins", "engram.ts"),
    impeccableMount: path13.join(paths.homeDirectory, ".agents", "skills", "impeccable"),
    impeccableOptOut: path13.join(paths.stateRoot, "impeccable-opt-out"),
    ownerRegistry: path13.join(paths.stateRoot, "opencode-install-registry"),
    restoreExercisedMarker: path13.join(paths.stateRoot, ".install-restore-verified-opencode"),
    planArtifactRoot: path13.join(paths.stateRoot, "plans")
  };
}
function openCodePayloadSources(repositoryRoot2) {
  return {
    skills: path13.join(repositoryRoot2, "opencode", "skills"),
    sharedSkills: path13.join(repositoryRoot2, "plugin", "skills", "_shared"),
    agents: path13.join(repositoryRoot2, "opencode", "agents"),
    commands: path13.join(repositoryRoot2, "opencode", "commands"),
    pluginBundle: path13.join(repositoryRoot2, "opencode", "dist", "oso-code.js"),
    gates: path13.join(repositoryRoot2, "plugin", "hooks"),
    gitHook: path13.join(repositoryRoot2, "plugin", "git-hooks", "pre-commit"),
    stateBin: path13.join(repositoryRoot2, "plugin", "bin", "oso-state"),
    stateBinPackage: path13.join(repositoryRoot2, "plugin", "bin", "package.json"),
    dist: path13.join(repositoryRoot2, "plugin", "dist"),
    global: path13.join(repositoryRoot2, "bootstrap", "opencode-global.md"),
    publishedHashes: path13.join(repositoryRoot2, "bootstrap", "hook-hashes.txt")
  };
}
function payloadRefusal(sources) {
  const missing = [
    { present: isReadableRegularFile(sources.global), message: `the OpenCode global guidance is missing: ${sources.global}` },
    { present: isDirectory(sources.skills), message: `the OpenCode skill wrappers are missing: ${sources.skills}` },
    { present: isDirectory(sources.sharedSkills), message: `the shared skill bodies are missing: ${sources.sharedSkills}` },
    { present: isDirectory(sources.agents), message: `the OpenCode agent contracts are missing: ${sources.agents}` },
    { present: isDirectory(sources.commands), message: `the OpenCode command templates are missing: ${sources.commands}` },
    { present: isReadableRegularFile(sources.pluginBundle), message: `the OpenCode plugin bundle is missing: ${sources.pluginBundle}` },
    { present: isDirectory(sources.gates), message: `the shared gate script tree is missing: ${sources.gates}` },
    { present: isReadableRegularFile(path13.join(sources.gates, "lib.sh")), message: `the shared gate library is missing: ${path13.join(sources.gates, "lib.sh")}` },
    { present: isReadableRegularFile(path13.join(sources.gates, "lexer.sh")), message: `the shared gate lexer is missing: ${path13.join(sources.gates, "lexer.sh")}` },
    { present: isReadableRegularFile(sources.gitHook), message: `the shared commit hook is missing: ${sources.gitHook}` },
    { present: isReadableRegularFile(sources.stateBin), message: `the oso-state binary is missing: ${sources.stateBin}` },
    { present: isReadableRegularFile(sources.stateBinPackage), message: `the oso-state module manifest is missing: ${sources.stateBinPackage}` }
  ].find((row) => !row.present);
  if (missing !== void 0) return missing.message;
  const wrappers = skillWrapperNames(sources.skills).length;
  if (wrappers !== EXPECTED_SKILL_WRAPPER_COUNT) {
    return `expected exactly ${EXPECTED_SKILL_WRAPPER_COUNT} OpenCode skill wrappers (found ${wrappers})`;
  }
  if (agentContractNames(sources.agents).length === 0) return `no OpenCode agent contracts found under ${sources.agents}`;
  return void 0;
}
function trustBytesRefusal(publishedHashes, rootKind, root) {
  const reading = openCodeTrustReading(publishedHashes, rootKind, root);
  if (reading.divergences.length > 0) {
    return `${rootKind} gate bytes do not match the published hashes: ${reading.divergences.map(trustDivergenceLine).join(";")}`;
  }
  if (reading.filesRead !== OPENCODE_TRUST_FILE_COUNT) {
    return `the published manifest must cover exactly ${OPENCODE_TRUST_FILE_COUNT} OpenCode trust files (found ${reading.filesRead})`;
  }
  return void 0;
}
function unpublishedInstalledGates(publishedHashes, hooksTarget) {
  const published = new Set(publishedGateScriptNames(publishedHashes));
  return directoryEntryNames(hooksTarget).filter((name) => name.endsWith(".sh") && isReadableRegularFile(path13.join(hooksTarget, name))).filter((name) => !published.has(name));
}
function installOpenCode(input) {
  return withOwnerOnlyUmask(() => writeOpenCodeInstall(input));
}
function writeOpenCodeInstall(input) {
  const paths = opencodePathsFor(input.homeDirectory, input.environment);
  const targets = openCodeInstallTargets(paths);
  const sources = openCodePayloadSources(input.repositoryRoot);
  const refused = installRefusal(input, paths, sources);
  if (refused !== void 0) return refused;
  let tx;
  try {
    tx = beginTransaction(paths.backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT);
    for (const { label, target } of backupCandidatesOf2(paths, targets)) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("install", "opencode", "could not create the pre-install backup", messageOf(error));
  }
  const infoLines = [`backup: ${tx.backupRoot}`];
  const wiring = [];
  try {
    infoLines.push(...migrateOpenCodeState(paths, targets, tx));
    installPayloadTrees(paths, targets, sources);
    wiring.push(wiringOk("installed payload", `${targets.skills}, ${targets.agents}, ${targets.commands}, ${targets.plugin}`));
    wiring.push(publishedGateBytesEntry(sources.publishedHashes, paths.configHome, targets.hooks));
    mergeGlobalAgents(paths.globalFile, readFileSync12(sources.global, "utf8"));
    wiring.push(wiringOk("global AGENTS.md region", paths.globalFile));
    wiring.push(wireEngram(input.environment, targets.engramPlugin, tx));
    wiring.push(renderOpenCodeConfig(input, paths, tx));
    wiring.push(...impeccableEntries(input, targets));
    writeOwnerRegistry(paths, targets, tx);
    wiring.push(wiringOk("installed-target owner registry", targets.ownerRegistry));
  } catch (error) {
    return fatalOutcome("install", "opencode", "the OpenCode install failed", messageOf(error), restoreNoteOf(rollback(tx)));
  }
  wiring.push(...gitHookEntries(input, targets));
  for (const backup of pruneOpenCodeInstallBackups(paths, targets, input.environment)) {
    infoLines.push(`backup retention: removed ${backup}`);
  }
  const hostVersion = input.host.version ?? SUPPORTED_OPENCODE_VERSION;
  infoLines.push(
    isAboveTestedVersion(input.host.version, SUPPORTED_OPENCODE_VERSION) ? `installed oso-code for OpenCode ${hostVersion}, verified against ${SUPPORTED_OPENCODE_VERSION}` : `installed oso-code for OpenCode ${hostVersion}`
  );
  return { report: renderCommandReport("install", "opencode", infoLines, wiring), exitCode: 0 };
}
function installRefusal(input, paths, sources) {
  const homeRefusal = configHomeRefusal(input.homeDirectory, input.environment, "install");
  if (homeRefusal !== void 0) return usageErrorOutcome("install", "opencode", homeRefusal.message);
  const payload = payloadRefusal(sources);
  if (payload !== void 0) return fatalOutcome("install", "opencode", "the install payload is incomplete", payload);
  const sourceBytes = trustBytesRefusal(sources.publishedHashes, "source", input.repositoryRoot);
  if (sourceBytes !== void 0) return fatalOutcome("install", "opencode", "the published gate bytes refuse this install", sourceBytes);
  for (const refusal of [configFileRefusal(paths.configFile), globalFileRefusal(paths.globalFile)]) {
    if (refusal === void 0) continue;
    return refusal.kind === "usage" ? usageErrorOutcome("install", "opencode", refusal.message) : fatalOutcome("install", "opencode", "the existing OpenCode state refuses this install", refusal.message);
  }
  if (!meetsVersionFloor(input.host.version, SUPPORTED_OPENCODE_VERSION)) {
    return fatalOutcome(
      "install",
      "opencode",
      "host baseline not met",
      `upgrade opencode to ${SUPPORTED_OPENCODE_VERSION} or newer and re-run (found ${input.host.version ?? "no opencode on PATH"})`
    );
  }
  return input.assumeYes ? void 0 : requiresYesOutcome("install", "opencode");
}
function backupCandidatesOf2(paths, targets) {
  return [
    { label: "config", target: paths.configFile },
    { label: "global", target: paths.globalFile },
    { label: "skills", target: targets.skills },
    { label: "agents", target: targets.agents },
    { label: OPENCODE_INSTALL_BACKUP_LABEL, target: targets.commands },
    { label: "plugin", target: targets.plugin },
    { label: "hooks", target: targets.hooks },
    { label: "git-hooks", target: targets.gitHooks },
    { label: "state-bin", target: targets.stateBin },
    { label: "dist", target: targets.dist },
    { label: "engram-plugin", target: targets.engramPlugin },
    { label: "impeccable", target: targets.impeccableMount },
    { label: "impeccable-opt-out", target: targets.impeccableOptOut },
    { label: "registry", target: targets.ownerRegistry }
  ];
}
function installPayloadTrees(paths, targets, sources) {
  replaceTree(paths.configHome, targets.skills, (stage) => {
    for (const wrapper of osoPrefixedEntryNames(sources.skills)) cpSync2(path13.join(sources.skills, wrapper), path13.join(stage, wrapper), { recursive: true });
    cpSync2(sources.sharedSkills, path13.join(stage, "_shared"), { recursive: true });
  });
  replaceTree(paths.configHome, targets.agents, (stage) => {
    for (const agent of agentContractNames(sources.agents)) cpSync2(path13.join(sources.agents, agent), path13.join(stage, agent));
  });
  replaceTree(paths.configHome, targets.commands, (stage) => {
    for (const command of modeCommandNames(sources.commands)) cpSync2(path13.join(sources.commands, command), path13.join(stage, command));
  });
  replaceTree(paths.configHome, targets.plugin, (stage) => cpSync2(sources.pluginBundle, path13.join(stage, "oso-code.js")));
  replaceTree(paths.configHome, targets.hooks, (stage) => {
    for (const script of publishedGateScriptNames(sources.publishedHashes)) {
      cpSync2(path13.join(sources.gates, script), path13.join(stage, script));
      chmodSync2(path13.join(stage, script), EXECUTABLE_FILE_MODE);
    }
  });
  replaceTree(paths.configHome, targets.stateBin, (stage) => {
    cpSync2(sources.stateBin, path13.join(stage, "oso-state"));
    cpSync2(sources.stateBinPackage, path13.join(stage, "package.json"));
    chmodSync2(path13.join(stage, "oso-state"), EXECUTABLE_FILE_MODE);
  });
  replaceTree(paths.configHome, targets.dist, (stage) => {
    for (const bundle of publishedDistFileNames(sources.publishedHashes)) cpSync2(path13.join(sources.dist, bundle), path13.join(stage, bundle));
  });
  replaceTree(paths.configHome, targets.gitHooks, (stage) => {
    cpSync2(sources.gitHook, path13.join(stage, "pre-commit"));
    chmodSync2(path13.join(stage, "pre-commit"), EXECUTABLE_FILE_MODE);
  });
}
function publishedGateBytesEntry(publishedHashes, configHome, hooksTarget) {
  const divergent = trustBytesRefusal(publishedHashes, "installed", configHome);
  if (divergent !== void 0) throw new Error(divergent);
  const unpublished = unpublishedInstalledGates(publishedHashes, hooksTarget);
  if (unpublished.length > 0) {
    throw new Error(
      `the installed gate tree holds executables no published hash covers: ${unpublished.join(" ")} \u2014 install exactly what bootstrap/hook-hashes.txt publishes`
    );
  }
  return wiringOk("published gate bytes", `verified against ${publishedHashes}`);
}
function renderOpenCodeConfig(input, paths, tx) {
  const fallow = resolveFallowMcpCommand(input.environment, input.homeDirectory, input.platform) ?? FALLOW_FALLBACK_COMMAND2;
  const merged = mergeOpenCodeConfig(recordedConfigDocument(tx), fallow);
  const violation = hostContractViolationOf(merged.document);
  if (violation !== void 0) throw new Error(`the rendered config violates the host contract: ${violation}`);
  writeJsonFile(paths.configFile, merged.document);
  chmodSync2(paths.configFile, PRIVATE_FILE_MODE);
  writeFileSync8(preservedKeysFileOf(tx), merged.preservedKeys.map((key) => `${key}
`).join(""));
  return wiringOk("opencode.json", `preserved ${merged.preservedKeys.length} operator key(s)`);
}
function recordedConfigDocument(tx) {
  return readJsonFile(path13.join(tx.itemsDirectory, "config"));
}
function wireEngram(environment, engramPlugin, tx) {
  if (firstExecutableOnPath(environment, ENGRAM_BINARY_NAME) === void 0) {
    return wiringOk("engram", "engram is not on PATH; the operator's prior Engram wiring stays as backed up");
  }
  const help = spawnSync7(ENGRAM_BINARY_NAME, ["setup", "--help"], { env: environment, encoding: "utf8" });
  if (!`${help.stdout ?? ""}${help.stderr ?? ""}`.includes("opencode")) {
    return wiringOk("engram", "engram setup does not advertise OpenCode support; the operator's prior wiring is preserved");
  }
  const setup = spawnSync7(ENGRAM_BINARY_NAME, ["setup", "opencode"], { env: environment, encoding: "utf8" });
  if (setup.error === void 0 && setup.status === 0) return wiringOk("engram", "wired through engram setup opencode");
  restoreBackedUpEngramPlugin(tx, engramPlugin);
  return wiringFail("engram", "engram setup opencode failed; the operator's prior Engram plugin was restored from the backup snapshot");
}
function restoreBackedUpEngramPlugin(tx, engramPlugin) {
  const recorded = path13.join(tx.itemsDirectory, "engram-plugin");
  if (!isReadableRegularFile(recorded)) return;
  mkdirSync7(path13.dirname(engramPlugin), { recursive: true });
  cpSync2(recorded, engramPlugin);
}
function impeccableEntries(input, targets) {
  if (input.installImpeccable) return [wiringOk("impeccable", `not mounted at ${targets.impeccableMount}; no installer in this tree performs the mount`)];
  mkdirSync7(path13.dirname(targets.impeccableOptOut), { recursive: true });
  writeFileSync8(targets.impeccableOptOut, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}
`);
  return [wiringOk("impeccable", "skipped by --no-impeccable")];
}
function gitHookEntries(input, targets) {
  const preCommit = path13.join(targets.gitHooks, "pre-commit");
  if (!input.installGitHook) return [wiringOk("git commit hook", `skipped by --no-git-hook; the hook is installed at ${preCommit}`)];
  const owner = gitHooksOwner(input.repositoryRoot, input.environment, targets.gitHooks);
  if (owner !== "") {
    return [
      wiringFail(
        "git commit hook",
        `not wired in ${input.repositoryRoot} \u2014 ${owner} already owns this repo's hooks and core.hooksPath would take them out of git's reach; the plugin's own commit gate still applies here \u2014 to run both, call ${preCommit} from your own pre-commit`
      )
    ];
  }
  const wired = spawnSync7("git", ["-C", input.repositoryRoot, "config", "--local", "core.hooksPath", targets.gitHooks], {
    env: input.environment,
    encoding: "utf8"
  });
  if (wired.error === void 0 && wired.status === 0) return [wiringOk("git commit hook", `core.hooksPath=${targets.gitHooks}`)];
  return [wiringFail("git commit hook", `git config failed: ${`${wired.stdout ?? ""}${wired.stderr ?? ""}`.trim()}`)];
}
function writeOwnerRegistry(paths, targets, tx) {
  const rows = [
    ownedBy(OWNER_INSTALLER, paths.configFile),
    ...preservedKeysOf(tx).map((key) => ownedBy(OWNER_OPERATOR, `${paths.configFile}:${key}`)),
    ownedBy(OWNER_INSTALLER, paths.globalFile),
    ownedBy(OWNER_INSTALLER, targets.skills),
    ownedBy(OWNER_INSTALLER, targets.agents),
    ownedBy(OWNER_INSTALLER, targets.commands),
    ownedBy(OWNER_INSTALLER, targets.plugin),
    ...directoryEntryNames(targets.hooks).filter((name) => name.endsWith(".sh")).map((name) => ownedBy(OWNER_INSTALLER, path13.join(targets.hooks, name))),
    ownedBy(OWNER_INSTALLER, path13.join(targets.stateBin, "oso-state")),
    ownedBy(OWNER_INSTALLER, path13.join(targets.gitHooks, "pre-commit"))
  ];
  mkdirSync7(paths.stateRoot, { recursive: true });
  writeFileSync8(targets.ownerRegistry, rows.map((row) => `${row}
`).join(""), { mode: PRIVATE_FILE_MODE });
}
function ownedBy(owner, target) {
  return `${owner}	${target}`;
}
function preservedKeysOf(tx) {
  const file = preservedKeysFileOf(tx);
  if (!isReadableRegularFile(file)) return [];
  return readFileSync12(file, "utf8").split("\n").filter((key) => key !== "");
}
function preservedKeysFileOf(tx) {
  return path13.join(tx.backupRoot, PRESERVED_KEYS_FILE);
}
function pruneOpenCodeInstallBackups(paths, targets, environment) {
  if (!isReadableRegularFile(targets.restoreExercisedMarker)) return [];
  const ownSnapshots = installBackupsDeclaring(paths.backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL);
  const over = installBackupsOverBudget(ownSnapshots, installBackupBudgetKib(environment));
  for (const backup of over) rmSync9(backup, { recursive: true, force: true });
  return over;
}
function migrateOpenCodeState(paths, targets, tx) {
  const migrated = [];
  for (const stateFile of stateFilesUnder(paths.stateRoot)) {
    const repository = path13.basename(stateFile, ".state");
    let backedUp = false;
    const backUpOnce = () => {
      if (backedUp) return;
      backupTarget(tx, `state-${repository}`, stateFile);
      commitManifest(tx);
      backedUp = true;
    };
    migrated.push(...migrateRenamedIdentity(stateFile, repository, backUpOnce));
    migrated.push(...migrateRelocatedApproval(stateFile, repository, targets.planArtifactRoot, backUpOnce));
  }
  return migrated;
}
function migrateRenamedIdentity(stateFile, repository, backUpOnce) {
  const session = stateValue(readFileSync12(stateFile, "utf8"), "session");
  if (!MIGRATED_SESSION_PATTERN.test(session)) return [];
  const agent = repository.slice(0, AGENT_IDENTITY_LENGTH);
  backUpOnce();
  rewriteStateKeys(stateFile, [`session=${agent}`]);
  if (stateValue(readFileSync12(stateFile, "utf8"), "plan_approval_session") !== "") {
    rewriteStateKeys(stateFile, [`plan_approval_session=${agent}`]);
  }
  return [`migrated the renamed identity in ${path13.basename(stateFile)}: session ${session} is now ${agent}`];
}
function migrateRelocatedApproval(stateFile, repository, planArtifactRoot, backUpOnce) {
  if (stateValue(readFileSync12(stateFile, "utf8"), "plan_approval") !== "") return [];
  const planDirectory = path13.join(planArtifactRoot, repository);
  const approved = directoryEntryNames(planDirectory).find((name) => name.startsWith("approved-") && name.endsWith(".md"));
  if (approved === void 0) return [];
  const planDigest = approved.slice("approved-".length, -".md".length);
  backUpOnce();
  rewriteStateKeys(stateFile, [
    "plan_approval=approved",
    `plan_approval_digest=${planDigest}`,
    `plan_approval_session=${repository.slice(0, AGENT_IDENTITY_LENGTH)}`,
    `plan_snapshot_file=${path13.join(planDirectory, approved)}`,
    `plan_current_file=${path13.join(planDirectory, "current.md")}`,
    "plan_revision=0"
  ]);
  return [`migrated the relocated plan approval into ${path13.basename(stateFile)}: ${planDigest}`];
}
function rewriteStateKeys(stateFile, pairs) {
  for (const pair of pairs) {
    const key = pair.slice(0, pair.indexOf("="));
    const kept = readFileSync12(stateFile, "utf8").split("\n").filter((line) => line !== "" && !line.startsWith(`${key}=`));
    const staged = path13.join(path13.dirname(stateFile), `.state-migration-${path13.basename(stateFile)}`);
    writeFileSync8(staged, [...kept, pair].map((line) => `${line}
`).join(""), { mode: PRIVATE_FILE_MODE });
    renameSync3(staged, stateFile);
  }
}
function stateFilesUnder(stateRoot) {
  return directoryEntryNames(stateRoot).filter((name) => name.endsWith(".state")).map((name) => path13.join(stateRoot, name)).filter(isReadableRegularFile);
}
function replaceTree(stageParent, target, fill) {
  mkdirSync7(stageParent, { recursive: true });
  const stage = mkdtempSync5(path13.join(stageParent, ".oso-install-stage-"));
  fill(stage);
  narrowToOwnerOnly(stage);
  mkdirSync7(path13.dirname(target), { recursive: true });
  rmSync9(target, { recursive: true, force: true });
  renameSync3(stage, target);
}
function narrowToOwnerOnly(target) {
  const stats = lstatSync3(target);
  if (stats.isSymbolicLink()) return;
  chmodSync2(target, stats.mode & OWNER_ONLY_MASK);
  if (!stats.isDirectory()) return;
  for (const name of readdirSync4(target)) narrowToOwnerOnly(path13.join(target, name));
}
function skillWrapperNames(skillsSource) {
  return osoPrefixedEntryNames(skillsSource).filter((name) => isReadableRegularFile(path13.join(skillsSource, name, "SKILL.md")));
}
function agentContractNames(agentsSource) {
  return osoPrefixedMarkdownNames(agentsSource);
}
function modeCommandNames(commandsSource) {
  return osoPrefixedMarkdownNames(commandsSource);
}
function osoPrefixedMarkdownNames(directory) {
  return osoPrefixedEntryNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path13.join(directory, name)));
}
function osoPrefixedEntryNames(directory) {
  return directoryEntryNames(directory).filter((name) => name.startsWith("oso-"));
}
function directoryEntryNames(directory) {
  try {
    return readdirSync4(directory).sort();
  } catch {
    return [];
  }
}

// core/src/install/opencode-purge.ts
import { mkdirSync as mkdirSync8, readFileSync as readFileSync13, realpathSync, rmSync as rmSync10 } from "node:fs";
import path14 from "node:path";
var OPENCODE_PURGE_BACKUP_FORMAT = "oso-code-opencode-purge-v1";
var PROJECT_CONFIGS_KEY = "OSO_OPENCODE_PROJECT_CONFIGS";
var REQUIRED_PROJECT_CONFIG_COUNT = 3;
var GENTLE_AI_LABELS = ["gentle-ai-home", "gentle-ai-bin"];
var UNSAFE_PATH_SEGMENTS = ["/../", "/./"];
var UNSAFE_PATH_CHARACTERS = /[\n\r\t]/;
function openCodePurgeTargets(homeDirectory, keepGentleAi) {
  const all = [
    { label: "config-home", target: path14.join(homeDirectory, ".config", "opencode") },
    { label: "state-home", target: path14.join(homeDirectory, ".local", "share", "opencode") },
    { label: "cache-home", target: path14.join(homeDirectory, ".cache", "opencode") },
    { label: "bin", target: path14.join(homeDirectory, ".opencode", "bin", "opencode") },
    { label: "gentle-ai-home", target: path14.join(homeDirectory, ".gentle-ai") },
    { label: "gentle-ai-bin", target: path14.join(homeDirectory, ".local", "bin", "gentle-ai") }
  ];
  return keepGentleAi ? all.filter((row) => !GENTLE_AI_LABELS.includes(row.label)) : all;
}
function purgeBackupParentOf(homeDirectory) {
  return path14.join(homeDirectory, ".local", "state", "oso-code", "purge-backups");
}
function customizedHomeRefusal(homeDirectory, environment) {
  const rows = [
    { key: "XDG_CONFIG_HOME", expected: path14.join(homeDirectory, ".config"), named: "config home" },
    { key: "XDG_STATE_HOME", expected: path14.join(homeDirectory, ".local", "state"), named: "state home" },
    { key: "XDG_CACHE_HOME", expected: path14.join(homeDirectory, ".cache"), named: "cache home" }
  ];
  const customized = rows.find((row) => (environment[row.key] ?? "") !== "" && environment[row.key] !== row.expected);
  if (customized === void 0) return void 0;
  return `${customized.key} is not the default (${customized.expected}); a customized opencode ${customized.named} is missed by this wipe`;
}
function unsafeTargetRefusal(homeDirectory, targets) {
  const homePhysical = physicalPathOf(homeDirectory);
  if (homePhysical === void 0) return `HOME does not resolve to a physical path: ${homeDirectory}`;
  if (homePhysical === path14.parse(homePhysical).root) return `refusing to operate with HOME=${homeDirectory}`;
  for (const { label, target } of targets) {
    if (!path14.isAbsolute(target)) return `${label} must be an absolute path: ${target}`;
    if (!pathIsClean(target)) return `unsafe ${label} path: ${target}`;
    if (!isBelow(target, homeDirectory)) return `${label} must remain below HOME: ${target}`;
    if (!existsAtAll(target) || isSymlink(target)) continue;
    const parentPhysical = physicalPathOf(path14.dirname(target));
    if (parentPhysical === void 0) return `${label} does not resolve to a physical path: ${target}`;
    if (parentPhysical !== homePhysical && !isBelow(parentPhysical, homePhysical)) return `${label} resolves outside HOME: ${target}`;
  }
  return void 0;
}
function backupOverlapRefusal(backupParent, targets) {
  for (const { target } of targets) {
    if (backupParent === target || isBelow(backupParent, target)) return `backup root would be inside purge target: ${target}`;
    if (target === backupParent || isBelow(target, backupParent)) return `purge target would contain existing backups: ${target}`;
  }
  return void 0;
}
function projectConfigsRefusal(environment, targets) {
  const declared = projectConfigsIn(environment);
  if (declared.length === 0) {
    return `${PROJECT_CONFIGS_KEY} is required: exactly ${REQUIRED_PROJECT_CONFIG_COUNT} absolute project-level opencode.json paths, space-separated`;
  }
  if (declared.length !== REQUIRED_PROJECT_CONFIG_COUNT) {
    return `${PROJECT_CONFIGS_KEY} must name exactly ${REQUIRED_PROJECT_CONFIG_COUNT} project-level opencode.json files`;
  }
  if (new Set(declared).size !== declared.length) return "the three project-level opencode.json paths must be distinct";
  for (const declaredPath of declared) {
    if (!path14.isAbsolute(declaredPath)) return `project-level opencode.json must be an absolute path: ${declaredPath}`;
    if (!pathIsClean(declaredPath)) return `unsafe project-level opencode.json path: ${declaredPath}`;
    if (!existsAtAll(declaredPath)) return `project-level opencode.json does not exist: ${declaredPath}`;
    const inside = targets.find(({ target }) => declaredPath === target || isBelow(declaredPath, target));
    if (inside !== void 0) return `project-level opencode.json must not be inside a purge target: ${declaredPath}`;
  }
  return void 0;
}
function projectConfigsIn(environment) {
  return (environment[PROJECT_CONFIGS_KEY] ?? "").split(/\s+/).filter((entry) => entry !== "");
}
function purgeOpenCode(input) {
  const targets = openCodePurgeTargets(input.homeDirectory, input.keepGentleAi);
  const backupParent = purgeBackupParentOf(input.homeDirectory);
  const customized = customizedHomeRefusal(input.homeDirectory, input.environment);
  if (customized !== void 0) return usageErrorOutcome("purge", "opencode", customized);
  const unsafe = unsafeTargetRefusal(input.homeDirectory, targets) ?? backupOverlapRefusal(backupParent, targets);
  if (unsafe !== void 0) return fatalOutcome("purge", "opencode", "the purge targets refuse this run", unsafe);
  if (input.restoreFrom !== void 0) return restoreOpenCodePurge(input.restoreFrom, input.homeDirectory);
  const declaredProjects = projectConfigsRefusal(input.environment, targets);
  if (declaredProjects !== void 0) return usageErrorOutcome("purge", "opencode", declaredProjects);
  if (input.dryRun) return dryRunOutcome(input, targets, backupParent);
  if (!input.assumeYes) return requiresYesOutcome("purge", "opencode");
  return withOwnerOnlyUmask(() => purgeAfterBackup(input, targets, backupParent));
}
function dryRunOutcome(input, targets, backupParent) {
  const infoLines = [
    "dry run: nothing will be backed up or removed",
    "purge targets:",
    ...targets.map(({ label, target }) => `  ${label}: ${target}`),
    "project-level opencode.json files to report:",
    ...projectConfigsIn(input.environment).map((declared) => `  ${declared}`),
    `backup would be created at: ${path14.join(backupParent, "purge-<timestamp>")}`
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, [wiringOk("dry run", "no target was read for removal")]), exitCode: 0 };
}
function purgeAfterBackup(input, targets, backupParent) {
  if (targets.every(({ target }) => !existsAtAll(target))) {
    const settled = "the user-level OpenCode install is already absent; nothing to purge";
    return { report: renderCommandReport("purge", "opencode", [settled], [wiringOk("user-level OpenCode install", "already absent")]), exitCode: 0 };
  }
  let tx;
  try {
    tx = beginTransaction(backupParent, OPENCODE_PURGE_BACKUP_FORMAT);
    for (const { label, target } of targets) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "opencode", "could not create the pre-purge backup", messageOf(error));
  }
  const wiring = targets.map(({ label, target }) => removalEntry(label, target));
  const vanished = projectConfigsIn(input.environment).filter((declared) => !existsAtAll(declared));
  if (vanished.length > 0) {
    return fatalOutcome("purge", "opencode", "project-level opencode.json vanished during the purge", vanished.join(" "));
  }
  const infoLines = [
    `backup: ${tx.backupRoot}`,
    "purged the user-level OpenCode install: config, state, cache, binary",
    ...input.keepGentleAi ? ["gentle-ai homes are kept and excluded from the purge"] : ["the gentle-ai homes were part of the purge"],
    ...projectConfigsIn(input.environment).map((declared) => `project-level opencode.json ${existsAtAll(declared) ? "INTACT" : "MISSING"}: ${declared}`),
    "no login or installation command was run",
    `restore with: oso purge --host opencode --restore ${tx.backupRoot}`
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, wiring), exitCode: 0 };
}
function removalEntry(label, target) {
  if (!existsAtAll(target)) return wiringOk(label, "already absent");
  try {
    rmSync10(target, { recursive: true, force: true });
  } catch (error) {
    return wiringFail(label, messageOf(error));
  }
  return existsAtAll(target) ? wiringFail(label, `purge target was not removed: ${target}`) : wiringOk(label, `removed ${target}`);
}
function restoreOpenCodePurge(backupDirectory, homeDirectory) {
  const readable = readablePurgeBackup(backupDirectory, homeDirectory);
  if (readable.kind === "unusable") return fatalOutcome("purge", "opencode", "cannot restore from this backup", readable.message);
  const occupied = readable.rows.find((row) => existsAtAll(row.target));
  if (occupied !== void 0) {
    return fatalOutcome("purge", "opencode", "refusing to overwrite an existing target", `${occupied.label}: ${occupied.target}`);
  }
  for (const row of readable.rows) mkdirSync8(path14.dirname(row.target), { recursive: true });
  const restored = restoreBackupManifest(readable.rows.map(serializeManifestRow).join("\n"), path14.join(backupDirectory, "items"));
  const wiring = readable.rows.map(
    (row) => restored.failedItems.includes(row.target) ? wiringFail(row.label, `could not restore ${row.target}`) : wiringOk(row.label, row.target)
  );
  const infoLines = [
    `restored the user-level OpenCode install from verified backup: ${backupDirectory}`,
    "no login or installation command was run"
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, wiring), exitCode: restored.failedCount === 0 ? 0 : 1 };
}
function readablePurgeBackup(backupDirectory, homeDirectory) {
  if (!path14.isAbsolute(backupDirectory)) return { kind: "unusable", message: "backup path must be absolute" };
  if (!existsAtAll(backupDirectory) || isSymlink(backupDirectory)) {
    return { kind: "unusable", message: `backup is not a directory: ${backupDirectory}` };
  }
  const marker = path14.join(backupDirectory, "format");
  const format = isReadableRegularFile(marker) ? readFileSync13(marker, "utf8").trim() : "";
  if (format !== OPENCODE_PURGE_BACKUP_FORMAT) {
    return { kind: "unusable", message: `unsupported or missing backup format: ${backupDirectory} (expected ${OPENCODE_PURGE_BACKUP_FORMAT})` };
  }
  const manifest = path14.join(backupDirectory, "manifest");
  if (!isReadableRegularFile(manifest)) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const rows = parseManifestRows(readFileSync13(manifest, "utf8"));
  if (rows.length === 0) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const unknown = rows.find((row) => expectedTargetFor(row.label, homeDirectory) === void 0);
  if (unknown !== void 0) return { kind: "unusable", message: `unknown backup target label: ${unknown.label}` };
  const foreign = rows.find((row) => row.target !== expectedTargetFor(row.label, homeDirectory));
  if (foreign !== void 0) return { kind: "unusable", message: `backup target does not match this HOME: ${foreign.label}` };
  return { kind: "usable", rows };
}
function expectedTargetFor(label, homeDirectory) {
  return openCodePurgeTargets(homeDirectory, false).find((row) => row.label === label)?.target;
}
function pathIsClean(target) {
  if (target === path14.parse(target).root) return false;
  if (UNSAFE_PATH_CHARACTERS.test(target)) return false;
  if (target.endsWith("/..") || target.endsWith("/.")) return false;
  return !UNSAFE_PATH_SEGMENTS.some((segment) => target.includes(segment));
}
function isBelow(candidate, ancestor) {
  return candidate.startsWith(ancestor.endsWith(path14.sep) ? ancestor : `${ancestor}${path14.sep}`);
}
function physicalPathOf(target) {
  try {
    return realpathSync(target);
  } catch {
    return void 0;
  }
}

// core/src/install/verify-codex.ts
import path15 from "node:path";
import { spawnSync as spawnSync8 } from "node:child_process";
import { readFileSync as readFileSync14, readdirSync as readdirSync5, statSync as statSync5 } from "node:fs";

// core/src/routes/routes.ts
var TOOL_ROWS = [
  { gate: "commit", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", codex: "apply_patch", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", codex: "apply_patch", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", codex: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "handoff", names: { claude: "none", codex: "explorer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-applier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-verifier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-integrator", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-doubt-pass", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-debt-sweep", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-triage", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-security-reviewer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "apply_patch", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_plan", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "request_user_input", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "Agent", opencode: "task" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationspawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationsend_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationfollowup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationwait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationinterrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationlist_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "spawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_input", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "resume_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "close_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "followup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "interrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "create_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "get_goal", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "view_image", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resources", opencode: "list_mcp_resources" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resource_templates", opencode: "list_mcp_resource_templates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "read_mcp_resource", opencode: "read_mcp_resource" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_gen__imagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_genimagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "web__run", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_search", opencode: "engram_mem_search" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_get_observation", opencode: "engram_mem_get_observation" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save", opencode: "engram_mem_save" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_update", opencode: "engram_mem_update" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_context", opencode: "engram_mem_context" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_session_summary", opencode: "engram_mem_session_summary" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_current_project", opencode: "engram_mem_current_project" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save_prompt", opencode: "engram_mem_save_prompt" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_judge", opencode: "engram_mem_judge" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve-library-id", opencode: "context7_resolve-library-id" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__query-docs", opencode: "context7_query-docs" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve_library_id", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__find_dupes", opencode: "fallow_find_dupes" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__get_cleanup_candidates", opencode: "fallow_get_cleanup_candidates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__audit", opencode: "fallow_audit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "read" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "grep" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "glob" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "skill" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "todowrite" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "webfetch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "websearch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "question" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "lsp" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "plan_exit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" }
];

// core/src/install/verify-codex.ts
var KNOWN_MCP_SERVERS = ["engram", "context7", "fallow"];
var PROTOCOL_MANDATED_TOOLS = {
  engram: [
    "mem_save",
    "mem_search",
    "mem_context",
    "mem_session_summary",
    "mem_get_observation",
    "mem_save_prompt",
    "mem_current_project",
    "mem_judge"
  ]
};
var LOCAL_CHECKS_SECTION = "local checks:";
var MCP_DRIFT_SECTION = "MCP tool table drift:";
function verifyCodex(input) {
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const report2 = new VerifyReport();
  report2.section(LOCAL_CHECKS_SECTION);
  checkPinnedCodexVersion(report2, input.host);
  checkHostBinaryContracts(report2, input.host);
  checkPluginInstalled2(report2, paths, input.host);
  checkPublishedRuntimeBytes(report2, paths, input.repositoryRoot);
  checkRuntimeEntrypointsExecutable(report2, paths);
  checkAgentPayload(report2, paths, input.repositoryRoot);
  checkMarketplacePayload(report2, paths, input.repositoryRoot);
  checkManagedConfigRegion(report2, paths, input.environment);
  checkHostAcceptsOsoProfile(report2, paths, input.host);
  checkGlobalGuidance(report2, paths, input.repositoryRoot);
  checkEngramWiring(report2, paths);
  checkStateRoundTrip(report2, paths);
  checkPlanArtifactRoundTrip(report2, paths);
  checkCommitHookDeniesRed(report2, paths);
  checkImpeccableMount(report2, input.homeDirectory);
  checkGitCommitGate(report2, paths, input.repositoryRoot, input.environment);
  checkMcpToolTableDrift(report2, paths);
  return { report: report2.render(), exitCode: report2.exitCode };
}
function checkPinnedCodexVersion(report2, host) {
  const found = host.version ?? "not installed";
  if (!meetsVersionFloor(host.version, SUPPORTED_CODEX_VERSION)) {
    report2.check("Codex CLI version", `${SUPPORTED_CODEX_VERSION} or newer`, found, `npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`);
    return;
  }
  report2.check("Codex CLI version", found, found);
  if (isAboveTestedVersion(host.version, SUPPORTED_CODEX_VERSION)) {
    report2.note(`Codex ${found} is newer than the ${SUPPORTED_CODEX_VERSION} this release was verified against, so the host binary contracts below report unverified rather than pass or fail`);
  }
}
function checkHostBinaryContracts(report2, host) {
  for (const contract of HOST_BINARY_CONTRACTS) {
    if (host.binaryPath === void 0) {
      report2.skip(`${contract.shortLabel} \u2014 codex is not on PATH, so the host contract could not be asserted`);
      continue;
    }
    if (host.version !== SUPPORTED_CODEX_VERSION) {
      report2.unverified(
        `${contract.shortLabel} \u2014 claims were verified against Codex ${SUPPORTED_CODEX_VERSION} only; installed ${host.version ?? "not installed"} falls outside that window, so pass/fail is not asserted here`
      );
      continue;
    }
    report2.check(contract.name, "conformant", binaryCarriesBoth(host.binaryPath, contract.literals) ? "conformant" : "nonconformant");
  }
}
function checkPluginInstalled2(report2, paths, host) {
  const listing = host.pluginListing();
  if (!listing.ok) {
    report2.check("oso-code plugin installed", "installed", collapsed(listing.output));
    return;
  }
  report2.check("oso-code plugin installed", "installed", localPluginSourcePaths(listing.output).includes(path15.join(paths.marketplaceRoot, "codex")) ? "installed" : "absent-or-invalid");
}
function checkMarketplacePayload(report2, paths, repositoryRoot2) {
  const divergent = MARKETPLACE_PAYLOAD_ROWS.flatMap(
    (row) => filesHoldTheSameBytes(path15.join(repositoryRoot2, ...row.published.split("/")), path15.join(paths.marketplaceRoot, ...row.installed.split("/"))) ? [] : [row.named]
  );
  for (const skill of publishedSkillNames(repositoryRoot2)) {
    const installed = path15.join(paths.marketplaceRoot, "codex", "skills", skill, "SKILL.md");
    if (!filesHoldTheSameBytes(path15.join(repositoryRoot2, "codex", "skills", skill, "SKILL.md"), installed)) divergent.push(skill);
  }
  if (!isDirectoryAt(path15.join(paths.marketplaceRoot, "codex", "skills", "_shared"))) divergent.push("shared");
  report2.check("staged marketplace payload", "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.map((named) => ` ${named}`).join("")}`);
}
function checkHostAcceptsOsoProfile(report2, paths, host) {
  const expected = `1
${path15.join(paths.runtimeRoot, "bin", "oso-state")}`;
  const run = host.sandbox(["/bin/sh", "-c", 'printf "%s\n%s\n" "${OSO_AGENT:-}" "${OSO_STATE_BIN:-}"']);
  const observed = run.ok ? run.output.trim() : collapsed(run.output);
  report2.check("Codex accepts the oso permissions profile", "accepted", observed === expected ? "accepted" : observed === "" ? "rejected-without-output" : observed);
}
function checkStateRoundTrip(report2, paths) {
  report2.check("installed oso-state round-trip", "probe", installedEntrypointVerdict(paths, "round-trip-failed:empty"));
}
function checkPlanArtifactRoundTrip(report2, paths) {
  report2.check("installed Codex plan artifact round-trip", "artifacts", installedEntrypointVerdict(paths, "artifact-round-trip-failed:empty"));
}
function checkCommitHookDeniesRed(report2, paths) {
  report2.check("installed git hook denies a red agent commit", "denied", installedEntrypointVerdict(paths, "setup-failed"));
}
function checkGitCommitGate(report2, paths, repositoryRoot2, environment) {
  const wired = path15.join(paths.runtimeRoot, "git-hooks");
  const configured = gitConfigured(repositoryRoot2, environment);
  if (configured === wired && isExecutableRegularFile(path15.join(wired, "pre-commit"))) {
    report2.check("git commit gate", "wired", "wired");
    return;
  }
  report2.note("git commit gate is not wired for this checkout; the installer may have run with --no-git-hook");
}
function checkManagedConfigRegion(report2, paths, environment) {
  if (!isReadableRegularFile(paths.configFile)) {
    report2.check("managed Codex config", "valid", "missing");
    return;
  }
  const text = readFileSync14(paths.configFile, "utf8");
  const extracted = runTomlRegion(text, {
    action: "extract",
    startMarker: CONFIG_MARKER_START,
    endMarker: CONFIG_MARKER_END,
    requireRegion: true
  });
  if (extracted.exitCode !== 0) {
    report2.check("managed Codex config", "valid", "malformed");
    return;
  }
  const fallowCommand = fallowCommandInside(extracted.stdout);
  const expected = renderCodexManagedConfig(paths.homeDirectory, paths.runtimeRoot, fallowCommand);
  if (extracted.stdout !== expected) {
    report2.check("managed Codex config", "valid", "divergent");
    return;
  }
  report2.check("managed Codex config", "valid", featuresVerdictOf(managedFeaturesStatus(text)));
  report2.detail(`fallow MCP command in the managed region: ${fallowCommand}`);
  report2.detail(`CODEX_HOME read as ${environment["CODEX_HOME"] ?? paths.codexHome}`);
}
function checkGlobalGuidance(report2, paths, repositoryRoot2) {
  if (!isReadableRegularFile(paths.globalFile)) {
    report2.check("global Codex guidance", "exact", "missing");
    return;
  }
  const installed = regionBetween(readFileSync14(paths.globalFile, "utf8"), GLOBAL_MARKER_START, GLOBAL_MARKER_END);
  if (installed === void 0) {
    report2.check("global Codex guidance", "exact", "malformed");
    return;
  }
  const source = path15.join(repositoryRoot2, "bootstrap", "codex-global.md");
  if (!isReadableRegularFile(source)) {
    report2.detail(`published guidance unreadable: ${source}`);
    report2.check("global Codex guidance", "exact", "source-unreadable");
    return;
  }
  report2.check("global Codex guidance", "exact", installed === readFileSync14(source, "utf8") ? "exact" : "divergent");
}
var CODEX_HOOKS_MANIFEST = "codex/hooks/hooks.json";
var RENDERED_HOOKS_DIR_TOKEN = "__OSO_HOOKS_DIR__";
function unrenderedHooksManifest(text, runtimeRoot) {
  return text.replaceAll(path15.posix.join(runtimeRoot, "dist"), RENDERED_HOOKS_DIR_TOKEN);
}
function checkPublishedRuntimeBytes(report2, paths, repositoryRoot2) {
  const divergences = trustDivergences(
    path15.join(repositoryRoot2, "bootstrap", "hook-hashes.txt"),
    (relative) => relative.startsWith("opencode/"),
    (relative) => installedRuntimePathOf(relative, paths),
    (relative, target) => relative === CODEX_HOOKS_MANIFEST ? Buffer.from(unrenderedHooksManifest(readFileSync14(target, "utf8"), paths.runtimeRoot), "utf8") : readFileSync14(target)
  );
  for (const divergence of divergences) report2.detail(`${divergence.file}: ${divergence.state.kind}`);
  report2.check("published runtime bytes", "verified", divergences.length === 0 ? "verified" : `bad:${divergences.length}`);
}
function checkRuntimeEntrypointsExecutable(report2, paths) {
  const entrypoints = [path15.join(paths.runtimeRoot, "bin", "oso-state"), path15.join(paths.runtimeRoot, "git-hooks", "pre-commit")];
  const missing = entrypoints.filter((entrypoint) => !isExecutableRegularFile(entrypoint));
  for (const entrypoint of missing) report2.detail(`not executable: ${entrypoint}`);
  report2.check("runtime entrypoints executable", "executable", missing.length === 0 ? "executable" : `not-executable:${missing.length}`);
}
function checkAgentPayload(report2, paths, repositoryRoot2) {
  const sourceDir = path15.join(repositoryRoot2, "codex", "agents");
  let published;
  try {
    published = readdirSync5(sourceDir).filter((name) => name.endsWith(".toml")).sort();
  } catch (cause) {
    if (!isErrnoException(cause) || cause.code !== "ENOENT" && cause.code !== "ENOTDIR") throw cause;
    report2.detail(`published agents unreadable: ${sourceDir} (${cause.code})`);
    report2.check(AGENT_PAYLOAD_CHECK, "exact", "source-unreadable");
    return;
  }
  if (published.length === 0) {
    report2.detail(`published agents empty: ${sourceDir}`);
    report2.check(AGENT_PAYLOAD_CHECK, "exact", "source-empty");
    return;
  }
  const installedDir = path15.join(paths.codexHome, "agents");
  const divergent = published.filter((name) => {
    const installed = path15.join(installedDir, name);
    if (!isReadableRegularFile(installed)) return true;
    return readFileSync14(installed, "utf8") !== readFileSync14(path15.join(sourceDir, name), "utf8");
  });
  for (const name of divergent) report2.detail(`divergent agent: ${name}`);
  report2.check(AGENT_PAYLOAD_CHECK, "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.map((named) => ` ${named}`).join("")}`);
}
function checkEngramWiring(report2, paths) {
  const instructions = path15.join(paths.codexHome, "engram-instructions.md");
  const compact = path15.join(paths.codexHome, "engram-compact-prompt.md");
  const wired = isReadableRegularFile(instructions) && isReadableRegularFile(compact) && mcpServersOf(paths.configFile).some((server) => server.name === "engram");
  report2.check("Engram Codex integration", "wired", wired ? "wired" : "incomplete");
}
function checkImpeccableMount(report2, homeDirectory) {
  const optOut = path15.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
  if (isReadableRegularFile(optOut)) {
    report2.skip("Impeccable mount \u2014 an install recorded --no-impeccable");
    return;
  }
  const mount = path15.join(homeDirectory, ".agents", "skills", "impeccable");
  report2.check("Impeccable Codex mount", "mounted", isReadableRegularFile(path15.join(mount, "SKILL.md")) ? "mounted" : "missing");
}
function checkMcpToolTableDrift(report2, paths) {
  report2.section(MCP_DRIFT_SECTION);
  report2.check("the hardcoded mandated tool list agrees with the routes table in both directions", "agree", mandatedAgreementStatus());
  for (const server of mcpServersOf(paths.configFile)) {
    if (server.command === void 0 || server.command === "") {
      report2.skip(`${server.name} MCP tool drift \u2014 no local command in ${paths.configFile} (a remote/URL-based server has no process this check spawns)`);
      continue;
    }
    report2.skip(
      `${server.name} MCP tool drift \u2014 the live tool list is nightly's; no PR-gate check spawns ${server.command} (G4)`
    );
  }
}
function mandatedAgreementStatus() {
  const mismatches = [...hardcodedRowsWithNoMandatedRoute(), ...mandatedRoutesNoServerHardcodes()];
  return mismatches.length === 0 ? "agree" : mismatches.join(",");
}
function hardcodedRowsWithNoMandatedRoute(hardcoded = PROTOCOL_MANDATED_TOOLS) {
  const mismatches = [];
  for (const server of KNOWN_MCP_SERVERS) {
    for (const bare of hardcoded[server] ?? []) {
      const spelled = `mcp__${server}__${bare}`;
      if (!TOOL_ROWS.some((row) => row.names.codex === spelled && row.mandated === "yes")) {
        mismatches.push(`${spelled}(hardcoded-not-a-yes-row)`);
      }
    }
  }
  return mismatches;
}
function mandatedRoutesNoServerHardcodes(hardcoded = PROTOCOL_MANDATED_TOOLS) {
  const mismatches = [];
  for (const row of TOOL_ROWS) {
    if (row.mandated !== "yes" || !row.names.codex.startsWith("mcp__")) continue;
    const server = KNOWN_MCP_SERVERS.find((name) => row.names.codex.startsWith(`mcp__${name}__`));
    if (server === void 0) continue;
    const bare = row.names.codex.slice(`mcp__${server}__`.length);
    if (!(hardcoded[server] ?? []).includes(bare)) mismatches.push(`${row.names.codex}(yes-row-not-hardcoded)`);
  }
  return mismatches;
}
function mcpServersOf(configFile) {
  let document;
  try {
    document = readTomlFile(configFile);
  } catch (error) {
    if (error instanceof TomlParseError) return [];
    throw error;
  }
  const servers = document?.["mcp_servers"];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];
  return Object.entries(servers).map(([name, value]) => {
    const entry = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    const command = entry["command"];
    const args = entry["args"];
    return {
      name,
      command: typeof command === "string" ? command : void 0,
      args: Array.isArray(args) ? args.filter((item) => typeof item === "string") : []
    };
  });
}
function regionBetween(text, start, end) {
  const kept = [];
  let inside = false;
  let starts = 0;
  let ends = 0;
  for (const line of text === "" ? [] : text.replace(/\n$/, "").split("\n")) {
    if (line === start) {
      starts += 1;
      inside = true;
      continue;
    }
    if (line === end) {
      ends += 1;
      inside = false;
      continue;
    }
    if (inside) kept.push(line);
  }
  if (starts !== 1 || ends !== 1 || inside) return void 0;
  return kept.length === 0 ? "" : `${kept.join("\n")}
`;
}
function featuresVerdictOf(status) {
  switch (status) {
    case "valid":
      return "valid";
    case "missing":
      return "missing-features";
    case "malformed":
      return "malformed-features";
    case "divergent":
      return "divergent-features";
  }
}
function fallowCommandInside(regionText) {
  const row = regionText.split("\n").find((line) => line.startsWith("command = "));
  if (row === void 0) return "";
  const quoted = row.slice("command = ".length).trim();
  return quoted.startsWith('"') && quoted.endsWith('"') ? quoted.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\") : quoted;
}
function installedRuntimePathOf(relative, paths) {
  if (relative === CODEX_HOOKS_MANIFEST) return path15.join(paths.codexHome, "hooks.json");
  for (const [prefix, directory] of [
    ["plugin/dist/", "dist"],
    ["plugin/hooks/", "hooks"],
    ["plugin/git-hooks/", "git-hooks"],
    ["plugin/bin/", "bin"]
  ]) {
    if (relative.startsWith(prefix)) return path15.join(paths.runtimeRoot, directory, relative.slice(prefix.length));
  }
  return void 0;
}
var AGENT_PAYLOAD_CHECK = "seven Codex agents copied exactly";
var HOST_BINARY_CONTRACTS = [
  {
    shortLabel: "Codex host contract",
    name: "Codex binary matches the fork_turns host contract",
    literals: [
      "fork_context is not supported in MultiAgentV2; use fork_turns instead",
      "fork_turns must be `none`, `all`, or a positive integer string"
    ]
  },
  {
    shortLabel: "Codex permission-override contract",
    name: "Codex binary matches the default_permissions override contract",
    literals: [
      "default_permissions refers to undefined profile `",
      "`permission_profile` and `default_permissions` overrides cannot both be set"
    ]
  }
];
var MARKETPLACE_PAYLOAD_ROWS = [
  { named: "marketplace.json", published: ".agents/plugins/marketplace.json", installed: ".agents/plugins/marketplace.json" },
  { named: "plugin.json", published: "codex/.codex-plugin/plugin.json", installed: "codex/.codex-plugin/plugin.json" }
];
function installedEntrypointVerdict(paths, absentVerdict) {
  return isExecutableRegularFile(path15.join(paths.runtimeRoot, "bin", "oso-state")) ? "installed-probe-is-nightly-only" : absentVerdict;
}
function binaryCarriesBoth(binary, literals) {
  const bytes = readFileSync14(binary, "latin1");
  return literals.every((literal) => bytes.includes(literal));
}
function localPluginSourcePaths(listingJson) {
  let listing;
  try {
    listing = JSON.parse(listingJson);
  } catch {
    return [];
  }
  const installed = isRecord2(listing) ? listing["installed"] : void 0;
  if (!Array.isArray(installed)) return [];
  return installed.flatMap((plugin) => {
    if (!isRecord2(plugin) || plugin["installed"] !== true || plugin["enabled"] !== true) return [];
    const source = plugin["source"];
    if (!isRecord2(source) || source["source"] !== "local" || typeof source["path"] !== "string") return [];
    return [source["path"]];
  });
}
function publishedSkillNames(repositoryRoot2) {
  try {
    return readdirSync5(path15.join(repositoryRoot2, "codex", "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "_shared").map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
function isDirectoryAt(target) {
  try {
    return statSync5(target).isDirectory();
  } catch {
    return false;
  }
}
function gitConfigured(repositoryRoot2, environment) {
  const run = spawnSync8("git", ["-C", repositoryRoot2, "config", "--get", "core.hooksPath"], { env: environment, encoding: "utf8" });
  return run.error === void 0 && run.status === 0 ? (run.stdout ?? "").trim() : "";
}
function collapsed(text) {
  return text.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// core/src/install/verify-opencode.ts
import { spawnSync as spawnSync9 } from "node:child_process";
import { chmodSync as chmodSync3, mkdirSync as mkdirSync9, mkdtempSync as mkdtempSync6, readdirSync as readdirSync6, readFileSync as readFileSync15, rmSync as rmSync11, writeFileSync as writeFileSync9 } from "node:fs";
import { tmpdir as tmpdir4 } from "node:os";
import path16 from "node:path";
var OPENCODE_NOT_ON_PATH = "opencode-not-on-path";
var VERSION_ROW_SKIP = "OpenCode CLI version \u2014 opencode is not on PATH, so the installed pin could not be probed";
var LOCAL_CHECKS_SECTION2 = "local checks:";
var FIXTURE_ROWS_SKIP = "the fixture-based artifact checks \u2014 the isolated install could not complete";
var OPERATOR_CONFIG_PROBE = {
  theme: "oso-verify-operator-theme",
  permissionKey: "read",
  permissionVerdict: "allow",
  mcpServerName: "oso-verify-operator-server",
  mcpServerCommand: ["operator-cli"]
};
var OPERATOR_GLOBAL_PROSE = "oso-verify operator prose the installer must not touch";
var EXPECTED_MODE_COMMAND_COUNT = 4;
var MODE_COMMAND_AGENT_ROUTE = "build";
var SHELL_SYNTAX_SOURCES = [
  { directory: ["bootstrap"], suffix: ".sh" },
  { directory: ["bootstrap", "lib"], suffix: ".sh" },
  { directory: ["tools"], suffix: ".sh" },
  { directory: ["plugin", "hooks"], suffix: ".sh" },
  { directory: ["tests"], suffix: ".sh" },
  { directory: ["tests", "fixtures"], suffix: ".sh" }
];
var SHELL_SYNTAX_EXTRA_SOURCES = [["plugin", "git-hooks", "pre-commit"]];
var FIXTURE_SHIMS_DIRECTORY = "shims";
var FIXTURE_SHIM_MODE = 448;
var FIXTURE_ENGRAM_SHIM = [
  "#!/bin/sh",
  'case "$*" in',
  `  "setup --help") printf 'usage: engram setup [<agent>] (claude-code, opencode, codex, ...)\\n'; exit 0 ;;`,
  '  "setup opencode")',
  '    mkdir -p "$HOME/.config/opencode/plugins"',
  `    printf 'fixture engram plugin\\n' > "$HOME/.config/opencode/plugins/engram.ts"`,
  "    exit 0 ;;",
  "  *) exit 64 ;;",
  "esac",
  ""
].join("\n");
var FIXTURE_PREFIX = "oso-opencode-verify.";
var TEMPORARY_PARENT_UNAVAILABLE = "temporary-parent-unavailable";
var DECOY_CONFIG_TEXT = '{"theme":"decoy"}';
function verifyOpenCode(input) {
  const report2 = new VerifyReport();
  report2.section(LOCAL_CHECKS_SECTION2);
  checkPinnedOpenCodeVersion(report2, input.host);
  const staged = stageOpenCodeFixture(input);
  if (staged.kind === "failed") {
    report2.check("isolated fixture install", "ready", staged.result);
    report2.skip(FIXTURE_ROWS_SKIP);
  } else {
    report2.check("isolated fixture install", "ready", "ready");
    try {
      checkInstalledTree(report2, input, staged.tree);
    } finally {
      rmSync11(staged.tree.root, { recursive: true, force: true });
    }
  }
  checkPluginWorkspaceBar(report2, input);
  checkRepositoryShellSyntax(report2, input);
  return { report: report2.render(), exitCode: report2.exitCode };
}
function checkInstalledTree(report2, input, tree) {
  const sources = openCodePayloadSources(input.repositoryRoot);
  const configFile = path16.join(tree.configHome, "opencode.json");
  const globalFile = path16.join(tree.configHome, "AGENTS.md");
  report2.check("OpenCode config contract", "valid", openCodeConfigStatus(configFile));
  report2.check("operator config keys survive an install", "preserved", openCodeOperatorKeysStatus(configFile));
  report2.check("nine skill wrappers and shared bodies installed", "exact", openCodeSkillStatus(input.repositoryRoot, tree.configHome));
  report2.check("agent contracts installed", "exact", openCodeAgentStatus(input.repositoryRoot, tree.configHome));
  report2.check("mode commands installed and routed", "exact", openCodeCommandStatus(input.repositoryRoot, tree.configHome));
  report2.check("plugin entry, modules and routes installed", "exact", openCodePluginStatus(input.repositoryRoot, tree.configHome));
  report2.check("Engram plugin file installed", "present", openCodeEngramStatus(tree.configHome));
  report2.check("global guidance installed", "exact", openCodeGlobalStatus(globalFile, readFileSync15(sources.global, "utf8")));
  report2.check("operator global prose survives an install", "preserved", openCodeOperatorGlobalStatus(globalFile, operatorGlobalSeed()));
  report2.check("installer-owned targets recorded", "installer-owned", openCodeRegistryStatus(tree.home, tree.configHome));
  report2.check("published gate bytes as installed", "verified", openCodeTrustBytesStatus(sources.publishedHashes, tree.configHome));
  report2.check("an install outside the named home is refused", "refused", openCodeConfigHomeGuardStatus(input, tree));
}
function checkPinnedOpenCodeVersion(report2, host) {
  const version = openCodeVersionStatus(host);
  if (version === OPENCODE_NOT_ON_PATH) {
    report2.skip(VERSION_ROW_SKIP);
    return;
  }
  if (!meetsVersionFloor(version, SUPPORTED_OPENCODE_VERSION)) {
    report2.check("OpenCode CLI version", `${SUPPORTED_OPENCODE_VERSION} or newer`, version, `npm install --global opencode-ai@${SUPPORTED_OPENCODE_VERSION}`);
    return;
  }
  report2.check("OpenCode CLI version", version, version);
  if (isAboveTestedVersion(version, SUPPORTED_OPENCODE_VERSION)) {
    report2.note(`OpenCode ${version} is newer than the ${SUPPORTED_OPENCODE_VERSION} this release was verified against, so the rows below are asserted against a host nothing here measured`);
  }
}
function stageOpenCodeFixture(input) {
  const parent = input.environment["TMPDIR"] ?? tmpdir4();
  if (!isDirectory(parent)) return { kind: "failed", result: TEMPORARY_PARENT_UNAVAILABLE };
  const root = mkdtempSync6(path16.join(parent, FIXTURE_PREFIX));
  const home = path16.join(root, "home");
  const configHome = path16.join(home, ".config", "opencode");
  mkdirSync9(configHome, { recursive: true });
  writeFileSync9(path16.join(configHome, "opencode.json"), `${JSON.stringify(operatorConfigSeed(), null, 2)}
`);
  writeFileSync9(path16.join(configHome, "AGENTS.md"), operatorGlobalSeed());
  writeFixtureEngramShim(fixtureShimsIn(root));
  const outcome = installOpenCode({
    homeDirectory: home,
    repositoryRoot: input.repositoryRoot,
    environment: fixtureEnvironmentFor(input.environment, home, root),
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false
  });
  if (outcome.exitCode === 0) return { kind: "ready", tree: { root, home, configHome } };
  rmSync11(root, { recursive: true, force: true });
  return { kind: "failed", result: `install-failed:${lastReportLine(outcome.report)}` };
}
function fixtureShimsIn(root) {
  return path16.join(root, FIXTURE_SHIMS_DIRECTORY);
}
function writeFixtureEngramShim(directory) {
  mkdirSync9(directory, { recursive: true });
  const shim = path16.join(directory, ENGRAM_BINARY_NAME);
  writeFileSync9(shim, FIXTURE_ENGRAM_SHIM);
  chmodSync3(shim, FIXTURE_SHIM_MODE);
  return shim;
}
function fixtureEnvironmentFor(environment, home, root) {
  const inherited = environment["PATH"] ?? "";
  const shims = fixtureShimsIn(root);
  return {
    ...environment,
    PATH: inherited === "" ? shims : `${shims}${path16.delimiter}${inherited}`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path16.join(root, "tmp"),
    XDG_CONFIG_HOME: path16.join(home, ".config"),
    XDG_STATE_HOME: path16.join(home, ".local", "state"),
    XDG_CACHE_HOME: path16.join(home, ".cache"),
    XDG_DATA_HOME: path16.join(home, ".local", "share")
  };
}
function openCodeVersionStatus(host) {
  return host.version ?? OPENCODE_NOT_ON_PATH;
}
function openCodeConfigStatus(configFile) {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "malformed";
  const document = read.value;
  if (!Array.isArray(document["plugin"])) return "malformed";
  const servers = document["mcp"];
  if (servers !== void 0 && !isPlainObject(servers)) return "malformed";
  for (const server of Object.values(isPlainObject(servers) ? servers : {})) {
    if (!isPlainObject(server) || "env" in server) return "malformed";
  }
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  const skills = isPlainObject(permission["skill"]) ? permission["skill"] : {};
  if (OWNED_SKILL_MODES.some((mode) => skills[mode] !== OWNED_SKILL_VERDICT)) return "malformed";
  for (const grantBoundTool of ["oso_plan_approve", "oso_plan_cancel"]) {
    if (permission[grantBoundTool] !== OWNED_PERMISSION_VALUES[grantBoundTool]) return "malformed";
  }
  return "valid";
}
function operatorConfigSeed() {
  return {
    theme: OPERATOR_CONFIG_PROBE.theme,
    permission: { [OPERATOR_CONFIG_PROBE.permissionKey]: OPERATOR_CONFIG_PROBE.permissionVerdict },
    mcp: {
      [OPERATOR_CONFIG_PROBE.mcpServerName]: {
        type: "local",
        command: [...OPERATOR_CONFIG_PROBE.mcpServerCommand],
        enabled: true,
        environment: {}
      }
    }
  };
}
function openCodeOperatorKeysStatus(configFile) {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "dropped";
  const document = read.value;
  if (document["theme"] !== OPERATOR_CONFIG_PROBE.theme) return "dropped";
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  if (permission[OPERATOR_CONFIG_PROBE.permissionKey] !== OPERATOR_CONFIG_PROBE.permissionVerdict) return "dropped";
  const servers = isPlainObject(document["mcp"]) ? document["mcp"] : {};
  const server = servers[OPERATOR_CONFIG_PROBE.mcpServerName];
  if (!isPlainObject(server)) return "dropped";
  if (JSON.stringify(server["command"]) !== JSON.stringify(OPERATOR_CONFIG_PROBE.mcpServerCommand)) return "dropped";
  return "preserved";
}
function operatorGlobalSeed() {
  return `# Personal OpenCode rules

${OPERATOR_GLOBAL_PROSE}
`;
}
function openCodeGlobalStatus(globalFile, expectedBody) {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const installed = markerRegionBodyOf(readFileSync15(globalFile, "utf8"));
  if (installed === void 0) return "malformed";
  return withoutTrailingNewlines(installed) === withoutTrailingNewlines(expectedBody) ? "exact" : "divergent";
}
function openCodeOperatorGlobalStatus(globalFile, seedText) {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const seedRecords = seedText.split("\n").length - 1;
  const head = readFileSync15(globalFile, "utf8").split("\n").slice(0, seedRecords).join("\n");
  return `${head}
` === seedText ? "preserved" : "rewritten";
}
function openCodeSkillStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const wrappers = osoPrefixedNames(sources.skills).filter((name) => isReadableRegularFile(path16.join(sources.skills, name, "SKILL.md")));
  const divergent = wrappers.filter((name) => !filesHoldTheSameBytes(path16.join(sources.skills, name, "SKILL.md"), path16.join(configHome, "skill", name, "SKILL.md")));
  if (wrappers.length !== EXPECTED_SKILL_WRAPPER_COUNT) return `wrapper-count:${wrappers.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  if (!isDirectory(path16.join(configHome, "skill", "_shared", "bodies"))) return "missing-shared-bodies";
  if (!isDirectory(path16.join(configHome, "skill", "_shared", "platform", "opencode"))) return "missing-platform";
  return treesHoldTheSameBytes(sources.sharedSkills, path16.join(configHome, "skill", "_shared")) ? "exact" : "shared-differs";
}
function openCodeAgentStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const published = osoPrefixedMarkdownNames2(sources.agents);
  const installed = osoPrefixedMarkdownNames2(path16.join(configHome, "agent"));
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path16.join(sources.agents, name), path16.join(configHome, "agent", name)));
  if (published.length !== installed.length) return `count:${published.length}!=${installed.length}`;
  return divergent.length === 0 ? "exact" : namedList("divergent", divergent);
}
function openCodeCommandStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const published = osoPrefixedMarkdownNames2(sources.commands);
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path16.join(sources.commands, name), path16.join(configHome, "command", name)));
  if (published.length !== EXPECTED_MODE_COMMAND_COUNT) return `count:${published.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  for (const mode of OWNED_SKILL_MODES) {
    const route = agentRouteOf(path16.join(configHome, "command", `${mode}.md`));
    if (route !== MODE_COMMAND_AGENT_ROUTE) return `route:${mode}=${route === "" ? "empty" : route}`;
  }
  return "exact";
}
function openCodePluginStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  if (!filesHoldTheSameBytes(sources.pluginBundle, path16.join(configHome, "plugin", "oso-code.js"))) return "entry-divergent";
  const unbundled = directoryEntryNames2(path16.join(configHome, "plugin")).filter((name) => name.endsWith(".ts") || name === "oso");
  return unbundled.length === 0 ? "exact" : `unbundled-sources:${unbundled.length}`;
}
function openCodeEngramStatus(configHome) {
  return isReadableRegularFile(path16.join(configHome, "plugins", "engram.ts")) ? "present" : "missing";
}
function openCodeRegistryStatus(home, configHome) {
  const paths = opencodePathsFor(home, { XDG_CONFIG_HOME: path16.dirname(configHome) });
  const targets = openCodeInstallTargets(paths);
  if (!isReadableRegularFile(targets.ownerRegistry)) return "missing";
  const owned = new Set(
    readFileSync15(targets.ownerRegistry, "utf8").split("\n").filter((row) => row.startsWith(`${OWNER_INSTALLER}	`)).map((row) => row.slice(OWNER_INSTALLER.length + 1))
  );
  const expected = [
    paths.configFile,
    paths.globalFile,
    targets.skills,
    targets.agents,
    targets.commands,
    targets.plugin,
    path16.join(targets.stateBin, "oso-state"),
    path16.join(targets.gitHooks, "pre-commit"),
    ...directoryEntryNames2(targets.hooks).filter((name) => name.endsWith(".sh")).map((name) => path16.join(targets.hooks, name))
  ];
  const missing = expected.filter((target) => installedTargetExists(target) && !owned.has(target)).map((target) => relativeToHome(target, home));
  return missing.length === 0 ? "installer-owned" : namedList("missing", missing);
}
function openCodeTrustBytesStatus(publishedHashes, configHome) {
  const reading = openCodeTrustReading(publishedHashes, "installed", configHome);
  if (reading.divergences.length > 0) return `bad:${foldedLines(reading.divergences.map(trustDivergenceLine))}`;
  return reading.filesRead === OPENCODE_TRUST_FILE_COUNT ? "verified" : `covers:${reading.filesRead}`;
}
function openCodeConfigHomeGuardStatus(input, tree) {
  const decoy = path16.join(tree.root, "decoy-config");
  const decoyConfigHome = path16.join(decoy, "opencode");
  mkdirSync9(decoyConfigHome, { recursive: true });
  writeFileSync9(path16.join(decoyConfigHome, "opencode.json"), `${DECOY_CONFIG_TEXT}
`);
  const outcome = installOpenCode({
    homeDirectory: tree.home,
    repositoryRoot: input.repositoryRoot,
    environment: { ...fixtureEnvironmentFor(input.environment, tree.home, tree.root), XDG_CONFIG_HOME: decoy },
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false
  });
  if (outcome.exitCode !== 2) return `exit:${outcome.exitCode}`;
  if (readFileSync15(path16.join(decoyConfigHome, "opencode.json"), "utf8").trim() !== DECOY_CONFIG_TEXT) return "overwrote-the-decoy-config";
  const entries = directoryEntryNames2(decoyConfigHome).length;
  return entries === 1 ? "refused" : `wrote-into-the-decoy:${entries}`;
}
function checkPluginWorkspaceBar(report2, input) {
  const workspace = path16.join(input.repositoryRoot, "opencode");
  if (!isReadableRegularFile(path16.join(workspace, "package.json")) || !onPath(input.environment, "npx")) {
    report2.skip("OpenCode plugin typecheck \u2014 npx or opencode/package.json is not available");
  } else {
    report2.check("OpenCode plugin typecheck", "clean", ranCleanly("npx", ["tsc", "--noEmit"], workspace, input.environment) ? "clean" : "fail");
  }
  if (!onPath(input.environment, "node")) {
    report2.skip("OpenCode plugin test suite \u2014 node is not available");
    return;
  }
  report2.check("OpenCode plugin test suite", "pass", ranCleanly("node", ["--test"], workspace, input.environment) ? "pass" : "fail");
}
function checkRepositoryShellSyntax(report2, input) {
  const unparseable = shellSourcesUnder(input.repositoryRoot).filter((source) => !ranCleanly("bash", ["-n", source], input.repositoryRoot, input.environment)).map((source) => path16.basename(source));
  report2.check("repository shell syntax", "clean", unparseable.length === 0 ? "clean" : namedList("bad", unparseable));
}
function shellSourcesUnder(repositoryRoot2) {
  const globbed = SHELL_SYNTAX_SOURCES.flatMap((source) => {
    const directory = path16.join(repositoryRoot2, ...source.directory);
    return directoryEntryNames2(directory).filter((name) => name.endsWith(source.suffix)).map((name) => path16.join(directory, name));
  });
  const named = SHELL_SYNTAX_EXTRA_SOURCES.map((segments) => path16.join(repositoryRoot2, ...segments));
  return [...globbed, ...named].filter(isReadableRegularFile);
}
function readConfigDocument(configFile) {
  if (!isReadableRegularFile(configFile)) return { kind: "missing" };
  try {
    return { kind: "parsed", value: readJsonFile(configFile) };
  } catch (error) {
    if (error instanceof JsonParseError) return { kind: "unparseable" };
    throw error;
  }
}
function markerRegionBodyOf(content) {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const body = [];
  let starts = 0;
  let ends = 0;
  let inside = false;
  for (const record of records) {
    if (record === GLOBAL_MARKER_START2) {
      starts += 1;
      inside = true;
      continue;
    }
    if (record === GLOBAL_MARKER_END2) {
      ends += 1;
      inside = false;
      continue;
    }
    if (inside) body.push(record);
  }
  if (starts !== 1 || ends !== 1 || inside) return void 0;
  return body.join("\n");
}
function withoutTrailingNewlines(text) {
  return text.replace(/\n+$/, "");
}
function agentRouteOf(commandFile) {
  if (!isReadableRegularFile(commandFile)) return "";
  const routed = readFileSync15(commandFile, "utf8").split("\n").flatMap((line) => {
    const match = /^agent:[ \t]*(.*)$/.exec(line);
    return match === null ? [] : [match[1]];
  });
  return routed[0] ?? "";
}
function treesHoldTheSameBytes(published, installed) {
  const publishedFiles = relativeFilesUnder(published);
  const installedFiles = relativeFilesUnder(installed);
  if (publishedFiles.length !== installedFiles.length) return false;
  return publishedFiles.every(
    (relative, index) => relative === installedFiles[index] && filesHoldTheSameBytes(path16.join(published, relative), path16.join(installed, relative))
  );
}
function relativeFilesUnder(directory) {
  if (!isDirectory(directory)) return [];
  return readdirSync6(directory, { recursive: true }).map((entry) => entry.toString()).filter((relative) => isReadableRegularFile(path16.join(directory, relative))).sort();
}
function installedTargetExists(target) {
  return isReadableRegularFile(target) || isDirectory(target);
}
function relativeToHome(target, home) {
  return target.startsWith(`${home}${path16.sep}`) ? target.slice(home.length + 1) : target;
}
function directoryEntryNames2(directory) {
  try {
    return readdirSync6(directory).sort();
  } catch {
    return [];
  }
}
function osoPrefixedNames(directory) {
  return directoryEntryNames2(directory).filter((name) => name.startsWith("oso-"));
}
function osoPrefixedMarkdownNames2(directory) {
  return osoPrefixedNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path16.join(directory, name)));
}
function namedList(verdict, names) {
  return `${verdict}:${names.map((name) => ` ${name}`).join("")}`;
}
function foldedLines(lines) {
  return lines.join(" ").replace(/\s+/g, " ").replace(/\s+$/, "");
}
function onPath(environment, binaryName) {
  return spawnSync9(binaryName, ["--version"], { env: environment, encoding: "utf8" }).error === void 0;
}
function ranCleanly(command, argv, workingDirectory, environment) {
  const run = spawnSync9(command, [...argv], { cwd: workingDirectory, env: environment, encoding: "utf8" });
  return run.error === void 0 && run.status === 0;
}
function lastReportLine(report2) {
  const lines = report2.split("\n").filter((line) => line !== "");
  return lines.at(-1) ?? "";
}

// core/src/install/cli.ts
var VERBS = ["install", "verify", "repair", "purge"];
var HOSTS = ["claude", "codex", "opencode"];
var YES = { name: "--yes" };
var LIST = { name: "--list" };
var NO_IMPECCABLE = { name: "--no-impeccable" };
var NO_GIT_HOOK = { name: "--no-git-hook" };
var REPLACE_CLAUDE_MD = { name: "--replace-claude-md" };
var DRY_RUN = { name: "--dry-run" };
var KEEP_GENTLE_AI = { name: "--keep-gentle-ai" };
var RESTORE = { name: "--restore", valueMissingMessage: "--restore requires a backup directory" };
var NO_ARGUMENTS = { flags: [] };
var YES_ONLY = { flags: [YES] };
var ONE_BACKUP_NAME = { name: "<backup>", repeatMessage: "only one backup name may be given" };
var PURGE_OPENCODE_EXCLUSIONS = [
  { first: "--restore", second: "--yes", message: "--yes cannot be combined with --restore" },
  { first: "--dry-run", second: "--yes", message: "--yes cannot be combined with --dry-run" },
  { first: "--restore", second: "--dry-run", message: "--dry-run cannot be combined with --restore" },
  { first: "--yes", second: "--dry-run", message: "--dry-run cannot be combined with --yes" },
  { first: "--restore", second: "--keep-gentle-ai", message: "--keep-gentle-ai cannot be combined with --restore" },
  { first: "--restore", second: "--restore", message: "--restore may be specified only once" },
  { first: "--yes", second: "--restore", message: "--yes cannot be combined with --restore" },
  { first: "--dry-run", second: "--restore", message: "--dry-run cannot be combined with --restore" }
];
var FLAGS_PER_HOST_AND_VERB = {
  claude: {
    install: { flags: [YES, REPLACE_CLAUDE_MD, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: YES_ONLY,
    purge: YES_ONLY
  },
  codex: {
    install: { flags: [YES, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: YES_ONLY,
    purge: YES_ONLY
  },
  opencode: {
    install: { flags: [YES, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: { flags: [YES, LIST], positional: ONE_BACKUP_NAME },
    purge: { flags: [YES, DRY_RUN, KEEP_GENTLE_AI, RESTORE], exclusions: PURGE_OPENCODE_EXCLUSIONS }
  }
};
var EVERY_DECLARED_FLAG = new Set(
  HOSTS.flatMap((host) => VERBS.flatMap((verb) => FLAGS_PER_HOST_AND_VERB[host][verb].flags.map((flag) => flag.name)))
);
var USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [flags]

arguments, per host and verb:
${HOSTS.flatMap((host) => VERBS.map((verb) => `  ${host.padEnd(9)} ${verb.padEnd(8)} ${argumentSummary(FLAGS_PER_HOST_AND_VERB[host][verb])}`)).join("\n")}

A flag offered to a host and verb that does not take it is refused, never ignored.
`;
var UsageError = class extends Error {
};
var FlagNotOfferedError = class extends Error {
  flag;
  host;
  verb;
  constructor(flag, host, verb) {
    const taken = FLAGS_PER_HOST_AND_VERB[host][verb].flags.map((spec) => spec.name);
    const takes = taken.length === 0 ? "no flags at all" : taken.join(", ");
    super(`${flag} is not a flag the ${host} host takes for ${verb} \u2014 it takes ${takes}`);
    this.name = "FlagNotOfferedError";
    this.flag = flag;
    this.host = host;
    this.verb = verb;
  }
};
var ArgumentsExcludedError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ArgumentsExcludedError";
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
  const homeDirectory = homeDirectoryFrom(process.platform, process.env);
  const context = {
    homeDirectory,
    repositoryRoot: repositoryRoot2,
    environment: process.env,
    platform: process.platform,
    assumeYes: parsed.flags.has("--yes"),
    installImpeccable: !parsed.flags.has("--no-impeccable"),
    installGitHook: !parsed.flags.has("--no-git-hook")
  };
  const outcome = runHost(parsed, context);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
}
function runHost(parsed, context) {
  switch (parsed.host) {
    case "claude":
      return runClaude(parsed.verb, { ...context, architecture: process.arch, replaceClaudeMd: parsed.flags.has("--replace-claude-md") });
    case "codex":
      return runCodex(parsed.verb, { ...context, host: codexHostProbes(process.env) });
    case "opencode":
      return runOpenCode(parsed, context);
  }
}
function runClaude(verb, context) {
  switch (verb) {
    case "verify":
      return verifyClaude(context);
    case "install":
      return installClaude(context);
    case "repair":
      return repairClaude(context);
    case "purge":
      return purgeClaude(context);
  }
}
function runCodex(verb, context) {
  switch (verb) {
    case "verify":
      return verifyCodex(context);
    case "install":
      return installCodex(context);
    case "repair":
      return repairCodex(context);
    case "purge":
      return purgeCodex(context);
  }
}
function runOpenCode(parsed, context) {
  switch (parsed.verb) {
    case "install":
      return installOpenCode({
        homeDirectory: context.homeDirectory,
        repositoryRoot: context.repositoryRoot,
        environment: context.environment,
        platform: context.platform,
        host: openCodeHostProbes(context.environment),
        assumeYes: context.assumeYes,
        installImpeccable: context.installImpeccable,
        installGitHook: context.installGitHook
      });
    case "verify":
      return verifyOpenCode({
        homeDirectory: context.homeDirectory,
        repositoryRoot: context.repositoryRoot,
        environment: context.environment,
        platform: context.platform,
        host: openCodeHostProbes(context.environment)
      });
    case "repair":
      return repairOpenCode({
        homeDirectory: context.homeDirectory,
        environment: context.environment,
        assumeYes: context.assumeYes,
        listBackups: parsed.flags.has("--list"),
        backupName: parsed.positional
      });
    case "purge":
      return purgeOpenCode({
        homeDirectory: context.homeDirectory,
        environment: context.environment,
        assumeYes: context.assumeYes,
        dryRun: parsed.flags.has("--dry-run"),
        keepGentleAi: parsed.flags.has("--keep-gentle-ai"),
        restoreFrom: parsed.values.get("--restore")
      });
  }
}
function report(error) {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
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
  const host = hostIn(rest);
  const declared = FLAGS_PER_HOST_AND_VERB[host][verbToken];
  const flags = /* @__PURE__ */ new Set();
  const values = /* @__PURE__ */ new Map();
  let positional;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--host") {
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      if (declared.positional === void 0) throw new UsageError();
      if (positional !== void 0) throw new ArgumentsExcludedError(declared.positional.repeatMessage);
      positional = token;
      continue;
    }
    const spec = declared.flags.find((candidate) => candidate.name === token);
    if (spec === void 0) {
      if (EVERY_DECLARED_FLAG.has(token)) throw new FlagNotOfferedError(token, host, verbToken);
      throw new UsageError();
    }
    refuseExcluded(declared, flags, token);
    if (spec.valueMissingMessage !== void 0) {
      const value = rest[index + 1];
      if (value === void 0) throw new ArgumentsExcludedError(spec.valueMissingMessage);
      values.set(token, value);
      index += 1;
    }
    flags.add(token);
  }
  return { verb: verbToken, host, flags, values, positional };
}
function refuseExcluded(declared, seen, token) {
  const excluded = (declared.exclusions ?? []).find((rule) => rule.second === token && seen.has(rule.first));
  if (excluded !== void 0) throw new ArgumentsExcludedError(excluded.message);
}
function hostIn(rest) {
  const at = rest.indexOf("--host");
  const host = at === -1 ? void 0 : rest[at + 1];
  if (!isHost(host)) throw new UsageError();
  return host;
}
function argumentSummary(declared) {
  const flags = declared.flags.map((spec) => spec.valueMissingMessage === void 0 ? spec.name : `${spec.name} <dir>`);
  const positional = declared.positional === void 0 ? [] : [`[${declared.positional.name}]`];
  return [...flags, ...positional].join(" ") || "(no arguments)";
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
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
