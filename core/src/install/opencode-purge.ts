import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import {
  backupTarget,
  beginTransaction,
  commitManifest,
  existsAtAll,
  parseManifestRows,
  restoreBackupManifest,
  serializeManifestRow,
  type BackupTransaction,
  type ManifestRow,
} from "./backup.ts";
import {
  fatalOutcome,
  messageOf,
  renderCommandReport,
  requiresYesOutcome,
  usageErrorOutcome,
  wiringFail,
  wiringOk,
  type CommandOutcome,
  type WiringEntry,
} from "./report.ts";
import { isReadableRegularFile, isSymlink, withOwnerOnlyUmask } from "../state/store.ts";

export const OPENCODE_PURGE_BACKUP_FORMAT = "oso-code-opencode-purge-v1";
export const PROJECT_CONFIGS_KEY = "OSO_OPENCODE_PROJECT_CONFIGS";
export const REQUIRED_PROJECT_CONFIG_COUNT = 3;

const GENTLE_AI_LABELS = ["gentle-ai-home", "gentle-ai-bin"] as const;
const UNSAFE_PATH_SEGMENTS = ["/../", "/./"] as const;
const UNSAFE_PATH_CHARACTERS = /[\n\r\t]/;

export type PurgeLabel = "config-home" | "state-home" | "cache-home" | "bin" | (typeof GENTLE_AI_LABELS)[number];

export type PurgeTarget = Readonly<{ label: PurgeLabel; target: string }>;

export type OpenCodePurgeInput = Readonly<{
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  assumeYes: boolean;
  dryRun: boolean;
  keepGentleAi: boolean;
  restoreFrom: string | undefined;
}>;

export function openCodePurgeTargets(homeDirectory: string, keepGentleAi: boolean): PurgeTarget[] {
  const all: PurgeTarget[] = [
    { label: "config-home", target: path.join(homeDirectory, ".config", "opencode") },
    { label: "state-home", target: path.join(homeDirectory, ".local", "share", "opencode") },
    { label: "cache-home", target: path.join(homeDirectory, ".cache", "opencode") },
    { label: "bin", target: path.join(homeDirectory, ".opencode", "bin", "opencode") },
    { label: "gentle-ai-home", target: path.join(homeDirectory, ".gentle-ai") },
    { label: "gentle-ai-bin", target: path.join(homeDirectory, ".local", "bin", "gentle-ai") },
  ];
  return keepGentleAi ? all.filter((row) => !(GENTLE_AI_LABELS as readonly string[]).includes(row.label)) : all;
}

export function purgeBackupParentOf(homeDirectory: string): string {
  return path.join(homeDirectory, ".local", "state", "oso-code", "purge-backups");
}

export function customizedHomeRefusal(homeDirectory: string, environment: NodeJS.ProcessEnv): string | undefined {
  const rows = [
    { key: "XDG_CONFIG_HOME", expected: path.join(homeDirectory, ".config"), named: "config home" },
    { key: "XDG_STATE_HOME", expected: path.join(homeDirectory, ".local", "state"), named: "state home" },
    { key: "XDG_CACHE_HOME", expected: path.join(homeDirectory, ".cache"), named: "cache home" },
  ];
  const customized = rows.find((row) => (environment[row.key] ?? "") !== "" && environment[row.key] !== row.expected);
  if (customized === undefined) return undefined;
  return `${customized.key} is not the default (${customized.expected}); a customized opencode ${customized.named} is missed by this wipe`;
}

export function unsafeTargetRefusal(homeDirectory: string, targets: readonly PurgeTarget[]): string | undefined {
  const homePhysical = physicalPathOf(homeDirectory);
  if (homePhysical === undefined) return `HOME does not resolve to a physical path: ${homeDirectory}`;
  if (homePhysical === path.parse(homePhysical).root) return `refusing to operate with HOME=${homeDirectory}`;
  for (const { label, target } of targets) {
    if (!path.isAbsolute(target)) return `${label} must be an absolute path: ${target}`;
    if (!pathIsClean(target)) return `unsafe ${label} path: ${target}`;
    if (!isBelow(target, homeDirectory)) return `${label} must remain below HOME: ${target}`;
    if (!existsAtAll(target) || isSymlink(target)) continue;
    const parentPhysical = physicalPathOf(path.dirname(target));
    if (parentPhysical === undefined) return `${label} does not resolve to a physical path: ${target}`;
    if (parentPhysical !== homePhysical && !isBelow(parentPhysical, homePhysical)) return `${label} resolves outside HOME: ${target}`;
  }
  return undefined;
}

