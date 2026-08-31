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
  bashInstall,
  bashIsAvailable,
  entryWithHomeSpelledOnce,
  fixtureEnvironment,
  fixturePathWith,
  shimAnsweredArgv,
  treeUnder,
  writeOpenCodeShims,
  SHIM_ANSWERED_CALLS,
  SHIM_UNANSWERED_EXIT,
  type BashRun,
  type TreeEntry,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessBashRunsTheInstallerPipeline } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-install-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const INSTALL_ARGUMENTS = ["--yes", "--no-impeccable", "--no-git-hook"] as const;
const BACKUP_STAMP = /install-backup-\d{8}-\d{6}-\d+/g;

const THE_INSTALL_CORPUS =
  "one seeded operator config and AGENTS.md copied into two fixture HOMEs, installed once by bootstrap/install-opencode.sh " +
  "--yes --no-impeccable --no-git-hook and once by installOpenCode over the same seed, then compared as whole trees BY NAME, " +
  "KIND AND MODE — directories included, not files alone — with each HOME spelled once and the backup timestamp folded, on a " +
  "PATH built by filtering every directory holding an opencode executable out of the ambient one and prepending the shim, so " +
  "no leg can reach an installed host binary";

const shims = writeOpenCodeShims(path.join(sandbox, "shims"), path.join(sandbox, "shim-calls.log"));
const refusingShims = writeRefusingShims();

provedSomething(
  `the install parity corpus is ${THE_INSTALL_CORPUS}`,
  publishedGateScriptNames(openCodePayloadSources(repositoryRoot).publishedHashes).length > 0,
  "bootstrap/hook-hashes.txt published no gate script, so an install that copied nothing would compare equal to one that copied everything",
);

describe("install --host opencode leaves the same tree the bash installer leaves, over the same seed", () => {
  test("every entry under the fixture HOME carries the same kind, mode and bytes once the HOME and the backup timestamp are spelled once", { skip: skipUnlessBash() }, () => {
    const both = installedByBoth();
    assert.deepEqual(both.port.tree, both.bash.tree);
    assert.ok(both.bash.tree.length > 40, `${both.bash.tree.length} entries were compared`);
    assert.ok(
      both.bash.tree.some((entry) => entry.kind === "directory") && both.bash.tree.some((entry) => entry.mode === "0700"),
      "the comparison carried no directory and no owner-only mode, so it is reading bytes alone again",
    );
  });

  test("the comparison is shown catching a difference, so the equality above is not two empty listings", { skip: skipUnlessBash() }, () => {
    const both = installedByBoth();
    assert.notDeepEqual(both.port.tree.slice(1), both.bash.tree);
  });

  test("both implementations preserve the same operator keys, in the same order", { skip: skipUnlessBash() }, () => {
    const both = installedByBoth();
    assert.deepEqual(both.port.preservedKeys, both.bash.preservedKeys);
    assert.deepEqual(both.bash.preservedKeys, ["theme", "permission.read", "mcp.oso-verify-operator-server"]);
  });

  test("both implementations record one install backup declaring the OpenCode format and label", { skip: skipUnlessBash() }, () => {
    const both = installedByBoth();
    assert.equal(both.bash.snapshots.length, 1);
    assert.equal(both.port.snapshots.length, 1);
  });

  test("both implementations leave a gate tree the published hashes cover completely", { skip: skipUnlessBash() }, () => {
    const both = installedByBoth();
    for (const home of [both.bash.home, both.port.home]) {
      const reading = openCodeTrustReading(openCodePayloadSources(repositoryRoot).publishedHashes, "installed", configHomeOf(home));
      assert.deepEqual(reading.divergences, []);
    }
  });
});

describe(
  "the shim answers ONE question at the sites this table enumerates, so a second question the bash starts consuming goes stale loudly " +
    "rather than quietly — the entries name SPAWN sites, never callers",
  () => {
    test("an install drive answers exactly the calls this table names for it, read from the shim's own log", { skip: skipUnlessBash() }, () => {
      const answered = shimAnsweredArgv(path.join(installedByBoth().bash.root, "shim-calls.log"));
      const declared = SHIM_ANSWERED_CALLS.filter((call) => call.callerScript === "bootstrap/install-opencode.sh").map((call) => call.argv);
      assert.deepEqual(answered, declared);
      assert.deepEqual(answered, ["--version"]);
    });

    test("every enumerated spawn site is a function the named file defines, reached from the named caller", { skip: skipUnlessBash() }, () => {
      for (const call of SHIM_ANSWERED_CALLS) {
        const spawnSource = readFileSync(path.join(repositoryRoot, call.definedIn), "utf8");
        const callerSource = readFileSync(path.join(repositoryRoot, call.callerScript), "utf8");
        assert.ok(spawnSource.includes(`${call.spawnedBy}() {`), `${call.definedIn} defines no ${call.spawnedBy}`);
        assert.ok(callerSource.includes(`${call.callerFunction}() {`), `${call.callerScript} defines no ${call.callerFunction}`);
        assert.ok(callerSource.includes(call.spawnedBy), `${call.callerScript} never reaches ${call.spawnedBy}`);
      }
    });

    test("the port answers the same question without spawning at all, which the shim's own log is what proves", { skip: skipUnlessBash() }, () => {
      const both = installedByBoth();
      assert.deepEqual(shimAnsweredArgv(path.join(both.port.root, "shim-calls.log")), []);
      assert.equal(both.port.exitCode, 0);
    });

    test("a shim that refuses the one question takes the bash install red, so the list above is the gate and not a decoration", { skip: skipUnlessBash() }, () => {
      const root = path.join(sandbox, "refused-version");
      const home = seedFixtureHome(root);
      const run = bashInstall(home, refusingShims, root, [...INSTALL_ARGUMENTS]);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /host baseline not met/);
    });
  },
);

