import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  backupSizeKib,
  installBackupBudgetKib,
  installBackupDeclares,
  installBackupDirsNewestFirst,
  installBackupsDeclaring,
  installBackupsOverBudget,
  isInstallBackupName,
  parseManifestRows,
  restoreBackupManifest,
  serializeManifestRow,
} from "../../src/install/backup.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessDiskBlocksAreAllocated, WIN32_DIRECTORY_ENTRY_MARGIN_KIB } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-backup-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

describe("isInstallBackupName", () => {
  test("accepts the timestamped-pid shape", () => {
    assert.equal(isInstallBackupName("install-backup-20260829-221500-4242"), true);
  });

  test("rejects a name missing the pid suffix", () => {
    assert.equal(isInstallBackupName("install-backup-20260829-221500"), false);
  });

  test("rejects an unrelated directory name", () => {
    assert.equal(isInstallBackupName("client-config"), false);
  });
});

describe("installBackupDirsNewestFirst", () => {
  test("lists only backup-shaped directories, newest first, and returns nothing for a missing root", () => {
    const root = path.join(sandbox, "newest-first");
    mkdirSync(path.join(root, "install-backup-20260101-000000-1"), { recursive: true });
    mkdirSync(path.join(root, "install-backup-20260829-000000-2"), { recursive: true });
    mkdirSync(path.join(root, "not-a-backup"), { recursive: true });
    writeFileSync(path.join(root, "install-backup-20260601-000000-3"), "a stray file, not a directory");

    assert.deepEqual(
      installBackupDirsNewestFirst(root).map((entry) => path.basename(entry)),
      ["install-backup-20260829-000000-2", "install-backup-20260101-000000-1"],
    );
    assert.deepEqual(installBackupDirsNewestFirst(path.join(sandbox, "does-not-exist")), []);
  });
});

describe("installBackupBudgetKib", () => {
  test("defaults to 307200 KiB when unset", () => {
    assert.equal(installBackupBudgetKib({}), 307200);
  });

  test("reads OSO_INSTALL_BACKUP_BUDGET_KIB when set", () => {
    assert.equal(installBackupBudgetKib({ OSO_INSTALL_BACKUP_BUDGET_KIB: "1024" }), 1024);
  });
});

describe("backupSizeKib", { skip: skipUnlessDiskBlocksAreAllocated() }, () => {
  test("agrees with du -sk's block accounting on a small fixture", () => {
    const directory = path.join(sandbox, "sized");
    mkdirSync(path.join(directory, "items"), { recursive: true });
    writeFileSync(path.join(directory, "items", "a"), "x".repeat(1500));
    assert.equal(backupSizeKib(directory), duSizeKibOf(directory));
  });

  test("agrees with du -sk, byte for byte, on real trees of mixed shapes", () => {
    assert.equal(backupSizeKib(treeA), duSizeKibOf(treeA));
    assert.equal(backupSizeKib(treeB), duSizeKibOf(treeB));
    assert.equal(backupSizeKib(treeC), duSizeKibOf(treeC));
    assert.equal(backupSizeKib(treeD), duSizeKibOf(treeD));
  });

  test("installBackupsOverBudget reaches the same retention decision sized by the port as sized by du -sk", () => {
    const newestFirst = [treeA, treeB, treeC, treeD];
    const sizeA = backupSizeKib(treeA);
    const sizeB = backupSizeKib(treeB);
    for (const budgetKib of [sizeA + 1, sizeA + sizeB + 1]) {
      assert.deepEqual(
        installBackupsOverBudget(newestFirst, budgetKib, backupSizeKib),
        installBackupsOverBudget(newestFirst, budgetKib, duSizeKibOf),
      );
    }
  });
});

const treeA = path.join(repositoryRoot, "core", "src", "install");
const treeB = path.join(repositoryRoot, "core", "test", "install");
const treeC = path.join(repositoryRoot, "docs", "rewrite");
const treeD = path.join(repositoryRoot, "bootstrap");

function duSizeKibOf(directory: string): number {
  const result = spawnSync("du", ["-sk", directory], { encoding: "utf8" });
  const [kib = ""] = result.stdout.trim().split(/\s+/);
  return Number(kib);
}

function seedBackup(root: string, name: string, options: { format?: string; manifest?: string } = {}): string {
  const backup = path.join(root, name);
  mkdirSync(backup, { recursive: true });
  if (options.format !== undefined) writeFileSync(path.join(backup, "format"), `${options.format}\n`);
  if (options.manifest !== undefined) writeFileSync(path.join(backup, "manifest"), options.manifest);
  return backup;
}