export function backupOverlapRefusal(backupParent: string, targets: readonly PurgeTarget[]): string | undefined {
  for (const { target } of targets) {
    if (backupParent === target || isBelow(backupParent, target)) return `backup root would be inside purge target: ${target}`;
    if (target === backupParent || isBelow(target, backupParent)) return `purge target would contain existing backups: ${target}`;
  }
  return undefined;
}

export function projectConfigsRefusal(environment: NodeJS.ProcessEnv, targets: readonly PurgeTarget[]): string | undefined {
  const declared = projectConfigsIn(environment);
  if (declared.length === 0) {
    return `${PROJECT_CONFIGS_KEY} is required: exactly ${REQUIRED_PROJECT_CONFIG_COUNT} absolute project-level opencode.json paths, space-separated`;
  }
  if (declared.length !== REQUIRED_PROJECT_CONFIG_COUNT) {
    return `${PROJECT_CONFIGS_KEY} must name exactly ${REQUIRED_PROJECT_CONFIG_COUNT} project-level opencode.json files`;
  }
  if (new Set(declared).size !== declared.length) return "the three project-level opencode.json paths must be distinct";
  for (const declaredPath of declared) {
    if (!path.isAbsolute(declaredPath)) return `project-level opencode.json must be an absolute path: ${declaredPath}`;
    if (!pathIsClean(declaredPath)) return `unsafe project-level opencode.json path: ${declaredPath}`;
    if (!existsAtAll(declaredPath)) return `project-level opencode.json does not exist: ${declaredPath}`;
    const inside = targets.find(({ target }) => declaredPath === target || isBelow(declaredPath, target));
    if (inside !== undefined) return `project-level opencode.json must not be inside a purge target: ${declaredPath}`;
  }
  return undefined;
}

export function projectConfigsIn(environment: NodeJS.ProcessEnv): string[] {
  return (environment[PROJECT_CONFIGS_KEY] ?? "").split(/\s+/).filter((entry) => entry !== "");
}

export function purgeOpenCode(input: OpenCodePurgeInput): CommandOutcome {
  const targets = openCodePurgeTargets(input.homeDirectory, input.keepGentleAi);
  const backupParent = purgeBackupParentOf(input.homeDirectory);

  const customized = customizedHomeRefusal(input.homeDirectory, input.environment);
  if (customized !== undefined) return usageErrorOutcome("purge", "opencode", customized);
  const unsafe = unsafeTargetRefusal(input.homeDirectory, targets) ?? backupOverlapRefusal(backupParent, targets);
  if (unsafe !== undefined) return fatalOutcome("purge", "opencode", "the purge targets refuse this run", unsafe);

  if (input.restoreFrom !== undefined) return restoreOpenCodePurge(input.restoreFrom, input.homeDirectory);

  const declaredProjects = projectConfigsRefusal(input.environment, targets);
  if (declaredProjects !== undefined) return usageErrorOutcome("purge", "opencode", declaredProjects);
  if (input.dryRun) return dryRunOutcome(input, targets, backupParent);
  if (!input.assumeYes) return requiresYesOutcome("purge", "opencode");
  return withOwnerOnlyUmask(() => purgeAfterBackup(input, targets, backupParent));
}

function dryRunOutcome(input: OpenCodePurgeInput, targets: readonly PurgeTarget[], backupParent: string): CommandOutcome {
  const infoLines = [
    "dry run: nothing will be backed up or removed",
    "purge targets:",
    ...targets.map(({ label, target }) => `  ${label}: ${target}`),
    "project-level opencode.json files to report:",
    ...projectConfigsIn(input.environment).map((declared) => `  ${declared}`),
    `backup would be created at: ${path.join(backupParent, "purge-<timestamp>")}`,
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, [wiringOk("dry run", "no target was read for removal")]), exitCode: 0 };
}

function purgeAfterBackup(input: OpenCodePurgeInput, targets: readonly PurgeTarget[], backupParent: string): CommandOutcome {
  if (targets.every(({ target }) => !existsAtAll(target))) {
    const settled = "the user-level OpenCode install is already absent; nothing to purge";
    return { report: renderCommandReport("purge", "opencode", [settled], [wiringOk("user-level OpenCode install", "already absent")]), exitCode: 0 };
  }

  let tx: BackupTransaction;
  try {
    tx = beginTransaction(backupParent, OPENCODE_PURGE_BACKUP_FORMAT);
    for (const { label, target } of targets) backupTarget(tx, label, target);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("purge", "opencode", "could not create the pre-purge backup", messageOf(error));
  }

  const wiring: WiringEntry[] = targets.map(({ label, target }) => removalEntry(label, target));
  const vanished = projectConfigsIn(input.environment).filter((declared) => !existsAtAll(declared));
  if (vanished.length > 0) {
    return fatalOutcome("purge", "opencode", "project-level opencode.json vanished during the purge", vanished.join(" "));
  }
  const infoLines = [
    `backup: ${tx.backupRoot}`,
    "purged the user-level OpenCode install: config, state, cache, binary",
    ...(input.keepGentleAi ? ["gentle-ai homes are kept and excluded from the purge"] : ["the gentle-ai homes were part of the purge"]),
    ...projectConfigsIn(input.environment).map((declared) => `project-level opencode.json ${existsAtAll(declared) ? "INTACT" : "MISSING"}: ${declared}`),
    "no login or installation command was run",
    `restore with: oso purge --host opencode --restore ${tx.backupRoot}`,
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, wiring), exitCode: 0 };
}

