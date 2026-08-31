import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { repairOpenCode } from "../../src/install/opencode.ts";
import { operatorConfigSeed, operatorGlobalSeed } from "../../src/install/verify-opencode.ts";
import {
  bashIsAvailable,
  bashRepair,
  copyFixtureHome,
  fixtureEnvironment,
  fixturePathWith,
  runInOpenCodeFixture,
  shimAnsweredArgv,
  stageInstalledFixture,
  SHIM_ANSWERED_CALLS,
  SHIM_UNANSWERED_EXIT,
  type StagedFixture,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { posixSpelled } from "../support/repository-paths.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessBashRunsTheInstallerPipeline } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-repair-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const THE_REPAIR_CORPUS =
  "one fixture HOME staged by bootstrap/install-opencode.sh --yes --no-impeccable --no-git-hook over a seeded operator " +
  "opencode.json and AGENTS.md, copied once per leg and then read by both bootstrap/repair-opencode.sh and " +
  "core/src/install/opencode.ts's repairOpenCode, so neither leg spawns an installed host binary";

const THE_SHIM_CONTRACT =
  `an opencode shim first on the fixture PATH answering --version with the pin and exit ${SHIM_UNANSWERED_EXIT} for ` +
  "everything else, logging every argv it is asked so the answered calls are enumerated rather than assumed — the list " +
  "enumerates the SPAWN SITES this corpus's drives reach, each named by the shell function that spawns it and by the " +
  "one caller this corpus reaches it through, never by every caller that function has";

const DROPPED_KEYS = ["theme", "permission.read", `mcp.${operatorMcpServerName()}`] as const;

const EVERY_CALL_SITE_OF_A_SPAWN_SITE: Readonly<Record<string, Readonly<{ drivenHere: string; outsideThisCorpus: readonly string[] }>>> = {
  probe_opencode_version: { drivenHere: "bootstrap/install-opencode.sh", outsideThisCorpus: [] },
  opencode_version_of: {
    drivenHere: "bootstrap/verify-opencode.sh",
    outsideThisCorpus: ["bootstrap/lib/opencode-verification.sh", "tests/hooks-test.sh", "tests/hooks-test.sh"],
  },
};

provedSomething(
  `the repair parity corpus is ${THE_REPAIR_CORPUS}, driven through ${THE_SHIM_CONTRACT}`,
  SHIM_ANSWERED_CALLS.length > 0 && DROPPED_KEYS.length === 3,
  "the corpus or the shim-answered call list is empty, so the parity claims below compare nothing",
);

describe("the shim answers an enumerated list of calls, so a second question the bash starts consuming goes stale loudly", () => {
  test("every declared call names a bash function that still spawns --version, reached from the caller the list names", () => {
    for (const call of SHIM_ANSWERED_CALLS) {
      const definition = readFileSync(path.join(repositoryRoot, call.definedIn), "utf8");
      assert.ok(definition.includes(`${call.spawnedBy}()`), `${call.definedIn} no longer defines ${call.spawnedBy}`);
      assert.ok(definition.includes(call.argv), `${call.spawnedBy} no longer spawns ${call.argv}`);
      const caller = readFileSync(path.join(repositoryRoot, call.callerScript), "utf8");
      assert.ok(caller.includes(`${call.callerFunction}()`), `${call.callerScript} no longer defines ${call.callerFunction}`);
      assert.ok(caller.includes(call.spawnedBy), `${call.callerFunction} no longer reaches ${call.spawnedBy}`);
    }
  });

  test("driving the bash install answers exactly the calls the list declares for it, and no others", { skip: skipUnlessBash() }, () => {
    stagedFixture();
    const answered = shimAnsweredArgv(path.join(sandbox, "shim-calls.log"));
    const declaredForInstall = SHIM_ANSWERED_CALLS.filter((call) => call.callerScript === "bootstrap/install-opencode.sh");
    assert.deepEqual(answered, declaredForInstall.map((call) => call.argv));
  });

  for (const [spawnedBy, callSites] of Object.entries(EVERY_CALL_SITE_OF_A_SPAWN_SITE)) {
    test(`${spawnedBy}'s call sites are read from the shell itself, so the list's completeness is over spawn sites and not over callers`, () => {
      assert.deepEqual(callSitesOf(spawnedBy).sort(), [callSites.drivenHere, ...callSites.outsideThisCorpus].sort());
      const driven = SHIM_ANSWERED_CALLS.filter((call) => call.spawnedBy === spawnedBy).map((call) => call.callerScript);
      assert.deepEqual(driven, [callSites.drivenHere]);
    });
  }

  test("the list carries one question over the two spawn sites this corpus drives, and the shim refuses everything else", () => {
    assert.deepEqual([...new Set(SHIM_ANSWERED_CALLS.map((call) => call.argv))], ["--version"]);
    assert.deepEqual(SHIM_ANSWERED_CALLS.map((call) => call.callerScript), [
      "bootstrap/install-opencode.sh",
      "bootstrap/verify-opencode.sh",
    ]);
    assert.equal(SHIM_UNANSWERED_EXIT, 64);
  });
});

describe("oso repair --host opencode: the driven loop through both implementations over the same fixture", () => {
  test("both legs write byte-identical opencode.json bytes", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.configText, driven.bash.configText, sideBySide(driven.port.configText, driven.bash.configText));
  });

  test("both legs return the same exit code and name the same restored keys, in the same order", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.exitCode, driven.bash.exitCode);
    assert.deepEqual(driven.port.restoredKeys, driven.bash.restoredKeys);
    assert.deepEqual(driven.port.restoredKeys, [...DROPPED_KEYS]);
  });

  test("both legs report the same key count and read the same snapshot name", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    assert.equal(driven.port.keyCount, driven.bash.keyCount);
    assert.equal(driven.port.snapshotName, driven.bash.snapshotName);
  });

  test("a port that returned one key fewer is caught, so the agreement above is not two empty lists", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    assert.notDeepEqual(driven.port.restoredKeys.slice(1), driven.bash.restoredKeys);
    assert.ok(driven.bash.restoredKeys.length > 0, "the bash leg restored nothing, so nothing was compared");
  });

  test("the two reports carry the same facts in different GRAMMARS, which is the divergence C3-D2 leaves open for the command verbs", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    assert.deepEqual(driven.port.restoredKeys, driven.bash.restoredKeys);
    for (const line of driven.bash.report.split("\n").filter((candidate) => candidate !== "")) {
      assert.ok(line.startsWith("[oso-code] ") || line.startsWith("  "), `the bash report line ${JSON.stringify(line)} is not one of its own two shapes`);
    }
    assert.equal(driven.port.report.split("\n")[0], "oso repair --host opencode");
    assert.match(driven.port.report, /^wiring summary:$/m);
    assert.match(driven.port.report, /^wired: 1, failed: 0$/m);
    assert.doesNotMatch(driven.port.report, /\[oso-code\]/);
    assert.doesNotMatch(driven.bash.report, /wiring summary|^oso repair/m);
  });

  test("a second run over each repaired leg reports nothing to repair, through both implementations", { skip: skipUnlessBash() }, () => {
    const driven = drivenRepair();
    const bashAgain = bashRepair(driven.bashFixture, sandbox, ["--yes"]);
    const portAgain = repairOpenCode(portInput(driven.portFixture, { assumeYes: true }));
    assert.equal(bashAgain.status, 0, bashAgain.stderr);
    assert.equal(portAgain.exitCode, 0);
    assert.match(bashAgain.stdout, /nothing to repair/);
    assert.match(portAgain.report, /nothing to repair/);
  });
});

