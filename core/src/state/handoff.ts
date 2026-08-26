import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import * as store from "./store.ts";

export class HandoffFailure extends Error {}

export type HandoffCoordinates = {
  slice: string;
  attempt: string;
  agentId: string;
  agentType: string;
};

const MAX_TIMEOUT_SECONDS = 600;
const TTL_SECONDS = 86400;
const LOCK_TIMEOUT_SECONDS = 2;
const POLL_INTERVAL_MS = 50;

const OPAQUE_ID_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
const OPAQUE_ID_MAX_LENGTH = 256;
const ATTEMPT_PATTERN = /^[1-9][0-9]{0,8}$/;
const ATTEMPT_VALUE_PATTERN = /^attempt=[1-9][0-9]{0,8}$/;
const TIMEOUT_PATTERN = /^(0|[1-9][0-9]{0,2})$/;

const RECEIPT_ARTIFACT_PATTERN = /^([0-9a-f]{64})\.(receipt|consumed|watermark)$/;
const TEMP_ARTIFACT_PATTERN = /^\.([0-9a-f]{64})\.(receipt|consuming|watermark)\.[a-zA-Z0-9]{6}$/;
const RECEIPT_KEYS = ["version", "hook_session", "slice", "attempt", "agent_id", "agent_type"] as const;
const WATERMARK_KEYS = ["version", "attempt"] as const;

export function runHandoffPublish(cwd: string, coordinates: HandoffCoordinates, hookSession: string): void {
  validateCoordinates(coordinates);
  if (!isValidOpaqueId(hookSession)) throw new HandoffFailure("invalid hook session id");
  const paths = handoffPaths(cwd, coordinates.agentId);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  protectDirectory(paths.directory);
  globalSweep(paths.directory);
  acquireHandoffLock(paths, nowEpochSeconds() + LOCK_TIMEOUT_SECONDS);
  try {
    pruneLocked(paths);
    const newest = newestRecordedAttempt(paths);
    const attempt = Number(coordinates.attempt);
    if (attempt < newest) {
      throw new HandoffFailure(`stale publish for slice ${coordinates.slice}: attempt ${attempt}, newest ${newest}`);
    }
    if (attempt === newest) {
      if (
        existsSync(paths.receipt) &&
        receiptMatches(paths.receipt, coordinates) &&
        recordsInclude(paths.receipt, `hook_session=${hookSession}`)
      ) {
        return;
      }
      throw new HandoffFailure(`attempt ${attempt} for slice ${coordinates.slice} was already published or consumed`);
    }
    const content = receiptContent(hookSession, coordinates);
    store.writeFileAtomically(paths.directory, paths.receipt, content, `.${paths.agentKey}.receipt.`);
    writeWatermark(paths, coordinates.attempt);
  } finally {
    releaseHandoffLock(paths);
  }
}

export function runHandoffWait(cwd: string, coordinates: HandoffCoordinates, timeoutText: string): string {
  validateCoordinates(coordinates);
  if (!isValidTimeoutText(timeoutText)) {
    throw new HandoffFailure(`timeout must be an integer from 0 to ${MAX_TIMEOUT_SECONDS}`);
  }
  const paths = handoffPaths(cwd, coordinates.agentId);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  globalSweep(paths.directory);
  const deadline = nowEpochSeconds() + Number(timeoutText);
  for (;;) {
    const lockDeadline = Math.min(nowEpochSeconds() + LOCK_TIMEOUT_SECONDS, deadline);
    acquireHandoffLock(paths, lockDeadline);
    let receiptText: string | undefined;
    try {
      pruneLocked(paths);
      receiptText = matchingReceiptOrStop(paths, coordinates);
    } finally {
      releaseHandoffLock(paths);
    }
    if (receiptText !== undefined) return receiptText;
    if (nowEpochSeconds() >= deadline) {
      throw new HandoffFailure(
        `timed out waiting for slice ${coordinates.slice} attempt ${coordinates.attempt} after ${timeoutText}s`,
      );
    }
    store.sleepSync(POLL_INTERVAL_MS);
  }
}

export function runHandoffConsume(cwd: string, coordinates: HandoffCoordinates): string {
  validateCoordinates(coordinates);
  const paths = handoffPaths(cwd, coordinates.agentId);
  if (!store.isDirectory(paths.directory)) {
    throw new HandoffFailure(`no receipt for slice ${coordinates.slice} attempt ${coordinates.attempt}`);
  }
  globalSweep(paths.directory);
  acquireHandoffLock(paths, nowEpochSeconds() + LOCK_TIMEOUT_SECONDS);
  try {
    pruneLocked(paths);
    if (!existsSync(paths.receipt)) {
      throw new HandoffFailure(`no unconsumed receipt for slice ${coordinates.slice} attempt ${coordinates.attempt}`);
    }
    requireMatchingReceipt(paths.receipt, coordinates, "receipt identity does not match the delegated result");
    const content = readFileSync(paths.receipt, "utf8");
    writeWatermark(paths, coordinates.attempt);
    rmSync(paths.receipt, { force: true });
    return content;
  } finally {
    releaseHandoffLock(paths);
  }
}

