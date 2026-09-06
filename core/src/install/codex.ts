import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import {
  CODEX_HOOKS_MANIFEST,
  CODEX_IMPECCABLE_REFERENCES,
  CODEX_MARKETPLACE_NAME,
  CODEX_MARKETPLACE_PAYLOAD_ROWS,
  CODEX_PLUGIN_ID,
  codexPayloadRefusal,
  codexAgentInventory,
  codexPayloadSources,
  codexRuntimeRows,
  codexRuntimeTargetOf,
  frontmatterField,
  isRecord,
  type CodexPayloadSources,
} from "./codex-payload.ts";
import { pinnedVersionRefusal, type CodexHostProbes, type HostRun } from "./codex-host.ts";
import { ENGRAM_SOURCE_REPO } from "./engram.ts";
import { meetsVersionFloor, SUPPORTED_CODEX_VERSION, SUPPORTED_IMPECCABLE_VERSION } from "./pins.ts";
import {
  fatalOutcome,
  messageOf,
  renderCommandReport,
  requiresYesOutcome,
  restoreNoteOf,
  wiringFail,
  wiringOk,
  type CommandOutcome,
  type WiringEntry,
} from "./report.ts";
import { readJsonObject } from "./json.ts";
import { parseTomlDocument, TomlParseError } from "./toml.ts";
import { mergeEngramLeaves, runTomlRegion, type TomlRegionOutput } from "./toml-regions.ts";
import { trustDivergences } from "./trust.ts";
import { firstExecutableOnPath } from "./verify-claude.ts";
import { filesHoldTheSameBytes, isDirectoryNotSymlink, isExecutableRegularFile, isReadableRegularFile, isRegularNonSymlinkFile, isSymlink, isoTimestamp, withOwnerOnlyUmask } from "../state/store.ts";

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
  agentsTarget: string;
  hooksManifest: string;
  marketplaceRoot: string;
  impeccableMount: string;
  impeccableOptOut: string;
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
    agentsTarget: path.join(codexHome, "agents"),
    hooksManifest: path.join(codexHome, "hooks.json"),
    marketplaceRoot: path.join(homeDirectory, ".local", "share", "oso-code", "codex-marketplace"),
    impeccableMount: path.join(homeDirectory, ".agents", "skills", "impeccable"),
    impeccableOptOut: path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out"),
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
  return withOwnerOnlyUmask(() => writeCodexInstall(input));
}

function writeCodexInstall(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("install", "codex");
  const unpinned = pinnedVersionOutcome("install", input.host);
  if (unpinned !== undefined) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const sources = codexPayloadSources(input.repositoryRoot);

  const refusal = configRefusalOf(paths.configFile);
  if (refusal !== undefined) return fatalOutcome("install", "codex", "the Codex config refuses this install", refusalMessage(refusal));
  if (existsAtAll(paths.globalFile) && !isRegularNonSymlinkFile(paths.globalFile)) {
    return fatalOutcome("install", "codex", "global AGENTS.md is not a regular file", paths.globalFile);
  }
  const pointerRefusal = engramPointerRefusal(paths);
  if (pointerRefusal !== undefined) return fatalOutcome("install", "codex", "the existing Engram pointers refuse this install", pointerRefusal);
  const payloadRefusal = codexPayloadRefusal(sources) ?? publishedTrustRefusal(input.repositoryRoot, sources);
  if (payloadRefusal !== undefined) return fatalOutcome("install", "codex", "the Codex install payload is incomplete", payloadRefusal);
  const targetRefusal = codexTargetRefusal(paths);
  if (targetRefusal !== undefined) return fatalOutcome("install", "codex", "an owned Codex target refuses this install", targetRefusal);
  const hooksRefusal = hooksManifestRefusal(paths, sources);
  if (hooksRefusal !== undefined) return fatalOutcome("install", "codex", "the existing Codex hooks manifest refuses this install", hooksRefusal);
  const staleEngramRefusal = staleEngramMarketplaceRefusal(input.host, paths, input.environment);
  if (staleEngramRefusal !== undefined) return fatalOutcome("install", "codex", "the existing Engram marketplace cache refuses this install", staleEngramRefusal);

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
  if (input.host.versionNote !== undefined) infoLines.push(input.host.versionNote);
  const wiring: WiringEntry[] = [];
  const fallow = resolveFallowCommandFor(input, paths);
  wiring.push(
    fallow.resolved
      ? wiringOk("fallow (mcp)", fallow.command)
      : wiringFail("fallow (mcp)", "fallow-mcp is not installed; debt-sweep will use its rubric-only fallback"),
  );

  try {
    stageMarketplace(paths, sources);
    stageRuntime(paths, sources, input.repositoryRoot);
    stageAgents(paths, sources);
    wiring.push(wiringOk("published marketplace", paths.marketplaceRoot));
    wiring.push(wiringOk("published runtime", paths.runtimeRoot));
    wiring.push(wiringOk("Codex agents", paths.agentsTarget));
  } catch (error) {
    return rolledBack("install", "could not stage the published Codex payload", error, tx, capturedHooksPath, input);
  }

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

  try {
    repairStaleEngramMarketplace(input.host, paths);
    wiring.push(wiringOk("engram", wireEngram(input, paths)));
  } catch (error) {
    return rolledBack("install", "could not wire Engram for Codex", error, tx, capturedHooksPath, input);
  }

  try {
    wiring.push(wiringOk("Codex plugin registration", wireOsoPlugin(input.host, paths)));
  } catch (error) {
    return rolledBack("install", "could not register the oso-code Codex plugin", error, tx, capturedHooksPath, input);
  }

  if ((input.installImpeccable ?? true) === true) {
    try {
      wiring.push(wiringOk("impeccable", wireImpeccable(input.host, paths)));
    } catch (error) {
      return rolledBack("install", "could not wire Impeccable for Codex", error, tx, capturedHooksPath, input);
    }
  } else {
    try {
      mkdirSync(path.dirname(paths.impeccableOptOut), { recursive: true });
      writeFileSync(paths.impeccableOptOut, `disabled at ${isoTimestamp()}\n`, { mode: 0o600 });
      wiring.push(wiringOk("impeccable", "skipped by --no-impeccable"));
    } catch (error) {
      return rolledBack("install", "could not record the Impeccable opt-out", error, tx, capturedHooksPath, input);
    }
    infoLines.push("skipping impeccable (--no-impeccable)");
  }

  if (input.installGitHook ?? true) {
    const wired = wireGitCommitHook(input.repositoryRoot, paths.runtimeRoot, input.environment);
    if (!wired.ok) return rolledBack("install", "could not wire the git commit gate", new Error(wired.note), tx, capturedHooksPath, input);
    wiring.push(wired);
  } else infoLines.push("skipping the git commit hook (--no-git-hook)");

  for (const backup of pruneInstallBackups(paths.backupsRoot, input.environment)) {
    infoLines.push(`backup retention: removed ${backup}`);
  }
  return { report: renderCommandReport("install", "codex", infoLines, wiring), exitCode: 0 };
}