function removalEntry(label: PurgeLabel, target: string): WiringEntry {
  if (!existsAtAll(target)) return wiringOk(label, "already absent");
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    return wiringFail(label, messageOf(error));
  }
  return existsAtAll(target) ? wiringFail(label, `purge target was not removed: ${target}`) : wiringOk(label, `removed ${target}`);
}

export function restoreOpenCodePurge(backupDirectory: string, homeDirectory: string): CommandOutcome {
  const readable = readablePurgeBackup(backupDirectory, homeDirectory);
  if (readable.kind === "unusable") return fatalOutcome("purge", "opencode", "cannot restore from this backup", readable.message);

  const occupied = readable.rows.find((row) => existsAtAll(row.target));
  if (occupied !== undefined) {
    return fatalOutcome("purge", "opencode", "refusing to overwrite an existing target", `${occupied.label}: ${occupied.target}`);
  }
  for (const row of readable.rows) mkdirSync(path.dirname(row.target), { recursive: true });

  const restored = restoreBackupManifest(readable.rows.map(serializeManifestRow).join("\n"), path.join(backupDirectory, "items"));
  const wiring = readable.rows.map((row) =>
    restored.failedItems.includes(row.target) ? wiringFail(row.label, `could not restore ${row.target}`) : wiringOk(row.label, row.target),
  );
  const infoLines = [
    `restored the user-level OpenCode install from verified backup: ${backupDirectory}`,
    "no login or installation command was run",
  ];
  return { report: renderCommandReport("purge", "opencode", infoLines, wiring), exitCode: restored.failedCount === 0 ? 0 : 1 };
}

type ReadablePurgeBackup = Readonly<{ kind: "usable"; rows: readonly ManifestRow[] } | { kind: "unusable"; message: string }>;

function readablePurgeBackup(backupDirectory: string, homeDirectory: string): ReadablePurgeBackup {
  if (!path.isAbsolute(backupDirectory)) return { kind: "unusable", message: "backup path must be absolute" };
  if (!existsAtAll(backupDirectory) || isSymlink(backupDirectory)) {
    return { kind: "unusable", message: `backup is not a directory: ${backupDirectory}` };
  }
  const marker = path.join(backupDirectory, "format");
  const format = isReadableRegularFile(marker) ? readFileSync(marker, "utf8").trim() : "";
  if (format !== OPENCODE_PURGE_BACKUP_FORMAT) {
    return { kind: "unusable", message: `unsupported or missing backup format: ${backupDirectory} (expected ${OPENCODE_PURGE_BACKUP_FORMAT})` };
  }
  const manifest = path.join(backupDirectory, "manifest");
  if (!isReadableRegularFile(manifest)) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const rows = parseManifestRows(readFileSync(manifest, "utf8"));
  if (rows.length === 0) return { kind: "unusable", message: `backup contains no target records: ${backupDirectory}` };
  const unknown = rows.find((row) => expectedTargetFor(row.label, homeDirectory) === undefined);
  if (unknown !== undefined) return { kind: "unusable", message: `unknown backup target label: ${unknown.label}` };
  const foreign = rows.find((row) => row.target !== expectedTargetFor(row.label, homeDirectory));
  if (foreign !== undefined) return { kind: "unusable", message: `backup target does not match this HOME: ${foreign.label}` };
  return { kind: "usable", rows };
}

function expectedTargetFor(label: string, homeDirectory: string): string | undefined {
  return openCodePurgeTargets(homeDirectory, false).find((row) => row.label === label)?.target;
}

function pathIsClean(target: string): boolean {
  if (target === path.parse(target).root) return false;
  if (UNSAFE_PATH_CHARACTERS.test(target)) return false;
  if (target.endsWith("/..") || target.endsWith("/.")) return false;
  return !UNSAFE_PATH_SEGMENTS.some((segment) => target.includes(segment));
}

function isBelow(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(ancestor.endsWith(path.sep) ? ancestor : `${ancestor}${path.sep}`);
}

function physicalPathOf(target: string): string | undefined {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}