describe("oso repair --host opencode: every refusal the bash carries, with the same words", () => {
  for (const [label, damage, message] of [
    ["no config at all", (fixture: StagedFixture) => rmSync(fixture.configFile), "there is no OpenCode config to repair at"],
    ["a live config that is not JSON", (fixture: StagedFixture) => writeFileSync(fixture.configFile, "{ not json"), "is not valid JSON"],
    [
      "a snapshot with no recorded config",
      (fixture: StagedFixture) => rmSync(recordedConfigIn(fixture), { force: true }),
      "holds a config to repair from",
    ],
  ] as const) {
    test(`${label}: both legs refuse at the same exit with the same reason`, { skip: skipUnlessBash() }, () => {
      const fixture = freshLeg(label);
      damage(fixture);
      const bash = bashRepair(fixture, sandbox, ["--yes"]);
      const port = repairOpenCode(portInput(fixture, { assumeYes: true }));
      assert.notEqual(bash.status, 0);
      assert.equal(port.exitCode, 1);
      assert.match(bash.stderr, new RegExp(message));
      assert.match(port.report, new RegExp(message));
    });
  }

  for (const [label, backupName] of [
    ["a path separator", "../elsewhere"],
    ["the current directory", "."],
    ["the parent directory", ".."],
  ] as const) {
    test(`a backup name that is ${label} is refused by both, before any directory is read`, { skip: skipUnlessBash() }, () => {
      const fixture = freshLeg(`bare-name-${label}`);
      const bash = bashRepair(fixture, sandbox, ["--yes", backupName]);
      const port = repairOpenCode(portInput(fixture, { assumeYes: true, backupName }));
      assert.notEqual(bash.status, 0);
      assert.equal(port.exitCode, 1);
      assert.match(bash.stderr, new RegExp(`backup name must be a bare directory name: ${escapeForPattern(backupName)}`));
      assert.match(port.report, new RegExp(`backup name must be a bare directory name: ${escapeForPattern(backupName)}`));
    });
  }

  test("a named backup that is not an install-opencode.sh snapshot is refused by both", { skip: skipUnlessBash() }, () => {
    const fixture = freshLeg("not-a-backup");
    mkdirSync(path.join(fixture.home, ".local", "state", "oso-code", "install-backup-20200101-000000-1"), { recursive: true });
    const bash = bashRepair(fixture, sandbox, ["--yes", "install-backup-20200101-000000-1"]);
    const port = repairOpenCode(portInput(fixture, { assumeYes: true, backupName: "install-backup-20200101-000000-1" }));
    assert.notEqual(bash.status, 0);
    assert.equal(port.exitCode, 1);
    assert.match(bash.stderr, /not an install-opencode\.sh backup/);
    assert.match(port.report, /not an install-opencode\.sh backup/);
  });

  test("--list names the same snapshots through both implementations", { skip: skipUnlessBash() }, () => {
    const fixture = freshLeg("listing");
    const bash = bashRepair(fixture, sandbox, ["--list"]);
    const port = repairOpenCode(portInput(fixture, { assumeYes: false, listBackups: true }));
    assert.equal(bash.status, 0, bash.stderr);
    assert.equal(port.exitCode, 0);
    const named = bash.stdout.split("\n").filter((line) => line.startsWith("install-backup-")).map((line) => line.split("\t")[0]);
    assert.ok(named.length > 0, `the bash listing named no snapshot: ${bash.stdout}`);
    for (const name of named) assert.match(port.report, new RegExp(name as string));
  });

  test("an XDG_CONFIG_HOME that is not the home's own is refused at exit 2 by both, before any config is read", { skip: skipUnlessBash() }, () => {
    const fixture = freshLeg("decoy-config-home");
    const decoy = path.join(sandbox, "legs", "decoy-config-home", "decoy");
    mkdirSync(path.join(decoy, "opencode"), { recursive: true });
    writeFileSync(path.join(decoy, "opencode", "opencode.json"), '{"theme":"decoy"}\n');
    const bash = runInOpenCodeFixture(fixture.home, fixturePathWith(fixture.shims), sandbox, [
      "bash",
      path.join(repositoryRoot, "bootstrap", "repair-opencode.sh"),
      "--yes",
    ], { XDG_CONFIG_HOME: decoy });
    const port = repairOpenCode({
      ...portInput(fixture, { assumeYes: true }),
      environment: { ...fixtureEnvironment(fixture.home, process.env["PATH"] ?? "", sandbox), XDG_CONFIG_HOME: decoy },
    });
    assert.equal(bash.status, 2);
    assert.equal(port.exitCode, 2);
    assert.match(bash.stderr, /is not the default for HOME/);
    assert.match(port.report, /is not the default for HOME/);
    assert.equal(readFileSync(path.join(decoy, "opencode", "opencode.json"), "utf8"), '{"theme":"decoy"}\n');
  });

  test("a live config holding a value where a container belongs is refused by the port, where the bash promises the repair and then throws", { skip: skipUnlessBash() }, () => {
    const bashLeg = freshLeg("blocked-bash");
    const portLeg = freshLeg("blocked-port");
    for (const leg of [bashLeg, portLeg]) blockTheContainer(leg);
    const beforeBash = readFileSync(bashLeg.configFile, "utf8");
    const beforePort = readFileSync(portLeg.configFile, "utf8");

    const bash = bashRepair(bashLeg, sandbox, ["--yes"]);
    const port = repairOpenCode(portInput(portLeg, { assumeYes: true }));

    assert.equal(bash.status, 1);
    assert.match(bash.stdout, /these keys are in .* and missing from /);
    assert.match(bash.stderr, /TypeError: 'str' object does not support item assignment/);
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /cannot write a recorded key back: .* holds a non-object where permission.read would be written back/);
    assert.equal(readFileSync(bashLeg.configFile, "utf8"), beforeBash);
    assert.equal(readFileSync(portLeg.configFile, "utf8"), beforePort);
  });

  test("an unknown flag is a usage error through both, at the exits each already carries: the bash 2, the port 1 (C3-S4 divergence 4)", { skip: skipUnlessBash() }, () => {
    const fixture = freshLeg("unknown-flag");
    const bash = bashRepair(fixture, sandbox, ["--nonsense"]);
    const port = runInOpenCodeFixture(fixture.home, fixturePathWith(fixture.shims), sandbox, [
      process.execPath,
      path.join(repositoryRoot, "bootstrap", "oso.js"),
      "repair",
      "--host",
      "opencode",
      "--nonsense",
    ]);
    assert.equal(bash.status, 2);
    assert.match(bash.stderr, /unknown flag: --nonsense/);
    assert.equal(port.status, 1);
    assert.match(port.stderr, /^usage: oso <install\|verify\|repair\|purge>/);
  });

  test("repair without --yes reports it needs --yes rather than prompting, where the bash would read from the terminal", { skip: skipUnlessBash() }, () => {
    const fixture = freshLeg("no-yes");
    dropOperatorKeys(fixture);
    const port = repairOpenCode(portInput(fixture, { assumeYes: false }));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /requires --yes in this slice/);
    assert.equal(readFileSync(fixture.configFile, "utf8").includes(operatorMcpServerName()), false);
  });
});

