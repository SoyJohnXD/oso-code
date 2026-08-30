// core/src/bin/gate.ts
import { readFileSync as readFileSync7 } from "node:fs";

// core/src/hosts/hook-run.ts
var GATE_ERROR_EXIT = 2;
var NOTHING_TO_SAY = "{}";
var UNSPOKEN = { exit: 0, stdout: "", stderr: "" };
function spoken(stdout) {
  return { exit: 0, stdout: `${stdout}
`, stderr: "" };
}
function gateErrorText(subject) {
  return `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.
`;
}

// core/src/hosts/pretooluse.ts
var HOOK_EVENT = "PreToolUse";
function preToolUseRun(verdict) {
  switch (verdict.kind) {
    case "allow":
      return UNSPOKEN;
    case "deny":
      return spoken(denyEnvelope(verdict.message));
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}
function denyEnvelope(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  });
}

// core/src/hosts/sessionend.ts
function sessionEndRun(verdict) {
  switch (verdict.kind) {
    case "noVerdict":
      return UNSPOKEN;
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}

// core/src/hosts/sessionstart.ts
var HOOK_EVENT2 = "SessionStart";
function sessionStartRun(verdict) {
  switch (verdict.kind) {
    case "allow":
      return UNSPOKEN;
    case "context":
      return spoken(contextEnvelope(verdict.additionalContext));
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}
function contextEnvelope(additionalContext) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT2,
      additionalContext
    }
  });
}

// core/src/hosts/stop.ts
function stopRun(verdict, escalated) {
  switch (verdict.kind) {
    case "allow":
      return spoken(NOTHING_TO_SAY);
    case "push":
      return spoken(JSON.stringify({ shouldContinue: true, decision: "block", reason: verdict.reason }));
    case "deny":
      return spoken(escalated ? endedEnvelope(verdict.message) : blockEnvelope(verdict.message));
  }
}
function blockEnvelope(reason) {
  return JSON.stringify({ decision: "block", reason });
}
function endedEnvelope(reason) {
  return JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason });
}

// core/src/hosts/subagentstop.ts
function subagentStopRun(_verdict) {
  return spoken(NOTHING_TO_SAY);
}

// core/src/hosts/userprompt.ts
var HOOK_EVENT3 = "UserPromptSubmit";
function userPromptRun(verdict) {
  switch (verdict.kind) {
    case "allow":
      return spoken(NOTHING_TO_SAY);
    case "deny":
      return spoken(JSON.stringify({ decision: "block", reason: verdict.message }));
    case "context":
      return spoken(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: HOOK_EVENT3, additionalContext: verdict.additionalContext }
        })
      );
  }
}

