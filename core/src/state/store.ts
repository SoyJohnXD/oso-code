import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
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

export const CHANGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const NAME_TOKEN_MAX_LENGTH = 128;
const LOCK_STALE_SECONDS = 30;
const LOCK_MAX_TRIES = 200;
const LOCK_RETRY_MS = 50;
const EVENTS_SCHEMA_VERSION = 2;
const COMMAND_HEAD_BYTES = 120;

export function sha256Hex(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stateRootDirectory(): string {
  const configured = process.env["OSO_STATE_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}

export function stateFileFor(cwd: string): string {
  const directory = cwd.replace(/\r$/, "");
  const identity = gitCommonDirectory(directory) || directory;
  return path.join(stateRootDirectory(), `${sha256Hex(identity)}.state`);
}

export function repositoryIdFor(stateFile: string): string {
  return path.basename(stateFile, ".state");
}

export function journalFileFor(cwd: string): string {
  const stateFile = stateFileFor(cwd);
  const repositoryId = repositoryIdFor(stateFile);
  const autoChange = readValue(stateFile, "auto_change") ?? "";
  const change = CHANGE_SLUG_PATTERN.test(autoChange) ? autoChange : "run";
  return path.join(stateRootDirectory(), "runs", repositoryId, `${change}.log`);
}

export function isNameToken(value: string): boolean {
  return value.length >= 1 && value.length <= NAME_TOKEN_MAX_LENGTH && NAME_TOKEN_PATTERN.test(value);
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

type StateFileRead =
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
  mkdirSync(stateRootDirectory(), { recursive: true });
  withLock(stateFile, sessionId, () => {
    writeStatePairs(stateFile, pairs, sessionId);
    logEvent({ event: `set:${pairs.join(" ")}`, session: sessionId });
  });
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

export function withLock<T>(stateFile: string, sessionId: string, run: () => T): T {
  const release = acquireLock(stateFile, sessionId);
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
    mkdirSync(path.dirname(eventsLog), { recursive: true });
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

function gitCommonDirectory(cwd: string): string {
  try {
    const output = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.replace(/\n+$/, "");
  } catch {
    return "";
  }
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

function acquireLock(stateFile: string, sessionId: string): () => void {
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

function serializeEvent(entry: LoggedEvent): string {
  const client = path.basename(process.env["CLAUDE_CODE_EXECPATH"] ?? "");
  const fields = [
    `"ts":"${jsonEscape(isoTimestamp())}"`,
    `"event":"${jsonEscape(entry.event)}"`,
    `"command":"${jsonEscape(commandHead(entry.command ?? ""))}"`,
    `"session":"${jsonEscape(entry.session)}"`,
    `"client":"${jsonEscape(client)}"`,
    `"schema":${EVENTS_SCHEMA_VERSION}`,
  ];
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
  if (buffer.length <= COMMAND_HEAD_BYTES) return command;
  const boundaryByte = buffer[COMMAND_HEAD_BYTES];
  let end = COMMAND_HEAD_BYTES;
  if (boundaryByte !== undefined && (boundaryByte & 0xc0) === 0x80) {
    while (end > 0 && ((buffer[end - 1] ?? 0) & 0xc0) === 0x80) end -= 1;
    if (end > 0) end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
