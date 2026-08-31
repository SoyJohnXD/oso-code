import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  openCodePurgeTargets,
  projectConfigsIn,
  purgeBackupParentOf,
  purgeOpenCode,
  PROJECT_CONFIGS_KEY,
  type OpenCodePurgeInput,
} from "../../src/install/opencode-purge.ts";
import { bashIsAvailable, bashPurge, entryWithHomeSpelledOnce, fixtureEnvironment, fixturePathWith, treeUnder, writeOpenCodeShims, type TreeEntry } from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { skipUnlessBashRunsTheInstallerPipeline } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-purge-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const shims = writeOpenCodeShims(path.join(sandbox, "shims"), path.join(sandbox, "shim-calls.log"));

const PURGE_BACKUPS_PREFIX = ".local/state/oso-code/purge-backups/";
const PURGE_BACKUP_SCAFFOLDING = [".local/state", ".local/state/oso-code", ".local/state/oso-code/purge-backups"];

const THE_PURGE_CORPUS =
  "one populated fixture HOME — config, state, cache, binary and both gentle-ai homes, plus three project-level opencode.json " +
  "files outside every target — built twice and purged once by bootstrap/purge-opencode.sh --yes and once by purgeOpenCode, " +
  "then compared as whole trees BY NAME, KIND AND MODE with each HOME spelled once and the two backup roots' contents excluded, " +
  "and restored through each implementation's own backup and compared again — the directories that exist only to hold a kept " +
  "backup are excluded only where the comparison is against the pre-purge tree, never where the two implementations are compared";

provedSomething(
  `the purge parity corpus is ${THE_PURGE_CORPUS}, over the ${openCodePurgeTargets("/home/operator", false).length} targets the table names`,
  openCodePurgeTargets("/home/operator", false).length === 6 && openCodePurgeTargets("/home/operator", true).length === 4,
  "the purge target table is not the six-target table --keep-gentle-ai narrows to four, so a purge that removed nothing would compare equal to one that removed everything",
);

describe("purge --host opencode removes what the bash purge removes, and leaves what it leaves", () => {
  test("the purged HOMEs are identical file for file once each HOME is spelled once", { skip: skipUnlessBash() }, () => {
    const both = purgedByBoth();
    assert.deepEqual(both.port.purged, both.bash.purged);
    assert.ok(
      both.bash.purged.some((entry) => entry.kind === "directory") && both.bash.purged.some((entry) => entry.mode === "0700"),
      "the comparison carried no directory and no owner-only mode, so it is reading names alone again",
    );
    assert.equal(both.bash.status, 0);
    assert.equal(both.port.status, 0);
  });

  test("both took every seeded FILE with them beside the backup each keeps, leaving only the directories the targets hung from", { skip: skipUnlessBash() }, () => {
    const both = purgedByBoth();
    assert.ok(both.bash.seeded.length >= openCodePurgeTargets(both.bash.home, false).length, `${both.bash.seeded.length} entries were seeded`);
    for (const leg of [both.bash, both.port]) {
      const survivors = besideTheKeptBackup(leg.purged);
      assert.ok(survivors.length > 0, "the purge left nothing at all, so 'directories only' below would be vacuous");
      assert.deepEqual(
        survivors.filter((entry) => entry.kind === "file"),
        [],
        "the purge kept a file it was asked to take",
      );
      for (const { label, target } of openCodePurgeTargets(leg.home, false)) {
        assert.ok(!existsSync(target), `${label} survived the purge at ${target}`);
      }
    }
    assert.notDeepEqual(both.bash.seeded.slice(1), both.bash.seeded);
  });

  test("the three project-level configs are intact in both, which is what the purge promises to preserve", { skip: skipUnlessBash() }, () => {
    const both = purgedByBoth();
    for (const leg of [both.bash, both.port]) {
      for (const declared of projectConfigsIn(leg.environment)) assert.ok(treeUnder(path.dirname(declared)).length === 1, declared);
    }
  });

  test("each implementation restores its own backup to the tree it started from, beside the backup it keeps", { skip: skipUnlessBash() }, () => {
    const both = purgedByBoth();
    const bashRestore = bashPurge(both.bash.home, shims, both.bash.root, ["--restore", backupDirectoryIn(both.bash.home)], both.bash.environment);
    assert.equal(bashRestore.status, 0, bashRestore.stderr);
    const portRestore = purgeOpenCode({ ...portInput(both.port.home, both.port.root), restoreFrom: backupDirectoryIn(both.port.home) });
    assert.equal(portRestore.exitCode, 0, portRestore.report);
    assert.deepEqual(normalizedTree(both.port.home), normalizedTree(both.bash.home));
    assert.deepEqual(besideTheKeptBackup(normalizedTree(both.bash.home)), both.bash.seeded);
  });
});

