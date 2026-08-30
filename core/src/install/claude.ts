import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  installBackupBudgetKib,
  installBackupDirsNewestFirst,
  installBackupsOverBudget,
  restoreBackupManifest,
  serializeManifestRow,
  type ManifestRow,
  type RestoreOutcome,
} from "./backup.ts";
import { ENGRAM_SOURCE_REPO, engramBinaryName, provisionEngramBinary, type EngramProvisionOutcome, type EngramTransport } from "./engram.ts";
import { readJsonObject, writeJsonFile } from "./json.ts";
import { SUPPORTED_ENGRAM_VERSION } from "./pins.ts";
import {
  CLAUDE_MD_BUDGET_BYTES,
  LEGACY_HOOK_COMMAND_PATTERNS,
  clientEnvValue,
  collapsedNewlines,
  engramBinaryRuns,
  errorMessageOf,
  existsAtAll,
  firstExecutableOnPath,
  gitConfigValue,
  impeccableOptOutMarker,
  installRootFromManifest,
  manifestEntries,
  normalizedPath,
} from "./verify-claude.ts";
import { isDirectory, isExecutableRegularFile, isReadableRegularFile, isRegularNonSymlinkFile, isoTimestamp, writeFileAtomically } from "../state/store.ts";

const MARKETPLACE_SOURCE = "SoyJohnXD/oso-code";
const SUPPORTED_FALLOW_VERSION = "3.14.0";
const CLAUDE_MD_MARKER_START = "<!-- oso-code:start -->";
const CLAUDE_MD_MARKER_END = "<!-- oso-code:end -->";
const OUTPUT_STYLE_KNOWN_VALUES = ["Gentleman", "Oso"];
const CLAUDE_INSTALL_BACKUP_FORMAT = "oso-code-claude-install-v1";
const CLAUDE_REPAIR_BACKUP_FORMAT = "oso-code-claude-repair-v1";
const CLAUDE_PURGE_BACKUP_FORMAT = "oso-code-claude-purge-v1";

export type ClaudeCommandInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
  assumeYes: boolean;
  replaceClaudeMd?: boolean;
  installImpeccable?: boolean;
  installGitHook?: boolean;
  engramTransport?: EngramTransport;
}>;

export type ClaudeOutcome = Readonly<{ report: string; exitCode: number }>;

export class ClaudePluginInstallError extends Error {
  readonly output: string;
  constructor(output: string) {
    super(`claude plugin install oso-code@oso-code failed: ${output}`);
    this.name = "ClaudePluginInstallError";
    this.output = output;
  }
}

