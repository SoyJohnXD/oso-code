// core/src/bin/gate.ts
import { readFileSync as readFileSync4 } from "node:fs";

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

// core/src/gates/autocontinue.ts
import { mkdirSync as mkdirSync3, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
import path4 from "node:path";

// core/src/shell/lexer.ts
var MAX_LEXED_INPUT_BYTES = 3072;
var UNREAD_PAYLOAD_MARKER = "!unread-payload";
var MAX_PAYLOAD_DEPTH = 3;
var SPECIAL_CHARACTERS = "'\"\\$`#;&|(){}<> 	\n";
var QUOTED_SPECIAL_CHARACTERS = '"\\$`';
var WORD_DELIMITERS = " 	\n;&|()<>";
var UNREAD_PAYLOAD = { kind: "unreadPayload" };
var COPROCESS_WORD = "coproc";
var COPROCESS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
  "!",
  COPROCESS_WORD
]);
var SHELL_INTERPRETERS = /* @__PURE__ */ new Set(["bash", "sh", "dash", "zsh", "ksh"]);
var COMMAND_FLAG_READERS = /* @__PURE__ */ new Set([...SHELL_INTERPRETERS, "script"]);
var SHELL_COMMAND_FLAG = "c";
var CALLBACK_FLAG = "C";
var CALLBACK_FLAG_READERS = /* @__PURE__ */ new Set(["mapfile", "readarray", "compgen", "complete"]);
var TMUX_SUBCOMMANDS_RUNNING_A_COMMAND = /* @__PURE__ */ new Set([
  "new-session",
  "new",
  "new-window",
  "neww",
  "split-window",
  "splitw",
  "respawn-pane",
  "respawnp",
  "respawn-window",
  "respawnw",
  "run-shell",
  "run"
]);
var SOURCING_BUILTINS = /* @__PURE__ */ new Set(["source", "."]);
var EVAL_WORD = "eval";
var REMOTE_SHELL_WORD = "ssh";
var TERMINAL_MULTIPLEXER_WORD = "tmux";
var TRAP_WORD = "trap";
var TRAP_ARGUMENTS_LEAVING_NO_ACTION = /* @__PURE__ */ new Set(["-l", "-p", "-"]);
var END_OF_OPTIONS = "--";
var ALIAS_WORD = "alias";
var HISTORY_REPLAYING_WORD = "fc";
var ALIAS_DEFINITION = /^[^-=][^=]*=/;
var ASSIGNMENT_NAMING_A_FILE_THE_SHELL_SOURCES = /^BASH_ENV=/;
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
function readsACommandFlag(word) {
  return COMMAND_FLAG_READERS.has(basenameOf(word));
}
function readsACallbackFlag(word) {
  return CALLBACK_FLAG_READERS.has(basenameOf(word));
}
function definesAnAlias(word) {
  return ALIAS_DEFINITION.test(word);
}
function namesAFileTheShellSources(assignment) {
  return ASSIGNMENT_NAMING_A_FILE_THE_SHELL_SOURCES.test(assignment);
}
function withoutACoprocessName(words) {
  const trailing = words.at(-1);
  if (trailing === void 0 || words.at(-2) !== COPROCESS_WORD) return words;
  return COPROCESS_NAME.test(trailing) ? words.slice(0, -1) : words;
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
  return SOURCING_BUILTINS.has(word);
}
function withSpacesForNewlines(text) {
  return text.replaceAll("\n", " ");
}
function leadingRunWithout(text, stoppers) {
  let length = 0;
  while (length < text.length && !stoppers.includes(text[length])) length += 1;
  return text.slice(0, length);
}
var ANSI_C_NAMED_ESCAPES = {
  a: "\x07",
  b: "\b",
  e: "\x1B",
  E: "\x1B",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?"
};
var ANSI_C_HEX_ESCAPE_WIDTHS = { x: 2, u: 4, U: 8 };
var OCTAL_ESCAPE_WIDTH = 3;
var OCTAL_DIGIT = /^[0-7]$/;
var HEX_DIGIT = /^[0-9A-Fa-f]$/;
var OCTAL_ESCAPE_MASK = 255;
var CONTROL_ESCAPE_MASK = 31;
var DELETE_CODE_POINT = 127;
var HIGHEST_CODE_POINT = 1114111;
var STRING_TERMINATOR = "\0";
function ansiCQuoted(body) {
  const decoded = ansiCDecoded(body);
  const terminator = decoded.text.indexOf(STRING_TERMINATOR);
  return terminator === -1 ? decoded : { text: decoded.text.slice(0, terminator), length: decoded.length };
}
function ansiCDecoded(body) {
  let text = "";
  let at = 0;
  while (at < body.length) {
    const character = body[at];
    if (character === "'") return { text, length: at + 1 };
    if (character !== "\\") {
      text += character;
      at += 1;
      continue;
    }
    const escape = ansiCEscapeAt(body, at + 1);
    text += escape.text;
    at += 1 + escape.length;
  }
  return { text, length: at };
}
function ansiCEscapeAt(body, at) {
  const marker = body[at];
  if (marker === void 0) return { text: "\\", length: 0 };
  const named2 = ANSI_C_NAMED_ESCAPES[marker];
  if (named2 !== void 0) return { text: named2, length: 1 };
  if (OCTAL_DIGIT.test(marker)) return octalEscape(body.slice(at));
  const decoded = markedEscape(marker, body.slice(at + 1));
  if (decoded === void 0) return { text: `\\${marker}`, length: 1 };
  return { text: decoded.text, length: 1 + decoded.length };
}
function markedEscape(marker, rest) {
  if (marker === "c") return controlEscape(rest);
  const hexWidth = ANSI_C_HEX_ESCAPE_WIDTHS[marker];
  return hexWidth === void 0 ? void 0 : hexEscape(rest, hexWidth);
}
function octalEscape(digitsAndRest) {
  const digits = leadingRunOf(digitsAndRest, OCTAL_DIGIT, OCTAL_ESCAPE_WIDTH);
  return { text: String.fromCharCode(parseInt(digits, 8) & OCTAL_ESCAPE_MASK), length: digits.length };
}
function hexEscape(rest, width) {
  const digits = leadingRunOf(rest, HEX_DIGIT, width);
  if (digits === "") return void 0;
  const code = parseInt(digits, 16);
  if (code > HIGHEST_CODE_POINT) return void 0;
  return { text: String.fromCodePoint(code), length: digits.length };
}
function controlEscape(rest) {
  if (rest === "") return void 0;
  const spelledAsAnEscape = rest.startsWith("\\\\");
  const controlled = spelledAsAnEscape ? "\\" : rest[0];
  const length = spelledAsAnEscape ? 2 : 1;
  if (controlled === "?") return { text: String.fromCharCode(DELETE_CODE_POINT), length };
  return { text: String.fromCharCode(controlled.toUpperCase().charCodeAt(0) & CONTROL_ESCAPE_MASK), length };
}
function leadingRunOf(text, digit, width) {
  let length = 0;
  while (length < width && length < text.length && digit.test(text[length])) length += 1;
  return text.slice(0, length);
}
function splitAtTheFirstOperand(words) {
  const at = words.findIndex((word) => !word.startsWith("-"));
  if (at === -1) return void 0;
  return { operand: words[at], rest: words.slice(at + 1), behindAnOption: at > 0 };
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
        this.takeDollar();
        return;
      case "{":
      case "}":
        this.takeBrace(character);
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
  takeBrace(brace) {
    if (this.braceStandsAsAReservedWord()) {
      this.endCommand();
      return;
    }
    this.token += brace;
    this.tokenOpen = true;
  }
  braceStandsAsAReservedWord() {
    if (this.tokenOpen || this.rest === "") return false;
    if (!withoutACoprocessName(this.commandTokens).every(isCommandPrefixWord)) return false;
    return WORD_DELIMITERS.includes(this.rest.slice(0, 1));
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
      if (namesAFileTheShellSources(prefixWord)) this.markUnread();
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
    const wrapper = basenameOf(leading);
    if (wrapper === EVAL_WORD) {
      this.deferNestedCommands(this.commandTokens.slice(1).join(" "));
      return;
    }
    if (wrapper === REMOTE_SHELL_WORD) {
      this.deferRemoteShellPayload();
      return;
    }
    if (wrapper === TERMINAL_MULTIPLEXER_WORD) {
      this.deferTmuxPayload();
      return;
    }
    if (wrapper === TRAP_WORD) {
      this.deferTrapAction();
      return;
    }
    if (wrapper === ALIAS_WORD) {
      if (this.commandTokens.slice(1).some(definesAnAlias)) this.markUnread();
      return;
    }
    if (wrapper === HISTORY_REPLAYING_WORD) {
      this.markUnread();
      return;
    }
    if (readsACallbackFlag(leading)) {
      this.deferOptionValueAsACommand(CALLBACK_FLAG);
      return;
    }
    if (readsACommandFlag(leading)) this.deferInterpreterPayload();
  }
  deferTrapAction() {
    let optionsEnded = false;
    for (const argument of this.commandTokens.slice(1)) {
      if (optionsEnded || !argument.startsWith("-")) {
        this.deferNestedCommands(argument);
        return;
      }
      if (TRAP_ARGUMENTS_LEAVING_NO_ACTION.has(argument)) return;
      if (argument !== END_OF_OPTIONS) {
        this.markUnread();
        return;
      }
      optionsEnded = true;
    }
  }
  deferRemoteShellPayload() {
    const host = splitAtTheFirstOperand(this.commandTokens.slice(1));
    if (host === void 0) return;
    this.deferOperandPayload(host.rest, host.behindAnOption);
  }
  deferTmuxPayload() {
    const subcommand = splitAtTheFirstOperand(this.commandTokens.slice(1));
    if (subcommand === void 0) return;
    if (!TMUX_SUBCOMMANDS_RUNNING_A_COMMAND.has(subcommand.operand)) {
      if (subcommand.behindAnOption) this.markUnread();
      return;
    }
    this.deferOperandPayload(subcommand.rest, false);
  }
  deferOperandPayload(words, selectorUnresolved) {
    const payload = splitAtTheFirstOperand(words);
    if (payload === void 0) return;
    if (selectorUnresolved || payload.behindAnOption) this.markUnread();
    this.deferNestedCommands([payload.operand, ...payload.rest].join(" "));
  }
  deferInterpreterPayload() {
    this.deferOptionValueAsACommand(SHELL_COMMAND_FLAG);
    if (this.nested.length === 0) this.markUnread();
  }
  deferOptionValueAsACommand(commandFlag) {
    let commandFlagSeen = false;
    let valuePosition = false;
    for (const argument of this.commandTokens.slice(1)) {
      if (argument.startsWith("--")) {
        valuePosition = true;
      } else if (argument === `-${commandFlag}`) {
        commandFlagSeen = true;
        valuePosition = false;
      } else if (argument.startsWith("-") && argument.slice(1).includes(commandFlag)) {
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
  takeDollar() {
    if (this.rest.startsWith("'")) {
      this.rest = this.rest.slice(1);
      this.takeAnsiCQuoted();
      return;
    }
    if (this.rest.startsWith('"')) {
      this.rest = this.rest.slice(1);
      this.takeLocaleTranslated();
      return;
    }
    this.takeExpansion();
  }
  takeLocaleTranslated() {
    this.markUnread();
    this.takeDoubleQuoted();
  }
  takeAnsiCQuoted() {
    const quoted2 = ansiCQuoted(this.rest);
    this.token += quoted2.text;
    this.rest = this.rest.slice(quoted2.length);
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
var GATE_ROWS = [
  {
    gate: "commit",
    event: "PreToolUse",
    script: "block-commit-until-green.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "edits",
    event: "PreToolUse",
    script: "block-edits-without-slice.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "unknown",
    event: "PreToolUse",
    script: "block-unknown-tool.sh",
    wiring: { claude: "none", opencode: "wired" },
    mechanism: { claude: "none", opencode: "tool.execute.before" }
  },
  {
    gate: "autocontinue",
    event: "Stop",
    script: "auto-continue.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "native" }
  },
  {
    gate: "statebin",
    event: "SessionStart",
    script: "persist-state-bin.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "native" }
  },
  {
    gate: "stale",
    event: "SessionStart",
    script: "warn-stale-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "experimental.chat.system.transform" }
  },
  {
    gate: "version",
    event: "SessionStart",
    script: "warn-stale-version.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "none" }
  },
  {
    gate: "teardown",
    event: "SessionEnd",
    script: "cleanup-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "dispose" }
  },
  {
    gate: "proddeploy",
    event: "PreToolUse",
    script: "block-prod-deploy.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" }
  },
  {
    gate: "reanchor",
    event: "SessionStart",
    script: "reanchor-after-compact.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "event" }
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
var JournalAppendError = class extends Error {
  journalFile;
  constructor(journalFile, options) {
    super(`cannot append the milestone to ${journalFile}`, options);
    this.name = "JournalAppendError";
    this.journalFile = journalFile;
  }
};
var CHANGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var TOKEN_MAX_LENGTH = 128;
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
function repositoryIdentityFor(cwd) {
  const directory = cwd.replace(/\r$/, "");
  return gitCommonDirectory(directory) || directory;
}
function stateFileFor(cwd) {
  return path.join(stateRootDirectory(), `${sha256Hex(repositoryIdentityFor(cwd))}.state`);
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
function denyPatternsFileFor(stateFile) {
  return path.join(stateRootDirectory(), "deploy-deny", `${repositoryIdFor(stateFile)}.patterns`);
}
var MODEL_TOKEN_SHAPE = `1 to ${TOKEN_MAX_LENGTH} characters of letters, digits and / : . - _ @`;
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
function isDirectory(target) {
  const stats = statOrUndefined(target);
  return stats !== void 0 && stats.isDirectory();
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
  const read = readStateFile(denyPatternsFileFor(stateFile));
  if (read.kind !== "ok") return { kind: "noPatternBites" };
  const readings = read.content.split("\n").filter((pattern) => pattern !== "").map((pattern) => ({ pattern, reading: ereReads(pattern, command) }));
  if (readings.some((one) => one.reading === "matched")) return { kind: "aPatternBites" };
  const unreadable = readings.find((one) => one.reading === "untranslatable");
  if (unreadable === void 0) return { kind: "noPatternBites" };
  return { kind: "aPatternIsUnreadable", pattern: unreadable.pattern };
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
import { existsSync as existsSync2 } from "node:fs";
import path5 from "node:path";
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
  if (!existsSync2(stateFile)) return ALLOWED;
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
  const leftByAnother = `oso-code: this repository's own runtime state (${path5.basename(stateFile)}) was left by another session, and its flags arm this session's gates too`;
  const roadmapValue = stateValue(content, "roadmap");
  const roadmapInFlight = roadmapValue === ROADMAP_DISARMED_SENTINEL ? "" : roadmapValue;
  if (roadmapInFlight === "") {
    return `${leftByAnother} \u2014 if the user is resuming an oso-code plan change, run ${skillPrefix}plan {change} so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale and ${clearCommand} drops it.`;
  }
  const routeSlug = CHANGE_SLUG_PATTERN.test(roadmapInFlight) ? roadmapInFlight : ROADMAP_PLACEHOLDER;
  const disarmCommand = `${stateBin} --session ${quoted(sessionId)} set roadmap=none`;
  return `${leftByAnother}, and it names a roadmap in flight \u2014 if the user is resuming that roadmap, run ${skillPrefix}roadmap ${routeSlug} so its chain re-reads its own record and arms the child that record leaves un-run; if that roadmap is over or abandoned, ${disarmCommand} drops the claim it makes on this repository and ${clearCommand} drops the whole file.`;
}
var SKILL_PREFIXES = { claude: "/oso-code:", opencode: "/oso-" };
function skillPrefixFor(host) {
  return SKILL_PREFIXES[host];
}
function stateBinPath(caller) {
  if (caller.stateBin !== "") return caller.stateBin;
  return path5.join(pluginRootDirectory(), "bin", "oso-state");
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
import path6 from "node:path";
var STATEBIN_GATE = {
  gate: "statebin",
  errorSubject: "the state-bin gate",
  judge: judgeStatebin
};
function judgeStatebin(_request) {
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (envFile === void 0 || envFile === "") return NO_VERDICT;
  const stateBin = path6.join(pluginRootDirectory(), "bin", "oso-state");
  appendFileSync2(envFile, `export OSO_STATE_BIN=${stateBin}
`);
  return NO_VERDICT;
}

// core/src/gates/teardown.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync3, readdirSync, renameSync as renameSync2, rmSync as rmSync3, rmdirSync, statSync as statSync4 } from "node:fs";
import path7 from "node:path";
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
  const sessionWorktrees = path7.join(stateRootDirectory(), "worktrees", sessionId);
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
  rmSync3(`${stem}${JOURNAL_KEYED_WAIT_MARK_SUFFIX}`, { force: true });
}
function dropStateFile(stateFile) {
  if (stateFile === void 0) return;
  rmSync3(stateFile, { force: true });
  rmSync3(`${stateFile}.lock`, { recursive: true, force: true });
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
  const eventsLog = path7.join(stateRootDirectory(), "events.jsonl");
  if (!olderThanDays(eventsLog, EVENTS_LOG_RETENTION_DAYS)) return;
  renameSync2(eventsLog, `${eventsLog}.1`);
}
function pruneAbandonedState(sessionId, ownState) {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateFile === ownState) continue;
    if (existsSync3(`${stateFile}.lock`)) continue;
    if (!olderThanDays(stateFile, ABANDONED_STATE_DAYS)) continue;
    const abandonedId = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(abandonedId, stateFile);
    rmSync3(stateFile, { force: true });
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
  return directoryEntries(stateRootDirectory()).filter((name) => name.endsWith(".state")).sort().map((name) => path7.join(stateRootDirectory(), name)).filter((target) => isFile(target));
}
function subdirectoriesSorted(directory) {
  return directoryEntries(directory).sort().map((name) => path7.join(directory, name)).filter((target) => isDirectory(target));
}
function directoryEntries(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
function isFile(target) {
  const stats = statSync4(target, { throwIfNoEntry: false });
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
  const toolName = envelope.toolName;
  if (TOOL_NAME.test(toolName) && allowlistCarries(allowlist, toolName)) return ALLOWED;
  return denied({
    gate: "unknown",
    message: `oso-code: tool '${toolName === "" ? "<missing>" : toolName}' is not in this release's OpenCode hook allowlist. Use one of the allowed local tools instead: ${allowlist.replaceAll("|", ", ")}.`,
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
function allowlistCarries(allowlist, toolName) {
  return `|${allowlist}|`.includes(`|${toolName}|`);
}

// core/src/gates/version.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync3 } from "node:fs";
import path8 from "node:path";
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
  return path8.join(pluginRootDirectory(), ".claude-plugin", "plugin.json");
}
function publishedReleaseCacheFile() {
  return path8.join(stateRootDirectory(), "published-release");
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
  const marketplacesFile = path8.join(home, ".claude", "plugins", "known_marketplaces.json");
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
      path8.dirname(cacheFile),
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
    return readFileSync3(target, "utf8");
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
  AUTOCONTINUE_GATE
];
function runGate(argv, envelope) {
  const [name, ...gateArguments] = argv;
  const request = { envelope, argv: gateArguments };
  const escalated = envelope.stopHookActive;
  const run2 = routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ?? routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ?? routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ?? routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun);
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
  return "claude";
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
    return runGate(argv, spawnedEnvelope(readFileSync4(0, "utf8"), process.env));
  } catch (cause) {
    return gateErrorRun(THE_GATE_ENTRY_POINT, cause);
  }
}
var run = attemptGate(process.argv.slice(2));
if (run.stdout !== "") process.stdout.write(run.stdout);
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
