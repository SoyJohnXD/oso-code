// core/src/shell/lexer.ts
var COPROCESS_WORD = "coproc";
var LOOKUP_BUILTIN = "command";
var PREFIX_WORDS = /* @__PURE__ */ new Set([
  "env",
  LOOKUP_BUILTIN,
  "builtin",
  "exec",
  "nice",
  "nohup",
  "time",
  "timeout",
  "stdbuf",
  "sudo",
  "doas",
  "setsid",
  "xargs",
  "flock",
  "ionice",
  "chrt",
  "taskset",
  "unbuffer",
  "then",
  "else",
  "elif",
  "do",
  "done",
  "fi",
  "in",
  "until",
  "while",
  "if",
  "for",
  "case",
  "esac",
  "select",
  "function",
  "!",
  COPROCESS_WORD
]);
var SHELL_INTERPRETERS = /* @__PURE__ */ new Set(["bash", "sh", "dash", "zsh", "ksh"]);
var COMMAND_FLAG_READERS = /* @__PURE__ */ new Set([...SHELL_INTERPRETERS, "script"]);
var CALLBACK_FLAG_READERS = /* @__PURE__ */ new Set(["mapfile", "readarray", "compgen", "complete"]);
var SOURCING_BUILTINS = /* @__PURE__ */ new Set(["source", "."]);
var EVAL_WORD = "eval";
var REMOTE_SHELL_WORD = "ssh";
var TERMINAL_MULTIPLEXER_WORD = "tmux";
var TRAP_WORD = "trap";
var ALIAS_WORD = "alias";
var HISTORY_REPLAYING_WORD = "fc";
var SHELL_WORDS_THIS_LEXER_READS = /* @__PURE__ */ new Set([
  ...PREFIX_WORDS,
  ...COMMAND_FLAG_READERS,
  ...CALLBACK_FLAG_READERS,
  ...SOURCING_BUILTINS,
  EVAL_WORD,
  REMOTE_SHELL_WORD,
  TERMINAL_MULTIPLEXER_WORD,
  TRAP_WORD,
  ALIAS_WORD,
  HISTORY_REPLAYING_WORD,
  "{",
  "}"
]);

// core/src/hosts/envelope.ts
var JSON_SPACE = "[\\t\\n\\v\\f\\r ]";
var STOP_HOOK_ACTIVE = new RegExp(`"stop_hook_active"${JSON_SPACE}*:${JSON_SPACE}*true`);

// core/src/routes/routes.ts
var BUNDLE_DIRECTORY = "dist";
var GATE_BUNDLE = "gate.js";
var PRECOMMIT_BUNDLE = "precommit.js";
var OPENCODE_PLUGIN_BUNDLE = "opencode/dist/oso-code.js";
var PLUGIN_BUNDLE_DIRECTORY = `plugin/${BUNDLE_DIRECTORY}`;
var PLUGIN_BINARY_DIRECTORY = "plugin/bin";
var BOOTSTRAP_DIRECTORY = "bootstrap";
var PLUGIN_STATE_BUNDLE = `${PLUGIN_BUNDLE_DIRECTORY}/oso-state.js`;
var PLUGIN_STATE_EXECUTABLE = `${PLUGIN_BINARY_DIRECTORY}/oso-state`;
var BOOTSTRAP_BUNDLE = `${BOOTSTRAP_DIRECTORY}/oso.js`;
var GENERATED_BUNDLES = [
  PLUGIN_STATE_BUNDLE,
  `${PLUGIN_BUNDLE_DIRECTORY}/${GATE_BUNDLE}`,
  `${PLUGIN_BUNDLE_DIRECTORY}/${PRECOMMIT_BUNDLE}`,
  PLUGIN_STATE_EXECUTABLE,
  BOOTSTRAP_BUNDLE,
  OPENCODE_PLUGIN_BUNDLE
];

