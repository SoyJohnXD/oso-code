import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";
import { CODEX_UUID_PATTERN } from "../hosts/codex-session-metadata.ts";
import { NO_VERDICT, type GateOutcome, type HookEnvelope, type NoVerdictVerdict } from "../hosts/envelope.ts";
import {
  isDirectory,
  isRegularNonSymlinkFile,
  journalFileFor,
  LockTimeoutError,
  logEvent,
  readStateFile,
  secondsSinceModified,
  stateRootDirectory,
  stateFileFor,
  stateRecords,
  StateFileUnreadableError,
  withLock,
} from "../state/store.ts";
import { hookSessionId, sanitizeSession, stateValue, type GateDefinition, type GateRequest } from "./preflight.ts";

const ABANDONED_STATE_DAYS = 7;
const JOURNAL_KEYED_WAIT_MARK_SUFFIX = ".waiting";
const EVENTS_LOG_RETENTION_DAYS = 30;
const SECONDS_PER_DAY = 86400;

export const TEARDOWN_GATE: GateDefinition<NoVerdictVerdict> = {
  gate: "teardown",
  errorSubject: "the session-teardown gate",
  judge: judgeTeardown,
};

function judgeTeardown({ envelope }: GateRequest): GateOutcome<NoVerdictVerdict> {
  if (envelope.caller.host === "codex") return codexTeardown(envelope);
  const sessionId = hookSessionId(envelope);
  const ownState = stateArmedBy(sessionId);
  removeWorktreesOf(sessionId, ownState);
  dropJournalKeyedWaitMark(envelope.cwd);
  dropStateFile(ownState);
  clearOrphanedPendingOf(sanitizeSession(envelope.sessionId));
  clearRoadmapInFlightOf(sessionId);
  rotateAgedEventsLog();
  pruneAbandonedState(sessionId, ownState);
  return NO_VERDICT;
}

function codexTeardown(envelope: HookEnvelope): GateOutcome<NoVerdictVerdict> {
  const stateFile = stateFileFor(envelope.cwd);
  if (!codexOwnsState(stateFile, envelope)) return NO_VERDICT;
  try {
    withLock(stateFile, envelope.sessionId, () => {
      if (codexOwnsState(stateFile, envelope)) rmSync(stateFile, { force: true });
    }, "retain-existing");
  } catch (error) {
    if (!(error instanceof LockTimeoutError)) throw error;
    return { verdict: { kind: "noVerdict" }, events: [{ event: "teardown-lock-retained", session: envelope.sessionId }] };
  }
  return NO_VERDICT;
}

function codexOwnsState(stateFile: string, envelope: HookEnvelope): boolean {
  if (envelope.cwd === "" || envelope.payloadRead !== "json" || !CODEX_UUID_PATTERN.test(envelope.sessionId)) return false;
  if (!isRegularNonSymlinkFile(stateFile)) return false;
  const read = readStateFile(stateFile);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(stateFile, read.cause);
  if (read.kind !== "ok") return false;
  const owners = stateRecords(read.content, "plan_approval_session");
  if (owners.length === 0 || owners.some((owner) => owner !== envelope.sessionId)) return false;
  const sessions = stateRecords(read.content, "session");
  return new Set(sessions).size <= 1 && sessions.every((session) =>
    session === "" || session === envelope.sessionId || session === envelope.caller.agentSession,
  );
}

function stateArmedBy(sessionId: string): string | undefined {
  if (sessionId === "") return undefined;
  return stateFilesSorted().find((stateFile) => stateValueOf(stateFile, "session") === sessionId);
}

function removeWorktreesOf(sessionId: string, stateFile: string | undefined): void {
  if (sessionId === "") return;
  const sessionWorktrees = path.join(stateRootDirectory(), "worktrees", sessionId);
  if (!isDirectory(sessionWorktrees)) return;
  if (stateFile === undefined) return;
  const repoPath = stateValueOf(stateFile, "repo_path");
  if (repoPath === "") return;

  for (const worktree of subdirectoriesSorted(sessionWorktrees)) {
    const removed = gitWorktreeRemove(repoPath, worktree);
    logEvent({ event: removed ? "worktree-removed" : "worktree-teardown-failed", session: sessionId, command: worktree });
  }
  if (!gitWorktreePrune(repoPath)) {
    logEvent({ event: "worktree-prune-failed", session: sessionId, command: repoPath });
  }
  try {
    rmdirSync(sessionWorktrees);
  } catch {
    return;
  }
}

function dropJournalKeyedWaitMark(cwd: string): void {
  const journalFile = journalFileFor(cwd);
  const stem = journalFile.endsWith(".log") ? journalFile.slice(0, -".log".length) : journalFile;
  rmSync(`${stem}${JOURNAL_KEYED_WAIT_MARK_SUFFIX}`, { force: true });
}

function dropStateFile(stateFile: string | undefined): void {
  if (stateFile === undefined) return;
  rmSync(stateFile, { force: true });
  rmSync(`${stateFile}.lock`, { recursive: true, force: true });
}

function clearOrphanedPendingOf(realSessionId: string): void {
  if (realSessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateValueOf(stateFile, "plan_approval_session") !== realSessionId) continue;
    const ownerSession = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(ownerSession, stateFile);
    dropStateFile(stateFile);
  }
}

function clearRoadmapInFlightOf(sessionId: string): void {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateValueOf(stateFile, "session") !== sessionId) continue;
    const roadmap = stateValueOf(stateFile, "roadmap");
    if (roadmap === "" || roadmap === "none") continue;
    removeWorktreesOf(sessionId, stateFile);
    dropStateFile(stateFile);
  }
}

function rotateAgedEventsLog(): void {
  const eventsLog = path.join(stateRootDirectory(), "events.jsonl");
  if (!olderThanDays(eventsLog, EVENTS_LOG_RETENTION_DAYS)) return;
  renameSync(eventsLog, `${eventsLog}.1`);
}

function pruneAbandonedState(sessionId: string, ownState: string | undefined): void {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateFile === ownState) continue;
    if (existsSync(`${stateFile}.lock`)) continue;
    if (!olderThanDays(stateFile, ABANDONED_STATE_DAYS)) continue;
    const abandonedId = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(abandonedId, stateFile);
    rmSync(stateFile, { force: true });
  }
}

function olderThanDays(target: string, days: number): boolean {
  const age = secondsSinceModified(target);
  return age !== undefined && age >= days * SECONDS_PER_DAY;
}

function stateValueOf(stateFile: string, key: string): string {
  const read = readStateFile(stateFile);
  return read.kind === "ok" ? stateValue(read.content, key) : "";
}

function stateFilesSorted(): string[] {
  return directoryEntries(stateRootDirectory())
    .filter((name) => name.endsWith(".state"))
    .sort()
    .map((name) => path.join(stateRootDirectory(), name))
    .filter((target) => isFile(target));
}

function subdirectoriesSorted(directory: string): string[] {
  return directoryEntries(directory)
    .sort()
    .map((name) => path.join(directory, name))
    .filter((target) => isDirectory(target));
}

function directoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function isFile(target: string): boolean {
  const stats = statSync(target, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile();
}

function gitWorktreeRemove(repoPath: string, worktreePath: string): boolean {
  try {
    execFileSync("git", ["-C", repoPath, "worktree", "remove", worktreePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitWorktreePrune(repoPath: string): boolean {
  try {
    execFileSync("git", ["-C", repoPath, "worktree", "prune"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
