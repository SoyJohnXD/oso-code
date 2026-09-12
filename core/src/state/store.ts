import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export class LockTimeoutError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`could not acquire lock for session ${sessionId}`);
    this.name = "LockTimeoutError";
    this.sessionId = sessionId;
  }
}

export class JournalAppendError extends Error {
  readonly journalFile: string;
  constructor(journalFile: string, options?: ErrorOptions) {
    super(`cannot append the milestone to ${journalFile}`, options);
    this.name = "JournalAppendError";
    this.journalFile = journalFile;
  }
}

export class StateFileUnreadableError extends Error {
  readonly stateFile: string;
  constructor(stateFile: string, cause: string) {
    super(`cannot read state at ${stateFile}: ${cause}`);
    this.name = "StateFileUnreadableError";
    this.stateFile = stateFile;
  }
}

export class StateRootUnwritableError extends Error {
  readonly directory: string;
  constructor(directory: string, cause: unknown) {
    super(unwritableStateRootMessage(directory, cause));
    this.name = "StateRootUnwritableError";
    this.directory = directory;
  }
}

function unwritableStateRootMessage(directory: string, cause: unknown): string {
  return (
    `cannot write the oso-code state directory ${directory}: ${causeOf(cause)}. The gates read what it holds and ` +
    `treat an unwritten state as no armed session, so arming here would leave them unable to see their own ` +
    `state. ${remedyForUnwritableStateRoot(cause, directory)}`
  );
}

function remedyForUnwritableStateRoot(cause: unknown, directory: string): string {
  const code = isErrnoException(cause) ? cause.code : undefined;
  if (code === "EROFS") {
    return (
      "The active permission mode is read-only, so no writable-root declaration can change that — pick a mode " +
      "that can write, then arm again."
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return (
      `Grant the directory to the active permission mode — add it to that profile's workspace roots, launch with ` +
      `--add-dir ${directory}, or pick a mode that can write — then arm again.`
    );
  }
  if (code === "EEXIST" || code === "ENOTDIR") {
    const occupiedPath = code === "EEXIST" ? directory : `a parent directory of ${directory}`;
    return (
      `A file already occupies ${occupiedPath}, so no directory can stand there — move or remove what is in the ` +
      `way, or point OSO_STATE_DIR elsewhere, then arm again.`
    );
  }
  if (code === "ELOOP") {
    return (
      `A symlink loop sits on the way to ${directory}, so it can neither be created nor reached — undo the loop, ` +
      `or point OSO_STATE_DIR at a path that is not caught in one, then arm again.`
    );
  }
  if (code === "ENAMETOOLONG") {
    return (
      `${directory} is too long a path for the filesystem to create, and no permission or declaration change ` +
      `shortens it — point OSO_STATE_DIR at a shorter path, then arm again.`
    );
  }
  if (code === "ENOSPC" || code === "EDQUOT") {
    return (
      `The filesystem behind ${directory} has no room left for it, and no permission or declaration change frees ` +
      `any — clear space or quota there, or point OSO_STATE_DIR at a volume with room, then arm again.`
    );
  }
  return (
    `${code ?? "the cause"} is not one this rail can name from an errno alone — check whether ${directory} sits ` +
    `behind a read-only mode, an undeclared workspace root, or something else entirely, then arm again once ` +
    `whatever stands in the way is cleared.`
  );
}

export const TASK_ROOT_VARIABLE = "OSO_TASK_ROOT";

class TaskIdentityUnknownError extends Error {
  readonly cwd: string;
  constructor(cwd: string, cause: string) {
    super(
      `cannot name the task ${cwd} belongs to: ${cause}. The harness keys its state, its run journal and its ` +
        `receipts by one task identity, and it never infers one from the directory it happens to run in — a ` +
        `guessed identity arms one repository's gates on another repository's flags. Run from inside a git ` +
        `repository, or declare the root this task owns with ${TASK_ROOT_VARIABLE}=<absolute path>, then run again.`,
    );
    this.name = "TaskIdentityUnknownError";
    this.cwd = cwd;
  }
}

export const CHANGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const MODEL_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/:._@-]*$/;
const TOKEN_MAX_LENGTH = 128;
const LOCK_STALE_SECONDS = 30;
const LOCK_MAX_TRIES = 200;
const LOCK_RETRY_MS = 50;
const EVENTS_SCHEMA_VERSION = 2;
const BYTES_A_GATE_CAN_READ = 3072;

