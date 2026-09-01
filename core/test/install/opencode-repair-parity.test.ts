import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { repairOpenCode } from "../../src/install/opencode.ts";
import { operatorConfigSeed, operatorGlobalSeed } from "../../src/install/verify-opencode.ts";
import {
  copyFixtureHome,
  fixtureEnvironment,
  fixturePathWith,
  runInOpenCodeFixture,
  stageInstalledFixture,
  type StagedFixture,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-repair-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const THE_REPAIR_CORPUS =
  "one fixture HOME staged by oso install --host opencode --yes --no-impeccable --no-git-hook over a seeded operator " +
  "opencode.json and AGENTS.md, copied once per leg and then repaired by core/src/install/opencode.ts's repairOpenCode " +
  "behind an opencode shim first on the fixture PATH, so no leg reaches an installed host binary";

const DROPPED_KEYS = ["theme", "permission.read", `mcp.${operatorMcpServerName()}`] as const;

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  `the repair corpus is ${THE_REPAIR_CORPUS}, over the ${DROPPED_KEYS.length} operator key(s) each leg drops before repairing`,
  DROPPED_KEYS.length === 3,
  "no operator key is dropped before the repair, so a repair that restored nothing would read the same as one that restored everything",
);

describe("oso repair --host opencode: the driven loop over a fixture whose operator keys were dropped", () => {
  test("the repair restores exactly the keys the fixture dropped, in the order the seed spelled them", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.exitCode, 0);
    assert.deepEqual(driven.port.restoredKeys, [...DROPPED_KEYS]);
  });

  test("the report counts the keys it names and reads the snapshot it repaired from", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.keyCount, DROPPED_KEYS.length);
    assert.match(driven.port.snapshotName, /^install-backup-\d{8}-\d{6}-\d+$/);
  });

  test("the repaired config carries every dropped key back, so the count above is not a report agreeing with itself", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const driven = drivenRepair();
    const document = JSON.parse(driven.port.configText) as Record<string, Record<string, unknown>>;
    assert.ok("theme" in document);
    assert.ok("read" in (document["permission"] as Record<string, unknown>));
    assert.ok(operatorMcpServerName() in (document["mcp"] as Record<string, unknown>));
  });

  test("the report is the port's own grammar throughout, never the bracket form the command verbs diverge from", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.report.split("\n")[0], "oso repair --host opencode");
    assert.match(driven.port.report, /^wiring summary:$/m);
    assert.match(driven.port.report, /^wired: 1, failed: 0$/m);
    assert.doesNotMatch(driven.port.report, /\[oso-code\]/);
  });

  test("a second run over the repaired fixture reports nothing to repair", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const driven = drivenRepair();
    const again = repairOpenCode(portInput(driven.portFixture, { assumeYes: true }));
    assert.equal(again.exitCode, 0);
    assert.match(again.report, /nothing to repair/);
  });
});

describe("oso repair --host opencode: every refusal it carries, by exit and by the words it refuses with", () => {
  for (const [label, damage, message] of [
    ["no config at all", (fixture: StagedFixture) => rmSync(fixture.configFile), "there is no OpenCode config to repair at"],
    ["a live config that is not JSON", (fixture: StagedFixture) => writeFileSync(fixture.configFile, "{ not json"), "is not valid JSON"],
    [
      "a snapshot with no recorded config",
      (fixture: StagedFixture) => rmSync(recordedConfigIn(fixture), { force: true }),
      "holds a config to repair from",
    ],
  ] as const) {
    test(`${label}: refused at exit 1 with the reason this suite spells`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const fixture = freshLeg(label);
      damage(fixture);
      const port = repairOpenCode(portInput(fixture, { assumeYes: true }));
      assert.equal(port.exitCode, 1);
      assert.match(port.report, new RegExp(message));
    });
  }

  for (const [label, backupName] of [
    ["a path separator", "../elsewhere"],
    ["the current directory", "."],
    ["the parent directory", ".."],
  ] as const) {
    test(`a backup name that is ${label} is refused before any directory is read`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const fixture = freshLeg(`bare-name-${label}`);
      const port = repairOpenCode(portInput(fixture, { assumeYes: true, backupName }));
      assert.equal(port.exitCode, 1);
      assert.match(port.report, new RegExp(`backup name must be a bare directory name: ${escapeForPattern(backupName)}`));
    });
  }

  test("a named directory that declares no OpenCode install backup is refused", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const fixture = freshLeg("not-a-backup");
    mkdirSync(path.join(fixture.home, ".local", "state", "oso-code", "install-backup-20200101-000000-1"), { recursive: true });
    const port = repairOpenCode(portInput(fixture, { assumeYes: true, backupName: "install-backup-20200101-000000-1" }));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /not an OpenCode install backup/);
  });

  test("--list names every snapshot the fixture's own install left behind", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const fixture = freshLeg("listing");
    const port = repairOpenCode(portInput(fixture, { assumeYes: false, listBackups: true }));
    assert.equal(port.exitCode, 0);
    const staged = readdirSync(path.join(fixture.home, ".local", "state", "oso-code")).filter((entry) => entry.startsWith("install-backup-"));
    assert.ok(staged.length > 0, `the fixture install left no snapshot under ${fixture.home}`);
    for (const name of staged) assert.match(port.report, new RegExp(name));
  });

  test("an XDG_CONFIG_HOME that is not the home's own is refused at exit 2, before any config is read", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const fixture = freshLeg("decoy-config-home");
    const decoy = path.join(sandbox, "legs", "decoy-config-home", "decoy");
    mkdirSync(path.join(decoy, "opencode"), { recursive: true });
    writeFileSync(path.join(decoy, "opencode", "opencode.json"), '{"theme":"decoy"}\n');
    const port = repairOpenCode({
      ...portInput(fixture, { assumeYes: true }),
      environment: { ...fixtureEnvironment(fixture.home, process.env["PATH"] ?? "", sandbox), XDG_CONFIG_HOME: decoy },
    });
    assert.equal(port.exitCode, 2);
    assert.match(port.report, /is not the default for HOME/);
    assert.equal(readFileSync(path.join(decoy, "opencode", "opencode.json"), "utf8"), '{"theme":"decoy"}\n');
  });

  test("a live config holding a value where a container belongs is refused rather than half-written", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const leg = freshLeg("blocked-port");
    blockTheContainer(leg);
    const before = readFileSync(leg.configFile, "utf8");
    const port = repairOpenCode(portInput(leg, { assumeYes: true }));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /cannot write a recorded key back: .* holds a non-object where permission.read would be written back/);
    assert.equal(readFileSync(leg.configFile, "utf8"), before);
  });

  test("an unknown flag is a usage error at exit 1, through the CLI the wrapper spawns", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const fixture = freshLeg("unknown-flag");
    const port = runInOpenCodeFixture(fixture.home, fixturePathWith(fixture.shims), sandbox, [
      process.execPath,
      path.join(repositoryRoot, "bootstrap", "oso.js"),
      "repair",
      "--host",
      "opencode",
      "--nonsense",
    ]);
    assert.equal(port.status, 1);
    assert.match(port.stderr, /^usage: oso <install\|verify\|repair\|purge>/);
  });

  test("repair without --yes reports it needs --yes rather than prompting", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const fixture = freshLeg("no-yes");
    dropOperatorKeys(fixture);
    const port = repairOpenCode(portInput(fixture, { assumeYes: false }));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /requires --yes in this slice/);
    assert.equal(readFileSync(fixture.configFile, "utf8").includes(operatorMcpServerName()), false);
  });
});