// core/src/state/store.ts
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
var TASK_ROOT_VARIABLE = "OSO_TASK_ROOT";
var TOKEN_MAX_LENGTH = 128;
var EVENTS_SCHEMA_VERSION = 2;
var BYTES_A_GATE_CAN_READ = 3072;
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stateRootDirectory() {
  const configured = process.env["OSO_STATE_DIR"];
  if (configured !== void 0 && configured !== "") return configured;
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}
function taskIdentityFor(cwd) {
  const stateRoot = stateRootDirectory();
  const directory = withoutTrailingReturn(cwd);
  const declaration = process.env[TASK_ROOT_VARIABLE] ?? "";
  if (declaration === "") return gitAnsweredIdentity(stateRoot, directory);
  const declared = declaredRootOf(declaration);
  if (declared.kind === "refused") {
    return { kind: "unknown", cwd: directory, cause: declared.cause, inferredIdentity: inferredIdentityFor(directory) };
  }
  if (!declaredRootCovers(declared.root, realPathOrUndefined(directory) ?? directory)) {
    return gitAnsweredIdentity(stateRoot, directory, declared.root);
  }
  return { kind: "declared", identity: declared.root, stateFile: stateFileOfIdentity(stateRoot, declared.root) };
}
function gitAnsweredIdentity(stateRoot, directory, rootThatDoesNotCover) {
  const answered = gitCommonDirectory(directory);
  if (answered.kind === "answered") {
    const identity = answered.commonDirectory;
    return { kind: "repository", identity, stateFile: stateFileOfIdentity(stateRoot, identity) };
  }
  const uncovered = rootThatDoesNotCover === void 0 ? "" : `, and ${TASK_ROOT_VARIABLE} declares ${rootThatDoesNotCover}, which does not contain it`;
  return { kind: "unknown", cwd: directory, cause: `${answered.cause}${uncovered}`, inferredIdentity: directory };
}
function inferredIdentityFor(cwd) {
  const directory = withoutTrailingReturn(cwd);
  const answered = gitCommonDirectory(directory);
  return answered.kind === "answered" ? answered.commonDirectory : directory;
}
function stateLeftAtTheInferredIdentity(cwd, task) {
  if (task.kind === "repository") return void 0;
  const identity = task.kind === "unknown" ? task.inferredIdentity : inferredIdentityFor(cwd);
  if (task.kind === "declared" && identity === task.identity) return void 0;
  const stateFile = stateFileOfIdentity(stateRootDirectory(), identity);
  if (readStateFile(stateFile).kind === "absent") return void 0;
  return { identity, stateFile };
}
function stateFileOfIdentity(stateRoot, identity) {
  return path.join(stateRoot, `${sha256Hex(identity)}.state`);
}
function declaredRootOf(declaration) {
  if (!path.isAbsolute(declaration)) {
    return { kind: "refused", cause: `${TASK_ROOT_VARIABLE} is not an absolute path: ${declaration}` };
  }
  const root = realPathOrUndefined(declaration);
  if (root === void 0 || !isDirectory(root)) {
    return { kind: "refused", cause: `${TASK_ROOT_VARIABLE} names no readable directory: ${declaration}` };
  }
  return { kind: "root", root };
}
function declaredRootCovers(root, directory) {
  const stepsDown = path.relative(root, directory);
  if (stepsDown === "") return true;
  return !path.isAbsolute(stepsDown) && stepsDown !== ".." && !stepsDown.startsWith(`..${path.sep}`);
}
function withoutTrailingReturn(cwd) {
  return cwd.replace(/\r$/, "");
}
var MODEL_TOKEN_SHAPE = `1 to ${TOKEN_MAX_LENGTH} characters of letters, digits and / : . - _ @`;
function stateRecords(content, key) {
  const prefix = `${key}=`;
  return content.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}
