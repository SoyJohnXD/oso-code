import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { renderOsoPermissionProfile } from "../../src/install/codex-config.ts";
import { codexPermissionMigration, legacyOsoPermissionProfile, migrateCodex, type CodexMigrateInput } from "../../src/install/codex-migrate.ts";
import { codexPathsFor } from "../../src/install/codex.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
import { pinnedHost } from "../support/codex-install-fixture.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-migrate-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));
let counter = 0;

function fixtureHome(): string {
  counter += 1;
  const home = path.join(sandbox, `home-${counter}`);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

function inputFor(home: string, overrides: Partial<CodexMigrateInput> = {}): CodexMigrateInput {
  return { homeDirectory: home, environment: { PATH: "", CODEX_HOME: path.join(home, ".codex") }, host: pinnedHost(), assumeYes: true, ...overrides };
}

function textOf(profile: { rootKeys: string; tables: string }): string {
  return `${profile.rootKeys}\n${profile.tables}`;
}

function osoTableOf(text: string, file: string): unknown {
  return (parseTomlDocument(text, file)["permissions"] as Record<string, unknown>)["oso"];
}

test("a fixture home on a previous release's profile migrates end to end: backed up, rewritten, and the root key travels with its table", () => {
  const home = fixtureHome();
  const paths = codexPathsFor(home, inputFor(home).environment);
  const legacy = textOf(legacyOsoPermissionProfile(home));
  writeFileSync(paths.configFile, legacy);
  const outcome = migrateCodex(inputFor(home));
  assert.equal(outcome.exitCode, 0, outcome.report);
  assert.match(outcome.report, /migrated to the current oso-code shape/);
  const backupLine = outcome.report.split("\n").find((line) => line.startsWith("backup: ")) as string;
  assert.equal(readFileSync(path.join(backupLine.slice("backup: ".length), "items", "config"), "utf8"), legacy);
  const migrated = readFileSync(paths.configFile, "utf8");
  assert.equal(migrated.includes('"**/id_rsa" = "deny"'), false, migrated);
  assert.equal(migrated.includes("glob_scan_max_depth"), false, migrated);
  const document = parseTomlDocument(migrated, paths.configFile);
  assert.equal(document["default_permissions"], "oso");
  assert.deepEqual(osoTableOf(migrated, paths.configFile), osoTableOf(textOf(renderOsoPermissionProfile(home)), paths.configFile));
});

test("operator content around the legacy profile survives the migration byte for byte", () => {
  const home = fixtureHome();
  const document = ['model = "gpt-6-astra"', "", textOf(legacyOsoPermissionProfile(home)), "[history]", 'persistence = "save-all"', ""].join("\n");
  const migration = codexPermissionMigration(document, home, "config.toml");
  assert.equal(migration.kind, "migrated");
  if (migration.kind === "migrated") {
    assert.ok(migration.rewrittenText.includes('model = "gpt-6-astra"'));
    assert.ok(migration.rewrittenText.includes('[history]\npersistence = "save-all"'));
  }
});

test("a CRLF legacy profile migrates instead of throwing, keeps the operator's own carriage returns, and leaves no duplicate table", () => {
  const home = fixtureHome();
  const paths = codexPathsFor(home, inputFor(home).environment);
  const legacyCRLF = ['model = "gpt-6-astra"', "", textOf(legacyOsoPermissionProfile(home)), "[history]", 'persistence = "save-all"', ""]
    .join("\n")
    .replace(/\n/g, "\r\n");
  writeFileSync(paths.configFile, legacyCRLF);
  const outcome = migrateCodex(inputFor(home));
  assert.equal(outcome.exitCode, 0, outcome.report);
  assert.match(outcome.report, /migrated to the current oso-code shape/);
  const migrated = readFileSync(paths.configFile, "utf8");
  assert.ok(migrated.includes('model = "gpt-6-astra"\r\n'), migrated);
  assert.ok(migrated.includes('[history]\r\npersistence = "save-all"\r\n'), migrated);
  assert.equal((migrated.match(/\[permissions\.oso\]/g) ?? []).length, 1, migrated);
  const document = parseTomlDocument(migrated, paths.configFile);
  assert.equal(document["default_permissions"], "oso");
  assert.deepEqual(osoTableOf(migrated, paths.configFile), osoTableOf(textOf(renderOsoPermissionProfile(home)), paths.configFile));
});

test("the already-emptied shape is a fixed point: no write, no backup, no false claim of migration", () => {
  const home = fixtureHome();
  const paths = codexPathsFor(home, inputFor(home).environment);
  const current = textOf(renderOsoPermissionProfile(home));
  writeFileSync(paths.configFile, current);
  const outcome = migrateCodex(inputFor(home));
  assert.equal(outcome.exitCode, 0, outcome.report);
  assert.match(outcome.report, /already the current oso-code shape; nothing to migrate/);
  assert.equal(outcome.report.includes("backup: "), false);
  assert.equal(readFileSync(paths.configFile, "utf8"), current);
  assert.equal(existsSync(paths.backupsRoot) ? readdirSync(paths.backupsRoot).length : 0, 0);
});

test("no oso-code permission profile at all declines cleanly, and a config matching neither shape declines as the operator's own", () => {
  const home = fixtureHome();
  const paths = codexPathsFor(home, inputFor(home).environment);
  writeFileSync(paths.configFile, '[history]\npersistence = "save-all"\n');
  const bare = migrateCodex(inputFor(home));
  assert.equal(bare.exitCode, 1);
  assert.match(bare.report, /declined: no oso-code permission profile is present to migrate/);

  const edited = textOf(renderOsoPermissionProfile(home)).replace('description = "oso-code workspace profile"', 'description = "operator-edited"');
  writeFileSync(paths.configFile, edited);
  const operatorOwned = migrateCodex(inputFor(home));
  assert.equal(operatorOwned.exitCode, 1);
  assert.match(operatorOwned.report, /declined: the permission profile matches neither the shape oso-code used to write nor the one it writes today/);
  assert.equal(readFileSync(paths.configFile, "utf8"), edited);
});

test("a host that rejects the migrated candidate rolls back to the pre-migration bytes", () => {
  const home = fixtureHome();
  const paths = codexPathsFor(home, inputFor(home).environment);
  const legacy = textOf(legacyOsoPermissionProfile(home));
  writeFileSync(paths.configFile, legacy);
  const outcome = migrateCodex(inputFor(home, { host: pinnedHost({ acceptsConfig: () => false }) }));
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.report, /rolled back to the pre-run snapshot/);
  assert.equal(readFileSync(paths.configFile, "utf8"), legacy);
});

test("without --yes it needs --yes, and an unpinned Codex CLI refuses before anything is read", () => {
  const home = fixtureHome();
  assert.match(migrateCodex(inputFor(home, { assumeYes: false })).report, /requires --yes/);
  assert.match(migrateCodex(inputFor(home, { host: pinnedHost({ version: "0.100.0" }) })).report, /is not the pinned one/);
});

test("an unparseable config is reported rather than guessed at", () => {
  const migration = codexPermissionMigration("model = \n", "/home/x", "config.toml");
  assert.equal(migration.kind, "unparseable");
  assert.ok(migration.kind === "unparseable" && migration.detail.length > 0);
});