export function repairCodex(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("repair", "codex");
  const unpinned = pinnedVersionOutcome("repair", input.host);
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
  if (input.host.versionNote !== undefined) infoLines.push(input.host.versionNote);
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
  return withOwnerOnlyUmask(() => writeCodexPurge(input));
}

function writeCodexPurge(input: CodexCommandInput): CommandOutcome {
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
  return isReadableRegularFile(configFile) ? inspectCodexConfig(readFileSync(configFile, "utf8"), configFile) : undefined;
}

function publishedTrustRefusal(repositoryRoot: string, sources: CodexPayloadSources): string | undefined {
  const divergent = trustDivergences(
    sources.hashes,
    (relative) => relative.startsWith("opencode/"),
    (relative) => path.join(repositoryRoot, ...relative.split("/")),
  );
  return divergent.length === 0 ? undefined : `published runtime trust bytes diverge: ${divergent.map((item) => `${item.file}:${item.state.kind}`).join(", ")}`;
}

function codexTargetRefusal(paths: CodexPaths): string | undefined {
  const symlink = backupCandidatesOf(paths).map(({ target }) => target).find((target) => isSymlink(target));
  return symlink === undefined ? undefined : `refusing to replace symlinked target ${symlink}`;
}

function hooksManifestRefusal(paths: CodexPaths, sources: CodexPayloadSources): string | undefined {
  if (!existsAtAll(paths.hooksManifest)) return undefined;
  if (!isRegularNonSymlinkFile(paths.hooksManifest)) return `hooks manifest is not a regular file: ${paths.hooksManifest}`;
  const existing = readFileSync(paths.hooksManifest, "utf8");
  const expected = renderHooksManifest(readFileSync(sources.hooksManifest, "utf8"), paths.runtimeRoot);
  if (existing === expected || ownedHooksManifest(existing, paths.runtimeRoot)) return undefined;
  return `refusing to replace foreign hooks manifest ${paths.hooksManifest}`;
}