// core/src/gates/autocontinue.ts
import { mkdirSync as mkdirSync3, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
import path4 from "node:path";

// core/src/shell/lexer.ts
var MAX_LEXED_INPUT_BYTES = 3072;
var UNREAD_PAYLOAD_MARKER = "!unread-payload";
var MAX_PAYLOAD_DEPTH = 3;
var SPECIAL_CHARACTERS = "'\"\\$`#;&|(){}<> 	\n";
var QUOTED_SPECIAL_CHARACTERS = '"\\$`';
var UNREAD_PAYLOAD = { kind: "unreadPayload" };
var PREFIX_WORDS = /* @__PURE__ */ new Set([
  "env",
  "command",
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
  "!"
]);
var SHELL_INTERPRETERS = /* @__PURE__ */ new Set(["bash", "sh", "dash", "zsh", "ksh"]);
function lexShellCommands(commandLine) {
  return new CommandLineLexer(commandLine, 0).lex();
}
function basenameOf(word) {
  const lastSlash = word.lastIndexOf("/");
  return lastSlash === -1 ? word : word.slice(lastSlash + 1);
}
function isShellInterpreter(word) {
  return SHELL_INTERPRETERS.has(basenameOf(word));
}
function isCommandPrefixWord(word) {
  if (/^[A-Za-z_][\s\S]*=/.test(word)) return true;
  if (word.startsWith("-")) return true;
  if (!/[^0-9]/.test(word)) return word !== "";
  return PREFIX_WORDS.has(basenameOf(word));
}
function completesItsWordsFromStdin(word) {
  return basenameOf(word) === "xargs";
}
function isSourcingBuiltin(word) {
  return word === "source" || word === ".";
}
function withSpacesForNewlines(text) {
  return text.replaceAll("\n", " ");
}
function leadingRunWithout(text, stoppers) {
  let length = 0;
  while (length < text.length && !stoppers.includes(text[length])) length += 1;
  return text.slice(0, length);
}
var CommandLineLexer = class _CommandLineLexer {
  rest;
  depth;
  token = "";
  tokenOpen = false;
  redirectTargetPending = false;
  herestringPending = false;
  pendingHeredocs = [];
  nested = [];
  unreadStdin = "";
  commandTokens = [];
  records = [];
  constructor(commandLine, depth) {
    this.rest = `${commandLine}
`;
    this.depth = depth;
  }
  lex() {
    if (Buffer.byteLength(this.rest, "utf8") > MAX_LEXED_INPUT_BYTES) return [UNREAD_PAYLOAD];
    while (this.rest !== "") this.takeNext();
    this.endToken();
    this.takeHeredocBodies();
    this.endCommand();
    return this.records;
  }
  takeNext() {
    const ordinary = leadingRunWithout(this.rest, SPECIAL_CHARACTERS);
    if (ordinary !== "") {
      this.token += ordinary;
      this.tokenOpen = true;
      this.rest = this.rest.slice(ordinary.length);
      return;
    }
    const character = this.rest.slice(0, 1);
    this.rest = this.rest.slice(1);
    this.takeSpecial(character);
  }
  takeSpecial(character) {
    switch (character) {
      case "'":
        this.tokenOpen = true;
        this.takeSingleQuoted();
        return;
      case '"':
        this.tokenOpen = true;
        this.takeDoubleQuoted();
        return;
      case "\\":
        this.takeEscape();
        return;
      case "$":
        this.tokenOpen = true;
        this.takeExpansion();
        return;
      case "`":
        this.tokenOpen = true;
        this.takeBacktick();
        return;
      case "#":
        if (this.tokenOpen) this.token += "#";
        else this.dropComment();
        return;
      case " ":
      case "	":
        this.endToken();
        return;
      case ">":
        this.endToken();
        this.takeRedirect();
        return;
      case "<":
        this.takeInputRedirect();
        return;
      case "&":
        if (this.rest.startsWith(">")) {
          this.endToken();
          this.takeRedirect();
        } else {
          this.endCommand();
        }
        return;
      case "\n":
        this.endToken();
        this.takeHeredocBodies();
        this.endCommand();
        return;
      default:
        this.endCommand();
    }
  }
  endToken() {
    if (this.tokenOpen && this.redirectTargetPending) {
      this.redirectTargetPending = false;
    } else if (this.tokenOpen) {
      this.commandTokens.push(this.token);
      if (this.herestringPending) {
        this.herestringPending = false;
        this.deferNestedCommands(this.token);
      }
    }
    this.token = "";
    this.tokenOpen = false;
  }
  endCommand() {
    this.endToken();
    this.stripCommandPrefixes();
    this.deferPayloadCommands();
    this.emitCommand();
    this.commandTokens = [];
    this.nested = [];
    this.unreadStdin = "";
    this.redirectTargetPending = false;
  }
  stripCommandPrefixes() {
    let prefixWord = "";
    let stdinCompletesTheWords = false;
    while (this.commandTokens.length > 0) {
      const leading = this.commandTokens[0];
      if (!isCommandPrefixWord(leading)) {
        if (prefixWord.startsWith("-")) this.markUnread();
        if (stdinCompletesTheWords) this.unreadStdin += UNREAD_PAYLOAD_MARKER;
        return;
      }
      prefixWord = leading;
      if (completesItsWordsFromStdin(prefixWord)) stdinCompletesTheWords = true;
      this.commandTokens = this.commandTokens.slice(1);
    }
  }
  deferPayloadCommands() {
    const leading = this.commandTokens[0];
    if (leading === void 0) return;
    if (isSourcingBuiltin(leading)) {
      this.markUnread();
      return;
    }
    if (basenameOf(leading) === "eval") {
      this.deferNestedCommands(this.commandTokens.slice(1).join(" "));
      return;
    }
    if (isShellInterpreter(leading)) this.deferInterpreterPayload();
  }
  deferInterpreterPayload() {
    let commandFlagSeen = false;
    let valuePosition = false;
    for (const argument of this.commandTokens.slice(1)) {
      if (argument.startsWith("--")) {
        valuePosition = true;
      } else if (argument === "-c") {
        commandFlagSeen = true;
        valuePosition = false;
      } else if (argument.startsWith("-") && argument.slice(1).includes("c")) {
        commandFlagSeen = true;
        valuePosition = true;
      } else if (argument.startsWith("-")) {
        valuePosition = true;
      } else if (commandFlagSeen) {
        if (valuePosition) this.markUnread();
        this.deferNestedCommands(argument);
        return;
      }
    }
    if (this.nested.length === 0) this.markUnread();
  }
  deferNestedCommands(payload) {
    if (payload === "") return;
    if (this.depth >= MAX_PAYLOAD_DEPTH) {
      this.markUnread();
      return;
    }
    this.nested.push(...new _CommandLineLexer(payload, this.depth + 1).lex());
  }
  markUnread() {
    this.nested.push(UNREAD_PAYLOAD);
  }
  emitCommand() {
    this.commandTokens.forEach((word, index) => {
      this.records.push(
        index === 0 ? { kind: "commandWord", word: withSpacesForNewlines(word) } : { kind: "argument", word: withSpacesForNewlines(word) }
      );
    });
    if (this.unreadStdin !== "") {
      this.records.push({ kind: "stdinText", text: withSpacesForNewlines(this.unreadStdin) });
    }
    this.records.push(...this.nested);
  }
  takeEscape() {
    if (this.rest.startsWith("\n")) {
      this.rest = this.rest.slice(1);
      return;
    }
    this.token += this.rest.slice(0, 1);
    this.tokenOpen = true;
    this.rest = this.rest.slice(1);
  }
  takeSingleQuoted() {
    const span = this.spanBefore("'");
    this.token += span;
    this.rest = this.rest.slice(span.length + 1);
  }
  takeDoubleQuoted() {
    while (this.rest !== "") {
      const ordinary = leadingRunWithout(this.rest, QUOTED_SPECIAL_CHARACTERS);
      if (ordinary !== "") {
        this.token += ordinary;
        this.rest = this.rest.slice(ordinary.length);
        continue;
      }
      const character = this.rest.slice(0, 1);
      this.rest = this.rest.slice(1);
      if (character === '"') return;
      if (character === "\\") {
        this.token += this.rest.slice(0, 1);
        this.rest = this.rest.slice(1);
      } else if (character === "$") {
        this.takeExpansion();
      } else if (character === "`") {
        this.takeBacktick();
      }
    }
  }
  takeExpansion() {
    if (this.rest.startsWith("(")) {
      this.token += "$";
      this.rest = this.rest.slice(1);
      this.deferNestedCommands(this.takeSubstitutionBody());
      return;
    }
    if (this.rest.startsWith("{")) {
      const span = this.spanBefore("}");
      this.token += `$${span}}`;
      this.rest = this.rest.slice(span.length + 1);
      return;
    }
    this.token += "$";
  }
  takeSubstitutionBody() {
    let nesting = 1;
    let body = "";
    while (this.rest !== "") {
      const ordinary = leadingRunWithout(this.rest, "()");
      body += ordinary;
      this.rest = this.rest.slice(ordinary.length);
      const character = this.rest.slice(0, 1);
      this.rest = this.rest.slice(1);
      if (character === "(") {
        nesting += 1;
        body += "(";
      } else if (character === ")") {
        nesting -= 1;
        if (nesting === 0) return body;
        body += ")";
      }
    }
    return body;
  }
  takeBacktick() {
    const span = this.spanBefore("`");
    this.token += "$";
    this.rest = this.rest.slice(span.length + 1);
    this.deferNestedCommands(span);
  }
  dropComment() {
    this.rest = this.rest.slice(this.spanBefore("\n").length);
  }
  takeRedirect() {
    this.redirectTargetPending = true;
    while (this.rest !== "" && ">&|".includes(this.rest.slice(0, 1))) {
      this.rest = this.rest.slice(1);
    }
  }
  takeInputRedirect() {
    if (this.rest.startsWith("<<")) {
      this.rest = this.rest.slice(2);
      this.endToken();
      this.herestringPending = true;
      return;
    }
    if (this.rest.startsWith("<")) {
      this.rest = this.rest.slice(1);
      const stripsTabs = this.rest.startsWith("-");
      if (stripsTabs) this.rest = this.rest.slice(1);
      this.pendingHeredocs.push({ delimiter: this.takeHeredocDelimiter(), stripsTabs });
      return;
    }
    this.endToken();
    this.takeRedirect();
  }
  takeHeredocDelimiter() {
    let delimiter = "";
    while (this.rest !== "") {
      const leading = this.rest.slice(0, 1);
      if (leading === " " || leading === "	") {
        if (delimiter !== "") return delimiter;
        this.rest = this.rest.slice(1);
        continue;
      }
      const ordinary = leadingRunWithout(this.rest, SPECIAL_CHARACTERS);
      if (ordinary !== "") {
        delimiter += ordinary;
        this.rest = this.rest.slice(ordinary.length);
        continue;
      }
      if (leading !== "'" && leading !== '"' && leading !== "\\") return delimiter;
      this.rest = this.rest.slice(1);
    }
    return delimiter;
  }
  takeHeredocBodies() {
    if (this.pendingHeredocs.length === 0) return;
    this.stripCommandPrefixes();
    while (this.pendingHeredocs.length > 0) {
      const heredoc = this.pendingHeredocs.shift();
      const body = this.takeHeredocBody(heredoc);
      if (isShellInterpreter(this.commandTokens[0] ?? "")) this.deferNestedCommands(body);
      else this.unreadStdin += body;
    }
  }
  takeHeredocBody(heredoc) {
    if (heredoc.stripsTabs) return this.takeBodyByLines(heredoc);
    return this.takeBodyToTerminator(heredoc.delimiter) ?? this.takeBodyByLines(heredoc);
  }
  takeBodyToTerminator(delimiter) {
    const at = this.rest.indexOf(`
${delimiter}
`);
    if (at === -1) return void 0;
    const body = this.rest.slice(0, at);
    this.rest = this.rest.slice(body.length + delimiter.length + 2);
    return body;
  }
  takeBodyByLines(heredoc) {
    let body = "";
    while (this.rest !== "") {
      const line = this.spanBefore("\n");
      this.rest = this.rest.slice(line.length + 1);
      const probe = heredoc.stripsTabs ? line.replace(/^\t+/, "") : line;
      if (probe === heredoc.delimiter) return body;
      body += `${line}
`;
    }
    return body;
  }
  spanBefore(stopper) {
    const at = this.rest.indexOf(stopper);
    return at === -1 ? this.rest : this.rest.slice(0, at);
  }
};

// core/src/hosts/envelope.ts
var ALLOWED = {
  verdict: { kind: "allow" },
  events: []
};
var NO_VERDICT = {
  verdict: { kind: "noVerdict" },
  events: []
};
var JSON_SPACE = "[\\t\\n\\v\\f\\r ]";
var STOP_HOOK_ACTIVE = new RegExp(`"stop_hook_active"${JSON_SPACE}*:${JSON_SPACE}*true`);
function readEnvelope(hookText, caller) {
  const payload = asCommandSubstitutionCaptures(hookText);
  return {
    caller,
    payloadRead: parsedPayload(payload).kind,
    sessionId: jsonField(payload, "session_id"),
    cwd: jsonField(payload, "cwd"),
    toolName: jsonField(payload, "tool_name"),
    filePath: jsonField(payload, "file_path"),
    commandLine: jsonCommandLine(payload),
    source: jsonField(payload, "source"),
    agentId: jsonField(payload, "agent_id"),
    agentType: jsonField(payload, "agent_type"),
    permissionMode: jsonField(payload, "permission_mode"),
    transcriptPath: jsonField(payload, "transcript_path"),
    turnId: jsonField(payload, "turn_id"),
    lastAssistantMessage: jsonField(payload, "last_assistant_message"),
    escapedLastAssistantMessage: escapedField(payload, "last_assistant_message"),
    prompt: jsonField(payload, "prompt"),
    escapedPrompt: escapedField(payload, "prompt"),
    stopHookActive: STOP_HOOK_ACTIVE.test(payload)
  };
}
function jsonCommandLine(payload) {
  const escaped = escapedField(payload, "command");
  if ([...escaped].length > MAX_LEXED_INPUT_BYTES) return asCommandSubstitutionCaptures(escaped);
  return jsonField(payload, "command");
}
function jsonField(hookText, field) {
  const payload = asCommandSubstitutionCaptures(hookText);
  return asHookFieldValue(theFirstStringNamed(payload, field));
}
function theFirstStringNamed(payload, field) {
  const payloadRead = parsedPayload(payload);
  if (payloadRead.kind === "unparseable") return unescapedJson(escapedField(payload, field));
  return firstStringNamedWithin(payloadRead.document, field) ?? "";
}
function parsedPayload(payload) {
  try {
    return { kind: "json", document: JSON.parse(payload) };
  } catch {
    return { kind: "unparseable" };
  }
}
function firstStringNamedWithin(document, field) {
  const unvisited = [document];
  while (unvisited.length > 0) {
    const node = unvisited.pop();
    if (node === null || typeof node !== "object") continue;
    const named2 = Array.isArray(node) ? void 0 : node[field];
    if (typeof named2 === "string") return named2;
    for (const child of Object.values(node).reverse()) unvisited.push(child);
  }
  return void 0;
}
function asHookFieldValue(value) {
  return asCommandSubstitutionCaptures(withoutCarriageReturns(asCommandSubstitutionCaptures(value)));
}
function asCommandSubstitutionCaptures(text) {
  return text.replaceAll("\0", "").replace(/\n+$/, "");
}
function escapedField(hookText, field) {
  const pattern = new RegExp(`"${field}"${JSON_SPACE}*:${JSON_SPACE}*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`);
  return pattern.exec(asCommandSubstitutionCaptures(hookText))?.[1] ?? "";
}
var NAMED_ESCAPES = {
  n: "\n",
  t: "	",
  r: "\r",
  b: "\b",
  f: "\f"
};
function unescapedJson(escaped) {
  let decoded = "";
  let rest = escaped;
  while (rest !== "") {
    const backslash = rest.indexOf("\\");
    if (backslash === -1) return decoded + rest;
    decoded += rest.slice(0, backslash);
    const escape = rest.slice(backslash + 1, backslash + 2);
    decoded += NAMED_ESCAPES[escape] ?? escape;
    rest = rest.slice(backslash + 2);
  }
  return decoded;
}
function withoutCarriageReturns(value) {
  let settled = value;
  for (; ; ) {
    const collapsed = settled.replaceAll("\r\n", "\n");
    if (collapsed === settled) return settled.replace(/\r$/, "");
    settled = collapsed;
  }
}

// core/src/routes/routes.ts
var GATE_BUNDLE = "gate.js";
var GATE_ROWS = [
  {
    gate: "commit",
    event: "PreToolUse",
    script: "block-commit-until-green.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "edits",
    event: "PreToolUse",
    script: "block-edits-without-slice.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "unknown",
    event: "PreToolUse",
    script: "block-unknown-tool.sh",
    wiring: { claude: "none", codex: "wired", opencode: "wired" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "handoff",
    event: "SubagentStop",
    script: "publish-subagent-handoff.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "native" }
  },
  {
    gate: "planstop",
    event: "Stop",
    script: "capture-plan-approval.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "none" }
  },
  {
    gate: "autocontinue",
    event: "Stop",
    script: "auto-continue.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "native" }
  },
  {
    gate: "planprompt",
    event: "UserPromptSubmit",
    script: "approve-plan-token.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "none" }
  },
  {
    gate: "statebin",
    event: "SessionStart",
    script: "persist-state-bin.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "native" }
  },
  {
    gate: "stale",
    event: "SessionStart",
    script: "warn-stale-state.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "experimental.chat.system.transform" }
  },
  {
    gate: "version",
    event: "SessionStart",
    script: "warn-stale-version.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "none" }
  },
  {
    gate: "teardown",
    event: "SessionEnd",
    script: "cleanup-state.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "dispose" }
  },
  {
    gate: "proddeploy",
    event: "PreToolUse",
    script: "block-prod-deploy.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "reanchor",
    event: "SessionStart",
    script: "reanchor-after-compact.sh",
    wiring: { claude: "wired", codex: "none", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "event" }
  }
];
function gateRow(gate) {
  const found = GATE_ROWS.find((row) => row.gate === gate);
  if (found === void 0) throw new Error(`no route row names the gate ${gate}`);
  return found;
}

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
import { homedir } from "node:os";
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
  constructor(journalFile, options) {
    super(`cannot append the milestone to ${journalFile}`, options);
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
var NAME_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
var NAME_TOKEN_MAX_LENGTH = 128;
var LOCK_STALE_SECONDS = 30;
var LOCK_MAX_TRIES = 200;
var LOCK_RETRY_MS = 50;
var EVENTS_SCHEMA_VERSION = 2;
var COMMAND_HEAD_BYTES = 120;
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stateRootDirectory() {
  const configured = process.env["OSO_STATE_DIR"];
  if (configured !== void 0 && configured !== "") return configured;
  return path.join(homeDirectory(), ".local", "state", "oso-code");
}
function stateFileFor(cwd) {
  const directory = cwd.replace(/\r$/, "");
  const identity = gitCommonDirectory(directory) || directory;
  return path.join(stateRootDirectory(), `${sha256Hex(identity)}.state`);
}
function repositoryIdFor(stateFile) {
  return path.basename(stateFile, ".state");
}
function journalFileFor(cwd) {
  const stateFile = stateFileFor(cwd);
  const repositoryId = repositoryIdFor(stateFile);
  const autoChange = readValue(stateFile, "auto_change") ?? "";
  const change = CHANGE_SLUG_PATTERN.test(autoChange) ? autoChange : "run";
  return path.join(stateRootDirectory(), "runs", repositoryId, `${change}.log`);
}
function isNameToken(value) {
  return value.length >= 1 && value.length <= NAME_TOKEN_MAX_LENGTH && NAME_TOKEN_PATTERN.test(value);
}
function stateRecords(content, key) {
  const prefix = `${key}=`;
  return content.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}
function stateValue(content, key) {
  return stateRecords(content, key).join("\n");
}
function stateSays(content, key, value) {
  return stateRecords(content, key).includes(value);
}
function readValue(stateFile, key) {
  const content = readFileIfPresent(stateFile);
  if (content === void 0 || stateRecords(content, key).length === 0) return void 0;
  return stateValue(content, key);
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
function isSymlink(target) {
  const stats = lstatOrUndefined(target);
  return stats !== void 0 && stats.isSymbolicLink();
}
function isDirectory(target) {
  const stats = statOrUndefined(target);
  return stats !== void 0 && stats.isDirectory();
}
function isRegularNonSymlinkFile(target) {
  const stats = lstatOrUndefined(target);
  return stats !== void 0 && stats.isFile();
}
function isReadableRegularFile(target) {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
function isPrivateRegularFile(target) {
  if (process.platform === "win32") return isReadableRegularFile(target);
  if (!isReadableRegularFile(target)) return false;
  return (statSync(target).mode & 511) === 384;
}
function secondsSinceModified(target) {
  const stats = statOrUndefined(target);
  if (stats === void 0) return void 0;
  return (Date.now() - stats.mtimeMs) / 1e3;
}
function writeFileAtomically(directory, finalPath, content, tempPrefix) {
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(directory, `${tempPrefix}${randomBytes(3).toString("hex")}`);
    try {
      writeFileSync(candidate, content, { flag: "wx", mode: 384 });
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") continue;
      throw error;
    }
    renameSync(candidate, finalPath);
    return;
  }
  throw new Error(`could not create a temp file under ${directory}`);
}
function withLock(stateFile, sessionId, run2) {
  const release = acquireLock(stateFile, sessionId);
  try {
    return run2();
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
  } catch (error) {
    throw new JournalAppendError(journalFile, { cause: error });
  }
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
      writeFileSync(candidate, content, { flag: "wx", mode: 384 });
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
function lstatOrUndefined(target) {
  try {
    return lstatSync(target);
  } catch {
    return void 0;
  }
}
function statOrUndefined(target) {
  try {
    return statSync(target);
  } catch {
    return void 0;
  }
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

// core/src/gates/delegation.ts
import { mkdirSync as mkdirSync2, rmSync as rmSync2, statSync as statSync2, utimesSync, writeFileSync as writeFileSync2 } from "node:fs";
import path3 from "node:path";

// core/src/gates/preflight.ts
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
function sanitizeSession(raw) {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
function hookSessionId(envelope) {
  const named2 = envelope.caller.agentSession;
  return sanitizeSession(named2 !== "" ? named2 : envelope.sessionId);
}
function payloadUnparseable() {
  return { verdict: { kind: "allow" }, events: [{ event: "payload-unparseable", session: "" }] };
}
function readArmedState(stateFile) {
  const read = readStateFile(stateFile);
  if (read.kind === "absent") return { kind: "absent" };
  if (read.kind === "unreadable") return { kind: "unusable" };
  return { kind: "readable", content: read.content };
}
function osoStateRemedy(session, verbAndArguments) {
  return `oso-state --session ${session} ${verbAndArguments}`;
}
function denied(denial) {
  const route = gateRow(denial.gate);
  return {
    verdict: { kind: "deny", message: denial.message },
    events: [
      {
        event: denial.event,
        session: denial.session,
        command: denial.detail ?? "",
        gate: route.script,
        hookEvent: route.event
      }
    ]
  };
}
function unusableStateMessage(stateFile, session) {
  return `oso-code: this session is armed but its state file (${stateFile}) cannot be read, so the gate cannot tell whether this call is safe. Remove or repair it (${osoStateRemedy(session, "clear")}), then retry.`;
}
function deniedForUnusableState(gate, stateFile, session) {
  return denied({
    gate,
    message: unusableStateMessage(stateFile, session),
    event: "state-unreadable",
    session
  });
}
function allowedWithResidueCounted(session, command) {
  return { verdict: { kind: "allow" }, events: [{ event: "residue-allowed", session, command }] };
}
function pluginRootDirectory() {
  const configured = process.env["CLAUDE_PLUGIN_ROOT"];
  if (configured !== void 0 && configured !== "") return configured;
  return pluginRootAbove(path2.dirname(fileURLToPath(import.meta.url)));
}
var PLUGIN_ROOT_WRAPPERS = [[], ["plugin"]];
var HOOKS_MANIFEST_LOCATIONS = [["hooks.json"], ["hooks", "hooks.json"]];
var HOOKS_MANIFEST_FINGERPRINT = `/${GATE_BUNDLE}`;
function pluginRootAbove(moduleDirectory) {
  let candidate = moduleDirectory;
  while (true) {
    for (const wrapper of PLUGIN_ROOT_WRAPPERS) {
      const root = path2.join(candidate, ...wrapper);
      if (existsSync(path2.join(root, "bin", "oso-state")) && isVerifiedOsoCodeRoot(root)) return root;
    }
    const parent = path2.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        `no ancestor of ${moduleDirectory} carries a verified oso-code bin/oso-state, directly or one level under plugin/, to anchor the plugin root on`
      );
    }
    candidate = parent;
  }
}
function isVerifiedOsoCodeRoot(root) {
  return HOOKS_MANIFEST_LOCATIONS.some((segments) => hooksManifestFingerprinted(path2.join(root, ...segments)));
}
function hooksManifestFingerprinted(manifestFile) {
  try {
    return readFileSync2(manifestFile, "utf8").includes(HOOKS_MANIFEST_FINGERPRINT);
  } catch {
    return false;
  }
}

// core/src/gates/delegation.ts
var DELEGATION_WAIT_CEILING_MINUTES = 45;
var DELEGATION_WAIT_CEILING_SECONDS = DELEGATION_WAIT_CEILING_MINUTES * 60;
var DELEGATION_WAIT_RENEWALS_CAP = 3;
var DELEGATION_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
var DISARMED_LABEL = "none";
var COUNT_PATTERN = /^[0-9]+$/;
var MARK_SUFFIX = ".waiting";
var OWNER_ONLY_FILE = 384;
var OWNER_ONLY_DIRECTORY = 448;
var EXPIRED_DELEGATION_CLAUSE = `A delegation is marked in flight and that mark is older than ${DELEGATION_WAIT_CEILING_MINUTES} minutes, so treat it as lost unless its completion notification still arrives.`;
function waitExpired(now, markedAtEpochSeconds) {
  return now - markedAtEpochSeconds >= DELEGATION_WAIT_CEILING_SECONDS;
}
function nowEpochSeconds() {
  return Math.floor(Date.now() / 1e3);
}
function isDelegationLabel(label) {
  return label !== DISARMED_LABEL && DELEGATION_LABEL_PATTERN.test(label);
}
function isCount(value) {
  return COUNT_PATTERN.test(value);
}
function waitMarkFileFor(cwd, runSession) {
  const repository = repositoryIdFor(stateFileFor(cwd));
  return path3.join(stateRootDirectory(), "runs", repository, `${sanitizeSession(runSession)}${MARK_SUFFIX}`);
}
function readWaitMark(markFile) {
  const stats = statSync2(markFile, { throwIfNoEntry: false });
  if (stats === void 0 || !stats.isFile()) return void 0;
  const read = readStateFile(markFile);
  if (read.kind !== "ok") return void 0;
  return {
    run: stateValue(read.content, "run"),
    session: stateValue(read.content, "session"),
    journalBytes: countIn(read.content, "journal_bytes"),
    renewals: countIn(read.content, "renewals"),
    markedAtEpochSeconds: Math.floor(stats.mtimeMs / 1e3)
  };
}
function writeWaitMark(markFile, mark) {
  mkdirSync2(path3.dirname(markFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  writeFileSync2(markFile, serializedMark(mark), { mode: OWNER_ONLY_FILE });
}
function adoptMarkIntoRun(markFile, mark, run2) {
  const clock = statSync2(markFile).mtime;
  writeWaitMark(markFile, { ...mark, run: run2 });
  utimesSync(markFile, clock, clock);
}
function removeWaitMark(markFile) {
  try {
    rmSync2(markFile, { force: true });
    return void 0;
  } catch (cause) {
    return noDirectoryHoldsTheMark(cause) ? void 0 : causeOf(cause);
  }
}
function noDirectoryHoldsTheMark(cause) {
  return isErrnoException(cause) && cause.code === "ENOTDIR";
}
function serializedMark(mark) {
  return `run=${mark.run}
session=${mark.session}
journal_bytes=${mark.journalBytes}
renewals=${mark.renewals}
`;
}
function countIn(content, key) {
  const value = stateValue(content, key);
  return isCount(value) ? Number(value) : 0;
}

// core/src/gates/autocontinue.ts
var PUSHES_WITHOUT_PROGRESS_CAP = 3;
var RUN_ARMED = "running";
var OWNER_ONLY_FILE2 = 384;
var OWNER_ONLY_DIRECTORY2 = 448;
var RE_ANCHOR_THE_RUN = "oso-code: this run is unattended and still in flight, and this turn ended without parking or closing it. Continue it: re-read the position from the change's oso/index NEXT: line and from active_slice in oso-state, append every milestone to the run journal with oso-state journal, and park the run per the flow's own rules if a decision needs the operator.";
var NOTIFICATION_RESUMED_HOST = {
  order: `${RE_ANCHOR_THE_RUN} If a delegation is still in flight, do NOT relaunch it \u2014 its completion notification is what resumes the run, so wait for that instead.`,
  delegationsReturnInTurn: false,
  sidecarPath: waitMarkFileFor
};
var DELEGATIONS_RETURN_IN_TURN_HOST = {
  order: `${RE_ANCHOR_THE_RUN} A delegation on this host returns inside the turn that launched it, so a turn that has ended left none in flight: read the report the launch itself returned rather than waiting for a notification this host never sends.`,
  delegationsReturnInTurn: true,
  sidecarPath: waitMarkFileFor
};
var CONTINUATION_HOSTS = {
  claude: NOTIFICATION_RESUMED_HOST,
  codex: NOTIFICATION_RESUMED_HOST,
  opencode: DELEGATIONS_RETURN_IN_TURN_HOST
};
function continuationHostOf(host) {
  return CONTINUATION_HOSTS[host];
}
var CAP_MILESTONE = `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress \u2014 allowing the stop`;
var EXPIRED_DELEGATION_CAP_MILESTONE = `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes with a delegation marked in flight past ${DELEGATION_WAIT_CEILING_MINUTES} minutes \u2014 allowing the stop`;
var AUTOCONTINUE_GATE = {
  gate: "autocontinue",
  errorSubject: "the unattended-run continuation gate",
  judge: judgeAutocontinue
};
function judgeAutocontinue({ envelope }) {
  const host = continuationHostOf(envelope.caller.host);
  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;
  const projectDir = envelope.cwd;
  if (!isDirectory(projectDir)) return ALLOWED;
  const content = ownRunState(stateFileFor(projectDir), sessionId);
  if (content === void 0) return ALLOWED;
  const markFile = host.sidecarPath(projectDir, sessionId);
  if (stateValue(content, "auto") !== RUN_ARMED) {
    const failure = removeWaitMark(markFile);
    return failure === void 0 ? ALLOWED : degraded(sessionId, failure);
  }
  const journalFile = journalFileFor(projectDir);
  const position = {
    projectDir,
    sessionId,
    markFile,
    journalFile,
    tallyFile: tallyFileFor(journalFile),
    journalBytes: journalBytesIn(journalFile),
    run: stateValue(content, "auto_change")
  };
  const label = stateValue(content, "auto_wait");
  if (!isDelegationLabel(label) || host.delegationsReturnInTurn) {
    const failure = removeWaitMark(markFile);
    const pushed = pushUnlessCapped(position, envelope.stopHookActive, host.order, CAP_MILESTONE);
    if (failure === void 0) return pushed;
    return { ...pushed, events: [...pushed.events, degradedEvent(sessionId, failure)] };
  }
  const held2 = holdUnlessExpired(position, label);
  if (held2 !== void 0) return held2;
  return pushUnlessCapped(
    position,
    envelope.stopHookActive,
    `${host.order} ${EXPIRED_DELEGATION_CLAUSE}`,
    EXPIRED_DELEGATION_CAP_MILESTONE
  );
}
function holdUnlessExpired(position, label) {
  const standing = readWaitMark(position.markFile);
  if (standing === void 0 || standing.session !== position.sessionId) {
    return sightedThenHeld(position, label, 0);
  }
  const carried = carryMarkIntoThisRun(position, standing);
  if (carried !== void 0) return carried;
  if (!waitExpired(nowEpochSeconds(), standing.markedAtEpochSeconds)) return held(position, label);
  if (position.journalBytes <= standing.journalBytes) return void 0;
  if (standing.renewals >= DELEGATION_WAIT_RENEWALS_CAP) return void 0;
  return sightedThenHeld(position, label, standing.renewals + 1);
}
function carryMarkIntoThisRun(position, standing) {
  if (standing.run === position.run) return void 0;
  try {
    adoptMarkIntoRun(position.markFile, standing, position.run);
    return void 0;
  } catch (cause) {
    return degraded(position.sessionId, causeOf(cause));
  }
}
function sightedThenHeld(position, label, renewals) {
  try {
    writeWaitMark(position.markFile, {
      run: position.run,
      session: position.sessionId,
      journalBytes: position.journalBytes,
      renewals
    });
  } catch (cause) {
    return degraded(position.sessionId, causeOf(cause));
  }
  return held(position, label);
}
function pushUnlessCapped(position, turnAlreadyContinued, order, capMilestone) {
  const counted = pushesWithoutProgress(position, turnAlreadyContinued);
  if (typeof counted !== "number") return counted;
  if (counted > PUSHES_WITHOUT_PROGRESS_CAP) {
    const announced = counted === PUSHES_WITHOUT_PROGRESS_CAP + 1 ? announceCap(position, capMilestone) : [];
    const failure2 = rememberPush(position, counted, journalBytesIn(position.journalFile));
    const trailing = failure2 === void 0 ? [] : [degradedEvent(position.sessionId, failure2)];
    return { verdict: { kind: "allow" }, events: [...announced, ...trailing] };
  }
  const failure = rememberPush(position, counted, position.journalBytes);
  if (failure !== void 0) return degraded(position.sessionId, failure);
  return { verdict: { kind: "push", reason: order }, events: [gateEvent("auto-continued", position.sessionId, "")] };
}
function pushesWithoutProgress(position, turnAlreadyContinued) {
  const started = turnAlreadyContinued ? 1 : 0;
  const stats = statSync3(position.tallyFile, { throwIfNoEntry: false });
  if (stats === void 0) return started + 1;
  const read = stats.isFile() ? readStateFile(position.tallyFile) : { kind: "unreadable", cause: "" };
  if (read.kind !== "ok") return degraded(position.sessionId, "the push tally is not a readable file");
  const remembered = stateValue(read.content, "pushes");
  if (!isCount(remembered)) {
    return degraded(position.sessionId, `the push tally holds no count of pushes: ${remembered}`);
  }
  const bytesAtLastPush = stateValue(read.content, "journal_bytes");
  if (!isCount(bytesAtLastPush)) {
    return degraded(position.sessionId, `the push tally holds no count of journal bytes: ${bytesAtLastPush}`);
  }
  return (position.journalBytes > Number(bytesAtLastPush) ? 0 : Number(remembered)) + 1;
}
function announceCap(position, milestone) {
  try {
    appendJournal(journalFileFor(position.projectDir), milestone);
    return [];
  } catch (cause) {
    return [gateEvent("auto-continue-unjournaled", position.sessionId, causeOf(cause))];
  }
}
function rememberPush(position, pushes, journalBytes) {
  try {
    mkdirSync3(path4.dirname(position.tallyFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY2 });
    writeFileSync3(position.tallyFile, `pushes=${pushes}
journal_bytes=${journalBytes}
`, { mode: OWNER_ONLY_FILE2 });
    return void 0;
  } catch (cause) {
    return causeOf(cause);
  }
}
function held(position, label) {
  return { verdict: { kind: "allow" }, events: [gateEvent("auto-continue-held", position.sessionId, label)] };
}
function degraded(sessionId, cause) {
  return { verdict: { kind: "allow" }, events: [degradedEvent(sessionId, cause)] };
}
function degradedEvent(sessionId, cause) {
  return gateEvent("auto-continue-degraded", sessionId, cause);
}
function gateEvent(event, session, detail) {
  const route = gateRow("autocontinue");
  return { event, session, command: detail, gate: route.script, hookEvent: route.event };
}
function ownRunState(stateFile, sessionId) {
  const stats = statSync3(stateFile, { throwIfNoEntry: false });
  if (stats === void 0 || !stats.isFile()) return void 0;
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return void 0;
  return stateValue(read.content, "session") === sessionId ? read.content : void 0;
}
function tallyFileFor(journalFile) {
  return path4.join(path4.dirname(journalFile), `${path4.basename(journalFile, ".log")}.pushes`);
}
function journalBytesIn(journalFile) {
  const stats = statSync3(journalFile, { throwIfNoEntry: false });
  return stats !== void 0 && stats.isFile() ? stats.size : 0;
}

// core/src/shell/lexed-command.ts
var GIT_VERB_UNRESOLVED = "?";
var GIT_COMMAND_WORDS = /* @__PURE__ */ new Set(["git", "git.exe"]);
var SUBJECT_READING_INTERPRETERS = /* @__PURE__ */ new Set(["python", "node", "perl", "ruby", "php"]);
var GIT_OPTIONS_TAKING_A_VALUE = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--attr-source"
]);
var GIT_OPTIONS_PRINTING_AND_EXITING = /* @__PURE__ */ new Set([
  "-h",
  "--help",
  "-v",
  "--version",
  "--exec-path",
  "--html-path",
  "--man-path",
  "--info-path"
]);
var GIT_OPTIONS_STANDING_ALONE = /* @__PURE__ */ new Set([
  "-p",
  "-P",
  "--paginate",
  "--no-pager",
  "--bare",
  "--no-replace-objects",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-advice",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs"
]);
function isGitCall(command) {
  const commandWord = command.tokens[0];
  return commandWord !== void 0 && GIT_COMMAND_WORDS.has(basenameOf(commandWord));
}
function gitVerb(command) {
  for (let index = 1; index < command.tokens.length; index += 1) {
    const argument = command.tokens[index];
    if (argument.startsWith("--") && argument.includes("=")) continue;
    if (!argument.startsWith("-")) return argument;
    if (GIT_OPTIONS_PRINTING_AND_EXITING.has(argument)) return "";
    if (GIT_OPTIONS_TAKING_A_VALUE.has(argument)) index += 1;
    else if (!GIT_OPTIONS_STANDING_ALONE.has(argument)) return GIT_VERB_UNRESOLVED;
  }
  return "";
}
function isResidueCall(command, subjects) {
  const commandWord = command.tokens[0];
  if (commandWord === void 0) return false;
  if (commandWord.includes("$")) return true;
  if (isGitCall(command)) {
    const verb = gitVerb(command);
    return verb === GIT_VERB_UNRESOLVED || verb.includes("$");
  }
  return isInterpreterHandedASubject(command, subjects);
}
function isInterpreterHandedASubject(command, subjects) {
  const commandWord = command.tokens[0];
  const interpreter = basenameOf(commandWord).replace(/[0-9][\s\S]*$/, "");
  if (!SUBJECT_READING_INTERPRETERS.has(interpreter)) return false;
  if (command.tokens.slice(1).some((argument) => mentionsASubject(argument, subjects))) return true;
  return mentionsASubject(command.stdin, subjects);
}
function mentionsASubject(text, subjects) {
  return subjects.some((subject) => text.includes(subject));
}

// core/src/shell/line-verdict.ts
function lineVerdict(commandLine, judge) {
  let verdict = "clear";
  let tokens = [];
  let stdin = "";
  for (const record of lexShellCommands(commandLine)) {
    switch (record.kind) {
      case "unreadPayload":
        if (verdict === "clear") verdict = "unread";
        break;
      case "commandWord":
        verdict = judge({ tokens, stdin }, verdict);
        tokens = [record.word];
        stdin = "";
        break;
      case "argument":
        tokens.push(record.word);
        break;
      case "stdinText":
        stdin += record.text;
        break;
    }
  }
  return judge({ tokens, stdin }, verdict);
}

// core/src/gates/commit.ts
var COMMIT_SUBJECTS = ["git"];
var GATED_GIT_VERBS = /* @__PURE__ */ new Set([
  "commit",
  "commit-tree",
  "update-ref",
  "filter-branch",
  "replace",
  "fast-import"
]);
var READ_ONLY_GIT_OPTIONS = /* @__PURE__ */ new Set(["commit:--dry-run", "commit:-h", "commit:--help", "replace:-l"]);
var REMEDY_BY_MODE = {
  plan: "Resume plan mode's apply \u2192 verify loop until the verifier returns pass",
  quick: "Finish quick mode's close step \u2014 run the project's checks to zero warnings",
  debug: "Finish debug mode's close step \u2014 run the quality-pass judge to zero warnings"
};
var REMEDY_FOR_ANY_MODE = "Finish the active mode's checks to zero warnings \u2014 plan mode's apply \u2192 verify loop, or quick/debug mode's close step";
var COMMIT_GATE = {
  gate: "commit",
  errorSubject: "the commit gate",
  judge: judgeCommit
};
function untilGreenMessage(stateContent) {
  const remedy = REMEDY_BY_MODE[stateValue(stateContent, "mode")] ?? REMEDY_FOR_ANY_MODE;
  return `oso-code: the session verify is not green. ${remedy}, then retry the commit.`;
}
function verifyIsGreen(stateContent) {
  return stateValue(stateContent, "verify_green") === "true";
}
function judgeCommit({ envelope }) {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("commit", stateFile, session);
  const verdict = lineVerdict(envelope.commandLine, judgeCommitLine);
  if (verdict === "clear") return ALLOWED;
  if (verifyIsGreen(state.content)) return ALLOWED;
  if (verdict === "residue" || verdict === "unread") {
    return allowedWithResidueCounted(session, envelope.commandLine);
  }
  return denied({
    gate: "commit",
    message: untilGreenMessage(state.content),
    event: "commit-denied",
    session,
    detail: envelope.commandLine
  });
}
function judgeCommitLine(command, verdict) {
  if (isGatedGitCall(command)) return "gated";
  if (verdict === "clear" && isResidueCall(command, COMMIT_SUBJECTS)) return "residue";
  return verdict;
}
function isGatedGitCall(command) {
  if (!isGitCall(command)) return false;
  const verb = gitVerb(command);
  if (verb === "" || !GATED_GIT_VERBS.has(verb)) return false;
  return !gitCallOnlyReports(command, verb);
}
function gitCallOnlyReports(command, verb) {
  let valuePosition = false;
  for (const token of command.tokens.slice(1)) {
    if (token === "--") return false;
    if (!valuePosition && READ_ONLY_GIT_OPTIONS.has(`${verb}:${token}`)) return true;
    valuePosition = token.startsWith("-") && !(token.startsWith("--") && token.includes("="));
  }
  return false;
}

// core/src/gates/edits.ts
var EDITS_GATE = {
  gate: "edits",
  errorSubject: "the slice gate",
  judge: judgeEdits
};
function judgeEdits({ envelope }) {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("edits", stateFile, session);
  if (!stateSays(state.content, "mode", "plan")) return ALLOWED;
  if (aSliceIsActive(state.content)) return ALLOWED;
  const remedy = osoStateRemedy(session, "set active_slice=<n>");
  return denied({
    gate: "edits",
    message: `oso-code: plan mode is active but no slice is active. Activate it first (${remedy}), then retry the edit.`,
    event: "edit-denied",
    session,
    detail: envelope.filePath
  });
}
function aSliceIsActive(stateContent) {
  const slices = stateRecords(stateContent, "active_slice");
  return slices.some((slice) => slice !== "") && !slices.includes("none");
}

// core/src/state/handoff.ts
import { chmodSync, existsSync as existsSync2, mkdirSync as mkdirSync4, readFileSync as readFileSync3, readdirSync, rmSync as rmSync3 } from "node:fs";
import path5 from "node:path";
var HandoffFailure = class extends Error {
};
var TTL_SECONDS = 86400;
var LOCK_TIMEOUT_SECONDS = 2;
var POLL_INTERVAL_MS = 50;
var OPAQUE_ID_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
var OPAQUE_ID_MAX_LENGTH = 256;
var ATTEMPT_PATTERN = /^[1-9][0-9]{0,8}$/;
var ATTEMPT_VALUE_PATTERN = /^attempt=[1-9][0-9]{0,8}$/;
var RECEIPT_ARTIFACT_PATTERN = /^([0-9a-f]{64})\.(receipt|consumed|watermark)$/;
var TEMP_ARTIFACT_PATTERN = /^\.([0-9a-f]{64})\.(receipt|consuming|watermark)\.[a-zA-Z0-9]{6}$/;
var RECEIPT_KEYS = ["version", "hook_session", "slice", "attempt", "agent_id", "agent_type"];
var WATERMARK_KEYS = ["version", "attempt"];
function runHandoffPublish(cwd, coordinates, hookSession) {
  validateCoordinates(coordinates);
  if (!isValidOpaqueId(hookSession)) throw new HandoffFailure("invalid hook session id");
  const paths = handoffPaths(cwd, coordinates.agentId);
  mkdirSync4(paths.directory, { recursive: true, mode: 448 });
  protectDirectory(paths.directory);
  globalSweep(paths.directory);
  acquireHandoffLock(paths, nowEpochSeconds2() + LOCK_TIMEOUT_SECONDS);
  try {
    pruneLocked(paths);
    const newest = newestRecordedAttempt(paths);
    const attempt = Number(coordinates.attempt);
    if (attempt < newest) {
      throw new HandoffFailure(`stale publish for slice ${coordinates.slice}: attempt ${attempt}, newest ${newest}`);
    }
    if (attempt === newest) {
      if (existsSync2(paths.receipt) && receiptMatches(paths.receipt, coordinates) && recordsInclude(paths.receipt, `hook_session=${hookSession}`)) {
        return;
      }
      throw new HandoffFailure(`attempt ${attempt} for slice ${coordinates.slice} was already published or consumed`);
    }
    const content = receiptContent(hookSession, coordinates);
    writeFileAtomically(paths.directory, paths.receipt, content, `.${paths.agentKey}.receipt.`);
    writeWatermark(paths, coordinates.attempt);
  } finally {
    releaseHandoffLock(paths);
  }
}
function validateCoordinates(coordinates) {
  if (!isNameToken(coordinates.slice)) throw new HandoffFailure("invalid slice id");
  if (!ATTEMPT_PATTERN.test(coordinates.attempt)) {
    throw new HandoffFailure("attempt must be an integer from 1 to 999999999");
  }
  if (!isValidOpaqueId(coordinates.agentId)) throw new HandoffFailure("invalid agent id");
  if (!isNameToken(coordinates.agentType)) throw new HandoffFailure("invalid agent type");
}
function isValidOpaqueId(value) {
  return value.length >= 1 && value.length <= OPAQUE_ID_MAX_LENGTH && OPAQUE_ID_PATTERN.test(value);
}
function handoffPaths(cwd, agentId) {
  const stateFile = stateFileFor(cwd);
  const agentKey = sha256Hex(agentId);
  const directory = path5.join(stateRootDirectory(), ".handoffs", repositoryIdFor(stateFile));
  return {
    directory,
    agentId,
    agentKey,
    receipt: path5.join(directory, `${agentKey}.receipt`),
    watermark: path5.join(directory, `${agentKey}.watermark`),
    lockDir: path5.join(directory, `${agentKey}.lock`)
  };
}
function protectDirectory(directory) {
  try {
    chmodSync(directory, 448);
  } catch (error) {
    throw new HandoffFailure("cannot protect receipt directory", { cause: error });
  }
}
function nowEpochSeconds2() {
  return Math.floor(Date.now() / 1e3);
}
function acquireHandoffLock(paths, deadline) {
  for (; ; ) {
    try {
      mkdirSync4(paths.lockDir);
      return;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
    }
    if (nowEpochSeconds2() >= deadline) {
      throw new HandoffFailure(`could not acquire receipt lock for agent ${paths.agentId} before the bound`);
    }
    sleepSync(POLL_INTERVAL_MS);
  }
}
function releaseHandoffLock(paths) {
  rmSync3(paths.lockDir, { recursive: true, force: true });
}
function globalSweep(directory) {
  for (const name of directoryEntries(directory)) {
    const key = sweepableArtifactKey(name);
    if (key === void 0) continue;
    sweepArtifact(path5.join(directory, name), path5.join(directory, `${key}.lock`));
  }
}
function sweepableArtifactKey(name) {
  return name.match(RECEIPT_ARTIFACT_PATTERN)?.[1] ?? name.match(TEMP_ARTIFACT_PATTERN)?.[1];
}
function sweepArtifact(artifactPath, sweepLockDir) {
  if (!tryAcquireBareLock(sweepLockDir)) return;
  try {
    if (!isRegularNonSymlinkFile(artifactPath)) return;
    const age = secondsSinceModified(artifactPath);
    if (age === void 0 || age < TTL_SECONDS) return;
    rmSync3(artifactPath, { force: true });
  } finally {
    rmSync3(sweepLockDir, { recursive: true, force: true });
  }
}
function tryAcquireBareLock(lockDir) {
  try {
    mkdirSync4(lockDir);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") return false;
    throw error;
  }
}
function pruneLocked(paths) {
  for (const artifact of [paths.receipt, paths.watermark, ...matchingTempArtifacts(paths)]) {
    if (!existsSync2(artifact)) continue;
    if (!isRegularNonSymlinkFile(artifact)) {
      throw new HandoffFailure(`handoff artifact is not a regular file at ${artifact}`);
    }
    const age = secondsSinceModified(artifact);
    if (age === void 0) throw new HandoffFailure(`cannot determine receipt age at ${artifact}`);
    if (age >= TTL_SECONDS) rmSync3(artifact, { force: true });
  }
}
function matchingTempArtifacts(paths) {
  const prefixes = [`.${paths.agentKey}.receipt.`, `.${paths.agentKey}.consuming.`, `.${paths.agentKey}.watermark.`];
  return directoryEntries(paths.directory).filter((name) => prefixes.some((prefix) => name.startsWith(prefix))).map((name) => path5.join(paths.directory, name));
}
function directoryEntries(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
function newestRecordedAttempt(paths) {
  let newest = 0;
  if (existsSync2(paths.receipt)) {
    if (!receiptIsValid(paths.receipt)) throw new HandoffFailure(`malformed receipt at ${paths.receipt}`);
    newest = Math.max(newest, attemptOf(paths.receipt));
  }
  if (existsSync2(paths.watermark)) {
    if (!watermarkIsValid(paths.watermark)) throw new HandoffFailure(`malformed watermark at ${paths.watermark}`);
    newest = Math.max(newest, attemptOf(paths.watermark));
  }
  return newest;
}
function writeWatermark(paths, attempt) {
  if (existsSync2(paths.watermark)) {
    if (!watermarkIsValid(paths.watermark)) throw new HandoffFailure(`malformed watermark at ${paths.watermark}`);
    const recorded = attemptOf(paths.watermark);
    const attemptNumber = Number(attempt);
    if (recorded > attemptNumber) {
      throw new HandoffFailure(`watermark attempt ${recorded} supersedes receipt attempt ${attemptNumber}`);
    }
    if (recorded === attemptNumber) return;
  }
  writeFileAtomically(
    paths.directory,
    paths.watermark,
    `version=1
attempt=${attempt}
`,
    `.${paths.agentKey}.watermark.`
  );
}
function receiptContent(hookSession, coordinates) {
  return `version=1
hook_session=${hookSession}
slice=${coordinates.slice}
attempt=${coordinates.attempt}
agent_id=${coordinates.agentId}
agent_type=${coordinates.agentType}
`;
}
function receiptIsValid(receiptPath) {
  const content = readPrivateFileContent(receiptPath);
  if (content === void 0 || !isWellFormedRecordFile(content, 6, RECEIPT_KEYS)) return false;
  return recordsOf(content).some((record) => ATTEMPT_VALUE_PATTERN.test(record));
}
function watermarkIsValid(watermarkPath) {
  const content = readPrivateFileContent(watermarkPath);
  if (content === void 0 || !isWellFormedRecordFile(content, 2, WATERMARK_KEYS)) return false;
  return recordsOf(content).some((record) => ATTEMPT_VALUE_PATTERN.test(record));
}
function receiptMatches(receiptPath, coordinates) {
  return receiptIsValid(receiptPath) && recordsInclude(receiptPath, `slice=${coordinates.slice}`) && recordsInclude(receiptPath, `attempt=${coordinates.attempt}`) && recordsInclude(receiptPath, `agent_id=${coordinates.agentId}`) && recordsInclude(receiptPath, `agent_type=${coordinates.agentType}`);
}
function attemptOf(filePath) {
  return Number(readValue(filePath, "attempt"));
}
function recordsInclude(filePath, record) {
  return recordsOf(readPrivateFileContent(filePath) ?? "").includes(record);
}
function isWellFormedRecordFile(content, expectedNewlines, keys) {
  if (newlineCount(content) !== expectedNewlines) return false;
  const records = recordsOf(content);
  if (records.some((record) => !keys.some((key) => record.startsWith(`${key}=`)))) return false;
  if (records.filter((record) => record === "version=1").length !== 1) return false;
  return keys.filter((key) => key !== "version").every((key) => records.filter((record) => record.startsWith(`${key}=`)).length === 1);
}
function newlineCount(content) {
  return (content.match(/\n/g) ?? []).length;
}
function recordsOf(content) {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function readPrivateFileContent(target) {
  if (!isReadableRegularFile(target)) return void 0;
  return readFileSync3(target, "utf8");
}

// core/src/gates/handoff.ts
var MARKER_LINE = /^oso-handoff:/;
var MARKER = /^oso-handoff:[\t\n\v\f\r ]v=1[\t\n\v\f\r ]slice=([A-Za-z0-9][A-Za-z0-9_-]*)[\t\n\v\f\r ]attempt=([1-9][0-9]*)$/;
var MALFORMED_MARKER = "the final message must begin with one exact oso-handoff marker";
var HANDOFF_GATE = {
  gate: "handoff",
  errorSubject: "the subagent-handoff gate",
  judge: judgeHandoff
};
function judgeHandoff({ envelope }) {
  const message = envelope.lastAssistantMessage;
  const markerLines = message.split("\n").filter((line) => MARKER_LINE.test(line));
  if (markerLines.length === 0) return NO_VERDICT;
  const sessionId = hookSessionId(envelope);
  const agentType = envelope.agentType;
  if (sessionId === "") return publishFailed("missing session_id", "", agentType);
  if (!isDirectory(envelope.cwd)) return publishFailed("missing or unreadable cwd", sessionId, agentType);
  if (envelope.agentId === "") return publishFailed("missing agent_id", sessionId, agentType);
  if (agentType === "") return publishFailed("missing agent_type", sessionId, "");
  const named2 = MARKER.exec(message.split("\n")[0] ?? "");
  if (markerLines.length !== 1 || named2 === null) {
    return publishFailed(MALFORMED_MARKER, sessionId, agentType);
  }
  const slice = named2[1];
  const attempt = named2[2];
  try {
    runHandoffPublish(envelope.cwd, { slice, attempt, agentId: envelope.agentId, agentType }, sessionId);
  } catch (cause) {
    if (!(cause instanceof HandoffFailure)) throw cause;
    return publishFailed("oso-state rejected the receipt", sessionId, agentType);
  }
  return {
    verdict: NO_VERDICT.verdict,
    events: [published(sessionId, `${agentType}:${slice}:${attempt}`)]
  };
}
function publishFailed(reason, session, agentType) {
  return {
    verdict: NO_VERDICT.verdict,
    events: [{ event: "handoff-publish-failed", session, command: agentType }],
    stderr: `oso-code: SubagentStop could not publish its handoff: ${reason}
`
  };
}
function published(session, detail) {
  return { event: "handoff-published", session, command: detail };
}

// core/src/gates/planprompt.ts
import { statSync as statSync4 } from "node:fs";

// core/src/hosts/codex-turn.ts
import { readFileSync as readFileSync4 } from "node:fs";
var UNATTESTED = { mode: "unknown", source: "unavailable" };
var SESSION_META = '"type":"session_meta"';
var EVENT_MESSAGE = '"type":"event_msg"';
var TASK_STARTED = '"type":"task_started"';
var MODE_KIND_FIELD = '"collaboration_mode_kind":"';
var PERMISSION_MODES = {
  plan: "plan",
  default: "default",
  acceptEdits: "default",
  dontAsk: "default",
  bypassPermissions: "default"
};
var ATTESTABLE_MODES = { plan: "plan", default: "default" };
function resolveCodexTurn(envelope) {
  const attested = attestedFromTranscript(envelope);
  if (attested !== void 0) return attested;
  return { mode: PERMISSION_MODES[envelope.permissionMode] ?? "unknown", source: sourceFor(envelope.permissionMode) };
}
function transcriptLinesMatching(transcriptPath, fragments) {
  return transcriptLines(transcriptPath).filter((line) => fragments.every((fragment) => line.includes(fragment)));
}
function sourceFor(permissionMode) {
  return PERMISSION_MODES[permissionMode] === void 0 ? "unavailable" : "permission_mode";
}
function attestedFromTranscript(envelope) {
  const { transcriptPath, turnId, sessionId } = envelope;
  if (transcriptPath === "") return void 0;
  if (!isReadableRegularFile(transcriptPath)) return UNATTESTED;
  if (turnId === "" || sessionId === "") return void 0;
  const meta = transcriptLines(transcriptPath)[0] ?? "";
  const metaSession = jsonField(meta, "session_id");
  if (metaSession !== sessionId) return metaSession === "" ? void 0 : UNATTESTED;
  if (!meta.includes(SESSION_META)) return void 0;
  const candidates = transcriptLinesMatching(transcriptPath, [
    EVENT_MESSAGE,
    TASK_STARTED,
    `"turn_id":"${turnId}"`,
    MODE_KIND_FIELD
  ]);
  if (candidates.length === 0) return void 0;
  if (candidates.length > 1) return UNATTESTED;
  const candidate = candidates[0];
  if (jsonField(candidate, "turn_id") !== turnId) return UNATTESTED;
  const mode = ATTESTABLE_MODES[jsonField(candidate, "collaboration_mode_kind")];
  if (mode === void 0) return UNATTESTED;
  return { mode, source: "transcript" };
}
function transcriptLines(transcriptPath) {
  try {
    return readFileSync4(transcriptPath, "utf8").split("\n");
  } catch {
    return [];
  }
}

// core/src/state/plan.ts
import { chmodSync as chmodSync2, existsSync as existsSync3, mkdirSync as mkdirSync5, readFileSync as readFileSync5, renameSync as renameSync2, rmSync as rmSync4 } from "node:fs";
import path6 from "node:path";

// core/src/state/transitions.ts
function armPlan() {
  return { mode: "plan", active_slice: "none", verify_green: "false" };
}

// core/src/state/plan.ts
var PlanFailure = class extends Error {
};
var PlanApprovalError = class extends Error {
};
var PLAN_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
function isValidPlanDigest(value) {
  return PLAN_DIGEST_PATTERN.test(value);
}
function planPaths(stateFile, digest) {
  const root = path6.join(stateRootDirectory(), "plans");
  const dir = path6.join(root, repositoryIdFor(stateFile));
  return {
    root,
    dir,
    presentedFile: path6.join(dir, `presented-${digest}.md`),
    approvedFile: path6.join(dir, `approved-${digest}.md`),
    currentFile: path6.join(dir, "current.md")
  };
}
function ensurePlanDirectory(paths) {
  requireNonSymlinkDirectory(stateRootDirectory(), "state root");
  requireNonSymlinkDirectory(paths.root, "plan root");
  requireNonSymlinkDirectory(paths.dir, "repository plan directory", "repository plan path");
  chmodSync2(paths.root, 448);
  chmodSync2(paths.dir, 448);
}
function requireNonSymlinkDirectory(target, symlinkLabel, directoryLabel = symlinkLabel) {
  if (isSymlink(target)) throw new PlanFailure(`${symlinkLabel} is a symlink: ${target}`);
  mkdirSync5(target, { recursive: true, mode: 448 });
  if (!isDirectory(target)) throw new PlanFailure(`${directoryLabel} is not a directory: ${target}`);
}
function runCapturePlan(cwd, sessionId, digest, document) {
  if (!isValidPlanDigest(digest)) throw new PlanFailure("capture-plan requires one lowercase SHA-256 digest");
  const stateFile = stateFileFor(cwd);
  const paths = planPaths(stateFile, digest);
  ensurePlanDirectory(paths);
  if (document.length === 0) throw new PlanFailure("capture-plan requires a non-empty plan document on stdin");
  return withLock(stateFile, sessionId, () => {
    if (existsSync3(paths.presentedFile)) {
      if (!isPrivateRegularFile(paths.presentedFile)) {
        throw new PlanFailure("presented snapshot is not a private regular file");
      }
      if (readFileSync5(paths.presentedFile, "utf8") !== document) {
        throw new PlanFailure("presented snapshot content disagrees with its approval digest");
      }
    } else {
      writeFileAtomically(paths.dir, paths.presentedFile, document, ".snapshot.");
    }
    if (existsSync3(paths.currentFile) && !isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is not a private regular file");
    }
    writeFileAtomically(paths.dir, paths.currentFile, document, ".current.");
    const arming = armPlan();
    writeStatePairs(
      stateFile,
      [
        `mode=${arming.mode}`,
        `active_slice=${arming.active_slice}`,
        `verify_green=${arming.verify_green}`,
        "plan_approval=pending",
        `plan_approval_digest=${digest}`,
        `plan_approval_session=${sessionId}`,
        `plan_snapshot_file=${paths.presentedFile}`,
        `plan_current_file=${paths.currentFile}`,
        "plan_revision=0"
      ],
      sessionId
    );
    logEvent({ event: "plan-artifact-captured", session: sessionId, command: digest });
    return 0;
  });
}
function runApprovePlan(cwd, sessionId, digest) {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("approve-plan requires one lowercase SHA-256 digest");
  }
  const stateFile = stateFileFor(cwd);
  mkdirSync5(stateRootDirectory(), { recursive: true });
  return withLock(stateFile, sessionId, () => {
    if (!isReadableRegularFile(stateFile)) {
      throw new PlanApprovalError(`no readable pending plan approval for session ${sessionId}`);
    }
    if (readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanApprovalError("pending plan approval belongs to another session");
    }
    if (readValue(stateFile, "mode") !== "plan") {
      throw new PlanApprovalError("pending approval is not attached to plan mode state");
    }
    if (readValue(stateFile, "plan_approval") !== "pending") {
      throw new PlanApprovalError("plan approval is not pending");
    }
    if (readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before approval");
    }
    const paths = planPaths(stateFile, digest);
    ensurePlanDirectory(paths);
    if (readValue(stateFile, "plan_snapshot_file") !== paths.presentedFile) {
      throw new PlanFailure("pending state does not name the expected presented snapshot");
    }
    if (readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("pending state does not name the expected current plan");
    }
    if (!isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe");
    }
    if (isPrivateRegularFile(paths.presentedFile)) {
      if (!byteIdentical(paths.currentFile, paths.presentedFile)) {
        throw new PlanFailure("the pending plan changed since it was presented; capture it again before approving");
      }
      if (existsSync3(paths.approvedFile)) {
        if (!isPrivateRegularFile(paths.approvedFile)) {
          throw new PlanFailure("approved snapshot is not a private regular file");
        }
        if (!byteIdentical(paths.presentedFile, paths.approvedFile)) {
          throw new PlanFailure("approved snapshot content disagrees with the pending document");
        }
        rmSync4(paths.presentedFile, { force: true });
      } else {
        renameSync2(paths.presentedFile, paths.approvedFile);
      }
    } else if (!isPrivateRegularFile(paths.approvedFile)) {
      throw new PlanFailure("presented plan snapshot is missing");
    }
    writeStatePairs(stateFile, ["plan_approval=approved", `plan_snapshot_file=${paths.approvedFile}`], sessionId);
    logEvent({ event: "plan-approval-approved", session: sessionId });
    return 0;
  });
}
function runCancelPlan(cwd, sessionId, digest) {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("cancel-plan requires one lowercase SHA-256 digest");
  }
  const stateFile = stateFileFor(cwd);
  mkdirSync5(stateRootDirectory(), { recursive: true });
  return withLock(stateFile, sessionId, () => {
    if (!isReadableRegularFile(stateFile)) {
      throw new PlanApprovalError(`no readable pending plan approval for session ${sessionId}`);
    }
    if (readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanApprovalError("pending plan approval belongs to another session");
    }
    if (readValue(stateFile, "plan_approval") !== "pending") {
      throw new PlanApprovalError("plan approval is not pending");
    }
    if (readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before cancellation");
    }
    const paths = planPaths(stateFile, digest);
    if (readValue(stateFile, "plan_snapshot_file") === paths.presentedFile) {
      rmSync4(paths.presentedFile, { force: true });
    }
    if (readValue(stateFile, "plan_current_file") === paths.currentFile) {
      rmSync4(paths.currentFile, { force: true });
    }
    clearStateFile(stateFile);
    logEvent({ event: "plan-approval-cancelled", session: sessionId });
    return 0;
  });
}
function runAmendPlan(cwd, sessionId, sliceId, document) {
  if (!isNameToken(sliceId)) throw new PlanFailure("amend-plan requires a safe slice id");
  const stateFile = stateFileFor(cwd);
  mkdirSync5(stateRootDirectory(), { recursive: true });
  if (document.length === 0) throw new PlanFailure("amend-plan requires a non-empty document on stdin");
  return withLock(stateFile, sessionId, () => {
    if (!isReadableRegularFile(stateFile)) {
      throw new PlanFailure(`no readable plan for session ${sessionId}`);
    }
    if (readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanFailure("the plan belongs to another session");
    }
    if (readValue(stateFile, "mode") !== "plan") {
      throw new PlanFailure("amendments require active plan execution state");
    }
    const amendmentApproval = readValue(stateFile, "plan_approval");
    const shape = amendmentShapeFor(amendmentApproval);
    const approvalDigest = readValue(stateFile, "plan_approval_digest") ?? "";
    if (!isValidPlanDigest(approvalDigest)) throw new PlanFailure("the plan has no valid digest");
    const paths = planPaths(stateFile, approvalDigest);
    ensurePlanDirectory(paths);
    const amendmentSnapshotFile = amendmentApproval === "approved" ? paths.approvedFile : paths.presentedFile;
    if (readValue(stateFile, "plan_snapshot_file") !== amendmentSnapshotFile) {
      throw new PlanFailure("plan state does not name its expected immutable snapshot");
    }
    if (readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("plan state does not name its operational plan");
    }
    if (!isPrivateRegularFile(amendmentSnapshotFile)) {
      throw new PlanFailure("the immutable snapshot is missing or unsafe");
    }
    if (!isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe");
    }
    const revisionText = readValue(stateFile, "plan_revision") ?? "";
    if (!/^[0-9]+$/.test(revisionText)) throw new PlanFailure("current plan has no valid revision");
    const nextRevision = Number(revisionText) + 1;
    const amended = `${readFileSync5(paths.currentFile, "utf8")}

## ${shape.heading} \u2014 ${sliceId}

- Added-at: ${isoTimestamp()}
- Requested-by: operator
- Classification: ${shape.classification}

${document}
`;
    writeFileAtomically(paths.dir, paths.currentFile, amended, ".amended.");
    writeStatePairs(stateFile, [`plan_revision=${nextRevision}`, "verify_green=false"], sessionId);
    logEvent({ event: "plan-amended", session: sessionId, command: sliceId });
    return 0;
  });
}
function byteIdentical(leftFile, rightFile) {
  return readFileSync5(leftFile).equals(readFileSync5(rightFile));
}
function amendmentShapeFor(approval) {
  if (approval === "approved") return { heading: "Execution amendment", classification: "in-scope" };
  if (approval === "pending") return { heading: "Plan Mode feedback", classification: "feedback" };
  throw new PlanFailure("amendments require a pending or approved plan");
}

// core/src/gates/planrail.ts
function isPlanRailFailure(cause) {
  return cause instanceof PlanFailure || cause instanceof PlanApprovalError || cause instanceof StateFileUnreadableError || cause instanceof LockTimeoutError;
}

// core/src/gates/planprompt.ts
var APPROVAL_PROMPT = "Implement the plan.";
var CANCEL_TOKEN = "CANCEL OSO PLAN";
var PLAN_INVOCATION = "$oso-code:plan";
var FEEDBACK_AMENDMENT_LABEL = "plan-mode-feedback";
var PENDING = "pending";
var PLAN_DIGEST = /^[0-9a-f]{64}$/;
var OUTSIDE_PLAN_MODE = "oso-code: $oso-code:plan requires Codex native Plan Mode. Enter /plan (or use Shift+Tab), then invoke $oso-code:plan again.";
var AMENDMENT_REFUSED = "oso-code: the pending document could not be amended; retry the planning message.";
var UNREADABLE_PENDING_STATE = "oso-code: the pending plan state is unreadable; native approval cannot open the execution gate.";
var UNREADABLE_CONTROL_PAYLOAD = "oso-code: the plan-control prompt arrived in a payload that is not readable JSON, so the pending document it would settle cannot be identified; the gate did not change.";
var NO_SESSION_IDENTITY = "oso-code: the plan-control prompt has no valid session identity.";
var NO_REPOSITORY_CONTEXT = "oso-code: the plan-control prompt has no readable repository context.";
var APPROVAL_STILL_IN_PLAN_MODE = "oso-code: native plan approval arrived while Codex still reports Plan Mode; use the native approval control again after the mode transition completes.";
var APPROVAL_UNATTESTED = "oso-code: native plan approval arrived without an attested collaboration mode; execution remains blocked.";
var CANCELLATION_UNATTESTED = "oso-code: the cancellation token arrived without an attested collaboration mode; the pending gate remains armed.";
var NO_PENDING_PLAN = "oso-code: no pending plan approval exists for this repository; present the complete plan again.";
var FOREIGN_CONTROL_PROMPT = "oso-code: this plan-control prompt does not belong to the session that presented the pending plan.";
var NOTHING_PENDING = "oso-code: no pending plan approval exists; present the complete plan again before approving or cancelling it.";
var NO_VALID_DIGEST = "oso-code: the pending plan has no valid document digest; present it again before approving.";
var AMENDMENT_GUIDANCE = "oso-code: this Plan Mode turn amended the pending document instead of discarding it. Present the amendment \u2014 what changed and why \u2014 not the complete plan, then re-emit the internal approval marker so a fresh capture binds the complete updated document before approval can succeed.";
var APPROVAL_GRANTED = "oso-code: Codex native plan approval matched the exact pending document. The technical approval gate is open; continue with the saved operational plan.";
var CANCELLATION_ACCEPTED = "oso-code: CANCEL OSO PLAN accepted for the exact pending document. Its runtime state was cleared; do not execute that plan.";
var SILENT = { verdict: { kind: "allow" }, events: [] };
var PLANPROMPT_GATE = {
  gate: "planprompt",
  errorSubject: "the plan-approval token gate",
  judge: judgePlanprompt
};
function judgePlanprompt({ envelope }) {
  const rawPrompt = envelope.escapedPrompt;
  const sessionId = sanitizeSession(envelope.sessionId);
  const turn = resolveCodexTurn(envelope);
  if (invokesThePlanSkill(rawPrompt) && turn.mode !== "plan") return control(OUTSIDE_PLAN_MODE);
  const action = controlActionOf(rawPrompt);
  if (envelope.payloadRead === "unparseable") {
    return action === void 0 ? SILENT : control(UNREADABLE_CONTROL_PAYLOAD);
  }
  if (action === void 0) return amendPendingPlan(envelope, sessionId, turn);
  const stateFile = stateFileFor(envelope.cwd);
  const reachable = controlPromptReaches(envelope, sessionId, action, stateFile);
  if (reachable !== void 0) return reachable;
  const modeRefusal = modeRefusalFor(action, turn);
  if (modeRefusal !== void 0) return control(modeRefusal);
  if (!isReadableRegularFile(stateFile)) return control(NO_PENDING_PLAN);
  if (readValue(stateFile, "plan_approval_session") !== sessionId) return control(FOREIGN_CONTROL_PROMPT);
  if (readValue(stateFile, "plan_approval") !== PENDING) return control(NOTHING_PENDING);
  const digest = readValue(stateFile, "plan_approval_digest") ?? "";
  if (!PLAN_DIGEST.test(digest)) return control(NO_VALID_DIGEST);
  return settlePendingPlan(envelope, sessionId, action, digest);
}
function amendPendingPlan(envelope, sessionId, turn) {
  if (turn.mode !== "plan") return SILENT;
  if (sessionId === "" || sessionId !== envelope.sessionId || !isDirectory(envelope.cwd)) return SILENT;
  const stateFile = stateFileFor(envelope.cwd);
  if (!isReadableRegularFile(stateFile)) return SILENT;
  if (readValue(stateFile, "plan_approval_session") !== sessionId) return SILENT;
  if (readValue(stateFile, "plan_approval") !== PENDING) return SILENT;
  if (!PLAN_DIGEST.test(readValue(stateFile, "plan_approval_digest") ?? "")) return SILENT;
  try {
    runAmendPlan(envelope.cwd, sessionId, FEEDBACK_AMENDMENT_LABEL, asCommandSubstitutionCaptures(envelope.prompt));
  } catch (cause) {
    if (!isPlanRailFailure(cause)) throw cause;
    return {
      verdict: { kind: "deny", message: AMENDMENT_REFUSED },
      events: [refusal("plan-approval-amend-blocked", sessionId, cause.message)]
    };
  }
  return { verdict: { kind: "context", additionalContext: AMENDMENT_GUIDANCE }, events: [] };
}
function settlePendingPlan(envelope, sessionId, action, digest) {
  try {
    if (action === "approve") runApprovePlan(envelope.cwd, sessionId, digest);
    else runCancelPlan(envelope.cwd, sessionId, digest);
  } catch (cause) {
    if (!isPlanRailFailure(cause)) throw cause;
    return {
      verdict: {
        kind: "deny",
        message: `oso-code: the ${action} request lost its pending compare-and-set; the gate did not change.`
      },
      events: [refusal(`plan-approval-${action}-blocked`, sessionId, cause.message)]
    };
  }
  const granted = action === "approve" ? APPROVAL_GRANTED : CANCELLATION_ACCEPTED;
  return { verdict: { kind: "context", additionalContext: granted }, events: [] };
}
function controlPromptReaches(envelope, sessionId, action, stateFile) {
  const ownIdentity = sessionId !== "" && sessionId === envelope.sessionId;
  if (action === "cancel") {
    if (!ownIdentity) return control(NO_SESSION_IDENTITY);
    if (!isDirectory(envelope.cwd)) return control(NO_REPOSITORY_CONTEXT);
    return void 0;
  }
  if (!ownIdentity || !isDirectory(envelope.cwd)) return SILENT;
  if (!statePresent(stateFile)) return SILENT;
  if (!isReadableRegularFile(stateFile)) return control(UNREADABLE_PENDING_STATE);
  if (readValue(stateFile, "plan_approval") !== PENDING) return SILENT;
  return void 0;
}
function modeRefusalFor(action, turn) {
  if (action === "cancel") return turn.mode === "unknown" ? CANCELLATION_UNATTESTED : void 0;
  if (turn.mode === "default") return void 0;
  return turn.mode === "plan" ? APPROVAL_STILL_IN_PLAN_MODE : APPROVAL_UNATTESTED;
}
function invokesThePlanSkill(rawPrompt) {
  return rawPrompt === PLAN_INVOCATION || rawPrompt.startsWith(`${PLAN_INVOCATION} `);
}
function controlActionOf(rawPrompt) {
  if (rawPrompt === APPROVAL_PROMPT) return "approve";
  if (rawPrompt === CANCEL_TOKEN) return "cancel";
  return void 0;
}
function statePresent(stateFile) {
  return statSync4(stateFile, { throwIfNoEntry: false }) !== void 0;
}
function control(reason) {
  return { verdict: { kind: "deny", message: reason }, events: [] };
}
function refusal(event, session, detail) {
  return { event, session, command: detail };
}

// core/src/gates/planstop.ts
var PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
var MARKER_PREFIX = "<!-- oso-plan-approval:";
var ESCAPED_NEWLINE = "\\n";
var CAPTURE_BLOCKED = "plan-approval-capture-blocked";
var EVENT_MESSAGE2 = '"type":"event_msg"';
var ITEM_COMPLETED = '"type":"item_completed"';
var PLAN_ITEM = '"item":{"type":"Plan"';
var UNREADABLE_PAYLOAD = "oso-code: the plan approval marker arrived in a payload that is not readable JSON, so the document it binds cannot be trusted; present the plan again.";
var NO_SESSION = "oso-code: the plan approval marker arrived without a usable session id.";
var UNSAFE_SESSION = "oso-code: the plan approval marker arrived with an invalid session id.";
var NO_WORKING_DIRECTORY = "oso-code: the plan approval marker arrived without a readable working directory.";
var NOT_PLAN_MODE = "oso-code: the approval document must be presented while Codex is still in Plan Mode.";
var MARKER_OUT_OF_PLACE = "oso-code: the plan approval marker must be the exact final line of the message, appearing exactly once.";
var NO_ATTESTATION = "oso-code: a marker-only response requires Plan Mode for this turn to be attested from the transcript, and none was available.";
var NOT_ONE_PLAN_ITEM = "oso-code: the transcript must hold exactly one Plan item for this turn; none or more than one was found.";
var FOREIGN_PLAN_ITEM = "oso-code: the transcript's Plan item does not belong to this turn and thread.";
var EMPTY_PLAN_ITEM = "oso-code: the transcript's Plan item carries no plan text to approve.";
var SELF_MARKING_PLAN_ITEM = "oso-code: the transcript's Plan item text must not itself carry an approval marker.";
var CAPTURE_REFUSED = "oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.";
var SILENT2 = { verdict: { kind: "allow" }, events: [] };
var PLANSTOP_GATE = {
  gate: "planstop",
  errorSubject: "the plan-approval capture gate",
  judge: judgePlanstop
};
function judgePlanstop({ envelope }) {
  const message = asCommandSubstitutionCaptures(envelope.lastAssistantMessage);
  if (!lastLineOf(message).startsWith(MARKER_PREFIX)) return SILENT2;
  const rawSessionId = envelope.sessionId;
  const sessionId = sanitizeSession(rawSessionId);
  if (envelope.payloadRead === "unparseable") return blocked(UNREADABLE_PAYLOAD, sessionId);
  if (sessionId === "") return blocked(NO_SESSION, "");
  if (sessionId !== rawSessionId) return blocked(UNSAFE_SESSION, sessionId);
  if (!isDirectory(envelope.cwd)) return blocked(NO_WORKING_DIRECTORY, sessionId);
  const turn = resolveCodexTurn(envelope);
  if (turn.mode !== "plan") return blocked(NOT_PLAN_MODE, sessionId);
  const rawMessage = envelope.escapedLastAssistantMessage;
  if (!markerIsTheWholeEnding(message, rawMessage)) return blocked(MARKER_OUT_OF_PLACE, sessionId);
  const document = message === PLAN_MARKER ? planItemDocument(envelope, turn, rawMessage) : { digestInput: rawMessage, planDocument: withoutTrailingMarker(message) };
  if (typeof document === "string") return blocked(document, sessionId);
  try {
    runCapturePlan(envelope.cwd, sessionId, sha256Hex(document.digestInput), document.planDocument);
  } catch (cause) {
    if (!isPlanRailFailure(cause)) throw cause;
    return blocked(CAPTURE_REFUSED, sessionId, cause.message);
  }
  return { verdict: { kind: "allow" }, events: [{ event: "plan-approval-pending", session: sessionId }] };
}
function planItemDocument(envelope, turn, rawMessage) {
  if (turn.source !== "transcript" || envelope.turnId === "" || envelope.transcriptPath === "") return NO_ATTESTATION;
  const items = transcriptLinesMatching(envelope.transcriptPath, [
    EVENT_MESSAGE2,
    ITEM_COMPLETED,
    `"turn_id":"${envelope.turnId}"`,
    PLAN_ITEM
  ]);
  if (items.length !== 1) return NOT_ONE_PLAN_ITEM;
  const item = items[0];
  if (jsonField(item, "turn_id") !== envelope.turnId || jsonField(item, "thread_id") !== envelope.sessionId) {
    return FOREIGN_PLAN_ITEM;
  }
  const rawPlanDocument = escapedField(item, "text");
  const planDocument = asCommandSubstitutionCaptures(unescapedJson(rawPlanDocument));
  if (planDocument === "") return EMPTY_PLAN_ITEM;
  if (planDocument.split("\n").some((line) => line.startsWith(MARKER_PREFIX))) return SELF_MARKING_PLAN_ITEM;
  return { digestInput: `${rawPlanDocument}${ESCAPED_NEWLINE}${rawMessage}`, planDocument };
}
function markerIsTheWholeEnding(message, rawMessage) {
  const rawEndsWithMarker = rawMessage.endsWith(PLAN_MARKER) || rawMessage.endsWith(`${PLAN_MARKER}${ESCAPED_NEWLINE}`);
  const lines = message.split("\n");
  return rawEndsWithMarker && lines.filter((line) => line.startsWith(MARKER_PREFIX)).length === 1 && lines.filter((line) => line === PLAN_MARKER).length === 1;
}
function withoutTrailingMarker(message) {
  const trailer = `
${PLAN_MARKER}`;
  return message.endsWith(trailer) ? message.slice(0, -trailer.length) : message;
}
function lastLineOf(message) {
  return message.slice(message.lastIndexOf("\n") + 1);
}
function blocked(reason, session, detail = "") {
  return { verdict: { kind: "deny", message: reason }, events: [captureBlocked(session, detail)] };
}
function captureBlocked(session, detail) {
  const route = gateRow("planstop");
  return { event: CAPTURE_BLOCKED, session, command: detail, gate: route.script, hookEvent: route.event };
}

// core/src/gates/proddeploy.ts
import path7 from "node:path";

// core/src/shell/ere.ts
var GREP_ITSELF_REJECTS_IT = /* @__PURE__ */ Symbol("a pattern grep exits 2 on, which therefore matches nothing");
var THE_READER_CANNOT_TRANSLATE_IT = /* @__PURE__ */ Symbol("a pattern grep accepts that this reader cannot express");
var ALPHABETIC_MEMBERS = "\\p{Alphabetic}";
var ALPHANUMERIC_MEMBERS = `${ALPHABETIC_MEMBERS}\\p{Nd}`;
var WHITESPACE_MEMBERS = "\\t\\n\\v\\f\\r \\p{Zs}\\u2028\\u2029";
var WORD_MEMBERS = `_${ALPHANUMERIC_MEMBERS}`;
var NO_BREAK_SPACE = "\\u00a0";
var POSIX_CLASS_MEMBERS = {
  alpha: ALPHABETIC_MEMBERS,
  digit: "0-9",
  alnum: ALPHANUMERIC_MEMBERS,
  upper: "\\p{Uppercase}",
  lower: "\\p{Lowercase}",
  space: WHITESPACE_MEMBERS,
  blank: "\\t \\p{Zs}",
  punct: `\\p{P}\\p{S}\\p{M}${NO_BREAK_SPACE}`,
  print: "\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Zs}",
  graph: `\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}${NO_BREAK_SPACE}`,
  cntrl: "\\p{Cc}\\u2028\\u2029",
  xdigit: "0-9A-Fa-f"
};
var ON_A_WORD = `(?=[${WORD_MEMBERS}])`;
var OFF_A_WORD = `(?![${WORD_MEMBERS}])`;
var AFTER_A_WORD = `(?<=[${WORD_MEMBERS}])`;
var BEFORE_A_WORD = `(?<![${WORD_MEMBERS}])`;
var GNU_CLASS_ESCAPES = {
  w: `[${WORD_MEMBERS}]`,
  W: `[^${WORD_MEMBERS}]`,
  s: `[${WHITESPACE_MEMBERS}]`,
  S: `[^${WHITESPACE_MEMBERS}]`
};
var GNU_WORD_EDGE_ESCAPES = {
  b: `(?:${AFTER_A_WORD}${OFF_A_WORD}|${BEFORE_A_WORD}${ON_A_WORD})`,
  B: `(?:${AFTER_A_WORD}${ON_A_WORD}|${BEFORE_A_WORD}${OFF_A_WORD})`,
  "<": `${BEFORE_A_WORD}${ON_A_WORD}`,
  ">": `${AFTER_A_WORD}${OFF_A_WORD}`
};
var GNU_LINE_ANCHOR_ESCAPES = {
  "`": "^",
  "'": "$"
};
var ANY_CHARACTER_IN_A_LINE = "[^\\n]";
var INTERVAL = /^\{(\d*)(,\d*)?\}/;
var POSIX_CLASS_NAME = /^\[:([A-Za-z]+):\]/;
var BACKREFERENCE = /^[1-9]$/;
var UNESCAPED_IN_JS = /^[A-Za-z0-9]$/;
var ASCII_DIGIT = /^[0-9]$/;
var ASCII_LETTER = /^[A-Za-z]$/;
var FIRST_NON_ASCII_CODE_POINT = 128;
var TOP_LEVEL = 0;
function ereReads(pattern, subject) {
  const expression = compiledEre(pattern);
  if (expression === THE_READER_CANNOT_TRANSLATE_IT) return "untranslatable";
  if (expression === GREP_ITSELF_REJECTS_IT) return "unmatched";
  return grepLinesOf(subject).some((line) => expression.test(line)) ? "matched" : "unmatched";
}
function unread(reading) {
  return reading === GREP_ITSELF_REJECTS_IT || reading === THE_READER_CANNOT_TRANSLATE_IT;
}
function grepLinesOf(subject) {
  const lines = subject.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}
function compiledEre(pattern) {
  const source = jsSourceOf(pattern);
  if (unread(source)) return source;
  try {
    return new RegExp(source, "u");
  } catch {
    return GREP_ITSELF_REJECTS_IT;
  }
}
function jsSourceOf(pattern) {
  const read = readAlternation(pattern, 0, TOP_LEVEL);
  if (unread(read)) return read;
  if (read.after !== pattern.length) return GREP_ITSELF_REJECTS_IT;
  return read.source;
}
function readAlternation(pattern, from, depth) {
  let source = "";
  let cursor = from;
  for (; ; ) {
    const branch = readBranch(pattern, cursor, depth);
    if (unread(branch)) return branch;
    source += branch.source;
    cursor = branch.after;
    if (pattern[cursor] !== "|") return { source, after: cursor };
    source += "|";
    cursor += 1;
  }
}
function readBranch(pattern, from, depth) {
  let source = "";
  let cursor = from;
  for (; ; ) {
    const settled = pastQuantifiersWithNothingToRepeat(pattern, cursor, depth);
    if (unread(settled)) return settled;
    cursor = settled;
    if (branchEndsAt(pattern, cursor, depth)) return { source, after: cursor };
    const piece = readPiece(pattern, cursor, depth);
    if (unread(piece)) return piece;
    source += piece.source;
    cursor = piece.after;
  }
}
function branchEndsAt(pattern, at, depth) {
  const character = pattern[at];
  if (character === void 0 || character === "|") return true;
  return character === ")" && depth > TOP_LEVEL;
}
function pastQuantifiersWithNothingToRepeat(pattern, from, depth) {
  let cursor = from;
  for (; ; ) {
    const quantifier = readQuantifier(pattern, cursor);
    if (quantifier === void 0) return cursor;
    if (endsAnEmptyGroup(pattern, quantifier, depth)) return GREP_ITSELF_REJECTS_IT;
    cursor = quantifier.after;
  }
}
function endsAnEmptyGroup(pattern, quantifier, depth) {
  return depth > TOP_LEVEL && quantifier.spelling === "operator" && pattern[quantifier.after] === ")";
}
function readPiece(pattern, from, depth) {
  const atom = readAtom(pattern, from, depth);
  if (unread(atom)) return atom;
  return withQuantifiers(pattern, atom, depth);
}
function withQuantifiers(pattern, atom, depth) {
  let piece = atom;
  for (; ; ) {
    const quantifier = readQuantifier(pattern, piece.after);
    if (quantifier === void 0) return piece;
    if (atom.width === "assertsAPosition" && endsAnEmptyGroup(pattern, quantifier, depth)) {
      return GREP_ITSELF_REJECTS_IT;
    }
    piece = { source: `(?:${piece.source})${quantifier.source}`, after: quantifier.after };
  }
}
function readQuantifier(pattern, at) {
  const character = pattern[at];
  if (character === "*" || character === "+" || character === "?") {
    return { source: character, after: at + 1, spelling: "operator" };
  }
  const interval = INTERVAL.exec(pattern.slice(at));
  if (interval === null) return void 0;
  const [spelled, low = "", high] = interval;
  if (low === "" && high === void 0) return void 0;
  return {
    source: `{${low === "" ? "0" : low}${high ?? ""}}`,
    after: at + spelled.length,
    spelling: "interval"
  };
}
function readAtom(pattern, from, depth) {
  const character = characterAt(pattern, from);
  if (character === ".") return consuming(ANY_CHARACTER_IN_A_LINE, from + 1);
  if (character === "^" || character === "$") {
    return { source: character, after: from + 1, width: "assertsAPosition" };
  }
  if (character === "[") return asAtom(readBracket(pattern, from), "consumesInput");
  if (character === "(") return asAtom(readGroup(pattern, from, depth), "consumesInput");
  if (character === "\\") return readEscape(pattern, from);
  return consuming(asJsLiteral(character), from + character.length);
}
function consuming(source, after) {
  return { source, after, width: "consumesInput" };
}
function asAtom(read, width) {
  return unread(read) ? read : { ...read, width };
}
function readGroup(pattern, from, depth) {
  const inner = readAlternation(pattern, from + 1, depth + 1);
  if (unread(inner)) return inner;
  if (pattern[inner.after] !== ")") return GREP_ITSELF_REJECTS_IT;
  return { source: `(${inner.source})`, after: inner.after + 1 };
}
function readEscape(pattern, from) {
  if (from + 1 >= pattern.length) return GREP_ITSELF_REJECTS_IT;
  const escaped = characterAt(pattern, from + 1);
  const after = from + 1 + escaped.length;
  const wordEdge = GNU_WORD_EDGE_ESCAPES[escaped];
  if (wordEdge !== void 0) return { source: wordEdge, after, width: "assertsAPosition" };
  const lineAnchor = GNU_LINE_ANCHOR_ESCAPES[escaped];
  if (lineAnchor !== void 0) return { source: lineAnchor, after, width: "assertsAPosition" };
  const characterClass = GNU_CLASS_ESCAPES[escaped];
  if (characterClass !== void 0) return consuming(characterClass, after);
  if (BACKREFERENCE.test(escaped)) return consuming(`\\${escaped}`, after);
  return consuming(asJsLiteral(escaped), after);
}
function readBracket(pattern, from) {
  const negated = pattern[from + 1] === "^";
  const opens = from + (negated ? 2 : 1);
  const leading = readAnyLeadingClosingBracket(pattern, opens);
  if (unread(leading)) return leading;
  let members = leading.source;
  let cursor = leading.after;
  for (; ; ) {
    const character = pattern[cursor];
    if (character === void 0) return GREP_ITSELF_REJECTS_IT;
    if (character === "]") return { source: `[${negated ? "^" : ""}${members}]`, after: cursor + 1 };
    const member = readBracketMember(pattern, cursor);
    if (unread(member)) return member;
    members += member.source;
    cursor = member.after;
  }
}
function readAnyLeadingClosingBracket(pattern, at) {
  if (pattern[at] !== "]") return { source: "", after: at };
  return readRangeOrCharacter(pattern, at);
}
function readBracketMember(pattern, from) {
  if (pattern.startsWith("[:", from)) return readPosixClass(pattern, from);
  if (pattern.startsWith("[.", from)) return readCollatingSymbol(pattern, from);
  if (pattern.startsWith("[=", from)) return readEquivalenceClass(pattern, from);
  return readRangeOrCharacter(pattern, from);
}
function readPosixClass(pattern, from) {
  const named2 = POSIX_CLASS_NAME.exec(pattern.slice(from));
  if (named2 === null) return GREP_ITSELF_REJECTS_IT;
  const members = POSIX_CLASS_MEMBERS[named2[1]];
  if (members === void 0) return GREP_ITSELF_REJECTS_IT;
  const after = from + named2[0].length;
  if (aRangeOpensAt(pattern, after)) return GREP_ITSELF_REJECTS_IT;
  return { source: members, after };
}
function readCollatingSymbol(pattern, from) {
  const symbol = characterAt(pattern, from + 2);
  const closing = from + 2 + symbol.length;
  if (symbol === "" || !pattern.startsWith(".]", closing)) return GREP_ITSELF_REJECTS_IT;
  const after = closing + 2;
  if (aRangeOpensAt(pattern, after)) return THE_READER_CANNOT_TRANSLATE_IT;
  return { source: asJsLiteral(symbol), after };
}
function readEquivalenceClass(pattern, from) {
  const representative = characterAt(pattern, from + 2);
  const closing = from + 2 + representative.length;
  if (!pattern.startsWith("=]", closing)) return GREP_ITSELF_REJECTS_IT;
  const after = closing + 2;
  if (aRangeOpensAt(pattern, after)) return GREP_ITSELF_REJECTS_IT;
  const members = equivalentToInEveryLocale(representative);
  if (members === void 0) return THE_READER_CANNOT_TRANSLATE_IT;
  return { source: members, after };
}
function equivalentToInEveryLocale(representative) {
  if (ASCII_DIGIT.test(representative)) return asJsLiteral(representative);
  if (!ASCII_LETTER.test(representative)) return void 0;
  return asJsLiteral(representative.toLowerCase()) + asJsLiteral(representative.toUpperCase());
}
function aRangeOpensAt(pattern, at) {
  return pattern[at] === "-" && pattern[at + 1] !== "]" && pattern[at + 1] !== void 0;
}
function readRangeOrCharacter(pattern, from) {
  const low = characterAt(pattern, from);
  const dash = from + low.length;
  const highStarts = dash + 1;
  if (pattern[dash] !== "-" || highStarts >= pattern.length || pattern[highStarts] === "]") {
    return { source: asJsLiteral(low), after: dash };
  }
  const high = characterAt(pattern, highStarts);
  const range = rangeMembersOf(low, high);
  if (unread(range)) return range;
  return { source: range, after: highStarts + high.length };
}
function rangeMembersOf(low, high) {
  const lowest = low.codePointAt(0) ?? 0;
  const highest = high.codePointAt(0) ?? 0;
  if (lowest >= FIRST_NON_ASCII_CODE_POINT || highest >= FIRST_NON_ASCII_CODE_POINT) {
    return THE_READER_CANNOT_TRANSLATE_IT;
  }
  if (lowest > highest) return GREP_ITSELF_REJECTS_IT;
  return `${asJsLiteral(low)}-${asJsLiteral(high)}`;
}
function characterAt(pattern, at) {
  const codePoint = pattern.codePointAt(at);
  return codePoint === void 0 ? "" : String.fromCodePoint(codePoint);
}
function asJsLiteral(character) {
  if (UNESCAPED_IN_JS.test(character)) return character;
  return `\\u{${(character.codePointAt(0) ?? 0).toString(16)}}`;
}

// core/src/gates/proddeploy.ts
var PRODUCTION_BOUNDARY_SUBJECTS = ["git", "deploy", "vercel", "netlify", "firebase"];
var DEPLOY_CLIS = /* @__PURE__ */ new Set(["vercel", "netlify", "firebase"]);
var PACKAGE_RUNNERS = /* @__PURE__ */ new Set(["npx", "npm", "pnpm", "pnpx", "yarn", "bun", "bunx", "deno"]);
var STATE_RECORD_LINE = /^([A-Za-z0-9_]+=|[\t\v\f\r ]*$)/;
var RUN_BRANCH_REF = /^oso-run\/[a-z0-9-]+$/;
var RUN_BRANCH_REFSPEC = /^[^:]+:(refs\/heads\/)?oso-run\/[a-z0-9-]+$/;
var TAKE_THE_RUN_BACK = "set auto=done";
var PROD_DEPLOY_GATE = {
  gate: "proddeploy",
  errorSubject: "the production boundary gate",
  judge: judgeProductionBoundary
};
function judgeProductionBoundary({ envelope }) {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const runMarker = runMarkerOf(stateFile, session);
  if (runMarker === "unmarked") return ALLOWED;
  const boundary = { runMarker, stateFile, session };
  if (envelope.toolName.includes("deploy")) {
    return denyProductionBoundary(boundary, mcpDeployStaysWithTheOperator(session), envelope.toolName);
  }
  if (envelope.toolName !== "Bash" && envelope.toolName !== "bash") return ALLOWED;
  return judgeAgainstDenyPatterns(boundary, envelope.commandLine);
}
function judgeAgainstDenyPatterns(boundary, command) {
  const reading = howThisRepositoryReadsTheCommand(boundary.stateFile, command);
  switch (reading.kind) {
    case "aPatternBites":
      return denyProductionBoundary(boundary, thisRepositoryDeniesTheCommand(boundary.session), command);
    case "aPatternIsUnreadable":
      return denyUnreadableDenyPattern(boundary, reading.pattern);
    case "noPatternBites":
      return judgeCommandLine(boundary, command);
  }
}
function judgeCommandLine(boundary, command) {
  const { runMarker, session } = boundary;
  switch (lineVerdict(command, judgeProductionLine)) {
    case "production":
      return denyProductionBoundary(boundary, deployStaysWithTheOperator(session), command);
    case "unread":
      return denyProductionBoundary(boundary, theLineIsPastWhatTheBoundaryReads(session), command);
    case "push":
      if (runMarker !== "armed") return ALLOWED;
      return denied({
        gate: "proddeploy",
        message: theRunPushesItsOwnBranchOnly(session),
        event: "run-branch-push-denied",
        session,
        detail: command
      });
    case "residue":
      return allowedWithResidueCounted(session, command);
    case "clear":
      return ALLOWED;
  }
}
function takeTheRunBack(session) {
  return `Take the run back (${osoStateRemedy(session, TAKE_THE_RUN_BACK)})`;
}
function mcpDeployStaysWithTheOperator(session) {
  return `oso-code: an unattended run is in flight, so an MCP deploy stays with the operator. ${takeTheRunBack(session)} and run the deploy yourself.`;
}
function thisRepositoryDeniesTheCommand(session) {
  return `oso-code: an unattended run is in flight, and this repository denies this command while one is. ${takeTheRunBack(session)} and run it from your own terminal.`;
}
function deployStaysWithTheOperator(session) {
  return `oso-code: an unattended run is in flight, so a production deploy stays with the operator. ${takeTheRunBack(session)} and deploy from your own terminal, or deploy after the run closes at its pull request.`;
}
function theLineIsPastWhatTheBoundaryReads(session) {
  return `oso-code: an unattended run is in flight, and this command line is past what the production boundary can read, so it is treated as a production deploy. ${takeTheRunBack(session)} and run it from your own terminal, or spell it in lines this boundary can read.`;
}
function aDenyPatternIsPastWhatTheBoundaryReads(session, pattern) {
  return `oso-code: an unattended run is in flight, and a deploy-deny pattern of this repository (${pattern}) is past what the production boundary can read, so this command is denied rather than allowed on a pattern nothing checked. Rewrite that pattern in the POSIX ERE the boundary reads, or ${takeTheRunBack(session)} and run it from your own terminal.`;
}
function theRunPushesItsOwnBranchOnly(session) {
  return `oso-code: an unattended run is in flight, and it pushes its own oso-run/* branch and nothing else. Push that branch instead (git push origin oso-run/<name>), or take the run back (${osoStateRemedy(session, TAKE_THE_RUN_BACK)}) and push from your own terminal.`;
}
function denyProductionBoundary(boundary, message, detail) {
  return deniedUnderTheBoundary(boundary, { message, event: "prod-deploy-denied", detail });
}
function denyUnreadableDenyPattern(boundary, pattern) {
  return deniedUnderTheBoundary(boundary, {
    message: aDenyPatternIsPastWhatTheBoundaryReads(boundary.session, pattern),
    event: "deploy-deny-pattern-untranslatable",
    detail: pattern
  });
}
function deniedUnderTheBoundary(boundary, denial) {
  if (boundary.runMarker === "uncertain") {
    return deniedForUnusableState("proddeploy", boundary.stateFile, boundary.session);
  }
  return denied({ gate: "proddeploy", session: boundary.session, ...denial });
}
function judgeProductionLine(command, verdict) {
  if (runsAProductionDeploy(command)) return "production";
  if (verdict !== "production" && verdict !== "unread" && pushesOffTheRunBranch(command)) return "push";
  if (verdict === "clear" && isResidueCall(command, PRODUCTION_BOUNDARY_SUBJECTS)) return "residue";
  return verdict;
}
function runsAProductionDeploy(command) {
  const deployCli = deployCommandName(command);
  if (deployCli === void 0) return false;
  if (command.stdin.includes(UNREAD_PAYLOAD_MARKER)) return true;
  if (deployCli === "vercel") return vercelTargetsProduction(command);
  if (deployCli === "netlify") return commandCarries(command, "deploy") && commandCarries(command, "--prod");
  return commandCarries(command, "deploy");
}
function deployCommandName(command) {
  for (const [index, token] of command.tokens.entries()) {
    const word = packageSpecName(token);
    if (DEPLOY_CLIS.has(word)) return word;
    if (index === 0 && !PACKAGE_RUNNERS.has(word)) return void 0;
  }
  return void 0;
}
function packageSpecName(token) {
  const word = basenameOf(token);
  const at = word.lastIndexOf("@");
  return at > 0 ? word.slice(0, at) : word;
}
function vercelTargetsProduction(command) {
  return command.tokens.some(
    (token, index) => token === "--prod" || token === "--target=production" || token === "--target" && command.tokens[index + 1] === "production"
  );
}
function commandCarries(command, word) {
  return command.tokens.includes(word);
}
function pushesOffTheRunBranch(command) {
  if (!isGitCall(command)) return false;
  if (gitVerb(command) !== "push") return false;
  return !command.tokens.slice(1).some((token) => RUN_BRANCH_REF.test(token) || RUN_BRANCH_REFSPEC.test(token));
}
function runMarkerOf(stateFile, session) {
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return "unmarked";
  if (state.kind === "unusable") return "uncertain";
  if (!readsAsStateRecords(state.content)) return "uncertain";
  if (stateValue(state.content, "session") !== session) return "unmarked";
  return stateValue(state.content, "auto") === "running" ? "armed" : "unmarked";
}
function readsAsStateRecords(content) {
  return content.split("\n").every((line) => STATE_RECORD_LINE.test(line));
}
function howThisRepositoryReadsTheCommand(stateFile, command) {
  const read = readStateFile(denyPatternsFileOf(stateFile));
  if (read.kind !== "ok") return { kind: "noPatternBites" };
  const readings = read.content.split("\n").filter((pattern) => pattern !== "").map((pattern) => ({ pattern, reading: ereReads(pattern, command) }));
  if (readings.some((one) => one.reading === "matched")) return { kind: "aPatternBites" };
  const unreadable = readings.find((one) => one.reading === "untranslatable");
  if (unreadable === void 0) return { kind: "noPatternBites" };
  return { kind: "aPatternIsUnreadable", pattern: unreadable.pattern };
}
function denyPatternsFileOf(stateFile) {
  return path7.join(stateRootDirectory(), "deploy-deny", `${repositoryIdFor(stateFile)}.patterns`);
}

// core/src/gates/reanchor.ts
var REANCHOR_GATE = {
  gate: "reanchor",
  errorSubject: "the re-anchor gate",
  judge: judgeReanchor
};
function judgeReanchor({ envelope }) {
  if (envelope.source !== "compact") return ALLOWED;
  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;
  if (!isDirectory(envelope.cwd)) return ALLOWED;
  const stateFile = stateFileFor(envelope.cwd);
  const runMarker = unattendedRunMarker(stateFile, sessionId);
  if (runMarker === void 0) return ALLOWED;
  let unattendedRun = false;
  if (runMarker === "running") {
    unattendedRun = true;
  } else if (!sliceIsArmed(stateFile)) {
    return ALLOWED;
  }
  const context = reanchorContext(journalFileFor(envelope.cwd), unattendedRun);
  return { verdict: { kind: "context", additionalContext: context }, events: [] };
}
function unattendedRunMarker(stateFile, sessionId) {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return void 0;
  if (stateValue(read.content, "session") !== sessionId) return void 0;
  return stateValue(read.content, "auto");
}
function sliceIsArmed(stateFile) {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return false;
  if (stateValue(read.content, "mode") !== "plan") return false;
  const activeSlice = stateValue(read.content, "active_slice");
  return activeSlice !== "" && activeSlice !== "none";
}
function reanchorContext(journalFile, unattendedRun) {
  const lines = [
    "oso-code: this session was compacted while a run was in flight \u2014 the window that held the position is gone, the run is not. Re-read the position before the next action, from what outlives a compaction:",
    "- the change position: mem_search oso/index, then mem_get_observation on the row it returns, and read its NEXT: line.",
    "- the run flags: oso-state show (mode, active_slice, verify_green, auto)."
  ];
  if (journalFile !== "") {
    lines.push(`- the milestones already landed: the run journal at ${journalFile}.`);
  }
  lines.push("Every milestone from here on is still appended with oso-state journal.");
  if (unattendedRun) {
    lines.push(
      "This run is unattended and still in flight: continue it now rather than waiting, and park it per the rules of its own flow if a decision needs the operator."
    );
  }
  return lines.join("\n");
}

// core/src/gates/stale.ts
import { existsSync as existsSync4 } from "node:fs";
import path8 from "node:path";
var ROADMAP_DISARMED_SENTINEL = "none";
var RUN_ARMED2 = "running";
var ROADMAP_PLACEHOLDER = "{roadmap}";
var STALE_GATE = {
  gate: "stale",
  errorSubject: "the stale-state gate",
  judge: judgeStale
};
function judgeStale({ envelope }) {
  if (!isDirectory(stateRootDirectory())) return ALLOWED;
  const stateFile = stateFileFor(envelope.cwd);
  if (!existsSync4(stateFile)) return ALLOWED;
  const content = contentOf(stateFile);
  const sessionId = hookSessionId(envelope);
  const advisories = [
    ...staleStateAdvisory(envelope.caller, stateFile, content, sessionId),
    ...expiredDelegationAdvisory(envelope.caller, envelope.cwd, content)
  ];
  if (advisories.length === 0) return ALLOWED;
  return { verdict: { kind: "context", additionalContext: advisories.join(" ") }, events: [] };
}
function staleStateAdvisory(caller, stateFile, content, sessionId) {
  if (stateValue(content, "session") === sessionId) return [];
  return [staleStateContext(caller, stateFile, content, sessionId)];
}
function expiredDelegationAdvisory(caller, cwd, content) {
  if (stateValue(content, "auto") !== RUN_ARMED2) return [];
  const label = stateValue(content, "auto_wait");
  if (!isDelegationLabel(label)) return [];
  const runSession = stateValue(content, "session");
  if (runSession === "") return [];
  const mark = readWaitMark(waitMarkFileFor(cwd, runSession));
  if (mark === void 0 || !waitExpired(nowEpochSeconds(), mark.markedAtEpochSeconds)) return [];
  const disarmCommand = `${quoted(stateBinPath(caller))} --session ${quoted(runSession)} set auto_wait=none`;
  return [
    `oso-code: this repository's unattended run is still marked as waiting on the delegation ${quoted(label)}. ${EXPIRED_DELEGATION_CLAUSE} Drop the mark with ${disarmCommand} and carry the run on.`
  ];
}
function staleStateContext(caller, stateFile, content, sessionId) {
  const skillPrefix = skillPrefixFor(caller.host);
  const stateBin = quoted(stateBinPath(caller));
  const clearCommand = `${stateBin} --session ${quoted(sessionId)} clear`;
  const leftByAnother = `oso-code: this repository's own runtime state (${path8.basename(stateFile)}) was left by another session, and its flags arm this session's gates too`;
  const roadmapValue = stateValue(content, "roadmap");
  const roadmapInFlight = roadmapValue === ROADMAP_DISARMED_SENTINEL ? "" : roadmapValue;
  if (roadmapInFlight === "") {
    return `${leftByAnother} \u2014 if the user is resuming an oso-code plan change, run ${skillPrefix}plan {change} so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale and ${clearCommand} drops it.`;
  }
  const routeSlug = CHANGE_SLUG_PATTERN.test(roadmapInFlight) ? roadmapInFlight : ROADMAP_PLACEHOLDER;
  const disarmCommand = `${stateBin} --session ${quoted(sessionId)} set roadmap=none`;
  return `${leftByAnother}, and it names a roadmap in flight \u2014 if the user is resuming that roadmap, run ${skillPrefix}roadmap ${routeSlug} so its chain re-reads its own record and arms the child that record leaves un-run; if that roadmap is over or abandoned, ${disarmCommand} drops the claim it makes on this repository and ${clearCommand} drops the whole file.`;
}
var SKILL_PREFIXES = { claude: "/oso-code:", codex: "$oso-code:", opencode: "/oso-" };
function skillPrefixFor(host) {
  return SKILL_PREFIXES[host];
}
function stateBinPath(caller) {
  if (caller.stateBin !== "") return caller.stateBin;
  return path8.join(pluginRootDirectory(), "bin", "oso-state");
}
function contentOf(stateFile) {
  const read = readStateFile(stateFile);
  return read.kind === "ok" ? read.content : "";
}
function quoted(value) {
  return `"${value}"`;
}

// core/src/gates/statebin.ts
import { appendFileSync as appendFileSync2 } from "node:fs";
import path9 from "node:path";
var STATEBIN_GATE = {
  gate: "statebin",
  errorSubject: "the state-bin gate",
  judge: judgeStatebin
};
function judgeStatebin(_request) {
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (envFile === void 0 || envFile === "") return NO_VERDICT;
  const stateBin = path9.join(pluginRootDirectory(), "bin", "oso-state");
  appendFileSync2(envFile, `export OSO_STATE_BIN=${stateBin}
`);
  return NO_VERDICT;
}

// core/src/gates/teardown.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync5, readdirSync as readdirSync2, renameSync as renameSync3, rmSync as rmSync5, rmdirSync, statSync as statSync5 } from "node:fs";
import path10 from "node:path";
var ABANDONED_STATE_DAYS = 7;
var JOURNAL_KEYED_WAIT_MARK_SUFFIX = ".waiting";
var EVENTS_LOG_RETENTION_DAYS = 30;
var SECONDS_PER_DAY = 86400;
var TEARDOWN_GATE = {
  gate: "teardown",
  errorSubject: "the session-teardown gate",
  judge: judgeTeardown
};
function judgeTeardown({ envelope }) {
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
function stateArmedBy(sessionId) {
  if (sessionId === "") return void 0;
  return stateFilesSorted().find((stateFile) => stateValueOf(stateFile, "session") === sessionId);
}
function removeWorktreesOf(sessionId, stateFile) {
  if (sessionId === "") return;
  const sessionWorktrees = path10.join(stateRootDirectory(), "worktrees", sessionId);
  if (!isDirectory(sessionWorktrees)) return;
  if (stateFile === void 0) return;
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
function dropJournalKeyedWaitMark(cwd) {
  const journalFile = journalFileFor(cwd);
  const stem = journalFile.endsWith(".log") ? journalFile.slice(0, -".log".length) : journalFile;
  rmSync5(`${stem}${JOURNAL_KEYED_WAIT_MARK_SUFFIX}`, { force: true });
}
function dropStateFile(stateFile) {
  if (stateFile === void 0) return;
  rmSync5(stateFile, { force: true });
  rmSync5(`${stateFile}.lock`, { recursive: true, force: true });
}
function clearOrphanedPendingOf(realSessionId) {
  if (realSessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateValueOf(stateFile, "plan_approval_session") !== realSessionId) continue;
    const ownerSession = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(ownerSession, stateFile);
    dropStateFile(stateFile);
  }
}
function clearRoadmapInFlightOf(sessionId) {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateValueOf(stateFile, "session") !== sessionId) continue;
    const roadmap = stateValueOf(stateFile, "roadmap");
    if (roadmap === "" || roadmap === "none") continue;
    removeWorktreesOf(sessionId, stateFile);
    dropStateFile(stateFile);
  }
}
function rotateAgedEventsLog() {
  const eventsLog = path10.join(stateRootDirectory(), "events.jsonl");
  if (!olderThanDays(eventsLog, EVENTS_LOG_RETENTION_DAYS)) return;
  renameSync3(eventsLog, `${eventsLog}.1`);
}
function pruneAbandonedState(sessionId, ownState) {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateFile === ownState) continue;
    if (existsSync5(`${stateFile}.lock`)) continue;
    if (!olderThanDays(stateFile, ABANDONED_STATE_DAYS)) continue;
    const abandonedId = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(abandonedId, stateFile);
    rmSync5(stateFile, { force: true });
  }
}
function olderThanDays(target, days) {
  const age = secondsSinceModified(target);
  return age !== void 0 && age >= days * SECONDS_PER_DAY;
}
function stateValueOf(stateFile, key) {
  const read = readStateFile(stateFile);
  return read.kind === "ok" ? stateValue(read.content, key) : "";
}
function stateFilesSorted() {
  return directoryEntries2(stateRootDirectory()).filter((name) => name.endsWith(".state")).sort().map((name) => path10.join(stateRootDirectory(), name)).filter((target) => isFile(target));
}
function subdirectoriesSorted(directory) {
  return directoryEntries2(directory).sort().map((name) => path10.join(directory, name)).filter((target) => isDirectory(target));
}
function directoryEntries2(directory) {
  try {
    return readdirSync2(directory);
  } catch {
    return [];
  }
}
function isFile(target) {
  const stats = statSync5(target, { throwIfNoEntry: false });
  return stats !== void 0 && stats.isFile();
}
function gitWorktreeRemove(repoPath, worktreePath) {
  try {
    execFileSync2("git", ["-C", repoPath, "worktree", "remove", worktreePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function gitWorktreePrune(repoPath) {
  try {
    execFileSync2("git", ["-C", repoPath, "worktree", "prune"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// core/src/gates/unknown.ts
var TOOL_NAME = /^[A-Za-z0-9_:.-]+$/;
var PENDING_APPROVAL_MESSAGE = 'oso-code: plan approval is pending. Use Codex native "Implement the plan." approval, or send exactly CANCEL OSO PLAN to abandon it, before using local tools.';
var UNKNOWN_TOOL_GATE = {
  gate: "unknown",
  errorSubject: "the unknown-tool gate",
  judge: judgeUnknownTool
};
function judgeUnknownTool({ envelope, argv }) {
  const configured = readAllowlist(argv);
  if (configured.kind === "misconfigured") return configurationError(configured.cause);
  const allowlist = configured.allowlist;
  const session = sanitizeSession(envelope.sessionId);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("unknown", stateFile, session);
  if (thisSessionsPlanIsPending(state.content, session)) {
    return denied({
      gate: "unknown",
      message: PENDING_APPROVAL_MESSAGE,
      event: "plan-approval-pending-denied",
      session
    });
  }
  const toolName = envelope.toolName;
  if (TOOL_NAME.test(toolName) && allowlistCarries(allowlist, toolName)) return ALLOWED;
  return denied({
    gate: "unknown",
    message: `oso-code: tool '${toolName === "" ? "<missing>" : toolName}' is not in this release's ${allowlistHost(envelope.caller.host)} hook allowlist. Use one of the allowed local tools instead: ${allowlist.replaceAll("|", ", ")}.`,
    event: "unknown-tool-denied",
    session,
    detail: toolName
  });
}
function readAllowlist(argv) {
  if (argv[0] !== "--allow" || argv.length !== 2) {
    return { kind: "misconfigured", cause: "missing allowlist" };
  }
  const allowlist = argv[1];
  if (allowlist === "") return { kind: "misconfigured", cause: "empty allowlist" };
  if (!allowlist.split("|").every((tool) => TOOL_NAME.test(tool))) {
    return { kind: "misconfigured", cause: "invalid allowlist" };
  }
  return { kind: "usable", allowlist };
}
function configurationError(cause) {
  return {
    verdict: { kind: "gateError", subject: `the unknown-tool gate configuration (${cause})` },
    events: []
  };
}
function thisSessionsPlanIsPending(stateContent, session) {
  if (!stateSays(stateContent, "plan_approval", "pending")) return false;
  return stateValue(stateContent, "plan_approval_session") === session;
}
function allowlistCarries(allowlist, toolName) {
  return `|${allowlist}|`.includes(`|${toolName}|`);
}
function allowlistHost(host) {
  return host === "opencode" ? "OpenCode" : "Codex";
}

// core/src/gates/version.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync6 } from "node:fs";
import path11 from "node:path";
var RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
var GITHUB_URL_PREFIX = "https://github.com/";
var FETCH_CONNECT_SECONDS = 2;
var FETCH_TOTAL_SECONDS = 4;
var PUBLISHED_RELEASE_MAX_AGE_SECONDS = 86400;
var TAG_LINE_PATTERN = /refs\/tags\/v([0-9]+\.[0-9]+\.[0-9]+)$/;
var UPDATE_COMMANDS = "claude plugin marketplace update oso-code && claude plugin update oso-code@oso-code";
var VERSION_GATE = {
  gate: "version",
  errorSubject: "the stale-version gate",
  judge: judgeVersion
};
function judgeVersion({ envelope }) {
  if (envelope.source === "compact") return ALLOWED;
  const manifest = readFileOrEmpty(pluginManifestFile());
  const installedVersion = jsonField(manifest, "version");
  if (!RELEASE_VERSION_PATTERN.test(installedVersion)) return ALLOWED;
  const repositorySlug = repositorySlugOf(jsonField(manifest, "repository"));
  if (repositorySlug === void 0) return ALLOWED;
  if (!marketplaceServesRepository(repositorySlug)) return ALLOWED;
  const publishedVersion = publishedReleaseVersion(repositorySlug);
  if (!RELEASE_VERSION_PATTERN.test(publishedVersion)) return ALLOWED;
  if (releaseSortKey(publishedVersion) <= releaseSortKey(installedVersion)) return ALLOWED;
  const context = `oso-code: this session runs plugin version ${installedVersion} and the newest published release is ${publishedVersion} \u2014 tell the user once, naming the update: ${UPDATE_COMMANDS}`;
  return { verdict: { kind: "context", additionalContext: context }, events: [] };
}
function pluginManifestFile() {
  return path11.join(pluginRootDirectory(), ".claude-plugin", "plugin.json");
}
function publishedReleaseCacheFile() {
  return path11.join(stateRootDirectory(), "published-release");
}
function repositorySlugOf(repositoryUrl) {
  if (!repositoryUrl.startsWith(GITHUB_URL_PREFIX) || repositoryUrl.length === GITHUB_URL_PREFIX.length) {
    return void 0;
  }
  const slug = repositoryUrl.slice(GITHUB_URL_PREFIX.length);
  return slug.endsWith(".git") ? slug.slice(0, -4) : slug;
}
function marketplaceServesRepository(repositorySlug) {
  const home = homeDirectoryFrom(process.platform, process.env);
  const marketplacesFile = path11.join(home, ".claude", "plugins", "known_marketplaces.json");
  const registrations = readFileOrEmpty(marketplacesFile).replace(/\s/g, "");
  return registrations.includes(`"repo":"${repositorySlug}"`);
}
function publishedReleaseVersion(repositorySlug) {
  const cacheFile = publishedReleaseCacheFile();
  const cached = cachedPublishedRelease(cacheFile);
  if (cached !== void 0) return cached;
  refreshPublishedReleaseCache(cacheFile, repositorySlug);
  return cachedPublishedRelease(cacheFile) ?? "";
}
function cachedPublishedRelease(cacheFile) {
  const age = secondsSinceModified(cacheFile);
  if (age === void 0 || age >= PUBLISHED_RELEASE_MAX_AGE_SECONDS) return void 0;
  return readFileOrEmpty(cacheFile);
}
function refreshPublishedReleaseCache(cacheFile, repositorySlug) {
  try {
    writeFileAtomically(
      path11.dirname(cacheFile),
      cacheFile,
      fetchedHighestReleaseVersion(repositorySlug),
      ".published-release."
    );
  } catch {
    return;
  }
}
function fetchedHighestReleaseVersion(repositorySlug) {
  return highestReleaseVersion(tagVersionsIn(gitUploadPackAdvertisement(repositorySlug)));
}
function gitUploadPackAdvertisement(repositorySlug) {
  try {
    return execFileSync3(
      "curl",
      [
        "-fsS",
        "--connect-timeout",
        String(FETCH_CONNECT_SECONDS),
        "--max-time",
        String(FETCH_TOTAL_SECONDS),
        `${GITHUB_URL_PREFIX}${repositorySlug}.git/info/refs?service=git-upload-pack`
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return "";
  }
}
function tagVersionsIn(advertisement) {
  return advertisement.split("\n").map((line) => TAG_LINE_PATTERN.exec(line)?.[1]).filter((version) => version !== void 0);
}
function highestReleaseVersion(versions) {
  let highest = "";
  let highestKey = "";
  for (const version of versions) {
    const key = releaseSortKey(version);
    if (highestKey === "" || key > highestKey) {
      highest = version;
      highestKey = key;
    }
  }
  return highest;
}
function releaseSortKey(version) {
  return version.split(".").map((component) => component.padStart(5, "0")).join("");
}
function readFileOrEmpty(target) {
  try {
    return readFileSync6(target, "utf8");
  } catch {
    return "";
  }
}

// core/src/gates/dispatch.ts
var THE_GATE_ENTRY_POINT = "the gate entry point";
var PRE_TOOL_USE_GATES = [
  COMMIT_GATE,
  EDITS_GATE,
  UNKNOWN_TOOL_GATE,
  PROD_DEPLOY_GATE
];
var SESSION_START_GATES = [STALE_GATE, VERSION_GATE, REANCHOR_GATE];
var NO_VERDICT_GATES = [
  STATEBIN_GATE,
  TEARDOWN_GATE
];
var STOP_GATES = [
  AUTOCONTINUE_GATE,
  PLANSTOP_GATE
];
var USER_PROMPT_GATES = [
  PLANPROMPT_GATE
];
var SUBAGENT_STOP_GATES = [HANDOFF_GATE];
function runGate(argv, envelope) {
  const [name, ...gateArguments] = argv;
  const request = { envelope, argv: gateArguments };
  const escalated = envelope.stopHookActive;
  const run2 = routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ?? routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ?? routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ?? routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun) ?? routed(USER_PROMPT_GATES, name, request, userPromptRun, loudRun) ?? routed(SUBAGENT_STOP_GATES, name, request, subagentStopRun, loudRun);
  return run2 ?? gateErrorRun(`${THE_GATE_ENTRY_POINT} (unknown gate '${name ?? ""}')`);
}
function routed(gates, name, request, transport, onFailure) {
  const gate = gates.find((definition) => definition.gate === name);
  return gate === void 0 ? void 0 : runWith(gate, request, transport, onFailure);
}
function runWith(gate, request, transport, onFailure) {
  try {
    const outcome = gate.judge(request);
    const run2 = transport(outcome.verdict);
    return { ...run2, stderr: run2.stderr + (outcome.stderr ?? ""), verdict: outcome.verdict, events: outcome.events };
  } catch (cause) {
    return onFailure(gate.errorSubject, cause);
  }
}
function gateErrorRun(subject, cause) {
  const verdict = { kind: "gateError", subject };
  const run2 = preToolUseRun(verdict);
  return { ...run2, stderr: run2.stderr + explainedCause(cause), verdict, events: [] };
}
var LOUD_EXIT = 1;
function loudRun(subject, cause) {
  return {
    exit: LOUD_EXIT,
    stdout: "",
    stderr: explainedCause(cause),
    verdict: { kind: "gateError", subject },
    events: []
  };
}
function explainedCause(cause) {
  if (cause === void 0) return "";
  return `oso-code: cause: ${cause instanceof Error ? cause.message : String(cause)}
`;
}

// core/src/hosts/spawned.ts
function named(environment, variable) {
  const value = environment[variable];
  return value === void 0 ? "" : value;
}
function spawningHost(environment) {
  if (named(environment, "OSO_HOST") === "opencode") return "opencode";
  return named(environment, "OSO_AGENT") === "" ? "claude" : "codex";
}
function spawnedCaller(environment) {
  return {
    host: spawningHost(environment),
    agentSession: named(environment, "OSO_AGENT"),
    stateBin: named(environment, "OSO_STATE_BIN")
  };
}
function spawnedEnvelope(payload, environment) {
  return readEnvelope(payload, spawnedCaller(environment));
}

// core/src/bin/gate.ts
function attemptGate(argv) {
  try {
    return runGate(argv, spawnedEnvelope(readFileSync7(0, "utf8"), process.env));
  } catch (cause) {
    return gateErrorRun(THE_GATE_ENTRY_POINT, cause);
  }
}
var run = attemptGate(process.argv.slice(2));
if (run.stdout !== "") process.stdout.write(run.stdout);
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