const SHELL_SOURCE_DIRECTORIES = ["bootstrap", "tests"] as const;

function callSitesOf(shellFunction: string): string[] {
  const called = new RegExp(String.raw`(^|[^\w.-])${shellFunction}(\s|"|\)|$)`);
  return shellSources().flatMap((relative) =>
    readFileSync(path.join(repositoryRoot, relative), "utf8")
      .split("\n")
      .filter((line) => called.test(line) && !line.includes(`${shellFunction}()`))
      .map(() => relative),
  );
}

function shellSources(): string[] {
  return SHELL_SOURCE_DIRECTORIES.flatMap((directory) =>
    readdirSync(path.join(repositoryRoot, directory), { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".sh"))
      .map((entry) => `${directory}/${posixSpelled(entry)}`)
      .sort(),
  );
}

function skipUnlessBash(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  if (!bashIsAvailable()) return "bash cannot be spawned here, so bootstrap/repair-opencode.sh cannot be driven as the oracle";
  return false;
}

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

type DrivenRepair = Readonly<{ bash: RepairLeg; port: RepairLeg; bashFixture: StagedFixture; portFixture: StagedFixture }>;

let driven: DrivenRepair | undefined;

function drivenRepair(): DrivenRepair {
  if (driven !== undefined) return driven;
  const bashFixture = freshLeg("bash");
  const portFixture = freshLeg("port");
  dropOperatorKeys(bashFixture);
  dropOperatorKeys(portFixture);

  const bashRun = bashRepair(bashFixture, sandbox, ["--yes"]);
  assert.equal(bashRun.status, 0, `${bashRun.stdout}${bashRun.stderr}`);
  const portRun = repairOpenCode(portInput(portFixture, { assumeYes: true }));

  driven = {
    bashFixture,
    portFixture,
    bash: {
      report: bashRun.stdout,
      configText: readFileSync(bashFixture.configFile, "utf8"),
      restoredKeys: keysNamedIn(bashRun.stdout),
      keyCount: countNamedIn(bashRun.stdout),
      snapshotName: snapshotNameIn(bashRun.stdout),
      exitCode: bashRun.status,
    },
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

function sideBySide(port: string, bash: string): string {
  const bashLines = bash.split("\n");
  return port
    .split("\n")
    .map((line, index) => `${line === bashLines[index] ? "  " : "!!"} port=${JSON.stringify(line)} bash=${JSON.stringify(bashLines[index])}`)
    .join("\n");
}
