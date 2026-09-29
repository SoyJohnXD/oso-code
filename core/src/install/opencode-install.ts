import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  backupTarget,
  beginTransaction,
  commitManifest,
  installBackupBudgetKib,
  installBackupsDeclaring,
  installBackupsOverBudget,
  rollback,
  type BackupTransaction,
} from "./backup.ts";
import { gitHooksOwner, resolveFallowMcpCommand } from "./claude.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { EVERY_AGENT_ON_THE_HOST_SESSION_MODEL, hostContractViolationOf, mergeOpenCodeConfig, type AgentModels } from "./opencode-config.ts";
import type { OpenCodeHostProbes } from "./opencode-host.ts";
import {
  harnessManifestOf,
  harnessVersionIn,
  openCodeInstallTargets,
  type OpenCodeInstallRecord,
  type OpenCodeInstallTargets,
} from "./opencode-install-layout.ts";
import {
  configFileRefusal,
  configHomeRefusal,
  globalFileRefusal,
  mergeGlobalAgents,
  opencodePathsFor,
  OPENCODE_INSTALL_BACKUP_FORMAT,
  OPENCODE_INSTALL_BACKUP_LABEL,
  type OpenCodePaths,
} from "./opencode.ts";
import {
  openCodeTrustReading,
  openCodeTrustRows,
  OPENCODE_TRUST_FILE_COUNT,
  publishedDistFileNames,
  trustDivergenceLine,
  type TrustRootKind,
} from "./opencode-trust.ts";
import { isAboveTestedVersion, meetsVersionFloor, SUPPORTED_OPENCODE_VERSION } from "./pins.ts";
import { profileRolesOf, readProfile, type ProfileReading } from "./profile.ts";
import {
  fatalOutcome,
  messageOf,
  renderCommandReport,
  requiresYesOutcome,
  restoreNoteOf,
  usageErrorOutcome,
  wiringFail,
  wiringOk,
  type CommandOutcome,
  type WiringEntry,
} from "./report.ts";
import { firstExecutableOnPath } from "./verify-claude.ts";
import { isDirectory, isoTimestamp, isReadableRegularFile, stateValue, withOwnerOnlyUmask } from "../state/store.ts";

export const OWNER_INSTALLER = "installer";
export const OWNER_OPERATOR = "operator";
export const EXPECTED_SKILL_WRAPPER_COUNT = 9;
export const PRESERVED_KEYS_FILE = "operator-preserved-keys";

const PRIVATE_FILE_MODE = 0o600;
const EXECUTABLE_FILE_MODE = 0o700;
const OWNER_ONLY_MASK = 0o7700;
const MIGRATED_SESSION_PATTERN = /^ses[A-Za-z0-9]+$/;
const AGENT_IDENTITY_LENGTH = 16;
export const ENGRAM_BINARY_NAME = "engram";
const FALLOW_FALLBACK_COMMAND = "fallow-mcp";

export type OpenCodeInstallInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  workingDirectory: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  host: OpenCodeHostProbes;
  assumeYes: boolean;
  installImpeccable: boolean;
  installGitHook: boolean;
}>;

export type OpenCodePayloadSources = Readonly<{
  skills: string;
  sharedSkills: string;
  agents: string;
  commands: string;
  pluginBundle: string;
  gitHook: string;
  stateBin: string;
  stateBinPackage: string;
  dist: string;
  global: string;
  publishedHashes: string;
  harnessManifest: string;
}>;

export function openCodePayloadSources(repositoryRoot: string): OpenCodePayloadSources {
  return {
    skills: path.join(repositoryRoot, "opencode", "skills"),
    sharedSkills: path.join(repositoryRoot, "plugin", "skills", "_shared"),
    agents: path.join(repositoryRoot, "opencode", "agents"),
    commands: path.join(repositoryRoot, "opencode", "commands"),
    pluginBundle: path.join(repositoryRoot, "opencode", "dist", "oso-code.js"),
    gitHook: path.join(repositoryRoot, "plugin", "git-hooks", "pre-commit"),
    stateBin: path.join(repositoryRoot, "plugin", "bin", "oso-state"),
    stateBinPackage: path.join(repositoryRoot, "plugin", "bin", "package.json"),
    dist: path.join(repositoryRoot, "plugin", "dist"),
    global: path.join(repositoryRoot, "bootstrap", "opencode-global.md"),
    publishedHashes: path.join(repositoryRoot, "bootstrap", "hook-hashes.txt"),
    harnessManifest: harnessManifestOf(repositoryRoot),
  };
}

