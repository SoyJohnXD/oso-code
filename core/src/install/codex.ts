import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupTarget,
  beginTransaction,
  commitManifest,
  existsAtAll,
  pruneInstallBackups,
  rollback,
  type BackupTransaction,
  type RestoreOutcome,
} from "./backup.ts";
import {
  COMPACT_PROMPT_KEY,
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  FEATURE_MARKER_END,
  FEATURE_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  MODEL_INSTRUCTIONS_KEY,
  renderCodexManagedConfig,
  renderCodexManagedFeatures,
  resolveFallowMcpCommand,
} from "./codex-config.ts";
import { pinnedVersionRefusal, type CodexHostProbes } from "./codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "./pins.ts";
import {
  fatalOutcome,
  renderCommandReport,
  requiresYesOutcome,
  restoreNoteOf,
  wiringFail,
  wiringOk,
  type CommandOutcome,
  type WiringEntry,
} from "./report.ts";
import { parseTomlDocument, TomlParseError } from "./toml.ts";
import { runTomlRegion } from "./toml-regions.ts";
import { firstExecutableOnPath } from "./verify-claude.ts";
import { isReadableRegularFile, isRegularNonSymlinkFile } from "../state/store.ts";

const CODEX_INSTALL_BACKUP_FORMAT = "oso-code-codex-install-v1";
const CODEX_REPAIR_BACKUP_FORMAT = "oso-code-codex-repair-v1";
const CODEX_PURGE_BACKUP_FORMAT = "oso-code-codex-purge-v1";

export const OSO_OWNED_CONFIG_PATHS = [
  ["default_permissions"],
  ["agents"],
  ["shell_environment_policy", "set"],
  ["mcp_servers", "context7"],
  ["mcp_servers", "fallow"],
  ["permissions", "oso"],
] as const;

export type CodexCommandInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  host: CodexHostProbes;
  assumeYes: boolean;
  installImpeccable?: boolean;
  installGitHook?: boolean;
}>;

export type CodexPaths = Readonly<{
  homeDirectory: string;
  codexHome: string;
  configFile: string;
  globalFile: string;
  runtimeRoot: string;
  agentsHome: string;
  marketplaceRoot: string;
  backupsRoot: string;
}>;

export type ConfigRefusal =
  | { kind: "malformed-markers" }
  | { kind: "malformed-features" }
  | { kind: "divergent-features" }
  | { kind: "unparseable"; detail: string }
  | { kind: "owned-key-outside-the-region"; keyPath: string };

export type ManagedFeaturesStatus = "valid" | "missing" | "malformed" | "divergent";

export function codexPathsFor(homeDirectory: string, environment: NodeJS.ProcessEnv): CodexPaths {
  const codexHome = environment["CODEX_HOME"] ?? path.join(homeDirectory, ".codex");
  return {
    homeDirectory,
    codexHome,
    configFile: path.join(codexHome, "config.toml"),
    globalFile: path.join(codexHome, "AGENTS.md"),
    runtimeRoot: path.join(homeDirectory, ".local", "share", "oso-code", "runtime"),
    agentsHome: path.join(homeDirectory, ".agents"),
    marketplaceRoot: path.join(homeDirectory, ".local", "share", "oso-code", "codex-marketplace"),
    backupsRoot: path.join(homeDirectory, ".local", "state", "oso-code", "codex-backups"),
  };
}

export function managedFeaturesStatus(text: string): ManagedFeaturesStatus {
  const stripped = runTomlRegion(text, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END,
  });
  if (stripped.exitCode !== 0) return "malformed";
  const extracted = runTomlRegion(text, {
    action: "extract",
    startMarker: FEATURE_MARKER_START,
    endMarker: FEATURE_MARKER_END,
    requireRegion: true,
  });
  if (extracted.exitCode !== 0) return "missing";
  return extracted.stdout === renderCodexManagedFeatures() ? "valid" : "divergent";
}

export function ownedKeyPathsOutsideTheRegion(unmanagedText: string, file: string): string[] {
  const document = parseTomlDocument(unmanagedText, file);
  return OSO_OWNED_CONFIG_PATHS.filter((keyPath) => holdsKeyPath(document, keyPath)).map((keyPath) => keyPath.join("."));
}

export function inspectCodexConfig(text: string, file: string): ConfigRefusal | undefined {
  const clean = runTomlRegion(text, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (clean.exitCode !== 0) return { kind: "malformed-markers" };
  const features = managedFeaturesStatus(clean.stdout);
  if (features === "malformed") return { kind: "malformed-features" };
  if (features === "divergent") return { kind: "divergent-features" };
  const withoutFeatures = runTomlRegion(clean.stdout, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END,
  });
  if (withoutFeatures.exitCode !== 0) return { kind: "malformed-features" };
  try {
    parseTomlDocument(text, file);
    const owned = ownedKeyPathsOutsideTheRegion(withoutFeatures.stdout, file);
    const first = owned[0];
    if (first !== undefined) return { kind: "owned-key-outside-the-region", keyPath: first };
  } catch (error) {
    if (error instanceof TomlParseError) return { kind: "unparseable", detail: error.message };
    throw error;
  }
  return undefined;
}