function stateValue(content, key) {
  return stateRecords(content, key).join("\n");
}
function readStateFile(stateFile) {
  try {
    if (!statSync(stateFile).isFile()) return { kind: "unreadable", cause: `${stateFile} is not a regular file` };
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
  }
}
function isDirectory(target) {
  const stats = statOrUndefined(target);
  return stats !== void 0 && stats.isDirectory();
}
function logEvent(entry) {
  const line = serializeEvent(entry);
  const eventsLog = path.join(stateRootDirectory(), "events.jsonl");
  try {
    mkdirSync(path.dirname(eventsLog), { recursive: true });
    withOwnerOnlyUmask(() => appendFileSync(eventsLog, `${line}
`));
    return true;
  } catch {
    process.stderr.write(`${line}
`);
    return false;
  }
}
function homeDirectoryFrom(platform, environment) {
  if (platform === "win32") {
    const profile = environment["USERPROFILE"] ?? homedir();
    if (profile === "") throw new Error("USERPROFILE is not set");
    return profile;
  }
  const home = environment["HOME"];
  if (home === void 0 || home === "") throw new Error("HOME is not set");
  return home;
}
function homeDirectory() {
  return homeDirectoryFrom(process.platform, process.env);
}
var GIT_ANSWER_MAX_BYTES = 65536;
function gitCommonDirectory(cwd, timeoutMs) {
  try {
    const answer = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: GIT_ANSWER_MAX_BYTES,
      env: { ...process.env, GIT_DIR: void 0, GIT_WORK_TREE: void 0, GIT_COMMON_DIR: void 0 }
    }).replace(/\n+$/, "");
    if (!path.isAbsolute(answer)) {
      return { kind: "refused", cause: `git named no absolute common directory for ${cwd}: ${answer}` };
    }
    return { kind: "answered", commonDirectory: answer };
  } catch (error) {
    return { kind: "refused", cause: gitRefusalCause(error) };
  }
}
function gitRefusalCause(error) {
  const spoken = error instanceof Error ? error.stderr : void 0;
  if (typeof spoken !== "string" || spoken.trim() === "") return causeOf(error);
  return spoken.replace(/\n+$/, "");
}
function causeOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function withOwnerOnlyUmask(run2) {
  const previous = process.umask(63);
  try {
    return run2();
  } finally {
    process.umask(previous);
  }
}
function isoTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function statOrUndefined(target) {
  try {
    return statSync(target);
  } catch {
    return void 0;
  }
}
function realPathOrUndefined(target) {
  try {
    return realpathSync(target);
  } catch {
    return void 0;
  }
}
function serializeEvent(entry) {
  const client = path.basename(process.env["CLAUDE_CODE_EXECPATH"] ?? "");
  const command = entry.command ?? "";
  const recorded = commandHead(command);
  const fields = [
    `"ts":"${jsonEscape(isoTimestamp())}"`,
    `"event":"${jsonEscape(entry.event)}"`,
    `"command":"${jsonEscape(recorded)}"`,
    `"session":"${jsonEscape(entry.session)}"`,
    `"client":"${jsonEscape(client)}"`,
    `"schema":${EVENTS_SCHEMA_VERSION}`
  ];
  if (recorded !== command) fields.push(`"command_bytes":${Buffer.byteLength(command, "utf8")}`);
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
  if (buffer.length <= BYTES_A_GATE_CAN_READ) return command;
  const boundaryByte = buffer[BYTES_A_GATE_CAN_READ];
  let end = BYTES_A_GATE_CAN_READ;
  if (boundaryByte !== void 0 && (boundaryByte & 192) === 128) {
    while (end > 0 && ((buffer[end - 1] ?? 0) & 192) === 128) end -= 1;
    if (end > 0) end -= 1;
  }
  return buffer.subarray(0, end).toString("utf8");
}
function isErrnoException(error) {
  return error instanceof Error && "code" in error;
}

