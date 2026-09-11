import { chmodSync, existsSync, lstatSync, mkdirSync, opendirSync, readFileSync, readdirSync, realpathSync, rmSync, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import { CODEX_METADATA_READINESS_MS, CODEX_UUID_PATTERN, CodexMetadataFailure, readBoundedRegularFile, readCodexSessionMetadata, requireMetadataTime, type CodexSessionMetadata } from "../hosts/codex-session-metadata.ts";
import * as store from "./store.ts";

export class HandoffFailure extends Error {}

export type FinishedDelegation = Readonly<{ slice: string; attempt: string; agentId: string }>;

export type HandoffCoordinates = FinishedDelegation & Readonly<{ agentType: string }>;

const MAX_TIMEOUT_SECONDS = 600;
const TTL_SECONDS = 86400;
const LOCK_TIMEOUT_SECONDS = 2;
const POLL_INTERVAL_MS = 50;

const OPAQUE_ID_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
const OPAQUE_ID_MAX_LENGTH = 256;
const ATTEMPT_PATTERN = /^[1-9][0-9]{0,8}$/;
const ATTEMPT_VALUE_PATTERN = /^attempt=[1-9][0-9]{0,8}$/;
const TIMEOUT_PATTERN = /^(0|[1-9][0-9]{0,2})$/;

const RECEIPT_ARTIFACT_PATTERN = /^([0-9a-f]{64})\.(receipt|consumed|watermark|unpublished)$/;
const TEMP_ARTIFACT_PATTERN = /^\.([0-9a-f]{64})\.(receipt|consuming|watermark|unpublished)\.[a-zA-Z0-9]{6}$/;
const RECEIPT_KEYS = ["version", "hook_session", "slice", "attempt", "agent_id", "agent_type"] as const;
const WATERMARK_KEYS = ["version", "attempt"] as const;
const UNPUBLISHED_KEYS = ["version", "slice", "attempt", "reason"] as const;
const REFUSAL_PATTERN = /^[ -~]{1,200}$/;

export function runHandoffResolveCodex(cwd: string, coordinates: Omit<HandoffCoordinates, "agentId"> & { agentPath: string }): string {
  const parentId = process.env["CODEX_THREAD_ID"] ?? "";
  if (!CODEX_UUID_PATTERN.test(parentId)) throw new HandoffFailure("resolve-codex requires a valid current CODEX_THREAD_ID");
  validateCoordinates({ ...coordinates, agentId: parentId });
  if (!/^\/root(?:\/[a-zA-Z0-9_-]+)+$/.test(coordinates.agentPath)) throw new HandoffFailure("invalid canonical Codex agent path");
  const deadline = performance.now() + CODEX_METADATA_READINESS_MS;
  try {
    const repository = nativeRepositoryIdentity(cwd, deadline);
    const directory = receiptDirectoryFor(cwd);
    const candidates = codexReceiptCandidates(directory, coordinates, deadline);
    const codexHome = process.env["CODEX_HOME"] || path.join(store.homeDirectoryFrom(process.platform, process.env), ".codex");
    const matches = new Set<string>();
    let unreadableRollout: CodexMetadataFailure | undefined;
    for (const rollout of rolloutPaths(path.join(codexHome, "sessions"), deadline)) {
      let metadata: CodexSessionMetadata;
      try {
        metadata = readCodexSessionMetadata(rollout, deadline);
      } catch (error) {
        if (!(error instanceof CodexMetadataFailure)) throw error;
        unreadableRollout ??= error;
        continue;
      }
      if (!candidates.has(metadata.id)) continue;
      if (metadata.parentThreadId !== parentId || metadata.agentPath !== coordinates.agentPath || metadata.agentRole !== coordinates.agentType) continue;
      if (metadata.id === parentId || nativeRepositoryIdentity(metadata.cwd, deadline) !== repository) continue;
      if (matches.has(metadata.id)) throw new HandoffFailure(`ambiguous native rollouts for ${metadata.id}`);
      matches.add(metadata.id);
    }
    if (matches.size === 0 && unreadableRollout !== undefined) throw unreadableRollout;
    if (matches.size !== 1) throw new HandoffFailure(`expected exactly one current Codex receipt match, found ${matches.size}`);
    const id = [...matches][0] as string;
    const receipt = candidates.get(id) as string;
    if (readCurrentCodexReceipt(directory, `${store.sha256Hex(id)}.receipt`, coordinates, deadline) !== receipt) {
      throw new HandoffFailure("Codex receipt changed during resolution");
    }
    requireMetadataTime(deadline);
    return id;
  } catch (error) {
    if (error instanceof HandoffFailure) throw error;
    if (!isNativeResolutionFault(error)) throw error;
    throw new HandoffFailure(`cannot resolve Codex handoff: ${store.causeOf(error)}`, { cause: error });
  }
}

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
    rmSync(paths.unpublished, { force: true });
  } finally {
    releaseHandoffLock(paths);
  }
}

