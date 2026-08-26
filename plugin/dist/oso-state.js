// core/src/state/cli.ts
import { mkdirSync as mkdirSync2 } from "node:fs";

// core/src/state/store.ts
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
var LockTimeoutError = class extends Error {
  sessionId;
  constructor(sessionId) {
    super(`could not acquire lock for session ${sessionId}`);
    this.name = "LockTimeoutError";
    this.sessionId = sessionId;
  }
};
var JournalAppendError = class extends Error {
  journalFile;
  constructor(journalFile) {
    super(`cannot append the milestone to ${journalFile}`);
    this.name = "JournalAppendError";
    this.journalFile = journalFile;
  }
};
var StateFileUnreadableError = class extends Error {
  stateFile;
  constructor(stateFile, cause) {
    super(`cannot read state at ${stateFile}: ${cause}`);
    this.name = "StateFileUnreadableError";
    this.stateFile = stateFile;
  }
};
var CHANGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var LOCK_STALE_SECONDS = 30;
var LOCK_MAX_TRIES = 200;
var LOCK_RETRY_MS = 50;
var EVENTS_SCHEMA_VERSION = 2;
var COMMAND_HEAD_BYTES = 120;
function stateRootDirectory() {
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}
function stateFileFor(cwd) {
  const directory = cwd.replace(/\r$/, "");
  const identity = gitCommonDirectory(directory) || directory;
  const digest = createHash("sha256").update(identity).digest("hex");
  return path.join(stateRootDirectory(), `${digest}.state`);
}
function journalFileFor(cwd) {
  const stateFile = stateFileFor(cwd);
  const repositoryId = path.basename(stateFile, ".state");
  const autoChange = readValue(stateFile, "auto_change") ?? "";
  const change = CHANGE_SLUG_PATTERN.test(autoChange) ? autoChange : "run";
  return path.join(stateRootDirectory(), "runs", repositoryId, `${change}.log`);
}
function readValue(stateFile, key) {
  const content = readFileIfPresent(stateFile);
  if (content === void 0) return void 0;
  for (const line of content.split("\n")) {
    if (line === "") continue;
    const [lineKey, value] = splitPair(line);
    if (lineKey === key) return value;
  }
  return void 0;
}
function readStateFile(stateFile) {
  try {
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
  }
}
function writeStatePairs(stateFile, pairs, sessionId) {
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
function clearStateFile(stateFile) {
  rmSync(stateFile, { force: true });
}
function withLock(stateFile, sessionId, run) {
  const release = acquireLock(stateFile, sessionId);
  try {
    return run();
  } finally {
    release();
  }
}
function appendJournal(journalFile, text) {
  try {
    const line = `${isoTimestamp()} ${text}
`;
    withOwnerOnlyUmask(() => {
      mkdirSync(path.dirname(journalFile), { recursive: true });
      appendFileSync(journalFile, line);
    });
  } catch {
    throw new JournalAppendError(journalFile);
  }
}
function logEvent(entry) {
  const line = serializeEvent(entry);
  const eventsLog = path.join(stateRootDirectory(), "events.jsonl");
  try {
    mkdirSync(path.dirname(eventsLog), { recursive: true });
    withOwnerOnlyUmask(() => appendFileSync(eventsLog, `${line}
`));
  } catch {
    process.stderr.write(`${line}
`);
  }
}
function homeDirectory() {
  const home = process.env["HOME"];
  if (home === void 0 || home === "") {
    throw new Error("HOME is not set");
  }
  return home;
}
function gitCommonDirectory(cwd) {
  try {
    const output = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.replace(/\n+$/, "");
  } catch {
    return "";
  }
}
function readFileIfPresent(file) {
  const read = readStateFile(file);
  return read.kind === "ok" ? read.content : void 0;
}
function causeOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function parseStateLines(content) {
  return content.split("\n").filter((line) => line !== "").map((line) => {
    const [key, value] = splitPair(line);
    return { key, value };
  });
}
function serializeStateLines(lines) {
  if (lines.length === 0) return "";
  return `${lines.map((line) => `${line.key}=${line.value}`).join("\n")}
`;
}
function splitPair(pair) {
  const eq = pair.indexOf("=");
  return eq === -1 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
}
function createTempFile(directory, content) {
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(directory, `.tmp.${randomBytes(4).toString("hex")}`);
    try {
      writeFileSync(candidate, content, { flag: "wx" });
      return candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not create a temp file under ${directory}`);
}
function acquireLock(stateFile, sessionId) {
  const lockDir = `${stateFile}.lock`;
  let tries = 0;
  let reclaimed = false;
  for (; ; ) {
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
function lockIsStale(lockDir) {
  const stats = statSync(lockDir, { throwIfNoEntry: false });
  if (stats === void 0) return false;
  const heldForSeconds = (Date.now() - stats.mtimeMs) / 1e3;
  return heldForSeconds >= LOCK_STALE_SECONDS;
}
function sleepSync(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}
function withOwnerOnlyUmask(run) {
  const previous = process.umask(63);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
}
function isoTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function serializeEvent(entry) {
  const client = path.basename(process.env["CLAUDE_CODE_EXECPATH"] ?? "");
  const fields = [
    `"ts":"${jsonEscape(isoTimestamp())}"`,
    `"event":"${jsonEscape(entry.event)}"`,
    `"command":"${jsonEscape(commandHead(entry.command ?? ""))}"`,
    `"session":"${jsonEscape(entry.session)}"`,
    `"client":"${jsonEscape(client)}"`,
    `"schema":${EVENTS_SCHEMA_VERSION}`
  ];
  if (entry.gate !== void 0 && entry.gate !== "") fields.push(`"gate":"${jsonEscape(entry.gate)}"`);
  if (entry.hookEvent !== void 0 && entry.hookEvent !== "") fields.push(`"hook_event":"${jsonEscape(entry.hookEvent)}"`);
  return `{${fields.join(",")}}`;
}
function jsonEscape(value) {
  let out = "";
  for (const character of value) {
    out += escapedJsonCharacter(character);
  }
  return out;
}
function escapedJsonCharacter(character) {
  switch (character) {
    case "\\":
      return "\\\\";
    case '"':
      return '\\"';
    case "\n":
      return "\\n";
    case "	":
      return "\\t";
    case "\r":
      return "\\r";
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    default: {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 1 && codePoint <= 31 ? `\\u${codePoint.toString(16).padStart(4, "0")}` : character;
    }
  }
}
function commandHead(command) {
  const buffer = Buffer.from(command, "utf8");
  if (buffer.length <= COMMAND_HEAD_BYTES) return command;
  const boundaryByte = buffer[COMMAND_HEAD_BYTES];
  let end = COMMAND_HEAD_BYTES;
  if (boundaryByte !== void 0 && (boundaryByte & 192) === 128) {
    while (end > 0 && ((buffer[end - 1] ?? 0) & 192) === 128) end -= 1;
    if (end > 0) end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}
function isErrnoException(error) {
  return error instanceof Error && "code" in error;
}

// core/src/state/cli.ts
var USAGE = `usage: oso-state --session <id> set key=value [key=value ...]
       oso-state --session <id> get key
       oso-state --session <id> show
       oso-state --session <id> clear
       oso-state --session <id> event <type> [detail]
       oso-state --session <id> capture-plan <sha256>
       oso-state --session <id> approve-plan <sha256>
       oso-state --session <id> cancel-plan <sha256>
       oso-state --session <id> amend-plan <slice-id>
       oso-state journal <text>
       oso-state journal --path
       oso-state handoff publish --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --hook-session <id>
       oso-state handoff wait --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --timeout <seconds>
       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-type <type>

The SubagentStop hook publishes a provenance receipt, never a verdict. wait is
bounded and consume is one-shot. Handoff attempts start at 1 and timeout must
be between 0 and 600 seconds.
`;
var UsageError = class extends Error {
};
var UnimplementedVerbError = class extends Error {
  verb;
  constructor(verb) {
    super(`${verb} is not implemented in this port yet`);
    this.verb = verb;
  }
};
var PLAN_VERBS = ["capture-plan", "approve-plan", "cancel-plan", "amend-plan"];
var HANDOFF_SUBACTIONS = ["publish", "wait", "consume"];
var HANDOFF_FLAGS = {
  "--slice": "slice",
  "--attempt": "attempt",
  "--agent-id": "agentId",
  "--agent-type": "agentType",
  "--hook-session": "hookSession",
  "--timeout": "timeout"
};
function main(argv) {
  try {
    return dispatch(argv);
  } catch (error) {
    return report(error);
  }
}
function report(error) {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (error instanceof LockTimeoutError) {
    process.stderr.write(`oso-state: ${error.message}
`);
    return 1;
  }
  if (error instanceof JournalAppendError) {
    process.stderr.write(`oso-state: journal: ${error.message}
`);
    return 1;
  }
  if (error instanceof StateFileUnreadableError) {
    process.stderr.write(`oso-state: set: ${error.message}
`);
    return 1;
  }
  if (error instanceof UnimplementedVerbError) {
    process.stderr.write(`oso-state: ${error.message}
`);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso-state: ${message}
`);
  return 1;
}
function dispatch(argv) {
  const first = argv[0];
  if (first === "journal") return runJournal(argv.slice(1));
  if (first === "handoff") return dispatchHandoff(argv.slice(1));
  if (first !== "--session") throw new UsageError();
  const sessionId = sanitizeSession(argv[1] ?? "");
  if (sessionId === "") throw new UsageError();
  const action = argv[2] ?? "";
  const remaining = argv.slice(3);
  switch (action) {
    case "set":
      return runSet(sessionId, remaining);
    case "get":
      return runGet(remaining);
    case "show":
      return runShow();
    case "clear":
      return runClear(sessionId);
    case "event":
      return runEvent(sessionId, remaining);
    case "journal":
      return runJournal(remaining);
    case "handoff":
      return dispatchHandoff(remaining);
    default:
      if (isPlanVerb(action)) return runUnimplementedPlanVerb(action, remaining);
      throw new UsageError();
  }
}
function isPlanVerb(action) {
  return PLAN_VERBS.includes(action);
}
function runUnimplementedPlanVerb(verb, remaining) {
  if (remaining.length !== 1) throw new UsageError();
  throw new UnimplementedVerbError(verb);
}
function runSet(sessionId, pairs) {
  if (pairs.length < 1) throw new UsageError();
  const stateFile = stateFileFor(process.cwd());
  mkdirSync2(stateRootDirectory(), { recursive: true });
  return withLock(stateFile, sessionId, () => {
    writeStatePairs(stateFile, pairs, sessionId);
    logEvent({ event: `set:${pairs.join(" ")}`, session: sessionId });
    return 0;
  });
}
function runGet(remaining) {
  if (remaining.length !== 1) throw new UsageError();
  const key = remaining[0];
  const stateFile = stateFileFor(process.cwd());
  const value = readValue(stateFile, key);
  if (value !== void 0) process.stdout.write(`${value}
`);
  return 0;
}
function runShow() {
  const stateFile = stateFileFor(process.cwd());
  const read = readStateFile(stateFile);
  if (read.kind === "absent") {
    process.stdout.write(`no state at ${stateFile}
`);
    return 0;
  }
  if (read.kind === "unreadable") {
    process.stderr.write(`oso-state: show: cannot read state at ${stateFile}: ${read.cause}
`);
    return 1;
  }
  process.stdout.write(read.content);
  return 0;
}
function runClear(sessionId) {
  const stateFile = stateFileFor(process.cwd());
  mkdirSync2(stateRootDirectory(), { recursive: true });
  return withLock(stateFile, sessionId, () => {
    clearStateFile(stateFile);
    logEvent({ event: "clear", session: sessionId });
    return 0;
  });
}
function runEvent(sessionId, remaining) {
  if (remaining.length < 1 || remaining.length > 2) throw new UsageError();
  const type = remaining[0];
  const detail = remaining[1] ?? "";
  logEvent({ event: type, session: sessionId, command: detail });
  return 0;
}
function runJournal(remaining) {
  if (remaining.length !== 1) throw new UsageError();
  const text = remaining[0];
  if (text === "") throw new UsageError();
  const journalFile = journalFileFor(process.cwd());
  if (text === "--path") {
    process.stdout.write(`${journalFile}
`);
    return 0;
  }
  appendJournal(journalFile, text);
  return 0;
}
function dispatchHandoff(remaining) {
  const [subaction, ...rest] = remaining;
  if (!isHandoffSubaction(subaction)) throw new UsageError();
  const coordinates = parseHandoffCoordinates(rest);
  checkHandoffCoordinateShape(subaction, coordinates);
  throw new UnimplementedVerbError(`handoff ${subaction}`);
}
function isHandoffSubaction(value) {
  return value !== void 0 && HANDOFF_SUBACTIONS.includes(value);
}
function checkHandoffCoordinateShape(subaction, coordinates) {
  const hasTimeout = coordinates.timeout !== void 0;
  const hasHookSession = coordinates.hookSession !== void 0;
  if (subaction === "publish" && hasTimeout) throw new UsageError();
  if (subaction === "wait" && (!hasTimeout || hasHookSession)) throw new UsageError();
  if (subaction === "consume" && (hasTimeout || hasHookSession)) throw new UsageError();
}
function parseHandoffCoordinates(args) {
  const coordinates = {};
  let index = 0;
  while (index < args.length) {
    if (index + 1 >= args.length) throw new UsageError();
    const flag = args[index];
    const field = HANDOFF_FLAGS[flag];
    if (field === void 0) throw new UsageError();
    if (coordinates[field] !== void 0) throw new UsageError();
    coordinates[field] = args[index + 1];
    index += 2;
  }
  return coordinates;
}
function sanitizeSession(raw) {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}

// core/src/bin/oso-state.ts
process.exit(main(process.argv.slice(2)));