export function installClaude(input: ClaudeCommandInput): ClaudeOutcome {
  if (!input.assumeYes) return requiresYesOutcome("install");
  const claudeDir = path.join(input.homeDirectory, ".claude");
  const settingsFile = path.join(claudeDir, "settings.json");
  const claudeMdFile = path.join(claudeDir, "CLAUDE.md");
  const legacyTargets = legacyArtifactTargets(input.repositoryRoot, claudeDir);

  let tx: BackupTransaction;
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

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  const wiring: WiringEntry[] = [];

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
  if (gitBash !== undefined) wiring.push(gitBash);

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

export function repairClaude(input: ClaudeCommandInput): ClaudeOutcome {
  if (!input.assumeYes) return requiresYesOutcome("repair");
  const claudeDir = path.join(input.homeDirectory, ".claude");
  const settingsFile = path.join(claudeDir, "settings.json");
  const claudeMdFile = path.join(claudeDir, "CLAUDE.md");

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_REPAIR_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("repair", "could not create the pre-repair backup", error);
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  const wiring: WiringEntry[] = [];

  wiring.push(publishStateBinPath(claudeDir, settingsFile));
  const gitBash = publishGitBashPath(input.platform, input.environment, settingsFile);
  if (gitBash !== undefined) wiring.push(gitBash);
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

export function purgeClaude(input: ClaudeCommandInput): ClaudeOutcome {
  if (!input.assumeYes) return requiresYesOutcome("purge");
  const claudeDir = path.join(input.homeDirectory, ".claude");
  const settingsFile = path.join(claudeDir, "settings.json");
  const claudeMdFile = path.join(claudeDir, "CLAUDE.md");

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(backupsRootOf(input.homeDirectory), CLAUDE_PURGE_BACKUP_FORMAT);
    backupTarget(tx, "settings", settingsFile);
    backupTarget(tx, "claude-md", claudeMdFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "could not create the pre-purge backup", error);
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`, "no login or installation command was run"];
  const wiring: WiringEntry[] = [];

  wiring.push(toWiringEntry("OSO_STATE_BIN", removeClientEnv(settingsFile, "OSO_STATE_BIN")));
  wiring.push(toWiringEntry("CLAUDE_CODE_GIT_BASH_PATH", removeClientEnv(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH")));
  wiring.push(toWiringEntry("output style", clearOsoOutputStyle(settingsFile)));
  infoLines.push("legacy hook entries: remove-only in the ownership table — nothing recorded as ours to reverse");

  try {
    const stripped = stripClaudeMdRegion(claudeMdFile);
    wiring.push(stripped ? wiringOk("CLAUDE.md region", "removed") : wiringOk("CLAUDE.md region", "nothing to remove"));
  } catch (error) {
    const restore = rollback(tx);
    return fatalOutcome("purge", "could not rewrite CLAUDE.md", error, restore);
  }

  const mcpRemove = spawnSync("claude", ["mcp", "remove", "--scope", "user", "fallow"], { env: input.environment, encoding: "utf8" });
  wiring.push(
    mcpRemove.error === undefined && mcpRemove.status === 0
      ? wiringOk("fallow (mcp)", "removed")
      : wiringFail("fallow (mcp)", `nothing removed, or already absent: ${collapsedOutput(mcpRemove)}`),
  );

  return { report: renderCommandReport("purge", infoLines, wiring), exitCode: 0 };
}

type BackupTransaction = { readonly backupRoot: string; readonly itemsDirectory: string; readonly manifest: ManifestRow[] };

function backupsRootOf(homeDirectory: string): string {
  return path.join(homeDirectory, ".local", "state", "oso-code", "claude-backups");
}

function beginTransaction(backupsRoot: string, format: string): BackupTransaction {
  const backupRoot = path.join(backupsRoot, `install-backup-${compactTimestamp()}-${process.pid}`);
  const itemsDirectory = path.join(backupRoot, "items");
  mkdirSync(itemsDirectory, { recursive: true });
  writeFileSync(path.join(backupRoot, "format"), `${format}\n`);
  return { backupRoot, itemsDirectory, manifest: [] };
}

function backupTarget(tx: BackupTransaction, label: string, target: string): void {
  if (!existsAtAll(target)) {
    tx.manifest.push({ status: "absent", label, target });
    return;
  }
  const destination = path.join(tx.itemsDirectory, label);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(target, destination, { recursive: true });
  tx.manifest.push({ status: "present", label, target });
}

function commitManifest(tx: BackupTransaction): void {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  writeFileSync(path.join(tx.backupRoot, "manifest"), text === "" ? "" : `${text}\n`);
}

function rollback(tx: BackupTransaction): RestoreOutcome {
  const text = tx.manifest.map(serializeManifestRow).join("\n");
  return restoreBackupManifest(text, tx.itemsDirectory);
}

function compactTimestamp(): string {
  const iso = isoTimestamp();
  const [datePart = "", timePart = ""] = iso.replace("Z", "").split("T");
  return `${datePart.replaceAll("-", "")}-${timePart.replaceAll(":", "")}`;
}

function pruneInstallBackups(backupsRoot: string, environment: NodeJS.ProcessEnv): string[] {
  const budgetKib = installBackupBudgetKib(environment);
  const over = installBackupsOverBudget(installBackupDirsNewestFirst(backupsRoot), budgetKib);
  for (const backup of over) rmSync(backup, { recursive: true, force: true });
  return over;
}

type BackupCandidate = Readonly<{ label: string; target: string }>;

function backupClientConfigTargets(homeDirectory: string, claudeDir: string): readonly BackupCandidate[] {
  const targets: BackupCandidate[] = [{ label: "claude-json", target: path.join(homeDirectory, ".claude.json") }];
  const pluginsDir = path.join(claudeDir, "plugins");
  if (!isDirectory(pluginsDir)) return targets;
  for (const name of readdirSync(pluginsDir).filter((entry) => entry.endsWith(".json"))) {
    targets.push({ label: `plugins-json-${name}`, target: path.join(pluginsDir, name) });
  }
  return targets;
}

function legacyArtifactTargets(repositoryRoot: string, claudeDir: string): readonly BackupCandidate[] {
  const manifestFile = path.join(repositoryRoot, "bootstrap", "gentle-manifest.txt");
  const content = readFileSync(manifestFile, "utf8");
  return manifestEntries(content).map((relative) => ({ label: relative, target: path.join(claudeDir, relative) }));
}

function removeLegacyArtifacts(targets: readonly BackupCandidate[]): { removed: number } {
  let removed = 0;
  for (const { target } of targets) {
    if (!existsAtAll(target)) continue;
    rmSync(target, { recursive: true, force: true });
    removed += 1;
  }
  return { removed };
}

export type SettingsWriteOutcome =
  | { readonly kind: "written"; readonly note: string }
  | { readonly kind: "unchanged"; readonly note: string }
  | { readonly kind: "failed"; readonly note: string };

export function storeClientEnv(settingsFile: string, key: string, value: string): void {
  const settings = readJsonObject(settingsFile);
  const env = isPlainRecord(settings["env"]) ? settings["env"] : {};
  writeJsonFile(settingsFile, { ...settings, env: { ...env, [key]: value } });
}

export function removeClientEnv(settingsFile: string, key: string): SettingsWriteOutcome {
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
    return { kind: "failed", note: `left settings.json as it was — ${errorMessageOf(error)}` };
  }
}

export function removeLegacySettingsEntries(settingsFile: string): SettingsWriteOutcome {
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
    return { kind: "failed", note: `left settings.json exactly as it was — ${errorMessageOf(error)}` };
  }
}

function withoutLegacyHookEntries(hooks: Record<string, unknown>): { filtered: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const filtered: Record<string, unknown> = {};
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

function isLegacyHookEntry(entry: unknown): boolean {
  if (!isPlainRecord(entry) || !Array.isArray(entry["hooks"])) return false;
  return entry["hooks"].some(
    (nested) =>
      isPlainRecord(nested) &&
      typeof nested["command"] === "string" &&
      LEGACY_HOOK_COMMAND_PATTERNS.some((pattern) => (nested["command"] as string).includes(pattern)),
  );
}

export function ensureOutputStyle(settingsFile: string): SettingsWriteOutcome {
  try {
    const settings = isReadableRegularFile(settingsFile) ? readJsonObject(settingsFile) : {};
    const current = settings["outputStyle"];
    if (typeof current === "string" && current !== "" && !OUTPUT_STYLE_KNOWN_VALUES.includes(current)) {
      return { kind: "unchanged", note: `keeping your output style "${current}" — switch to Oso anytime via /config → output style` };
    }
    writeJsonFile(settingsFile, { ...settings, outputStyle: "Oso" });
    return { kind: "written", note: "output style set to Oso" };
  } catch (error) {
    return { kind: "failed", note: `left your output style as it was — ${errorMessageOf(error)}` };
  }
}

export function clearOsoOutputStyle(settingsFile: string): SettingsWriteOutcome {
  if (!isReadableRegularFile(settingsFile)) return { kind: "unchanged", note: "no settings.json to clear" };
  try {
    const settings = readJsonObject(settingsFile);
    if (settings["outputStyle"] !== "Oso") return { kind: "unchanged", note: "output style is not Oso — left alone" };
    const rest = { ...settings };
    delete rest["outputStyle"];
    writeJsonFile(settingsFile, rest);
    return { kind: "written", note: "output style cleared" };
  } catch (error) {
    return { kind: "failed", note: `left your output style as it was — ${errorMessageOf(error)}` };
  }
}

export function mergeGlobalClaudeMd(claudeMdFile: string, blockBody: string, options: { replace: boolean }): void {
  const shouldMerge = !options.replace && isReadableRegularFile(claudeMdFile);
  const prefix = shouldMerge ? `${withoutMarkerRegion(readFileSync(claudeMdFile, "utf8"))}\n` : "";
  const content = `${prefix}${CLAUDE_MD_MARKER_START}\n${blockBody}${CLAUDE_MD_MARKER_END}\n`;
  writeFileAtomically(path.dirname(claudeMdFile), claudeMdFile, content, ".oso-claude-md-");
}

export function stripClaudeMdRegion(claudeMdFile: string): boolean {
  if (!isReadableRegularFile(claudeMdFile)) return false;
  const content = readFileSync(claudeMdFile, "utf8");
  if (!content.includes(CLAUDE_MD_MARKER_START)) return false;
  const withoutBlock = withoutMarkerRegion(content);
  writeFileAtomically(path.dirname(claudeMdFile), claudeMdFile, withoutBlock === "" ? "" : `${withoutBlock}\n`, ".oso-claude-md-");
  return true;
}

export function withoutMarkerRegion(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const kept: string[] = [];
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

function claudeGlobalBody(repositoryRoot: string): string {
  return readFileSync(path.join(repositoryRoot, "bootstrap", "claude-global.md"), "utf8");
}

function claudeMdSizeNote(claudeMdFile: string): string {
  const size = statSync(claudeMdFile, { throwIfNoEntry: false })?.size ?? 0;
  return size > CLAUDE_MD_BUDGET_BYTES
    ? `CLAUDE.md is still ${size} bytes — review the non-oso content; every session pays for it`
    : `CLAUDE.md merged (${size} bytes)`;
}

function wireEngramPlugin(environment: NodeJS.ProcessEnv): WiringEntry {
  spawnSync("claude", ["plugin", "marketplace", "add", ENGRAM_SOURCE_REPO], { env: environment, encoding: "utf8" });
  const install = spawnSync("claude", ["plugin", "install", "engram@engram"], { env: environment, encoding: "utf8" });
  if (install.error === undefined && install.status === 0) return wiringOk("engram (plugin)", "installed");
  return wiringFail("engram (plugin)", `plugin install failed: ${collapsedOutput(install)} — fix: claude plugin install engram@engram`);
}

function resolveOrProvisionEngram(input: ClaudeCommandInput): WiringEntry {
  const binaryName = engramBinaryName(input.platform);
  const resolved = firstExecutableOnPath(input.environment, binaryName);
  if (resolved !== undefined) {
    return engramBinaryRuns(resolved, input.environment)
      ? wiringOk("engram (binary)", `already installed where Claude Code resolves it: ${resolved}`)
      : wiringFail(
          "engram (binary)",
          `${resolved} does not run — an antivirus may have quarantined it, which upstream documents happening to unsigned prebuilt releases — fix: remove it, then re-run this installer to provision the pinned release, or ${engramManualInstallCommand(input.platform)}`,
        );
  }
  const outcome = provisionEngramBinary({
    homeDirectory: input.homeDirectory,
    environment: input.environment,
    platform: input.platform,
    architecture: input.architecture,
    transport: input.engramTransport,
  });
  return engramProvisionWiringEntry(outcome, input.platform);
}

function engramProvisionWiringEntry(outcome: EngramProvisionOutcome, platform: NodeJS.Platform): WiringEntry {
  if (outcome.kind === "installed-on-path") {
    return wiringOk("engram (binary)", `installed ${SUPPORTED_ENGRAM_VERSION} at ${outcome.binary}`);
  }
  if (outcome.kind === "installed-off-path") {
    return wiringFail(
      "engram (binary)",
      `installed ${SUPPORTED_ENGRAM_VERSION} at ${outcome.binary}, which is not what a bare \`engram\` resolves to on the PATH Claude Code reads — the plugin spawns that bare name, so its MCP cannot start until ${outcome.installDirectory} is on that PATH ahead of any other engram — fix: add ${outcome.installDirectory} to your PATH (in ~/.profile, say), then restart Claude Code`,
    );
  }
  return wiringFail("engram (binary)", `${outcome.reason} — fix: ${engramManualInstallCommand(platform)}`);
}