export function payloadRefusal(sources: OpenCodePayloadSources): string | undefined {
  const missing = [
    { present: isReadableRegularFile(sources.global), message: `the OpenCode global guidance is missing: ${sources.global}` },
    { present: isDirectory(sources.skills), message: `the OpenCode skill wrappers are missing: ${sources.skills}` },
    { present: isDirectory(sources.sharedSkills), message: `the shared skill directory is missing: ${sources.sharedSkills}` },
    { present: isDirectory(sources.agents), message: `the OpenCode agent contracts are missing: ${sources.agents}` },
    { present: isDirectory(sources.commands), message: `the OpenCode command templates are missing: ${sources.commands}` },
    { present: isReadableRegularFile(sources.pluginBundle), message: `the OpenCode plugin bundle is missing: ${sources.pluginBundle}` },
    { present: isReadableRegularFile(sources.gitHook), message: `the shared commit hook is missing: ${sources.gitHook}` },
    { present: isReadableRegularFile(sources.stateBin), message: `the oso-state binary is missing: ${sources.stateBin}` },
    { present: isReadableRegularFile(sources.stateBinPackage), message: `the oso-state module manifest is missing: ${sources.stateBinPackage}` },
    { present: isReadableRegularFile(sources.harnessManifest), message: `the harness manifest is missing: ${sources.harnessManifest}` },
  ].find((row) => !row.present);
  if (missing !== undefined) return missing.message;

  const wrappers = skillWrapperNames(sources.skills).length;
  if (wrappers !== EXPECTED_SKILL_WRAPPER_COUNT) {
    return `expected exactly ${EXPECTED_SKILL_WRAPPER_COUNT} OpenCode skill wrappers (found ${wrappers})`;
  }
  if (agentContractNames(sources.agents).length === 0) return `no OpenCode agent contracts found under ${sources.agents}`;
  return undefined;
}

export function trustBytesRefusal(publishedHashes: string, rootKind: TrustRootKind, root: string): string | undefined {
  const reading = openCodeTrustReading(publishedHashes, rootKind, root);
  if (reading.divergences.length > 0) {
    return `${rootKind} gate bytes do not match the published hashes: ${reading.divergences.map(trustDivergenceLine).join(";")}`;
  }
  if (reading.filesRead !== OPENCODE_TRUST_FILE_COUNT) {
    return `the published manifest must cover exactly ${OPENCODE_TRUST_FILE_COUNT} OpenCode trust files (found ${reading.filesRead})`;
  }
  return undefined;
}

export function installerOwnedTargets(ownerRegistry: string): string[] {
  if (!isReadableRegularFile(ownerRegistry)) return [];
  return readFileSync(ownerRegistry, "utf8")
    .split("\n")
    .filter((row) => row.startsWith(`${OWNER_INSTALLER}\t`))
    .map((row) => row.slice(OWNER_INSTALLER.length + 1));
}

export function installOpenCode(input: OpenCodeInstallInput): CommandOutcome {
  return withOwnerOnlyUmask(() => writeOpenCodeInstall(input));
}

function writeOpenCodeInstall(input: OpenCodeInstallInput): CommandOutcome {
  const paths = opencodePathsFor(input.homeDirectory, input.environment);
  const targets = openCodeInstallTargets(paths);
  const sources = openCodePayloadSources(input.repositoryRoot);

  const refused = installRefusal(input, paths, sources);
  if (refused !== undefined) return refused;

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(paths.backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT);
    for (const { label, target } of backupCandidatesOf(paths, targets)) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("install", "opencode", "could not create the pre-install backup", messageOf(error));
  }

  const infoLines: string[] = [`backup: ${tx.backupRoot}`];
  const wiring: WiringEntry[] = [];
  try {
    infoLines.push(...migrateOpenCodeState(paths, targets, tx));
    installPayloadTrees(paths, targets, sources);
    wiring.push(wiringOk("installed payload", `${targets.skills}, ${targets.agents}, ${targets.commands}, ${targets.plugin}`));
    wiring.push(...retiredShellGateEntries(targets));
    wiring.push(publishedGateBytesEntry(sources.publishedHashes, paths.configHome));
    writeInstallRecord(sources, targets.installRecord);
    wiring.push(wiringOk("install record", targets.installRecord));
    mergeGlobalAgents(paths.globalFile, readFileSync(sources.global, "utf8"));
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
    isAboveTestedVersion(input.host.version, SUPPORTED_OPENCODE_VERSION)
      ? `installed oso-code for OpenCode ${hostVersion}, verified against ${SUPPORTED_OPENCODE_VERSION}`
      : `installed oso-code for OpenCode ${hostVersion}`,
  );
  if (input.host.versionNote !== undefined) infoLines.push(input.host.versionNote);
  return { report: renderCommandReport("install", "opencode", infoLines, wiring), exitCode: 0 };
}

