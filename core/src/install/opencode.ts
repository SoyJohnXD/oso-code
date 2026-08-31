import { readFileSync } from "node:fs";
import path from "node:path";
import { backupSizeKib, existsAtAll, installBackupDeclares, installBackupsDeclaring } from "./backup.ts";
import { JsonParseError, readJsonFile, writeJsonFile } from "./json.ts";
import { isPlainObject, type ConfigDocument } from "./opencode-config.ts";
import {
  fatalOutcome,
  renderCommandReport,
  requiresYesOutcome,
  usageErrorOutcome,
  wiringOk,
  type CommandOutcome,
} from "./report.ts";
import { isReadableRegularFile, isRegularNonSymlinkFile, writeFileAtomically } from "../state/store.ts";

export const OPENCODE_INSTALL_BACKUP_FORMAT = "oso-code-opencode-install-v1";
export const OPENCODE_INSTALL_BACKUP_LABEL = "commands";
export const CONFIG_BACKUP_LABEL = "config";
export const GLOBAL_MARKER_START = "<!-- oso-code:start -->";
export const GLOBAL_MARKER_END = "<!-- oso-code:end -->";

const AWK_BLANK_LINE = /^[ \t]*$/;
const REPAIRABLE_NESTED_PATHS = [["permission"], ["permission", "skill"], ["permission", "task"], ["mcp"]] as const;

export type OpenCodePaths = Readonly<{
  homeDirectory: string;
  configHome: string;
  configFile: string;
  globalFile: string;
  stateRoot: string;
  backupsRoot: string;
}>;

export type PreflightRefusal = Readonly<{ kind: "usage" | "fatal"; message: string }>;

export type MarkerRegionOutcome = Readonly<{ kind: "clean"; text: string } | { kind: "malformed" }>;

export type RestorableKey = Readonly<{ keyPath: string; value: unknown }>;

export type OpenCodeCommandInput = Readonly<{
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  assumeYes: boolean;
  listBackups?: boolean;
  backupName?: string;
}>;

export function opencodePathsFor(homeDirectory: string, environment: NodeJS.ProcessEnv): OpenCodePaths {
  const configHome = path.join(environment["XDG_CONFIG_HOME"] ?? path.join(homeDirectory, ".config"), "opencode");
  const stateRoot = path.join(homeDirectory, ".local", "state", "oso-code");
  return {
    homeDirectory,
    configHome,
    configFile: path.join(configHome, "opencode.json"),
    globalFile: path.join(configHome, "AGENTS.md"),
    stateRoot,
    backupsRoot: stateRoot,
  };
}

export function configHomeRefusal(
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  verb: "install" | "repair",
): PreflightRefusal | undefined {
  const configuredHome = environment["XDG_CONFIG_HOME"];
  if (configuredHome === undefined || configuredHome === "" || configuredHome === path.join(homeDirectory, ".config")) return undefined;
  return {
    kind: "usage",
    message:
      `XDG_CONFIG_HOME (${configuredHome}) is not the default for HOME (${path.join(homeDirectory, ".config")}), ` +
      `so this ${verb} would write outside the home it was pointed at; unset it or point both at the same account`,
  };
}

export function configFileRefusal(configFile: string): PreflightRefusal | undefined {
  if (existsAtAll(configFile) && !isRegularNonSymlinkFile(configFile)) {
    return { kind: "fatal", message: `OpenCode config is not a regular file: ${configFile}` };
  }
  if (!isReadableRegularFile(configFile)) return undefined;
  if (readableJsonDocument(configFile) !== undefined) return undefined;
  return { kind: "fatal", message: `the existing OpenCode config is not valid JSON: ${configFile} (back it up and fix it, then re-run)` };
}

export function globalFileRefusal(globalFile: string): PreflightRefusal | undefined {
  if (existsAtAll(globalFile) && !isRegularNonSymlinkFile(globalFile)) {
    return { kind: "fatal", message: `the global guidance file is not a regular file: ${globalFile}` };
  }
  if (!isReadableRegularFile(globalFile)) return undefined;
  if (withoutOpenCodeMarkerRegion(readFileSync(globalFile, "utf8")).kind === "clean") return undefined;
  return { kind: "fatal", message: malformedMarkersMessage(globalFile) };
}

export function withoutOpenCodeMarkerRegion(content: string): MarkerRegionOutcome {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const kept: string[] = [];
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
  return { kind: "clean", text: kept.length === 0 ? "" : `${kept.join("\n")}\n` };
}