function engramManualInstallCommand(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? `install engram yourself — go install github.com/${ENGRAM_SOURCE_REPO}/cmd/engram@v${SUPPORTED_ENGRAM_VERSION}, or unpack the release zip from https://github.com/${ENGRAM_SOURCE_REPO}/releases/tag/v${SUPPORTED_ENGRAM_VERSION} onto the PATH Claude Code reads`
    : `install engram yourself — brew install gentleman-programming/tap/engram, or go install github.com/${ENGRAM_SOURCE_REPO}/cmd/engram@v${SUPPORTED_ENGRAM_VERSION}`;
}

export function wireFallow(environment: NodeJS.ProcessEnv, homeDirectory: string, platform: NodeJS.Platform): WiringEntry {
  const fallowCommand = resolveFallowMcpCommand(environment, homeDirectory, platform) ?? "fallow-mcp";
  const fix = `npm install --global fallow@${SUPPORTED_FALLOW_VERSION}, then claude mcp add --scope user fallow -- ${fallowCommand}`;
  const npmProbe = spawnSync("npm", ["--version"], { env: environment, encoding: "utf8" });
  if (npmProbe.error !== undefined) {
    return wiringFail("fallow", `no npm to install the fallow package with — fix: install Node.js 22 or newer, then ${fix}`);
  }
  const install = spawnSync("npm", ["install", "--global", `fallow@${SUPPORTED_FALLOW_VERSION}`], { env: environment, encoding: "utf8" });
  if (install.error !== undefined || install.status !== 0) {
    return wiringFail(
      "fallow",
      `could not install fallow@${SUPPORTED_FALLOW_VERSION}: ${collapsedOutput(install)} — a fallow already wired here keeps working, at whatever version it is — fix: ${fix}`,
    );
  }
  return addOrConfirmFallowMcp(environment, fallowCommand);
}

