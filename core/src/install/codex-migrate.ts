import { readFileSync, writeFileSync } from "node:fs";
import { backupTarget, beginTransaction, commitManifest, rollback, type BackupTransaction } from "./backup.ts";
import { renderOsoPermissionProfile, tomlQuote, workspaceRootsTheOsoProfileDeclares, type OsoPermissionProfile } from "./codex-config.ts";
import { type CodexHostProbes } from "./codex-host.ts";
import { isRecord } from "./codex-payload.ts";
import { blocksJoined, codexPathsFor, HOST_REJECTED_CONFIG, pinnedVersionOutcome, tableHeadersOf, type CodexPaths } from "./codex.ts";
import { fatalOutcome, messageOf, renderCommandReport, requiresYesOutcome, restoreNoteOf, wiringOk, type CommandOutcome } from "./report.ts";
import { parseTomlDocument, TomlParseError } from "./toml.ts";
import { recordsOf, runTomlRegion } from "./toml-regions.ts";
import { isReadableRegularFile, withOwnerOnlyUmask } from "../state/store.ts";

const CODEX_MIGRATE_BACKUP_FORMAT = "oso-code-codex-migrate-v1";

const LEGACY_DENIED_WORKSPACE_GLOBS = [
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
  "**/.kube/**",
] as const;

export type CodexMigrateInput = Readonly<{
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  host: CodexHostProbes;
  assumeYes: boolean;
}>;

export type CodexPermissionMigration =
  | Readonly<{ kind: "migrated"; rewrittenText: string }>
  | Readonly<{ kind: "already-migrated" }>
  | Readonly<{ kind: "no-profile" }>
  | Readonly<{ kind: "operator-edited" }>
  | Readonly<{ kind: "unparseable"; detail: string }>;

export function migrateCodex(input: CodexMigrateInput): CommandOutcome {
  return withOwnerOnlyUmask(() => writeCodexMigration(input));
}

function writeCodexMigration(input: CodexMigrateInput): CommandOutcome {
  if (!input.assumeYes) return requiresYesOutcome("migrate", "codex");
  const unpinned = pinnedVersionOutcome("migrate", input.host);
  if (unpinned !== undefined) return unpinned;
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const existingText = isReadableRegularFile(paths.configFile) ? readFileSync(paths.configFile, "utf8") : "";
  const migration = codexPermissionMigration(existingText, paths.homeDirectory, paths.configFile);
  switch (migration.kind) {
    case "unparseable":
      return fatalOutcome("migrate", "codex", "declined: the Codex config could not be parsed", migration.detail);
    case "no-profile":
      return fatalOutcome("migrate", "codex", "declined: no oso-code permission profile is present to migrate", paths.configFile);
    case "operator-edited":
      return fatalOutcome(
        "migrate",
        "codex",
        "declined: the permission profile matches neither the shape oso-code used to write nor the one it writes today",
        "treating it as the operator's own; touching nothing",
      );
    case "already-migrated":
      return successOutcome([], "already the current oso-code shape; nothing to migrate");
    case "migrated":
      return applyMigration(paths, input.host, migration.rewrittenText);
  }
}

function applyMigration(paths: CodexPaths, host: CodexHostProbes, rewrittenText: string): CommandOutcome {
  let tx: BackupTransaction;
  try {
    tx = beginTransaction(paths.backupsRoot, CODEX_MIGRATE_BACKUP_FORMAT);
    backupTarget(tx, "config", paths.configFile);
    commitManifest(tx);
  } catch (error) {
    return fatalOutcome("migrate", "codex", "could not create the pre-migration backup", messageOf(error));
  }
  try {
    if (!host.acceptsConfig(paths.codexHome, rewrittenText)) throw new Error(HOST_REJECTED_CONFIG);
    writeFileSync(paths.configFile, rewrittenText, { mode: 0o600 });
  } catch (error) {
    return fatalOutcome("migrate", "codex", "could not write the migrated Codex permission profile", messageOf(error), restoreNoteOf(rollback(tx)));
  }
  return successOutcome([`backup: ${tx.backupRoot}`], "migrated to the current oso-code shape");
}

