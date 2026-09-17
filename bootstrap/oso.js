// core/src/bin/oso.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// core/src/state/store.ts
import { execFileSync } from "node:child_process";
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
var StateFileUnreadableError = class extends Error {
  stateFile;
  constructor(stateFile, cause) {
    super(`cannot read state at ${stateFile}: ${cause}`);
    this.name = "StateFileUnreadableError";
    this.stateFile = stateFile;
  }
};
var MODEL_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/:._@-]*$/;
var TOKEN_MAX_LENGTH = 128;
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stateRootDirectory() {
  const configured = process.env["OSO_STATE_DIR"];
  if (configured !== void 0 && configured !== "") return configured;
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}
function repositoryIdentityFor(cwd) {
  const directory = cwd.replace(/\r$/, "");
  return gitCommonDirectory(directory) || directory;
}
function stateFileFor(cwd) {
  return path.join(stateRootDirectory(), `${sha256Hex(repositoryIdentityFor(cwd))}.state`);
}
function repositoryIdFor(stateFile) {
  return path.basename(stateFile, ".state");
}
function profileFileFor(stateFile) {
  return path.join(stateRootDirectory(), "profiles", `${repositoryIdFor(stateFile)}.profile`);
}
var MODEL_TOKEN_SHAPE = `1 to ${TOKEN_MAX_LENGTH} characters of letters, digits and / : . - _ @`;
function isModelToken(value) {
  return value.length >= 1 && value.length <= TOKEN_MAX_LENGTH && MODEL_TOKEN_PATTERN.test(value);
}
function stateRecords(content, key) {
  const prefix = `${key}=`;
  return content.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}