function addOrConfirmFallowMcp(environment: NodeJS.ProcessEnv, fallowCommand: string): WiringEntry {
  const add = spawnSync("claude", ["mcp", "add", "--scope", "user", "fallow", "--", fallowCommand], { env: environment, encoding: "utf8" });
  if (add.error === undefined && add.status === 0) return wiringOk("fallow", `wired (user scope): ${fallowCommand}`);
  const wired = fallowWiredCommand(environment);
  if (wired === fallowCommand) return wiringOk("fallow", `already wired: ${fallowCommand}`);
  if (wired !== "") {
    return wiringFail(
      "fallow",
      `wired to ${wired}, not the ${fallowCommand} this host resolves — no re-run of this installer can repoint it — fix: claude mcp remove fallow -s user && claude mcp add --scope user fallow -- ${fallowCommand}`,
    );
  }
  return wiringFail("fallow", `mcp add failed: ${collapsedOutput(add)} — fix: claude mcp add --scope user fallow -- ${fallowCommand}`);
}

export function fallowWiredCommand(environment: NodeJS.ProcessEnv): string {
  const result = spawnSync("claude", ["mcp", "get", "fallow"], { env: environment, encoding: "utf8" });
  const text = result.error === undefined ? result.stdout : "";
  const match = /^[ \t]*Command:[ \t]*(.*?)[ \t]*$/m.exec(text);
  return match?.[1] ?? "";
}