function matchingReceiptOrStop(paths: HandoffPaths, coordinates: HandoffCoordinates): string | undefined {
  if (existsSync(paths.receipt)) {
    requireMatchingReceipt(paths.receipt, coordinates, "receipt identity does not match the awaited delegation");
    return readFileSync(paths.receipt, "utf8");
  }
  if (existsSync(paths.watermark)) {
    if (!watermarkIsValid(paths.watermark)) throw new HandoffFailure(`malformed watermark at ${paths.watermark}`);
    if (attemptOf(paths.watermark) >= Number(coordinates.attempt)) {
      throw new HandoffFailure(
        `receipt for slice ${coordinates.slice} attempt ${coordinates.attempt} was already consumed or superseded`,
      );
    }
  }
  return undefined;
}

function requireMatchingReceipt(receiptPath: string, coordinates: HandoffCoordinates, identityMessage: string): void {
  if (!receiptIsValid(receiptPath)) throw new HandoffFailure(`malformed receipt at ${receiptPath}`);
  const actualAttempt = attemptOf(receiptPath);
  if (String(actualAttempt) !== coordinates.attempt) {
    throw new HandoffFailure(
      `stale or superseding receipt for slice ${coordinates.slice}: expected attempt ${coordinates.attempt}, found ${actualAttempt}`,
    );
  }
  if (!receiptMatches(receiptPath, coordinates)) throw new HandoffFailure(identityMessage);
}

function validateCoordinates(coordinates: HandoffCoordinates): void {
  if (!store.isNameToken(coordinates.slice)) throw new HandoffFailure("invalid slice id");
  if (!ATTEMPT_PATTERN.test(coordinates.attempt)) {
    throw new HandoffFailure("attempt must be an integer from 1 to 999999999");
  }
  if (!isValidOpaqueId(coordinates.agentId)) throw new HandoffFailure("invalid agent id");
  if (!store.isNameToken(coordinates.agentType)) throw new HandoffFailure("invalid agent type");
}

function isValidOpaqueId(value: string): boolean {
  return value.length >= 1 && value.length <= OPAQUE_ID_MAX_LENGTH && OPAQUE_ID_PATTERN.test(value);
}

function isValidTimeoutText(value: string): boolean {
  return TIMEOUT_PATTERN.test(value) && Number(value) <= MAX_TIMEOUT_SECONDS;
}

type HandoffPaths = {
  directory: string;
  agentId: string;
  agentKey: string;
  receipt: string;
  watermark: string;
  lockDir: string;
};

function handoffPaths(cwd: string, agentId: string): HandoffPaths {
  const stateFile = store.stateFileFor(cwd);
  const agentKey = store.sha256Hex(agentId);
  const directory = path.join(store.stateRootDirectory(), ".handoffs", store.repositoryIdFor(stateFile));
  return {
    directory,
    agentId,
    agentKey,
    receipt: path.join(directory, `${agentKey}.receipt`),
    watermark: path.join(directory, `${agentKey}.watermark`),
    lockDir: path.join(directory, `${agentKey}.lock`),
  };
}

function protectDirectory(directory: string): void {
  try {
    chmodSync(directory, 0o700);
  } catch {
    throw new HandoffFailure("cannot protect receipt directory");
  }
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function acquireHandoffLock(paths: HandoffPaths, deadline: number): void {
  for (;;) {
    try {
      mkdirSync(paths.lockDir);
      return;
    } catch (error) {
      if (!store.isErrnoException(error) || error.code !== "EEXIST") throw error;
    }
    if (nowEpochSeconds() >= deadline) {
      throw new HandoffFailure(`could not acquire receipt lock for agent ${paths.agentId} before the bound`);
    }
    store.sleepSync(POLL_INTERVAL_MS);
  }
}

function releaseHandoffLock(paths: HandoffPaths): void {
  rmSync(paths.lockDir, { recursive: true, force: true });
}

function globalSweep(directory: string): void {
  for (const name of directoryEntries(directory)) {
    const key = sweepableArtifactKey(name);
    if (key === undefined) continue;
    sweepArtifact(path.join(directory, name), path.join(directory, `${key}.lock`));
  }
}

function sweepableArtifactKey(name: string): string | undefined {
  return name.match(RECEIPT_ARTIFACT_PATTERN)?.[1] ?? name.match(TEMP_ARTIFACT_PATTERN)?.[1];
}

function sweepArtifact(artifactPath: string, sweepLockDir: string): void {
  if (!tryAcquireBareLock(sweepLockDir)) return;
  try {
    if (!store.isRegularNonSymlinkFile(artifactPath)) return;
    const age = store.secondsSinceModified(artifactPath);
    if (age === undefined || age < TTL_SECONDS) return;
    rmSync(artifactPath, { force: true });
  } finally {
    rmSync(sweepLockDir, { recursive: true, force: true });
  }
}

function tryAcquireBareLock(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch (error) {
    if (store.isErrnoException(error) && error.code === "EEXIST") return false;
    throw error;
  }
}

function pruneLocked(paths: HandoffPaths): void {
  for (const artifact of [paths.receipt, paths.watermark, ...matchingTempArtifacts(paths)]) {
    if (!existsSync(artifact)) continue;
    if (!store.isRegularNonSymlinkFile(artifact)) {
      throw new HandoffFailure(`handoff artifact is not a regular file at ${artifact}`);
    }
    const age = store.secondsSinceModified(artifact);
    if (age === undefined) throw new HandoffFailure(`cannot determine receipt age at ${artifact}`);
    if (age >= TTL_SECONDS) rmSync(artifact, { force: true });
  }
}

function matchingTempArtifacts(paths: HandoffPaths): string[] {
  const prefixes = [`.${paths.agentKey}.receipt.`, `.${paths.agentKey}.consuming.`, `.${paths.agentKey}.watermark.`];
  return directoryEntries(paths.directory)
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => path.join(paths.directory, name));
}

