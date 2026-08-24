import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LiveMarker {
  sessionId: string;
  pid: number;
  commonDir: string;
  worktrees: string[];
  updatedAt: number;
}

export interface StaleOrphan {
  path: string;
  sessionId: string;
}

export interface SweepResult {
  reaped: string[];
  left: string[];
}

export interface SweepOptions {
  git?: string;
}

export interface TouchOptions {
  pid: number;
  worktrees: string[];
}

const MARKER_PREFIX = "oso-live-";
const MARKER_SUFFIX = ".json";

export function markerPath(commonDir: string, sessionId: string): string {
  return join(commonDir, `${MARKER_PREFIX}${sessionId}${MARKER_SUFFIX}`);
}

export function readMarker(commonDir: string, sessionId: string): LiveMarker | null {
  return readMarkerFile(markerPath(commonDir, sessionId));
}

function readMarkerFile(path: string): LiveMarker | null {
  try {
    return normalizeMarker(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function normalizeMarker(parsed: unknown): LiveMarker | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const sessionId = record.sessionId;
  const pid = record.pid;
  if (typeof sessionId !== "string" || sessionId === "") {
    return null;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const worktrees = Array.isArray(record.worktrees)
    ? record.worktrees.filter((entry): entry is string => typeof entry === "string")
    : [];
  const commonDir = typeof record.commonDir === "string" ? record.commonDir : "";
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;
  return { sessionId, pid, commonDir, worktrees, updatedAt };
}

export function listMarkers(commonDir: string): LiveMarker[] {
  if (commonDir === "") {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(commonDir);
  } catch {
    return [];
  }
  const markers: LiveMarker[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(MARKER_PREFIX) || !entry.endsWith(MARKER_SUFFIX)) {
      continue;
    }
    const marker = readMarkerFile(join(commonDir, entry));
    if (marker !== null) {
      markers.push(marker);
    }
  }
  return markers;
}

export function isLive(marker: LiveMarker): boolean {
  if (marker.pid === process.pid) {
    return true;
  }
  try {
    process.kill(marker.pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function listStale(commonDir: string): StaleOrphan[] {
  const orphans: StaleOrphan[] = [];
  for (const marker of listMarkers(commonDir)) {
    if (isLive(marker)) {
      continue;
    }
    for (const path of marker.worktrees) {
      orphans.push({ path, sessionId: marker.sessionId });
    }
  }
  return orphans;
}

export function buildStaleAdvice(orphans: StaleOrphan[]): string {
  if (orphans.length === 0) {
    return "";
  }
  const lines = orphans.map(
    (orphan) => `  - ${orphan.path} (left by dead session ${orphan.sessionId})`,
  );
  return `Stale worktrees from dead sessions remain on disk:\n${lines.join("\n")}\n`
    + "Remove them with `git worktree remove` and `git worktree prune`, "
    + "or leave them for the harness sweep.";
}

export type PendingSystemAdvice = Map<string, string[]>;

export type AdviceDelivery =
  | { kind: "delivered"; entries: number }
  | { kind: "empty" }
  | { kind: "undeliverable" };

export function queueSystemAdvice(
  pending: PendingSystemAdvice,
  sessionId: string,
  advice: string,
): void {
  if (sessionId === "" || advice === "") {
    return;
  }
  const queued = pending.get(sessionId);
  if (queued === undefined) {
    pending.set(sessionId, [advice]);
    return;
  }
  queued.push(advice);
}

export function deliverSystemAdvice(
  output: unknown,
  pending: PendingSystemAdvice,
  sessionId: string,
): AdviceDelivery {
  const queued = pending.get(sessionId);
  if (queued === undefined || queued.length === 0) {
    return { kind: "empty" };
  }
  const record = output as { system?: unknown } | null;
  if (typeof record !== "object" || record === null || !Array.isArray(record.system)) {
    return { kind: "undeliverable" };
  }
  record.system.push(...queued);
  return { kind: "delivered", entries: queued.length };
}

export function dropSystemAdvice(pending: PendingSystemAdvice, sessionId: string): void {
  pending.delete(sessionId);
}

export function touchMarker(commonDir: string, sessionId: string, options: TouchOptions): void {
  if (commonDir === "" || sessionId === "") {
    return;
  }
  const marker: LiveMarker = {
    sessionId,
    pid: options.pid,
    commonDir,
    worktrees: options.worktrees,
    updatedAt: Date.now(),
  };
  writeFileSync(markerPath(commonDir, sessionId), JSON.stringify(marker));
}

export function sweepStale(commonDir: string, options: SweepOptions = {}): SweepResult {
  const reaped: string[] = [];
  const left: string[] = [];
  const git = options.git ?? "git";
  for (const marker of listMarkers(commonDir)) {
    if (isLive(marker)) {
      continue;
    }
    let tornDown = true;
    for (const path of marker.worktrees) {
      if (removeWorktree(commonDir, path, git)) {
        reaped.push(path);
      } else {
        left.push(path);
        tornDown = false;
      }
    }
    if (tornDown) {
      dropMarkerQuietly(commonDir, marker.sessionId);
    }
  }
  return { reaped, left };
}

function removeWorktree(commonDir: string, path: string, git: string): boolean {
  const cwd = dirname(commonDir);
  if (!runGit(git, ["worktree", "remove", path], cwd)) {
    return false;
  }
  runGit(git, ["worktree", "prune"], cwd);
  return true;
}

function runGit(git: string, args: readonly string[], cwd: string): boolean {
  try {
    const result = spawnSync(git, args, { cwd, encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function dropMarkerQuietly(commonDir: string, sessionId: string): void {
  try {
    rmSync(markerPath(commonDir, sessionId), { force: true });
  } catch {}
}