export function resolveFallowMcpCommand(environment: NodeJS.ProcessEnv, homeDirectory: string, platform: NodeJS.Platform): string | undefined {
  if (platform === "win32") {
    const appdata = environment["APPDATA"];
    if (appdata !== undefined && appdata !== "") {
      const prefix = npmGlobalPrefix(environment) ?? path.join(appdata, "npm");
      const candidate = path.join(prefix, "fallow-mcp.cmd");
      if (isExecutableRegularFile(candidate)) return candidate;
    }
  }
  const onPath = firstExecutableOnPath(environment, "fallow-mcp");
  if (onPath !== undefined) return onPath;
  const cargoCandidates = [path.join(homeDirectory, ".cargo", "bin", "fallow-mcp"), path.join(homeDirectory, ".cargo", "bin", "fallow-mcp.exe")];
  return cargoCandidates.find((candidate) => isExecutableRegularFile(candidate));
}

function npmGlobalPrefix(environment: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const trimmed = result.stdout.trim();
  return trimmed === "" ? undefined : trimmed.replaceAll("\\", "/");
}

function installOsoPluginCore(environment: NodeJS.ProcessEnv, repositoryRoot: string): WiringEntry {
  registerOsoMarketplace(environment, repositoryRoot);
  const install = spawnSync("claude", ["plugin", "install", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
  if (install.error !== undefined || install.status !== 0) throw new ClaudePluginInstallError(collapsedOutput(install));
  return wiringOk("oso-code plugin", "installed");
}

function softPluginMaintenance(environment: NodeJS.ProcessEnv): void {
  spawnSync("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
  spawnSync("claude", ["plugin", "update", "oso-code@oso-code"], { env: environment, encoding: "utf8" });
}

function registerOsoMarketplace(environment: NodeJS.ProcessEnv, repositoryRoot: string): void {
  const registry = spawnSync("claude", ["plugin", "marketplace", "list", "--json"], { env: environment, encoding: "utf8" });
  const localPath = registry.error === undefined ? localMarketplacePath(registry.stdout) : "";
  if (localPath !== "" && !githubMarketplaceIsReachable(environment)) return;
  const added = spawnSync("claude", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE], { env: environment, encoding: "utf8" });
  if (added.error === undefined && added.status === 0) return;
  const failure = classifyMarketplaceAddFailure(added.stdout ?? "");
  if (failure === "unreachable") {
    spawnSync("claude", ["plugin", "marketplace", "add", repositoryRoot], { env: environment, encoding: "utf8" });
    return;
  }
  spawnSync("claude", ["plugin", "marketplace", "update", "oso-code"], { env: environment, encoding: "utf8" });
}

export function classifyMarketplaceAddFailure(output: string): string {
  if (output.includes("is seed-managed")) return "seed-managed";
  if (output.includes("blocked by enterprise policy") || output.includes("not in the allowed marketplace list")) return "policy-blocked";
  if (output.includes("Invalid marketplace source format")) return "invalid-source";
  if (output.includes("Failed to parse marketplace file") || output.includes("Marketplace file not found")) return "invalid-manifest";
  if (output.includes("Failed to clone marketplace repository")) return "unreachable";
  return "unknown";
}

export function localMarketplacePath(registryJson: string): string {
  try {
    const parsed: unknown = JSON.parse(registryJson);
    if (!Array.isArray(parsed)) return "";
    const match = parsed.find((entry) => isPlainRecord(entry) && entry["name"] === "oso-code" && entry["source"] === "directory");
    return isPlainRecord(match) && typeof match["path"] === "string" ? match["path"] : "";
  } catch {
    return "";
  }
}

function githubMarketplaceIsReachable(environment: NodeJS.ProcessEnv): boolean {
  const result = spawnSync("git", ["ls-remote", "--exit-code", `https://github.com/${MARKETPLACE_SOURCE}.git`, "HEAD"], {
    env: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
  return result.error === undefined && result.status === 0;
}

function migrateContext7(environment: NodeJS.ProcessEnv): WiringEntry[] {
  const listing = spawnSync("claude", ["mcp", "list"], { env: environment, encoding: "utf8" });
  const entry = pluginContext7Entry(listing.error === undefined ? listing.stdout : "");
  if (entry === "") {
    return [
      wiringFail(
        "context7",
        "the oso-code plugin's context7 server is not registered with the client, so a legacy user-scope entry, if any, was left standing rather than removed — fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer",
      ),
    ];
  }
  if (!entry.includes("Connected")) {
    return [
      wiringFail(
        "context7",
        `the oso-code plugin's context7 is registered but did not answer (${entry}) — fix: install Node.js (context7 starts through npx), restart Claude Code, then re-run this installer`,
      ),
    ];
  }
  spawnSync("claude", ["mcp", "remove", "--scope", "user", "context7"], { env: environment, encoding: "utf8" });
  return [wiringOk("context7", "ships with the oso-code plugin, registered and connected")];
}

function pluginContext7Entry(listing: string): string {
  return listing.split("\n").find((line) => line.includes("context7") && line.includes("plugin:")) ?? "";
}

function publishStateBinPath(claudeDir: string, settingsFile: string): WiringEntry {
  const installedPluginsFile = path.join(claudeDir, "plugins", "installed_plugins.json");
  const installRoot = installRootFromManifest(installedPluginsFile);
  const fix = "fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer";
  if (installRoot === undefined) {
    return wiringFail(
      "oso-state path",
      `the client records no installed oso-code plugin carrying a runnable bin/oso-state, so there is no absolute path to publish — ${fix}`,
    );
  }
  const stateBin = path.join(installRoot, "bin", "oso-state");
  if (!isExecutableRegularFile(stateBin)) {
    return wiringFail("oso-state path", `the resolved install path carries no runnable bin/oso-state at ${stateBin} — ${fix}`);
  }
  try {
    storeClientEnv(settingsFile, "OSO_STATE_BIN", stateBin);
    return wiringOk("oso-state path", `every session reads OSO_STATE_BIN=${stateBin}`);
  } catch (error) {
    return wiringFail(
      "oso-state path",
      `${errorMessageOf(error)} — fix: add "env": { "OSO_STATE_BIN": "${stateBin}" } to ${settingsFile} by hand, then restart Claude Code`,
    );
  }
}

function publishGitBashPath(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv, settingsFile: string): WiringEntry | undefined {
  if (platform !== "win32") return undefined;
  const stored = clientEnvValue(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH");
  if (isRegularNonSymlinkFile(stored)) return wiringOk("Git Bash path", `left as you set it: ${stored}`);
  const candidate = environment["CLAUDE_CODE_GIT_BASH_PATH"] ?? "";
  if (!isRegularNonSymlinkFile(candidate)) {
    if (stored === "") return undefined;
    return wiringFail(
      "Git Bash path",
      `settings.json points CLAUDE_CODE_GIT_BASH_PATH at ${stored}, which is not there any more, and this run was handed no Git Bash to repair it with — fix: re-run from PowerShell via bootstrap\\install.ps1, which finds Git Bash and hands it to this installer, or set the key yourself to the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe)`,
    );
  }
  const outcome = stored === "" ? "published" : `repaired from ${stored}`;
  try {
    storeClientEnv(settingsFile, "CLAUDE_CODE_GIT_BASH_PATH", candidate);
    return wiringOk("Git Bash path", `${outcome}: ${candidate}`);
  } catch (error) {
    return wiringFail(
      "Git Bash path",
      `${errorMessageOf(error)} — fix: add "env": { "CLAUDE_CODE_GIT_BASH_PATH": "${candidate}" } to ${settingsFile} by hand, then restart Claude Code`,
    );
  }
}

export function gitHooksOwner(repositoryRoot: string, environment: NodeJS.ProcessEnv, gitHooksDir: string): string {
  const configured = gitConfigValue(repositoryRoot, "core.hooksPath", environment);
  if (configured !== "" && normalizedPath(configured) !== normalizedPath(gitHooksDir)) return `core.hooksPath=${configured}`;
  const gitDir = gitAbsoluteGitDir(repositoryRoot, environment);
  if (gitDir === "") return "";
  const hooksDir = path.join(gitDir, "hooks");
  if (!isDirectory(hooksDir)) return "";
  const hookFile = readdirSync(hooksDir).find((name) => !name.endsWith(".sample") && isRegularNonSymlinkFile(path.join(hooksDir, name)));
  return hookFile === undefined ? "" : path.join(hooksDir, hookFile);
}

function gitAbsoluteGitDir(repositoryRoot: string, environment: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "--absolute-git-dir"], { env: environment, encoding: "utf8" });
  return result.error === undefined && result.status === 0 ? result.stdout.replace(/\n+$/, "") : "";
}

export function wireGitCommitHook(repositoryRoot: string, environment: NodeJS.ProcessEnv): WiringEntry {
  const gitHooksDir = path.join(repositoryRoot, "plugin", "git-hooks");
  const owner = gitHooksOwner(repositoryRoot, environment, gitHooksDir);
  if (owner !== "") {
    return wiringFail(
      "git commit hook",
      `not wired in ${repositoryRoot} — ${owner} already owns this repo's hooks and core.hooksPath would take it out of git's reach; the PreToolUse commit gate still applies here — fix: to run both, call ${path.join(gitHooksDir, "pre-commit")} from your own pre-commit`,
    );
  }
  const result = spawnSync("git", ["-C", repositoryRoot, "config", "core.hooksPath", gitHooksDir], { env: environment, encoding: "utf8" });
  if (result.error === undefined && result.status === 0) {
    return wiringOk("git commit hook", `core.hooksPath wired in ${repositoryRoot} — for another repo: git -C <repo> config core.hooksPath ${gitHooksDir}`);
  }
  return wiringFail("git commit hook", `git config failed: ${collapsedOutput(result)} — fix: git -C ${repositoryRoot} config core.hooksPath ${gitHooksDir}`);
}

function wireImpeccable(environment: NodeJS.ProcessEnv, homeDirectory: string): WiringEntry {
  rmSync(impeccableOptOutMarker(homeDirectory), { force: true });
  spawnSync("claude", ["plugin", "marketplace", "add", "pbakaus/impeccable"], { env: environment, encoding: "utf8" });
  const install = spawnSync("claude", ["plugin", "install", "impeccable@impeccable"], { env: environment, encoding: "utf8" });
  if (install.error !== undefined || install.status !== 0) {
    return wiringFail("impeccable (plugin)", `install failed: ${collapsedOutput(install)} — fix: claude plugin install impeccable@impeccable`);
  }
  const listing = spawnSync("claude", ["plugin", "list"], { env: environment, encoding: "utf8" });
  const installed = listing.error === undefined && listing.stdout.includes("impeccable");
  return installed
    ? wiringOk("impeccable (plugin)", "installed")
    : wiringFail("impeccable (plugin)", "the install reported success but the client lists no impeccable plugin — fix: claude plugin install impeccable@impeccable, then restart Claude Code");
}

function skipImpeccable(homeDirectory: string): void {
  const marker = impeccableOptOutMarker(homeDirectory);
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}\n`);
}

type WiringEntry = Readonly<{ ok: boolean; component: string; note: string }>;

function wiringOk(component: string, note: string): WiringEntry {
  return { ok: true, component, note };
}

function wiringFail(component: string, note: string): WiringEntry {
  return { ok: false, component, note };
}

function toWiringEntry(component: string, outcome: SettingsWriteOutcome): WiringEntry {
  return outcome.kind === "failed" ? wiringFail(component, outcome.note) : wiringOk(component, outcome.note);
}

function collapsedOutput(result: { stdout?: string; stderr?: string }): string {
  return collapsedNewlines(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function renderCommandReport(verb: string, infoLines: readonly string[], wiring: readonly WiringEntry[]): string {
  const summaryLines = wiring.map((entry) => `  ${entry.component}: ${entry.ok ? "OK" : "FAILED"} — ${entry.note}`);
  const failedCount = wiring.filter((entry) => !entry.ok).length;
  const lines = [`oso ${verb} --host claude`, ...infoLines, "wiring summary:", ...summaryLines, "----", `wired: ${wiring.length - failedCount}, failed: ${failedCount}`];
  return lines.map((line) => `${line}\n`).join("");
}

function requiresYesOutcome(verb: string): ClaudeOutcome {
  return { report: `oso ${verb} --host claude requires --yes in this slice — no interactive confirmation prompt is wired yet\n`, exitCode: 1 };
}

function fatalOutcome(verb: string, summary: string, error: unknown, restore?: RestoreOutcome): ClaudeOutcome {
  const restoreNote =
    restore === undefined
      ? ""
      : restore.failedCount === 0
        ? " — rolled back to the pre-run snapshot"
        : ` — rollback incomplete: ${restore.failedItems.join(", ")} still need restoring by hand`;
  return { report: `oso ${verb} --host claude: ${summary}: ${errorMessageOf(error)}${restoreNote}\n`, exitCode: 1 };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
