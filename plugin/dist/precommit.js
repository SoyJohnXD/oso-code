// core/src/hosts/envelope.ts
var JSON_SPACE = "[\\t\\n\\v\\f\\r ]";
var STOP_HOOK_ACTIVE = new RegExp(`"stop_hook_active"${JSON_SPACE}*:${JSON_SPACE}*true`);

// core/src/gates/preflight.ts
import { accessSync as accessSync2, constants as constants2, existsSync, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";

// core/src/routes/routes.ts
var GATE_BUNDLE = "gate.js";

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
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
var EVENTS_SCHEMA_VERSION = 2;
var COMMAND_HEAD_BYTES = 120;
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stateRootDirectory() {
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}
function stateFileFor(cwd) {
  const directory = cwd.replace(/\r$/, "");
  const identity = gitCommonDirectory(directory) || directory;
  return path.join(stateRootDirectory(), `${sha256Hex(identity)}.state`);
}
function readStateFile(stateFile) {
  try {
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
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

// core/src/gates/preflight.ts
function sanitizeSession(raw) {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
function readArmedState(stateFile) {
  const stats = statSync2(stateFile, { throwIfNoEntry: false });
  if (stats === void 0) return { kind: "absent" };
  if (!stats.isFile() || !isReadable(stateFile)) return { kind: "unusable" };
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return { kind: "unusable" };
  return { kind: "readable", content: read.content };
}
function stateMatches(content, stateRecord) {
  return stateRecord.test(content);
}
function stateValue(content, key) {
  return content.split("\n").filter((line) => line.startsWith(`${key}=`)).map((line) => line.slice(key.length + 1)).join("\n");
}
function osoStateRemedy(session, verbAndArguments) {
  return `oso-state --session ${session} ${verbAndArguments}`;
}
function unusableStateMessage(stateFile, session) {
  return `oso-code: this session is armed but its state file (${stateFile}) cannot be read, so the gate cannot tell whether this call is safe. Remove or repair it (${osoStateRemedy(session, "clear")}), then retry.`;
}
function isReadable(target) {
  try {
    accessSync2(target, constants2.R_OK);
    return true;
  } catch {
    return false;
  }
}
var HOOKS_MANIFEST_FINGERPRINT = `/${GATE_BUNDLE}`;

// core/src/gates/commit.ts
var VERIFY_GREEN = /^verify_green=true$/m;
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
  return stateMatches(stateContent, VERIFY_GREEN);
}

// core/src/hosts/pretooluse.ts
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
  const stateFile = stateFileFor(cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return COMMIT_PROCEEDS;
  if (state.kind === "unusable") {
    return aborted(unusableStateMessage(stateFile, session), "state-unreadable", session);
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
export {
  commitMarkerIn,
  preCommitRun
};