describe("--keep-gentle-ai and --dry-run reach the same targets through both implementations", () => {
  test("--keep-gentle-ai leaves both gentle-ai homes standing in both", { skip: skipUnlessBash() }, () => {
    const bash = purgedLeg("keep-bash", (leg) => bashPurge(leg.home, shims, leg.root, ["--yes", "--keep-gentle-ai"], leg.environment).status);
    const port = purgedLeg("keep-port", (leg) => purgeOpenCode({ ...portInput(leg.home, leg.root), keepGentleAi: true }).exitCode);
    assert.equal(bash.status, 0);
    assert.equal(port.status, 0);
    assert.deepEqual(port.purged, bash.purged);
    assert.ok(bash.purged.some((entry) => entry.relative.startsWith(".gentle-ai/")), "the gentle-ai home was removed by --keep-gentle-ai");
  });

  test("--dry-run names every target and removes none, through both", { skip: skipUnlessBash() }, () => {
    const bash = purgedLeg("dry-bash", (leg) => bashPurge(leg.home, shims, leg.root, ["--dry-run"], leg.environment).status);
    const port = purgedLeg("dry-port", (leg) => purgeOpenCode({ ...portInput(leg.home, leg.root), dryRun: true, assumeYes: false }).exitCode);
    assert.equal(bash.status, 0);
    assert.equal(port.status, 0);
    assert.deepEqual(bash.purged, bash.seeded);
    assert.deepEqual(port.purged, port.seeded);
  });

  test("a HOME with nothing installed is reported settled rather than purged, through both", { skip: skipUnlessBash() }, () => {
    const root = path.join(sandbox, "already-absent");
    const home = path.join(root, "home");
    mkdirSync(path.join(root, "tmp"), { recursive: true });
    mkdirSync(home, { recursive: true });
    const environment = purgeEnvironment(home, root, seedProjectConfigs(root));
    const bash = bashPurge(home, shims, root, ["--yes"], environment);
    const port = purgeOpenCode({ ...portInput(home, root), environment });
    assert.equal(bash.status, 0);
    assert.equal(port.exitCode, 0);
    assert.match(bash.stdout, /already absent; nothing to purge/);
    assert.match(port.report, /already absent; nothing to purge/);
  });
});

describe("the guards that refuse before anything is removed, compared by exit through both", () => {
  for (const customized of ["XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"] as const) {
    test(`a customized ${customized} is a usage error in both`, { skip: skipUnlessBash() }, () => {
      const leg = seededLeg(`customized-${customized}`);
      const environment = { ...leg.environment, [customized]: path.join(leg.root, "elsewhere") };
      const bash = bashPurge(leg.home, shims, leg.root, ["--yes"], environment);
      const port = purgeOpenCode({ ...portInput(leg.home, leg.root), environment });
      assert.equal(bash.status, 2);
      assert.equal(port.exitCode, 2);
      assert.deepEqual(normalizedTree(leg.home), leg.seeded);
    });
  }

  for (const declared of [
    { named: "absent", value: "" },
    { named: "two rather than three", value: "two" },
    { named: "the same path three times", value: "repeated" },
    { named: "a relative path", value: "relative" },
    { named: "a path inside a purge target", value: "inside" },
    { named: "a path that does not exist", value: "missing" },
  ] as const) {
    test(`a project-config list ${declared.named} is a usage error in both`, { skip: skipUnlessBash() }, () => {
      const leg = seededLeg(`projects-${declared.value === "" ? "absent" : declared.value}`);
      const environment = { ...leg.environment, [PROJECT_CONFIGS_KEY]: malformedProjectList(leg, declared.value) };
      const bash = bashPurge(leg.home, shims, leg.root, ["--yes"], environment);
      const port = purgeOpenCode({ ...portInput(leg.home, leg.root), environment });
      assert.equal(bash.status, 2, bash.stderr);
      assert.equal(port.exitCode, 2, port.report);
      assert.deepEqual(normalizedTree(leg.home), leg.seeded);
    });
  }

  test("a restore refuses to overwrite a target that is back, through both", { skip: skipUnlessBash() }, () => {
    const both = purgedByBoth();
    mkdirSync(openCodePurgeTargets(both.port.home, false)[0]?.target as string, { recursive: true });
    const port = purgeOpenCode({ ...portInput(both.port.home, both.port.root), restoreFrom: backupDirectoryIn(both.port.home) });
    assert.equal(port.exitCode, 1);
    assert.match(port.report, /refusing to overwrite an existing target/);
  });
});