function stateValue(content, key) {
  return stateRecords(content, key).join("\n");
}
function readStateFile(stateFile) {
  try {
    if (!statSync(stateFile).isFile()) return { kind: "unreadable", cause: `${stateFile} is not a regular file` };
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
  }
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
function homeDirectory() {
  return homeDirectoryFrom(process.platform, process.env);
}
function gitCommonDirectory(cwd) {
  try {
    const output = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.replace(/\n+$/, "");
  } catch {
    return "";
  }
}
function causeOf(error) {
  return error instanceof Error ? error.message : String(error);
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

// core/src/install/claude.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7, readdirSync as readdirSync3, rmSync as rmSync5, statSync as statSync4, writeFileSync as writeFileSync5 } from "node:fs";
import path6 from "node:path";

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

// core/src/install/engram.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdirSync as mkdirSync4, mkdtempSync as mkdtempSync2, readFileSync as readFileSync6, renameSync as renameSync2, rmSync as rmSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import path5 from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

// core/src/install/verify-claude.ts
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync as mkdirSync3, mkdtempSync, openSync, readFileSync as readFileSync4, readSync, readdirSync as readdirSync2, rmSync as rmSync3, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
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
  const { homeDirectory: homeDirectory2, repositoryRoot: repositoryRoot2, environment, platform } = input;
  const claudeDir = path4.join(homeDirectory2, ".claude");
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
  checkImpeccablePluginInstalled(report2, homeDirectory2, pluginListing);
  checkImpeccableCliRunnable(report2, environment);
  checkGitCommitHook(report2, repositoryRoot2, environment);
  checkNoCarriageReturnBytes(report2, repositoryRoot2);
  checkWindowsHomeDirectory(report2, environment);
  checkEngramBinaryResolves(report2, environment, platform);
  checkGitBashPath(report2, claudeDir);
  noteClaudeDesktop(report2, homeDirectory2, environment);
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
function impeccableOptOutMarker(homeDirectory2) {
  return path4.join(homeDirectory2, ".local", "state", "oso-code", "impeccable-opt-out");
}
function checkImpeccablePluginInstalled(report2, homeDirectory2, pluginListing) {
  const marker = impeccableOptOutMarker(homeDirectory2);
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
function noteClaudeDesktop(report2, homeDirectory2, environment) {
  const locations = claudeDesktopLocations(homeDirectory2, environment);
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
function claudeDesktopLocations(homeDirectory2, environment) {
  return [
    "/Applications/Claude.app",
    path4.join(homeDirectory2, "Library", "Application Support", "Claude"),
    path4.join(environment["LOCALAPPDATA"] ?? path4.join(homeDirectory2, "AppData", "Local"), "AnthropicClaude"),
    path4.join(environment["APPDATA"] ?? path4.join(homeDirectory2, "AppData", "Roaming"), "Claude"),
    path4.join(homeDirectory2, ".config", "Claude")
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

// core/src/install/pins.ts
var SUPPORTED_ENGRAM_VERSION = "1.20.0";
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
  writeFileSync4(pending, content, { mode: 493 });
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
      return readFileSync6(destination);
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
  if (!input.assumeYes) return requiresYes("install");
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
  const mcpRemove = spawnSync3("claude", ["mcp", "remove", "--scope", "user", "fallow"], { env: input.environment, encoding: "utf8" });
  wiring.push(
    mcpRemove.error === void 0 && mcpRemove.status === 0 ? wiringOk("fallow (mcp)", "removed") : wiringFail("fallow (mcp)", `nothing removed, or already absent: ${collapsedOutput(mcpRemove)}`)
  );
  return { report: claudeReport("purge", infoLines, wiring), exitCode: 0 };
}
function backupsRootOf(homeDirectory2) {
  return path6.join(homeDirectory2, ".local", "state", "oso-code", "claude-backups");
}
function backupClientConfigTargets(homeDirectory2, claudeDir) {
  const targets = [{ label: "claude-json", target: path6.join(homeDirectory2, ".claude.json") }];
  const pluginsDir = path6.join(claudeDir, "plugins");
  if (!isDirectory(pluginsDir)) return targets;
  for (const name of readdirSync3(pluginsDir).filter((entry) => entry.endsWith(".json"))) {
    targets.push({ label: `plugins-json-${name}`, target: path6.join(pluginsDir, name) });
  }
  return targets;
}
function legacyArtifactTargets(repositoryRoot2, claudeDir) {
  const manifestFile = path6.join(repositoryRoot2, "bootstrap", "gentle-manifest.txt");
  const content = readFileSync7(manifestFile, "utf8");
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
  const prefix = shouldMerge ? `${withoutMarkerRegion(readFileSync7(claudeMdFile, "utf8"))}
` : "";
  const content = `${prefix}${CLAUDE_MD_MARKER_START}
${blockBody}${CLAUDE_MD_MARKER_END}
`;
  writeFileAtomically(path6.dirname(claudeMdFile), claudeMdFile, content, ".oso-claude-md-");
}
function stripClaudeMdRegion(claudeMdFile) {
  if (!isReadableRegularFile(claudeMdFile)) return false;
  const content = readFileSync7(claudeMdFile, "utf8");
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
  return readFileSync7(path6.join(repositoryRoot2, "bootstrap", "claude-global.md"), "utf8");
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
function wireFallow(environment, homeDirectory2, platform) {
  const fallowCommand = resolveFallowMcpCommand(environment, homeDirectory2, platform) ?? "fallow-mcp";
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
function resolveFallowMcpCommand(environment, homeDirectory2, platform) {
  if (platform === "win32") {
    const appdata = environment["APPDATA"];
    if (appdata !== void 0 && appdata !== "") {
      const prefix = npmGlobalPrefix(environment) ?? path6.join(appdata, "npm");
      const candidate = path6.join(prefix, "fallow-mcp.cmd");
      if (isExecutableRegularFile(candidate)) return candidate;
    }
  }
  const onPath2 = firstExecutableOnPath(environment, "fallow-mcp");
  if (onPath2 !== void 0) return onPath2;
  const cargoCandidates = [path6.join(homeDirectory2, ".cargo", "bin", "fallow-mcp"), path6.join(homeDirectory2, ".cargo", "bin", "fallow-mcp.exe")];
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
function wireImpeccable(environment, homeDirectory2) {
  rmSync5(impeccableOptOutMarker(homeDirectory2), { force: true });
  spawnSync3("claude", ["plugin", "marketplace", "add", "pbakaus/impeccable"], { env: environment, encoding: "utf8" });
  const install = spawnSync3("claude", ["plugin", "install", "impeccable@impeccable"], { env: environment, encoding: "utf8" });
  if (install.error !== void 0 || install.status !== 0) {
    return wiringFail("impeccable (plugin)", `install failed: ${collapsedOutput(install)} \u2014 fix: claude plugin install impeccable@impeccable`);
  }
  const listing = spawnSync3("claude", ["plugin", "list"], { env: environment, encoding: "utf8" });
  const installed = listing.error === void 0 && listing.stdout.includes("impeccable");
  return installed ? wiringOk("impeccable (plugin)", "installed") : wiringFail("impeccable (plugin)", "the install reported success but the client lists no impeccable plugin \u2014 fix: claude plugin install impeccable@impeccable, then restart Claude Code");
}
function skipImpeccable(homeDirectory2) {
  const marker = impeccableOptOutMarker(homeDirectory2);
  mkdirSync5(path6.dirname(marker), { recursive: true });
  writeFileSync5(marker, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}
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

// core/src/install/opencode.ts
import { readFileSync as readFileSync8 } from "node:fs";
import path7 from "node:path";

// core/src/install/opencode-config.ts
var OPENCODE_CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";
var CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";
var OWNED_SKILL_MODES = ["oso-plan", "oso-quick", "oso-debug", "oso-roadmap"];
var OWNED_SKILL_VERDICT = "deny";
var OWNED_TASK_PATTERN = "*";
var OWNED_TASK_VERDICT = "allow";
var HARNESS_EXTERNAL_DIRECTORIES = ["~/.config/opencode/skill/**", "~/.local/share/opencode/worktree/**"];
var HARNESS_EXTERNAL_DIRECTORY_VERDICT = "allow";
var HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT = ["**/.config/opencode/skill/**", "**/.local/state/oso-code/**"];
var HARNESS_OWNED_TREE_EDIT_VERDICT = "deny";
var HOST_SURFACES_NO_HARNESS_GRANT_MAY_REACH = [
  "~/.config/opencode/plugin",
  "~/.config/opencode/plugins",
  "~/.config/opencode/bin",
  "~/.config/opencode/hooks",
  "~/.config/opencode/git-hooks",
  "~/.config/opencode/opencode.json",
  "~/.local/state/oso-code",
  "**/.opencode/plugin",
  "**/.opencode/plugins"
];
var REACHES_THE_EDIT_CONTROL_BOUNDS = [
  { pattern: "~/.config/opencode/skill/**", surface: "**/.opencode/plugin" },
  { pattern: "~/.config/opencode/skill/**", surface: "**/.opencode/plugins" },
  { pattern: "~/.local/share/opencode/worktree/**", surface: "**/.opencode/plugin" },
  { pattern: "~/.local/share/opencode/worktree/**", surface: "**/.opencode/plugins" }
];
var EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH = [
  { pattern: "*", verdict: "allow" },
  { pattern: ".config/opencode/**", verdict: "deny" },
  { pattern: "**/.config/opencode/**", verdict: "deny" },
  { pattern: ".opencode/**", verdict: "deny" },
  { pattern: "**/.opencode/**", verdict: "deny" },
  { pattern: ".git/**", verdict: "deny" },
  { pattern: "**/.git/**", verdict: "deny" },
  { pattern: ".local/state/oso-code/**", verdict: "deny" },
  { pattern: "**/.local/state/oso-code/**", verdict: "deny" }
];
var EDIT_CONTROL_BOUNDING_A_REACH = `edit denied on ${EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter(
  (rule) => rule.verdict === "deny"
).map((rule) => rule.pattern).join(" ")}`;
var OWNED_PERMISSION_VALUES = {
  question: "allow",
  plan_enter: "allow",
  plan_exit: "allow",
  oso_plan_approve: "ask",
  oso_plan_cancel: "ask"
};
var OWNED_MCP_NAMES = ["context7", "engram", "fallow"];
function mcpServerWildcard(server) {
  return `${server}_*`;
}
var SCHEMA_KEY = "$schema";
var PLUGIN_KEY = "plugin";
var PERMISSION_KEY = "permission";
var MCP_KEY = "mcp";
var SKILL_KEY = "skill";
var TASK_KEY = "task";
var EXTERNAL_DIRECTORY_KEY = "external_directory";
var EDIT_KEY = "edit";
var DOOM_LOOP_KEY = "doom_loop";
var HOST_PROMPT_VERDICT = "ask";
var AGENT_KEY = "agent";
var PATH_SEPARATOR = "/";
var SURFACE_AT_ANY_DEPTH_PREFIX = "**/";
var READS_THE_HARNESS_GRANTS_LEAVE_ASKING = [
  { named: "~/.config/opencode/** beyond skill/", probedAt: "~/.config/opencode/plugin" },
  { named: "~/.local/state/oso-code/**", probedAt: "~/.local/state/oso-code" }
];
var NEVER_PRESERVED_KEYS = [PERMISSION_KEY, MCP_KEY, PLUGIN_KEY];
var OPENCODE_SESSION_MODEL_FIELDS = { default: "small_model", strong: "model" };
var OPENCODE_AGENTS_PER_PROFILE_ROLE = {
  applier: ["oso-applier"],
  verifier: ["oso-verifier"],
  judges: ["oso-debt-sweep", "oso-doubt-pass", "oso-security-reviewer", "oso-triage"]
};
var OPENCODE_AGENTS_THE_PROFILE_DRIVES = Object.values(OPENCODE_AGENTS_PER_PROFILE_ROLE).flat();
var EVERY_AGENT_ON_THE_HOST_SESSION_MODEL = "every agent runs on the host session model";
var OpenCodeConfigRefusal = class extends Error {
  reason;
  constructor(reason) {
    super(refusalMessage(reason));
    this.name = "OpenCodeConfigRefusal";
    this.reason = reason;
  }
};
function openCodeAgentModels(existing, profileRoles) {
  const document = isPlainObject(existing) ? existing : {};
  const models = {};
  for (const [role, agents] of Object.entries(OPENCODE_AGENTS_PER_PROFILE_ROLE)) {
    const choice = profileRoles[role];
    if (choice === void 0) continue;
    const named = choice.model ?? sessionModelNamed(document, OPENCODE_SESSION_MODEL_FIELDS[choice.tier]);
    if (named === void 0) continue;
    for (const agent of agents) models[agent] = named;
  }
  return models;
}
function installedAgentModels(existing) {
  const document = isPlainObject(existing) ? existing : {};
  const agents = isPlainObject(document[AGENT_KEY]) ? document[AGENT_KEY] : {};
  const installed = {};
  for (const agent of OPENCODE_AGENTS_THE_PROFILE_DRIVES) {
    const spec = agents[agent];
    const model = isPlainObject(spec) ? spec["model"] : void 0;
    if (typeof model === "string") installed[agent] = model;
  }
  return installed;
}
function sessionModelNamed(document, field) {
  const named = document[field];
  return typeof named === "string" && named !== "" ? named : void 0;
}
function ownedMcpServers(fallowCommand) {
  return {
    context7: { type: "remote", url: CONTEXT7_MCP_URL, enabled: true },
    engram: { type: "local", command: ["engram", "mcp", "--tools=agent"], enabled: true, environment: {} },
    fallow: { type: "local", command: [fallowCommand], enabled: true, environment: {} }
  };
}
function mergeOpenCodeConfig(existing, fallowCommand, profileRoles = {}) {
  const document = parsedConfigObject(existing);
  const agentModels = openCodeAgentModels(document, profileRoles);
  const profileNamesAModel = Object.keys(agentModels).length > 0;
  const ownedContainers = profileNamesAModel ? [...NEVER_PRESERVED_KEYS, AGENT_KEY] : NEVER_PRESERVED_KEYS;
  const preservedKeys = [...foreignKeysOf(document, [], (key) => ownedContainers.includes(key))];
  insertIfMissing(document, SCHEMA_KEY, OPENCODE_CONFIG_SCHEMA_URL);
  createPluginArrayIfAbsent(document);
  const permission = ownedContainer(document, PERMISSION_KEY);
  const ownedPermissionContainers = [SKILL_KEY, TASK_KEY, EXTERNAL_DIRECTORY_KEY, EDIT_KEY];
  preservedKeys.push(...foreignKeysOf(permission, [PERMISSION_KEY], (name) => name in OWNED_PERMISSION_VALUES || ownedPermissionContainers.includes(name)));
  const skills = ownedContainer(permission, SKILL_KEY);
  preservedKeys.push(...foreignKeysOf(skills, [PERMISSION_KEY, SKILL_KEY], (name) => OWNED_SKILL_MODES.includes(name)));
  for (const mode of OWNED_SKILL_MODES) skills[mode] = OWNED_SKILL_VERDICT;
  const delegations = ownedContainer(permission, TASK_KEY);
  preservedKeys.push(...foreignKeysOf(delegations, [PERMISSION_KEY, TASK_KEY], (pattern) => pattern === OWNED_TASK_PATTERN));
  delegations[OWNED_TASK_PATTERN] = OWNED_TASK_VERDICT;
  const externalDirectories = ownedContainer(permission, EXTERNAL_DIRECTORY_KEY);
  const harnessDirectories = HARNESS_EXTERNAL_DIRECTORIES;
  preservedKeys.push(...foreignKeysOf(externalDirectories, [PERMISSION_KEY, EXTERNAL_DIRECTORY_KEY], (pattern) => harnessDirectories.includes(pattern)));
  for (const harnessDirectory of HARNESS_EXTERNAL_DIRECTORIES) externalDirectories[harnessDirectory] = HARNESS_EXTERNAL_DIRECTORY_VERDICT;
  const editRules = ownedContainer(permission, EDIT_KEY);
  const harnessTrees = HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT;
  preservedKeys.push(...foreignKeysOf(editRules, [PERMISSION_KEY, EDIT_KEY], (pattern) => harnessTrees.includes(pattern)));
  for (const harnessTree of HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT) {
    delete editRules[harnessTree];
    editRules[harnessTree] = HARNESS_OWNED_TREE_EDIT_VERDICT;
  }
  Object.assign(permission, OWNED_PERMISSION_VALUES);
  const servers = ownedContainer(document, MCP_KEY);
  const owned = ownedMcpServers(fallowCommand);
  preservedKeys.push(...foreignKeysOf(servers, [MCP_KEY], (name) => name in owned));
  for (const [name, declaration] of Object.entries(owned)) insertIfMissing(servers, name, declaration);
  if (profileNamesAModel) mergeAgentModels(document, preservedKeys, agentModels);
  return { document, preservedKeys, agentModels };
}
function foreignKeysOf(container, containerPath, isInstallerOwned) {
  return Object.keys(container).filter((name) => !isInstallerOwned(name)).map((name) => [...containerPath, name].join("."));
}
function mergeAgentModels(document, preservedKeys, agentModels) {
  const agents = ownedContainer(document, AGENT_KEY);
  preservedKeys.push(...foreignKeysOf(agents, [AGENT_KEY], (name) => name in agentModels));
  for (const [name, model] of Object.entries(agentModels)) ownedContainer(agents, name)["model"] = model;
}
function hostSurfacesReachedBy(patterns) {
  return patterns.flatMap(
    (pattern) => HOST_SURFACES_NO_HARNESS_GRANT_MAY_REACH.filter((surface) => grantReachesSurface(pattern, surface)).map((surface) => ({
      pattern,
      surface
    }))
  );
}
var SURFACES_THE_EDIT_CONTROL_DENIES = [
  ...new Set(
    EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter((rule) => rule.verdict === "deny").map(
      (rule) => literalHeadOf(withoutAnyDepthPrefix(rule.pattern))
    )
  )
];
function editControlDenies(surface) {
  return trailingPathsOf(withoutAnyDepthPrefix(surface)).some(
    (trailing) => SURFACES_THE_EDIT_CONTROL_DENIES.some((denied) => isAtOrUnder(trailing, denied))
  );
}
function withoutAnyDepthPrefix(named) {
  return named.startsWith(SURFACE_AT_ANY_DEPTH_PREFIX) ? named.slice(SURFACE_AT_ANY_DEPTH_PREFIX.length) : named;
}
function literalHeadOf(pattern) {
  const wildcard = pattern.indexOf("*");
  const head = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
  return head.endsWith(PATH_SEPARATOR) ? head.slice(0, -PATH_SEPARATOR.length) : head;
}
var EVERY_WILDCARD_RUN = /\*+/g;
var A_SEGMENT_EVERY_WILDCARD_ADMITS = "any";
var THE_SINGLE_CHARACTER_WILDCARD = /\?/g;
var A_CHARACTER_THE_SINGLE_WILDCARD_ADMITS = "a";
var AT_OR_UNDER_SUFFIX = "/**";
var PATTERN_METACHARACTERS = /[.+^${}()|[\]\\]/g;
var TRAILING_ARGUMENT_WILDCARD = " .*";
var TRAILING_ARGUMENT_MADE_OPTIONAL = "( .*)?";
function grantReachesSurface(grant, surface) {
  return witnessesBetween(grant, surface).some(
    (witness) => hostPatternMatches(grant, witness) && surfaceCovers(surface, witness)
  );
}
function witnessesBetween(grant, surface) {
  const underTheGrant = withWildcardsConcreted(grant);
  if (!surface.startsWith(SURFACE_AT_ANY_DEPTH_PREFIX)) return [underTheGrant, surface];
  return [underTheGrant, [underTheGrant, withoutAnyDepthPrefix(surface)].join(PATH_SEPARATOR)];
}
function withWildcardsConcreted(pattern) {
  return pattern.replace(EVERY_WILDCARD_RUN, A_SEGMENT_EVERY_WILDCARD_ADMITS).replace(THE_SINGLE_CHARACTER_WILDCARD, A_CHARACTER_THE_SINGLE_WILDCARD_ADMITS);
}
function surfaceCovers(surface, witness) {
  return hostPatternMatches(surface, witness) || hostPatternMatches(`${surface}${AT_OR_UNDER_SUFFIX}`, witness);
}
function hostPatternMatches(pattern, resource) {
  const escaped = pattern.replace(PATTERN_METACHARACTERS, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = escaped.endsWith(TRAILING_ARGUMENT_WILDCARD) ? `${escaped.slice(0, -TRAILING_ARGUMENT_WILDCARD.length)}${TRAILING_ARGUMENT_MADE_OPTIONAL}` : escaped;
  return new RegExp(`^${expression}$`, "s").test(resource);
}
function trailingPathsOf(candidate) {
  const segments = candidate.split(PATH_SEPARATOR);
  return segments.map((_, index) => segments.slice(index).join(PATH_SEPARATOR));
}
function isAtOrUnder(candidate, ancestor) {
  return ancestor === "" || candidate === ancestor || candidate.startsWith(`${ancestor}${PATH_SEPARATOR}`);
}
function externalDirectoryGrantsIn(config) {
  const permission = isPlainObject(config) && isPlainObject(config[PERMISSION_KEY]) ? config[PERMISSION_KEY] : {};
  const rules = isPlainObject(permission[EXTERNAL_DIRECTORY_KEY]) ? permission[EXTERNAL_DIRECTORY_KEY] : {};
  return Object.entries(rules).filter(([, verdict]) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT).map(([pattern]) => pattern);
}
var HOST_PERMISSION_VERDICTS = ["allow", "ask", "deny"];
function harnessGrantPostureOf(externalDirectories) {
  const ownedRows = HARNESS_EXTERNAL_DIRECTORIES.map((harnessDirectory) => externalDirectories[harnessDirectory]);
  if (ownedRows.some((verdict) => verdict !== void 0 && !isHostVerdict(verdict))) return "malformed";
  const widened = Object.entries(externalDirectories).some(
    ([pattern, verdict]) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT && widensAHarnessGrant(pattern)
  );
  if (widened) return "malformed";
  return ownedRows.every((verdict) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT) ? "as installed" : "narrowed by the operator";
}
function isHostVerdict(verdict) {
  return typeof verdict === "string" && HOST_PERMISSION_VERDICTS.includes(verdict);
}
function widensAHarnessGrant(pattern) {
  return HARNESS_EXTERNAL_DIRECTORIES.some(
    (harnessDirectory) => hostPatternMatches(pattern, withWildcardsConcreted(harnessDirectory)) && !hostPatternMatches(harnessDirectory, withWildcardsConcreted(pattern))
  );
}
function remainingPromptsOf(config) {
  const permission = isPlainObject(config) && isPlainObject(config[PERMISSION_KEY]) ? config[PERMISSION_KEY] : {};
  const spelled = Object.entries(permission).flatMap(([key, rule]) => promptsOfRule(key, rule));
  const unspelledDoomLoop = DOOM_LOOP_KEY in permission ? [] : [DOOM_LOOP_KEY];
  return [...spelled, ...unspelledDoomLoop, ...readsBeyondTheHarnessGrants(permission)].sort();
}
function readsBeyondTheHarnessGrants(permission) {
  const rules = isPlainObject(permission[EXTERNAL_DIRECTORY_KEY]) ? Object.entries(permission[EXTERNAL_DIRECTORY_KEY]) : [];
  return READS_THE_HARNESS_GRANTS_LEAVE_ASKING.filter(
    (read) => lastVerdictCovering(rules, read.probedAt) !== HARNESS_EXTERNAL_DIRECTORY_VERDICT
  ).map((read) => `${EXTERNAL_DIRECTORY_KEY} ${read.named}`);
}
function lastVerdictCovering(rules, probedAt) {
  return rules.filter(([pattern]) => isAtOrUnder(probedAt, literalHeadOf(pattern))).at(-1)?.[1];
}
function promptsOfRule(key, rule) {
  if (rule === HOST_PROMPT_VERDICT) return [key];
  if (!isPlainObject(rule)) return [];
  return Object.entries(rule).filter(([, verdict]) => verdict === HOST_PROMPT_VERDICT).map(([pattern]) => `${key} ${pattern}`);
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
function refusalMessage(reason) {
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
var GLOBAL_MARKER_START = "<!-- oso-code:start -->";
var GLOBAL_MARKER_END = "<!-- oso-code:end -->";
var AWK_BLANK_LINE = /^[ \t]*$/;
var REPAIRABLE_NESTED_PATHS = [["permission"], ["permission", "skill"], ["permission", "task"], ["mcp"]];
function opencodePathsFor(homeDirectory2, environment) {
  const configHome = path7.join(environment["XDG_CONFIG_HOME"] ?? path7.join(homeDirectory2, ".config"), "opencode");
  const stateRoot = path7.join(homeDirectory2, ".local", "state", "oso-code");
  return {
    homeDirectory: homeDirectory2,
    configHome,
    configFile: path7.join(configHome, "opencode.json"),
    globalFile: path7.join(configHome, "AGENTS.md"),
    stateRoot,
    backupsRoot: stateRoot
  };
}
function configHomeRefusal(homeDirectory2, environment, verb) {
  const configuredHome = environment["XDG_CONFIG_HOME"];
  if (configuredHome === void 0 || configuredHome === "" || configuredHome === path7.join(homeDirectory2, ".config")) return void 0;
  return {
    kind: "usage",
    message: `XDG_CONFIG_HOME (${configuredHome}) is not the default for HOME (${path7.join(homeDirectory2, ".config")}), so this ${verb} would write outside the home it was pointed at; unset it or point both at the same account`
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
  if (withoutOpenCodeMarkerRegion(readFileSync8(globalFile, "utf8")).kind === "clean") return void 0;
  return { kind: "fatal", message: malformedMarkersMessage(globalFile) };
}
function withoutOpenCodeMarkerRegion(content) {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const kept = [];
  let inside = false;
  let regions = 0;
  for (const record of records) {
    if (record === GLOBAL_MARKER_START) {
      if (inside) return { kind: "malformed" };
      inside = true;
      regions += 1;
      continue;
    }
    if (record === GLOBAL_MARKER_END) {
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
  return `${withoutTrailingBlankLines(strippedContent)}${separator}${GLOBAL_MARKER_START}
${blockBody}${GLOBAL_MARKER_END}
`;
}
function mergeGlobalAgents(globalFile, blockBody) {
  const existing = isReadableRegularFile(globalFile) ? readFileSync8(globalFile, "utf8") : "";
  const stripped = withoutOpenCodeMarkerRegion(existing);
  if (stripped.kind === "malformed") throw new Error(malformedMarkersMessage(globalFile));
  writeFileAtomically(path7.dirname(globalFile), globalFile, renderGlobalAgents(stripped.text, blockBody), ".oso-agents-md-");
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
  const snapshotName = path7.basename(snapshot.directory);
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
  const listing = snapshots.map((backup) => `${path7.basename(backup)}	${backupSizeKib(backup)} KiB`);
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
  const directory = path7.join(backupsRoot, backupName);
  if (!installBackupDeclares(directory, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL)) {
    return { kind: "unusable", message: `not an OpenCode install backup: ${directory}` };
  }
  if (!isReadableRegularFile(recordedConfigOf(directory))) {
    return { kind: "unusable", message: `that backup holds no opencode.json to repair from: ${directory}` };
  }
  return { kind: "located", directory };
}
function recordedConfigOf(backup) {
  return path7.join(backup, "items", CONFIG_BACKUP_LABEL);
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
function withoutTrailingBlankLines(content) {
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
import { spawnSync as spawnSync4 } from "node:child_process";
import { mkdtempSync as mkdtempSync3, rmSync as rmSync6 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import path8 from "node:path";

// core/src/install/version-line.ts
function versionLineReadingOf(rawOutput, versionLine) {
  const lines = rawOutput.split("\n").filter((line) => line.trim() !== "");
  const matchingLines = lines.filter((line) => versionLine.test(line));
  if (matchingLines.length === 0) return { kind: "unmatched", raw: rawOutput };
  if (matchingLines.length > 1) return { kind: "ambiguous", matches: matchingLines };
  const matchedLine = matchingLines[0] ?? "";
  const captured = versionLine.exec(matchedLine)?.[1];
  return { kind: "matched", version: captured ?? matchedLine, discarded: lines.filter((line) => line !== matchedLine) };
}
function versionOutcomeOf(reading, versionLineShape) {
  if (reading.kind === "matched") {
    return { version: reading.version, note: reading.discarded.length === 0 ? void 0 : extraLinesNote(reading.discarded) };
  }
  if (reading.kind === "unmatched") return { version: void 0, note: unmatchedNote(versionLineShape, reading.raw) };
  return { version: void 0, note: ambiguousNote(versionLineShape, reading.matches) };
}
function extraLinesNote(discarded) {
  const first = discarded[0] ?? "";
  const plural = discarded.length === 1 ? "line" : "lines";
  return `the probe printed ${discarded.length} extra ${plural} beyond the version; first: ${collapsedNewlines(first)}`;
}
function unmatchedNote(versionLineShape, raw) {
  return `the probe printed no line shaped like ${versionLineShape}; raw output: ${collapsedNewlines(raw)}`;
}
function ambiguousNote(versionLineShape, matches) {
  return `the probe printed ${matches.length} lines shaped like ${versionLineShape} (ambiguous): ${collapsedNewlines(matches.join("\n"))}`;
}

// core/src/install/opencode-host.ts
var OPENCODE_BINARY_NAME = "opencode";
var OPENCODE_VERSION_LINE_SHAPE = "a bare dotted version";
var PROBE_HOME_PREFIX = "oso-opencode-probe.";
var ANSI_SELECT_GRAPHIC_RENDITION = /\u001b\[[0-9;]*m/g;
var POSIX_SPACE_CLASS = /[ \t\n\v\f\r]/g;
var OPENCODE_VERSION_LINE = /^(\d+(?:\.\d+)*)$/;
function openCodeHostProbes(environment) {
  const binaryPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  if (binaryPath === void 0) return { version: void 0 };
  const outcome = versionOutcomeOf(probedVersion(environment, binaryPath), OPENCODE_VERSION_LINE_SHAPE);
  return outcome.note === void 0 ? { version: outcome.version } : { version: outcome.version, versionNote: outcome.note };
}
function versionFieldOf(probeOutput) {
  const strippedPerLine = probeOutput.replace(ANSI_SELECT_GRAPHIC_RENDITION, "").split("\n").map((line) => line.replace(POSIX_SPACE_CLASS, "")).join("\n");
  return versionLineReadingOf(strippedPerLine, OPENCODE_VERSION_LINE);
}
function probedVersion(environment, binaryPath) {
  const probeHome = mkdtempSync3(path8.join(environment["TMPDIR"] ?? tmpdir3(), PROBE_HOME_PREFIX));
  try {
    const run = spawnSync4(binaryPath, ["--version"], { env: probeEnvironment2(environment, probeHome), encoding: "utf8" });
    return versionFieldOf(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  } finally {
    rmSync6(probeHome, { recursive: true, force: true });
  }
}
function probeEnvironment2(environment, probeHome) {
  return {
    ...environment,
    HOME: probeHome,
    USERPROFILE: probeHome,
    TMPDIR: probeHome,
    XDG_CONFIG_HOME: path8.join(probeHome, ".config"),
    XDG_STATE_HOME: path8.join(probeHome, ".local", "state"),
    XDG_CACHE_HOME: path8.join(probeHome, ".cache"),
    XDG_DATA_HOME: path8.join(probeHome, ".local", "share")
  };
}

// core/src/install/opencode-install.ts
import { chmodSync as chmodSync2, cpSync as cpSync2, lstatSync as lstatSync3, mkdirSync as mkdirSync6, mkdtempSync as mkdtempSync4, readdirSync as readdirSync4, readFileSync as readFileSync10, renameSync as renameSync3, rmSync as rmSync7, writeFileSync as writeFileSync6 } from "node:fs";
import { spawnSync as spawnSync5 } from "node:child_process";
import path11 from "node:path";

// core/src/install/opencode-trust.ts
import { readFileSync as readFileSync9 } from "node:fs";
import path9 from "node:path";
var OPENCODE_TRUST_FILE_COUNT = 15;
var INSTALLED_TREE_MAP = [
  { published: "opencode/dist/oso-code.js", installed: "plugin/oso-code.js" },
  { published: "plugin/dist/", installed: "dist/" },
  { published: "plugin/hooks/", installed: "hooks/" },
  { published: "plugin/git-hooks/", installed: "git-hooks/" },
  { published: "plugin/bin/", installed: "bin/" }
];
function openCodeTrustTargetUnder(rootKind, root, published) {
  if (rootKind === "source") return path9.join(root, ...published.split("/"));
  const mapped = INSTALLED_TREE_MAP.find((row) => row.published === published || row.published.endsWith("/") && published.startsWith(row.published));
  if (mapped === void 0) return void 0;
  const relative = mapped.published.endsWith("/") ? `${mapped.installed}${published.slice(mapped.published.length)}` : mapped.installed;
  return path9.join(root, ...relative.split("/"));
}
function openCodeTrustReading(manifestFile, rootKind, root) {
  return {
    filesRead: openCodeTrustedFiles(manifestFile).length,
    divergences: trustDivergences(manifestFile, () => false, (published) => openCodeTrustTargetUnder(rootKind, root, published))
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
  return parseTrustManifest(readFileSync9(manifestFile, "utf8")).map((row) => row.file);
}

// core/src/install/profile.ts
import path10 from "node:path";
var ROLES = ["applier", "verifier", "judges"];
var TIERS = ["default", "strong"];
var PROFILE_NAMES = ["normal", "strong", "custom"];
var BLOCK_INDENT = "  ";
var ON_DEFAULT = { tier: "default", model: void 0 };
var ON_STRONG = { tier: "strong", model: void 0 };
var PRESETS = {
  normal: { applier: ON_DEFAULT, verifier: ON_DEFAULT, judges: ON_STRONG },
  strong: { applier: ON_STRONG, verifier: ON_STRONG, judges: ON_STRONG }
};
var TIER_RANK = { default: 0, strong: 1 };
var FORKED_JUDGES_FLOOR = "strong";
var ProfileRefusedError = class extends Error {
  constructor(reason) {
    super(`profile set refused: ${reason}`);
    this.name = "ProfileRefusedError";
  }
};
var ProfileMirrorRefusedError = class extends Error {
  constructor(mirror, reason) {
    super(`the profile mirror at ${mirror} is refused: ${reason}`);
    this.name = "ProfileMirrorRefusedError";
  }
};
function showProfile(workingDirectory, openCodeConfigFile) {
  const profile = readProfile(workingDirectory);
  const config = openCodeConfigReading(openCodeConfigFile);
  const sections = [
    mirrorSection(profile),
    keyedToLine(profile.mirror),
    unrankableModelSection(profileRolesOf(profile)),
    openCodeAgentModelSection(openCodeConfigFile, config, profile),
    openCodePromptSection(openCodeConfigFile, config)
  ];
  return { report: `oso profile show
${sections.join("")}`, exitCode: 0 };
}
function setProfile(workingDirectory, name, roleTokens) {
  const profile = profileFrom(name, roleTokens);
  const mirror = mirrorFor(workingDirectory);
  const content = mirrorContentOf(profile);
  writeFileAtomically(path10.dirname(mirror.file), mirror.file, content, ".profile.");
  return { report: `oso profile set ${profile.name}
${mirror.file}
${content}${keyedToLine(mirror)}`, exitCode: 0 };
}
function readProfile(workingDirectory) {
  const mirror = mirrorFor(workingDirectory);
  const read = readStateFile(mirror.file);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(mirror.file, read.cause);
  if (read.kind === "absent") return { kind: "unmirrored", mirror };
  return { kind: "mirrored", mirror, content: read.content, roles: roleChoicesOfMirror(mirror.file, read.content) };
}
function profileRolesOf(reading) {
  return reading.kind === "mirrored" ? reading.roles : {};
}
function mirrorFor(workingDirectory) {
  const stateFile = stateFileFor(workingDirectory);
  return { file: profileFileFor(stateFile), repository: repositoryIdentityFor(workingDirectory), digest: repositoryIdFor(stateFile) };
}
function mirrorSection(profile) {
  if (profile.kind === "unmirrored") return `no profile at ${profile.mirror.file} \u2014 every role runs on its host's session model
`;
  return `${profile.mirror.file}
${profile.content}`;
}
function keyedToLine(mirror) {
  return `this profile is per repository, keyed to ${mirror.repository} (digest ${mirror.digest})
`;
}
function modelOverridesTheTierCannotRank(roles) {
  return ROLES.flatMap((role) => {
    const choice = roles[role];
    return choice?.model === void 0 ? [] : [`${role}: ${choice.tier} declared \u2014 model ${choice.model} overrides the tier's session field; the harness cannot rank it`];
  });
}
function unrankableModelSection(roles) {
  return modelOverridesTheTierCannotRank(roles).map((declared) => `${declared}
`).join("");
}
function openCodeAgentModelSection(configFile, config, profile) {
  const heading = `agent model keys the installed OpenCode config carries, read from ${configFile}:
`;
  if (config.kind === "unread") return `${heading}${BLOCK_INDENT}${config.cause}, so no agent model key was read
`;
  const lines = agentModelMarkings(config.document, profile);
  return `${heading}${lines.map((line) => `${BLOCK_INDENT}${line}
`).join("")}`;
}
function agentModelMarkings(document, profile) {
  const installed = installedAgentModels(document);
  if (profile.kind === "unmirrored") {
    const read = OPENCODE_AGENTS_THE_PROFILE_DRIVES.map((agent) => `${agent} \u2014 installed: ${installed[agent] ?? "none"}`);
    return [...read, "no profile for this repository \u2014 set one with `oso profile set normal|strong|custom \u2026` from this directory"];
  }
  const mirrored = openCodeAgentModels(document, profile.roles);
  return OPENCODE_AGENTS_THE_PROFILE_DRIVES.map((agent) => markedAgainstTheMirror(agent, installed[agent], mirrored[agent]));
}
var AN_INSTALL_FROM_THIS_DIRECTORY = "run oso install --host opencode from this directory";
function markedAgainstTheMirror(agent, installed, mirrored) {
  if (installed === void 0) return `${agent} \u2014 absent \u2014 ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply`;
  if (installed === mirrored) return `${agent}=${installed} \u2014 matches this mirror`;
  return `${agent}=${installed} \u2014 differs \u2014 set from another repository or by hand; ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply this mirror`;
}
function openCodePromptSection(configFile, config) {
  const heading = `prompts that remain on OpenCode, read from ${configFile}:
`;
  if (config.kind === "unread") return `${heading}${BLOCK_INDENT}${config.cause}, so every prompt this host asks today still stops an unattended run
`;
  const prompts = remainingPromptsOf(config.document);
  if (prompts.length === 0) return `${heading}${BLOCK_INDENT}none
`;
  return `${heading}${prompts.map((prompt) => `${BLOCK_INDENT}${prompt}
`).join("")}`;
}
function openCodeConfigReading(configFile) {
  if (!isReadableRegularFile(configFile)) return { kind: "unread", cause: "no readable OpenCode config" };
  try {
    return { kind: "read", document: readJsonFile(configFile) };
  } catch (error) {
    if (!(error instanceof JsonParseError)) throw error;
    return { kind: "unread", cause: error.message };
  }
}
function roleChoicesOfMirror(mirror, content) {
  const chosen = {};
  for (const role of ROLES) {
    chosen[role] = { tier: tierOfMirror(mirror, content, role), model: modelOfMirror(mirror, content, role) };
  }
  const breach = tierFloorBreachOf(chosen);
  if (breach !== void 0) {
    throw new ProfileMirrorRefusedError(mirror, `${breach.reason} \u2014 ${tierRecord(breach.role)}=${breach.floor} would have passed`);
  }
  return chosen;
}
function tierOfMirror(mirror, content, role) {
  const key = tierRecord(role);
  const records = stateRecords(content, key);
  if (records.length !== 1) throw soleRecordRefusal(mirror, key, records.length);
  const declared = records[0];
  if (!isTier(declared)) throw new ProfileMirrorRefusedError(mirror, `${key}=${declared} names no tier \u2014 the tiers are ${TIERS.join(", ")}`);
  return declared;
}
function modelOfMirror(mirror, content, role) {
  const key = modelRecord(role);
  const records = stateRecords(content, key);
  if (records.length === 0) return void 0;
  if (records.length > 1) throw soleRecordRefusal(mirror, key, records.length);
  const declared = records[0];
  if (!isModelToken(declared)) {
    throw new ProfileMirrorRefusedError(mirror, `${key}=${JSON.stringify(declared)} names no model \u2014 ${MODEL_TOKEN_SHAPE} would have passed`);
  }
  return declared;
}
function soleRecordRefusal(mirror, key, records) {
  const found = records === 0 ? `${key} names no record` : `${key} names ${records} records`;
  return new ProfileMirrorRefusedError(mirror, `${found} \u2014 exactly one ${key}= record would have passed`);
}
function profileFrom(name, roleTokens) {
  if (!isProfileName(name)) throw new ProfileRefusedError(`${name} is not a profile name \u2014 the names are ${PROFILE_NAMES.join(", ")}`);
  const chosen = roleChoicesFrom(roleTokens);
  if (name === "custom") return { name, roles: customRoles(chosen) };
  return { name, roles: presetRoles(name, chosen) };
}
function presetRoles(name, chosen) {
  const roleNamed = ROLES.find((role) => chosen[role] !== void 0);
  if (roleNamed !== void 0) {
    throw new ProfileRefusedError(`${roleFlag(roleNamed)} names a role only "set custom" takes \u2014 the ${name} preset names its own`);
  }
  return PRESETS[name];
}
function customRoles(chosen) {
  const { applier, verifier, judges } = chosen;
  if (applier === void 0) throw missingRole("applier");
  if (verifier === void 0) throw missingRole("verifier");
  if (judges === void 0) throw missingRole("judges");
  const breach = tierFloorBreachOf(chosen);
  if (breach !== void 0) {
    throw new ProfileRefusedError(`${breach.reason} \u2014 ${roleFlag(breach.role)} ${breach.floor} would have passed`);
  }
  return { applier, verifier, judges };
}
function tierFloorBreachOf(chosen) {
  const { applier, verifier, judges } = chosen;
  if (applier !== void 0 && verifier !== void 0 && TIER_RANK[verifier.tier] < TIER_RANK[applier.tier]) {
    return { reason: `the verifier tier ${verifier.tier} is below the applier tier ${applier.tier}`, role: "verifier", floor: applier.tier };
  }
  if (judges !== void 0 && TIER_RANK[judges.tier] < TIER_RANK[FORKED_JUDGES_FLOOR]) {
    return {
      reason: `the judges tier ${judges.tier} is below the ${FORKED_JUDGES_FLOOR} tier the forked judges hold`,
      role: "judges",
      floor: FORKED_JUDGES_FLOOR
    };
  }
  return void 0;
}
function missingRole(role) {
  return new ProfileRefusedError(`a custom profile names every role \u2014 ${roleFlag(role)} <tier>[:<model>] is missing`);
}
function roleChoicesFrom(tokens) {
  const chosen = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const role = roleOf(flag);
    if (chosen[role] !== void 0) throw new ProfileRefusedError(`${flag} may be given only once`);
    chosen[role] = roleChoiceFrom(flag, tokens[index + 1]);
  }
  return chosen;
}
function roleOf(flag) {
  const role = ROLES.find((candidate) => flag === roleFlag(candidate));
  if (role === void 0) throw new ProfileRefusedError(`${flag} names no role \u2014 the roles are ${ROLES.map(roleFlag).join(", ")}`);
  return role;
}
function roleChoiceFrom(flag, value) {
  if (value === void 0) throw new ProfileRefusedError(`${flag} takes <tier>[:<model>] and was given nothing`);
  const colon = value.indexOf(":");
  const tier = colon === -1 ? value : value.slice(0, colon);
  const model = colon === -1 ? void 0 : value.slice(colon + 1);
  if (!isTier(tier)) throw new ProfileRefusedError(`${flag} ${value} names no tier \u2014 the tiers are ${TIERS.join(", ")}`);
  if (model === "") throw new ProfileRefusedError(`${flag} ${value} names no model after its colon \u2014 ${flag} ${tier} would have passed`);
  if (model !== void 0 && !isModelToken(model)) {
    throw new ProfileRefusedError(`${flag} ${tier}:${JSON.stringify(model)} names no model \u2014 ${MODEL_TOKEN_SHAPE} would have passed`);
  }
  return { tier, model };
}
function roleFlag(role) {
  return `--${role}`;
}
function mirrorContentOf(profile) {
  const lines = [
    `model_profile=${profile.name}`,
    ...ROLES.flatMap((role) => roleLines(role, profile.roles[role])),
    "unattended.doom_loop=ask"
  ];
  return lines.map((line) => `${line}
`).join("");
}
function roleLines(role, choice) {
  const tier = `${tierRecord(role)}=${choice.tier}`;
  return choice.model === void 0 ? [tier] : [tier, `${modelRecord(role)}=${choice.model}`];
}
function tierRecord(role) {
  return `${role}.tier`;
}
function modelRecord(role) {
  return `${role}.model`;
}
function isProfileName(value) {
  return PROFILE_NAMES.includes(value);
}
function isTier(value) {
  return TIERS.includes(value);
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
var FALLOW_FALLBACK_COMMAND = "fallow-mcp";
function openCodeInstallTargets(paths) {
  return {
    skills: path11.join(paths.configHome, "skill"),
    agents: path11.join(paths.configHome, "agent"),
    commands: path11.join(paths.configHome, "command"),
    plugin: path11.join(paths.configHome, "plugin"),
    hooks: path11.join(paths.configHome, "hooks"),
    gitHooks: path11.join(paths.configHome, "git-hooks"),
    stateBin: path11.join(paths.configHome, "bin"),
    dist: path11.join(paths.configHome, "dist"),
    engramPlugin: path11.join(paths.configHome, "plugins", "engram.ts"),
    impeccableMount: path11.join(paths.homeDirectory, ".agents", "skills", "impeccable"),
    impeccableOptOut: path11.join(paths.stateRoot, "impeccable-opt-out"),
    ownerRegistry: path11.join(paths.stateRoot, "opencode-install-registry"),
    restoreExercisedMarker: path11.join(paths.stateRoot, ".install-restore-verified-opencode"),
    planArtifactRoot: path11.join(paths.stateRoot, "plans")
  };
}
function openCodePayloadSources(repositoryRoot2) {
  return {
    skills: path11.join(repositoryRoot2, "opencode", "skills"),
    sharedSkills: path11.join(repositoryRoot2, "plugin", "skills", "_shared"),
    agents: path11.join(repositoryRoot2, "opencode", "agents"),
    commands: path11.join(repositoryRoot2, "opencode", "commands"),
    pluginBundle: path11.join(repositoryRoot2, "opencode", "dist", "oso-code.js"),
    gates: path11.join(repositoryRoot2, "plugin", "hooks"),
    gitHook: path11.join(repositoryRoot2, "plugin", "git-hooks", "pre-commit"),
    stateBin: path11.join(repositoryRoot2, "plugin", "bin", "oso-state"),
    stateBinPackage: path11.join(repositoryRoot2, "plugin", "bin", "package.json"),
    dist: path11.join(repositoryRoot2, "plugin", "dist"),
    global: path11.join(repositoryRoot2, "bootstrap", "opencode-global.md"),
    publishedHashes: path11.join(repositoryRoot2, "bootstrap", "hook-hashes.txt")
  };
}
function payloadRefusal(sources) {
  const missing = [
    { present: isReadableRegularFile(sources.global), message: `the OpenCode global guidance is missing: ${sources.global}` },
    { present: isDirectory(sources.skills), message: `the OpenCode skill wrappers are missing: ${sources.skills}` },
    { present: isDirectory(sources.sharedSkills), message: `the shared skill directory is missing: ${sources.sharedSkills}` },
    { present: isDirectory(sources.agents), message: `the OpenCode agent contracts are missing: ${sources.agents}` },
    { present: isDirectory(sources.commands), message: `the OpenCode command templates are missing: ${sources.commands}` },
    { present: isReadableRegularFile(sources.pluginBundle), message: `the OpenCode plugin bundle is missing: ${sources.pluginBundle}` },
    { present: isDirectory(sources.gates), message: `the shared gate script tree is missing: ${sources.gates}` },
    { present: isReadableRegularFile(path11.join(sources.gates, "lib.sh")), message: `the shared gate library is missing: ${path11.join(sources.gates, "lib.sh")}` },
    { present: isReadableRegularFile(path11.join(sources.gates, "lexer.sh")), message: `the shared gate lexer is missing: ${path11.join(sources.gates, "lexer.sh")}` },
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
  return directoryEntryNames(hooksTarget).filter((name) => name.endsWith(".sh") && isReadableRegularFile(path11.join(hooksTarget, name))).filter((name) => !published.has(name));
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
    for (const { label, target } of backupCandidatesOf(paths, targets)) backupTarget(tx, label, target);
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
    mergeGlobalAgents(paths.globalFile, readFileSync10(sources.global, "utf8"));
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
  if (input.host.versionNote !== void 0) infoLines.push(input.host.versionNote);
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
      `upgrade opencode to ${SUPPORTED_OPENCODE_VERSION} or newer and re-run (found ${input.host.version ?? input.host.versionNote ?? "no opencode on PATH"})`
    );
  }
  return input.assumeYes ? void 0 : requiresYesOutcome("install", "opencode");
}
function backupCandidatesOf(paths, targets) {
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
    for (const wrapper of osoPrefixedEntryNames(sources.skills)) cpSync2(path11.join(sources.skills, wrapper), path11.join(stage, wrapper), { recursive: true });
    cpSync2(sources.sharedSkills, path11.join(stage, "_shared"), { recursive: true });
  });
  replaceTree(paths.configHome, targets.agents, (stage) => {
    for (const agent of agentContractNames(sources.agents)) cpSync2(path11.join(sources.agents, agent), path11.join(stage, agent));
  });
  replaceTree(paths.configHome, targets.commands, (stage) => {
    for (const command of modeCommandNames(sources.commands)) cpSync2(path11.join(sources.commands, command), path11.join(stage, command));
  });
  replaceTree(paths.configHome, targets.plugin, (stage) => cpSync2(sources.pluginBundle, path11.join(stage, "oso-code.js")));
  replaceTree(paths.configHome, targets.hooks, (stage) => {
    for (const script of publishedGateScriptNames(sources.publishedHashes)) {
      cpSync2(path11.join(sources.gates, script), path11.join(stage, script));
      chmodSync2(path11.join(stage, script), EXECUTABLE_FILE_MODE);
    }
  });
  replaceTree(paths.configHome, targets.stateBin, (stage) => {
    cpSync2(sources.stateBin, path11.join(stage, "oso-state"));
    cpSync2(sources.stateBinPackage, path11.join(stage, "package.json"));
    chmodSync2(path11.join(stage, "oso-state"), EXECUTABLE_FILE_MODE);
  });
  replaceTree(paths.configHome, targets.dist, (stage) => {
    for (const bundle of publishedDistFileNames(sources.publishedHashes)) cpSync2(path11.join(sources.dist, bundle), path11.join(stage, bundle));
  });
  replaceTree(paths.configHome, targets.gitHooks, (stage) => {
    cpSync2(sources.gitHook, path11.join(stage, "pre-commit"));
    chmodSync2(path11.join(stage, "pre-commit"), EXECUTABLE_FILE_MODE);
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
  const fallow = resolveFallowMcpCommand(input.environment, input.homeDirectory, input.platform) ?? FALLOW_FALLBACK_COMMAND;
  const profile = readProfile(input.workingDirectory);
  const merged = mergeOpenCodeConfig(recordedConfigDocument(tx), fallow, profileRolesOf(profile));
  const violation = hostContractViolationOf(merged.document);
  if (violation !== void 0) throw new Error(`the rendered config violates the host contract: ${violation}`);
  writeJsonFile(paths.configFile, merged.document);
  chmodSync2(paths.configFile, PRIVATE_FILE_MODE);
  writeFileSync6(preservedKeysFileOf(tx), merged.preservedKeys.map((key) => `${key}
`).join(""));
  return wiringOk("opencode.json", `preserved ${merged.preservedKeys.length} operator key(s), ${agentModelNote(profile, merged.agentModels)}`);
}
function agentModelNote(profile, agentModels) {
  if (profile.kind === "unmirrored") {
    return `no profile mirror at ${profile.mirror.file}, so ${EVERY_AGENT_ON_THE_HOST_SESSION_MODEL}`;
  }
  const named = Object.keys(agentModels).length;
  if (named === 0) return `${profile.mirror.file} names no model, so ${EVERY_AGENT_ON_THE_HOST_SESSION_MODEL}`;
  return `wrote ${named} agent model key(s) from ${profile.mirror.file}`;
}
function recordedConfigDocument(tx) {
  return readJsonFile(path11.join(tx.itemsDirectory, "config"));
}
function wireEngram(environment, engramPlugin, tx) {
  if (firstExecutableOnPath(environment, ENGRAM_BINARY_NAME) === void 0) {
    return wiringOk("engram", "engram is not on PATH; the operator's prior Engram wiring stays as backed up");
  }
  const help = spawnSync5(ENGRAM_BINARY_NAME, ["setup", "--help"], { env: environment, encoding: "utf8" });
  if (!`${help.stdout ?? ""}${help.stderr ?? ""}`.includes("opencode")) {
    return wiringOk("engram", "engram setup does not advertise OpenCode support; the operator's prior wiring is preserved");
  }
  const setup = spawnSync5(ENGRAM_BINARY_NAME, ["setup", "opencode"], { env: environment, encoding: "utf8" });
  if (setup.error === void 0 && setup.status === 0) return wiringOk("engram", "wired through engram setup opencode");
  restoreBackedUpEngramPlugin(tx, engramPlugin);
  return wiringFail("engram", "engram setup opencode failed; the operator's prior Engram plugin was restored from the backup snapshot");
}
function restoreBackedUpEngramPlugin(tx, engramPlugin) {
  const recorded = path11.join(tx.itemsDirectory, "engram-plugin");
  if (!isReadableRegularFile(recorded)) return;
  mkdirSync6(path11.dirname(engramPlugin), { recursive: true });
  cpSync2(recorded, engramPlugin);
}
function impeccableEntries(input, targets) {
  if (input.installImpeccable) return [wiringOk("impeccable", `not mounted at ${targets.impeccableMount}; no installer in this tree performs the mount`)];
  mkdirSync6(path11.dirname(targets.impeccableOptOut), { recursive: true });
  writeFileSync6(targets.impeccableOptOut, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}
`);
  return [wiringOk("impeccable", "skipped by --no-impeccable")];
}
function gitHookEntries(input, targets) {
  const preCommit = path11.join(targets.gitHooks, "pre-commit");
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
  const wired = spawnSync5("git", ["-C", input.repositoryRoot, "config", "--local", "core.hooksPath", targets.gitHooks], {
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
    ...directoryEntryNames(targets.hooks).filter((name) => name.endsWith(".sh")).map((name) => ownedBy(OWNER_INSTALLER, path11.join(targets.hooks, name))),
    ownedBy(OWNER_INSTALLER, path11.join(targets.stateBin, "oso-state")),
    ownedBy(OWNER_INSTALLER, path11.join(targets.gitHooks, "pre-commit"))
  ];
  mkdirSync6(paths.stateRoot, { recursive: true });
  writeFileSync6(targets.ownerRegistry, rows.map((row) => `${row}
`).join(""), { mode: PRIVATE_FILE_MODE });
}
function ownedBy(owner, target) {
  return `${owner}	${target}`;
}
function preservedKeysOf(tx) {
  const file = preservedKeysFileOf(tx);
  if (!isReadableRegularFile(file)) return [];
  return readFileSync10(file, "utf8").split("\n").filter((key) => key !== "");
}
function preservedKeysFileOf(tx) {
  return path11.join(tx.backupRoot, PRESERVED_KEYS_FILE);
}
function pruneOpenCodeInstallBackups(paths, targets, environment) {
  if (!isReadableRegularFile(targets.restoreExercisedMarker)) return [];
  const ownSnapshots = installBackupsDeclaring(paths.backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL);
  const over = installBackupsOverBudget(ownSnapshots, installBackupBudgetKib(environment));
  for (const backup of over) rmSync7(backup, { recursive: true, force: true });
  return over;
}
function migrateOpenCodeState(paths, targets, tx) {
  const migrated = [];
  for (const stateFile of stateFilesUnder(paths.stateRoot)) {
    const repository = path11.basename(stateFile, ".state");
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
  const session = stateValue(readFileSync10(stateFile, "utf8"), "session");
  if (!MIGRATED_SESSION_PATTERN.test(session)) return [];
  const agent = repository.slice(0, AGENT_IDENTITY_LENGTH);
  backUpOnce();
  rewriteStateKeys(stateFile, [`session=${agent}`]);
  if (stateValue(readFileSync10(stateFile, "utf8"), "plan_approval_session") !== "") {
    rewriteStateKeys(stateFile, [`plan_approval_session=${agent}`]);
  }
  return [`migrated the renamed identity in ${path11.basename(stateFile)}: session ${session} is now ${agent}`];
}
function migrateRelocatedApproval(stateFile, repository, planArtifactRoot, backUpOnce) {
  if (stateValue(readFileSync10(stateFile, "utf8"), "plan_approval") !== "") return [];
  const planDirectory = path11.join(planArtifactRoot, repository);
  const approved = directoryEntryNames(planDirectory).find((name) => name.startsWith("approved-") && name.endsWith(".md"));
  if (approved === void 0) return [];
  const planDigest = approved.slice("approved-".length, -".md".length);
  backUpOnce();
  rewriteStateKeys(stateFile, [
    "plan_approval=approved",
    `plan_approval_digest=${planDigest}`,
    `plan_approval_session=${repository.slice(0, AGENT_IDENTITY_LENGTH)}`,
    `plan_snapshot_file=${path11.join(planDirectory, approved)}`,
    `plan_current_file=${path11.join(planDirectory, "current.md")}`,
    "plan_revision=0"
  ]);
  return [`migrated the relocated plan approval into ${path11.basename(stateFile)}: ${planDigest}`];
}
function rewriteStateKeys(stateFile, pairs) {
  for (const pair of pairs) {
    const key = pair.slice(0, pair.indexOf("="));
    const kept = readFileSync10(stateFile, "utf8").split("\n").filter((line) => line !== "" && !line.startsWith(`${key}=`));
    const staged = path11.join(path11.dirname(stateFile), `.state-migration-${path11.basename(stateFile)}`);
    writeFileSync6(staged, [...kept, pair].map((line) => `${line}
`).join(""), { mode: PRIVATE_FILE_MODE });
    renameSync3(staged, stateFile);
  }
}
function stateFilesUnder(stateRoot) {
  return directoryEntryNames(stateRoot).filter((name) => name.endsWith(".state")).map((name) => path11.join(stateRoot, name)).filter(isReadableRegularFile);
}
function replaceTree(stageParent, target, fill) {
  mkdirSync6(stageParent, { recursive: true });
  const stage = mkdtempSync4(path11.join(stageParent, ".oso-install-stage-"));
  fill(stage);
  narrowToOwnerOnly(stage);
  mkdirSync6(path11.dirname(target), { recursive: true });
  rmSync7(target, { recursive: true, force: true });
  renameSync3(stage, target);
}
function narrowToOwnerOnly(target) {
  const stats = lstatSync3(target);
  if (stats.isSymbolicLink()) return;
  chmodSync2(target, stats.mode & OWNER_ONLY_MASK);
  if (!stats.isDirectory()) return;
  for (const name of readdirSync4(target)) narrowToOwnerOnly(path11.join(target, name));
}
function skillWrapperNames(skillsSource) {
  return osoPrefixedEntryNames(skillsSource).filter((name) => isReadableRegularFile(path11.join(skillsSource, name, "SKILL.md")));
}
function agentContractNames(agentsSource) {
  return osoPrefixedMarkdownNames(agentsSource);
}
function modeCommandNames(commandsSource) {
  return osoPrefixedMarkdownNames(commandsSource);
}
function osoPrefixedMarkdownNames(directory) {
  return osoPrefixedEntryNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path11.join(directory, name)));
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
import { mkdirSync as mkdirSync7, readFileSync as readFileSync11, realpathSync, rmSync as rmSync8 } from "node:fs";
import path12 from "node:path";
var OPENCODE_PURGE_BACKUP_FORMAT = "oso-code-opencode-purge-v1";
var PROJECT_CONFIGS_KEY = "OSO_OPENCODE_PROJECT_CONFIGS";
var REQUIRED_PROJECT_CONFIG_COUNT = 3;
var GENTLE_AI_LABELS = ["gentle-ai-home", "gentle-ai-bin"];
var UNSAFE_PATH_SEGMENTS = ["/../", "/./"];
var UNSAFE_PATH_CHARACTERS = /[\n\r\t]/;
function openCodePurgeTargets(homeDirectory2, keepGentleAi) {
  const all = [
    { label: "config-home", target: path12.join(homeDirectory2, ".config", "opencode") },
    { label: "state-home", target: path12.join(homeDirectory2, ".local", "share", "opencode") },
    { label: "cache-home", target: path12.join(homeDirectory2, ".cache", "opencode") },
    { label: "bin", target: path12.join(homeDirectory2, ".opencode", "bin", "opencode") },
    { label: "gentle-ai-home", target: path12.join(homeDirectory2, ".gentle-ai") },
    { label: "gentle-ai-bin", target: path12.join(homeDirectory2, ".local", "bin", "gentle-ai") }
  ];
  return keepGentleAi ? all.filter((row) => !GENTLE_AI_LABELS.includes(row.label)) : all;
}
function purgeBackupParentOf(homeDirectory2) {
  return path12.join(homeDirectory2, ".local", "state", "oso-code", "purge-backups");
}
function customizedHomeRefusal(homeDirectory2, environment) {
  const rows = [
    { key: "XDG_CONFIG_HOME", expected: path12.join(homeDirectory2, ".config"), named: "config home" },
    { key: "XDG_STATE_HOME", expected: path12.join(homeDirectory2, ".local", "state"), named: "state home" },
    { key: "XDG_CACHE_HOME", expected: path12.join(homeDirectory2, ".cache"), named: "cache home" }
  ];
  const customized = rows.find((row) => (environment[row.key] ?? "") !== "" && environment[row.key] !== row.expected);
  if (customized === void 0) return void 0;
  return `${customized.key} is not the default (${customized.expected}); a customized opencode ${customized.named} is missed by this wipe`;
}
function unsafeTargetRefusal(homeDirectory2, targets) {
  const homePhysical = physicalPathOf(homeDirectory2);
  if (homePhysical === void 0) return `HOME does not resolve to a physical path: ${homeDirectory2}`;
  if (homePhysical === path12.parse(homePhysical).root) return `refusing to operate with HOME=${homeDirectory2}`;
  for (const { label, target } of targets) {
    if (!path12.isAbsolute(target)) return `${label} must be an absolute path: ${target}`;
    if (!pathIsClean(target)) return `unsafe ${label} path: ${target}`;
    if (!isBelow(target, homeDirectory2)) return `${label} must remain below HOME: ${target}`;
    if (!existsAtAll(target) || isSymlink(target)) continue;
    const parentPhysical = physicalPathOf(path12.dirname(target));
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
    if (!path12.isAbsolute(declaredPath)) return `project-level opencode.json must be an absolute path: ${declaredPath}`;
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
    `backup would be created at: ${path12.join(backupParent, "purge-<timestamp>")}`
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
    rmSync8(target, { recursive: true, force: true });
  } catch (error) {
    return wiringFail(label, messageOf(error));
  }
  return existsAtAll(target) ? wiringFail(label, `purge target was not removed: ${target}`) : wiringOk(label, `removed ${target}`);
}
function restoreOpenCodePurge(backupDirectory, homeDirectory2) {
  const readable = readablePurgeBackup(backupDirectory, homeDirectory2);
  if (readable.kind === "unusable") return fatalOutcome("purge", "opencode", "cannot restore from this backup", readable.message);
  const occupied = readable.rows.find((row) => existsAtAll(row.target));
  if (occupied !== void 0) {
    return fatalOutcome("purge", "opencode", "refusing to overwrite an existing target", `${occupied.label}: ${occupied.target}`);
  }
  for (const row of readable.rows) mkdirSync7(path12.dirname(row.target), { recursive: true });
  const restored = restoreBackupManifest(readable.rows.map(serializeManifestRow).join("\n"), path12.join(backupDirectory, "items"));
  const wiring = readable.rows.map(
    (row) => restored.failedItems.includes(row.target) ? wiringFail(row.label, `could not restore ${row.target}`) : wiringOk(row.label, row.target)
  );
  const infoLines = [
    `restored the user-level OpenCode install from verified backup: ${backupDirectory}`,
    "no login or installation command was run"
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, wiring), exitCode: restored.failedCount === 0 ? 0 : 1 };
}
function readablePurgeBackup(backupDirectory, homeDirectory2) {
  if (!path12.isAbsolute(backupDirectory)) return { kind: "unusable", message: "backup path must be absolute" };
  if (!existsAtAll(backupDirectory) || isSymlink(backupDirectory)) {
    return { kind: "unusable", message: `backup is not a directory: ${backupDirectory}` };
  }
  const marker = path12.join(backupDirectory, "format");
  const format = isReadableRegularFile(marker) ? readFileSync11(marker, "utf8").trim() : "";
  if (format !== OPENCODE_PURGE_BACKUP_FORMAT) {
    return { kind: "unusable", message: `unsupported or missing backup format: ${backupDirectory} (expected ${OPENCODE_PURGE_BACKUP_FORMAT})` };
  }
  const manifest = path12.join(backupDirectory, "manifest");
  if (!isReadableRegularFile(manifest)) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const rows = parseManifestRows(readFileSync11(manifest, "utf8"));
  if (rows.length === 0) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const unknown = rows.find((row) => expectedTargetFor(row.label, homeDirectory2) === void 0);
  if (unknown !== void 0) return { kind: "unusable", message: `unknown backup target label: ${unknown.label}` };
  const foreign = rows.find((row) => row.target !== expectedTargetFor(row.label, homeDirectory2));
  if (foreign !== void 0) return { kind: "unusable", message: `backup target does not match this HOME: ${foreign.label}` };
  return { kind: "usable", rows };
}
function expectedTargetFor(label, homeDirectory2) {
  return openCodePurgeTargets(homeDirectory2, false).find((row) => row.label === label)?.target;
}
function pathIsClean(target) {
  if (target === path12.parse(target).root) return false;
  if (UNSAFE_PATH_CHARACTERS.test(target)) return false;
  if (target.endsWith("/..") || target.endsWith("/.")) return false;
  return !UNSAFE_PATH_SEGMENTS.some((segment) => target.includes(segment));
}
function isBelow(candidate, ancestor) {
  return candidate.startsWith(ancestor.endsWith(path12.sep) ? ancestor : `${ancestor}${path12.sep}`);
}
function physicalPathOf(target) {
  try {
    return realpathSync(target);
  } catch {
    return void 0;
  }
}

// core/src/install/verify-opencode.ts
import { spawnSync as spawnSync6 } from "node:child_process";
import { chmodSync as chmodSync3, mkdirSync as mkdirSync8, mkdtempSync as mkdtempSync5, readdirSync as readdirSync5, readFileSync as readFileSync12, rmSync as rmSync9, writeFileSync as writeFileSync7 } from "node:fs";
import { tmpdir as tmpdir4 } from "node:os";
import path13 from "node:path";

// core/src/prose/routes.ts
var AGENT_ROLES = [
  {
    id: "oso-applier",
    claude: { description: "Implements exactly one oso-code assignment \u2014 a plan slice, a debt cleanup, judge findings, or a diagnosis packaged as a ledger. Launched by the /plan, /quick and /debug orchestrators \u2014 not for direct use.", model: "sonnet", tools: ["Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep", "Bash", "mcp__plugin_oso-code_context7__resolve-library-id", "mcp__plugin_oso-code_context7__query-docs"] },
    opencode: { description: "Implements exactly one oso-code assignment: a plan slice, debt cleanup, accepted judge findings, or a diagnosis packaged as a ledger. Launched by the plan, quick, and debug orchestrators; not for direct use.", denies: ["task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: ["context7"] }
  },
  {
    id: "oso-verifier",
    claude: { description: "Independently verifies one implemented slice \u2014 or one merged wave at its integration gate \u2014 against its criteria and the project's zero-warnings bar. Judges only \u2014 never edits files. Launched by the /plan and /debug orchestrators after each apply.", model: "sonnet", tools: ["Read", "Glob", "Grep", "Bash"] },
    opencode: { description: "Independently verifies one implemented slice or one merged wave against its criteria and the project's zero-warning bar. Judges only and never edits source files.", denies: ["edit", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: [] }
  },
  {
    id: "oso-integrator",
    claude: { description: "Merges one wave of green, committed slice branches into the main checkout, then tears down their worktrees and deletes those branches. Never resolves a conflict, never judges. Launched by the /plan orchestrator \u2014 not for direct use.", model: "sonnet", tools: ["Read", "Bash"] },
    opencode: { description: "Merges one wave of green committed slice branches into the main checkout, then removes their worktrees and deletes their branches. Never resolves conflicts and never judges.", denies: ["edit", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: [] }
  },
  {
    id: "oso-debt-sweep",
    claude: null,
    opencode: { description: "Fresh-context judge for the debt-sweep skill: judges code debt and frozen-ledger conformance separately and never edits.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: ["fallow"] }
  },
  {
    id: "oso-doubt-pass",
    claude: null,
    opencode: { description: "Fresh-context judge for the doubt-pass skill: attacks a candidate ledger using only intent, surface map, and bare decisions, and never edits.", denies: ["glob", "grep", "edit", "bash", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: [] }
  },
  {
    id: "oso-security-reviewer",
    claude: null,
    opencode: { description: "Fresh-context judge for the security-pass skill: reviews the supplied change surface as a judge and never edits, commits, or asks back.", denies: ["edit", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: [] }
  },
  {
    id: "oso-triage",
    claude: null,
    opencode: { description: "Fresh-context judge for the triage skill: establishes read-only attribution for one red plan-wave check and never diagnoses or fixes beyond it.", denies: ["edit", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"], mcpServersTheClaudeTwinLists: [] }
  }
];

// core/src/install/verify-opencode.ts
var OPENCODE_NOT_ON_PATH = "opencode-not-on-path";
var VERSION_ROW_SKIP = "OpenCode CLI version \u2014 opencode is not on PATH, so the installed pin could not be probed";
var LOCAL_CHECKS_SECTION = "local checks:";
var FIXTURE_ROWS_SKIP = "the fixture-based artifact checks \u2014 the isolated install could not complete";
var REACHABLE_BEYOND_THE_TWINS_LIST = "reachable beyond the twin's list:";
var OPERATOR_CONFIG_PROBE = {
  theme: "oso-verify-operator-theme",
  sessionModel: "oso-verify/operator-session-model",
  sessionSmallModel: "oso-verify/operator-session-small-model",
  permissionKey: "read",
  permissionVerdict: "allow",
  mcpServerName: "oso-verify-operator-server",
  mcpServerCommand: ["operator-cli"],
  agentName: "oso-verify-operator-agent",
  agentModel: "oso-verify/operator-pinned-model"
};
var OPERATOR_GLOBAL_PROSE = "oso-verify operator prose the installer must not touch";
var EXPECTED_MODE_COMMAND_COUNT = 4;
var MODE_COMMAND_AGENT_ROUTE = "build";
var HARNESS_EXTERNAL_DIRECTORY_REACH_ROW = "harness external directories reach no auto-executed host surface the edit control leaves open";
var INSTALLED_EXTERNAL_DIRECTORY_REACH_ROW = "the installed config's own external directory grants reach no auto-executed host surface the edit control leaves open";
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
  `  "setup --help") printf 'usage: engram setup [<agent>] (claude-code, opencode, ...)\\n'; exit 0 ;;`,
  '  "setup opencode")',
  '    mkdir -p "$HOME/.config/opencode/plugins"',
  `    printf 'fixture engram plugin\\n' > "$HOME/.config/opencode/plugins/engram.ts"`,
  "    exit 0 ;;",
  "  *) exit 64 ;;",
  "esac",
  ""
].join("\n");
var NO_AGENT_MODEL_KEY_NAMED = `none, so ${EVERY_AGENT_ON_THE_HOST_SESSION_MODEL}`;
var NO_CONFIG_THIS_ROW_CAN_READ = "the installed config could not be read, so no agent model key was taken from it";
var NO_PROFILE_MIRROR_FOR_THIS_REPOSITORY = "no profile mirror for this repository";
var FRONT_MATTER_DELIMITER = "---";
var PERMISSION_BLOCK_HEADING = "permission:";
var SHARED_SKILL_DIRECTORY = "_shared";
var PERMISSION_VERDICT_LINE = /^ {2}(\S+): (\S+)$/;
var FIXTURE_PREFIX = "oso-opencode-verify.";
var TEMPORARY_PARENT_UNAVAILABLE = "temporary-parent-unavailable";
var DECOY_CONFIG_TEXT = '{"theme":"decoy"}';
function verifyOpenCode(input) {
  const report2 = new VerifyReport();
  report2.section(LOCAL_CHECKS_SECTION);
  checkPinnedOpenCodeVersion(report2, input.host);
  report2.check(
    HARNESS_EXTERNAL_DIRECTORY_REACH_ROW,
    externalDirectoryReachTheEditControlBounds(HARNESS_EXTERNAL_DIRECTORIES),
    harnessExternalDirectoryReach(HARNESS_EXTERNAL_DIRECTORIES)
  );
  const staged = stageOpenCodeFixture(input);
  if (staged.kind === "failed") {
    report2.check("isolated fixture install", "ready", staged.result);
    report2.skip(FIXTURE_ROWS_SKIP);
  } else {
    report2.check("isolated fixture install", "ready", "ready");
    try {
      checkInstalledTree(report2, input, staged.tree);
    } finally {
      rmSync9(staged.tree.root, { recursive: true, force: true });
    }
  }
  checkPluginWorkspaceBar(report2, input);
  checkRepositoryShellSyntax(report2, input);
  return { report: report2.render(), exitCode: report2.exitCode };
}
function checkInstalledTree(report2, input, tree) {
  const sources = openCodePayloadSources(input.repositoryRoot);
  const configFile = path13.join(tree.configHome, "opencode.json");
  const globalFile = path13.join(tree.configHome, "AGENTS.md");
  report2.check("OpenCode config contract", "valid", openCodeConfigStatus(configFile));
  report2.check(
    INSTALLED_EXTERNAL_DIRECTORY_REACH_ROW,
    externalDirectoryReachTheEditControlBounds(installedExternalDirectoryGrants(configFile)),
    installedExternalDirectoryReach(configFile)
  );
  report2.check("operator config keys survive an install", "preserved", openCodeOperatorKeysStatus(configFile));
  report2.check(
    "agent model keys from the profile",
    profiledAgentModelLine(configFile, input.workingDirectory),
    installedAgentModelLine(configFile, input.workingDirectory)
  );
  for (const declared of modelsTheTierCannotRankIn(input.workingDirectory)) report2.note(declared);
  report2.check("nine skill wrappers and the shared skill directory installed", "exact", openCodeSkillStatus(input.repositoryRoot, tree.configHome));
  report2.check("agent contracts installed", "exact", openCodeAgentStatus(input.repositoryRoot, tree.configHome));
  report2.check("owned MCP servers closed on every installed agent", "closed", openCodeAgentMcpSurfaceStatus(tree.configHome));
  noteServersBeyondTheOwnedSet(report2, configFile, tree.configHome);
  report2.check("mode commands installed and routed", "exact", openCodeCommandStatus(input.repositoryRoot, tree.configHome));
  report2.check("plugin entry, modules and routes installed", "exact", openCodePluginStatus(input.repositoryRoot, tree.configHome));
  report2.check("Engram plugin file installed", "present", openCodeEngramStatus(tree.configHome));
  report2.check("global guidance installed", "exact", openCodeGlobalStatus(globalFile, readFileSync12(sources.global, "utf8")));
  report2.check("operator global prose survives an install", "preserved", openCodeOperatorGlobalStatus(globalFile, operatorGlobalSeed()));
  report2.check("installer-owned targets recorded", "installer-owned", openCodeRegistryStatus(tree.home, tree.configHome));
  report2.check("published gate bytes as installed", "verified", openCodeTrustBytesStatus(sources.publishedHashes, tree.configHome));
  report2.check("an install outside the named home is refused", "refused", openCodeConfigHomeGuardStatus(input, tree));
}
function harnessExternalDirectoryReach(patterns) {
  return reachReading(patterns, hostSurfacesReachedBy(patterns));
}
function externalDirectoryReachTheEditControlBounds(patterns) {
  return reachReading(
    patterns,
    REACHES_THE_EDIT_CONTROL_BOUNDS.filter(({ pattern }) => patterns.includes(pattern))
  );
}
function reachReading(patterns, covered) {
  if (covered.length === 0) return patterns.join(" ");
  const reaches = namedList("reaches", covered.map(({ pattern, surface }) => `${pattern} covers ${surface}`));
  const bounded = covered.every(({ surface }) => editControlDenies(surface));
  return bounded ? `${reaches}; ${EDIT_CONTROL_BOUNDING_A_REACH}` : reaches;
}
function installedExternalDirectoryReach(configFile) {
  return harnessExternalDirectoryReach(installedExternalDirectoryGrants(configFile));
}
function installedExternalDirectoryGrants(configFile) {
  return externalDirectoryGrantsIn(readableConfigDocument(configFile));
}
function modelsTheTierCannotRankIn(workingDirectory) {
  const reading = profileForTheRow(workingDirectory);
  return reading.kind === "refused" ? [] : modelOverridesTheTierCannotRank(profileRolesOf(reading.profile));
}
function noteServersBeyondTheOwnedSet(report2, configFile, configHome) {
  const reachable = openCodeServersReachableBeyondTheOwnedSet(configFile, configHome);
  if (reachable.length === 0) return;
  report2.note(`${REACHABLE_BEYOND_THE_TWINS_LIST} ${reachable.join(", ")}`);
}
function checkPinnedOpenCodeVersion(report2, host) {
  const version = openCodeVersionStatus(host);
  if (version === OPENCODE_NOT_ON_PATH) {
    report2.skip(VERSION_ROW_SKIP);
    return;
  }
  if (!meetsVersionFloor(host.version, SUPPORTED_OPENCODE_VERSION)) {
    report2.check("OpenCode CLI version", `${SUPPORTED_OPENCODE_VERSION} or newer`, version, `npm install --global opencode-ai@${SUPPORTED_OPENCODE_VERSION}`);
    return;
  }
  report2.check("OpenCode CLI version", version, version);
  if (host.versionNote !== void 0) report2.note(host.versionNote);
  if (isAboveTestedVersion(host.version, SUPPORTED_OPENCODE_VERSION)) {
    report2.note(`OpenCode ${version} is newer than the ${SUPPORTED_OPENCODE_VERSION} this release was verified against, so the rows below are asserted against a host nothing here measured`);
  }
}
function stageOpenCodeFixture(input) {
  const parent = input.environment["TMPDIR"] ?? tmpdir4();
  if (!isDirectory(parent)) return { kind: "failed", result: TEMPORARY_PARENT_UNAVAILABLE };
  const root = mkdtempSync5(path13.join(parent, FIXTURE_PREFIX));
  const home = path13.join(root, "home");
  const configHome = path13.join(home, ".config", "opencode");
  mkdirSync8(configHome, { recursive: true });
  writeFileSync7(path13.join(configHome, "opencode.json"), `${JSON.stringify(operatorConfigSeed(), null, 2)}
`);
  writeFileSync7(path13.join(configHome, "AGENTS.md"), operatorGlobalSeed());
  writeFixtureEngramShim(fixtureShimsIn(root));
  const outcome = installOpenCode({
    homeDirectory: home,
    repositoryRoot: input.repositoryRoot,
    workingDirectory: input.workingDirectory,
    environment: fixtureEnvironmentFor(input.environment, home, root),
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false
  });
  if (outcome.exitCode === 0) return { kind: "ready", tree: { root, home, configHome } };
  rmSync9(root, { recursive: true, force: true });
  return { kind: "failed", result: `install-failed:${lastReportLine(outcome.report)}` };
}
function fixtureShimsIn(root) {
  return path13.join(root, FIXTURE_SHIMS_DIRECTORY);
}
function writeFixtureEngramShim(directory) {
  mkdirSync8(directory, { recursive: true });
  const shim = path13.join(directory, ENGRAM_BINARY_NAME);
  writeFileSync7(shim, FIXTURE_ENGRAM_SHIM);
  chmodSync3(shim, FIXTURE_SHIM_MODE);
  return shim;
}
function fixtureEnvironmentFor(environment, home, root) {
  const inherited = environment["PATH"] ?? "";
  const shims = fixtureShimsIn(root);
  return {
    ...environment,
    PATH: inherited === "" ? shims : `${shims}${path13.delimiter}${inherited}`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path13.join(root, "tmp"),
    XDG_CONFIG_HOME: path13.join(home, ".config"),
    XDG_STATE_HOME: path13.join(home, ".local", "state"),
    XDG_CACHE_HOME: path13.join(home, ".cache"),
    XDG_DATA_HOME: path13.join(home, ".local", "share")
  };
}
function openCodeVersionStatus(host) {
  return host.version ?? host.versionNote ?? OPENCODE_NOT_ON_PATH;
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
  const externalDirectories = isPlainObject(permission["external_directory"]) ? permission["external_directory"] : {};
  const posture = harnessGrantPostureOf(externalDirectories);
  return posture === "as installed" ? "valid" : posture;
}
function operatorConfigSeed() {
  return {
    theme: OPERATOR_CONFIG_PROBE.theme,
    model: OPERATOR_CONFIG_PROBE.sessionModel,
    small_model: OPERATOR_CONFIG_PROBE.sessionSmallModel,
    permission: { [OPERATOR_CONFIG_PROBE.permissionKey]: OPERATOR_CONFIG_PROBE.permissionVerdict },
    mcp: {
      [OPERATOR_CONFIG_PROBE.mcpServerName]: {
        type: "local",
        command: [...OPERATOR_CONFIG_PROBE.mcpServerCommand],
        enabled: true,
        environment: {}
      }
    },
    agent: { [OPERATOR_CONFIG_PROBE.agentName]: { model: OPERATOR_CONFIG_PROBE.agentModel } }
  };
}
function openCodeOperatorKeysStatus(configFile) {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "dropped";
  const document = read.value;
  if (document["theme"] !== OPERATOR_CONFIG_PROBE.theme) return "dropped";
  if (document["model"] !== OPERATOR_CONFIG_PROBE.sessionModel) return "dropped";
  if (document["small_model"] !== OPERATOR_CONFIG_PROBE.sessionSmallModel) return "dropped";
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  if (permission[OPERATOR_CONFIG_PROBE.permissionKey] !== OPERATOR_CONFIG_PROBE.permissionVerdict) return "dropped";
  const servers = isPlainObject(document["mcp"]) ? document["mcp"] : {};
  const server = servers[OPERATOR_CONFIG_PROBE.mcpServerName];
  if (!isPlainObject(server)) return "dropped";
  if (JSON.stringify(server["command"]) !== JSON.stringify(OPERATOR_CONFIG_PROBE.mcpServerCommand)) return "dropped";
  const agents = isPlainObject(document["agent"]) ? document["agent"] : {};
  const operatorAgent = agents[OPERATOR_CONFIG_PROBE.agentName];
  if (!isPlainObject(operatorAgent) || operatorAgent["model"] !== OPERATOR_CONFIG_PROBE.agentModel) return "dropped";
  return "preserved";
}
function profileForTheRow(workingDirectory) {
  try {
    return { kind: "read", profile: readProfile(workingDirectory) };
  } catch (error) {
    if (!(error instanceof ProfileMirrorRefusedError)) throw error;
    return { kind: "refused", reason: error.message };
  }
}
function profiledAgentModelLine(configFile, workingDirectory) {
  const reading = profileForTheRow(workingDirectory);
  if (reading.kind === "refused") return reading.reason;
  if (reading.profile.kind === "unmirrored") return unmirroredAgentModelLine(installedLineOf(configFile));
  const document = readableConfigDocument(configFile);
  if (document === void 0) return "an installed config this row can read";
  return agentModelLine(openCodeAgentModels(document, reading.profile.roles));
}
function installedAgentModelLine(configFile, workingDirectory) {
  const reading = profileForTheRow(workingDirectory);
  if (reading.kind === "read" && reading.profile.kind === "unmirrored") return unmirroredAgentModelLine(installedLineOf(configFile));
  return installedLineOf(configFile);
}
function unmirroredAgentModelLine(installedLine) {
  return `${NO_PROFILE_MIRROR_FOR_THIS_REPOSITORY}; the installed config carries: ${installedLine}`;
}
function installedLineOf(configFile) {
  const document = readableConfigDocument(configFile);
  if (document === void 0) return NO_CONFIG_THIS_ROW_CAN_READ;
  return agentModelLine(installedAgentModels(document));
}
function readableConfigDocument(configFile) {
  const read = readConfigDocument(configFile);
  return read.kind === "parsed" && isPlainObject(read.value) ? read.value : void 0;
}
function agentModelLine(agentModels) {
  const named = Object.keys(agentModels).sort();
  return named.length === 0 ? NO_AGENT_MODEL_KEY_NAMED : named.map((agent) => `${agent}=${agentModels[agent]}`).join(" ");
}
function operatorGlobalSeed() {
  return `# Personal OpenCode rules

${OPERATOR_GLOBAL_PROSE}
`;
}
function openCodeGlobalStatus(globalFile, expectedBody) {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const installed = markerRegionBodyOf(readFileSync12(globalFile, "utf8"));
  if (installed === void 0) return "malformed";
  return withoutTrailingNewlines(installed) === withoutTrailingNewlines(expectedBody) ? "exact" : "divergent";
}
function openCodeOperatorGlobalStatus(globalFile, seedText) {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const seedRecords = seedText.split("\n").length - 1;
  const head = readFileSync12(globalFile, "utf8").split("\n").slice(0, seedRecords).join("\n");
  return `${head}
` === seedText ? "preserved" : "rewritten";
}
function openCodeSkillStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const wrappers = osoPrefixedNames(sources.skills).filter((name) => isReadableRegularFile(path13.join(sources.skills, name, "SKILL.md")));
  const divergent = wrappers.filter((name) => !treesHoldTheSameBytes(path13.join(sources.skills, name), path13.join(configHome, "skill", name)));
  if (wrappers.length !== EXPECTED_SKILL_WRAPPER_COUNT) return `wrapper-count:${wrappers.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  const unpublished = installedSkillsBeyond(path13.join(configHome, "skill"), wrappers);
  if (unpublished.length > 0) return namedList("unknown", unpublished);
  return treesHoldTheSameBytes(sources.sharedSkills, path13.join(configHome, "skill", SHARED_SKILL_DIRECTORY)) ? "exact" : "shared-differs";
}
function installedSkillsBeyond(installedSkills, published) {
  return directoryEntryNames2(installedSkills).filter((name) => name !== SHARED_SKILL_DIRECTORY && !published.includes(name));
}
function openCodeAgentStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const published = osoPrefixedMarkdownNames2(sources.agents);
  const installed = osoPrefixedMarkdownNames2(path13.join(configHome, "agent"));
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path13.join(sources.agents, name), path13.join(configHome, "agent", name)));
  if (published.length !== installed.length) return `count:${published.length}!=${installed.length}`;
  return divergent.length === 0 ? "exact" : namedList("divergent", divergent);
}
function openCodeAgentMcpSurfaceStatus(configHome) {
  const installedAgents = path13.join(configHome, "agent");
  const contracts = osoPrefixedMarkdownNames2(installedAgents);
  if (contracts.length !== AGENT_ROLES.length) return `count:${contracts.length}!=${AGENT_ROLES.length}`;
  const reachable = contracts.flatMap((name) => reachableServersOf(path13.join(installedAgents, name), name));
  return reachable.length === 0 ? "closed" : namedList("open", reachable);
}
function openCodeServersReachableBeyondTheOwnedSet(configFile, configHome) {
  const ownedServers = OWNED_MCP_NAMES;
  const denials = agentPermissionDenialsIn(configHome);
  return declaredMcpServerNames(configFile).filter((server) => !ownedServers.includes(server)).map(mcpServerWildcard).map((wildcard) => ({ wildcard, agents: denials.filter((denied) => !denied.has(wildcard)).length })).filter((reachable) => reachable.agents > 0).map((reachable) => `${reachable.wildcard} (${reachable.agents} of ${denials.length} agents)`);
}
function declaredMcpServerNames(configFile) {
  const document = readableConfigDocument(configFile);
  const servers = document === void 0 ? void 0 : document["mcp"];
  return isPlainObject(servers) ? Object.keys(servers) : [];
}
function agentPermissionDenialsIn(configHome) {
  const installedAgents = path13.join(configHome, "agent");
  return osoPrefixedMarkdownNames2(installedAgents).map(
    (name) => deniedPermissionKeysOf(readFileSync12(path13.join(installedAgents, name), "utf8"))
  );
}
function reachableServersOf(agentContract, name) {
  const role = AGENT_ROLES.find((candidate) => `${candidate.id}.md` === name);
  if (role === void 0) return [`${name}:names-no-role`];
  const denied = deniedPermissionKeysOf(readFileSync12(agentContract, "utf8"));
  return OWNED_MCP_NAMES.filter(
    (server) => !role.opencode.mcpServersTheClaudeTwinLists.includes(server) && !denied.has(mcpServerWildcard(server))
  ).map((server) => `${name}:${mcpServerWildcard(server)}`);
}
function deniedPermissionKeysOf(agentContract) {
  const denied = /* @__PURE__ */ new Set();
  let insideThePermissionBlock = false;
  for (const line of frontMatterLinesOf(agentContract)) {
    if (line === PERMISSION_BLOCK_HEADING) {
      insideThePermissionBlock = true;
      continue;
    }
    if (!insideThePermissionBlock) continue;
    const verdict = PERMISSION_VERDICT_LINE.exec(line);
    if (verdict === null) continue;
    if (verdict[2] === "deny") denied.add(verdict[1]);
  }
  return denied;
}
function frontMatterLinesOf(agentContract) {
  const lines = agentContract.split("\n");
  if (lines[0] !== FRONT_MATTER_DELIMITER) return [];
  const closing = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
  return closing === -1 ? [] : lines.slice(1, closing);
}
function openCodeCommandStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  const published = osoPrefixedMarkdownNames2(sources.commands);
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path13.join(sources.commands, name), path13.join(configHome, "command", name)));
  if (published.length !== EXPECTED_MODE_COMMAND_COUNT) return `count:${published.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  for (const mode of OWNED_SKILL_MODES) {
    const route = agentRouteOf(path13.join(configHome, "command", `${mode}.md`));
    if (route !== MODE_COMMAND_AGENT_ROUTE) return `route:${mode}=${route === "" ? "empty" : route}`;
  }
  return "exact";
}
function openCodePluginStatus(repositoryRoot2, configHome) {
  const sources = openCodePayloadSources(repositoryRoot2);
  if (!filesHoldTheSameBytes(sources.pluginBundle, path13.join(configHome, "plugin", "oso-code.js"))) return "entry-divergent";
  const unbundled = directoryEntryNames2(path13.join(configHome, "plugin")).filter((name) => name.endsWith(".ts") || name === "oso");
  return unbundled.length === 0 ? "exact" : `unbundled-sources:${unbundled.length}`;
}
function openCodeEngramStatus(configHome) {
  return isReadableRegularFile(path13.join(configHome, "plugins", "engram.ts")) ? "present" : "missing";
}
function openCodeRegistryStatus(home, configHome) {
  const paths = opencodePathsFor(home, { XDG_CONFIG_HOME: path13.dirname(configHome) });
  const targets = openCodeInstallTargets(paths);
  if (!isReadableRegularFile(targets.ownerRegistry)) return "missing";
  const owned = new Set(
    readFileSync12(targets.ownerRegistry, "utf8").split("\n").filter((row) => row.startsWith(`${OWNER_INSTALLER}	`)).map((row) => row.slice(OWNER_INSTALLER.length + 1))
  );
  const expected = [
    paths.configFile,
    paths.globalFile,
    targets.skills,
    targets.agents,
    targets.commands,
    targets.plugin,
    path13.join(targets.stateBin, "oso-state"),
    path13.join(targets.gitHooks, "pre-commit"),
    ...directoryEntryNames2(targets.hooks).filter((name) => name.endsWith(".sh")).map((name) => path13.join(targets.hooks, name))
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
  const decoy = path13.join(tree.root, "decoy-config");
  const decoyConfigHome = path13.join(decoy, "opencode");
  mkdirSync8(decoyConfigHome, { recursive: true });
  writeFileSync7(path13.join(decoyConfigHome, "opencode.json"), `${DECOY_CONFIG_TEXT}
`);
  const outcome = installOpenCode({
    homeDirectory: tree.home,
    repositoryRoot: input.repositoryRoot,
    workingDirectory: input.workingDirectory,
    environment: { ...fixtureEnvironmentFor(input.environment, tree.home, tree.root), XDG_CONFIG_HOME: decoy },
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false
  });
  if (outcome.exitCode !== 2) return `exit:${outcome.exitCode}`;
  if (readFileSync12(path13.join(decoyConfigHome, "opencode.json"), "utf8").trim() !== DECOY_CONFIG_TEXT) return "overwrote-the-decoy-config";
  const entries = directoryEntryNames2(decoyConfigHome).length;
  return entries === 1 ? "refused" : `wrote-into-the-decoy:${entries}`;
}
function checkPluginWorkspaceBar(report2, input) {
  const workspace = path13.join(input.repositoryRoot, "opencode");
  if (!isReadableRegularFile(path13.join(workspace, "package.json")) || !onPath(input.environment, "npx")) {
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
  const unparseable = shellSourcesUnder(input.repositoryRoot).filter((source) => !ranCleanly("bash", ["-n", source], input.repositoryRoot, input.environment)).map((source) => path13.basename(source));
  report2.check("repository shell syntax", "clean", unparseable.length === 0 ? "clean" : namedList("bad", unparseable));
}
function shellSourcesUnder(repositoryRoot2) {
  const globbed = SHELL_SYNTAX_SOURCES.flatMap((source) => {
    const directory = path13.join(repositoryRoot2, ...source.directory);
    return directoryEntryNames2(directory).filter((name) => name.endsWith(source.suffix)).map((name) => path13.join(directory, name));
  });
  const named = SHELL_SYNTAX_EXTRA_SOURCES.map((segments) => path13.join(repositoryRoot2, ...segments));
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
    if (record === GLOBAL_MARKER_START) {
      starts += 1;
      inside = true;
      continue;
    }
    if (record === GLOBAL_MARKER_END) {
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
  const routed = readFileSync12(commandFile, "utf8").split("\n").flatMap((line) => {
    const match = /^agent:[ \t]*(.*)$/.exec(line);
    return match === null ? [] : [match[1]];
  });
  return routed[0] ?? "";
}
function treesHoldTheSameBytes(published, installed) {
  if (!isDirectory(installed)) return false;
  const publishedFiles = relativeFilesUnder(published);
  if (publishedFiles.length === 0) return false;
  const installedFiles = relativeFilesUnder(installed);
  if (publishedFiles.length !== installedFiles.length) return false;
  return publishedFiles.every(
    (relative, index) => relative === installedFiles[index] && filesHoldTheSameBytes(path13.join(published, relative), path13.join(installed, relative))
  );
}
function relativeFilesUnder(directory) {
  if (!isDirectory(directory)) return [];
  return readdirSync5(directory, { recursive: true }).map((entry) => entry.toString()).filter((relative) => isReadableRegularFile(path13.join(directory, relative))).sort();
}
function installedTargetExists(target) {
  return isReadableRegularFile(target) || isDirectory(target);
}
function relativeToHome(target, home) {
  return target.startsWith(`${home}${path13.sep}`) ? target.slice(home.length + 1) : target;
}
function directoryEntryNames2(directory) {
  try {
    return readdirSync5(directory).sort();
  } catch {
    return [];
  }
}
function osoPrefixedNames(directory) {
  return directoryEntryNames2(directory).filter((name) => name.startsWith("oso-"));
}
function osoPrefixedMarkdownNames2(directory) {
  return osoPrefixedNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path13.join(directory, name)));
}
function namedList(verdict, names) {
  return `${verdict}:${names.map((name) => ` ${name}`).join("")}`;
}
function foldedLines(lines) {
  return lines.join(" ").replace(/\s+/g, " ").replace(/\s+$/, "");
}
function onPath(environment, binaryName) {
  return spawnSync6(binaryName, ["--version"], { env: environment, encoding: "utf8" }).error === void 0;
}
function ranCleanly(command, argv, workingDirectory, environment) {
  const run = spawnSync6(command, [...argv], { cwd: workingDirectory, env: environment, encoding: "utf8" });
  return run.error === void 0 && run.status === 0;
}
function lastReportLine(report2) {
  const lines = report2.split("\n").filter((line) => line !== "");
  return lines.at(-1) ?? "";
}

// core/src/install/cli.ts
var VERBS = ["install", "verify", "repair", "purge"];
var HOSTS = ["claude", "opencode"];
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
var PROFILE_VERB = "profile";
var USAGE = `usage: oso <install|verify|repair|purge> --host <claude|opencode> [flags]
       oso ${PROFILE_VERB} show | set <normal|strong|custom> [--applier|--verifier|--judges <default|strong>[:<model>]]

arguments, per host and verb:
${HOSTS.flatMap((host) => VERBS.map((verb) => `  ${host.padEnd(9)} ${verb.padEnd(8)} ${argumentSummary(FLAGS_PER_HOST_AND_VERB[host][verb])}`)).join("\n")}

A flag offered to a host and verb that does not take it is refused, never ignored.
The ${PROFILE_VERB} verb takes no --host: one profile spans every host, and only a custom names its roles.
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
  const workingDirectory = process.cwd();
  const outcome = argv[0] === PROFILE_VERB ? runProfile(argv.slice(1), workingDirectory) : runHostVerb(argv, repositoryRoot2, workingDirectory);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
}
function runProfile(argv, workingDirectory) {
  const [subverb, name, ...roleTokens] = argv;
  if (subverb === "show" && argv.length === 1) return showProfile(workingDirectory, renderedOpenCodeConfigFile());
  if (subverb === "set" && name !== void 0) return setProfile(workingDirectory, name, roleTokens);
  throw new UsageError();
}
function renderedOpenCodeConfigFile() {
  return opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env).configFile;
}
function runHostVerb(argv, repositoryRoot2, workingDirectory) {
  const parsed = parseArgv(argv);
  const homeDirectory2 = homeDirectoryFrom(process.platform, process.env);
  const context = {
    homeDirectory: homeDirectory2,
    repositoryRoot: repositoryRoot2,
    workingDirectory,
    environment: process.env,
    platform: process.platform,
    assumeYes: parsed.flags.has("--yes"),
    installImpeccable: !parsed.flags.has("--no-impeccable"),
    installGitHook: !parsed.flags.has("--no-git-hook")
  };
  return runHost(parsed, context);
}
function runHost(parsed, context) {
  switch (parsed.host) {
    case "claude":
      return runClaude(parsed.verb, { ...context, architecture: process.arch, replaceClaudeMd: parsed.flags.has("--replace-claude-md") });
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
function runOpenCode(parsed, context) {
  switch (parsed.verb) {
    case "install":
      return installOpenCode({
        homeDirectory: context.homeDirectory,
        repositoryRoot: context.repositoryRoot,
        workingDirectory: context.workingDirectory,
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
        workingDirectory: context.workingDirectory,
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