function installRefusal(input: OpenCodeInstallInput, paths: OpenCodePaths, sources: OpenCodePayloadSources): CommandOutcome | undefined {
  const homeRefusal = configHomeRefusal(input.homeDirectory, input.environment, "install");
  if (homeRefusal !== undefined) return usageErrorOutcome("install", "opencode", homeRefusal.message);

  const payload = payloadRefusal(sources);
  if (payload !== undefined) return fatalOutcome("install", "opencode", "the install payload is incomplete", payload);

  const sourceBytes = trustBytesRefusal(sources.publishedHashes, "source", input.repositoryRoot);
  if (sourceBytes !== undefined) return fatalOutcome("install", "opencode", "the published gate bytes refuse this install", sourceBytes);

  for (const refusal of [configFileRefusal(paths.configFile), globalFileRefusal(paths.globalFile)]) {
    if (refusal === undefined) continue;
    return refusal.kind === "usage"
      ? usageErrorOutcome("install", "opencode", refusal.message)
      : fatalOutcome("install", "opencode", "the existing OpenCode state refuses this install", refusal.message);
  }

  if (!meetsVersionFloor(input.host.version, SUPPORTED_OPENCODE_VERSION)) {
    return fatalOutcome(
      "install",
      "opencode",
      "host baseline not met",
      `upgrade opencode to ${SUPPORTED_OPENCODE_VERSION} or newer and re-run (found ${input.host.version ?? input.host.versionNote ?? "no opencode on PATH"})`,
    );
  }
  return input.assumeYes ? undefined : requiresYesOutcome("install", "opencode");
}

function backupCandidatesOf(paths: OpenCodePaths, targets: OpenCodeInstallTargets): readonly Readonly<{ label: string; target: string }>[] {
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
    { label: "registry", target: targets.ownerRegistry },
    { label: "install-record", target: targets.installRecord },
  ];
}

function installPayloadTrees(paths: OpenCodePaths, targets: OpenCodeInstallTargets, sources: OpenCodePayloadSources): void {
  replaceTree(paths.configHome, targets.skills, (stage) => {
    for (const wrapper of osoPrefixedEntryNames(sources.skills)) cpSync(path.join(sources.skills, wrapper), path.join(stage, wrapper), { recursive: true });
    cpSync(sources.sharedSkills, path.join(stage, "_shared"), { recursive: true });
  });
  replaceTree(paths.configHome, targets.agents, (stage) => {
    for (const agent of agentContractNames(sources.agents)) cpSync(path.join(sources.agents, agent), path.join(stage, agent));
  });
  replaceTree(paths.configHome, targets.commands, (stage) => {
    for (const command of modeCommandNames(sources.commands)) cpSync(path.join(sources.commands, command), path.join(stage, command));
  });
  replaceTree(paths.configHome, targets.plugin, (stage) => cpSync(sources.pluginBundle, path.join(stage, "oso-code.js")));
  replaceTree(paths.configHome, targets.stateBin, (stage) => {
    cpSync(sources.stateBin, path.join(stage, "oso-state"));
    cpSync(sources.stateBinPackage, path.join(stage, "package.json"));
    chmodSync(path.join(stage, "oso-state"), EXECUTABLE_FILE_MODE);
  });
  replaceTree(paths.configHome, targets.dist, (stage) => {
    for (const bundle of publishedDistFileNames(sources.publishedHashes)) cpSync(path.join(sources.dist, bundle), path.join(stage, bundle));
  });
  replaceTree(paths.configHome, targets.gitHooks, (stage) => {
    cpSync(sources.gitHook, path.join(stage, "pre-commit"));
    chmodSync(path.join(stage, "pre-commit"), EXECUTABLE_FILE_MODE);
  });
}