export function runHandoffRecordUnpublished(cwd: string, delegation: FinishedDelegation, refusal: string): void {
  validateDelegation(delegation);
  if (!REFUSAL_PATTERN.test(refusal)) throw new HandoffFailure("a publish refusal must be one printable line");
  const paths = handoffPaths(cwd, delegation.agentId);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  protectDirectory(paths.directory);
  acquireHandoffLock(paths, nowEpochSeconds() + LOCK_TIMEOUT_SECONDS);
  try {
    const content = `version=1\nslice=${delegation.slice}\nattempt=${delegation.attempt}\nreason=${refusal}\n`;
    store.writeFileAtomically(paths.directory, paths.unpublished, content, `.${paths.agentKey}.unpublished.`);
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
  const refusal = unpublishedRefusalOf(paths, coordinates);
  if (refusal !== undefined) {
    throw new HandoffFailure(
      `agent ${coordinates.agentId} finished slice ${coordinates.slice} attempt ${coordinates.attempt}, but its ` +
        `SubagentStop could not publish the receipt: ${refusal}. Read that agent's own final message for the ` +
        "verdict it produced; relaunching it would repeat work it has already done.",
    );
  }
  return undefined;
}

function unpublishedRefusalOf(paths: HandoffPaths, delegation: FinishedDelegation): string | undefined {
  const content = readPrivateFileContent(paths.unpublished);
  if (content === undefined) return undefined;
  if (!isWellFormedRecordFile(content, UNPUBLISHED_KEYS.length, UNPUBLISHED_KEYS)) {
    throw new HandoffFailure(`malformed unpublished record at ${paths.unpublished}`);
  }
  if (recordValue(content, "slice") !== delegation.slice || recordValue(content, "attempt") !== delegation.attempt) {
    return undefined;
  }
  return recordValue(content, "reason");
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
  validateDelegation(coordinates);
  if (!store.isNameToken(coordinates.agentType)) throw new HandoffFailure("invalid agent type");
}

function validateDelegation(delegation: FinishedDelegation): void {
  if (!store.isNameToken(delegation.slice)) throw new HandoffFailure("invalid slice id");
  if (!ATTEMPT_PATTERN.test(delegation.attempt)) {
    throw new HandoffFailure("attempt must be an integer from 1 to 999999999");
  }
  if (!isValidOpaqueId(delegation.agentId)) throw new HandoffFailure("invalid agent id");
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
  unpublished: string;
  lockDir: string;
};

function receiptDirectoryFor(cwd: string): string {
  return store.receiptDirectoryKeyedBy(store.repositoryIdFor(store.stateFileFor(cwd)));
}

function handoffPaths(cwd: string, agentId: string): HandoffPaths {
  const agentKey = store.sha256Hex(agentId);
  const directory = receiptDirectoryFor(cwd);
  return {
    directory,
    agentId,
    agentKey,
    receipt: path.join(directory, `${agentKey}.receipt`),
    watermark: path.join(directory, `${agentKey}.watermark`),
    unpublished: path.join(directory, `${agentKey}.unpublished`),
    lockDir: path.join(directory, `${agentKey}.lock`),
  };
}

function protectDirectory(directory: string): void {
  try {
    chmodSync(directory, 0o700);
  } catch (error) {
    throw new HandoffFailure("cannot protect receipt directory", { cause: error });
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
  for (const artifact of [paths.receipt, paths.watermark, paths.unpublished, ...matchingTempArtifacts(paths)]) {
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
  const prefixes = [`.${paths.agentKey}.receipt.`, `.${paths.agentKey}.consuming.`, `.${paths.agentKey}.watermark.`, `.${paths.agentKey}.unpublished.`];
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

export function nativeRepositoryIdentity(cwd: string, deadline: number): string {
  requireMetadataTime(deadline);
  if (!path.isAbsolute(cwd)) throw new HandoffFailure(`native workspace is not absolute: ${cwd}`);
  const answered = store.gitCommonDirectory(cwd, Math.max(1, Math.ceil(deadline - performance.now())));
  if (answered.kind === "refused") throw new HandoffFailure(`cannot resolve Codex handoff: ${answered.cause}`);
  return realpathSync(answered.commonDirectory);
}

export function isNativeResolutionFault(error: unknown): boolean {
  const gitExitedNonZero = error instanceof Error && "status" in error;
  return error instanceof CodexMetadataFailure || error instanceof HandoffFailure || store.isErrnoException(error) || gitExitedNonZero;
}

function codexReceiptCandidates(directory: string, coordinates: Omit<HandoffCoordinates, "agentId">, deadline: number): Map<string, string> {
  const candidates = new Map<string, string>();
  const maxCandidates = 128;
  for (const file of boundedDirectoryFiles({ directory, deadline, recursive: false })) {
    const name = path.basename(file);
    if (!/^[0-9a-f]{64}\.receipt$/.test(name)) continue;
    const content = readCurrentCodexReceipt(directory, name, coordinates, deadline);
    if (content === undefined) continue;
    const agentId = recordValue(content, "agent_id");
    candidates.set(agentId, content);
    if (candidates.size > maxCandidates) throw new HandoffFailure(`more than ${maxCandidates} matching Codex receipts`);
  }
  return candidates;
}

function readCurrentCodexReceipt(directory: string, name: string, coordinates: Omit<HandoffCoordinates, "agentId">, deadline: number): string | undefined {
  const file = path.join(directory, name);
  const { text, stat } = readBoundedRegularFile({ file, deadline, maxBytes: 4096, firstRecord: false });
  if (!isWellFormedRecordFile(text, 6, RECEIPT_KEYS) || !ATTEMPT_PATTERN.test(recordValue(text, "attempt"))) {
    throw new HandoffFailure(`malformed receipt at ${file}`);
  }
  if (recordValue(text, "slice") !== coordinates.slice || recordValue(text, "attempt") !== coordinates.attempt || recordValue(text, "agent_type") !== coordinates.agentType) return undefined;
  const agentId = recordValue(text, "agent_id");
  if (!CODEX_UUID_PATTERN.test(agentId)) return undefined;
  if (!isValidOpaqueId(recordValue(text, "hook_session")) || name !== `${store.sha256Hex(agentId)}.receipt`) throw new HandoffFailure(`invalid Codex receipt identity at ${file}`);
  if (Date.now() - stat.mtimeMs >= TTL_SECONDS * 1000) return undefined;
  const watermark = path.join(directory, `${store.sha256Hex(agentId)}.watermark`);
  const recorded = readBoundedRegularFile({ file: watermark, deadline, maxBytes: 4096, firstRecord: false });
  if (!isWellFormedRecordFile(recorded.text, 2, WATERMARK_KEYS) || !ATTEMPT_PATTERN.test(recordValue(recorded.text, "attempt"))) throw new HandoffFailure(`malformed watermark at ${watermark}`);
  if (Date.now() - recorded.stat.mtimeMs >= TTL_SECONDS * 1000 || recordValue(recorded.text, "attempt") !== coordinates.attempt) return undefined;
  return text;
}

function recordValue(content: string, key: string): string {
  return recordsOf(content).find((record) => record.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";
}

function* rolloutPaths(directory: string, deadline: number): Generator<string> {
  for (const file of boundedDirectoryFiles({ directory, deadline, recursive: true })) {
    if (/^rollout-.*\.jsonl$/.test(path.basename(file))) yield file;
  }
}

const MAX_CODEX_PATHS = 10000;

function* boundedDirectoryFiles({ directory, deadline, recursive }: Readonly<{
  directory: string; deadline: number; recursive: boolean;
}>): Generator<string> {
  const pending = [directory];
  let enumerated = 0;
  while (pending.length > 0) {
    requireMetadataTime(deadline);
    const current = pending.pop() as string;
    const before = lstatSync(current);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new HandoffFailure(`not a non-symlink directory: ${current}`);
    const entries = readPinnedDirectory({ directory: current, before, deadline, remainingPaths: MAX_CODEX_PATHS - enumerated });
    enumerated += entries.length;
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory() && recursive) pending.push(file);
      else if (!entry.isDirectory()) yield file;
    }
    const after = lstatSync(current);
    if (before.dev !== after.dev || before.ino !== after.ino || after.isSymbolicLink()) throw new HandoffFailure(`Codex directory changed while reading ${current}`);
  }
}

function readPinnedDirectory({ directory, before, deadline, remainingPaths }: Readonly<{
  directory: string; before: Stats; deadline: number; remainingPaths: number;
}>): Dirent[] {
  const callerDirectory = process.cwd();
  try {
    process.chdir(directory);
    const pinned = lstatSync(".");
    if (!pinned.isDirectory() || before.dev !== pinned.dev || before.ino !== pinned.ino) {
      throw new HandoffFailure(`Codex directory changed before opening ${directory}`);
    }
    const opened = opendirSync(".");
    try {
      const entries: Dirent[] = [];
      for (let entry = opened.readSync(); entry !== null; entry = opened.readSync()) {
        requireMetadataTime(deadline);
        if (entries.length >= remainingPaths) throw new HandoffFailure(`more than ${MAX_CODEX_PATHS} enumerated Codex paths`);
        entries.push(entry);
      }
      return entries;
    } finally { opened.closeSync(); }
  } finally { process.chdir(callerDirectory); }
}
