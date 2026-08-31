import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { childDirectoryNames, existsAtAll } from "./backup.ts";
import { readJsonObject } from "./json.ts";
import { VerifyReport } from "./report.ts";
import {
  isDirectory,
  isErrnoException,
  isExecutableRegularFile,
  isReadableRegularFile,
  isRegularNonSymlinkFile,
  sha256Hex,
} from "../state/store.ts";

const ENGRAM_FIX =
  "bash bootstrap/install.sh installs the engram plugin AND the pinned engram binary its .mcp.json spawns by name; where that binary is installed but the client still cannot start it, either the directory holding it is not on the PATH Claude Code reads or the copy there does not run at all — that run's wiring summary says which and names the command for it (check 13 below discriminates the two on Windows), and Claude Code has to be restarted after";
const CONTEXT7_FIX =
  "claude plugin install oso-code@oso-code registers it (it ships in the plugin's .mcp.json, so there is no mcp add to run), and it starts through npx — so install Node.js if npx is missing, then restart Claude Code";
const FALLOW_FIX =
  "bash bootstrap/install.sh installs the pinned fallow package from npm and wires a missing entry; an existing one it never touches, so repoint that with claude mcp remove fallow -s user && claude mcp add --scope user fallow -- the command that run names";
const STATE_BIN_FIX = "bash bootstrap/install.sh publishes the installed plugin's absolute bin/oso-state there, then restart Claude Code";
const GIT_BASH_FIX =
  "point CLAUDE_CODE_GIT_BASH_PATH at the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe) — bootstrap\\install.ps1 finds it and hands it to install.sh, which repairs the stored value; then restart Claude Code";
export const LEGACY_HOOK_COMMAND_PATTERNS = ["check-plan-contract", "clean-code-gate", "skill-registry-refresh", "gentle-ai"];
export const CLAUDE_MD_BUDGET_BYTES = 8000;
const HOME_DIR_FIX =
  'export HOME="$USERPROFILE" in Git Bash and re-run bootstrap/install.sh';
const ENGRAM_BINARY_FIX =
  "bash bootstrap/install.sh downloads the pinned engram release into ~/.local/bin and reports it only once it answers; where one is already installed elsewhere, the verdict above says which half is missing — a directory not on the persisted PATH, which that run's wiring summary names the command to add (a new terminal plus a Claude Code restart is what picks it up), or a copy that does not run, which an antivirus may have quarantined and which that run tells you how to replace";

export type VerifyClaudeInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}>;

export type VerifyOutcome = Readonly<{ report: string; exitCode: number }>;

export function verifyClaude(input: VerifyClaudeInput): VerifyOutcome {
  const { homeDirectory, repositoryRoot, environment, platform } = input;
  const claudeDir = path.join(homeDirectory, ".claude");
  const report = new VerifyReport();

  const pluginListing = spawnClaudeStdout(environment, ["plugin", "list"]);
  const mcpListing = spawnClaudeStdout(environment, ["mcp", "list"]);
  checkPluginInstalled(report, pluginListing);
  checkMcpConnectivity(report, mcpListing);
  checkLegacyArtifactsRemoved(report, repositoryRoot, claudeDir);
  checkSettingsFreeOfGentleHooks(report, claudeDir);
  checkClaudeMdBudget(report, claudeDir);
  checkInstalledHookDeniesRedCommit(report, claudeDir, environment);
  checkOsoStateBinRoundTrips(report, claudeDir, environment);
  checkHookRegressionSuite(report, repositoryRoot, environment);
  checkImpeccablePluginInstalled(report, homeDirectory, pluginListing);
  checkImpeccableCliRunnable(report, environment);
  checkGitCommitHook(report, repositoryRoot, environment);
  checkNoCarriageReturnBytes(report, repositoryRoot);
  checkWindowsHomeDirectory(report, environment);
  checkEngramBinaryResolves(report, environment, platform);
  checkGitBashPath(report, claudeDir);
  noteClaudeDesktop(report, homeDirectory, environment);

  return { report: report.render(), exitCode: report.exitCode };
}

