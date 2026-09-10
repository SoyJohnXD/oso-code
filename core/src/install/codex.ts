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
  renderOsoPermissionProfile,
  resolveFallowMcpCommand,
  workspaceRootsTheOsoProfileDeclares,
  type OsoPermissionProfile,
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
import { parseTomlDocument, TomlParseError } from "./toml.ts";
import { mergeEngramLeaves, recordsOf, runTomlRegion, type TomlRegionOutput } from "./toml-regions.ts";
import { trustDivergences } from "./trust.ts";
import { firstExecutableOnPath } from "./verify-claude.ts";
import { filesHoldTheSameBytes, isDirectoryNotSymlink, isExecutableRegularFile, isReadableRegularFile, isRegularNonSymlinkFile, isSymlink, isoTimestamp, withOwnerOnlyUmask } from "../state/store.ts";

const CODEX_INSTALL_BACKUP_FORMAT = "oso-code-codex-install-v1";
const CODEX_REPAIR_BACKUP_FORMAT = "oso-code-codex-repair-v1";
const CODEX_PURGE_BACKUP_FORMAT = "oso-code-codex-purge-v1";

export const OSO_OWNED_CONFIG_PATHS = [
  ["shell_environment_policy", "set"],
  ["mcp_servers", "context7"],
  ["mcp_servers", "fallow"],
] as const;

export type ManagedConfigRebuild = Readonly<{
  existingText: string;
  configFile: string;
  targetHome: string;
  runtimeRoot: string;
  fallowCommand: string;
}>;

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