type PurgedLeg = Readonly<{
  root: string;
  home: string;
  environment: NodeJS.ProcessEnv;
  seeded: TreeEntry[];
  purged: TreeEntry[];
  status: number;
}>;

let bothPurges: Readonly<{ bash: PurgedLeg; port: PurgedLeg }> | undefined;

function purgedByBoth(): Readonly<{ bash: PurgedLeg; port: PurgedLeg }> {
  if (bothPurges !== undefined) return bothPurges;
  bothPurges = {
    bash: purgedLeg("bash-purge", (leg) => bashPurge(leg.home, shims, leg.root, ["--yes"], leg.environment).status),
    port: purgedLeg("port-purge", (leg) => purgeOpenCode(portInput(leg.home, leg.root)).exitCode),
  };
  return bothPurges;
}

function purgedLeg(name: string, drive: (leg: Readonly<{ home: string; root: string; environment: NodeJS.ProcessEnv }>) => number): PurgedLeg {
  const leg = seededLeg(name);
  const status = drive(leg);
  return { ...leg, purged: normalizedTree(leg.home), status };
}

function seededLeg(name: string): Readonly<{ root: string; home: string; environment: NodeJS.ProcessEnv; seeded: TreeEntry[] }> {
  const root = path.join(sandbox, name);
  const home = path.join(root, "home");
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  for (const { label, target } of openCodePurgeTargets(home, false)) {
    mkdirSync(path.dirname(target), { recursive: true });
    if (label === "bin" || label === "gentle-ai-bin") writeFileSync(target, `${label} payload\n`);
    else {
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, `${label}.txt`), `${label} payload\n`);
    }
  }
  const environment = purgeEnvironment(home, root, seedProjectConfigs(root));
  return { root, home, environment, seeded: normalizedTree(home) };
}

function seedProjectConfigs(root: string): string[] {
  return ["one", "two", "three"].map((name) => {
    const project = path.join(root, "projects", name);
    mkdirSync(project, { recursive: true });
    const declared = path.join(project, "opencode.json");
    writeFileSync(declared, `{"project":"${name}"}\n`);
    return declared;
  });
}

function purgeEnvironment(home: string, root: string, projects: readonly string[]): NodeJS.ProcessEnv {
  return { ...fixtureEnvironment(home, fixturePathWith(shims), root), [PROJECT_CONFIGS_KEY]: projects.join(" ") };
}

function portInput(home: string, root: string): OpenCodePurgeInput {
  return {
    homeDirectory: home,
    environment: purgeEnvironment(home, root, seededProjects(root)),
    assumeYes: true,
    dryRun: false,
    keepGentleAi: false,
    restoreFrom: undefined,
  };
}

function seededProjects(root: string): string[] {
  return ["one", "two", "three"].map((name) => path.join(root, "projects", name, "opencode.json"));
}

function malformedProjectList(leg: Readonly<{ root: string; home: string }>, shape: string): string {
  const declared = seededProjects(leg.root);
  switch (shape) {
    case "":
      return "";
    case "two":
      return declared.slice(0, 2).join(" ");
    case "repeated":
      return [declared[0], declared[0], declared[0]].join(" ");
    case "relative":
      return [declared[0], declared[1], "projects/three/opencode.json"].join(" ");
    case "missing":
      return [declared[0], declared[1], path.join(leg.root, "projects", "absent", "opencode.json")].join(" ");
    default:
      return [declared[0], declared[1], path.join(leg.home, ".config", "opencode", "opencode.json")].join(" ");
  }
}

function backupDirectoryIn(home: string): string {
  const parent = purgeBackupParentOf(home);
  const name = readdirSync(parent)[0];
  return path.join(parent, name as string);
}

function besideTheKeptBackup(tree: readonly TreeEntry[]): TreeEntry[] {
  return tree.filter((entry) => !PURGE_BACKUP_SCAFFOLDING.includes(entry.relative));
}

function normalizedTree(home: string): TreeEntry[] {
  return treeUnder(home, (relative) => relative.startsWith(PURGE_BACKUPS_PREFIX)).map((entry) => entryWithHomeSpelledOnce(entry, home));
}

function skipUnlessBash(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  return bashIsAvailable() ? false : "bash cannot be spawned here, so bootstrap/purge-opencode.sh cannot be driven as the oracle";
}