function retiredShellGateEntries(targets: OpenCodeInstallTargets): WiringEntry[] {
  const retired = installerOwnedTargets(targets.ownerRegistry).filter((target) => path.dirname(target) === targets.hooks && target.endsWith(".sh"));
  for (const gate of retired) rmSync(gate, { force: true });
  return retired.length === 0 ? [] : [wiringOk("retired shell gates", `removed ${retired.length} installer-owned script(s) from ${targets.hooks}`)];
}

function publishedGateBytesEntry(publishedHashes: string, configHome: string): WiringEntry {
  const divergent = trustBytesRefusal(publishedHashes, "installed", configHome);
  if (divergent !== undefined) throw new Error(divergent);
  return wiringOk("published gate bytes", `verified against ${publishedHashes}`);
}

function writeInstallRecord(sources: OpenCodePayloadSources, installRecord: string): void {
  const record: OpenCodeInstallRecord = { version: harnessVersionIn(sources.harnessManifest), manifest: openCodeTrustRows(sources.publishedHashes) };
  writeJsonFile(installRecord, record);
}

function renderOpenCodeConfig(input: OpenCodeInstallInput, paths: OpenCodePaths, tx: BackupTransaction): WiringEntry {
  const fallow = resolveFallowMcpCommand(input.environment, input.homeDirectory, input.platform) ?? FALLOW_FALLBACK_COMMAND;
  const profile = readProfile(input.workingDirectory);
  const merged = mergeOpenCodeConfig(recordedConfigDocument(tx), fallow, profileRolesOf(profile));
  const violation = hostContractViolationOf(merged.document);
  if (violation !== undefined) throw new Error(`the rendered config violates the host contract: ${violation}`);
  writeJsonFile(paths.configFile, merged.document);
  chmodSync(paths.configFile, PRIVATE_FILE_MODE);
  writeFileSync(preservedKeysFileOf(tx), merged.preservedKeys.map((key) => `${key}\n`).join(""));
  return wiringOk("opencode.json", `preserved ${merged.preservedKeys.length} operator key(s), ${agentModelNote(profile, merged.agentModels)}`);
}

function agentModelNote(profile: ProfileReading, agentModels: AgentModels): string {
  if (profile.kind === "unmirrored") {
    return `no profile mirror at ${profile.mirror.file}, so ${EVERY_AGENT_ON_THE_HOST_SESSION_MODEL}`;
  }
  const named = Object.keys(agentModels).length;
  if (named === 0) return `${profile.mirror.file} names no model, so ${EVERY_AGENT_ON_THE_HOST_SESSION_MODEL}`;
  return `wrote ${named} agent model key(s) from ${profile.mirror.file}`;
}

function recordedConfigDocument(tx: BackupTransaction): unknown {
  return readJsonFile(path.join(tx.itemsDirectory, "config"));
}

function wireEngram(environment: NodeJS.ProcessEnv, engramPlugin: string, tx: BackupTransaction): WiringEntry {
  if (firstExecutableOnPath(environment, ENGRAM_BINARY_NAME) === undefined) {
    return wiringOk("engram", "engram is not on PATH; the operator's prior Engram wiring stays as backed up");
  }
  const help = spawnSync(ENGRAM_BINARY_NAME, ["setup", "--help"], { env: environment, encoding: "utf8" });
  if (!`${help.stdout ?? ""}${help.stderr ?? ""}`.includes("opencode")) {
    return wiringOk("engram", "engram setup does not advertise OpenCode support; the operator's prior wiring is preserved");
  }
  const setup = spawnSync(ENGRAM_BINARY_NAME, ["setup", "opencode"], { env: environment, encoding: "utf8" });
  if (setup.error === undefined && setup.status === 0) return wiringOk("engram", "wired through engram setup opencode");
  restoreBackedUpEngramPlugin(tx, engramPlugin);
  return wiringFail("engram", "engram setup opencode failed; the operator's prior Engram plugin was restored from the backup snapshot");
}