export function checkPluginInstalled(report: VerifyReport, pluginListing: string): void {
  report.check("oso-code plugin installed", "1", countMatchingLines(pluginListing, "oso-code") >= 1 ? "1" : "0");
}

export function checkMcpConnectivity(report: VerifyReport, mcpListing: string): void {
  report.check("engram MCP connected", "1", mcpConnected(mcpListing, "engram"), ENGRAM_FIX);
  report.check("context7 MCP connected", "1", mcpConnected(mcpListing, "context7"), CONTEXT7_FIX);
  report.check("fallow MCP connected", "1", mcpConnected(mcpListing, "fallow"), FALLOW_FIX);
}

export function checkLegacyArtifactsRemoved(report: VerifyReport, repositoryRoot: string, claudeDir: string): void {
  const manifest = path.join(repositoryRoot, "bootstrap", "gentle-manifest.txt");
  let content: string;
  try {
    content = readFileSync(manifest, "utf8");
  } catch (cause) {
    report.check("legacy artifacts removed", "0", errorMessageOf(cause));
    return;
  }
  let left = 0;
  for (const rel of manifestEntries(content)) {
    if (!existsAtAll(path.join(claudeDir, rel))) continue;
    left += 1;
    report.detail(`still present: ${rel}`);
  }
  report.check("legacy artifacts removed", "0", String(left));
}

export function checkSettingsFreeOfGentleHooks(report: VerifyReport, claudeDir: string): void {
  const settings = path.join(claudeDir, "settings.json");
  report.check("settings.json free of gentle hooks", "0", grepCountOrErrorMessage(settings, LEGACY_HOOK_COMMAND_PATTERNS));
}

export function checkClaudeMdBudget(report: VerifyReport, claudeDir: string): void {
  const claudeMd = path.join(claudeDir, "CLAUDE.md");
  if (!isReadableRegularFile(claudeMd)) {
    report.check("CLAUDE.md under budget", "1", `unreadable ${claudeMd}`);
    return;
  }
  const byteSize = statSync(claudeMd).size;
  report.check("CLAUDE.md under budget", "1", byteSize < CLAUDE_MD_BUDGET_BYTES ? "1" : "0");
  report.detail(`CLAUDE.md size: ${byteSize} bytes`);
}

export function checkInstalledHookDeniesRedCommit(report: VerifyReport, claudeDir: string, environment: NodeJS.ProcessEnv): void {
  const installRoot = resolveInstallRoot(claudeDir);
  if (installRoot === "") {
    report.check("plugin install path found", "1", "0");
    return;
  }
  const gate = findGateBundle(installRoot);
  if (gate === undefined) {
    report.check("installed hook executable", "1", "0");
    return;
  }
  const outcome = runInstalledHookProbe(gate, environment);
  if (outcome.includes('"permissionDecision":"deny"')) {
    report.check("installed hook denies red commit (e2e)", "1", "1");
    return;
  }
  report.check("installed hook denies red commit (e2e)", "deny", outcome === "" ? "empty" : outcome);
}

export function checkOsoStateBinRoundTrips(report: VerifyReport, claudeDir: string, environment: NodeJS.ProcessEnv): void {
  const settingsFile = path.join(claudeDir, "settings.json");
  const storedStateBin = clientEnvValue(settingsFile, "OSO_STATE_BIN");
  if (storedStateBin === "") {
    report.check("OSO_STATE_BIN round-trips oso-state (e2e)", "probe", `no OSO_STATE_BIN in ${settingsFile}`, STATE_BIN_FIX);
    return;
  }
  const probe = runOsoStateProbe(storedStateBin, environment);
  report.check("OSO_STATE_BIN round-trips oso-state (e2e)", "probe", probe === "" ? "empty" : probe, STATE_BIN_FIX);
  report.detail(`OSO_STATE_BIN: ${storedStateBin}`);
}

