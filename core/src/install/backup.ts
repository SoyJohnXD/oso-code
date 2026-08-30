import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const BACKUP_NAME_PATTERN = /^install-backup-\d{8}-\d{6}-.+$/;
const DEFAULT_BUDGET_KIB = 307200;
const BUDGET_ENV_KEY = "OSO_INSTALL_BACKUP_BUDGET_KIB";
const DISK_BLOCK_SIZE_BYTES = 512;
const BYTES_PER_KIB = 1024;
const DISK_BLOCKS_PER_KIB = BYTES_PER_KIB / DISK_BLOCK_SIZE_BYTES;

export type ManifestStatus = "present" | "absent";

export type ManifestRow = Readonly<{ status: ManifestStatus; label: string; target: string }>;

export type RestoreOutcome = Readonly<{ failedCount: number; failedItems: readonly string[] }>;

export function isInstallBackupName(name: string): boolean {
  return BACKUP_NAME_PATTERN.test(name);
}

export function installBackupDirsNewestFirst(root: string): string[] {
  return childDirectoryNames(root)
    .filter(isInstallBackupName)
    .map((name) => path.join(root, name))
    .sort()
    .reverse();
}

export function installBackupBudgetKib(environment: NodeJS.ProcessEnv = process.env): number {
  const configured = environment[BUDGET_ENV_KEY];
  if (configured === undefined || configured === "") return DEFAULT_BUDGET_KIB;
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? parsed : DEFAULT_BUDGET_KIB;
}

export function backupSizeKib(directory: string): number {
  return Math.ceil(recursiveDiskBlocks(directory) / DISK_BLOCKS_PER_KIB);
}

export function installBackupDeclares(backup: string, format: string, label: string): boolean {
  if (!isDirectoryNotSymlink(backup)) return false;
  if (formatMarkerOf(backup) === format) return true;
  return manifestRowsOf(backup).some((row) => row.label === label);
}

export function installBackupsDeclaring(root: string, format: string, label: string): string[] {
  return installBackupDirsNewestFirst(root).filter((backup) => installBackupDeclares(backup, format, label));
}

export function installBackupsOverBudget(
  newestFirst: readonly string[],
  budgetKib: number,
  sizeOf: (backup: string) => number = backupSizeKib,
): string[] {
  let runningKib = 0;
  let kept = 0;
  const over: string[] = [];
  for (const backup of newestFirst) {
    const sizeKib = sizeOf(backup);
    if (kept === 0 || runningKib + sizeKib <= budgetKib) {
      runningKib += sizeKib;
      kept += 1;
      continue;
    }
    over.push(backup);
  }
  return over;
}

export function restoreBackupManifest(manifest: string, itemsDirectory: string): RestoreOutcome {
  const failedItems: string[] = [];
  for (const row of parseManifestRows(manifest)) {
    if (row.target === "") continue;
    if (!removeTarget(row.target) || (row.status === "present" && !restoreItem(itemsDirectory, row))) {
      failedItems.push(row.target);
    }
  }
  return { failedCount: failedItems.length, failedItems };
}

export function parseManifestRows(manifest: string): ManifestRow[] {
  return manifest
    .split("\n")
    .filter((line) => line !== "")
    .map(manifestRowOf);
}

export function serializeManifestRow(row: ManifestRow): string {
  return `${row.status}\t${row.label}\t${row.target}`;
}

function manifestRowOf(line: string): ManifestRow {
  const [status, label = "", target = ""] = line.split("\t");
  return { status: status === "present" ? "present" : "absent", label, target };
}

function removeTarget(target: string): boolean {
  try {
    rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function restoreItem(itemsDirectory: string, row: ManifestRow): boolean {
  try {
    mkdirSync(path.dirname(row.target), { recursive: true });
    cpSync(path.join(itemsDirectory, row.label), row.target, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function formatMarkerOf(backup: string): string | undefined {
  return readableLinesOf(path.join(backup, "format"))[0];
}

function manifestRowsOf(backup: string): ManifestRow[] {
  const lines = readableLinesOf(path.join(backup, "manifest"));
  return lines.length === 0 ? [] : parseManifestRows(lines.join("\n"));
}

function readableLinesOf(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
}

export function childDirectoryNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isDirectoryNotSymlink(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function recursiveDiskBlocks(target: string): number {
  const stats = lstatSync(target, { throwIfNoEntry: false });
  if (stats === undefined) return 0;
  if (!stats.isDirectory()) return stats.blocks;
  const childBlocks = readdirSync(target).reduce((total, child) => total + recursiveDiskBlocks(path.join(target, child)), 0);
  return stats.blocks + childBlocks;
}