function restoreBackedUpEngramPlugin(tx: BackupTransaction, engramPlugin: string): void {
  const recorded = path.join(tx.itemsDirectory, "engram-plugin");
  if (!isReadableRegularFile(recorded)) return;
  mkdirSync(path.dirname(engramPlugin), { recursive: true });
  cpSync(recorded, engramPlugin);
}

function impeccableEntries(input: OpenCodeInstallInput, targets: OpenCodeInstallTargets): WiringEntry[] {
  if (input.installImpeccable) return [wiringOk("impeccable", `not mounted at ${targets.impeccableMount}; no installer in this tree performs the mount`)];
  mkdirSync(path.dirname(targets.impeccableOptOut), { recursive: true });
  writeFileSync(targets.impeccableOptOut, `skipped by --no-impeccable on ${isoTimestamp().slice(0, 10)}\n`);
  return [wiringOk("impeccable", "skipped by --no-impeccable")];
}

function gitHookEntries(input: OpenCodeInstallInput, targets: OpenCodeInstallTargets): WiringEntry[] {
  const preCommit = path.join(targets.gitHooks, "pre-commit");
  if (!input.installGitHook) return [wiringOk("git commit hook", `skipped by --no-git-hook; the hook is installed at ${preCommit}`)];
  const owner = gitHooksOwner(input.repositoryRoot, input.environment, targets.gitHooks);
  if (owner !== "") {
    return [
      wiringFail(
        "git commit hook",
        `not wired in ${input.repositoryRoot} — ${owner} already owns this repo's hooks and core.hooksPath would take them out of ` +
          `git's reach; the plugin's own commit gate still applies here — to run both, call ${preCommit} from your own pre-commit`,
      ),
    ];
  }
  const wired = spawnSync("git", ["-C", input.repositoryRoot, "config", "--local", "core.hooksPath", targets.gitHooks], {
    env: input.environment,
    encoding: "utf8",
  });
  if (wired.error === undefined && wired.status === 0) return [wiringOk("git commit hook", `core.hooksPath=${targets.gitHooks}`)];
  return [wiringFail("git commit hook", `git config failed: ${`${wired.stdout ?? ""}${wired.stderr ?? ""}`.trim()}`)];
}

function writeOwnerRegistry(paths: OpenCodePaths, targets: OpenCodeInstallTargets, tx: BackupTransaction): void {
  const rows = [
    ownedBy(OWNER_INSTALLER, paths.configFile),
    ...preservedKeysOf(tx).map((key) => ownedBy(OWNER_OPERATOR, `${paths.configFile}:${key}`)),
    ownedBy(OWNER_INSTALLER, paths.globalFile),
    ownedBy(OWNER_INSTALLER, targets.skills),
    ownedBy(OWNER_INSTALLER, targets.agents),
    ownedBy(OWNER_INSTALLER, targets.commands),
    ownedBy(OWNER_INSTALLER, targets.plugin),
    ownedBy(OWNER_INSTALLER, path.join(targets.stateBin, "oso-state")),
    ownedBy(OWNER_INSTALLER, path.join(targets.gitHooks, "pre-commit")),
    ownedBy(OWNER_INSTALLER, targets.installRecord),
  ];
  mkdirSync(paths.stateRoot, { recursive: true });
  writeFileSync(targets.ownerRegistry, rows.map((row) => `${row}\n`).join(""), { mode: PRIVATE_FILE_MODE });
}

function ownedBy(owner: string, target: string): string {
  return `${owner}\t${target}`;
}

