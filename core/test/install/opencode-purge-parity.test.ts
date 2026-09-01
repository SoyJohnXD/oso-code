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
import { entryWithHomeSpelledOnce, fixtureEnvironment, fixturePathWith, treeUnder, writeOpenCodeShims, type TreeEntry } from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { skipUnlessMkdirHonoursOwnerOnlyMode } from "../support/win32-skip-guards.ts";

const OWNER_ONLY_MODE_NOT_HONOURED_HERE = skipUnlessMkdirHonoursOwnerOnlyMode();

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-purge-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const shims = writeOpenCodeShims(path.join(sandbox, "shims"), path.join(sandbox, "shim-calls.log"));

const PURGE_BACKUPS_PREFIX = ".local/state/oso-code/purge-backups/";
const PURGE_BACKUP_SCAFFOLDING = [".local/state", ".local/state/oso-code", ".local/state/oso-code/purge-backups"];

const THE_PURGE_CORPUS =
  "one populated fixture HOME — config, state, cache, binary and both gentle-ai homes, plus three project-level opencode.json " +
  "files outside every target — built, read as a whole tree BY NAME, KIND AND MODE, purged by purgeOpenCode and read again, " +
  "then restored from the backup the purge kept and compared against the tree the seed built, with the HOME spelled once and " +
  "the backup root's contents excluded — the directories that exist only to hold a kept backup are excluded only where the " +
  "comparison is against the pre-purge tree";

provedSomething(
  `the purge corpus is ${THE_PURGE_CORPUS}, over the ${openCodePurgeTargets("/home/operator", false).length} targets the table names`,
  openCodePurgeTargets("/home/operator", false).length === 6 && openCodePurgeTargets("/home/operator", true).length === 4,
  "the purge target table is not the six-target table --keep-gentle-ai narrows to four, so a purge that removed nothing would compare equal to one that removed everything",
);

describe("purge --host opencode removes every target the table names, and leaves what it promises to leave", () => {
  test("the purge exits clean and what it leaves is read through kind and mode, never through names alone", { skip: OWNER_ONLY_MODE_NOT_HONOURED_HERE }, () => {
    const purged = purgedByThePort();
    assert.equal(purged.status, 0);
    assert.ok(
      purged.purged.some((entry) => entry.kind === "directory") && purged.purged.some((entry) => entry.mode === "0700"),
      "what survived carried no directory and no owner-only mode, so this is reading names alone again",
    );
  });

  test("every seeded FILE goes with it beside the backup it keeps, leaving only the directories the targets hung from", () => {
    const leg = purgedByThePort();
    assert.ok(leg.seeded.length >= openCodePurgeTargets(leg.home, false).length, `${leg.seeded.length} entries were seeded`);
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
    assert.notDeepEqual(leg.seeded.slice(1), leg.seeded);
  });

  test("the three project-level configs are intact, which is what the purge promises to preserve", () => {
    const leg = purgedByThePort();
    for (const declared of projectConfigsIn(leg.environment)) assert.ok(treeUnder(path.dirname(declared)).length === 1, declared);
  });

  test("the kept backup restores the tree the seed built, beside the backup it goes on keeping", () => {
    const leg = purgedByThePort();
    const restore = purgeOpenCode({ ...portInput(leg.home, leg.root), restoreFrom: backupDirectoryIn(leg.home) });
    assert.equal(restore.exitCode, 0, restore.report);
    assert.deepEqual(besideTheKeptBackup(normalizedTree(leg.home)), leg.seeded);
  });
});

describe("--keep-gentle-ai and --dry-run reach the targets their own tables name", () => {
  test("--keep-gentle-ai leaves both gentle-ai homes standing", () => {
    const port = purgedLeg("keep-port", (leg) => purgeOpenCode({ ...portInput(leg.home, leg.root), keepGentleAi: true }).exitCode);
    assert.equal(port.status, 0);
    assert.ok(port.purged.some((entry) => entry.relative.startsWith(".gentle-ai/")), "the gentle-ai home was removed by --keep-gentle-ai");
  });

  test("--dry-run names every target and removes none", () => {
    const port = purgedLeg("dry-port", (leg) => purgeOpenCode({ ...portInput(leg.home, leg.root), dryRun: true, assumeYes: false }).exitCode);
    assert.equal(port.status, 0);
    assert.deepEqual(port.purged, port.seeded);
  });

  test("a HOME with nothing installed is reported settled rather than purged", () => {
    const root = path.join(sandbox, "already-absent");
    const home = path.join(root, "home");
    mkdirSync(path.join(root, "tmp"), { recursive: true });
    mkdirSync(home, { recursive: true });
    const environment = purgeEnvironment(home, root, seedProjectConfigs(root));
    const port = purgeOpenCode({ ...portInput(home, root), environment });
    assert.equal(port.exitCode, 0);
    assert.match(port.report, /already absent; nothing to purge/);
  });
});

describe("the guards that refuse before anything is removed, read by exit and by the tree they leave", () => {
  for (const customized of ["XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"] as const) {
    test(`a customized ${customized} is a usage error`, () => {
      const leg = seededLeg(`customized-${customized}`);
      const environment = { ...leg.environment, [customized]: path.join(leg.root, "elsewhere") };
      const port = purgeOpenCode({ ...portInput(leg.home, leg.root), environment });
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
    test(`a project-config list ${declared.named} is a usage error`, () => {
      const leg = seededLeg(`projects-${declared.value === "" ? "absent" : declared.value}`);
      const environment = { ...leg.environment, [PROJECT_CONFIGS_KEY]: malformedProjectList(leg, declared.value) };
      const port = purgeOpenCode({ ...portInput(leg.home, leg.root), environment });
      assert.equal(port.exitCode, 2, port.report);
      assert.deepEqual(normalizedTree(leg.home), leg.seeded);
    });
  }

  test("a restore refuses to overwrite a target that is back", () => {
    const leg = purgedByThePort();
    mkdirSync(openCodePurgeTargets(leg.home, false)[0]?.target as string, { recursive: true });
    const port = purgeOpenCode({ ...portInput(leg.home, leg.root), restoreFrom: backupDirectoryIn(leg.home) });
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

let thePurge: PurgedLeg | undefined;

function purgedByThePort(): PurgedLeg {
  if (thePurge !== undefined) return thePurge;
  thePurge = purgedLeg("port-purge", (leg) => purgeOpenCode(portInput(leg.home, leg.root)).exitCode);
  return thePurge;
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