function ownedHooksManifest(text: string, runtimeRoot: string): boolean {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch { return false; }
  if (!isRecord(document) || Object.keys(document).some((key) => key !== "hooks") || !isRecord(document["hooks"])) return false;
  const allowedEvents = new Set(["PreToolUse", "SubagentStop", "Stop", "UserPromptSubmit", "SessionStart", "SessionEnd"]);
  const allowedScripts = new Set(["commit", "edits", "unknown", "handoff", "planstop", "planprompt", "stale", "teardown", "proddeploy"]);
  const prefix = `node \"${path.posix.join(runtimeRoot, "dist")}\"/gate.js `;
  const validHandler = (handler: unknown): boolean => {
    if (!isRecord(handler) || Object.keys(handler).some((key) => key !== "type" && key !== "command") || handler["type"] !== "command" || typeof handler["command"] !== "string") return false;
    const markedPrefix = `OSO_AGENT=1 ${prefix}`;
    const candidate = handler["command"].startsWith(markedPrefix) ? handler["command"].slice(markedPrefix.length) : handler["command"].startsWith(prefix) ? handler["command"].slice(prefix.length) : "";
    const [script, ...argumentsList] = candidate.split(" ");
    return allowedScripts.has(script ?? "") && (script === "unknown" ? /^ --allow "[A-Za-z0-9_.:|/-]+"$/.test(candidate.slice("unknown".length)) : argumentsList.length === 0);
  };
  return Object.entries(document["hooks"] as Record<string, unknown>).every(([event, groups]) => {
    if (!allowedEvents.has(event) || !Array.isArray(groups) || groups.length === 0) return false;
    return groups.every((group) => {
      if (!isRecord(group) || !Array.isArray(group["hooks"]) || group["hooks"].length === 0) return false;
      return Object.keys(group).every((key) => key === "matcher" || key === "hooks") && (!Object.hasOwn(group, "matcher") || typeof group["matcher"] === "string") && group["hooks"].every(validHandler);
    });
  });
}

function stageMarketplace(paths: CodexPaths, sources: CodexPayloadSources): void {
  withStagedTree(path.dirname(paths.marketplaceRoot), ".codex-marketplace-", paths.marketplaceRoot, (stage) => {
    for (const row of CODEX_MARKETPLACE_PAYLOAD_ROWS) {
      const source = row.named === "marketplace.json" ? sources.marketplaceTemplate : sources.pluginManifest;
      const target = path.join(stage, row.installed);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target);
    }
    cpSync(sources.skills, path.join(stage, "codex", "skills"), { recursive: true, dereference: true });
    cpSync(sources.sharedSkills, path.join(stage, "codex", "skills", "_shared"), { recursive: true, dereference: true });
  });
}