export function refusalMessage(refusal: ConfigRefusal): string {
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

export function rebuildManagedConfig(existingText: string, targetHome: string, runtimeRoot: string, fallowCommand: string): string {
  const clean = runTomlRegion(existingText, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (clean.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-markers" }));
  const withoutFeatures = runTomlRegion(clean.stdout, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END,
  });
  if (withoutFeatures.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  const parts = runTomlRegion(withoutFeatures.stdout, { action: "split" });
  const featureBlock = `${FEATURE_MARKER_START}\n${renderCodexManagedFeatures()}${FEATURE_MARKER_END}\n`;
  const merged = runTomlRegion(parts.sections, { action: "features-merge", featureText: featureBlock });
  if (merged.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  return [
    withoutTrailingBlankLines(parts.root),
    parts.root === "" ? "" : "\n",
    `${CONFIG_MARKER_START}\n`,
    renderCodexManagedConfig(targetHome, runtimeRoot, fallowCommand),
    `${CONFIG_MARKER_END}\n`,
    merged.stdout === "" ? "" : "\n",
    merged.stdout,
  ].join("");
}

export function rebuildGlobalGuidance(existingText: string, body: string): string {
  const clean = stripLineRegion(existingText, GLOBAL_MARKER_START, GLOBAL_MARKER_END);
  if (clean === undefined) throw new Error("global AGENTS.md has malformed oso-code markers");
  return [
    withoutTrailingBlankLines(clean),
    clean === "" ? "" : "\n",
    `${GLOBAL_MARKER_START}\n`,
    body.endsWith("\n") || body === "" ? body : `${body}\n`,
    `${GLOBAL_MARKER_END}\n`,
  ].join("");
}

export function installCodex(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("install", "codex");
  const unpinned = pinnedVersionOutcome("install", input.host.version);
  if (unpinned !== undefined) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);

  const refusal = configRefusalOf(paths.configFile);
  if (refusal !== undefined) return fatalOutcome("install", "codex", "the Codex config refuses this install", refusalMessage(refusal));
  if (existsAtAll(paths.globalFile) && !isRegularNonSymlinkFile(paths.globalFile)) {
    return fatalOutcome("install", "codex", "global AGENTS.md is not a regular file", paths.globalFile);
  }

  let tx: BackupTransaction;
  let capturedHooksPath: GitHooksCapture = { captured: false, present: false, value: "" };
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_INSTALL_BACKUP_FORMAT);
    for (const { label, target } of backupCandidatesOf(paths)) backupTarget(tx, label, target);
    commitManifest(tx);
    capturedHooksPath = capturedGitHooksPath(input.repositoryRoot, input.environment);
  } catch (error) {
    return fatalOutcome("install", "codex", "could not create the pre-install backup", messageOf(error));
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  const wiring: WiringEntry[] = [];
  const fallow = resolveFallowCommandFor(input, paths);
  wiring.push(
    fallow.resolved
      ? wiringOk("fallow (mcp)", fallow.command)
      : wiringFail("fallow (mcp)", "fallow-mcp is not installed; debt-sweep will use its rubric-only fallback"),
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
    const wired = wireGitCommitHook(input.repositoryRoot, paths.runtimeRoot, input.environment);
    if (!wired.ok) return rolledBack("install", "could not wire the git commit gate", new Error(wired.note), tx, capturedHooksPath, input);
    wiring.push(wired);
  } else infoLines.push("skipping the git commit hook (--no-git-hook)");
  if ((input.installImpeccable ?? true) === false) infoLines.push("skipping impeccable (--no-impeccable)");

  for (const backup of pruneInstallBackups(paths.backupsRoot, input.environment)) {
    infoLines.push(`backup retention: removed ${backup}`);
  }
  return { report: renderCommandReport("install", "codex", infoLines, wiring), exitCode: 0 };
}

export function repairCodex(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("repair", "codex");
  const unpinned = pinnedVersionOutcome("repair", input.host.version);
  if (unpinned !== undefined) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_REPAIR_BACKUP_FORMAT);
    backupTarget(tx, "config", paths.configFile);
    backupTarget(tx, "global", paths.globalFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("repair", "codex", "could not create the pre-repair backup", messageOf(error));
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  const wiring: WiringEntry[] = [];
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

export function purgeCodex(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("purge", "codex");
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  if (paths.codexHome === path.parse(paths.codexHome).root || input.homeDirectory === path.parse(input.homeDirectory).root) {
    return fatalOutcome("purge", "codex", "refusing to purge a filesystem root", paths.codexHome);
  }

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_PURGE_BACKUP_FORMAT);
    backupTarget(tx, "codex-home", paths.codexHome);
    backupTarget(tx, "agents-home", paths.agentsHome);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "codex", "could not create the pre-purge backup", messageOf(error));
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`, "no login or installation command was run"];
  const wiring: WiringEntry[] = [];
  for (const [component, target] of [
    ["Codex home", paths.codexHome],
    ["agents home", paths.agentsHome],
  ] as const) {
    if (!existsAtAll(target)) {
      wiring.push(wiringOk(component, "already absent"));
      continue;
    }
    try {
      rmSync(target, { recursive: true, force: true });
      wiring.push(existsAtAll(target) ? wiringFail(component, `still present: ${target}`) : wiringOk(component, `removed ${target}`));
    } catch (error) {
      wiring.push(wiringFail(component, messageOf(error)));
    }
  }
  infoLines.push(`restore with: oso install --host codex --yes, or by hand from ${tx.backupRoot}`);
  return { report: renderCommandReport("purge", "codex", infoLines, wiring), exitCode: 0 };
}

function configRefusalOf(configFile: string): ConfigRefusal | undefined {
  if (existsAtAll(configFile) && !isRegularNonSymlinkFile(configFile)) return { kind: "unparseable", detail: `not a regular file: ${configFile}` };
  if (!isReadableRegularFile(configFile)) return undefined;
  return inspectCodexConfig(readFileSync(configFile, "utf8"), configFile);
}

function writeManagedConfig(paths: CodexPaths, fallowCommand: string, host: CodexHostProbes): void {
  const existing = isReadableRegularFile(paths.configFile) ? readFileSync(paths.configFile, "utf8") : "";
  const rebuilt = rebuildManagedConfig(existing, paths.homeDirectory, paths.runtimeRoot, fallowCommand);
  mkdirSync(paths.codexHome, { recursive: true });
  if (!host.acceptsConfig(paths.codexHome, rebuilt)) throw new Error(HOST_REJECTED_CONFIG);
  writeFileSync(paths.configFile, rebuilt, { mode: 0o600 });
}

function writeGlobalGuidance(paths: CodexPaths, repositoryRoot: string): void {
  const existing = isReadableRegularFile(paths.globalFile) ? readFileSync(paths.globalFile, "utf8") : "";
  const body = readFileSync(path.join(repositoryRoot, "bootstrap", "codex-global.md"), "utf8");
  mkdirSync(paths.codexHome, { recursive: true });
  writeFileSync(paths.globalFile, rebuildGlobalGuidance(existing, body), { mode: 0o600 });
}

function normalizeEngramPointers(paths: CodexPaths): WiringEntry {
  if (!isReadableRegularFile(paths.configFile)) return wiringFail("engram pointers", `no config at ${paths.configFile}`);
  const text = readFileSync(paths.configFile, "utf8");
  const moved = runTomlRegion(text, {
    action: "engram-pointers",
    startMarker: CONFIG_MARKER_START,
    endMarker: CONFIG_MARKER_END,
    modelKey: MODEL_INSTRUCTIONS_KEY,
    compactKey: COMPACT_PROMPT_KEY,
    modelValue: path.join(paths.codexHome, "engram-instructions.md"),
    compactValue: path.join(paths.codexHome, "engram-compact-prompt.md"),
    requireRegion: true,
  });
  if (moved.exitCode === 10) return wiringFail("engram pointers", "the Codex config markers are missing or malformed");
  if (moved.exitCode !== 0) return wiringFail("engram pointers", "Engram's instruction pointers are missing, duplicated, or unexpected");
  if (moved.stdout === text) return wiringOk("engram pointers", "already normalized");
  writeFileSync(paths.configFile, moved.stdout, { mode: 0o600 });
  return wiringOk("engram pointers", "moved above the managed region");
}

function wireGitCommitHook(repositoryRoot: string, runtimeRoot: string, environment: NodeJS.ProcessEnv): WiringEntry {
  const hooksPath = path.join(runtimeRoot, "git-hooks");
  const run = spawnSync("git", ["-C", repositoryRoot, "config", "--local", "core.hooksPath", hooksPath], { env: environment, encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return wiringFail("git commit hook", `${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  return wiringOk("git commit hook", `core.hooksPath=${hooksPath}`);
}

function resolveFallowCommandFor(input: CodexCommandInput, paths: CodexPaths) {
  return resolveFallowMcpCommand(
    paths.homeDirectory,
    input.environment,
    () => npmGlobalPrefix(input.environment),
    (name) => firstExecutableOnPath(input.environment, name),
  );
}

function npmGlobalPrefix(environment: NodeJS.ProcessEnv): string | undefined {
  const run = spawnSync("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return undefined;
  const value = run.stdout.trim();
  return value === "" ? undefined : value;
}

function backupCandidatesOf(paths: CodexPaths): readonly Readonly<{ label: string; target: string }>[] {
  return [
    { label: "config", target: paths.configFile },
    { label: "global", target: paths.globalFile },
    { label: "hooks-manifest", target: path.join(paths.codexHome, "hooks.json") },
    { label: "agents", target: path.join(paths.codexHome, "agents") },
    { label: "runtime", target: paths.runtimeRoot },
  ];
}

function rolledBack(
  verb: string,
  summary: string,
  error: unknown,
  tx: BackupTransaction,
  hooksPath: GitHooksCapture,
  input: CodexCommandInput,
): CommandOutcome {
  const restore = rollback(tx);
  const hooks = restoreGitHooksPath(hooksPath, input.repositoryRoot, input.environment);
  return fatalOutcome(verb, "codex", summary, messageOf(error), restoreNoteOf(bothRestored(restore, hooks)));
}

export const HOST_REJECTED_CONFIG = "Codex rejected the merged config; the original config is unchanged";

type GitHooksCapture = Readonly<{ captured: boolean; present: boolean; value: string }>;

const NO_HOOKS_CAPTURE: GitHooksCapture = { captured: false, present: false, value: "" };

const NOTHING_LEFT_TO_RESTORE: RestoreOutcome = { failedCount: 0, failedItems: [] };

const GIT_CONFIG_UNSET_MATCHED_NOTHING = 5;

function pinnedVersionOutcome(verb: string, found: string | undefined): CommandOutcome | undefined {
  if (found === SUPPORTED_CODEX_VERSION) return undefined;
  return fatalOutcome(verb, "codex", "the installed Codex CLI is not the pinned one", pinnedVersionRefusal(found));
}

function capturedGitHooksPath(repositoryRoot: string, environment: NodeJS.ProcessEnv): GitHooksCapture {
  const inRepository = gitRun(repositoryRoot, environment, ["rev-parse", "--git-dir"]);
  if (inRepository.status !== 0) return NO_HOOKS_CAPTURE;
  const configured = gitRun(repositoryRoot, environment, ["config", "--local", "--get", "core.hooksPath"]);
  return configured.status === 0
    ? { captured: true, present: true, value: configured.stdout.trim() }
    : { captured: true, present: false, value: "" };
}

function restoreGitHooksPath(capture: GitHooksCapture, repositoryRoot: string, environment: NodeJS.ProcessEnv): RestoreOutcome {
  if (!capture.captured) return NOTHING_LEFT_TO_RESTORE;
  const argv = capture.present
    ? ["config", "--local", "core.hooksPath", capture.value]
    : ["config", "--local", "--unset-all", "core.hooksPath"];
  const { status } = gitRun(repositoryRoot, environment, argv);
  const restored = status === 0 || (!capture.present && status === GIT_CONFIG_UNSET_MATCHED_NOTHING);
  return restored ? NOTHING_LEFT_TO_RESTORE : { failedCount: 1, failedItems: [`core.hooksPath in ${repositoryRoot}`] };
}

function bothRestored(transaction: RestoreOutcome, hooks: RestoreOutcome): RestoreOutcome {
  return {
    failedCount: transaction.failedCount + hooks.failedCount,
    failedItems: [...transaction.failedItems, ...hooks.failedItems],
  };
}

function gitRun(repositoryRoot: string, environment: NodeJS.ProcessEnv, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", repositoryRoot, ...argv], { env: environment, encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}

function stripLineRegion(text: string, start: string, end: string): string | undefined {
  const kept: string[] = [];
  let inside = false;
  let seenStart = 0;
  let seenEnd = 0;
  for (const line of text === "" ? [] : text.replace(/\n$/, "").split("\n")) {
    if (line === start) {
      if (inside) return undefined;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (line === end) {
      if (!inside) return undefined;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (!inside) kept.push(line);
  }
  if (inside || seenStart !== seenEnd || seenStart > 1) return undefined;
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

const FIELDLESS_LINE = /^[ \t]*$/;

function withoutTrailingBlankLines(text: string): string {
  if (text === "") return "";
  const lines = text.replace(/\n$/, "").split("\n");
  let last = lines.length;
  while (last > 0 && FIELDLESS_LINE.test(lines[last - 1] ?? "")) last -= 1;
  return last === 0 ? "" : `${lines.slice(0, last).join("\n")}\n`;
}

function holdsKeyPath(document: Record<string, unknown>, keyPath: readonly string[]): boolean {
  let cursor: unknown = document;
  for (const key of keyPath) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
    if (!Object.hasOwn(cursor as Record<string, unknown>, key)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