export function operatorAgentsNotice(text: string, file: string): string | undefined {
  const outsideTheRegion = runTomlRegion(text, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (outsideTheRegion.exitCode !== 0) return undefined;
  const agents = parseTomlDocument(outsideTheRegion.stdout, file)["agents"];
  const settings = isRecord(agents) ? settingLinesOf("", agents) : [];
  return settings.length === 0 ? undefined : `Codex [agents] is the operator's own: ${settings.join(", ")}`;
}

export function operatorPermissionsNotice(text: string, file: string): string | undefined {
  const outsideTheRegion = runTomlRegion(text, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (outsideTheRegion.exitCode !== 0) return undefined;
  const settings = permissionSettingsOf(outsideTheRegion.stdout, file);
  return settings.length === 0 ? undefined : `Codex permissions are the operator's own: ${settings.join(", ")}`;
}

export function codexPermissionsNotice(text: string, file: string): string {
  const alreadyTheirs = operatorPermissionsNotice(text, file);
  if (alreadyTheirs !== undefined) return alreadyTheirs;
  const region = runTomlRegion(text, { action: "extract", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  const stillInside = region.exitCode === 0 ? permissionSettingsOf(region.stdout, file) : [];
  return stillInside.length === 0
    ? "Codex permissions are seeded once outside the managed region, and no later install rewrites that choice"
    : `Codex permissions move out of the managed region and stay the operator's own: ${stillInside.join(", ")}`;
}

function permissionSettingsOf(text: string, file: string): string[] {
  const document = parseTomlDocument(text, file);
  const chosen = document["default_permissions"];
  const profiles = document["permissions"];
  return [
    ...(chosen === undefined ? [] : [`default_permissions = ${JSON.stringify(chosen)}`]),
    ...(isRecord(profiles) ? Object.keys(profiles).map((name) => `[permissions.${name}]`) : []),
  ];
}

function settingLinesOf(prefix: string, table: Record<string, unknown>): string[] {
  return Object.entries(table).flatMap(([key, value]) => {
    const name = prefix === "" ? key : `${prefix}.${key}`;
    return isRecord(value) ? settingLinesOf(name, value) : `${name} = ${JSON.stringify(value)}`;
  });
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

export function rebuildManagedConfig(rebuild: ManagedConfigRebuild): string {
  const managed = renderCodexManagedConfig(rebuild.runtimeRoot, rebuild.fallowCommand);
  const outside = operatorTextOutsideTheRegion(rebuild.existingText);
  const parts = runTomlRegion(outside, { action: "split" });
  const lifted = liftedOutOfTheRegion(rebuild, managed);
  const seeded = seededWhereNothingDeclaresPermissions(rebuild.targetHome, [outside, lifted.root, lifted.sections]);
  const root = blocksJoined([parts.root, lifted.root, seeded.rootKeys]);
  const sections = withMergedFeatureRegion(blocksJoined([parts.sections, lifted.sections, seeded.tables]));
  return [
    root,
    root === "" ? "" : "\n",
    `${CONFIG_MARKER_START}\n`,
    managed,
    `${CONFIG_MARKER_END}\n`,
    sections === "" ? "" : "\n",
    sections,
  ].join("");
}

type OperatorTextSplit = Readonly<{ root: string; sections: string }>;

const NOTHING_SEEDED: OsoPermissionProfile = { rootKeys: "", tables: "" };

function operatorTextOutsideTheRegion(existingText: string): string {
  const clean = runTomlRegion(existingText, { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (clean.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-markers" }));
  const withoutFeatures = runTomlRegion(clean.stdout, {
    action: "features-strip",
    featureStartMarker: FEATURE_MARKER_START,
    featureEndMarker: FEATURE_MARKER_END,
  });
  if (withoutFeatures.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  return withoutFeatures.stdout;
}

function liftedOutOfTheRegion(rebuild: ManagedConfigRebuild, managed: string): OperatorTextSplit {
  const region = runTomlRegion(rebuild.existingText, { action: "extract", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END });
  if (region.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-markers" }));
  const operatorText = tableHeadersOf(managed).reduce((text, header) => {
    const removed = runTomlRegion(text, { action: "remove-table", targetHeader: header });
    if (removed.exitCode !== 0) throw new Error(`the managed region in ${rebuild.configFile} declares ${header} more than once`);
    return removed.stdout;
  }, region.stdout);
  const parts = runTomlRegion(operatorText, { action: "split" });
  return { root: parts.root, sections: parts.sections };
}

function seededWhereNothingDeclaresPermissions(targetHome: string, texts: readonly string[]): OsoPermissionProfile {
  return texts.some(declaresPermissions) ? NOTHING_SEEDED : renderOsoPermissionProfile(targetHome);
}

function declaresPermissions(text: string): boolean {
  return rootSymbolLinesOf(text)
    .flatMap(decodedSymbol)
    .some((symbol) => Object.hasOwn(symbol, "default_permissions") || Object.hasOwn(symbol, "permissions"));
}

function tableHeadersOf(text: string): string[] {
  return rootSymbolLinesOf(text).filter((line) => line.startsWith("["));
}

function rootSymbolLinesOf(text: string): string[] {
  return recordsOf(runTomlRegion(text, { action: "root-symbols" }).stdout);
}

function decodedSymbol(line: string): Record<string, unknown>[] {
  try {
    return [parseTomlDocument(line, line)];
  } catch (error) {
    if (error instanceof TomlParseError) return [];
    throw error;
  }
}

function withMergedFeatureRegion(sections: string): string {
  const featureBlock = `${FEATURE_MARKER_START}\n${renderCodexManagedFeatures()}${FEATURE_MARKER_END}\n`;
  const merged = runTomlRegion(sections, { action: "features-merge", featureText: featureBlock });
  if (merged.exitCode !== 0) throw new Error(refusalMessage({ kind: "malformed-features" }));
  return merged.stdout;
}

function blocksJoined(blocks: readonly string[]): string {
  return blocks.map(withoutTrailingBlankLines).filter((block) => block !== "").join("\n");
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

  const refusal = codexWriteRefusal("install", paths, input.repositoryRoot);
  if (refusal !== undefined) return refusal;

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
  const configBeforeTheInstall = isReadableRegularFile(paths.configFile) ? readFileSync(paths.configFile, "utf8") : "";
  const agentsNotice = operatorAgentsNotice(configBeforeTheInstall, paths.configFile);
  if (agentsNotice !== undefined) infoLines.push(agentsNotice);
  infoLines.push(codexPermissionsNotice(configBeforeTheInstall, paths.configFile));
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
    wiring.push(wiringOk("engram", "direct standard MCP; native base and compaction; automatic capture disabled"));
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
  return withOwnerOnlyUmask(() => writeCodexRepair(input));
}

function writeCodexRepair(input: CodexCommandInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("repair", "codex");
  const unpinned = pinnedVersionOutcome("repair", input.host);
  if (unpinned !== undefined) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const sources = codexPayloadSources(input.repositoryRoot);
  const refusal = codexWriteRefusal("repair", paths, input.repositoryRoot);
  if (refusal !== undefined) return refusal;

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_REPAIR_BACKUP_FORMAT);
    for (const { label, target } of payloadBackupCandidatesOf(paths)) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("repair", "codex", "could not create the pre-repair backup", messageOf(error));
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  if (input.host.versionNote !== undefined) infoLines.push(input.host.versionNote);
  const wiring: WiringEntry[] = [];

  const fallow = resolveFallowCommandFor(input, paths);
  try {
    stageMarketplace(paths, sources);
    stageRuntime(paths, sources, input.repositoryRoot);
    stageAgents(paths, sources);
    wiring.push(wiringOk("published marketplace", paths.marketplaceRoot));
    wiring.push(wiringOk("published runtime", paths.runtimeRoot));
    wiring.push(wiringOk("Codex agents", paths.agentsTarget));
  } catch (error) {
    return rolledBack("repair", "could not stage the published Codex payload", error, tx, NO_HOOKS_CAPTURE, input);
  }
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

  try {
    wiring.push(wiringOk("Codex plugin registration", wireOsoPlugin(input.host, paths)));
  } catch (error) {
    return rolledBack("repair", "could not register the oso-code Codex plugin", error, tx, NO_HOOKS_CAPTURE, input);
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

function codexWriteRefusal(verb: "install" | "repair", paths: CodexPaths, repositoryRoot: string): CommandOutcome | undefined {
  const sources = codexPayloadSources(repositoryRoot);
  const refusal = configRefusalOf(paths.configFile);
  if (refusal !== undefined) return fatalOutcome(verb, "codex", `the Codex config refuses this ${verb}`, refusalMessage(refusal));
  if (existsAtAll(paths.globalFile) && !isRegularNonSymlinkFile(paths.globalFile)) {
    return fatalOutcome(verb, "codex", "global AGENTS.md is not a regular file", paths.globalFile);
  }
  const pointerRefusal = engramPointerRefusal(paths);
  if (pointerRefusal !== undefined) return fatalOutcome(verb, "codex", `the existing Engram pointers refuse this ${verb}`, pointerRefusal);
  const payloadRefusal = codexPayloadRefusal(sources) ?? publishedTrustRefusal(repositoryRoot, sources);
  if (payloadRefusal !== undefined) return fatalOutcome(verb, "codex", `the Codex ${verb} payload is incomplete`, payloadRefusal);
  const targets = verb === "repair" ? payloadBackupCandidatesOf(paths) : backupCandidatesOf(paths);
  const symlink = targets.map(({ target }) => target).find((target) => isSymlink(target));
  if (symlink !== undefined) return fatalOutcome(verb, "codex", `an owned Codex target refuses this ${verb}`, `refusing to replace symlinked target ${symlink}`);
  const hooksRefusal = hooksManifestRefusal(paths, sources);
  return hooksRefusal === undefined ? undefined : fatalOutcome(verb, "codex", `the existing Codex hooks manifest refuses this ${verb}`, hooksRefusal);
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
  const rebuilt = rebuildManagedConfig({
    existingText: isReadableRegularFile(paths.configFile) ? readFileSync(paths.configFile, "utf8") : "",
    configFile: paths.configFile,
    targetHome: paths.homeDirectory,
    runtimeRoot: paths.runtimeRoot,
    fallowCommand,
  });
  mkdirSync(paths.codexHome, { recursive: true });
  if (!host.acceptsConfig(paths.codexHome, rebuilt)) throw new Error(HOST_REJECTED_CONFIG);
  writeFileSync(paths.configFile, rebuilt, { mode: 0o600 });
  for (const root of workspaceRootsTheOsoProfileDeclares(paths.homeDirectory)) mkdirSync(root, { recursive: true });
  finalizeHostWrittenConfig(paths, host, undefined);
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
  candidate = ensureEngramTable(candidate, paths.configFile, { header: "[mcp_servers.engram]", keyPath: ["mcp_servers", "engram"], leaves: { command: "engram", args: ["mcp", "--tools=agent"] } });
  candidate = ensureEngramTable(candidate, paths.configFile, { header: '[plugins."engram@engram"]', keyPath: ["plugins", "engram@engram"], leaves: { enabled: false } });
  const refusal = inspectCodexConfig(candidate, paths.configFile);
  if (refusal !== undefined) throw new Error(refusalMessage(refusal));
  if (managedFeaturesStatus(candidate) !== "valid") throw new Error(refusalMessage({ kind: "malformed-features" }));
  if (!host.acceptsConfig(paths.codexHome, candidate)) throw new Error(HOST_REJECTED_CONFIG);
  if (candidate !== original) writeFileSync(paths.configFile, candidate, { mode: 0o600 });
}

function ensureEngramTable(text: string, file: string, table: Readonly<{ header: string; keyPath: readonly [string, string]; leaves: Record<string, unknown> }>): string {
  const parent = parseTomlDocument(text, file)[table.keyPath[0]];
  const declared = isRecord(parent) && isRecord(parent[table.keyPath[1]]);
  return mergeEngramLeaves(declared ? text : `${text}\n${table.header}\n`, table.leaves, file, table.header);
}

function engramOperatorLeaves(configFile: string): Record<string, unknown> | undefined {
  const document = parseTomlDocument(readFileSync(configFile, "utf8"), configFile);
  const engram = isRecord(document["mcp_servers"]) ? document["mcp_servers"]["engram"] : undefined;
  if (!isRecord(engram)) return undefined;
  const leaves = Object.fromEntries(Object.entries(engram).filter(([key]) => key !== "command" && key !== "args"));
  return Object.keys(leaves).length === 0 ? undefined : leaves;
}

function wireOsoPlugin(host: CodexHostProbes, paths: CodexPaths): string {
  const operatorLeaves = engramOperatorLeaves(paths.configFile);
  const registration = registerCodexPlugin(host, paths.marketplaceRoot, undefined, CODEX_PLUGIN_ID, CODEX_MARKETPLACE_NAME, paths.marketplaceRoot);
  finalizeHostWrittenConfig(paths, host, operatorLeaves);
  return appendHostWarning(`registered ${CODEX_PLUGIN_ID}`, registration.marketplace, registration.plugin);
}

function wireImpeccable(host: CodexHostProbes, paths: CodexPaths): string {
  const operatorLeaves = engramOperatorLeaves(paths.configFile);
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
  finalizeHostWrittenConfig(paths, host, operatorLeaves);
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
    removePointers: true,
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
    ...payloadBackupCandidatesOf(paths),
    { label: "engram-marketplace", target: path.join(paths.codexHome, ".tmp", "marketplaces", "engram") },
    { label: "engram-instructions", target: path.join(paths.codexHome, "engram-instructions.md") },
    { label: "engram-compact", target: path.join(paths.codexHome, "engram-compact-prompt.md") },
    { label: "impeccable", target: paths.impeccableMount },
    { label: "impeccable-opt-out", target: paths.impeccableOptOut },
  ];
}

function payloadBackupCandidatesOf(paths: CodexPaths): readonly Readonly<{ label: string; target: string }>[] {
  return [
    { label: "config", target: paths.configFile },
    { label: "global", target: paths.globalFile },
    { label: "hooks-manifest", target: paths.hooksManifest },
    { label: "agents", target: paths.agentsTarget },
    { label: "runtime", target: paths.runtimeRoot },
    { label: "marketplace", target: paths.marketplaceRoot },
    { label: "plugins", target: path.join(paths.codexHome, "plugins") },
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
