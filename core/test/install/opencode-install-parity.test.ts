import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { installBackupsDeclaring } from "../../src/install/backup.ts";
import { OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL } from "../../src/install/opencode.ts";
import { installOpenCode, openCodePayloadSources, PRESERVED_KEYS_FILE } from "../../src/install/opencode-install.ts";
import { opencodePathsFor } from "../../src/install/opencode.ts";
import { openCodeTrustReading, publishedGateScriptNames } from "../../src/install/opencode-trust.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { operatorConfigSeed, operatorGlobalSeed } from "../../src/install/verify-opencode.ts";
import {
  entryWithHomeSpelledOnce,
  fixtureEnvironment,
  fixturePathWith,
  shimAnsweredArgv,
  treeUnder,
  writeOpenCodeShims,
  type TreeEntry,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-install-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const BACKUP_STAMP = /install-backup-\d{8}-\d{6}-\d+/g;
const PRESERVED_OPERATOR_KEYS = ["theme", "permission.read", "mcp.oso-verify-operator-server"];

const THE_INSTALL_CORPUS =
  "one seeded operator config and AGENTS.md in a fixture HOME, installed once by installOpenCode and then read back as a " +
  "whole tree whose SIZE, presence of a directory entry and presence of an owner-only mode this file asserts — never its " +
  "entry names, which the verify artifact rows compare against the published sources — beside the operator keys preserved, " +
  "the one backup recorded, and the gate subtree read against the published hashes, on a PATH built by filtering every " +
  "directory holding an opencode executable out of the ambient one and prepending the shim, so the drive can reach no " +
  "installed host binary";

const shims = writeOpenCodeShims(path.join(sandbox, "shims"), path.join(sandbox, "shim-calls.log"));

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  `the install corpus is ${THE_INSTALL_CORPUS}`,
  publishedGateScriptNames(openCodePayloadSources(repositoryRoot).publishedHashes).length > 0,
  "bootstrap/hook-hashes.txt published no gate script, so an install that copied nothing would read the same as one that copied everything",
);

describe("install --host opencode leaves the tree its seed and the published hashes describe", () => {
  test("the installed tree carries directories and owner-only modes, so what follows is read through kind and mode rather than bytes alone", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const installed = installedByThePort();
    assert.ok(installed.tree.length > 40, `${installed.tree.length} entries were read`);
    assert.ok(installed.tree.some((entry) => entry.kind === "directory"));
    assert.ok(installed.tree.some((entry) => entry.mode === "0700"));
  });

  test("the operator keys preserved are the three the seed declares, in the seed's own order", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    assert.deepEqual(installedByThePort().preservedKeys, PRESERVED_OPERATOR_KEYS);
  });

  test("exactly one install backup is recorded, declaring the OpenCode format and label", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    assert.equal(installedByThePort().snapshots.length, 1);
  });

  test("the installed gate tree is covered completely by the published hashes", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const reading = openCodeTrustReading(
      openCodePayloadSources(repositoryRoot).publishedHashes,
      "installed",
      configHomeOf(installedByThePort().home),
    );
    assert.deepEqual(reading.divergences, []);
  });

  test("the install answers the host-version question without spawning anything, which the shim's own log is what proves", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const installed = installedByThePort();
    assert.deepEqual(shimAnsweredArgv(path.join(installed.root, "shim-calls.log")), []);
    assert.equal(installed.exitCode, 0);
  });
});

describe("the refusals the install reaches before it writes anything, by exit and by subject", () => {
  test("an install pointed outside the named home is a usage error, and the decoy is untouched", () => {
    const root = path.join(sandbox, "decoy-home");
    const home = seedFixtureHome(root);
    const decoy = path.join(root, "decoy");
    mkdirSync(path.join(decoy, "opencode"), { recursive: true });
    writeFileSync(path.join(decoy, "opencode", "opencode.json"), '{"theme":"decoy"}\n');

    const port = installOpenCode(portInput(home, root, { XDG_CONFIG_HOME: decoy }));
    assert.equal(port.exitCode, 2);
    assert.equal(readFileSync(path.join(decoy, "opencode", "opencode.json"), "utf8"), '{"theme":"decoy"}\n');
  });

  test("an existing config that is not JSON refuses, and the file is left as it was", () => {
    const root = path.join(sandbox, "unparseable-config");
    const home = seedFixtureHome(root);
    const configFile = path.join(configHomeOf(home), "opencode.json");
    writeFileSync(configFile, "{ not json\n");
    const port = installOpenCode(portInput(home, root));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /is not valid JSON/);
    assert.equal(readFileSync(configFile, "utf8"), "{ not json\n");
  });

  test("a global guidance file with malformed markers refuses", () => {
    const root = path.join(sandbox, "malformed-global");
    const home = seedFixtureHome(root);
    writeFileSync(path.join(configHomeOf(home), "AGENTS.md"), "<!-- oso-code:end -->\n<!-- oso-code:start -->\n");
    const port = installOpenCode(portInput(home, root));
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /malformed oso-code markers/);
  });

  test("an install with no --yes refuses to write", () => {
    const root = path.join(sandbox, "no-yes");
    const home = seedFixtureHome(root);
    const port = installOpenCode({ ...portInput(home, root), assumeYes: false });
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /requires --yes/);
    assert.deepEqual(treeUnder(path.join(home, ".local")), []);
  });
});

type Installed = Readonly<{
  root: string;
  home: string;
  tree: TreeEntry[];
  preservedKeys: string[];
  snapshots: string[];
  exitCode: number;
}>;

let theInstall: Installed | undefined;

function installedByThePort(): Installed {
  if (theInstall !== undefined) return theInstall;
  const root = path.join(sandbox, "port-install");
  const home = seedFixtureHome(root);
  const outcome = installOpenCode(portInput(home, root));
  const snapshots = installBackupsDeclaring(
    opencodePathsFor(home, {}).backupsRoot,
    OPENCODE_INSTALL_BACKUP_FORMAT,
    OPENCODE_INSTALL_BACKUP_LABEL,
  );
  theInstall = {
    root,
    home,
    exitCode: outcome.exitCode,
    snapshots,
    tree: normalizedTree(home),
    preservedKeys: preservedKeysIn(snapshots[0] ?? ""),
  };
  return theInstall;
}

function normalizedTree(home: string): TreeEntry[] {
  return treeUnder(home).map((entry) => ({
    ...entryWithHomeSpelledOnce(entry, home),
    relative: entry.relative.replace(BACKUP_STAMP, "install-backup-<stamp>"),
  }));
}

function preservedKeysIn(snapshot: string): string[] {
  if (snapshot === "") return [];
  return readFileSync(path.join(snapshot, PRESERVED_KEYS_FILE), "utf8")
    .split("\n")
    .filter((key) => key !== "");
}

function portInput(home: string, root: string, overrides: NodeJS.ProcessEnv = {}) {
  return {
    homeDirectory: home,
    repositoryRoot,
    environment: { ...fixtureEnvironment(home, fixturePathWith(shims), root), ...overrides },
    platform: process.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false,
  };
}

function seedFixtureHome(root: string): string {
  const home = path.join(root, "home");
  const configHome = configHomeOf(home);
  mkdirSync(configHome, { recursive: true });
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  writeFileSync(path.join(configHome, "opencode.json"), `${JSON.stringify(operatorConfigSeed(), null, 2)}\n`);
  writeFileSync(path.join(configHome, "AGENTS.md"), operatorGlobalSeed());
  writeFileSync(path.join(root, "shim-calls.log"), "");
  return home;
}

function configHomeOf(home: string): string {
  return opencodePathsFor(home, {}).configHome;
}