function successOutcome(infoLines: readonly string[], note: string): CommandOutcome {
  return { report: renderCommandReport("migrate", "codex", infoLines, [wiringOk("codex oso permission profile", note)]), exitCode: 0 };
}

export function codexPermissionMigration(existingText: string, targetHome: string, file: string): CodexPermissionMigration {
  let installed: Record<string, unknown>;
  try {
    installed = parseTomlDocument(existingText, file);
  } catch (error) {
    if (!(error instanceof TomlParseError)) throw error;
    return { kind: "unparseable", detail: error.message };
  }
  const installedSlice = osoPermissionSliceOf(installed);
  if (slicesMatch(installedSlice, osoPermissionSliceOf(parsedProfile(renderOsoPermissionProfile(targetHome), file)))) {
    return { kind: "already-migrated" };
  }
  if (slicesMatch(installedSlice, osoPermissionSliceOf(parsedProfile(legacyOsoPermissionProfile(targetHome), file)))) {
    return { kind: "migrated", rewrittenText: migratedConfigText(existingText, targetHome, file) };
  }
  if (installedSlice.defaultPermissions === undefined && installedSlice.osoTable === undefined) return { kind: "no-profile" };
  return { kind: "operator-edited" };
}

type OsoPermissionSlice = Readonly<{ defaultPermissions: unknown; osoTable: unknown }>;

function osoPermissionSliceOf(document: Record<string, unknown>): OsoPermissionSlice {
  const profiles = document["permissions"];
  return { defaultPermissions: document["default_permissions"], osoTable: isRecord(profiles) ? profiles["oso"] : undefined };
}

function slicesMatch(a: OsoPermissionSlice, b: OsoPermissionSlice): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parsedProfile(profile: OsoPermissionProfile, file: string): Record<string, unknown> {
  return parseTomlDocument(`${profile.rootKeys}${profile.tables}`, file);
}

function migratedConfigText(existingText: string, targetHome: string, file: string): string {
  const legacy = legacyOsoPermissionProfile(targetHome);
  const current = renderOsoPermissionProfile(targetHome);
  const crlfHeader = existingText.includes("\r\n") ? "\r" : "";
  const withoutLegacyTables = tableHeadersOf(legacy.tables).reduce((text, header) => {
    const removed = runTomlRegion(text, { action: "remove-table", targetHeader: `${header}${crlfHeader}` });
    if (removed.exitCode !== 0) throw new Error(`${file} declares ${header} more than once; the migration cannot safely remove it`);
    return removed.stdout;
  }, existingText);
  const parts = runTomlRegion(withoutLegacyTables, { action: "split" });
  const root = blocksJoined([withoutDefaultPermissionsLine(parts.root, file), current.rootKeys]);
  const sections = blocksJoined([parts.sections, current.tables]);
  return `${root}${root === "" ? "" : "\n"}${sections}`;
}

function withoutDefaultPermissionsLine(rootText: string, file: string): string {
  const lines = recordsOf(rootText);
  const index = lines.findIndex((line) => lineDeclaresDefaultPermissions(line, file));
  if (index === -1) throw new Error(`${file} does not declare default_permissions at its root; the migration cannot safely remove it`);
  lines.splice(index, 1);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function lineDeclaresDefaultPermissions(line: string, file: string): boolean {
  try {
    return Object.hasOwn(parseTomlDocument(line.replace(/\r$/, ""), file), "default_permissions");
  } catch (error) {
    if (error instanceof TomlParseError) return false;
    throw error;
  }
}

export function legacyOsoPermissionProfile(targetHome: string): OsoPermissionProfile {
  return {
    rootKeys: 'default_permissions = "oso"\n',
    tables: [
      "[permissions.oso]",
      'extends = ":workspace"',
      "",
      'description = "oso-code workspace profile"',
      "",
      "[permissions.oso.workspace_roots]",
      ...workspaceRootsTheOsoProfileDeclares(targetHome).map((root) => `${tomlQuote(root)} = true`),
      "",
      "[permissions.oso.filesystem]",
      "glob_scan_max_depth = 6",
      "",
      '[permissions.oso.filesystem.":workspace_roots"]',
      ...LEGACY_DENIED_WORKSPACE_GLOBS.map((glob) => `"${glob}" = "deny"`),
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
    ].join("\n"),
  };
}