export function checkHookRegressionSuite(report: VerifyReport, repositoryRoot: string, environment: NodeJS.ProcessEnv): void {
  if (environment["OSO_VERIFY_SKIP_SLOW"] === "1") {
    report.skip("hook regression suite — OSO_VERIFY_SKIP_SLOW (CI runs the suite as its own step)");
    return;
  }
  const result = spawnSync("bash", [path.join(repositoryRoot, "tests", "hooks-test.sh")], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "ignore",
  });
  report.check("hook regression suite", "pass", result.status === 0 ? "pass" : "fail");
}

export function impeccableOptOutMarker(homeDirectory: string): string {
  return path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
}

export function checkImpeccablePluginInstalled(report: VerifyReport, homeDirectory: string, pluginListing: string): void {
  const marker = impeccableOptOutMarker(homeDirectory);
  if (isReadableRegularFile(marker)) {
    report.note(
      "impeccable plugin skipped — install.sh ran with --no-impeccable, so the design bar has no plugin half here; re-run install.sh without the flag to wire it",
    );
    return;
  }
  report.check("impeccable plugin installed", "1", countMatchingLines(pluginListing, "impeccable") >= 1 ? "1" : "0");
}

export function checkImpeccableCliRunnable(report: VerifyReport, environment: NodeJS.ProcessEnv): void {
  if (environment["OSO_VERIFY_SKIP_SLOW"] === "1") {
    report.skip("impeccable CLI runnable via npx — OSO_VERIFY_SKIP_SLOW (the probe would fetch the package from npm)");
    return;
  }
  report.check("impeccable CLI runnable via npx", "1", impeccableCliRunnable(environment));
}

export function checkGitCommitHook(report: VerifyReport, repositoryRoot: string, environment: NodeJS.ProcessEnv): void {
  const gitHook = path.join(repositoryRoot, "plugin", "git-hooks", "pre-commit");
  const wiredHooksPath = gitConfigValue(repositoryRoot, "core.hooksPath", environment);
  if (normalizedPath(wiredHooksPath) === normalizedPath(path.dirname(gitHook))) {
    report.check("git commit hook executable at the wired core.hooksPath", "1", isExecutableRegularFile(gitHook) ? "1" : "0");
    return;
  }
  report.note(
    `core.hooksPath is ${wiredHooksPath === "" ? "unset" : wiredHooksPath} in ${repositoryRoot} — the git commit layer is not wired here, so only the PreToolUse gate applies`,
  );
}

export function checkNoCarriageReturnBytes(report: VerifyReport, repositoryRoot: string): void {
  const candidates = [
    ...filesUnderRelative(repositoryRoot, "plugin", "hooks"),
    ...filesUnderRelative(repositoryRoot, "plugin", "bin"),
    ...filesUnderRelative(repositoryRoot, "plugin", "git-hooks"),
    ...directChildrenWithExtension(repositoryRoot, "bootstrap", ".sh"),
    ...directChildrenWithExtension(repositoryRoot, "bootstrap", ".ps1"),
    ...directChildrenWithExtension(repositoryRoot, "bootstrap", ".bat"),
  ];
  if (candidates.length === 0) {
    report.check("shipped executables carry no CR bytes", "at least one file scanned", "0 files scanned");
    return;
  }
  const matched = candidates.filter((relative) => containsCarriageReturn(path.join(repositoryRoot, relative)));
  report.check("shipped executables carry no CR bytes", "none", matched.length === 0 ? "none" : `${matched.join(" ")} `);
}

export function checkWindowsHomeDirectory(report: VerifyReport, environment: NodeJS.ProcessEnv): void {
  const userProfile = environment["USERPROFILE"];
  const home = environment["HOME"] ?? "";
  if (userProfile === undefined || userProfile === "") {
    report.note(
      `home dir the Windows client reads — %USERPROFILE% is unset, so no Windows-native client reads a home dir here and $HOME (${home}) is the only tree in play`,
    );
    return;
  }
  const clientHome = normalizedPath(userProfile) === normalizedPath(home) ? home : userProfile;
  report.check("home dir the Windows client reads", clientHome, home, HOME_DIR_FIX);
}