export function sha256Hex(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stateRootDirectory(): string {
  const configured = process.env["OSO_STATE_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}

export type NamedTaskIdentity = Readonly<{ kind: "declared" | "repository"; identity: string; stateFile: string }>;

export type TaskIdentity =
  | NamedTaskIdentity
  | Readonly<{ kind: "unknown"; cwd: string; cause: string; inferredIdentity: string }>;

export type StateAtAnotherIdentity = Readonly<{ identity: string; stateFile: string }>;

export function taskIdentityFor(cwd: string): TaskIdentity {
  const stateRoot = stateRootDirectory();
  const directory = withoutTrailingReturn(cwd);
  const declaration = process.env[TASK_ROOT_VARIABLE] ?? "";
  if (declaration === "") return gitAnsweredIdentity(stateRoot, directory);
  const declared = declaredRootOf(declaration);
  if (declared.kind === "refused") return unnamedIdentity(directory, declared.cause, inferredIdentityFor(directory));
  return identityUnderTheDeclaredRoot(stateRoot, directory, declared.root);
}

function identityUnderTheDeclaredRoot(stateRoot: string, directory: string, root: string): TaskIdentity {
  if (declaredRootCovers(root, realPathOrUndefined(directory) ?? directory)) {
    return namedIdentity(stateRoot, "declared", root);
  }
  const answered = gitCommonDirectory(directory);
  if (answered.kind === "refused") {
    const uncovered = `, and ${TASK_ROOT_VARIABLE} declares ${root}, which does not contain it`;
    return unnamedIdentity(directory, `${answered.cause}${uncovered}`, directory);
  }
  if (declaredRootSharesTheRepository(root, answered.commonDirectory)) return namedIdentity(stateRoot, "declared", root);
  return namedIdentity(stateRoot, "repository", answered.commonDirectory);
}

function declaredRootSharesTheRepository(root: string, commonDirectory: string): boolean {
  const answered = gitCommonDirectory(root);
  return answered.kind === "answered" && answered.commonDirectory === commonDirectory;
}

function gitAnsweredIdentity(stateRoot: string, directory: string): TaskIdentity {
  const answered = gitCommonDirectory(directory);
  if (answered.kind === "answered") return namedIdentity(stateRoot, "repository", answered.commonDirectory);
  return unnamedIdentity(directory, answered.cause, directory);
}

function namedIdentity(stateRoot: string, kind: NamedTaskIdentity["kind"], identity: string): NamedTaskIdentity {
  return { kind, identity, stateFile: stateFileOfIdentity(stateRoot, identity) };
}

function unnamedIdentity(cwd: string, cause: string, inferredIdentity: string): TaskIdentity {
  return { kind: "unknown", cwd, cause, inferredIdentity };
}

function requireTaskIdentity(cwd: string): NamedTaskIdentity {
  const task = taskIdentityFor(cwd);
  if (task.kind === "unknown") throw new TaskIdentityUnknownError(task.cwd, task.cause);
  return task;
}

export function inferredIdentityFor(cwd: string): string {
  const directory = withoutTrailingReturn(cwd);
  const answered = gitCommonDirectory(directory);
  return answered.kind === "answered" ? answered.commonDirectory : directory;
}

export function stateKeyedByAnotherTaskIdentity(cwd: string, task: TaskIdentity): StateAtAnotherIdentity | undefined {
  return artifactsLeftAtTheInferredIdentity(cwd, task) ?? taskArmedAboveThisDirectory(cwd, task);
}

function artifactsLeftAtTheInferredIdentity(cwd: string, task: TaskIdentity): StateAtAnotherIdentity | undefined {
  if (task.kind === "repository") return undefined;
  const identity = task.kind === "unknown" ? task.inferredIdentity : inferredIdentityFor(cwd);
  if (task.kind === "declared" && identity === task.identity) return undefined;
  const left = { identity, stateFile: stateFileOfIdentity(stateRootDirectory(), identity) };
  return taskArtifactsStandAt(left) ? left : undefined;
}

export function taskArtifactsStandAt({ identity, stateFile }: StateAtAnotherIdentity): boolean {
  if (readStateFile(stateFile).kind !== "absent") return true;
  const repositoryId = sha256Hex(identity);
  return [...KEYED_ARTIFACT_FILES, ...KEYED_ARTIFACT_TREES].some((keyedBy) => existsSync(keyedBy(repositoryId)));
}

function taskArmedAboveThisDirectory(cwd: string, task: TaskIdentity): StateAtAnotherIdentity | undefined {
  if (task.kind === "declared") return undefined;
  const stateRoot = stateRootDirectory();
  const directory = withoutTrailingReturn(cwd);
  const mainCheckout = task.kind === "repository" ? [path.dirname(task.identity)] : [];
  return [...mainCheckout, ...ancestorsOf(realPathOrUndefined(directory) ?? directory)]
    .map((identity) => ({ identity, stateFile: stateFileOfIdentity(stateRoot, identity) }))
    .find((candidate) => readStateFile(candidate.stateFile).kind !== "absent");
}

function ancestorsOf(directory: string): string[] {
  const walked: string[] = [];
  for (let candidate = directory; !walked.includes(candidate); candidate = path.dirname(candidate)) walked.push(candidate);
  return walked;
}

function stateFileOfIdentity(stateRoot: string, identity: string): string {
  return path.join(stateRoot, `${sha256Hex(identity)}.state`);
}

type DeclaredRoot = Readonly<{ kind: "root"; root: string }> | Readonly<{ kind: "refused"; cause: string }>;

function declaredRootOf(declaration: string): DeclaredRoot {
  if (!path.isAbsolute(declaration)) {
    return { kind: "refused", cause: `${TASK_ROOT_VARIABLE} is not an absolute path: ${declaration}` };
  }
  const root = realPathOrUndefined(declaration);
  if (root === undefined || !isDirectory(root)) {
    return { kind: "refused", cause: `${TASK_ROOT_VARIABLE} names no readable directory: ${declaration}` };
  }
  return { kind: "root", root };
}

function declaredRootCovers(root: string, directory: string): boolean {
  const stepsDown = path.relative(root, directory);
  if (stepsDown === "") return true;
  return !path.isAbsolute(stepsDown) && stepsDown !== ".." && !stepsDown.startsWith(`..${path.sep}`);
}

function withoutTrailingReturn(cwd: string): string {
  return cwd.replace(/\r$/, "");
}

export function repositoryIdentityFor(cwd: string): string {
  return requireTaskIdentity(cwd).identity;
}

export function stateFileFor(cwd: string): string {
  return requireTaskIdentity(cwd).stateFile;
}

export function repositoryIdFor(stateFile: string): string {
  return path.basename(stateFile, ".state");
}

export function journalFileFor(cwd: string): string {
  const stateFile = stateFileFor(cwd);
  const autoChange = readValue(stateFile, "auto_change") ?? "";
  const change = CHANGE_SLUG_PATTERN.test(autoChange) ? autoChange : "run";
  return path.join(runsDirectoryKeyedBy(repositoryIdFor(stateFile)), `${change}.log`);
}

export function runsDirectoryKeyedBy(repositoryId: string): string {
  return path.join(stateRootDirectory(), "runs", repositoryId);
}

export function denyPatternsFileFor(stateFile: string): string {
  return denyPatternsFileKeyedBy(repositoryIdFor(stateFile));
}

export function denyPatternsFileKeyedBy(repositoryId: string): string {
  return path.join(stateRootDirectory(), "deploy-deny", `${repositoryId}.patterns`);
}

export function profileFileFor(stateFile: string): string {
  return profileFileKeyedBy(repositoryIdFor(stateFile));
}

export function profileFileKeyedBy(repositoryId: string): string {
  return path.join(stateRootDirectory(), "profiles", `${repositoryId}.profile`);
}

export function planRootDirectory(): string {
  return path.join(stateRootDirectory(), "plans");
}

export function planDirectoryKeyedBy(repositoryId: string): string {
  return path.join(planRootDirectory(), repositoryId);
}

export function receiptDirectoryKeyedBy(repositoryId: string): string {
  return path.join(stateRootDirectory(), ".handoffs", repositoryId);
}

export type ArtifactKeyedByRepository = (repositoryId: string) => string;

export const KEYED_ARTIFACT_FILES: readonly ArtifactKeyedByRepository[] = [denyPatternsFileKeyedBy, profileFileKeyedBy];

export const KEYED_ARTIFACT_TREES: readonly ArtifactKeyedByRepository[] = [
  runsDirectoryKeyedBy,
  planDirectoryKeyedBy,
  receiptDirectoryKeyedBy,
];

export const MODEL_TOKEN_SHAPE = `1 to ${TOKEN_MAX_LENGTH} characters of letters, digits and / : . - _ @`;

export function isNameToken(value: string): boolean {
  return value.length >= 1 && value.length <= TOKEN_MAX_LENGTH && NAME_TOKEN_PATTERN.test(value);
}

export function isModelToken(value: string): boolean {
  return value.length >= 1 && value.length <= TOKEN_MAX_LENGTH && MODEL_TOKEN_PATTERN.test(value);
}

export function stateRecords(content: string, key: string): readonly string[] {
  const prefix = `${key}=`;
  return content
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

export function stateValue(content: string, key: string): string {
  return stateRecords(content, key).join("\n");
}

export function stateSays(content: string, key: string, value: string): boolean {
  return stateRecords(content, key).includes(value);
}

export function readValue(stateFile: string, key: string): string | undefined {
  const content = readFileIfPresent(stateFile);
  if (content === undefined || stateRecords(content, key).length === 0) return undefined;
  return stateValue(content, key);
}

export type StateFileRead =
  | { kind: "absent" }
  | { kind: "ok"; content: string }
  | { kind: "unreadable"; cause: string };

export function readStateFile(stateFile: string): StateFileRead {
  try {
    if (!statSync(stateFile).isFile()) return { kind: "unreadable", cause: `${stateFile} is not a regular file` };
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
  }
}

export function writeStatePairs(stateFile: string, pairs: readonly string[], sessionId: string): void {
  const directory = path.dirname(stateFile);
  const read = readStateFile(stateFile);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(stateFile, read.cause);
  const existing = read.kind === "ok" ? read.content : "";
  let lines = parseStateLines(existing);
  for (const pair of [...pairs, `session=${sessionId}`]) {
    const [key, value] = splitPair(pair);
    lines = lines.filter((line) => line.key !== key);
    lines.push({ key, value });
  }
  const tempFile = createTempFile(directory, serializeStateLines(lines));
  renameSync(tempFile, stateFile);
}

export function writeStateValues(cwd: string, sessionId: string, pairs: readonly string[]): void {
  const stateFile = stateFileFor(cwd);
  requireWritableStateRoot();
  withLock(stateFile, sessionId, () => {
    writeStatePairs(stateFile, pairs, sessionId);
    logEvent({ event: `set:${pairs.join(" ")}`, session: sessionId });
  });
}

const OWNER_ONLY_DIRECTORY = 0o700;
const GROUP_AND_OTHER_ACCESS = 0o077;

export function requireWritableStateRoot(): void {
  const directory = stateRootDirectory();
  try {
    mkdirSync(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    dropGroupAndOtherAccess(directory);
    accessSync(directory, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new StateRootUnwritableError(directory, error);
  }
}

function dropGroupAndOtherAccess(directory: string): void {
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || (stats.mode & GROUP_AND_OTHER_ACCESS) === 0) return;
  chmodSync(directory, stats.mode & OWNER_ONLY_DIRECTORY);
}

export function stateRootWritabilityFault(): string | undefined {
  const directory = stateRootDirectory();
  if (!isDirectory(directory)) return undefined;
  try {
    accessSync(directory, constants.W_OK | constants.X_OK);
    return undefined;
  } catch (error) {
    return unwritableStateRootMessage(directory, error);
  }
}

export function clearStateFile(stateFile: string): void {
  rmSync(stateFile, { force: true });
}

export function isSymlink(target: string): boolean {
  const stats = lstatOrUndefined(target);
  return stats !== undefined && stats.isSymbolicLink();
}

export function isDirectory(target: string): boolean {
  const stats = statOrUndefined(target);
  return stats !== undefined && stats.isDirectory();
}

export function isDirectoryNotSymlink(target: string): boolean {
  const stats = lstatOrUndefined(target);
  return stats !== undefined && stats.isDirectory();
}

export function isRegularNonSymlinkFile(target: string): boolean {
  const stats = lstatOrUndefined(target);
  return stats !== undefined && stats.isFile();
}

export function isReadableRegularFile(target: string): boolean {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function filesHoldTheSameBytes(one: string, other: string): boolean {
  if (!isReadableRegularFile(one) || !isReadableRegularFile(other)) return false;
  return readFileSync(one).equals(readFileSync(other));
}

export function isExecutableRegularFile(target: string): boolean {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isPrivateRegularFile(target: string): boolean {
  if (process.platform === "win32") return isReadableRegularFile(target);
  if (!isReadableRegularFile(target)) return false;
  return (statSync(target).mode & 0o777) === 0o600;
}

export function secondsSinceModified(target: string): number | undefined {
  const stats = statOrUndefined(target);
  if (stats === undefined) return undefined;
  return (Date.now() - stats.mtimeMs) / 1000;
}

export function writeFileAtomically(directory: string, finalPath: string, content: string, tempPrefix: string): void {
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(directory, `${tempPrefix}${randomBytes(3).toString("hex")}`);
    try {
      writeFileSync(candidate, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") continue;
      throw error;
    }
    renameSync(candidate, finalPath);
    return;
  }
  throw new Error(`could not create a temp file under ${directory}`);
}

export function withLock<T>(stateFile: string, sessionId: string, run: () => T, acquisition: "retry" | "retain-existing" = "retry"): T {
  const release = acquireLock(stateFile, sessionId, acquisition);
  try {
    return run();
  } finally {
    release();
  }
}

export function appendJournal(journalFile: string, text: string): void {
  try {
    const line = `${isoTimestamp()} ${text}\n`;
    withOwnerOnlyUmask(() => {
      mkdirSync(path.dirname(journalFile), { recursive: true });
      appendFileSync(journalFile, line);
    });
  } catch (error) {
    throw new JournalAppendError(journalFile, { cause: error });
  }
}

export type LoggedEvent = Readonly<{
  event: string;
  session: string;
  command?: string;
  gate?: string;
  hookEvent?: string;
}>;

export function logEvent(entry: LoggedEvent): boolean {
  const line = serializeEvent(entry);
  const eventsLog = path.join(stateRootDirectory(), "events.jsonl");
  try {
    requireWritableStateRoot();
    withOwnerOnlyUmask(() => appendFileSync(eventsLog, `${line}\n`));
    return true;
  } catch {
    process.stderr.write(`${line}\n`);
    return false;
  }
}

export function homeDirectoryFrom(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string {
  if (platform === "win32") {
    const profile = environment["USERPROFILE"] ?? homedir();
    if (profile === "") throw new Error("USERPROFILE is not set");
    return profile;
  }
  const home = environment["HOME"];
  if (home === undefined || home === "") throw new Error("HOME is not set");
  return home;
}

function homeDirectory(): string {
  return homeDirectoryFrom(process.platform, process.env);
}

export type GitCommonDirectory =
  | Readonly<{ kind: "answered"; commonDirectory: string }>
  | Readonly<{ kind: "refused"; cause: string }>;

const GIT_ANSWER_MAX_BYTES = 65536;

export function gitCommonDirectory(cwd: string, timeoutMs?: number): GitCommonDirectory {
  try {
    const answer = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: GIT_ANSWER_MAX_BYTES,
      env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined },
    }).replace(/\n+$/, "");
    if (!path.isAbsolute(answer)) {
      return { kind: "refused", cause: `git named no absolute common directory for ${cwd}: ${answer}` };
    }
    return { kind: "answered", commonDirectory: answer };
  } catch (error) {
    return { kind: "refused", cause: gitRefusalCause(error) };
  }
}

function gitRefusalCause(error: unknown): string {
  const spoken = error instanceof Error ? (error as Error & { stderr?: unknown }).stderr : undefined;
  if (typeof spoken !== "string" || spoken.trim() === "") return causeOf(error);
  return spoken.replace(/\n+$/, "");
}

function readFileIfPresent(file: string): string | undefined {
  const read = readStateFile(file);
  return read.kind === "ok" ? read.content : undefined;
}

export function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StateLine = { key: string; value: string };

function parseStateLines(content: string): StateLine[] {
  return content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [key, value] = splitPair(line);
      return { key, value };
    });
}

function serializeStateLines(lines: readonly StateLine[]): string {
  if (lines.length === 0) return "";
  return `${lines.map((line) => `${line.key}=${line.value}`).join("\n")}\n`;
}

function splitPair(pair: string): readonly [string, string] {
  const eq = pair.indexOf("=");
  return eq === -1 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
}

function createTempFile(directory: string, content: string): string {
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(directory, `.tmp.${randomBytes(4).toString("hex")}`);
    try {
      writeFileSync(candidate, content, { flag: "wx", mode: 0o600 });
      return candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not create a temp file under ${directory}`);
}

function acquireLock(stateFile: string, sessionId: string, acquisition: "retry" | "retain-existing"): () => void {
  const lockDir = `${stateFile}.lock`;
  let tries = 0;
  let reclaimed = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }
    if (acquisition === "retain-existing") throw new LockTimeoutError(sessionId);
    if (!reclaimed && lockIsStale(lockDir)) {
      rmSync(lockDir, { recursive: true, force: true });
      reclaimed = true;
      continue;
    }
    tries += 1;
    if (tries > LOCK_MAX_TRIES) throw new LockTimeoutError(sessionId);
    sleepSync(LOCK_RETRY_MS);
  }
}

function lockIsStale(lockDir: string): boolean {
  const stats = statSync(lockDir, { throwIfNoEntry: false });
  if (stats === undefined) return false;
  const heldForSeconds = (Date.now() - stats.mtimeMs) / 1000;
  return heldForSeconds >= LOCK_STALE_SECONDS;
}

export function sleepSync(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

export function withOwnerOnlyUmask<T>(run: () => T): T {
  const previous = process.umask(0o077);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
}

export function isoTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function lstatOrUndefined(target: string): Stats | undefined {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}

function statOrUndefined(target: string): Stats | undefined {
  try {
    return statSync(target);
  } catch {
    return undefined;
  }
}

function realPathOrUndefined(target: string): string | undefined {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}

function serializeEvent(entry: LoggedEvent): string {
  const client = path.basename(process.env["CLAUDE_CODE_EXECPATH"] ?? "");
  const command = entry.command ?? "";
  const recorded = commandHead(command);
  const fields = [
    `"ts":"${jsonEscape(isoTimestamp())}"`,
    `"event":"${jsonEscape(entry.event)}"`,
    `"command":"${jsonEscape(recorded)}"`,
    `"session":"${jsonEscape(entry.session)}"`,
    `"client":"${jsonEscape(client)}"`,
    `"schema":${EVENTS_SCHEMA_VERSION}`,
  ];
  if (recorded !== command) fields.push(`"command_bytes":${Buffer.byteLength(command, "utf8")}`);
  if (entry.gate !== undefined && entry.gate !== "") fields.push(`"gate":"${jsonEscape(entry.gate)}"`);
  if (entry.hookEvent !== undefined && entry.hookEvent !== "") fields.push(`"hook_event":"${jsonEscape(entry.hookEvent)}"`);
  return `{${fields.join(",")}}`;
}

function jsonEscape(value: string): string {
  let out = "";
  for (const character of value) {
    out += escapedJsonCharacter(character);
  }
  return out;
}

function escapedJsonCharacter(character: string): string {
  switch (character) {
    case "\\":
      return "\\\\";
    case '"':
      return '\\"';
    case "\n":
      return "\\n";
    case "\t":
      return "\\t";
    case "\r":
      return "\\r";
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    default: {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 1 && codePoint <= 0x1f ? `\\u${codePoint.toString(16).padStart(4, "0")}` : character;
    }
  }
}

function commandHead(command: string): string {
  const buffer = Buffer.from(command, "utf8");
  if (buffer.length <= BYTES_A_GATE_CAN_READ) return command;
  const boundaryByte = buffer[BYTES_A_GATE_CAN_READ];
  let end = BYTES_A_GATE_CAN_READ;
  if (boundaryByte !== undefined && (boundaryByte & 0xc0) === 0x80) {
    while (end > 0 && ((buffer[end - 1] ?? 0) & 0xc0) === 0x80) end -= 1;
    if (end > 0) end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