function directoryEntries(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function newestRecordedAttempt(paths: HandoffPaths): number {
  let newest = 0;
  if (existsSync(paths.receipt)) {
    if (!receiptIsValid(paths.receipt)) throw new HandoffFailure(`malformed receipt at ${paths.receipt}`);
    newest = Math.max(newest, attemptOf(paths.receipt));
  }
  if (existsSync(paths.watermark)) {
    if (!watermarkIsValid(paths.watermark)) throw new HandoffFailure(`malformed watermark at ${paths.watermark}`);
    newest = Math.max(newest, attemptOf(paths.watermark));
  }
  return newest;
}

function writeWatermark(paths: HandoffPaths, attempt: string): void {
  if (existsSync(paths.watermark)) {
    if (!watermarkIsValid(paths.watermark)) throw new HandoffFailure(`malformed watermark at ${paths.watermark}`);
    const recorded = attemptOf(paths.watermark);
    const attemptNumber = Number(attempt);
    if (recorded > attemptNumber) {
      throw new HandoffFailure(`watermark attempt ${recorded} supersedes receipt attempt ${attemptNumber}`);
    }
    if (recorded === attemptNumber) return;
  }
  store.writeFileAtomically(
    paths.directory,
    paths.watermark,
    `version=1\nattempt=${attempt}\n`,
    `.${paths.agentKey}.watermark.`,
  );
}

function receiptContent(hookSession: string, coordinates: HandoffCoordinates): string {
  return (
    `version=1\nhook_session=${hookSession}\nslice=${coordinates.slice}\n` +
    `attempt=${coordinates.attempt}\nagent_id=${coordinates.agentId}\nagent_type=${coordinates.agentType}\n`
  );
}

function receiptIsValid(receiptPath: string): boolean {
  const content = readPrivateFileContent(receiptPath);
  if (content === undefined || !isWellFormedRecordFile(content, 6, RECEIPT_KEYS)) return false;
  return recordsOf(content).some((record) => ATTEMPT_VALUE_PATTERN.test(record));
}

function watermarkIsValid(watermarkPath: string): boolean {
  const content = readPrivateFileContent(watermarkPath);
  if (content === undefined || !isWellFormedRecordFile(content, 2, WATERMARK_KEYS)) return false;
  return recordsOf(content).some((record) => ATTEMPT_VALUE_PATTERN.test(record));
}

function receiptMatches(receiptPath: string, coordinates: HandoffCoordinates): boolean {
  return (
    receiptIsValid(receiptPath) &&
    recordsInclude(receiptPath, `slice=${coordinates.slice}`) &&
    recordsInclude(receiptPath, `attempt=${coordinates.attempt}`) &&
    recordsInclude(receiptPath, `agent_id=${coordinates.agentId}`) &&
    recordsInclude(receiptPath, `agent_type=${coordinates.agentType}`)
  );
}

function attemptOf(filePath: string): number {
  return Number(store.readValue(filePath, "attempt"));
}

function recordsInclude(filePath: string, record: string): boolean {
  return recordsOf(readPrivateFileContent(filePath) ?? "").includes(record);
}

function isWellFormedRecordFile(content: string, expectedNewlines: number, keys: readonly string[]): boolean {
  if (newlineCount(content) !== expectedNewlines) return false;
  const records = recordsOf(content);
  if (records.some((record) => !keys.some((key) => record.startsWith(`${key}=`)))) return false;
  if (records.filter((record) => record === "version=1").length !== 1) return false;
  return keys
    .filter((key) => key !== "version")
    .every((key) => records.filter((record) => record.startsWith(`${key}=`)).length === 1);
}

function newlineCount(content: string): number {
  return (content.match(/\n/g) ?? []).length;
}

function recordsOf(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function readPrivateFileContent(target: string): string | undefined {
  if (!store.isReadableRegularFile(target)) return undefined;
  return readFileSync(target, "utf8");
}