describe("installBackupDeclares and installBackupsDeclaring", () => {
  test("a backup declares by its format marker's first line", () => {
    const root = path.join(sandbox, "declares-format");
    const backup = seedBackup(root, "install-backup-20260101-000000-1", { format: "oso-code-codex-install-v1" });
    assert.equal(installBackupDeclares(backup, "oso-code-codex-install-v1", "marketplace"), true);
    assert.equal(installBackupDeclares(backup, "oso-code-opencode-install-v1", "commands"), false);
  });

  test("a pre-marker backup declares by a manifest row's label column", () => {
    const root = path.join(sandbox, "declares-manifest");
    const backup = seedBackup(root, "install-backup-20260101-000000-2", {
      manifest: "present\tmarketplace\t/home/op/.codex/config.toml\n",
    });
    assert.equal(installBackupDeclares(backup, "oso-code-codex-install-v1", "marketplace"), true);
    assert.equal(installBackupDeclares(backup, "oso-code-codex-install-v1", "some-other-label"), false);
  });

  test("installBackupsDeclaring filters a mixed root down to one host's snapshots", () => {
    const root = path.join(sandbox, "declares-mixed");
    seedBackup(root, "install-backup-20260101-000000-1", { format: "oso-code-codex-install-v1" });
    seedBackup(root, "install-backup-20260102-000000-2", { format: "oso-code-opencode-install-v1" });
    assert.deepEqual(
      installBackupsDeclaring(root, "oso-code-codex-install-v1", "marketplace").map((entry) => path.basename(entry)),
      ["install-backup-20260101-000000-1"],
    );
  });
});

provedSomething(
  `backupSizeKib sizes a real tree above the ${WIN32_DIRECTORY_ENTRY_MARGIN_KIB} KiB margin the retention cases below hold over win32's measured directory-entry delta`,
  backupSizeKib(treeA) > WIN32_DIRECTORY_ENTRY_MARGIN_KIB,
  `backupSizeKib reports ${backupSizeKib(treeA)} KiB for ${treeA}, so the retention cases below compare sizes no platform actually measured`,
);

describe("installBackupsOverBudget", () => {
  test(
    `reaches the same retention decision on either side of the ${WIN32_DIRECTORY_ENTRY_MARGIN_KIB} KiB margin held over win32's ` +
      "measured directory-entry delta, which is what the du -sk oracle above proves on POSIX and no platform proves on win32",
    () => {
      const newestFirst = [treeA, treeB, treeC];
      const keepingTheNewestAlone = backupSizeKib(treeA) + WIN32_DIRECTORY_ENTRY_MARGIN_KIB;
      const keepingTwo = backupSizeKib(treeA) + backupSizeKib(treeB) + WIN32_DIRECTORY_ENTRY_MARGIN_KIB;

      assert.deepEqual(installBackupsOverBudget(newestFirst, keepingTheNewestAlone), [treeB, treeC]);
      assert.deepEqual(installBackupsOverBudget(newestFirst, keepingTwo), [treeC]);
    },
  );

  test("always keeps the newest snapshot even if it alone exceeds the budget", () => {
    const over = installBackupsOverBudget(["only"], 10, () => 999);
    assert.deepEqual(over, []);
  });

  test("keeps snapshots newest-first until the running total would exceed the budget", () => {
    const sizes: Record<string, number> = { a: 4, b: 4, c: 4 };
    const over = installBackupsOverBudget(["a", "b", "c"], 10, (backup) => sizes[backup] ?? 0);
    assert.deepEqual(over, ["c"]);
  });
});

describe("manifest rows", () => {
  test("parseManifestRows and serializeManifestRow round-trip a tab-separated row", () => {
    const row = { status: "present" as const, label: "settings", target: "/home/op/.claude/settings.json" };
    assert.deepEqual(parseManifestRows(`${serializeManifestRow(row)}\n`), [row]);
  });

  test("an unrecognised status column reads as absent, matching the bash's two-value column", () => {
    assert.deepEqual(parseManifestRows("weird\tlabel\t/target\n"), [{ status: "absent", label: "label", target: "/target" }]);
  });
});

describe("restoreBackupManifest", () => {
  test("replays present rows from items/<label> and removes absent rows' targets", () => {
    const root = path.join(sandbox, "restore-ok");
    const itemsDirectory = path.join(root, "items");
    mkdirSync(itemsDirectory, { recursive: true });
    writeFileSync(path.join(itemsDirectory, "settings"), '{"restored":true}\n');

    const target = path.join(root, "target", "settings.json");
    const goneTarget = path.join(root, "target", "gone.json");
    mkdirSync(path.dirname(goneTarget), { recursive: true });
    writeFileSync(goneTarget, "leftover from the current run\n");

    const manifest = [
      serializeManifestRow({ status: "present", label: "settings", target }),
      serializeManifestRow({ status: "absent", label: "gone", target: goneTarget }),
    ].join("\n");

    const outcome = restoreBackupManifest(manifest, itemsDirectory);
    assert.deepEqual(outcome, { failedCount: 0, failedItems: [] });
    assert.equal(readFileSync(target, "utf8"), '{"restored":true}\n');
    assert.equal(existsSync(goneTarget), false);
  });

  test("reports a failed item rather than throwing when its source is missing", () => {
    const root = path.join(sandbox, "restore-fail");
    const itemsDirectory = path.join(root, "items");
    mkdirSync(itemsDirectory, { recursive: true });
    const target = path.join(root, "target", "missing-source.json");

    const outcome = restoreBackupManifest(serializeManifestRow({ status: "present", label: "absent-item", target }), itemsDirectory);
    assert.equal(outcome.failedCount, 1);
    assert.deepEqual(outcome.failedItems, [target]);
  });
});