export function checkEngramBinaryResolves(report: VerifyReport, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  if (platform !== "win32") {
    report.note(
      "engram binary the client resolves and runs — this is not Git Bash on Windows, so the client resolves a bare `engram` against this same PATH and starting the server exercises both, which check 2 already does",
    );
    return;
  }
  const binaryName = "engram.exe";
  const resolved = firstExecutableOnPath(environment, binaryName);
  const state =
    resolved === undefined
      ? `no ${binaryName} on the persisted machine or user PATH`
      : engramBinaryRuns(platform, resolved, environment)
        ? "1"
        : `${resolved} does not run`;
  report.check("engram binary the client resolves and runs", "1", state, ENGRAM_BINARY_FIX);
  if (resolved !== undefined) report.detail(`engram binary: ${resolved}`);
}

export function checkGitBashPath(report: VerifyReport, claudeDir: string): void {
  const settingsFile = path.join(claudeDir, "settings.json");
  const storedGitBash = clientEnvValue(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH");
  if (storedGitBash === "") {
    report.note(
      "Git Bash path the client spawns hooks with — settings.json publishes no CLAUDE_CODE_GIT_BASH_PATH, so Claude Code locates Git Bash itself; bootstrap/install.ps1 is what discovers a path and hands it to install.sh to publish",
    );
    return;
  }
  const resolves = isRegularNonSymlinkFile(storedGitBash);
  report.check("Git Bash path the client spawns hooks with", "1", resolves ? "1" : `${storedGitBash} is not there any more`, GIT_BASH_FIX);
  if (resolves) report.detail(`Git Bash: ${storedGitBash}`);
}

export function noteClaudeDesktop(report: VerifyReport, homeDirectory: string, environment: NodeJS.ProcessEnv): void {
  const locations = claudeDesktopLocations(homeDirectory, environment);
  const installed = locations.find(existsFollowingSymlinks);
  if (installed === undefined) {
    report.note(
      `Claude Desktop — none of ${locations.join(" ")} is here, so this machine runs the CLI alone and the checks above are the whole install; Desktop is an application to download from claude.ai/download, not something this bootstrap installs, and it would need nothing installed here that is not already`,
    );
    return;
  }
  report.note(
    `Claude Desktop — ${installed}; its Code tab runs the CLI's engine and shares this ~/.claude — CLAUDE.md, MCP servers, hooks, skills and settings — so every check above answers for it too; what no shell can see is whether a running Desktop has loaded them, and the chat tab is a separate surface nothing here writes`,
  );
}

function spawnClaudeStdout(environment: NodeJS.ProcessEnv, args: readonly string[]): string {
  const result = spawnSync("claude", args, { env: environment, encoding: "utf8" });
  return result.error === undefined ? result.stdout : "";
}

function countMatchingLines(text: string, substring: string): number {
  return text.split("\n").filter((line) => line.includes(substring)).length;
}

function mcpConnected(mcpListing: string, name: string): "1" | "0" {
  const pattern = new RegExp(`^(plugin:[^:]+:)?${name}:`);
  return mcpListing.split("\n").some((line) => pattern.test(line) && line.includes("Connected")) ? "1" : "0";
}

export function manifestEntries(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function grepCountOrErrorMessage(file: string, patterns: readonly string[]): string {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === "ENOENT") return `grep: ${file}: No such file or directory`;
    if (isErrnoException(cause) && cause.code === "EISDIR") return `grep: ${file}: Is a directory`;
    throw cause;
  }
  const matches = content.split("\n").filter((line) => patterns.some((pattern) => line.includes(pattern))).length;
  return String(matches);
}

function resolveInstallRoot(claudeDir: string): string {
  const installedPlugins = path.join(claudeDir, "plugins", "installed_plugins.json");
  const fromManifest = installRootFromManifest(installedPlugins);
  if (fromManifest !== undefined && isDirectory(fromManifest)) return fromManifest;
  return highestVersionedCacheDirectory(path.join(claudeDir, "plugins", "cache", "oso-code", "oso-code"));
}