export function renderGlobalAgents(strippedContent: string, blockBody: string): string {
  const separator = strippedContent === "" ? "" : "\n";
  return `${withoutTrailingBlankLines(strippedContent)}${separator}${GLOBAL_MARKER_START}\n${blockBody}${GLOBAL_MARKER_END}\n`;
}

export function mergeGlobalAgents(globalFile: string, blockBody: string): void {
  const existing = isReadableRegularFile(globalFile) ? readFileSync(globalFile, "utf8") : "";
  const stripped = withoutOpenCodeMarkerRegion(existing);
  if (stripped.kind === "malformed") throw new Error(malformedMarkersMessage(globalFile));
  writeFileAtomically(path.dirname(globalFile), globalFile, renderGlobalAgents(stripped.text, blockBody), ".oso-agents-md-");
}

export function snapshotsHoldingAConfig(backupsRoot: string): string[] {
  return installBackupsDeclaring(backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL).filter((backup) =>
    isReadableRegularFile(recordedConfigOf(backup)),
  );
}

export function keysRecordedButMissing(recorded: ConfigDocument, live: ConfigDocument): RestorableKey[] {
  const restorable: RestorableKey[] = [];
  for (const nested of [[] as readonly string[], ...REPAIRABLE_NESTED_PATHS]) {
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

export function restoreBlockedBy(live: ConfigDocument, restorable: readonly RestorableKey[]): string | undefined {
  for (const { keyPath } of restorable) {
    const names = keyPath.split(".");
    let cursor: ConfigDocument = live;
    for (const name of names.slice(0, -1)) {
      const next = cursor[name];
      if (next !== undefined && next !== null && !isPlainObject(next)) return keyPath;
      cursor = isPlainObject(next) ? next : {};
    }
  }
  return undefined;
}

export function withRestoredKeys(live: ConfigDocument, restorable: readonly RestorableKey[]): ConfigDocument {
  for (const { keyPath, value } of restorable) {
    const names = keyPath.split(".");
    let target = live;
    for (const name of names.slice(0, -1)) {
      const existing = target[name];
      if (isPlainObject(existing)) {
        target = existing;
        continue;
      }
      const created: ConfigDocument = {};
      target[name] = created;
      target = created;
    }
    target[names.at(-1) as string] = value;
  }
  return live;
}

export function repairOpenCode(input: OpenCodeCommandInput): CommandOutcome {
  const paths = opencodePathsFor(input.homeDirectory, input.environment);
  const homeRefusal = configHomeRefusal(input.homeDirectory, input.environment, "repair");
  if (homeRefusal !== undefined) return usageErrorOutcome("repair", "opencode", homeRefusal.message);
  if (input.listBackups === true) return backupListingOutcome(paths.backupsRoot);

  const live = liveConfigOf(paths.configFile);
  if (live.kind === "unreadable") return fatalOutcome("repair", "opencode", "cannot read the OpenCode config", live.message);

  const snapshot = resolveSnapshot(paths.backupsRoot, input.backupName);
  if (snapshot.kind === "unusable") return fatalOutcome("repair", "opencode", "cannot read a recorded config", snapshot.message);

  const snapshotName = path.basename(snapshot.directory);
  const restorable = keysRecordedButMissing(snapshot.recorded, live.document);
  if (restorable.length === 0) {
    const settled = `nothing to repair: ${paths.configFile} already holds every key ${snapshotName} recorded`;
    return snapshotOutcome(snapshotName, [], settled);
  }
  const blocked = restoreBlockedBy(live.document, restorable);
  if (blocked !== undefined) {
    const detail = `${paths.configFile} holds a non-object where ${blocked} would be written back`;
    return fatalOutcome("repair", "opencode", "cannot write a recorded key back", detail);
  }
  if (!input.assumeYes) return requiresYesOutcome("repair", "opencode");

  writeJsonFile(paths.configFile, withRestoredKeys(live.document, restorable));
  const namedKeys = [
    `these keys are in ${snapshotName} and missing from ${paths.configFile}:`,
    ...restorable.map(({ keyPath, value }) => `  ${keyPath} = ${JSON.stringify(value)}`),
    "restart OpenCode to load the repaired config",
  ];
  return snapshotOutcome(snapshotName, namedKeys, `returned ${restorable.length} key(s) to ${paths.configFile}`);
}

function snapshotOutcome(snapshotName: string, infoLines: readonly string[], note: string): CommandOutcome {
  const lines = [`snapshot: ${snapshotName}`, ...infoLines];
  return { report: renderCommandReport("repair", "opencode", lines, [wiringOk("operator config keys", note)]), exitCode: 0 };
}

function backupListingOutcome(backupsRoot: string): CommandOutcome {
  const snapshots = snapshotsHoldingAConfig(backupsRoot);
  const listing = snapshots.map((backup) => `${path.basename(backup)}\t${backupSizeKib(backup)} KiB`);
  const note =
    snapshots.length === 0
      ? `no install-opencode.sh backup under ${backupsRoot} holds a config to repair from`
      : `${snapshots.length} snapshot(s) under ${backupsRoot}`;
  return { report: renderCommandReport("repair", "opencode", listing, [wiringOk("install backups holding a config", note)]), exitCode: 0 };
}

type LiveConfig = Readonly<{ kind: "readable"; document: ConfigDocument } | { kind: "unreadable"; message: string }>;

function liveConfigOf(configFile: string): LiveConfig {
  if (!isReadableRegularFile(configFile)) {
    return { kind: "unreadable", message: `there is no OpenCode config to repair at ${configFile}` };
  }
  const document = readableJsonDocument(configFile);
  if (document === undefined) return { kind: "unreadable", message: `the live OpenCode config is not valid JSON: ${configFile}` };
  return { kind: "readable", document };
}

type ResolvedSnapshot = Readonly<
  { kind: "usable"; directory: string; recorded: ConfigDocument } | { kind: "unusable"; message: string }
>;

function resolveSnapshot(backupsRoot: string, backupName: string | undefined): ResolvedSnapshot {
  const located = backupName === undefined ? newestSnapshot(backupsRoot) : namedSnapshot(backupsRoot, backupName);
  if (located.kind === "unusable") return located;
  const recorded = readableJsonDocument(recordedConfigOf(located.directory));
  if (recorded === undefined) {
    return {
      kind: "unusable",
      message: `the config recorded in ${located.directory} is not valid JSON, so nothing can be read back from it`,
    };
  }
  return { kind: "usable", directory: located.directory, recorded };
}

type LocatedSnapshot = Readonly<{ kind: "located"; directory: string } | { kind: "unusable"; message: string }>;

function newestSnapshot(backupsRoot: string): LocatedSnapshot {
  const newest = snapshotsHoldingAConfig(backupsRoot)[0];
  if (newest === undefined) {
    return { kind: "unusable", message: `no install-opencode.sh backup under ${backupsRoot} holds a config to repair from` };
  }
  return { kind: "located", directory: newest };
}

function namedSnapshot(backupsRoot: string, backupName: string): LocatedSnapshot {
  if (backupName.includes("/") || backupName === "." || backupName === "..") {
    return { kind: "unusable", message: `backup name must be a bare directory name: ${backupName}` };
  }
  const directory = path.join(backupsRoot, backupName);
  if (!installBackupDeclares(directory, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL)) {
    return { kind: "unusable", message: `not an install-opencode.sh backup: ${directory}` };
  }
  if (!isReadableRegularFile(recordedConfigOf(directory))) {
    return { kind: "unusable", message: `that backup holds no opencode.json to repair from: ${directory}` };
  }
  return { kind: "located", directory };
}

function recordedConfigOf(backup: string): string {
  return path.join(backup, "items", CONFIG_BACKUP_LABEL);
}

function readableJsonDocument(file: string): ConfigDocument | undefined {
  try {
    const value = readJsonFile(file);
    return isPlainObject(value) ? value : undefined;
  } catch (error) {
    if (error instanceof JsonParseError) return undefined;
    throw error;
  }
}

function objectAt(document: ConfigDocument, keyPath: readonly string[]): ConfigDocument {
  let cursor: unknown = document;
  for (const name of keyPath) {
    cursor = isPlainObject(cursor) ? cursor[name] : undefined;
    if (!isPlainObject(cursor)) return {};
  }
  return isPlainObject(cursor) ? cursor : {};
}

function namesANestedContainer(keyPath: readonly string[]): boolean {
  return REPAIRABLE_NESTED_PATHS.some((nested) => nested.length === keyPath.length && nested.every((name, index) => name === keyPath[index]));
}

function withoutTrailingBlankLines(content: string): string {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  while (records.length > 0 && AWK_BLANK_LINE.test(records.at(-1) as string)) records.pop();
  return records.length === 0 ? "" : `${records.join("\n")}\n`;
}

function malformedMarkersMessage(globalFile: string): string {
  return `the existing global guidance has malformed oso-code markers: ${globalFile} (repair the marker pair, then re-run)`;
}