let staged: StagedFixture | undefined;

function stagedFixture(): StagedFixture {
  if (staged !== undefined) return staged;
  staged = stageInstalledFixture(sandbox, {
    config: `${JSON.stringify(operatorConfigSeed(), null, 2)}\n`,
    global: operatorGlobalSeed(),
  });
  return staged;
}

function freshLeg(label: string): StagedFixture {
  return copyFixtureHome(stagedFixture(), path.join(sandbox, "legs", label.replaceAll(/[^a-z0-9]+/gi, "-")));
}

type RepairLeg = Readonly<{ report: string; configText: string; restoredKeys: string[]; keyCount: number; snapshotName: string; exitCode: number }>;

type DrivenRepair = Readonly<{ port: RepairLeg; portFixture: StagedFixture }>;

let driven: DrivenRepair | undefined;

function drivenRepair(): DrivenRepair {
  if (driven !== undefined) return driven;
  const portFixture = freshLeg("port");
  dropOperatorKeys(portFixture);
  const portRun = repairOpenCode(portInput(portFixture, { assumeYes: true }));
  driven = {
    portFixture,
    port: {
      report: portRun.report,
      configText: readFileSync(portFixture.configFile, "utf8"),
      restoredKeys: keysNamedIn(portRun.report),
      keyCount: countNamedIn(portRun.report),
      snapshotName: snapshotNameIn(portRun.report),
      exitCode: portRun.exitCode,
    },
  };
  return driven;
}

function portInput(fixture: StagedFixture, options: Readonly<{ assumeYes: boolean; listBackups?: boolean; backupName?: string }>) {
  return {
    homeDirectory: fixture.home,
    environment: fixtureEnvironment(fixture.home, process.env["PATH"] ?? "", sandbox),
    assumeYes: options.assumeYes,
    listBackups: options.listBackups,
    backupName: options.backupName,
  };
}

function blockTheContainer(fixture: StagedFixture): void {
  const document = JSON.parse(readFileSync(fixture.configFile, "utf8")) as Record<string, unknown>;
  document["permission"] = "not-an-object";
  writeFileSync(fixture.configFile, `${JSON.stringify(document, null, 2)}\n`);
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dropOperatorKeys(fixture: StagedFixture): void {
  const document = JSON.parse(readFileSync(fixture.configFile, "utf8")) as Record<string, Record<string, unknown>>;
  delete document["theme"];
  delete (document["permission"] as Record<string, unknown>)["read"];
  delete (document["mcp"] as Record<string, unknown>)[operatorMcpServerName()];
  writeFileSync(fixture.configFile, `${JSON.stringify(document, null, 2)}\n`);
}

function recordedConfigIn(fixture: StagedFixture): string {
  const backupsRoot = path.join(fixture.home, ".local", "state", "oso-code");
  const backup = readdirSync(backupsRoot).find((entry) => entry.startsWith("install-backup-"));
  assert.ok(backup !== undefined, `no install backup under ${backupsRoot}`);
  return path.join(backupsRoot, backup, "items", "config");
}

function keysNamedIn(report: string): string[] {
  return report
    .split("\n")
    .filter((line) => /^ {2}\S+ = /.test(line))
    .map((line) => line.trim().split(" = ")[0] as string);
}

function countNamedIn(report: string): number {
  return Number(/returned (\d+) key\(s\)/.exec(report)?.[1] ?? -1);
}

function snapshotNameIn(report: string): string {
  return /(install-backup-\d{8}-\d{6}-\d+)/.exec(report)?.[1] ?? "no snapshot named";
}

function operatorMcpServerName(): string {
  return Object.keys((operatorConfigSeed()["mcp"] ?? {}) as Record<string, unknown>)[0] as string;
}