function stageRuntime(paths: CodexPaths, sources: CodexPayloadSources, repositoryRoot: string): void {
  const parent = path.dirname(paths.runtimeRoot);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(path.join(parent, ".oso-runtime-"));
  try {
    const rows = codexRuntimeRows(readFileSync(sources.hashes, "utf8"));
    for (const row of rows) {
      if (row.file === CODEX_HOOKS_MANIFEST) continue;
      const target = codexRuntimeTargetOf(row.file, stage, paths.codexHome);
      if (target === undefined) throw new Error(`published runtime path is outside the Codex runtime set: ${row.file}`);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(repositoryRoot, ...row.file.split("/")), target);
      if (row.file.startsWith("plugin/hooks/") || row.file === "plugin/bin/oso-state" || row.file === "plugin/git-hooks/pre-commit") {
        chmodSync(target, 0o700);
      }
    }
    mkdirSync(paths.codexHome, { recursive: true });
    const manifestStage = path.join(paths.codexHome, `.oso-hooks-${process.pid}-${Date.now()}`);
    try {
      writeFileSync(manifestStage, renderHooksManifest(readFileSync(sources.hooksManifest, "utf8"), paths.runtimeRoot), { mode: 0o600 });
      replaceTree(stage, paths.runtimeRoot);
      rmSync(paths.hooksManifest, { force: true });
      renameSync(manifestStage, paths.hooksManifest);
    } finally {
      rmSync(manifestStage, { force: true });
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function stageAgents(paths: CodexPaths, sources: CodexPayloadSources): void {
  withStagedTree(paths.codexHome, ".oso-agents-", paths.agentsTarget, (stage) => {
    if (isDirectoryNotSymlink(paths.agentsTarget)) cpSync(paths.agentsTarget, stage, { recursive: true, dereference: false });
    for (const name of codexAgentInventory(sources).names) {
      const source = path.join(sources.agents, name);
      const target = path.join(stage, name);
      rmSync(target, { force: true, recursive: true });
      cpSync(source, target);
      chmodSync(target, 0o600);
    }
  });
}

function withStagedTree(parent: string, prefix: string, target: string, build: (stage: string) => void): void {
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(path.join(parent, prefix));
  try {
    build(stage);
    replaceTree(stage, target);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function replaceTree(stage: string, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(stage, target);
}

function renderHooksManifest(source: string, runtimeRoot: string): string {
  const renderedPath = JSON.stringify(path.posix.join(runtimeRoot, "dist"));
  if (renderedPath.length < 2) throw new Error("the Codex runtime hook path could not be rendered");
  return source.replaceAll("__OSO_HOOKS_DIR__", renderedPath.slice(1, -1));
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

function finalizeHostWrittenConfig(paths: CodexPaths, host: CodexHostProbes, operatorLeaves: Record<string, unknown> | undefined): void {
  if (!isReadableRegularFile(paths.configFile)) throw new Error(`Codex config is missing after a host writer: ${paths.configFile}`);
  const original = readFileSync(paths.configFile, "utf8");
  const normalizedFeatures = runTomlRegion(original, {
    action: "features-normalize",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END,
    featureText: renderCodexManagedFeatures(),
  });
  if (normalizedFeatures.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  let candidate = normalizedFeatures.stdout;
  if (operatorLeaves !== undefined) candidate = mergeEngramLeaves(candidate, operatorLeaves, paths.configFile);
  const pointers = normalizedEngramPointerConfig(paths, candidate);
  if (pointers.exitCode !== 0) throw new Error("Engram's instruction pointers are missing, duplicated, or unexpected");
  candidate = pointers.stdout;
  const refusal = inspectCodexConfig(candidate, paths.configFile);
  if (refusal !== undefined) throw new Error(refusalMessage(refusal));
  if (managedFeaturesStatus(candidate) !== "valid") throw new Error(refusalMessage({ kind: "malformed-features" }));
  if (!host.acceptsConfig(paths.codexHome, candidate)) throw new Error(HOST_REJECTED_CONFIG);
  if (candidate !== original) writeFileSync(paths.configFile, candidate, { mode: 0o600 });
}

function engramOperatorLeaves(configFile: string): Record<string, unknown> | undefined {
  const document = parseTomlDocument(readFileSync(configFile, "utf8"), configFile);
  const engram = isRecord(document["mcp_servers"]) ? document["mcp_servers"]["engram"] : undefined;
  if (!isRecord(engram)) return undefined;
  const leaves = Object.fromEntries(Object.entries(engram).filter(([key]) => key !== "command" && key !== "args"));
  return Object.keys(leaves).length === 0 ? undefined : leaves;
}

function staleEngramMarketplaceRefusal(host: CodexHostProbes, paths: CodexPaths, environment: NodeJS.ProcessEnv): string | undefined {
  const registered = engramMarketplaceIsRegistered(host);
  if (registered.error !== undefined) return registered.error;
  if (registered.value || !existsAtAll(engramMarketplaceCache(paths))) return undefined;
  return validateStaleEngramMarketplace(engramMarketplaceCache(paths), environment);
}

function repairStaleEngramMarketplace(host: CodexHostProbes, paths: CodexPaths): void {
  const cache = engramMarketplaceCache(paths);
  if (!existsAtAll(cache)) return;
  const registered = engramMarketplaceIsRegistered(host);
  if (registered.error !== undefined) throw new Error(registered.error);
  if (registered.value) return;
  const removal = host.marketplaceRemove("engram");
  if (!removal.ok) throw new Error(`could not remove the clean unregistered Engram marketplace cache: ${hostFailure(removal)}`);
  if (existsAtAll(cache)) throw new Error(`Codex did not remove the unregistered Engram marketplace cache: ${cache}`);
}

function engramMarketplaceCache(paths: CodexPaths): string { return path.join(paths.codexHome, ".tmp", "marketplaces", "engram"); }

function engramMarketplaceIsRegistered(host: CodexHostProbes): { value: boolean; error?: string } {
  const listing = host.marketplaceListing();
  if (!listing.ok) return { value: false, error: `could not inspect registered Codex marketplaces before Engram setup: ${hostFailure(listing)}` };
  try {
    const document = hostJson(listing, "Codex marketplace inventory");
    if (!Array.isArray(document["marketplaces"])) return { value: false, error: "Codex returned malformed marketplace inventory JSON: marketplaces is not an array" };
    return { value: document["marketplaces"].some((row) => isRecord(row) && row["name"] === "engram") };
  } catch (error) {
    return { value: false, error: `Codex returned malformed marketplace inventory JSON: ${messageOf(error)}` };
  }
}

function validateStaleEngramMarketplace(cache: string, environment: NodeJS.ProcessEnv): string | undefined {
  if (isSymlink(cache)) return `refusing to remove symlinked unregistered Engram marketplace cache: ${cache}`;
  if (!isDirectoryNotSymlink(cache)) return `unregistered Engram marketplace cache is not a directory: ${cache}`;
  const gitDirectory = path.join(cache, ".git");
  if (!isDirectoryNotSymlink(gitDirectory)) return `refusing to inspect an untrusted Engram marketplace cache without a real .git directory: ${cache}`;
  const gitConfig = path.join(gitDirectory, "config");
  if (!isReadableRegularFile(gitConfig)) return `refusing to inspect an Engram marketplace cache without a readable Git config: ${gitConfig}`;
  const gitText = (argv: readonly string[]) => {
    const result = safeCacheGit(cache, environment, argv);
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const root = gitText(["rev-parse", "--show-toplevel"]);
  if (root !== path.resolve(cache)) return `refusing to remove an unregistered Engram marketplace cache that is not an exact Git checkout: ${cache}`;
  if (gitText(["remote"]) !== "origin") return `refusing to remove an Engram marketplace cache with unexpected Git remotes: ${cache}`;
  if (gitText(["remote", "get-url", "--all", "origin"]) !== `https://github.com/${ENGRAM_SOURCE_REPO}.git`) return `refusing to remove an Engram marketplace cache from an unknown origin: ${cache}`;
  const head = gitText(["rev-parse", "HEAD"]);
  const headRef = gitText(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]);
  if (head === undefined || headRef === undefined || !/^refs\/remotes\/origin\/[A-Za-z0-9_.-]+$/.test(headRef)) {
    return `refusing to remove an Engram marketplace cache with local or unverified commits: ${cache}`;
  }
  if (gitText(["rev-parse", headRef]) !== head) return `refusing to remove an Engram marketplace cache with local or unverified commits: ${cache}`;
  const preflight = cachePristineRefusal(cache, environment);
  if (preflight !== undefined) return preflight;
  const status = safeCacheGit(cache, environment, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0 || status.stdout.trim() !== "") return `refusing to remove a modified unregistered Engram marketplace cache: ${cache}`;
  const marketplaceFile = path.join(cache, ".agents", "plugins", "marketplace.json");
  const pluginFile = path.join(cache, "plugin", "codex", ".codex-plugin", "plugin.json");
  if (!isReadableRegularFile(marketplaceFile) || !isReadableRegularFile(pluginFile)) return `unregistered Engram marketplace cache has no trusted manifests: ${cache}`;
  try {
    const marketplace = readJsonObject(marketplaceFile);
    const plugins = marketplace["plugins"];
    const plugin = Array.isArray(plugins) && plugins.length === 1 ? plugins[0] : undefined;
    const source = isRecord(plugin) ? plugin["source"] : undefined;
    if (marketplace["name"] !== "engram" || !isRecord(plugin) || plugin["name"] !== "engram" || !isRecord(source) || source["source"] !== "local" || source["path"] !== "./plugin/codex") {
      return `unregistered Engram marketplace cache has unexpected manifests: ${cache}`;
    }
    const pluginManifest = readJsonObject(pluginFile);
    if (pluginManifest["name"] !== "engram") return `unregistered Engram marketplace cache has an unexpected plugin manifest: ${pluginFile}`;
  } catch (error) {
    return `unregistered Engram marketplace cache has invalid manifests: ${messageOf(error)}`;
  }
  return undefined;
}

function cachePristineRefusal(cache: string, environment: NodeJS.ProcessEnv): string | undefined {
  const tree = safeCacheGit(cache, environment, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
  if (tree.status !== 0) return `refusing to inspect an unregistered Engram marketplace cache tree: ${cache}`;
  if (tree.stdout.split("\0").some((row) => row.startsWith("160000 commit "))) return `refusing to inspect an Engram marketplace cache containing a nested Git checkout: ${cache}`;
  const index = safeCacheGit(cache, environment, ["ls-files", "--stage", "-z"]);
  if (index.status !== 0 || index.stdout.split("\0").some((row) => row.startsWith("160000 "))) return `refusing to inspect an unregistered Engram marketplace cache containing a nested Git checkout: ${cache}`;
  const flags = safeCacheGit(cache, environment, ["ls-files", "-v", "-z"]);
  if (flags.status !== 0 || flags.stdout.split("\0").some((row) => row !== "" && row[0] !== "H")) return `refusing to remove an Engram marketplace cache with non-pristine index flags: ${cache}`;
  const extras = safeCacheGit(cache, environment, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  if (extras.status !== 0 || extras.stdout !== "") return `refusing to remove an Engram marketplace cache with untracked or ignored files: ${cache}`;
  return undefined;
}

function safeCacheGit(cache: string, environment: NodeJS.ProcessEnv, argv: readonly string[]): { status: number; stdout: string } {
  const safeEnvironment = cacheGitEnvironment(environment);
  const filterConfig = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "config", "--includes", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process)$"],
    { env: safeEnvironment, cwd: cache, encoding: "utf8" },
  );
  if (filterConfig.error !== undefined || (filterConfig.status !== 0 && filterConfig.status !== 1)) return { status: 1, stdout: "" };
  const drivers = (filterConfig.stdout ?? "").split("\n").filter((entry) => entry !== "").map((key) => /^filter\.(.+)\.(?:clean|process)$/.exec(key)?.[1]);
  if (drivers.some((driver) => driver === undefined)) return { status: 1, stdout: "" };
  const filterOptions = [...new Set(drivers as string[])].flatMap((driver) => [
    "-c", `filter.${driver}.clean=`, "-c", `filter.${driver}.process=`, "-c", `filter.${driver}.required=false`,
  ]);
  const run = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", ...filterOptions, "-c", "core.hooksPath=/dev/null", "-C", cache, ...argv],
    { env: safeEnvironment, encoding: "utf8" },
  );
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}

function cacheGitEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe = Object.fromEntries(Object.entries(environment).filter(([name]) => !name.startsWith("GIT_"))) as NodeJS.ProcessEnv;
  Object.assign(safe, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" });
  return safe;
}

function wireEngram(input: CodexCommandInput, paths: CodexPaths): string {
  const operatorLeaves = engramOperatorLeaves(paths.configFile);
  const setup = input.host.setupEngram(paths.homeDirectory, paths.codexHome);
  if (!setup.ok) throw new Error(`engram setup codex failed: ${hostFailure(setup)}`);
  if ((setup.stderr ?? "").match(/codex plugin add failed|plugin .* not found/i) !== null) {
    throw new Error(`engram setup codex reported incomplete plugin registration: ${collapsedHostOutput(setup)}`);
  }
  finalizeHostWrittenConfig(paths, input.host, operatorLeaves);
  const missingDocument = ["engram-instructions.md", "engram-compact-prompt.md"].map((name) => path.join(paths.codexHome, name)).find((file) => !isReadableRegularFile(file));
  if (missingDocument !== undefined) throw new Error(`Engram did not publish ${missingDocument}`);
  const document = parseTomlDocument(readFileSync(paths.configFile, "utf8"), paths.configFile);
  const engram = isRecord(document["mcp_servers"]) ? document["mcp_servers"]["engram"] : undefined;
  const args = isRecord(engram) ? engram["args"] : undefined;
  const engramMarketplace = isRecord(document["marketplaces"]) ? document["marketplaces"]["engram"] : undefined;
  const engramPlugin = isRecord(document["plugins"]) ? document["plugins"]["engram@engram"] : undefined;
  const failed = [
    [isRecord(engram) && typeof engram["command"] === "string", "Engram setup did not register [mcp_servers.engram]"],
    [Array.isArray(args) && args.some((value) => value === "mcp") && args.some((value) => value === "--tools=agent"), "Engram setup registered an unexpected MCP command"],
    [isRecord(engramMarketplace) && engramMarketplace["source_type"] === "git" && engramMarketplace["source"] === `https://github.com/${ENGRAM_SOURCE_REPO}.git` && engramMarketplace["ref"] === "main", "Engram setup did not register the official engram marketplace"],
    [isRecord(engramPlugin) && engramPlugin["enabled"] === true, "Engram setup did not register the engram@engram plugin"],
  ].find(([valid]) => !valid);
  if (failed !== undefined) throw new Error(String(failed[1]));
  return appendHostWarning("wired through engram setup codex", setup);
}

function wireOsoPlugin(host: CodexHostProbes, paths: CodexPaths): string {
  const registration = registerCodexPlugin(host, paths.marketplaceRoot, undefined, CODEX_PLUGIN_ID, CODEX_MARKETPLACE_NAME, paths.marketplaceRoot);
  finalizeHostWrittenConfig(paths, host, undefined);
  return appendHostWarning(`registered ${CODEX_PLUGIN_ID}`, registration.marketplace, registration.plugin);
}

function wireImpeccable(host: CodexHostProbes, paths: CodexPaths): string {
  const registration = registerCodexPlugin(host, "pbakaus/impeccable", `skill-v${SUPPORTED_IMPECCABLE_VERSION}`, "impeccable@impeccable", "impeccable");
  const installedRoot = registration.installedRoot;
  const publishedSkill = path.join(installedRoot, ".agents", "skills", "impeccable");
  const skillFile = path.join(publishedSkill, "SKILL.md");
  if (!isDirectoryNotSymlink(publishedSkill) || !isReadableRegularFile(skillFile)) throw new Error(`Impeccable skill is missing: ${skillFile}`);
  const skillText = readFileSync(skillFile, "utf8");
  if (frontmatterField(skillText, "name") !== "impeccable" || frontmatterField(skillText, "version") !== SUPPORTED_IMPECCABLE_VERSION) {
    throw new Error(`Impeccable skill is not pinned to ${SUPPORTED_IMPECCABLE_VERSION}`);
  }
  if (!skillText.includes(".agents/skills/impeccable") || !skillText.includes("$impeccable")) throw new Error("Impeccable skill is not the published Codex build");
  const referenceDirectory = path.join(publishedSkill, "reference");
  if (!isDirectoryNotSymlink(referenceDirectory)) throw new Error(`Impeccable references are missing: ${referenceDirectory}`);
  const missingReference = CODEX_IMPECCABLE_REFERENCES.map((reference) => path.join(referenceDirectory, reference)).find((target) => !isReadableRegularFile(target));
  if (missingReference !== undefined) throw new Error(`Impeccable reference is missing: ${missingReference}`);
  if (containsSymlink(publishedSkill)) throw new Error(`Impeccable published skill contains a symbolic link: ${publishedSkill}`);
  withStagedTree(path.dirname(paths.impeccableMount), ".impeccable-", paths.impeccableMount, (stage) => {
    copyDirectoryContents(publishedSkill, stage);
  });
  rmSync(paths.impeccableOptOut, { force: true });
  finalizeHostWrittenConfig(paths, host, undefined);
  return appendHostWarning(`mounted ${paths.impeccableMount} from ${installedRoot}`, registration.marketplace, registration.plugin);
}

function registerCodexPlugin(host: CodexHostProbes, source: string, ref: string | undefined, pluginId: string, marketplaceName: string, expectedRoot?: string) {
  const marketplace = host.marketplaceAdd(source, ref);
  if (!marketplace.ok) throw new Error(`${marketplaceName} marketplace registration failed: ${hostFailure(marketplace)}`);
  const document = hostJson(marketplace, `${marketplaceName} marketplace registration`);
  const installedRoot = document["installedRoot"];
  if (document["marketplaceName"] !== marketplaceName || typeof installedRoot !== "string" || installedRoot === "" || (expectedRoot !== undefined && installedRoot !== expectedRoot)) {
    throw new Error(`${marketplaceName} marketplace registration returned an unexpected root`);
  }
  const plugin = host.pluginAdd(pluginId);
  if (!plugin.ok) throw new Error(`${marketplaceName} plugin registration failed: ${hostFailure(plugin)}`);
  if (hostJson(plugin, `${marketplaceName} plugin registration`)["pluginId"] !== pluginId) throw new Error(`${marketplaceName} registration returned an unexpected plugin id`);
  return { marketplace, plugin, installedRoot };
}

function copyDirectoryContents(source: string, target: string): void {
  for (const entry of readdirSync(source)) {
    cpSync(path.join(source, entry), path.join(target, entry), { recursive: true, dereference: true });
  }
}

function hostJson(run: HostRun, action: string): Record<string, unknown> {
  const text = run.stdout ?? run.output;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) return parsed;
  } catch {}
  throw new Error(`${action} returned invalid JSON: ${collapsedHostOutput(run)}`);
}

function hostFailure(run: HostRun): string { return collapsedHostOutput(run) || "no output"; }

function collapsedHostOutput(run: HostRun): string {
  const fallback = run.stdout === undefined && run.stderr === undefined ? run.output : "";
  return `${run.stdout ?? ""}${run.stderr ?? ""}${fallback}`.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

function appendHostWarning(note: string, ...runs: readonly HostRun[]): string {
  const warnings = runs
    .map((run) => run.stderr?.trim() ?? "")
    .filter((warning) => warning !== "")
    .map((warning) => warning.replace(/\s+/g, " "));
  return warnings.length === 0 ? note : `${note}; host warning: ${warnings.join(" | ")}`;
}

function containsSymlink(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isSymbolicLink() || entry.isDirectory() && containsSymlink(path.join(directory, entry.name)));
}

export function normalizedEngramPointerConfig(paths: CodexPaths, text: string): TomlRegionOutput {
  return runTomlRegion(text, {
    action: "engram-pointers",
    startMarker: CONFIG_MARKER_START,
    endMarker: CONFIG_MARKER_END,
    modelKey: MODEL_INSTRUCTIONS_KEY,
    compactKey: COMPACT_PROMPT_KEY,
    modelValue: path.join(paths.codexHome, "engram-instructions.md"),
    compactValue: path.join(paths.codexHome, "engram-compact-prompt.md"),
    requireRegion: true,
  });
}

function engramPointerRefusal(paths: CodexPaths): string | undefined {
  if (!isReadableRegularFile(paths.configFile)) return undefined;
  const text = readFileSync(paths.configFile, "utf8");
  const root = runTomlRegion(text, { action: "split" }).root;
  const document = parseTomlDocument(root, paths.configFile);
  for (const [key, expected] of [
    [MODEL_INSTRUCTIONS_KEY, path.join(paths.codexHome, "engram-instructions.md")],
    [COMPACT_PROMPT_KEY, path.join(paths.codexHome, "engram-compact-prompt.md")],
  ] as const) {
    if (Object.hasOwn(document, key) && document[key] !== expected) return `root ${key} points to an unrelated value; refusing to replace ${paths.configFile}`;
  }
  return undefined;
}

function normalizeEngramPointers(paths: CodexPaths): WiringEntry {
  if (!isReadableRegularFile(paths.configFile)) return wiringFail("engram pointers", `no config at ${paths.configFile}`);
  const text = readFileSync(paths.configFile, "utf8");
  const moved = normalizedEngramPointerConfig(paths, text);
  if (moved.exitCode === 10) return wiringFail("engram pointers", "the Codex config markers are missing or malformed");
  if (moved.exitCode !== 0) return wiringFail("engram pointers", "Engram's instruction pointers are missing, duplicated, or unexpected");
  if (moved.stdout === text) return wiringOk("engram pointers", "already normalized");
  writeFileSync(paths.configFile, moved.stdout, { mode: 0o600 });
  return wiringOk("engram pointers", "moved above the managed region");
}

function wireGitCommitHook(repositoryRoot: string, runtimeRoot: string, environment: NodeJS.ProcessEnv): WiringEntry {
  const hooksPath = path.join(runtimeRoot, "git-hooks");
  const owner = codexGitHooksOwner(repositoryRoot, environment, hooksPath);
  if (owner.kind === "foreign") return wiringFail("git commit hook", `${owner.detail} already owns this checkout's hooks; refusing to replace it`);
  if (owner.kind === "legacy") {
    const legacyHook = path.join(owner.path, "pre-commit");
    const runtimeHook = path.join(hooksPath, "pre-commit");
    if (!isExecutableRegularFile(runtimeHook) || !filesHoldTheSameBytes(legacyHook, runtimeHook)) {
      return wiringFail("git commit hook", `the staged git hook differs from the published checkout hook: ${legacyHook}`);
    }
  }
  const run = spawnSync("git", ["-C", repositoryRoot, "config", "--local", "core.hooksPath", hooksPath], { env: environment, encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return wiringFail("git commit hook", `${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  return wiringOk("git commit hook", owner.kind === "legacy" ? `migrated to core.hooksPath=${hooksPath}` : `core.hooksPath=${hooksPath}`);
}

type GitHooksOwner = Readonly<{ kind: "none" | "legacy" | "foreign"; detail: string; path: string }>;

function codexGitHooksOwner(repositoryRoot: string, environment: NodeJS.ProcessEnv, gitHooksDir: string): GitHooksOwner {
  const configured = gitRun(repositoryRoot, environment, ["config", "--get", "core.hooksPath"]);
  if (configured.status === 0) {
    const configuredPath = path.resolve(repositoryRoot, configured.stdout.trim());
    if (configuredPath === path.resolve(gitHooksDir)) return { kind: "none", detail: "", path: "" };
    const local = gitRun(repositoryRoot, environment, ["config", "--local", "--get-all", "core.hooksPath"]);
    const legacyPath = path.resolve(repositoryRoot, "plugin", "git-hooks");
    if (path.isAbsolute(configured.stdout.trim()) && local.status === 0 && local.stdout.trim() === configured.stdout.trim() && configuredPath === legacyPath && legacyOsoGitHooksPath(legacyPath)) {
      return { kind: "legacy", detail: legacyPath, path: legacyPath };
    }
    return { kind: "foreign", detail: `core.hooksPath=${configured.stdout.trim()}`, path: "" };
  }
  const gitDirectory = gitRun(repositoryRoot, environment, ["rev-parse", "--absolute-git-dir"]);
  if (gitDirectory.status !== 0) return { kind: "none", detail: "", path: "" };
  const hooksDirectory = path.join(gitDirectory.stdout.trim(), "hooks");
  if (!isDirectoryNotSymlink(hooksDirectory)) return { kind: "none", detail: "", path: "" };
  const owner = readdirSync(hooksDirectory).find((name) => {
    const target = path.join(hooksDirectory, name);
    return !name.endsWith(".sample") && (isSymlink(target) || isRegularNonSymlinkFile(target));
  });
  return owner === undefined ? { kind: "none", detail: "", path: "" } : { kind: "foreign", detail: path.join(hooksDirectory, owner), path: "" };
}

function legacyOsoGitHooksPath(legacyPath: string): boolean {
  if (!isDirectoryNotSymlink(legacyPath) || !isExecutableRegularFile(path.join(legacyPath, "pre-commit"))) return false;
  return readdirSync(legacyPath).every((name) => name === "pre-commit");
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
    { label: "hooks-manifest", target: paths.hooksManifest },
    { label: "agents", target: paths.agentsTarget },
    { label: "runtime", target: paths.runtimeRoot },
    { label: "marketplace", target: paths.marketplaceRoot },
    { label: "plugins", target: path.join(paths.codexHome, "plugins") },
    { label: "engram-marketplace", target: path.join(paths.codexHome, ".tmp", "marketplaces", "engram") },
    { label: "engram-instructions", target: path.join(paths.codexHome, "engram-instructions.md") },
    { label: "engram-compact", target: path.join(paths.codexHome, "engram-compact-prompt.md") },
    { label: "impeccable", target: paths.impeccableMount },
    { label: "impeccable-opt-out", target: paths.impeccableOptOut },
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

function pinnedVersionOutcome(verb: string, host: CodexHostProbes): CommandOutcome | undefined {
  if (meetsVersionFloor(host.version, SUPPORTED_CODEX_VERSION)) return undefined;
  return fatalOutcome(verb, "codex", "the installed Codex CLI is not the pinned one", pinnedVersionRefusal(host));
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