describe("the refusals both implementations reach before they write anything, compared by exit and by subject", () => {
  test("an install pointed outside the named home is a usage error in both, and the decoy is untouched", { skip: skipUnlessBash() }, () => {
    const root = path.join(sandbox, "decoy-home");
    const home = seedFixtureHome(root);
    const decoy = path.join(root, "decoy");
    mkdirSync(path.join(decoy, "opencode"), { recursive: true });
    writeFileSync(path.join(decoy, "opencode", "opencode.json"), '{"theme":"decoy"}\n');

    const bash = bashInstall(home, shims, root, [...INSTALL_ARGUMENTS], { XDG_CONFIG_HOME: decoy });
    const port = installOpenCode(portInput(home, root, { XDG_CONFIG_HOME: decoy }));
    assert.equal(bash.status, 2);
    assert.equal(port.exitCode, 2);
    assert.equal(readFileSync(path.join(decoy, "opencode", "opencode.json"), "utf8"), '{"theme":"decoy"}\n');
  });

  test("an existing config that is not JSON refuses in both, and the file is left as it was", { skip: skipUnlessBash() }, () => {
    const root = path.join(sandbox, "unparseable-config");
    const home = seedFixtureHome(root);
    const configFile = path.join(configHomeOf(home), "opencode.json");
    writeFileSync(configFile, "{ not json\n");
    const bash = bashInstall(home, shims, root, [...INSTALL_ARGUMENTS]);
    const port = installOpenCode(portInput(home, root));
    assert.equal(bash.status, 1);
    assert.equal(port.exitCode, 1);
    assert.match(bash.stderr, /is not valid JSON/);
    assert.match(port.report, /is not valid JSON/);
    assert.equal(readFileSync(configFile, "utf8"), "{ not json\n");
  });

  test("a global guidance file with malformed markers refuses in both", { skip: skipUnlessBash() }, () => {
    const root = path.join(sandbox, "malformed-global");
    const home = seedFixtureHome(root);
    writeFileSync(path.join(configHomeOf(home), "AGENTS.md"), "<!-- oso-code:end -->\n<!-- oso-code:start -->\n");
    const bash = bashInstall(home, shims, root, [...INSTALL_ARGUMENTS]);
    const port = installOpenCode(portInput(home, root));
    assert.equal(bash.status, 1);
    assert.equal(port.exitCode, 1);
    assert.match(bash.stderr, /malformed oso-code markers/);
    assert.match(port.report, /malformed oso-code markers/);
  });

  test("an install with no --yes refuses to write, where the bash would have prompted", { skip: skipUnlessBash() }, () => {
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

let bothInstalls: Readonly<{ bash: Installed; port: Installed }> | undefined;

function installedByBoth(): Readonly<{ bash: Installed; port: Installed }> {
  if (bothInstalls !== undefined) return bothInstalls;
  const bashRoot = path.join(sandbox, "bash-install");
  const portRoot = path.join(sandbox, "port-install");
  const bashHome = seedFixtureHome(bashRoot);
  const portHome = seedFixtureHome(portRoot);

  const run: BashRun = bashInstall(bashHome, shims, bashRoot, [...INSTALL_ARGUMENTS]);
  if (run.status !== 0) throw new Error(`bootstrap/install-opencode.sh refused the parity fixture: ${run.stdout}${run.stderr}`);
  const outcome = installOpenCode(portInput(portHome, portRoot));

  bothInstalls = {
    bash: installedFrom(bashRoot, bashHome, run.status),
    port: installedFrom(portRoot, portHome, outcome.exitCode),
  };
  return bothInstalls;
}

function installedFrom(root: string, home: string, exitCode: number): Installed {
  const snapshots = installBackupsDeclaring(opencodePathsFor(home, {}).backupsRoot, OPENCODE_INSTALL_BACKUP_FORMAT, OPENCODE_INSTALL_BACKUP_LABEL);
  return {
    root,
    home,
    exitCode,
    snapshots,
    tree: normalizedTree(home),
    preservedKeys: preservedKeysIn(snapshots[0] ?? ""),
  };
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

function writeRefusingShims(): string {
  const directory = writeOpenCodeShims(path.join(sandbox, "refusing-shims"), path.join(sandbox, "refusing-calls.log"));
  writeFileSync(path.join(directory, "opencode"), `#!/bin/sh\nexit ${SHIM_UNANSWERED_EXIT}\n`, { mode: 0o700 });
  return directory;
}

function skipUnlessBash(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  return bashIsAvailable() ? false : "bash cannot be spawned here, so bootstrap/install-opencode.sh cannot be driven as the oracle";
}