export function installRootFromManifest(installedPluginsFile: string): string | undefined {
  if (!isReadableRegularFile(installedPluginsFile)) return undefined;
  try {
    const parsed = readJsonObject(installedPluginsFile);
    const plugins = parsed["plugins"];
    const entries = isRecord(plugins) ? plugins["oso-code@oso-code"] : undefined;
    const first = Array.isArray(entries) ? entries[0] : undefined;
    const installPath = isRecord(first) ? first["installPath"] : undefined;
    return typeof installPath === "string" && installPath !== "" ? installPath : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function highestVersionedCacheDirectory(cacheDirectory: string): string {
  const names = childDirectoryNames(cacheDirectory);
  if (names.length === 0) return "";
  const highest = [...names].sort(compareVersionsAscending).at(-1);
  return highest === undefined ? "" : path.join(cacheDirectory, highest);
}

export function compareVersionsAscending(a: string, b: string): number {
  const segmentsOf = (value: string): string[] => value.split(/(\d+)/).filter((segment) => segment !== "");
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

function findGateBundle(installRoot: string): string | undefined {
  const suffix = `${path.sep}dist${path.sep}gate.js`;
  const found = allFilesUnder(installRoot).find((absolute) => absolute.endsWith(suffix));
  return found;
}

function allFilesUnder(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { recursive: true })
    .map((entry) => path.join(directory, entry.toString()))
    .filter((absolute) => isRegularNonSymlinkFile(absolute));
}

function runInstalledHookProbe(gate: string, environment: NodeJS.ProcessEnv): string {
  const hookHome = mkdtempSync(path.join(tmpdir(), "oso-verify-hook-"));
  try {
    const stateKey = sha256Hex(hookHome);
    const stateDir = path.join(hookHome, ".local", "state", "oso-code");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, `${stateKey}.state`), "mode=plan\nverify_green=false\n");
    const stdin = JSON.stringify({
      session_id: "e2e",
      cwd: hookHome,
      tool_input: { command: "git commit -m x" },
    });
    const result = spawnSync("node", [gate, "commit"], {
      input: stdin,
      env: { ...environment, HOME: hookHome, USERPROFILE: hookHome, OSO_AGENT: "1" },
      encoding: "utf8",
    });
    return collapsedNewlines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  } finally {
    rmSync(hookHome, { recursive: true, force: true });
  }
}

export function clientEnvValue(settingsFile: string, key: string): string {
  if (!isReadableRegularFile(settingsFile)) return "";
  try {
    const value = readJsonObject(settingsFile)["env"];
    const found = isRecord(value) ? value[key] : undefined;
    return typeof found === "string" ? found : "";
  } catch {
    return "";
  }
}