function preservedKeysOf(tx: BackupTransaction): string[] {
  const file = preservedKeysFileOf(tx);
  if (!isReadableRegularFile(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((key) => key !== "");
}

function preservedKeysFileOf(tx: BackupTransaction): string {
  return path.join(tx.backupRoot, PRESERVED_KEYS_FILE);
}

function pruneOpenCodeInstallBackups(paths: OpenCodePaths, targets: OpenCodeInstallTargets, environment: NodeJS.ProcessEnv): string[] {
  if (!isReadableRegularFile(targets.restoreExercisedMarker)) return [];
  const ownSnapshots = installBackupsDeclaring(paths.backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL);
  const over = installBackupsOverBudget(ownSnapshots, installBackupBudgetKib(environment));
  for (const backup of over) rmSync(backup, { recursive: true, force: true });
  return over;
}

export function migrateOpenCodeState(paths: OpenCodePaths, targets: OpenCodeInstallTargets, tx: BackupTransaction): string[] {
  const migrated: string[] = [];
  for (const stateFile of stateFilesUnder(paths.stateRoot)) {
    const repository = path.basename(stateFile, ".state");
    let backedUp = false;
    const backUpOnce = (): void => {
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

function migrateRenamedIdentity(stateFile: string, repository: string, backUpOnce: () => void): string[] {
  const session = stateValue(readFileSync(stateFile, "utf8"), "session");
  if (!MIGRATED_SESSION_PATTERN.test(session)) return [];
  const agent = repository.slice(0, AGENT_IDENTITY_LENGTH);
  backUpOnce();
  rewriteStateKeys(stateFile, [`session=${agent}`]);
  if (stateValue(readFileSync(stateFile, "utf8"), "plan_approval_session") !== "") {
    rewriteStateKeys(stateFile, [`plan_approval_session=${agent}`]);
  }
  return [`migrated the renamed identity in ${path.basename(stateFile)}: session ${session} is now ${agent}`];
}

function migrateRelocatedApproval(stateFile: string, repository: string, planArtifactRoot: string, backUpOnce: () => void): string[] {
  if (stateValue(readFileSync(stateFile, "utf8"), "plan_approval") !== "") return [];
  const planDirectory = path.join(planArtifactRoot, repository);
  const approved = directoryEntryNames(planDirectory).find((name) => name.startsWith("approved-") && name.endsWith(".md"));
  if (approved === undefined) return [];
  const planDigest = approved.slice("approved-".length, -".md".length);
  backUpOnce();
  rewriteStateKeys(stateFile, [
    "plan_approval=approved",
    `plan_approval_digest=${planDigest}`,
    `plan_approval_session=${repository.slice(0, AGENT_IDENTITY_LENGTH)}`,
    `plan_snapshot_file=${path.join(planDirectory, approved)}`,
    `plan_current_file=${path.join(planDirectory, "current.md")}`,
    "plan_revision=0",
  ]);
  return [`migrated the relocated plan approval into ${path.basename(stateFile)}: ${planDigest}`];
}

function rewriteStateKeys(stateFile: string, pairs: readonly string[]): void {
  for (const pair of pairs) {
    const key = pair.slice(0, pair.indexOf("="));
    const kept = readFileSync(stateFile, "utf8")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith(`${key}=`));
    const staged = path.join(path.dirname(stateFile), `.state-migration-${path.basename(stateFile)}`);
    writeFileSync(staged, [...kept, pair].map((line) => `${line}\n`).join(""), { mode: PRIVATE_FILE_MODE });
    renameSync(staged, stateFile);
  }
}

function stateFilesUnder(stateRoot: string): string[] {
  return directoryEntryNames(stateRoot)
    .filter((name) => name.endsWith(".state"))
    .map((name) => path.join(stateRoot, name))
    .filter(isReadableRegularFile);
}

function replaceTree(stageParent: string, target: string, fill: (stage: string) => void): void {
  mkdirSync(stageParent, { recursive: true });
  const stage = mkdtempSync(path.join(stageParent, ".oso-install-stage-"));
  fill(stage);
  narrowToOwnerOnly(stage);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(stage, target);
}

function narrowToOwnerOnly(target: string): void {
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) return;
  chmodSync(target, stats.mode & OWNER_ONLY_MASK);
  if (!stats.isDirectory()) return;
  for (const name of readdirSync(target)) narrowToOwnerOnly(path.join(target, name));
}

function skillWrapperNames(skillsSource: string): string[] {
  return osoPrefixedEntryNames(skillsSource).filter((name) => isReadableRegularFile(path.join(skillsSource, name, "SKILL.md")));
}

function agentContractNames(agentsSource: string): string[] {
  return osoPrefixedMarkdownNames(agentsSource);
}

function modeCommandNames(commandsSource: string): string[] {
  return osoPrefixedMarkdownNames(commandsSource);
}

function osoPrefixedMarkdownNames(directory: string): string[] {
  return osoPrefixedEntryNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path.join(directory, name)));
}

function osoPrefixedEntryNames(directory: string): string[] {
  return directoryEntryNames(directory).filter((name) => name.startsWith("oso-"));
}

function directoryEntryNames(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch {
    return [];
  }
}