// core/src/gates/preflight.ts
function sanitizeSession(raw) {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
function readArmedState(cwd) {
  const task = taskIdentityFor(cwd);
  if (task.kind !== "unknown") {
    const read = readStateFile(task.stateFile);
    if (read.kind === "ok") return { kind: "readable", stateFile: task.stateFile, content: read.content };
    if (read.kind === "unreadable") return { kind: "unusable", stateFile: task.stateFile };
  }
  const left = stateLeftAtTheInferredIdentity(cwd, task);
  return left === void 0 ? { kind: "absent" } : { kind: "moved", left, task };
}
function osoStateRemedy(session, verbAndArguments) {
  return `oso-state --session ${session} ${verbAndArguments}`;
}
function unusableStateMessage(stateFile, session) {
  return `oso-code: this session is armed but its state file (${stateFile}) cannot be read, so the gate cannot tell whether this call is safe. Remove or repair it (${osoStateRemedy(session, "clear")}), then retry.`;
}
function identityMovedMessage(state, session) {
  const named = state.task.kind === "unknown" ? `this session can name none of its own (${state.task.cause}) until ${TASK_ROOT_VARIABLE} declares one` : `${TASK_ROOT_VARIABLE} now names ${state.task.identity}`;
  return `oso-code: the state that arms this session's gates still sits at ${state.left.stateFile}, keyed by the identity earlier releases inferred (${state.left.identity}), while ${named}. Carry it over with ${osoStateRemedy(session, "show")} from this directory, or drop it with ${osoStateRemedy(session, "clear")}; until one of those runs, this gate denies rather than allowing on state it no longer reads.`;
}
var HOOKS_MANIFEST_FINGERPRINT = `/${GATE_BUNDLE}`;

// core/src/gates/commit.ts
var REMEDY_BY_MODE = {
  plan: "Resume plan mode's apply \u2192 verify loop until the verifier returns pass",
  quick: "Finish quick mode's close step \u2014 run the project's checks to zero warnings",
  debug: "Finish debug mode's close step \u2014 run the quality-pass judge to zero warnings"
};
var REMEDY_FOR_ANY_MODE = "Finish the active mode's checks to zero warnings \u2014 plan mode's apply \u2192 verify loop, or quick/debug mode's close step";
function untilGreenMessage(stateContent) {
  const remedy = REMEDY_BY_MODE[stateValue(stateContent, "mode")] ?? REMEDY_FOR_ANY_MODE;
  return `oso-code: the session verify is not green. ${remedy}, then retry the commit.`;
}
function verifyIsGreen(stateContent) {
  return stateValue(stateContent, "verify_green") === "true";
}

// core/src/hosts/hook-run.ts
function gateErrorText(subject) {
  return `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.
`;
}

// core/src/bin/precommit.ts
var COMMIT_PROCEEDS = { exit: 0, stderr: "", events: [] };
var ABORTED_EXIT = 1;
var HOOK_ERROR_EXIT = 2;
function preCommitRun(cwd, marker) {
  const session = sanitizeSession(marker);
  if (session === "") return COMMIT_PROCEEDS;
  const state = readArmedState(cwd);
  if (state.kind === "absent") return COMMIT_PROCEEDS;
  if (state.kind === "moved") return aborted(identityMovedMessage(state, session), "identity-moved-denied", session);
  if (state.kind === "unusable") {
    return aborted(unusableStateMessage(state.stateFile, session), "state-unreadable", session);
  }
  if (verifyIsGreen(state.content)) return COMMIT_PROCEEDS;
  return aborted(untilGreenMessage(state.content), "commit-denied", session);
}
function commitMarkerIn(environment) {
  const named = environment["CLAUDE_CODE_SESSION_ID"];
  if (named !== void 0 && named !== "") return named;
  return environment["OSO_AGENT"] ?? "";
}
function aborted(reason, event, session) {
  return { exit: ABORTED_EXIT, stderr: `${reason}
`, events: [{ event, session }] };
}
function hookFailedClosed(cause) {
  const explained = cause instanceof Error ? cause.message : String(cause);
  return {
    exit: HOOK_ERROR_EXIT,
    stderr: `${gateErrorText("the commit hook")}oso-code: cause: ${explained}
`,
    events: []
  };
}
function attemptPreCommit() {
  try {
    return preCommitRun(process.cwd(), commitMarkerIn(process.env));
  } catch (cause) {
    return hookFailedClosed(cause);
  }
}
var run = attemptPreCommit();
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