function runOsoStateProbe(stateBin: string, environment: NodeJS.ProcessEnv): string {
  const probeHome = mkdtempSync(path.join(tmpdir(), "oso-verify-probe-"));
  try {
    const env = { ...environment, HOME: probeHome, USERPROFILE: probeHome, OSO_STATE_BIN: stateBin };
    const runStateScript = (...args: string[]) => spawnSync(process.execPath, [stateBin, ...args], { env, encoding: "utf8" });
    const setResult = runStateScript("--session", "verify-probe", "set", "mode=probe");
    if (setResult.error !== undefined || setResult.status !== 0) return collapsedNewlines(errorOutputOf(setResult));
    const getResult = runStateScript("--session", "verify-probe", "get", "mode");
    if (getResult.error !== undefined || getResult.status !== 0) return collapsedNewlines(errorOutputOf(getResult));
    runStateScript("--session", "verify-probe", "clear");
    return collapsedNewlines(getResult.stdout);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

function errorOutputOf(result: { stdout?: string; stderr?: string; error?: Error }): string {
  if (result.error !== undefined) return result.error.message;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function collapsedNewlines(text: string): string {
  return text.replace(/\n+$/, "").replace(/\n/g, " ");
}

function impeccableCliRunnable(environment: NodeJS.ProcessEnv): string {
  const npxProbeBoundSeconds = 20;
  const result = spawnSync("npx", ["impeccable", "--version"], {
    env: environment,
    encoding: "utf8",
    timeout: npxProbeBoundSeconds * 1000,
    stdio: "ignore",
  });
  if (result.error !== undefined && isErrnoException(result.error) && result.error.code === "ETIMEDOUT") {
    return `no answer within ${npxProbeBoundSeconds}s`;
  }
  return result.status === 0 ? "1" : "0";
}

export function gitConfigValue(repositoryRoot: string, key: string, environment: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", ["-C", repositoryRoot, "config", "--get", key], { env: environment, encoding: "utf8" });
  return result.error === undefined && result.status === 0 ? result.stdout.replace(/\n+$/, "") : "";
}

export function normalizedPath(input: string): string {
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

function filesUnderRelative(repositoryRoot: string, ...segments: readonly string[]): string[] {
  const directory = path.join(repositoryRoot, ...segments);
  return allFilesUnder(directory).map((absolute) => toPosix(path.relative(repositoryRoot, absolute)));
}

function directChildrenWithExtension(repositoryRoot: string, dir: string, extension: string): string[] {
  const absolute = path.join(repositoryRoot, dir);
  if (!isDirectory(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(extension) && isRegularNonSymlinkFile(path.join(absolute, name)))
    .map((name) => toPosix(path.join(dir, name)));
}

function containsCarriageReturn(file: string): boolean {
  return readFileSync(file).includes(0x0d);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function firstExecutableOnPath(environment: NodeJS.ProcessEnv, binaryName: string): string | undefined {
  const entries = (environment["PATH"] ?? "").split(path.delimiter).filter((entry) => entry !== "");
  for (const entry of entries) {
    const candidate = path.join(entry, binaryName);
    if (isExecutableRegularFile(candidate)) return candidate;
  }
  return undefined;
}

export const ENGRAM_PROBE_TIMEOUT_MS = 10_000;
export const ENGRAM_PROBE_ENVIRONMENT_KEYS = ["PATH", "SystemRoot", "windir"];
const POSIX_KERNEL_EXECUTABLE_MAGICS = ["\x7fELF", "#!", "\xcf\xfa\xed\xfe", "\xce\xfa\xed\xfe", "\xca\xfe\xba\xbe"];
const WIN32_KERNEL_EXECUTABLE_MAGICS = ["MZ"];
const WIDEST_EXECUTABLE_MAGIC_BYTES = Math.max(
  ...[...POSIX_KERNEL_EXECUTABLE_MAGICS, ...WIN32_KERNEL_EXECUTABLE_MAGICS].map((magic) => magic.length),
);

export function engramBinaryRuns(platform: NodeJS.Platform, binary: string, environment: NodeJS.ProcessEnv): boolean {
  if (!kernelExecutesDirectly(platform, binary)) return false;
  const result = spawnSync(binary, ["version"], {
    encoding: "utf8",
    timeout: ENGRAM_PROBE_TIMEOUT_MS,
    env: probeEnvironment(environment),
  });
  return result.error === undefined && result.status === 0;
}

export function kernelExecutesDirectly(platform: NodeJS.Platform, binary: string): boolean {
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

function probeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const carried = ENGRAM_PROBE_ENVIRONMENT_KEYS.map((key) => [key, environment[key]] as const);
  return Object.fromEntries(carried.filter(([, value]) => value !== undefined));
}

function claudeDesktopLocations(homeDirectory: string, environment: NodeJS.ProcessEnv): string[] {
  return [
    "/Applications/Claude.app",
    path.join(homeDirectory, "Library", "Application Support", "Claude"),
    path.join(environment["LOCALAPPDATA"] ?? path.join(homeDirectory, "AppData", "Local"), "AnthropicClaude"),
    path.join(environment["APPDATA"] ?? path.join(homeDirectory, "AppData", "Roaming"), "Claude"),
    path.join(homeDirectory, ".config", "Claude"),
  ];
}

function existsFollowingSymlinks(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false }) !== undefined;
}

export function errorMessageOf(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const collapsed = collapsedNewlines(message);
  return collapsed === "" ? "empty" : collapsed;
}
