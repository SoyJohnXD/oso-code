// core/src/gates/autocontinue.ts
import { spawnSync } from "node:child_process";
import { mkdirSync as mkdirSync4, writeFileSync as writeFileSync2 } from "node:fs";
import path7 from "node:path";

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
  const named = ANSI_C_NAMED_ESCAPES[marker];
  if (named !== void 0) return { text: named, length: 1 };
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

// core/src/hosts/background-tasks.ts
var NO_BACKGROUND_TASKS = { kind: "absent" };

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
var NO_HOOK_FIELD_NAMED = {
  payloadRead: "json",
  sessionId: "",
  hookEventName: "",
  cwd: "",
  toolName: "",
  filePath: "",
  patchText: "",
  commandLine: "",
  source: "",
  agentId: "",
  agentType: "",
  permissionMode: "",
  transcriptPath: "",
  turnId: "",
  lastAssistantMessage: "",
  escapedLastAssistantMessage: "",
  prompt: "",
  escapedPrompt: "",
  stopHookActive: false,
  backgroundTasks: NO_BACKGROUND_TASKS
};
function hostEnvelope(caller, named) {
  const { payloadRead, stopHookActive, backgroundTasks, ...text } = { ...NO_HOOK_FIELD_NAMED, ...named };
  return { ...asHookFieldValues(text), payloadRead, stopHookActive, backgroundTasks, caller };
}
function asHookFieldValues(text) {
  const read = Object.entries(text).map(([name, value]) => [name, asHookFieldValue(value)]);
  return Object.fromEntries(read);
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
    const named = Array.isArray(node) ? void 0 : node[field];
    if (typeof named === "string") return named;
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
var PRE_TOOL_USE_ROUTE = "pretooluse";
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
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "experimental.chat.system.transform" }
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
  },
  {
    gate: "subagentstart",
    event: "SubagentStart",
    script: "in-flight-start",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "none" }
  },
  {
    gate: "subagentstop",
    event: "SubagentStop",
    script: "in-flight-stop",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "none" }
  }
];
var TOOL_ROWS = [
  { gate: "commit", names: { claude: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", opencode: "multiedit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", opencode: "patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "task" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "list_mcp_resources" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "list_mcp_resource_templates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "read_mcp_resource" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_search" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_get_observation" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_save" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_update" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_context" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_session_summary" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_current_project" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_save_prompt" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_judge" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "context7_resolve-library-id" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "context7_query-docs" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_find_dupes" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_get_cleanup_candidates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_audit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "read" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "grep" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "glob" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "skill" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "todowrite" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "webfetch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "websearch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "question" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "lsp" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "plan_exit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" }
];
function gateRow(gate) {
  const found = GATE_ROWS.find((row) => row.gate === gate);
  if (found === void 0) throw new Error(`no route row names the gate ${gate}`);
  return found;
}
var PRE_TOOL_USE_EVENT = "PreToolUse";
var UNKNOWN_TOOL_MATCHER = ".*";
var CLAUDE_EXACT_TOOL_LIST = /^[A-Za-z0-9_|]+$/;
var SHAPED_TOOL_NAMES = {
  proddeploy: { claude: "mcp__.*deploy.*", opencode: ".*deploy.*" },
  edits: { claude: "none", opencode: ".*fix_apply" }
};
function gatesWiredFor(host, event) {
  return GATE_ROWS.filter((row) => row.event === event && row.wiring[host] === "wired");
}
function claudePreToolUseGatesFor(toolName) {
  return gatesWiredFor("claude", PRE_TOOL_USE_EVENT).filter((row) => new RegExp(claudeMatcherPattern(matcherFor("claude", row))).test(toolName)).map((row) => row.gate);
}
function claudeMatcherPattern(matcher) {
  return CLAUDE_EXACT_TOOL_LIST.test(matcher) ? wholeToolName(matcher) : matcher;
}
function wholeToolName(alternatives) {
  return `^(?:${alternatives})$`;
}
function matcherFor(host, row) {
  if (row.gate === "unknown") return UNKNOWN_TOOL_MATCHER;
  const named = toolNamesFor(host, row.gate);
  const shaped = SHAPED_TOOL_NAMES[row.gate]?.[host] ?? "none";
  return (shaped === "none" ? named : [...named, shaped]).join("|");
}
function toolNamesFor(host, gate) {
  const named = [];
  for (const row of TOOL_ROWS) {
    const name = row.names[host];
    if (row.gate !== gate || name === "none" || named.includes(name)) continue;
    named.push(name);
  }
  return named;
}

// core/src/state/in-flight-registry.ts
import { appendFileSync as appendFileSync2, closeSync, constants as constants2, mkdirSync as mkdirSync2, openSync, rmSync as rmSync2, writeSync } from "node:fs";
import path2 from "node:path";

// core/src/state/store.ts
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  readdirSync,
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
var GatesOwnedElsewhereError = class extends Error {
  constructor(owner) {
    super(
      `the gates are owned by session ${owner} \u2014 that session releases them with \`oso-state --session ${owner} close\`, or \`oso-state --session <id> clear\` resets them if it is gone`
    );
    this.name = "GatesOwnedElsewhereError";
  }
};
var CHANGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var NAME_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
var TOKEN_MAX_LENGTH = 128;
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
  const autoChange = readValue(stateFile, "auto_change") ?? "";
  const change = CHANGE_SLUG_PATTERN.test(autoChange) ? autoChange : "run";
  return path.join(runsDirectoryOf(stateFile), `${change}.log`);
}
function runsRootDirectory() {
  return path.join(stateRootDirectory(), "runs");
}
function runsDirectoryOf(stateFile) {
  return path.join(runsRootDirectory(), repositoryIdFor(stateFile));
}
function sessionRunDirectoryOf(repository, sessionId) {
  return path.join(runsRootDirectory(), repository, sessionId);
}
function inFlightRegistryOf(stateFile, sessionId) {
  return sessionRunEntryOf(stateFile, sessionId, "in-flight");
}
function completedAgentsLogOf(stateFile, sessionId) {
  return sessionRunEntryOf(stateFile, sessionId, "completed-agents.log");
}
function watchPidFileOf(stateFile, sessionId) {
  return sessionRunEntryOf(stateFile, sessionId, "watch.pid");
}
function sessionRunEntryOf(stateFile, sessionId, entry) {
  return path.join(sessionRunDirectoryOf(repositoryIdFor(stateFile), sessionId), entry);
}
function denyPatternsFileFor(stateFile) {
  return path.join(stateRootDirectory(), "deploy-deny", `${repositoryIdFor(stateFile)}.patterns`);
}
var MODEL_TOKEN_SHAPE = `1 to ${TOKEN_MAX_LENGTH} characters of letters, digits and / : . - _ @`;
function isNameToken(value) {
  return value.length >= 1 && value.length <= TOKEN_MAX_LENGTH && NAME_TOKEN_PATTERN.test(value);
}
function stateRecords(content, key) {
  const prefix = `${key}=`;
  return content.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
}
function stateValue(content, key) {
  return stateRecords(content, key).join("\n");
}
function recordedStateValue(content, key) {
  const value = stateValue(content, key);
  return value === "" ? null : value;
}
function stateSays(content, key, value) {
  return stateRecords(content, key).includes(value);
}
function holdsMode(content) {
  return stateRecords(content, "mode").length > 0;
}
function foreignOwner(content, sessionId) {
  const owner = stateValue(content, "session");
  return owner === "" || owner === sessionId ? void 0 : owner;
}
function foreignGateOwner(stateFile, sessionId) {
  const read = readStateFile(stateFile);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(stateFile, read.cause);
  if (read.kind === "absent" || !holdsMode(read.content)) return void 0;
  return foreignOwner(read.content, sessionId);
}
function refuseGateWritesByAForeignSession(stateFile, sessionId) {
  const owner = foreignGateOwner(stateFile, sessionId);
  if (owner !== void 0) throw new GatesOwnedElsewhereError(owner);
}
function readValue(stateFile, key) {
  const content = readFileIfPresent(stateFile, "skip");
  if (content === void 0 || stateRecords(content, key).length === 0) return void 0;
  return stateValue(content, key);
}
function readStateFile(stateFile) {
  try {
    if (!statSync(stateFile).isFile()) return { kind: "unreadable", cause: `not a regular file: ${stateFile}` };
    return { kind: "ok", content: readFileSync(stateFile, "utf8") };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", cause: causeOf(error) };
  }
}
function readFileIfPresent(file, whenUnreadable = "throw") {
  const read = readStateFile(file);
  if (read.kind === "unreadable" && whenUnreadable === "throw") throw new StateFileUnreadableError(file, read.cause);
  return read.kind === "ok" ? read.content : void 0;
}
function jsonObjectOf(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function writeStatePairs(stateFile, pairs, ownerSession) {
  const directory = path.dirname(stateFile);
  const read = readStateFile(stateFile);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(stateFile, read.cause);
  const existing = read.kind === "ok" ? read.content : "";
  let lines = parseStateLines(existing);
  for (const pair of [...pairs, `session=${ownerSession}`]) {
    const [key, value] = splitPair(pair);
    lines = lines.filter((line) => line.key !== key);
    lines.push({ key, value });
  }
  const content = serializeStateLines(lines);
  renameSync(createTempFile(directory, content), stateFile);
  return content;
}
function isSymlink(target) {
  const stats = lstatOrUndefined(target);
  return stats !== void 0 && stats.isSymbolicLink();
}
function isDirectory(target) {
  const stats = statOrUndefined(target);
  return stats !== void 0 && stats.isDirectory();
}
function entriesOfDirectory(directory) {
  try {
    return readdirSync(directory).sort();
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return [];
    throw error;
  }
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
function isExecutableRegularFile(target) {
  if (!isRegularNonSymlinkFile(target)) return false;
  try {
    accessSync(target, constants.X_OK);
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
  } catch (error) {
    throw new JournalAppendError(journalFile, { cause: error });
  }
}
function eventsLogFile() {
  return path.join(stateRootDirectory(), "events.jsonl");
}
function logEvent(entry) {
  const line = serializeEvent(entry);
  const eventsLog = eventsLogFile();
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

// core/src/state/in-flight-registry.ts
var MARK_SET = "true";
var APPEND_WITHOUT_CREATING = constants2.O_WRONLY | constants2.O_APPEND;
function readRegistry(registry) {
  const readings = entriesOfDirectory(registry).filter(isNameToken).map((agentId) => entryReading(registry, agentId));
  return {
    agents: readings.flatMap((reading) => reading.kind === "registered" ? [reading.agent] : []),
    unreadable: readings.flatMap((reading) => reading.kind === "unreadable" ? [reading.entry] : [])
  };
}
function entryReading(registry, agentId) {
  const entryFile = path2.join(registry, agentId);
  const read = readStateFile(entryFile);
  if (read.kind === "absent") return { kind: "gone" };
  if (read.kind === "unreadable") return { kind: "unreadable", entry: { agentId, cause: read.cause } };
  const startedAt = stateValue(read.content, "started_at");
  if (Number.isNaN(Date.parse(startedAt))) {
    return { kind: "unreadable", entry: { agentId, cause: `no started_at timestamp in ${entryFile}` } };
  }
  const agent = {
    agentId,
    agentType: stateValue(read.content, "agent_type"),
    transcriptPath: stateValue(read.content, "transcript"),
    startedAt,
    reported: stateValue(read.content, "reported") === MARK_SET,
    endedWithoutNotice: stateValue(read.content, "ended_without_notice") === MARK_SET
  };
  return { kind: "registered", agent };
}
function registeredIdsIn(reading) {
  return [...reading.agents, ...reading.unreadable].map((entry) => entry.agentId);
}
function writeRegisteredAgent(registry, agent) {
  const record = `agent_id=${agent.agentId}
agent_type=${oneLine(agent.agentType)}
transcript=${oneLine(agent.transcriptPath)}
started_at=${agent.startedAt}
`;
  withOwnerOnlyUmask(() => writeFileAtomically(registry, path2.join(registry, agent.agentId), record, ".registering-"));
}
function markEndedWithoutNotice(registry, agentId) {
  appendMark(registry, agentId, "ended_without_notice");
}
function appendMark(registry, agentId, mark) {
  let entry;
  try {
    entry = openSync(path2.join(registry, agentId), APPEND_WITHOUT_CREATING);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  try {
    writeSync(entry, `${mark}=${MARK_SET}
`);
  } finally {
    closeSync(entry);
  }
}
function forgetAgent(registry, agentId) {
  rmSync2(path2.join(registry, agentId), { recursive: true, force: true });
}
function recordCompletion(completedAgentsLog, agentId) {
  withOwnerOnlyUmask(() => {
    mkdirSync2(path2.dirname(completedAgentsLog), { recursive: true });
    appendFileSync2(completedAgentsLog, `${isoTimestamp()} ${agentId}
`);
  });
}
function completedAgentCount(stateFile, sessionId) {
  const completedAgentsLog = completedAgentsLogOf(stateFile, sessionId);
  return (readFileIfPresent(completedAgentsLog) ?? "").split("\n").filter((line) => line !== "").length;
}
function oneLine(value) {
  return value.replace(/[\r\n]+/g, " ");
}

// core/src/state/watch.ts
var MINUTE_MS = 6e4;
var DEFAULT_POLL_MS = 3e4;
var SILENCE_LIMIT_MS = 60 * MINUTE_MS;
var LONG_RUNNING_LIMIT_MS = 180 * MINUTE_MS;
var WATCHDOG_LIMITS = { silenceMs: SILENCE_LIMIT_MS, longRunningMs: LONG_RUNNING_LIMIT_MS };
var POSITIVE_INTEGER = /^[1-9]\d*$/;
var WATCHDOG_RECORD = /^([1-9]\d*):(\d*)$/;
var HEARTBEAT_MISSED_POLLS = 3;
var START_TIME_FIELD_AFTER_COMMAND = 19;
function watchdogAlive(stateFile, sessionId, startOf = processStartOf) {
  const pidFile = watchPidFileOf(stateFile, sessionId);
  const watchdog = recordedWatchdog(pidFile);
  if (watchdog === void 0) return false;
  const start = startOf(watchdog.pid);
  if (start !== void 0) return start === watchdog.start;
  return processLives(watchdog.pid) && heartbeatFresh(pidFile);
}
function overdueDelegation({ startedMs, lastActivityMs }, nowMs, limits = WATCHDOG_LIMITS) {
  const silentMs = nowMs - lastActivityMs;
  if (silentMs >= limits.silenceMs) return { kind: "stuck", measure: ` silent ${minutes(silentMs)} min` };
  const inFlightMs = nowMs - startedMs;
  if (inFlightMs < limits.longRunningMs) return void 0;
  return { kind: "long-running", measure: ` in flight ${minutes(inFlightMs)} min` };
}
function delegationOverdueAtMs({ startedMs, lastActivityMs }) {
  return Math.min(lastActivityMs + WATCHDOG_LIMITS.silenceMs, startedMs + WATCHDOG_LIMITS.longRunningMs);
}
function minutes(milliseconds) {
  return Math.floor(milliseconds / MINUTE_MS);
}
function watchLimitsFrom(environment) {
  return {
    pollMs: testOverride(environment["OSO_WATCH_POLL_MS"]) ?? DEFAULT_POLL_MS,
    silenceMs: testOverride(environment["OSO_WATCH_SILENCE_MS"]) ?? WATCHDOG_LIMITS.silenceMs,
    longRunningMs: testOverride(environment["OSO_WATCH_LONG_MS"]) ?? WATCHDOG_LIMITS.longRunningMs
  };
}
function testOverride(value) {
  if (value === void 0 || !POSITIVE_INTEGER.test(value)) return void 0;
  return Number(value);
}
function recordedWatchdog(pidFile) {
  const recorded = WATCHDOG_RECORD.exec(stateValue(readFileIfPresent(pidFile) ?? "", "watch"));
  if (recorded === null) return void 0;
  return { pid: Number(recorded[1]), start: recorded[2] };
}
function processLives(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "EPERM") return true;
    if (isErrnoException(error) && error.code === "ESRCH") return false;
    throw error;
  }
}
function heartbeatFresh(pidFile) {
  const silentSeconds = secondsSinceModified(pidFile);
  const toleratedSeconds = watchLimitsFrom(process.env).pollMs * HEARTBEAT_MISSED_POLLS / 1e3;
  return silentSeconds !== void 0 && silentSeconds < toleratedSeconds;
}
function processStartOf(pid) {
  const stat = readFileIfPresent(`/proc/${pid}/stat`);
  if (stat === void 0) return void 0;
  const fieldsAfterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fieldsAfterCommand[START_TIME_FIELD_AFTER_COMMAND];
}

// core/src/gates/delegation.ts
import { rmSync as rmSync3 } from "node:fs";
import path3 from "node:path";
var COUNT_PATTERN = /^[0-9]+$/;
var MARK_SUFFIX = ".waiting";
function isCount(value) {
  return COUNT_PATTERN.test(value);
}
function removeLegacyWaitMarks(stateFile) {
  const runs = runsDirectoryOf(stateFile);
  for (const mark of entriesOfDirectory(runs).filter((name) => name.endsWith(MARK_SUFFIX))) {
    const markFile = path3.join(runs, mark);
    if (isRegularNonSymlinkFile(markFile)) rmSync3(markFile, { force: true });
  }
}

// core/src/gates/in-flight.ts
import path6 from "node:path";

// core/src/prose/routes.ts
var VERIFIER_AGENT = "oso-verifier";

// core/src/verdict/grammar.ts
var RECORDED_VERDICTS = ["pass", "fail", "blocked", "none"];
var VERDICT_SHAPES = ["valid", "malformed"];
var STATUS_LINE = /^\s*status\s*:\s*(done|blocked)\s*$/i;
var VERDICT_LINE = /^\s*verdict\s*:\s*(pass|fail|blocked)\s*$/i;
function parseAgentVerdict(text) {
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const statusMatch = line.match(STATUS_LINE);
    if (statusMatch !== null) {
      parsed.status = statusMatch[1].toLowerCase();
      continue;
    }
    const verdictMatch = line.match(VERDICT_LINE);
    if (verdictMatch !== null) parsed.verdict = verdictMatch[1].toLowerCase();
  }
  return parsed;
}
function readVerdictShape(text) {
  const { verdict } = parseAgentVerdict(text);
  return verdict === void 0 ? { verdict: "none", verdict_shape: "malformed" } : { verdict, verdict_shape: "valid" };
}

// core/src/verdict/record.ts
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync3 } from "node:fs";
import path4 from "node:path";
var VERIFIER_ROLE = "verifier";
var TELEMETRY_WRITE_FAILED = "telemetry-write-failed";
function verdictsFileFor(stateFile) {
  return path4.join(runsDirectoryOf(stateFile), "verdicts.jsonl");
}
function appendVerdict(verdictsFile, capture) {
  return appendEntry(verdictsFile, capture.session, () => {
    const attempt = verifierRecordsSinceArm(readVerdicts(verdictsFile).entries, capture.slice).length + 1;
    return {
      time: isoTimestamp(),
      host: capture.host,
      session: capture.session,
      change: capture.change,
      slice: capture.slice,
      attempt,
      role: capture.role,
      model: capture.model,
      verdict: capture.verdict,
      verdict_shape: capture.verdict_shape,
      escalated: capture.escalated
    };
  });
}
function readVerdicts(verdictsFile) {
  const lines = (readFileIfPresent(verdictsFile) ?? "").split("\n").filter((line) => line !== "");
  const entries = lines.flatMap((line) => {
    const entry = logEntryOf(line);
    return entry === void 0 ? [] : [entry];
  });
  return { entries, skippedLines: lines.length - entries.length };
}
function recordsSinceArm(entries) {
  const armedSlices = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (isArmMarker(entry)) {
      armedSlices.set(entry.slice, []);
      continue;
    }
    if (entry.slice !== null) armedSlices.get(entry.slice)?.push(entry);
  }
  return [...armedSlices.values()].flat();
}
function verifierRecordsSinceArm(entries, slice) {
  return recordsSinceArm(entries).filter((record) => record.slice === slice && record.role === VERIFIER_ROLE);
}
function isArmMarker(entry) {
  return "kind" in entry;
}
function appendEntry(verdictsFile, session, entryOf) {
  try {
    const line = `${JSON.stringify(entryOf())}
`;
    withOwnerOnlyUmask(() => {
      mkdirSync3(path4.dirname(verdictsFile), { recursive: true });
      appendFileSync3(verdictsFile, line);
    });
    return true;
  } catch (error) {
    logEvent({ event: TELEMETRY_WRITE_FAILED, session, command: causeOf(error) });
    return false;
  }
}
function logEntryOf(line) {
  const parsed = jsonObjectOf(line);
  if (parsed === void 0) return void 0;
  if (parsed["kind"] === "arm") return armMarkerOf(parsed);
  return verdictRecordOf(parsed);
}
function armMarkerOf(fields) {
  const { slice, session, change, time } = fields;
  if (!isText(slice) || !isText(session) || !isTextOrNull(change) || !isText(time)) return void 0;
  return { kind: "arm", slice, session, change, time };
}
function verdictRecordOf(fields) {
  const { time, host, session, change, slice, attempt, role, model, verdict, verdict_shape, escalated } = fields;
  if (!isText(time) || !isText(session) || !isTextOrNull(change) || !isTextOrNull(slice) || !isText(role)) return void 0;
  if (!isHostName(host) || typeof attempt !== "number") return void 0;
  if (!isTextOrNull(model) || typeof escalated !== "boolean") return void 0;
  const recorded = RECORDED_VERDICTS.find((value) => value === verdict);
  const shape = VERDICT_SHAPES.find((value) => value === verdict_shape);
  if (recorded === void 0 || shape === void 0) return void 0;
  return {
    time,
    host,
    session,
    change,
    slice,
    attempt,
    role,
    model,
    verdict: recorded,
    verdict_shape: shape,
    escalated
  };
}
var HOST_NAMES = { claude: true, opencode: true };
function isHostName(value) {
  return isText(value) && Object.hasOwn(HOST_NAMES, value);
}
function isText(value) {
  return typeof value === "string";
}
function isTextOrNull(value) {
  return value === null || typeof value === "string";
}

// core/src/verdict/capture.ts
function isVerifierAgent(agentType) {
  return agentType === VERIFIER_AGENT || agentType.endsWith(`:${VERIFIER_AGENT}`);
}
function captureVerifierReport(report) {
  try {
    appendReportToItsRepository(report);
  } catch (error) {
    logEvent({ event: TELEMETRY_WRITE_FAILED, session: report.session, command: causeOf(error) });
  }
}
function appendReportToItsRepository({ host, cwd, session, model, report }) {
  if (!isDirectory(cwd)) return;
  const stateFile = stateFileFor(cwd);
  const state = readFileIfPresent(stateFile);
  if (state === void 0) return;
  appendVerdict(verdictsFileFor(stateFile), {
    host,
    session,
    change: recordedStateValue(state, "auto_change"),
    slice: recordedStateValue(state, "active_slice"),
    role: VERIFIER_ROLE,
    model,
    ...readVerdictShape(report),
    escalated: false
  });
}

// core/src/gates/preflight.ts
import { existsSync } from "node:fs";
import path5 from "node:path";
import { fileURLToPath } from "node:url";
var RUN_ARMED = "running";
function sanitizeSession(raw) {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
function hookSessionId(envelope) {
  const named = envelope.caller.agentSession;
  return sanitizeSession(named !== "" ? named : envelope.sessionId);
}
function payloadUnparseable() {
  return { verdict: { kind: "allow" }, events: [{ event: "payload-unparseable", session: "" }] };
}
function ownRunState(stateFile, sessionId) {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return void 0;
  return stateValue(read.content, "session") === sessionId ? read.content : void 0;
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
  return pluginRootAbove(path5.dirname(fileURLToPath(import.meta.url)));
}
var PLUGIN_ROOT_WRAPPERS = [[], ["plugin"]];
var HOOKS_MANIFEST_LOCATIONS = [["hooks.json"], ["hooks", "hooks.json"]];
var HOOKS_MANIFEST_FINGERPRINT = `/${GATE_BUNDLE}`;
function pluginRootAbove(moduleDirectory) {
  let candidate = moduleDirectory;
  while (true) {
    for (const wrapper of PLUGIN_ROOT_WRAPPERS) {
      const root = path5.join(candidate, ...wrapper);
      if (existsSync(path5.join(root, "bin", "oso-state")) && isVerifiedOsoCodeRoot(root)) return root;
    }
    const parent = path5.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        `no ancestor of ${moduleDirectory} carries a verified oso-code bin/oso-state, directly or one level under plugin/, to anchor the plugin root on`
      );
    }
    candidate = parent;
  }
}
function isVerifiedOsoCodeRoot(root) {
  return HOOKS_MANIFEST_LOCATIONS.some((segments) => hooksManifestFingerprinted(path5.join(root, ...segments)));
}
function hooksManifestFingerprinted(manifestFile) {
  return readFileIfPresent(manifestFile, "skip")?.includes(HOOKS_MANIFEST_FINGERPRINT) ?? false;
}

// core/src/gates/in-flight.ts
var SUBAGENT_TASK = "subagent";
var SUBAGENT_STOP_EVENT = "SubagentStop";
var NOTHING_REGISTERED = { agents: [], unreadable: [] };
var SUBAGENT_START_GATE = {
  gate: "subagentstart",
  errorSubject: "the in-flight registry's subagent-start gate",
  judge: registerStartedAgent
};
var SUBAGENT_STOP_GATE = {
  gate: "subagentstop",
  errorSubject: "the in-flight registry's subagent-stop gate",
  judge: forgetStoppedAgent
};
function registerStartedAgent({ envelope }) {
  const run = armedRunOf(envelope);
  if (run === void 0) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstart");
  writeRegisteredAgent(inFlightRegistryOf(run.stateFile, run.sessionId), {
    agentId: envelope.agentId,
    agentType: envelope.agentType,
    transcriptPath: derivedTranscriptPath(envelope, envelope.agentId),
    startedAt: isoTimestamp()
  });
  return NO_VERDICT;
}
function forgetStoppedAgent({ envelope }) {
  captureVerifierStop(envelope);
  const run = armedRunOf(envelope);
  if (run === void 0) return NO_VERDICT;
  if (!isNameToken(envelope.agentId)) return unregistered(envelope, "subagentstop");
  forgetAgent(inFlightRegistryOf(run.stateFile, run.sessionId), envelope.agentId);
  recordCompletion(completedAgentsLogOf(run.stateFile, run.sessionId), envelope.agentId);
  flagEndedWithoutNotice(envelope);
  return NO_VERDICT;
}
function captureVerifierStop(envelope) {
  if (!isVerifierAgent(envelope.agentType)) return;
  captureVerifierReport({
    host: envelope.caller.host,
    cwd: envelope.cwd,
    session: hookSessionId(envelope),
    model: launchedModelOf(envelope),
    report: envelope.lastAssistantMessage
  });
}
function launchedModelOf(envelope) {
  if (!isNameToken(envelope.agentId)) return null;
  const transcript = derivedTranscriptPath(envelope, envelope.agentId);
  if (transcript === "") return null;
  const meta = readFileIfPresent(transcript.replace(/\.jsonl$/, ".meta.json"), "skip");
  const model = meta === void 0 ? void 0 : jsonObjectOf(meta)?.["model"];
  return typeof model === "string" ? model : null;
}
function resolveInFlight(envelope) {
  const sighting = sightingOf(envelope);
  const { agents, unreadable } = sighting.registered;
  if (sighting.reported === void 0) {
    const agentIds = registeredIdsIn(sighting.registered).filter((agentId) => agentId !== sighting.stoppingAgentId);
    return { agentIds, endedWithoutNotice: [], unreadable };
  }
  return {
    agentIds: sighting.reported.map((agent) => agent.agentId),
    endedWithoutNotice: [...flaggedIn(agents), ...newlyEndedIn(sighting)],
    unreadable
  };
}
function flagEndedWithoutNotice(envelope) {
  const sighting = sightingOf(envelope);
  const { registry } = sighting;
  if (registry === void 0) return;
  for (const agentId of newlyEndedIn(sighting)) markEndedWithoutNotice(registry, agentId);
}
function adoptUnregistered(envelope) {
  const sighting = sightingOf(envelope);
  const { registry, reported } = sighting;
  if (registry === void 0 || reported === void 0) return;
  const known = registeredIdsIn(sighting.registered);
  const unregisteredAgents = reported.filter(({ agentId }) => isNameToken(agentId) && !known.includes(agentId));
  for (const agent of unregisteredAgents) {
    writeRegisteredAgent(registry, {
      ...agent,
      transcriptPath: derivedTranscriptPath(envelope, agent.agentId),
      startedAt: isoTimestamp()
    });
  }
}
function sightingOf(envelope) {
  const registry = registryOf(envelope);
  const stoppingAgentId = stoppingAgentOf(envelope);
  return {
    registry,
    registered: registry === void 0 ? NOTHING_REGISTERED : readRegistry(registry),
    reported: reportedInFlight(envelope.backgroundTasks)?.filter((agent) => agent.agentId !== stoppingAgentId),
    stoppingAgentId
  };
}
function newlyEndedIn({ registered, reported, stoppingAgentId }) {
  if (reported === void 0) return [];
  const stillReported = (agentId) => reported.some((agent) => agent.agentId === agentId);
  return registered.agents.filter((agent) => !agent.endedWithoutNotice && agent.agentId !== stoppingAgentId && !stillReported(agent.agentId)).map((agent) => agent.agentId);
}
function stoppingAgentOf(envelope) {
  return envelope.hookEventName === SUBAGENT_STOP_EVENT ? envelope.agentId : void 0;
}
function reportedInFlight(backgroundTasks) {
  switch (backgroundTasks.kind) {
    case "array":
      return backgroundTasks.tasks.filter((task) => task.type === SUBAGENT_TASK).map((task) => ({ agentId: task.id, agentType: task.agentType }));
    case "object":
      return backgroundTasks.active.map((agentId) => ({ agentId, agentType: "" }));
    case "absent":
    case "unrecognized":
      return void 0;
  }
}
function flaggedIn(registered) {
  return registered.filter((agent) => agent.endedWithoutNotice).map((agent) => agent.agentId);
}
function registryOf(envelope) {
  const run = sessionRunOf(envelope);
  return run === void 0 ? void 0 : inFlightRegistryOf(run.stateFile, run.sessionId);
}
function armedRunOf(envelope) {
  const run = sessionRunOf(envelope);
  if (run === void 0) return void 0;
  const content = ownRunState(run.stateFile, run.sessionId);
  return content !== void 0 && stateValue(content, "auto") === RUN_ARMED ? run : void 0;
}
function sessionRunOf(envelope) {
  const sessionId = hookSessionId(envelope);
  if (sessionId === "" || !isDirectory(envelope.cwd)) return void 0;
  return { sessionId, stateFile: stateFileFor(envelope.cwd) };
}
function derivedTranscriptPath(envelope, agentId) {
  const sessionId = sanitizeSession(envelope.sessionId);
  if (envelope.transcriptPath === "" || sessionId === "") return "";
  return path6.join(path6.dirname(envelope.transcriptPath), sessionId, "subagents", `agent-${agentId}.jsonl`);
}
function unregistered(envelope, gate) {
  const route = gateRow(gate);
  return {
    verdict: { kind: "noVerdict" },
    events: [
      {
        event: "in-flight-unregistered",
        session: hookSessionId(envelope),
        command: envelope.agentId,
        gate: route.script,
        hookEvent: route.event
      }
    ]
  };
}

// core/src/gates/autocontinue.ts
var PUSHES_WITHOUT_PROGRESS_CAP = 3;
var RUN_HELD_EVENT = "auto-continue-held";
var OWNER_ONLY_FILE = 384;
var OWNER_ONLY_DIRECTORY = 448;
var RE_ANCHOR_THE_RUN = "oso-code: this run is unattended and still in flight, and this turn ended without parking or closing it. Continue it: re-read the position from the change's oso/index NEXT: line and from active_slice in oso-state, append every milestone to the run journal with oso-state journal, and park the run per the flow's own rules if a decision needs the operator.";
var NOTIFICATION_RESUMED_HOST = {
  order: `${RE_ANCHOR_THE_RUN} If a delegation is still in flight, do NOT relaunch it \u2014 its completion notification is what resumes the run, so wait for that instead.`,
  delegationsReturnInTurn: false
};
var DELEGATIONS_RETURN_IN_TURN_HOST = {
  order: `${RE_ANCHOR_THE_RUN} A delegation on this host returns inside the turn that launched it, so a turn that has ended left none in flight, or the rail released it by session id: read the report the launch itself returned rather than waiting for a notification this host never sends.`,
  delegationsReturnInTurn: true
};
var CONTINUATION_HOSTS = {
  claude: NOTIFICATION_RESUMED_HOST,
  opencode: DELEGATIONS_RETURN_IN_TURN_HOST
};
function continuationHostOf(host) {
  return CONTINUATION_HOSTS[host];
}
var CAP_MILESTONE = `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress \u2014 allowing the stop`;
var AUTOCONTINUE_GATE = {
  gate: "autocontinue",
  errorSubject: "the unattended-run continuation gate",
  judge: judgeAutocontinue
};
var PROGRESSED = { kind: "progressed" };
var UNCHANGED = { kind: "unchanged" };
function judgeAutocontinue({ envelope }) {
  const host = continuationHostOf(envelope.caller.host);
  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;
  const projectDir = envelope.cwd;
  if (!isDirectory(projectDir)) return ALLOWED;
  const content = ownRunState(stateFileFor(projectDir), sessionId);
  if (content === void 0) return ALLOWED;
  const stop = { envelope, sessionId, projectDir, content };
  return host.delegationsReturnInTurn ? continueInTurnRun(stop, host.order) : continueNotifiedRun(stop, host.order);
}
function continueInTurnRun(stop, order) {
  if (stateValue(stop.content, "auto") !== RUN_ARMED) return ALLOWED;
  const childrenInFlight = activeIn(stop.envelope.backgroundTasks);
  if (childrenInFlight.length > 0) {
    const observed = `children_in_flight=${childrenInFlight.join(",")}`;
    return allowedWith(gateEvent(RUN_HELD_EVENT, stop.sessionId, observed));
  }
  return pushedWithRunProgress(stop, { order, pushedEvent: "auto-continued", observed: "" });
}
function continueNotifiedRun(stop, order) {
  if (stateValue(stop.content, "auto") !== RUN_ARMED) return ALLOWED;
  const reading = readDelegations(stop);
  if (reading.kind === "unreadable") return degraded(stop.sessionId, reading.cause);
  const continued = continuedPastDelegations(stop, order, reading);
  const unreadableEntries = reading.resolution.unreadable.map(
    (entry) => gateEvent("auto-continue-registry-unreadable", stop.sessionId, `${entry.agentId}: ${entry.cause}`)
  );
  return { ...continued, events: [...unreadableEntries, ...continued.events] };
}
function continuedPastDelegations(stop, order, { resolution, watchdogLive }) {
  const observed = observedDelegations(stop.envelope.backgroundTasks, resolution);
  if (!needsWatchdog(resolution)) {
    return pushedWithRunProgress(stop, { order, pushedEvent: "auto-continued", observed });
  }
  if (watchdogLive) return allowedWith(gateEvent(RUN_HELD_EVENT, stop.sessionId, observed));
  if (stop.envelope.stopHookActive) {
    return allowedWith(gateEvent("auto-continue-watch-unstarted", stop.sessionId, observed));
  }
  return pushedWithRunProgress(stop, {
    order: START_THE_WATCH_ORDER,
    pushedEvent: "auto-continue-watch-requested",
    observed
  });
}
function pushedWithRunProgress(stop, push) {
  const heads = branchHeadsOf(stop.projectDir);
  const pushed = pushedOrDegraded(stop, heads, push);
  if (heads.kind === "read") return pushed;
  const unreadHeads = gateEvent("auto-continue-heads-unreadable", stop.sessionId, heads.cause);
  return { ...pushed, events: [unreadHeads, ...pushed.events] };
}
function pushedOrDegraded(stop, heads, push) {
  try {
    return pushUnlessCapped({
      position: positionOf(stop),
      progress: runProgress(snapshotOf(stop, heads)),
      turnAlreadyContinued: stop.envelope.stopHookActive,
      ...push
    });
  } catch (cause) {
    if (cause instanceof StateFileUnreadableError) return degraded(stop.sessionId, causeOf(cause));
    throw cause;
  }
}
function readDelegations(stop) {
  try {
    adoptUnregistered(stop.envelope);
    flagEndedWithoutNotice(stop.envelope);
    const resolution = resolveInFlight(stop.envelope);
    const watchdogLive = needsWatchdog(resolution) && watchdogAlive(stateFileFor(stop.projectDir), stop.sessionId);
    return { kind: "read", resolution, watchdogLive };
  } catch (cause) {
    return { kind: "unreadable", cause: causeOf(cause) };
  }
}
function needsWatchdog(resolution) {
  const { agentIds, endedWithoutNotice, unreadable } = resolution;
  return agentIds.length > 0 || endedWithoutNotice.length > 0 || unreadable.length > 0;
}
function observedDelegations(backgroundTasks, resolution) {
  const unfiltered = backgroundTasks.kind === "object" ? " subagent_filter=none" : "";
  const inFlight = `background_tasks=${backgroundTasks.kind}${unfiltered} in_flight=${resolution.agentIds.length}`;
  const ended = resolution.endedWithoutNotice.length;
  return ended === 0 ? inFlight : `${inFlight} ended_without_notice=${ended}`;
}
var START_THE_WATCH = '"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch';
var START_THE_WATCH_ORDER = `oso-code: this unattended run ended its turn with delegations still in flight or ended without notice, and no watchdog running for this session. Start one as a BACKGROUND Bash task (run_in_background: true): ${START_THE_WATCH} \u2014 then end the turn. The watch's exit wakes the run: it exits when every delegation has ended, or when one is stuck, long-running, unreadable or ended without notice, naming it. Do NOT relaunch a delegation still in flight.`;
var FLOW_KEYS = ["active_slice", "verify_green", "auto"];
function snapshotOf(stop, heads) {
  return {
    heads: heads.kind === "read" ? heads.digest : "",
    flow: flowRecordsIn(stop.content),
    completedAgents: String(completedAgentCount(stateFileFor(stop.projectDir), stop.sessionId)),
    completed: completedIn(stop.envelope.backgroundTasks).filter(isNameToken)
  };
}
function snapshotIn(tally) {
  return {
    heads: stateValue(tally, "heads"),
    flow: flowRecordsIn(tally),
    completedAgents: stateValue(tally, "completed_agents"),
    completed: stateRecords(tally, "completed")
  };
}
function runProgress(current) {
  return {
    since: (tally) => progressedBetween(snapshotIn(tally), current) ? PROGRESSED : UNCHANGED,
    recorded: () => serializedSnapshot(current)
  };
}
function progressedBetween(previous, current) {
  return headsMoved(previous.heads, current.heads) || previous.flow.join("\n") !== current.flow.join("\n") || isCount(previous.completedAgents) && Number(current.completedAgents) > Number(previous.completedAgents) || current.completed.some((agentId) => !previous.completed.includes(agentId));
}
function headsMoved(previous, current) {
  return previous !== "" && current !== "" && previous !== current;
}
function serializedSnapshot(snapshot) {
  return [
    `heads=${snapshot.heads}`,
    ...snapshot.flow,
    `completed_agents=${snapshot.completedAgents}`,
    ...snapshot.completed.map((agentId) => `completed=${agentId}`)
  ].map((line) => `${line}
`).join("");
}
function flowRecordsIn(content) {
  return FLOW_KEYS.flatMap((key) => stateRecords(content, key).map((value) => `${key}=${value}`));
}
function completedIn(backgroundTasks) {
  return backgroundTasks.kind === "object" ? backgroundTasks.completed : [];
}
function activeIn(backgroundTasks) {
  return backgroundTasks.kind === "object" ? backgroundTasks.active : [];
}
function branchHeadsOf(projectDir) {
  const listed = spawnSync("git", ["-C", projectDir, "for-each-ref", "refs/heads"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (listed.error !== void 0) {
    return { kind: "unreadable", cause: `git for-each-ref refs/heads could not run: ${causeOf(listed.error)}` };
  }
  if (listed.status !== 0) {
    const exit = listed.status ?? listed.signal;
    return { kind: "unreadable", cause: `git for-each-ref refs/heads exited ${exit}: ${listed.stderr.trim()}` };
  }
  return { kind: "read", digest: sha256Hex(listed.stdout) };
}
function pushUnlessCapped(request) {
  const { position, progress } = request;
  const counted = pushesWithoutProgress(position, progress, request.turnAlreadyContinued);
  if (typeof counted !== "number") return counted;
  if (counted > PUSHES_WITHOUT_PROGRESS_CAP) {
    const announced = counted === PUSHES_WITHOUT_PROGRESS_CAP + 1 ? announceCap(position) : [];
    const failure2 = rememberTally(position, counted, progress);
    const trailing = failure2 === void 0 ? [] : [degradedEvent(position.sessionId, failure2)];
    return { verdict: { kind: "allow" }, events: [...announced, ...trailing] };
  }
  const failure = rememberTally(position, counted, progress);
  if (failure !== void 0) return degraded(position.sessionId, failure);
  return {
    verdict: { kind: "push", reason: request.order },
    events: [gateEvent(request.pushedEvent, position.sessionId, request.observed)]
  };
}
function pushesWithoutProgress(position, progress, turnAlreadyContinued) {
  const started = turnAlreadyContinued ? 1 : 0;
  const read = readStateFile(position.tallyFile);
  if (read.kind === "absent") return started + 1;
  if (read.kind !== "ok") return degraded(position.sessionId, "the push tally is not a readable file");
  const remembered = stateValue(read.content, "pushes");
  if (!isCount(remembered)) {
    return degraded(position.sessionId, `the push tally holds no count of pushes: ${remembered}`);
  }
  const reading = progress.since(read.content);
  if (reading.kind === "unreadable") return degraded(position.sessionId, reading.cause);
  return (reading.kind === "progressed" ? 0 : Number(remembered)) + 1;
}
function announceCap(position) {
  try {
    appendJournal(position.journalFile, CAP_MILESTONE);
    return [];
  } catch (cause) {
    return [gateEvent("auto-continue-unjournaled", position.sessionId, causeOf(cause))];
  }
}
function rememberTally(position, pushes, progress) {
  try {
    mkdirSync4(path7.dirname(position.tallyFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    writeFileSync2(position.tallyFile, `pushes=${pushes}
${progress.recorded()}`, { mode: OWNER_ONLY_FILE });
    return void 0;
  } catch (cause) {
    return causeOf(cause);
  }
}
function positionOf(stop) {
  const journalFile = journalFileFor(stop.projectDir);
  return {
    projectDir: stop.projectDir,
    sessionId: stop.sessionId,
    journalFile,
    tallyFile: tallyFileFor(journalFile)
  };
}
function allowedWith(event) {
  return { verdict: { kind: "allow" }, events: [event] };
}
function degraded(sessionId, cause) {
  return allowedWith(degradedEvent(sessionId, cause));
}
function degradedEvent(sessionId, cause) {
  return gateEvent("auto-continue-degraded", sessionId, cause);
}
function gateEvent(event, session, detail) {
  const route = gateRow("autocontinue");
  return { event, session, command: detail, gate: route.script, hookEvent: route.event };
}
function tallyFileFor(journalFile) {
  return path7.join(path7.dirname(journalFile), `${path7.basename(journalFile, ".log")}.pushes`);
}

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
function lineVerdict(commandLine, judge2) {
  let verdict = "clear";
  let tokens = [];
  let stdin = "";
  for (const record of lexShellCommands(commandLine)) {
    switch (record.kind) {
      case "unreadPayload":
        if (verdict === "clear") verdict = "unread";
        break;
      case "commandWord":
        verdict = judge2({ tokens, stdin }, verdict);
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
  return judge2({ tokens, stdin }, verdict);
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
function commitGateArmedFor(stateContent, session) {
  return holdsMode(stateContent) && foreignOwner(stateContent, session) === void 0;
}
function judgeCommit({ envelope }) {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("commit", stateFile, session);
  if (!commitGateArmedFor(state.content, session)) return ALLOWED;
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
  if (!planAwaitsItsSlice(state.content, session)) return ALLOWED;
  return denied({
    gate: "edits",
    message: `oso-code: plan mode is active but no slice is active. Activate it first (${sliceArmingRemedy(session)}), then retry the edit.`,
    event: "edit-denied",
    session,
    detail: envelope.filePath
  });
}
function planAwaitsItsSlice(stateContent, session) {
  if (foreignOwner(stateContent, session) !== void 0) return false;
  return stateSays(stateContent, "mode", "plan") && !aSliceIsActive(stateContent);
}
function sliceArmingRemedy(session) {
  return osoStateRemedy(session, "set active_slice=<n>");
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
  const named = POSIX_CLASS_NAME.exec(pattern.slice(from));
  if (named === null) return GREP_ITSELF_REJECTS_IT;
  const members = POSIX_CLASS_MEMBERS[named[1]];
  if (members === void 0) return GREP_ITSELF_REJECTS_IT;
  const after = from + named[0].length;
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
  const content = readFileIfPresent(denyPatternsFileFor(stateFile), "skip");
  if (content === void 0) return { kind: "noPatternBites" };
  const readings = content.split("\n").filter((pattern) => pattern !== "").map((pattern) => ({ pattern, reading: ereReads(pattern, command) }));
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
  const content = readFileIfPresent(stateFile, "skip");
  if (content === void 0) return void 0;
  if (stateValue(content, "session") !== sessionId) return void 0;
  return stateValue(content, "auto");
}
function sliceIsArmed(stateFile) {
  const content = readFileIfPresent(stateFile, "skip");
  if (content === void 0) return false;
  if (stateValue(content, "mode") !== "plan") return false;
  const activeSlice = stateValue(content, "active_slice");
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
import path8 from "node:path";
var ROADMAP_DISARMED_SENTINEL = "none";
var ROADMAP_PLACEHOLDER = "{roadmap}";
var STALE_GATE = {
  gate: "stale",
  errorSubject: "the stale-state gate",
  judge: judgeStale
};
function judgeStale({ envelope }) {
  if (!isDirectory(stateRootDirectory())) return ALLOWED;
  const stateFile = stateFileFor(envelope.cwd);
  const advisories = advisoriesFor(envelope, stateFile);
  removeLegacyWaitMarks(stateFile);
  if (advisories.length === 0) return ALLOWED;
  return { verdict: { kind: "context", additionalContext: advisories.join(" ") }, events: [] };
}
function advisoriesFor(envelope, stateFile) {
  const read = readStateFile(stateFile);
  if (read.kind === "absent") return [];
  const content = read.kind === "ok" ? read.content : void 0;
  return staleStateAdvisory(envelope.caller, stateFile, content, hookSessionId(envelope));
}
function staleStateAdvisory(caller, stateFile, content, sessionId) {
  if (content === void 0) return [staleStateContext(caller, stateFile, "", sessionId)];
  if (stateValue(content, "session") === sessionId) return [];
  if (!holdsMode(content) && stateValue(content, "auto") !== RUN_ARMED) return [];
  return [staleStateContext(caller, stateFile, content, sessionId)];
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
var SKILL_PREFIXES = { claude: "/oso-code:", opencode: "/oso-" };
function skillPrefixFor(host) {
  return SKILL_PREFIXES[host];
}
function stateBinPath(caller) {
  if (caller.stateBin !== "") return caller.stateBin;
  return path8.join(pluginRootDirectory(), "bin", "oso-state");
}
function quoted(value) {
  return `"${value}"`;
}

// core/src/gates/statebin.ts
import { appendFileSync as appendFileSync4 } from "node:fs";
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
  appendFileSync4(envFile, `export OSO_STATE_BIN=${stateBin}
`);
  return NO_VERDICT;
}

// core/src/gates/teardown.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync2, readdirSync as readdirSync2, renameSync as renameSync2, rmSync as rmSync4, rmdirSync, statSync as statSync2 } from "node:fs";
import path10 from "node:path";
var ABANDONED_STATE_DAYS = 7;
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
  removeLegacyWaitMarks(stateFileFor(envelope.cwd));
  dropInFlightRegistriesOf(sessionId);
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
function dropInFlightRegistriesOf(sessionId) {
  if (sessionId === "") return;
  for (const repository of entriesOfDirectory(runsRootDirectory())) {
    rmSync4(sessionRunDirectoryOf(repository, sessionId), { recursive: true, force: true });
  }
}
function dropStateFile(stateFile) {
  if (stateFile === void 0) return;
  rmSync4(stateFile, { force: true });
  rmSync4(`${stateFile}.lock`, { recursive: true, force: true });
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
  renameSync2(eventsLog, `${eventsLog}.1`);
}
function pruneAbandonedState(sessionId, ownState) {
  if (sessionId === "") return;
  for (const stateFile of stateFilesSorted()) {
    if (stateFile === ownState) continue;
    if (existsSync2(`${stateFile}.lock`)) continue;
    if (!olderThanDays(stateFile, ABANDONED_STATE_DAYS)) continue;
    const abandonedId = sanitizeSession(stateValueOf(stateFile, "session"));
    removeWorktreesOf(abandonedId, stateFile);
    rmSync4(stateFile, { force: true });
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
  return directoryEntries(stateRootDirectory()).filter((name) => name.endsWith(".state")).sort().map((name) => path10.join(stateRootDirectory(), name)).filter((target) => isFile(target));
}
function subdirectoriesSorted(directory) {
  return directoryEntries(directory).sort().map((name) => path10.join(directory, name)).filter((target) => isDirectory(target));
}
function directoryEntries(directory) {
  try {
    return readdirSync2(directory);
  } catch {
    return [];
  }
}
function isFile(target) {
  const stats = statSync2(target, { throwIfNoEntry: false });
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
import path13 from "node:path";

// core/src/install/opencode.ts
import path11 from "node:path";

// core/src/install/backup.ts
var DISK_BLOCK_SIZE_BYTES = 512;
var BYTES_PER_KIB = 1024;
var DISK_BLOCKS_PER_KIB = BYTES_PER_KIB / DISK_BLOCK_SIZE_BYTES;

// core/src/install/json.ts
import { readFileSync as readFileSync2 } from "node:fs";
var JsonParseError = class extends Error {
  file;
  constructor(file, cause) {
    super(`cannot parse JSON at ${file}`, { cause });
    this.name = "JsonParseError";
    this.file = file;
  }
};
function readJsonFile(file) {
  if (!isReadableRegularFile(file)) return void 0;
  try {
    return JSON.parse(readFileSync2(file, "utf8"));
  } catch (cause) {
    throw new JsonParseError(file, cause);
  }
}

// core/src/install/opencode-config.ts
var EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH = [
  { pattern: "*", verdict: "allow" },
  { pattern: ".config/opencode/**", verdict: "deny" },
  { pattern: "**/.config/opencode/**", verdict: "deny" },
  { pattern: ".opencode/**", verdict: "deny" },
  { pattern: "**/.opencode/**", verdict: "deny" },
  { pattern: ".git/**", verdict: "deny" },
  { pattern: "**/.git/**", verdict: "deny" },
  { pattern: ".local/state/oso-code/**", verdict: "deny" },
  { pattern: "**/.local/state/oso-code/**", verdict: "deny" }
];
var EDIT_CONTROL_BOUNDING_A_REACH = `edit denied on ${EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter(
  (rule) => rule.verdict === "deny"
).map((rule) => rule.pattern).join(" ")}`;
var PATH_SEPARATOR = "/";
var SURFACE_AT_ANY_DEPTH_PREFIX = "**/";
var OPENCODE_AGENTS_PER_PROFILE_ROLE = {
  applier: ["oso-applier"],
  verifier: [VERIFIER_AGENT],
  judges: ["oso-debt-sweep", "oso-doubt-pass", "oso-security-reviewer", "oso-triage"]
};
var OPENCODE_AGENTS_THE_PROFILE_DRIVES = Object.values(OPENCODE_AGENTS_PER_PROFILE_ROLE).flat();
var SURFACES_THE_EDIT_CONTROL_DENIES = [
  ...new Set(
    EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter((rule) => rule.verdict === "deny").map(
      (rule) => literalHeadOf(withoutAnyDepthPrefix(rule.pattern))
    )
  )
];
function withoutAnyDepthPrefix(named) {
  return named.startsWith(SURFACE_AT_ANY_DEPTH_PREFIX) ? named.slice(SURFACE_AT_ANY_DEPTH_PREFIX.length) : named;
}
function literalHeadOf(pattern) {
  const wildcard = pattern.indexOf("*");
  const head = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
  return head.endsWith(PATH_SEPARATOR) ? head.slice(0, -PATH_SEPARATOR.length) : head;
}

// core/src/install/report.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// core/src/install/opencode.ts
function opencodePathsFor(homeDirectory2, environment) {
  const configHome = path11.join(environment["XDG_CONFIG_HOME"] ?? path11.join(homeDirectory2, ".config"), "opencode");
  const stateRoot = path11.join(homeDirectory2, ".local", "state", "oso-code");
  return {
    homeDirectory: homeDirectory2,
    configHome,
    configFile: path11.join(configHome, "opencode.json"),
    globalFile: path11.join(configHome, "AGENTS.md"),
    stateRoot,
    backupsRoot: stateRoot
  };
}

// core/src/install/opencode-install-layout.ts
import path12 from "node:path";
function openCodeInstallTargets(paths) {
  return {
    skills: path12.join(paths.configHome, "skill"),
    agents: path12.join(paths.configHome, "agent"),
    commands: path12.join(paths.configHome, "command"),
    plugin: path12.join(paths.configHome, "plugin"),
    hooks: path12.join(paths.configHome, "hooks"),
    gitHooks: path12.join(paths.configHome, "git-hooks"),
    stateBin: path12.join(paths.configHome, "bin"),
    dist: path12.join(paths.configHome, "dist"),
    engramPlugin: path12.join(paths.configHome, "plugins", "engram.ts"),
    impeccableMount: path12.join(paths.homeDirectory, ".agents", "skills", "impeccable"),
    impeccableOptOut: path12.join(paths.stateRoot, "impeccable-opt-out"),
    ownerRegistry: path12.join(paths.stateRoot, "opencode-install-registry"),
    restoreExercisedMarker: path12.join(paths.stateRoot, ".install-restore-verified-opencode"),
    planArtifactRoot: path12.join(paths.stateRoot, "plans"),
    installRecord: path12.join(paths.configHome, "oso-code-install.json")
  };
}
function isOpenCodeInstallRecord(parsed) {
  const candidate = parsed;
  if (typeof candidate?.version !== "string" || !Array.isArray(candidate.manifest)) return false;
  return candidate.manifest.every((row) => typeof row?.digest === "string" && typeof row.file === "string");
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
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();
  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("unknown", stateFile, session);
  const toolName = envelope.toolName;
  if (RELEASE_SHAPED_TOOL.test(toolName)) return deniedAsRelease(toolName, session);
  const harnessTarget = harnessTreeTargetOf(envelope);
  if (harnessTarget !== void 0) return deniedAsHarnessWrite(toolName, harnessTarget, session);
  if (!planAwaitsItsSlice(state.content, session)) return ALLOWED;
  if (TOOL_NAME.test(toolName) && allowlistCarries(configured.allowlist, toolName)) return ALLOWED;
  return deniedUntilASliceIsArmed(toolName, session);
}
var RELEASE_SHAPED_TOOL = /(deploy|publish|release)/i;
function deniedAsRelease(toolName, session) {
  return denied({
    gate: "unknown",
    message: `oso-code: tool '${toolName}' is shaped like a deploy, publish or release, and this repository carries oso-code run state, so no agent may run it. Run it from your own terminal instead.`,
    event: "release-tool-denied",
    session,
    detail: toolName
  });
}
function deniedAsHarnessWrite(toolName, target, session) {
  return denied({
    gate: "unknown",
    message: `oso-code: '${toolName}' would write ${target}, inside the installed oso-code harness tree, which no agent may change. Change the repository's own copy and reinstall instead.`,
    event: "harness-write-denied",
    session,
    detail: target
  });
}
function deniedUntilASliceIsArmed(toolName, session) {
  return denied({
    gate: "unknown",
    message: `oso-code: plan mode is active but no slice is active, and tool '${toolName === "" ? "<missing>" : toolName}' is not one of the harness's known tools. Before a slice is armed the known tools pass and an unknown tool is refused, as an edit would be. Activate it first (${sliceArmingRemedy(session)}), then retry the call.`,
    event: "unknown-tool-denied",
    session,
    detail: toolName
  });
}
function harnessTreeTargetOf(envelope) {
  const targets = writeTargetsOf(envelope).map((target) => path13.resolve(envelope.cwd, target));
  if (targets.length === 0) return void 0;
  const harnessTree = installedHarnessTree();
  return targets.find((target) => harnessTree.some((directory) => liesWithin(directory, target)));
}
var PATCH_TARGET_MARKER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
function writeTargetsOf({ toolName, filePath, patchText }) {
  if (toolName === "edit" || toolName === "write") return filePath === "" ? [] : [filePath];
  if (toolName === "apply_patch") return [...patchText.matchAll(PATCH_TARGET_MARKER)].map((marker) => (marker[1] ?? "").trim());
  return [];
}
function installedHarnessTree() {
  const paths = opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env);
  const targets = openCodeInstallTargets(paths);
  return [targets.skills, targets.agents, targets.commands, targets.plugin, targets.hooks, paths.stateRoot];
}
function liesWithin(directory, target) {
  const relative = path13.relative(directory, target);
  const escapes = relative === ".." || relative.startsWith(`..${path13.sep}`) || path13.isAbsolute(relative);
  return !escapes;
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
import path17 from "node:path";

// core/src/install/opencode-host.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { mkdtempSync, rmSync as rmSync5 } from "node:fs";
import { tmpdir } from "node:os";
import path15 from "node:path";

// core/src/install/verify-claude.ts
import path14 from "node:path";
function compareVersionsAscending(a, b) {
  const segmentsOf = (value) => value.split(/(\d+)/).filter((segment) => segment !== "");
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index] ?? "";
    const rightSegment = right[index] ?? "";
    const bothNumeric = /^\d+$/.test(leftSegment) && /^\d+$/.test(rightSegment);
    const compared = bothNumeric ? Number(leftSegment) - Number(rightSegment) : leftSegment.localeCompare(rightSegment);
    if (compared !== 0) return compared;
  }
  return 0;
}
function collapsedNewlines(text) {
  return text.replace(/\n+$/, "").replace(/\n/g, " ");
}
function firstExecutableOnPath(environment, binaryName) {
  const entries = (environment["PATH"] ?? "").split(path14.delimiter).filter((entry) => entry !== "");
  for (const entry of entries) {
    const candidate = path14.join(entry, binaryName);
    if (isExecutableRegularFile(candidate)) return candidate;
  }
  return void 0;
}
var POSIX_KERNEL_EXECUTABLE_MAGICS = ["\x7FELF", "#!", "\xCF\xFA\xED\xFE", "\xCE\xFA\xED\xFE", "\xCA\xFE\xBA\xBE"];
var WIN32_KERNEL_EXECUTABLE_MAGICS = ["MZ"];
var WIDEST_EXECUTABLE_MAGIC_BYTES = Math.max(
  ...[...POSIX_KERNEL_EXECUTABLE_MAGICS, ...WIN32_KERNEL_EXECUTABLE_MAGICS].map((magic) => magic.length)
);

// core/src/install/version-line.ts
function versionLineReadingOf(rawOutput, versionLine) {
  const lines = rawOutput.split("\n").filter((line) => line.trim() !== "");
  const matchingLines = lines.filter((line) => versionLine.test(line));
  if (matchingLines.length === 0) return { kind: "unmatched", raw: rawOutput };
  if (matchingLines.length > 1) return { kind: "ambiguous", matches: matchingLines };
  const matchedLine = matchingLines[0] ?? "";
  const captured = versionLine.exec(matchedLine)?.[1];
  return { kind: "matched", version: captured ?? matchedLine, discarded: lines.filter((line) => line !== matchedLine) };
}
function versionOutcomeOf(reading, versionLineShape) {
  if (reading.kind === "matched") {
    return { version: reading.version, note: reading.discarded.length === 0 ? void 0 : extraLinesNote(reading.discarded) };
  }
  if (reading.kind === "unmatched") return { version: void 0, note: unmatchedNote(versionLineShape, reading.raw) };
  return { version: void 0, note: ambiguousNote(versionLineShape, reading.matches) };
}
function extraLinesNote(discarded) {
  const first = discarded[0] ?? "";
  const plural = discarded.length === 1 ? "line" : "lines";
  return `the probe printed ${discarded.length} extra ${plural} beyond the version; first: ${collapsedNewlines(first)}`;
}
function unmatchedNote(versionLineShape, raw) {
  return `the probe printed no line shaped like ${versionLineShape}; raw output: ${collapsedNewlines(raw)}`;
}
function ambiguousNote(versionLineShape, matches) {
  return `the probe printed ${matches.length} lines shaped like ${versionLineShape} (ambiguous): ${collapsedNewlines(matches.join("\n"))}`;
}

// core/src/install/opencode-host.ts
var OPENCODE_BINARY_NAME = "opencode";
var OPENCODE_VERSION_LINE_SHAPE = "a bare dotted version";
var PROBE_HOME_PREFIX = "oso-opencode-probe.";
var PROBE_TIMEOUT_MILLISECONDS = 1e4;
var ANSI_SELECT_GRAPHIC_RENDITION = /\u001b\[[0-9;]*m/g;
var POSIX_SPACE_CLASS = /[ \t\n\v\f\r]/g;
var OPENCODE_VERSION_LINE = /^(\d+(?:\.\d+)*)$/;
function openCodeHostProbes(environment) {
  const binaryPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  if (binaryPath === void 0) return { version: void 0 };
  const outcome = versionOutcomeOf(probedVersion(environment, binaryPath), OPENCODE_VERSION_LINE_SHAPE);
  return outcome.note === void 0 ? { version: outcome.version } : { version: outcome.version, versionNote: outcome.note };
}
function versionFieldOf(probeOutput) {
  const strippedPerLine = probeOutput.replace(ANSI_SELECT_GRAPHIC_RENDITION, "").split("\n").map((line) => line.replace(POSIX_SPACE_CLASS, "")).join("\n");
  return versionLineReadingOf(strippedPerLine, OPENCODE_VERSION_LINE);
}
function probedVersion(environment, binaryPath) {
  const probeHome = mkdtempSync(path15.join(environment["TMPDIR"] ?? tmpdir(), PROBE_HOME_PREFIX));
  try {
    const run = spawnSync2(binaryPath, ["--version"], {
      env: probeEnvironment(environment, probeHome),
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MILLISECONDS
    });
    return versionFieldOf(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  } finally {
    rmSync5(probeHome, { recursive: true, force: true });
  }
}
function probeEnvironment(environment, probeHome) {
  return {
    ...environment,
    HOME: probeHome,
    USERPROFILE: probeHome,
    TMPDIR: probeHome,
    XDG_CONFIG_HOME: path15.join(probeHome, ".config"),
    XDG_STATE_HOME: path15.join(probeHome, ".local", "state"),
    XDG_CACHE_HOME: path15.join(probeHome, ".cache"),
    XDG_DATA_HOME: path15.join(probeHome, ".local", "share")
  };
}

// core/src/install/opencode-trust.ts
import path16 from "node:path";

// core/src/install/trust.ts
import { readFileSync as readFileSync3 } from "node:fs";
var SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
var RAW_INSTALLED_BYTES = (_relative, target) => readFileSync3(target);
function trustRowDivergences(rows, resolveTarget, bytesOf = RAW_INSTALLED_BYTES) {
  return rows.flatMap((row) => divergenceOf(row, resolveTarget, bytesOf));
}
function divergenceOf(row, resolveTarget, bytesOf) {
  if (!SHA256_HEX_PATTERN.test(row.digest)) return [{ file: row.file, state: { kind: "malformed-published-hash" } }];
  const target = resolveTarget(row.file);
  if (target === void 0) return [{ file: row.file, state: { kind: "outside-the-trust-set" } }];
  if (!isReadableRegularFile(target)) return [{ file: row.file, state: { kind: "missing" } }];
  const actual = sha256Hex(bytesOf(row.file, target));
  return actual === row.digest ? [] : [{ file: row.file, state: { kind: "mismatch", actual } }];
}

// core/src/install/opencode-trust.ts
var INSTALLED_TREE_MAP = [
  { published: "opencode/dist/oso-code.js", installed: "plugin/oso-code.js" },
  { published: "plugin/dist/", installed: "dist/" },
  { published: "plugin/git-hooks/", installed: "git-hooks/" },
  { published: "plugin/bin/", installed: "bin/" }
];
function openCodeTrustTargetUnder(rootKind, root, published) {
  if (rootKind === "source") return path16.join(root, ...published.split("/"));
  const mapped = INSTALLED_TREE_MAP.find((row) => row.published === published || row.published.endsWith("/") && published.startsWith(row.published));
  if (mapped === void 0) return void 0;
  const relative = mapped.published.endsWith("/") ? `${mapped.installed}${published.slice(mapped.published.length)}` : mapped.installed;
  return path16.join(root, ...relative.split("/"));
}

// core/src/install/pins.ts
var SUPPORTED_OPENCODE_VERSION = "1.18.22";
var DOTTED_NUMERIC_VERSION = /^\d+(\.\d+)*$/;
function meetsVersionFloor(found, floor) {
  if (found === void 0 || !DOTTED_NUMERIC_VERSION.test(found)) return false;
  return compareVersionsAscending(found, floor) >= 0;
}

// core/src/gates/opencode-drift.ts
var REINSTALL = "reinstall with `oso install --host opencode --yes` from the oso-code checkout";
var INTACT = { kind: "intact" };
function judgeOpenCodeDrift(envelope) {
  const paths = opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env);
  const reading = installRecordReading(openCodeInstallTargets(paths).installRecord);
  const checks = reading.kind === "unread" ? [unchecked("opencode-install-record-unread", reading.cause)] : [versionDrift(reading.record), trustedFileDrift(reading.record, paths.configHome), cliDrift()];
  return outcomeOf(checks, envelope.sessionId);
}
function installRecordReading(installRecord) {
  let parsed;
  try {
    parsed = readJsonFile(installRecord);
  } catch (error) {
    return { kind: "unread", cause: messageOf(error) };
  }
  if (parsed === void 0) return { kind: "unread", cause: `no install record at ${installRecord}` };
  if (!isOpenCodeInstallRecord(parsed)) return { kind: "unread", cause: `the install record at ${installRecord} holds no version and manifest rows` };
  return { kind: "read", record: parsed };
}
function versionDrift(record) {
  const running = "0.28.0";
  if (running === void 0 || running === "") return unchecked("opencode-build-version-unknown", "this plugin build embeds no harness version");
  if (running === record.version) return INTACT;
  return drifted(
    `oso-code: the installed OpenCode harness is version ${record.version} but the running plugin build is ${running} \u2014 tell the user once: ${REINSTALL}.`
  );
}
function trustedFileDrift(record, configHome) {
  const divergent = trustRowDivergences(record.manifest, (published) => openCodeTrustTargetUnder("installed", configHome, published));
  if (divergent.length === 0) return INTACT;
  return drifted(
    `oso-code: installed trusted file(s) no longer match the manifest they were installed from: ${divergent.map((divergence) => divergence.file).join(", ")} \u2014 tell the user once: run \`oso verify --host opencode\`, then ${REINSTALL}.`
  );
}
function cliDrift() {
  const probed = openCodeHostProbes(process.env);
  if (probed.version === void 0) return unchecked("opencode-cli-unprobed", probed.versionNote ?? "no opencode on PATH");
  if (meetsVersionFloor(probed.version, SUPPORTED_OPENCODE_VERSION)) return INTACT;
  return drifted(
    `oso-code: this session runs OpenCode ${probed.version}, older than the supported ${SUPPORTED_OPENCODE_VERSION} \u2014 tell the user once: upgrade opencode to ${SUPPORTED_OPENCODE_VERSION} or newer.`
  );
}
function outcomeOf(checks, session) {
  const advice = checks.flatMap((check) => check.kind === "drifted" ? [check.advice] : []);
  const events = checks.flatMap((check) => check.kind === "unchecked" ? [{ event: check.event, session, command: check.cause }] : []);
  if (advice.length === 0) return { verdict: { kind: "allow" }, events };
  return { verdict: { kind: "context", additionalContext: advice.join(" ") }, events };
}
function drifted(advice) {
  return { kind: "drifted", advice };
}
function unchecked(event, cause) {
  return { kind: "unchecked", event, cause };
}

// core/src/gates/version.ts
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
  if (envelope.caller.host === "opencode") return judgeOpenCodeDrift(envelope);
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
  return path17.join(pluginRootDirectory(), ".claude-plugin", "plugin.json");
}
function publishedReleaseCacheFile() {
  return path17.join(stateRootDirectory(), "published-release");
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
  const marketplacesFile = path17.join(home, ".claude", "plugins", "known_marketplaces.json");
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
      path17.dirname(cacheFile),
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
  return readFileIfPresent(target, "skip") ?? "";
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
  TEARDOWN_GATE,
  SUBAGENT_START_GATE,
  SUBAGENT_STOP_GATE
];
var STOP_GATES = [
  AUTOCONTINUE_GATE
];
function runGate(argv, envelope) {
  const [name, ...gateArguments] = argv;
  const request = { envelope, argv: gateArguments };
  const escalated = envelope.stopHookActive;
  if (name === PRE_TOOL_USE_ROUTE) return runPreToolUseGates(claudeGatesMatching(envelope.toolName), request);
  const run = routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ?? routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ?? routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ?? routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun);
  return run ?? gateErrorRun(`${THE_GATE_ENTRY_POINT} (unknown gate '${name ?? ""}')`);
}
function runPreToolUseGates(gates, request) {
  const runs = gates.map((gate) => runWith(gate, request, preToolUseRun, gateErrorRun));
  const decisive = runs.find((run) => run.verdict.kind === "deny") ?? runs.find((run) => run.verdict.kind === "gateError") ?? NOTHING_DENIED;
  return {
    ...decisive,
    stderr: runs.map((run) => run.stderr).join(""),
    events: runs.flatMap((run) => run.events)
  };
}
var NOTHING_DENIED = { ...UNSPOKEN, verdict: { kind: "allow" }, events: [] };
function claudeGatesMatching(toolName) {
  const matching = claudePreToolUseGatesFor(toolName);
  return PRE_TOOL_USE_GATES.filter((gate) => matching.includes(gate.gate));
}
function routed(gates, name, request, transport, onFailure) {
  const gate = gates.find((definition) => definition.gate === name);
  return gate === void 0 ? void 0 : runWith(gate, request, transport, onFailure);
}
function runWith(gate, request, transport, onFailure) {
  try {
    const outcome = gate.judge(request);
    const run = transport(outcome.verdict);
    return { ...run, stderr: run.stderr + (outcome.stderr ?? ""), verdict: outcome.verdict, events: outcome.events };
  } catch (cause) {
    return onFailure(gate.errorSubject, cause);
  }
}
function gateErrorRun(subject, cause) {
  const verdict = { kind: "gateError", subject };
  const run = preToolUseRun(verdict);
  return { ...run, stderr: run.stderr + explainedCause(cause), verdict, events: [] };
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

// core/src/prose/applier-proof.ts
var APPLIER_PROOF_HEADER = "=== applier_proof ===";

// core/src/routes/render.ts
var OPENCODE_HOOKS = [
  "tool.execute.before",
  "experimental.chat.system.transform",
  "event",
  "dispose"
];
function openCodeRoutes() {
  return GATE_ROWS.filter((row) => row.wiring.opencode === "wired").map((row) => {
    const matcher = matcherFor("opencode", row);
    return {
      hook: openCodeHookNamed(row.mechanism.opencode, row.gate),
      gate: row.gate,
      matcher: matcher === "" ? matcher : wholeToolName(matcher),
      allow: row.gate === "unknown" ? toolNamesFor("opencode", "unknown") : []
    };
  });
}
function openCodeHookNamed(mechanism, gate) {
  const hook = OPENCODE_HOOKS.find((candidate) => candidate === mechanism);
  if (hook === void 0) throw new Error(`gate ${gate} names no OpenCode hook the adapter routes: ${mechanism}`);
  return hook;
}

// core/src/state/plan.ts
import { chmodSync, existsSync as existsSync3, mkdirSync as mkdirSync5, readFileSync as readFileSync4, renameSync as renameSync3, rmSync as rmSync6 } from "node:fs";
import path18 from "node:path";

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
  const root = path18.join(stateRootDirectory(), "plans");
  const dir = path18.join(root, repositoryIdFor(stateFile));
  return {
    root,
    dir,
    presentedFile: path18.join(dir, `presented-${digest}.md`),
    approvedFile: path18.join(dir, `approved-${digest}.md`),
    currentFile: path18.join(dir, "current.md")
  };
}
function ensurePlanDirectory(paths) {
  requireNonSymlinkDirectory(stateRootDirectory(), "state root");
  requireNonSymlinkDirectory(paths.root, "plan root");
  requireNonSymlinkDirectory(paths.dir, "repository plan directory", "repository plan path");
  chmodSync(paths.root, 448);
  chmodSync(paths.dir, 448);
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
  const uncheckedSlice = firstSliceNamingNoCheck(document);
  if (uncheckedSlice !== void 0) {
    throw new PlanFailure(
      `capture-plan requires slice ${uncheckedSlice} to name ${VERIFY_CHECK_TOKENS.join(" or ")} on its Verify line`
    );
  }
  return withLock(stateFile, sessionId, () => {
    refuseGateWritesByAForeignSession(stateFile, sessionId);
    if (existsSync3(paths.presentedFile)) {
      if (!isPrivateRegularFile(paths.presentedFile)) {
        throw new PlanFailure("presented snapshot is not a private regular file");
      }
      if (readFileSync4(paths.presentedFile, "utf8") !== document) {
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
        rmSync6(paths.presentedFile, { force: true });
      } else {
        renameSync3(paths.presentedFile, paths.approvedFile);
      }
    } else if (!isPrivateRegularFile(paths.approvedFile)) {
      throw new PlanFailure("presented plan snapshot is missing");
    }
    writeStatePairs(stateFile, ["plan_approval=approved", `plan_snapshot_file=${paths.approvedFile}`], sessionId);
    logEvent({ event: "plan-approval-approved", session: sessionId });
    return 0;
  });
}
function runCancelApprovedPlan(cwd, sessionId, digest) {
  const stateFile = stateFileFor(cwd);
  mkdirSync5(stateRootDirectory(), { recursive: true });
  return withLock(stateFile, sessionId, () => {
    if (!isReadableRegularFile(stateFile)) {
      throw new PlanApprovalError(`no readable approved plan for session ${sessionId}`);
    }
    if (readValue(stateFile, "plan_approval") !== "approved") {
      throw new PlanApprovalError("plan approval is not approved");
    }
    if (readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanApprovalError("the approved plan belongs to another session");
    }
    if (readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("approved plan digest changed before abandonment");
    }
    refuseGateWritesByAForeignSession(stateFile, sessionId);
    const disarming = armPlan();
    writeStatePairs(
      stateFile,
      [
        `mode=${disarming.mode}`,
        `active_slice=${disarming.active_slice}`,
        `verify_green=${disarming.verify_green}`,
        "plan_approval=cancelled"
      ],
      sessionId
    );
    logEvent({ event: "plan-approval-abandoned", session: sessionId, command: digest });
    return 0;
  });
}
function byteIdentical(leftFile, rightFile) {
  return readFileSync4(leftFile).equals(readFileSync4(rightFile));
}
var VERIFY_CHECK_TOKENS = ["failing-check:", "Verify-exception:"];
var THE_FIELD_ONLY_A_SLICE_BLOCK_CARRIES = "Depends-on";
var MARKDOWN_LIST_OR_HEADING = /^[\s>]*(?:#{1,6}\s+)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?/;
var MARKDOWN_EMPHASIS = /^[*_]{1,3}/;
var SLICE_LABEL = /^(S\d+|Slice\s+\d+)(?:\s+[A-Z]{2,})*(?:\s*\([^)]*\))?\s*[—–:-]/;
var MARKDOWN_HEADING = /^[\s>]*(#{1,6})\s+/;
function firstSliceNamingNoCheck(document) {
  return sliceBlocksIn(document).find(({ text }) => !namesAVerifyCheck(text))?.label;
}
function sliceBlocksIn(document) {
  const opened = [];
  let current;
  let currentHeadingLevel;
  for (const line of document.split("\n")) {
    const label = sliceLabelOpening(line);
    if (label !== void 0) {
      const headingLevel2 = headingLevelOf(line);
      current = {
        label,
        boundaryLevel: headingLevel2 ?? currentHeadingLevel ?? 6,
        lines: [line]
      };
      opened.push(current);
      if (headingLevel2 !== void 0) currentHeadingLevel = headingLevel2;
      continue;
    }
    const headingLevel = headingLevelOf(line);
    if (current !== void 0 && headingLevel !== void 0 && headingLevel <= current.boundaryLevel) current = void 0;
    current?.lines.push(line);
    if (headingLevel !== void 0) currentHeadingLevel = headingLevel;
  }
  return opened.map(({ label, lines }) => ({ label, text: lines.join("\n") })).filter(({ text }) => text.includes(THE_FIELD_ONLY_A_SLICE_BLOCK_CARRIES));
}
function headingLevelOf(line) {
  const heading = MARKDOWN_HEADING.exec(line);
  return heading === null ? void 0 : heading[1]?.length;
}
function sliceLabelOpening(line) {
  const undecorated = line.replace(MARKDOWN_LIST_OR_HEADING, "").replace(MARKDOWN_EMPHASIS, "");
  return SLICE_LABEL.exec(undecorated)?.[1];
}
function namesAVerifyCheck(blockText) {
  const lowered = blockText.toLowerCase();
  return VERIFY_CHECK_TOKENS.some((token) => lowered.includes(token.toLowerCase()));
}

// opencode/plugin/oso/identity.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync4, readFileSync as readFileSync5, statSync as statSync3 } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
function deriveRootId(cwd) {
  const meta = findGitMetadata(cwd);
  return meta === null ? "" : hashId(meta.commonDir);
}
function commonDirOf(cwd) {
  const meta = findGitMetadata(cwd);
  return meta === null ? "" : meta.commonDir;
}
function roleOf(cwd) {
  const meta = findGitMetadata(cwd);
  if (meta === null) {
    return "none";
  }
  return meta.isWorktree ? "child" : "root";
}
function publishIdentity(cwd) {
  return { OSO_AGENT: deriveRootId(cwd) };
}
function findGitMetadata(cwd) {
  let dir = resolve(cwd);
  for (; ; ) {
    const dotGit = join(dir, ".git");
    if (existsSync4(dotGit)) {
      let isDir = false;
      try {
        isDir = statSync3(dotGit).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir) {
        if (isRealGitDir(dotGit)) {
          return { commonDir: dotGit, isWorktree: false };
        }
      } else {
        const gitDir = worktreeGitDir(dotGit, dir);
        if (gitDir !== null) {
          return { commonDir: stripWorktreesSuffix(gitDir), isWorktree: true };
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
function isRealGitDir(dotGit) {
  return existsSync4(join(dotGit, "HEAD")) && existsSync4(join(dotGit, "objects"));
}
function worktreeGitDir(dotGit, baseDir) {
  let content;
  try {
    content = readFileSync5(dotGit, "utf8");
  } catch {
    return null;
  }
  const line = content.split("\n")[0]?.trim() ?? "";
  if (!line.startsWith("gitdir:")) {
    return null;
  }
  const raw = line.slice("gitdir:".length).trim();
  if (raw === "") {
    return null;
  }
  const path19 = isAbsolute(raw) ? raw : join(baseDir, raw);
  return resolve(path19);
}
function stripWorktreesSuffix(gitDir) {
  const marker = `${sep}worktrees${sep}`;
  const idx = gitDir.lastIndexOf(marker);
  if (idx === -1) {
    return gitDir;
  }
  return gitDir.slice(0, idx);
}
function hashId(input) {
  return createHash2("sha256").update(input).digest("hex").slice(0, 16);
}

// opencode/plugin/oso/plan-state.ts
function approvedPlanFor(directory, owner) {
  const approval = stateKeyOf(directory, "plan_approval");
  if (approval !== "approved") {
    return {
      kind: "unapproved",
      detail: `this repository's plan approval reads ${approval === "" ? "nothing at all" : `"${approval}"`}`
    };
  }
  const presenter = stateKeyOf(directory, "plan_approval_session");
  if (presenter !== owner) {
    return {
      kind: "unapproved",
      detail: `the approved plan is owned by ${presenter === "" ? "no recorded identity" : presenter}, not by ${owner}`
    };
  }
  return { kind: "approved", digest: stateKeyOf(directory, "plan_approval_digest") };
}
function stateKeyOf(directory, key) {
  return readValue(stateFileFor(directory), key) ?? "";
}

// opencode/plugin/oso/approval.ts
var PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
var PLAN_CANCEL_TOOL_ID = "oso_plan_cancel";
function planApprovalTool() {
  return {
    description: "The approval gate for the oso-code plan mode's phases 1 through 5. Deliver the complete phase-5 document as turn-ending plain text first, then call this tool in a later turn carrying those exact bytes. The operator's answer to the authorization prompt this raises IS the approval: a grant records the approved plan and opens the amendment lane against it, and a refusal comes back as an error approving nothing \u2014 the presentation captured before the prompt stays on disk unpromoted, so this repository is left exactly as unapproved as it was. Nothing this session says or writes can stand in for that answer, and no earlier grant carries over to a later call. A material change to the document invalidates the approval it already carries: present the whole plan again and call this tool again, which binds a fresh digest.",
    args: {
      plan: {
        type: "string",
        description: "The complete phase-5 document, byte for byte as the operator just read it."
      }
    },
    execute: async (args, call) => approveOnOperatorGrant(planDocumentOf(args), call)
  };
}
function planCancelTool() {
  return {
    description: "Abandons the approved plan this repository is executing, at the operator's explicit request and never on your own reading of one. The operator's answer to the authorization prompt this raises IS the abandonment. A grant writes mode=plan, active_slice=none, verify_green=false and plan_approval=cancelled, which closes the edit and commit gates and leaves nothing for the amendment lane to amend; the approved document, the run's own markers and every other state key are left exactly as they stand. Call it only when the operator asks to abandon the plan, never to unstick a denied tool call.",
    args: {},
    execute: async (_args, call) => cancelOnOperatorGrant(call)
  };
}
async function approveOnOperatorGrant(planDocument, call) {
  const { askOperator, directory, owner, sessionID } = grantBoundCall(PLAN_APPROVAL_TOOL_ID, call);
  const digest = sha256Hex(planDocument);
  runCapturePlan(directory, owner, digest, planDocument);
  await askOperator({
    permission: PLAN_APPROVAL_TOOL_ID,
    patterns: [digest],
    always: [],
    metadata: { digest, characters: planDocument.length }
  });
  promoteThePresentedPlan(directory, owner, digest);
  return {
    title: "plan approved",
    output: `The operator granted ${PLAN_APPROVAL_TOOL_ID} for the plan document whose digest is ${digest}. Execution may begin against that exact document, and the operational plan is amendable under ${owner}.`,
    metadata: { digest, owner, session: sessionID }
  };
}
async function cancelOnOperatorGrant(call) {
  const { askOperator, directory, owner, sessionID } = grantBoundCall(PLAN_CANCEL_TOOL_ID, call);
  const approved = approvedPlanFor(directory, owner);
  if (approved.kind !== "approved") {
    throw new Error(`${PLAN_CANCEL_TOOL_ID} has no approved plan to abandon: ${approved.detail}`);
  }
  await askOperator({
    permission: PLAN_CANCEL_TOOL_ID,
    patterns: [approved.digest],
    always: [],
    metadata: { digest: approved.digest }
  });
  abandonTheApprovedPlan(directory, owner, approved.digest);
  return {
    title: "plan abandoned",
    output: `The operator granted ${PLAN_CANCEL_TOOL_ID} for the approved plan whose digest is ${approved.digest}. Its state now reads plan_approval=cancelled beside the disarmed triple, so no slice is armed, no commit passes the green gate and no amendment lands; the approved document itself is untouched.`,
    metadata: { digest: approved.digest, session: sessionID }
  };
}
function promoteThePresentedPlan(directory, owner, digest) {
  try {
    runApprovePlan(directory, owner, digest);
  } catch (err) {
    if (!(err instanceof PlanApprovalError) && !(err instanceof PlanFailure)) throw err;
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} did not record the operator's approval: ${err.message}`);
  }
}
function abandonTheApprovedPlan(directory, owner, digest) {
  try {
    runCancelApprovedPlan(directory, owner, digest);
  } catch (err) {
    if (!(err instanceof PlanApprovalError) && !(err instanceof GatesOwnedElsewhereError)) throw err;
    throw new Error(`${PLAN_CANCEL_TOOL_ID} did not abandon the plan: ${err.message}`);
  }
}
function grantBoundCall(toolId, call) {
  const askOperator = call.ask;
  if (askOperator === void 0) {
    throw new Error(
      `${toolId} cannot run: this host handed the plugin no permission API to raise the operator's approval with`
    );
  }
  const sessionID = call.sessionID ?? "";
  if (sessionID === "") {
    throw new Error(`${toolId} cannot run: the host named no session to raise the operator's prompt in`);
  }
  const directory = call.directory ?? "";
  const commonDir = commonDirOf(directory);
  if (commonDir === "") {
    throw new Error(
      `${toolId} must run inside a git repository, and ${directory || "the directory the host named"} is not one`
    );
  }
  return { askOperator, directory, owner: deriveRootId(directory), sessionID };
}
function planDocumentOf(args) {
  const plan = args?.plan;
  if (typeof plan !== "string" || plan.trim() === "") {
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} needs the plan document it is asking the operator to approve`);
  }
  return plan;
}

// opencode/plugin/oso/installed-tree.ts
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function stateBinPath2() {
  const explicit = process.env.OSO_STATE_BIN;
  if (explicit !== void 0 && explicit !== "") {
    return explicit;
  }
  return resolve2(dirname2(fileURLToPath2(import.meta.url)), "..", "bin", "oso-state");
}

// opencode/plugin/oso/wave.ts
import { isAbsolute as isAbsolute2 } from "node:path";

// opencode/plugin/oso/verdict-capture.ts
var TASK_TOOL = "task";
function captureTaskVerdict(input, output, directory) {
  const call = input ?? {};
  const result = output ?? {};
  const subagentType = call.args?.subagent_type;
  if (call.tool !== TASK_TOOL || typeof subagentType !== "string" || !isVerifierAgent(subagentType)) {
    return;
  }
  if (result.metadata?.background === true || typeof result.output !== "string") {
    return;
  }
  captureOpenCodeVerifierReport({ directory, model: launchedModelOf2(result), report: result.output });
}
function captureOpenCodeVerifierReport({ directory, model, report }) {
  captureVerifierReport({ host: "opencode", cwd: directory, session: deriveRootId(directory), model, report });
}
function launchedModelOf2(result) {
  const model = result.metadata?.model;
  const providerID = model?.providerID;
  const modelID = model?.modelID;
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : null;
}

// opencode/plugin/oso/wave.ts
async function runWave(request) {
  const pinned = await pinEveryChildSession(request);
  return Promise.all(pinned.map((child) => collectChildReport(child, request)));
}
function pinEveryChildSession(request) {
  const projectCommonDir = commonDirOf(request.projectDirectory);
  return Promise.all(request.launches.map((launch) => pinChildSession(launch, projectCommonDir, request)));
}
var HOST_AGENT = {
  applier: "oso-applier",
  verifier: VERIFIER_AGENT
};
async function pinChildSession(launch, projectCommonDir, request) {
  const rejection = proofRejection(launch) ?? worktreeRejection(launch.worktree, projectCommonDir);
  if (rejection !== void 0) {
    return { state: "unpinnable", launch, reason: rejection };
  }
  try {
    const session = await withinBound(
      () => request.transport.create({
        directory: launch.worktree,
        title: `${HOST_AGENT[launch.agent]} in ${launch.worktree}`,
        parentSessionID: request.parentSessionID
      }),
      request.timeoutMs
    );
    if (session.directory !== launch.worktree) {
      return {
        state: "unpinnable",
        launch,
        reason: `the host pinned the child session to ${session.directory}, not to ${launch.worktree}`
      };
    }
    return { state: "pinned", launch, sessionID: session.id };
  } catch (error) {
    return { state: "unpinnable", launch, reason: `the child session could not be created: ${messageOf2(error)}` };
  }
}
function proofRejection({ agent, applierProof }) {
  if (agent === "verifier" || applierProof === void 0) {
    return void 0;
  }
  return "applier_proof reaches a verifier child only, and this child runs as an applier";
}
function worktreeRejection(worktree, projectCommonDir) {
  if (!isAbsolute2(worktree)) {
    return `${worktree} is not an absolute path`;
  }
  const role = roleOf(worktree);
  if (role !== "child") {
    return `${worktree} is not a git worktree, it is ${role}`;
  }
  const worktreeCommonDir = commonDirOf(worktree);
  if (worktreeCommonDir !== projectCommonDir) {
    return `${worktree} belongs to ${worktreeCommonDir}, not to this project at ${projectCommonDir}`;
  }
  return void 0;
}
async function collectChildReport(child, request) {
  if (child.state === "unpinnable") {
    return {
      outcome: "blocked",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      reason: child.reason
    };
  }
  try {
    const raw = await withinBound(
      () => request.transport.prompt({
        sessionID: child.sessionID,
        directory: child.launch.worktree,
        hostAgent: HOST_AGENT[child.launch.agent],
        prompt: promptOf(child.launch)
      }),
      request.timeoutMs
    );
    if (child.launch.agent === "verifier") {
      captureOpenCodeVerifierReport({ directory: request.projectDirectory, model: null, report: raw });
    }
    return {
      outcome: "reported",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      verdict: parseAgentVerdict(raw),
      raw
    };
  } catch (error) {
    const unstopped = await stopChild(child.sessionID, child.launch.worktree, request.transport);
    const failure = `the child turn did not complete: ${messageOf2(error)}`;
    return {
      outcome: "blocked",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      reason: unstopped === void 0 ? failure : `${failure}; ${unstopped}`
    };
  }
}
function promptOf({ prompt, applierProof }) {
  return applierProof === void 0 ? prompt : `${prompt}

${APPLIER_PROOF_HEADER}
${applierProof}`;
}
var ABORT_BOUND_MS = 1e4;
async function stopChild(sessionID, directory, transport) {
  try {
    await withinBound(() => transport.abort({ sessionID, directory }), ABORT_BOUND_MS);
    return void 0;
  } catch (error) {
    return `the child session was left running: ${messageOf2(error)}`;
  }
}
function pinnedSessionTransport(session) {
  return {
    create: ({ directory, title, parentSessionID }) => unwrap(session.create({
      query: { directory },
      body: parentSessionID === "" ? { title } : { title, parentID: parentSessionID }
    })),
    prompt: async ({ sessionID, directory, hostAgent, prompt }) => finalMessageText(await unwrap(session.prompt({
      path: { id: sessionID },
      query: { directory },
      body: { agent: hostAgent, parts: [{ type: "text", text: prompt }] }
    }))),
    abort: async ({ sessionID, directory }) => {
      await unwrap(session.abort({ path: { id: sessionID }, query: { directory } }));
    }
  };
}
async function unwrap(call) {
  const result = await call;
  if (result.data === void 0) {
    throw new Error(messageOf2(result.error));
  }
  return result.data;
}
function finalMessageText(reply) {
  if (!Array.isArray(reply.parts)) {
    throw new Error("the host returned a reply with no message parts");
  }
  return reply.parts.filter(isTextPart).map((part) => part.text).join("\n");
}
function isTextPart(part) {
  const record = part;
  return typeof record === "object" && record !== null && record.type === "text" && typeof record.text === "string";
}
function messageOf2(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error !== "") {
    return error;
  }
  const record = error;
  return nonEmptyText(record?.message) ?? nonEmptyText(record?.data?.message) ?? nonEmptyText(record?.name) ?? `an unnamed failure: ${JSON.stringify(error)}`;
}
function nonEmptyText(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function withinBound(run, timeoutMs) {
  return new Promise((resolve3, reject) => {
    const timer = setTimeout(() => reject(new Error(`the ${timeoutMs}ms bound expired`)), timeoutMs);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve3(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// opencode/plugin/oso/gates.ts
var routes = openCodeRoutes();
var denyVerdict = (message) => ({
  kind: "deny",
  message
});
var blockVerdict = (message) => ({
  kind: "block",
  message
});
var allowVerdict = { kind: "allow", message: "" };
function callerFor(directory) {
  return { host: "opencode", agentSession: publishIdentity(directory).OSO_AGENT, stateBin: stateBinPath2() };
}
function composeEnvelope(input, output) {
  const cwd = input.cwd ?? process.cwd();
  const args = output.args ?? {};
  const { filePath, patchText } = args;
  return hostEnvelope(callerFor(cwd), {
    sessionId: input.sessionID ?? "",
    cwd,
    toolName: input.tool,
    commandLine: commandLineFor(args),
    filePath: typeof filePath === "string" ? filePath : "",
    patchText: typeof patchText === "string" ? patchText : ""
  });
}
function composeLifecycleEnvelope(input) {
  return hostEnvelope(callerFor(input.directory), {
    sessionId: input.sessionID,
    cwd: input.directory,
    source: input.moment === "end" ? "" : input.moment
  });
}
function commandLineFor(args) {
  const script = args.script;
  if (typeof script === "string") {
    return script;
  }
  const command = args.command;
  if (typeof command === "string") {
    return command;
  }
  return "";
}
function matchesTool(matcher, tool) {
  return routeMatcher(matcher).test(tool);
}
function assertGateRoutesCompile(gateRoutes) {
  for (const route of gateRoutes) {
    routeMatcher(route.matcher);
  }
}
function routeMatcher(matcher) {
  try {
    return new RegExp(matcher);
  } catch (err) {
    throw new Error(
      `the installed gate route table carries a matcher no regular expression compiles from: ${JSON.stringify(matcher)} (${messageOf2(err)})`
    );
  }
}
function routeForGate(gateRoutes, gate) {
  return gateRoutes.find((route) => route.gate === gate);
}
function argvFor(route) {
  return route.allow.length > 0 ? [route.gate, "--allow", route.allow.join("|")] : [route.gate];
}
function judge(route, envelope) {
  try {
    const run = runGate(argvFor(route), envelope);
    for (const event of run.events) {
      logEvent(event);
    }
    return { kind: "judged", verdict: run.verdict, stderr: run.stderr };
  } catch (err) {
    return { kind: "unusable", detail: `the ${route.gate} gate could not run: ${messageOf2(err)}` };
  }
}
function failureDetail(gate, stderr) {
  const reported = stderr.trim();
  return reported !== "" ? reported : `oso-code: gate ${gate} failed unexpectedly and reported no cause`;
}
function runToolGate(route, input, output) {
  const judged = judge(route, composeEnvelope(input, output));
  if (judged.kind === "unusable") {
    return blockVerdict(`oso-code: ${judged.detail}`);
  }
  if (judged.verdict.kind === "deny") {
    return denyVerdict(judged.verdict.message);
  }
  if (judged.verdict.kind === "gateError") {
    return blockVerdict(failureDetail(route.gate, judged.stderr));
  }
  return allowVerdict;
}
function runAdvisoryGate(route, input) {
  const judged = judge(route, composeLifecycleEnvelope(input));
  if (judged.kind === "unusable") {
    return { kind: "failed", detail: judged.detail };
  }
  if (judged.verdict.kind === "gateError") {
    return { kind: "failed", detail: failureDetail(route.gate, judged.stderr) };
  }
  return judged.verdict.kind === "context" ? { kind: "context", text: judged.verdict.additionalContext } : { kind: "silent" };
}

// opencode/plugin/oso/trace.ts
var TRACE_SINK_ORDER = ["state", "log", "toast"];
function recordTrace(input) {
  const severity = input.severity ?? "advisory";
  const results = [];
  let stateSinkBroken = false;
  for (const sink of TRACE_SINK_ORDER) {
    if (sink === "state") {
      const ok = tryStateSink(input.origin, input.detail, input.sessionID);
      stateSinkBroken = !ok;
      results.push({ sink, ok });
      continue;
    }
    if (sink === "log") {
      results.push({ sink, ok: tryLogSink(input.origin, input.detail, severity, stateSinkBroken) });
      continue;
    }
    results.push({ sink, ok: tryToastSink(input.origin, input.detail, severity, input.client) });
  }
  return results;
}
function tryStateSink(origin, detail, sessionID) {
  if (sessionID === void 0 || sessionID === "") {
    return false;
  }
  try {
    return logEvent({ event: origin, session: sessionID, command: detail });
  } catch {
    return false;
  }
}
function tryLogSink(origin, detail, severity, stateSinkBroken) {
  try {
    const stateNote = stateSinkBroken ? " (state sink also failed)" : "";
    console.error(`oso-code: [${severity}] ${origin}: ${detail}${stateNote}`);
    return true;
  } catch {
    return false;
  }
}
function tryToastSink(origin, detail, severity, client) {
  const showToast = toastFnOf(client);
  if (showToast === void 0) {
    return false;
  }
  try {
    const outcome = showToast({
      body: {
        title: "oso-code",
        message: `${origin}: ${detail}`,
        variant: severity === "enforcement" ? "error" : "warning"
      }
    });
    settleQuietly(outcome);
    return true;
  } catch {
    return false;
  }
}
function settleQuietly(outcome) {
  if (typeof outcome !== "object" || outcome === null) {
    return;
  }
  const thenable = outcome.catch;
  if (typeof thenable === "function") {
    thenable.call(outcome, () => {
    });
  }
}
function toastFnOf(client) {
  if (typeof client !== "object" || client === null) {
    return void 0;
  }
  const tui = client.tui;
  if (typeof tui !== "object" || tui === null) {
    return void 0;
  }
  const showToast = tui.showToast;
  return typeof showToast === "function" ? showToast : void 0;
}

// opencode/plugin/oso/continuation-rail.ts
var childSessions = /* @__PURE__ */ new Map();
var driving = /* @__PURE__ */ new Set();
var heldRuns = /* @__PURE__ */ new Map();
function trackSessionEvent(event, nowMs = Date.now()) {
  if (event.type === "session.created") {
    recordLaunchedChild(event.properties, nowMs);
    return;
  }
  const child = childSessions.get(sessionNamedBy(event));
  if (child === void 0 || child.phase === "completed") {
    return;
  }
  if (endsTheSession(event)) {
    child.phase = "completed";
    redriveHeldRun(child.parentID);
    return;
  }
  child.lastActivityMs = nowMs;
}
function recordLaunchedChild(properties, nowMs) {
  const info = properties?.info;
  const id = info?.id;
  const parentID = info?.parentID;
  if (typeof id === "string" && id !== "" && typeof parentID === "string" && parentID !== "") {
    childSessions.set(id, { parentID, startedMs: nowMs, lastActivityMs: nowMs, phase: "running" });
  }
}
function sessionNamedBy(event) {
  const named = event.properties;
  const infoIsTheSession = event.type.startsWith("session.");
  const id = named?.sessionID ?? named?.part?.sessionID ?? named?.info?.sessionID ?? (infoIsTheSession ? named?.info?.id : void 0);
  return typeof id === "string" ? id : "";
}
function endsTheSession(event) {
  if (event.type === "session.idle" || event.type === "session.deleted") {
    return true;
  }
  const status = event.properties?.status;
  return event.type === "session.status" && status?.type === "idle";
}
function continueUnattendedRun(request) {
  if (request.sessionID === "" || childSessions.has(request.sessionID)) {
    return Promise.resolve({ kind: "not-this-runs-session" });
  }
  if (driving.has(request.sessionID)) {
    return Promise.resolve({ kind: "already-driving" });
  }
  driving.add(request.sessionID);
  return postUntilTheRunStops(request).catch((error) => standDownTraced(request, `the continuation rail failed: ${messageOf2(error)}`, 0)).finally(() => {
    driving.delete(request.sessionID);
  });
}
function releaseHeldRuns() {
  for (const held of heldRuns.values()) {
    clearTimeout(held.wake);
  }
  heldRuns.clear();
}
async function postUntilTheRunStops(request) {
  let turns = 0;
  for (; ; ) {
    let step;
    try {
      step = nextContinuationStep(request);
    } catch (error) {
      endHold(request.sessionID);
      return standDownTraced(request, `the unattended run could not be read: ${messageOf2(error)}`, turns);
    }
    if (step.kind === "held") {
      holdUntilAChildSettles(request, step.children);
      return { kind: "stood-down", turns };
    }
    endHold(request.sessionID);
    if (step.kind === "stop") {
      return { kind: "stood-down", turns };
    }
    try {
      await postContinuationTurn(request, step.order);
    } catch (error) {
      return standDownTraced(request, `the continuation turn did not land: ${messageOf2(error)}`, turns);
    }
    turns += 1;
  }
}
function nextContinuationStep(request) {
  releaseOverdueChildren(request);
  const children = childSessionsOf(request.sessionID);
  const envelope = hostEnvelope(callerFor(request.directory), {
    sessionId: request.sessionID,
    cwd: request.directory,
    backgroundTasks: { kind: "object", ...children }
  });
  const run = runGate(["autocontinue"], envelope);
  for (const event of run.events) {
    logEvent(event);
  }
  if (run.verdict.kind === "push") {
    return { kind: "push", order: run.verdict.reason };
  }
  const held = children.active.length > 0 && run.events.some((event) => event.event === RUN_HELD_EVENT);
  return held ? { kind: "held", children: children.active } : { kind: "stop" };
}
function holdUntilAChildSettles(request, children) {
  const previous = heldRuns.get(request.sessionID);
  if (previous === void 0) {
    traceRun(request, `the run is held while child sessions run: ${children.join(", ")}`);
  } else {
    clearTimeout(previous.wake);
  }
  const untilOverdueMs = Math.max(0, earliestOverdueMs(children) - nowOf(request));
  const wake = setTimeout(() => redriveHeldRun(request.sessionID), untilOverdueMs).unref();
  heldRuns.set(request.sessionID, { request, wake });
}
function earliestOverdueMs(children) {
  const clocks = children.flatMap((childID) => childSessions.get(childID) ?? []);
  return Math.min(...clocks.map(delegationOverdueAtMs));
}
function redriveHeldRun(parentID) {
  const held = heldRuns.get(parentID);
  if (held !== void 0) {
    void continueUnattendedRun(held.request);
  }
}
function endHold(parentID) {
  const held = heldRuns.get(parentID);
  if (held !== void 0) {
    clearTimeout(held.wake);
    heldRuns.delete(parentID);
  }
}
function releaseOverdueChildren(request) {
  const nowMs = nowOf(request);
  for (const [childID, child] of childSessions) {
    if (child.parentID !== request.sessionID || child.phase !== "running") {
      continue;
    }
    const overdue = overdueDelegation(child, nowMs);
    if (overdue !== void 0) {
      child.phase = "reported";
      reportOverdueChild(request, childID, overdue);
    }
  }
}
function reportOverdueChild(request, childID, overdue) {
  const report = `child session ${childID} ${overdue.kind}:${overdue.measure} \u2014 released from the hold`;
  traceRun(request, report);
  try {
    appendJournal(journalFileFor(request.directory), `auto-continue: ${report}`);
  } catch (error) {
    traceRun(request, `the report on child session ${childID} could not be journaled: ${messageOf2(error)}`);
  }
}
function childSessionsOf(parentID) {
  const children = [...childSessions].filter(([, child]) => child.parentID === parentID);
  return {
    active: children.filter(([, child]) => child.phase === "running").map(([childID]) => childID),
    completed: children.filter(([, child]) => child.phase === "completed").map(([childID]) => childID)
  };
}
async function postContinuationTurn(request, order) {
  const session = request.session;
  if (session === void 0) {
    throw new Error("this host handed the plugin no session api to post a continuation turn through");
  }
  await unwrap(session.prompt({
    path: { id: request.sessionID },
    body: { parts: [{ type: "text", text: order }] }
  }));
}
function standDownTraced(request, reason, turns) {
  traceRun(request, reason);
  return { kind: "failed", reason, turns };
}
function traceRun(request, detail) {
  recordTrace({ origin: "auto-continue", detail, severity: "advisory", sessionID: request.sessionID, client: request.client });
}
function nowOf(request) {
  return (request.now ?? Date.now)();
}

// opencode/plugin/oso/lifecycle.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { readdirSync as readdirSync3, readFileSync as readFileSync6, rmSync as rmSync7, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname3, join as join2 } from "node:path";
var MARKER_PREFIX = "oso-live-";
var MARKER_SUFFIX = ".json";
function markerPath(commonDir, sessionId) {
  return join2(commonDir, `${MARKER_PREFIX}${sessionId}${MARKER_SUFFIX}`);
}
function readMarkerFile(path19) {
  try {
    return normalizeMarker(JSON.parse(readFileSync6(path19, "utf8")));
  } catch {
    return null;
  }
}
function normalizeMarker(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed;
  const sessionId = record.sessionId;
  const pid = record.pid;
  if (typeof sessionId !== "string" || sessionId === "") {
    return null;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const worktrees = Array.isArray(record.worktrees) ? record.worktrees.filter((entry) => typeof entry === "string") : [];
  const commonDir = typeof record.commonDir === "string" ? record.commonDir : "";
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;
  return { sessionId, pid, commonDir, worktrees, updatedAt };
}
function listMarkers(commonDir) {
  if (commonDir === "") {
    return [];
  }
  let entries;
  try {
    entries = readdirSync3(commonDir);
  } catch {
    return [];
  }
  const markers = [];
  for (const entry of entries) {
    if (!entry.startsWith(MARKER_PREFIX) || !entry.endsWith(MARKER_SUFFIX)) {
      continue;
    }
    const marker = readMarkerFile(join2(commonDir, entry));
    if (marker !== null) {
      markers.push(marker);
    }
  }
  return markers;
}
function isLive(marker) {
  if (marker.pid === process.pid) {
    return true;
  }
  try {
    process.kill(marker.pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}
function listStale(commonDir) {
  const orphans = [];
  for (const marker of listMarkers(commonDir)) {
    if (isLive(marker)) {
      continue;
    }
    for (const path19 of marker.worktrees) {
      orphans.push({ path: path19, sessionId: marker.sessionId });
    }
  }
  return orphans;
}
function buildStaleAdvice(orphans) {
  if (orphans.length === 0) {
    return "";
  }
  const lines = orphans.map(
    (orphan) => `  - ${orphan.path} (left by dead session ${orphan.sessionId})`
  );
  return `Stale worktrees from dead sessions remain on disk:
${lines.join("\n")}
Remove them with \`git worktree remove\` and \`git worktree prune\`, or leave them for the harness sweep.`;
}
function queueSystemAdvice(pending, sessionId, advice) {
  if (sessionId === "" || advice === "") {
    return;
  }
  const queued = pending.get(sessionId);
  if (queued === void 0) {
    pending.set(sessionId, [advice]);
    return;
  }
  queued.push(advice);
}
function deliverSystemAdvice(output, pending, sessionId) {
  const queued = pending.get(sessionId);
  if (queued === void 0 || queued.length === 0) {
    return { kind: "empty" };
  }
  const record = output;
  if (typeof record !== "object" || record === null || !Array.isArray(record.system)) {
    return { kind: "undeliverable" };
  }
  record.system.push(...queued);
  return { kind: "delivered", entries: queued.length };
}
function deliverCompactionContext(output, anchor) {
  if (anchor === "") {
    return { kind: "empty" };
  }
  const record = output;
  if (typeof record !== "object" || record === null || !Array.isArray(record.context)) {
    return { kind: "undeliverable" };
  }
  record.context.push(anchor);
  return { kind: "delivered", entries: 1 };
}
function dropSystemAdvice(pending, sessionId) {
  pending.delete(sessionId);
}
function touchMarker(commonDir, sessionId, options) {
  if (commonDir === "" || sessionId === "") {
    return;
  }
  const marker = {
    sessionId,
    pid: options.pid,
    commonDir,
    worktrees: options.worktrees,
    updatedAt: Date.now()
  };
  writeFileSync3(markerPath(commonDir, sessionId), JSON.stringify(marker));
}
function sweepStale(commonDir, options = {}) {
  const reaped = [];
  const left = [];
  const git = options.git ?? "git";
  for (const marker of listMarkers(commonDir)) {
    if (isLive(marker)) {
      continue;
    }
    let tornDown = true;
    for (const path19 of marker.worktrees) {
      if (removeWorktree(commonDir, path19, git)) {
        reaped.push(path19);
      } else {
        left.push(path19);
        tornDown = false;
      }
    }
    if (tornDown) {
      dropMarkerQuietly(commonDir, marker.sessionId);
    }
  }
  return { reaped, left };
}
function removeWorktree(commonDir, path19, git) {
  const cwd = dirname3(commonDir);
  if (!runGit(git, ["worktree", "remove", path19], cwd)) {
    return false;
  }
  runGit(git, ["worktree", "prune"], cwd);
  return true;
}
function runGit(git, args, cwd) {
  try {
    const result = spawnSync3(git, args, { cwd, encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}
function dropMarkerQuietly(commonDir, sessionId) {
  try {
    rmSync7(markerPath(commonDir, sessionId), { force: true });
  } catch {
  }
}

// opencode/plugin/oso/wave-tool.ts
var CHILD_BOUND_MS = 30 * 60 * 1e3;
function waveTool(session) {
  return {
    description: "Runs one oso-code wave: every child is an oso-applier or oso-verifier session pinned to its own git worktree of this project, all children are opened before any of them is prompted, each child's turn blocks until it reports, and its status/verdict line is read back in band. A child that cannot be pinned, cannot run, or outlives its bound comes back blocked with the reason and never as a verdict.",
    args: {
      children: {
        type: "array",
        description: "One entry per wave child. Every worktree must already exist and belong to this project.",
        items: {
          type: "object",
          properties: {
            worktree: { type: "string", description: "Absolute path of the git worktree the child runs inside." },
            agent: { type: "string", enum: ["applier", "verifier"], description: "Which oso-code agent the child runs as." },
            prompt: { type: "string", description: "The full assignment the child receives as its first and only turn." },
            applier_proof: {
              type: "string",
              description: "The applier's proof, scan, and decisions_used report blocks for the slice this child verifies, verbatim and alone \u2014 a verifier child's field, which an applier child offered it comes back blocked for."
            }
          },
          required: ["worktree", "agent", "prompt"]
        }
      }
    },
    execute: async (args, call) => {
      if (session === void 0) {
        throw new Error("oso_wave cannot run: this host handed the plugin no session API to open children with");
      }
      const projectDirectory = call.directory ?? "";
      if (commonDirOf(projectDirectory) === "") {
        throw new Error(`oso_wave must run inside a git repository, and ${projectDirectory || "the directory the host named"} is not one`);
      }
      const results = await runWave({
        launches: parseLaunches(args),
        transport: pinnedSessionTransport(session),
        projectDirectory,
        parentSessionID: call.sessionID ?? "",
        timeoutMs: CHILD_BOUND_MS
      });
      return {
        title: waveTitle(results),
        output: results.map(renderChild).join("\n\n"),
        metadata: { children: results.length, blocked: blockedCount(results) }
      };
    }
  };
}
function parseLaunches(args) {
  const children = args?.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("oso_wave needs a children array carrying at least one child");
  }
  return children.map(parseLaunch);
}
function parseLaunch(child, index) {
  const record = typeof child === "object" && child !== null ? child : {};
  const { worktree, agent, prompt, applier_proof: applierProof } = record;
  if (typeof worktree !== "string" || worktree === "") {
    throw new Error(`oso_wave child ${index} needs a worktree path, not ${JSON.stringify(worktree)}`);
  }
  if (!isWaveAgent(agent)) {
    throw new Error(`oso_wave child ${index} needs agent "applier" or "verifier", not ${JSON.stringify(agent)}`);
  }
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error(`oso_wave child ${index} needs a prompt`);
  }
  if (applierProof !== void 0 && (typeof applierProof !== "string" || applierProof === "")) {
    throw new Error(`oso_wave child ${index} needs applier_proof as the applier's three report blocks, not ${JSON.stringify(applierProof)}`);
  }
  return { worktree, agent, prompt, applierProof };
}
function isWaveAgent(value) {
  return value === "applier" || value === "verifier";
}
function waveTitle(results) {
  const blocked = blockedCount(results);
  if (blocked === 0) {
    return `wave: ${results.length} children reported`;
  }
  return `wave: ${results.length} children, ${blocked} blocked`;
}
function blockedCount(results) {
  return results.filter((result) => result.outcome === "blocked").length;
}
function renderChild(result) {
  if (result.outcome === "blocked") {
    return `=== ${result.worktree} (${result.agent}) \u2014 blocked: ${result.reason} ===`;
  }
  return `=== ${result.worktree} (${result.agent}) \u2014 ${verdictSummary(result.verdict)} ===
${result.raw}`;
}
function verdictSummary(parsed) {
  const lines = [];
  if (parsed.status !== void 0) {
    lines.push(`status: ${parsed.status}`);
  }
  if (parsed.verdict !== void 0) {
    lines.push(`verdict: ${parsed.verdict}`);
  }
  return lines.length === 0 ? "no verdict line" : lines.join(", ");
}

// opencode/plugin/oso/workspace.ts
var WORKSPACE_ADAPTER_TYPE = "oso-code";
function registerWorkspaceAdapter(input) {
  const register = registerAdapterFnOf(input.experimentalWorkspace);
  if (register === void 0) {
    recordTrace({
      origin: "workspace.register",
      detail: `the host exposed no experimental workspace registry, so "${WORKSPACE_ADAPTER_TYPE}" is absent from its adapter list`,
      severity: "advisory",
      client: input.client
    });
    return;
  }
  try {
    register(WORKSPACE_ADAPTER_TYPE, OSO_WORKSPACE_ADAPTER);
  } catch (err) {
    recordTrace({
      origin: "workspace.register",
      detail: messageOf2(err),
      severity: "advisory",
      client: input.client
    });
  }
}
var OSO_WORKSPACE_ADAPTER = {
  name: "oso-code wave",
  description: "Worktrees for an oso-code wave, created by the oso_wave tool rather than from this dialog",
  configure() {
    throw new Error(
      `the "${WORKSPACE_ADAPTER_TYPE}" adapter is registered for discovery only \u2014 a wave worktree is created by the oso_wave tool, never by the host workspace dialog`
    );
  }
};
function registerAdapterFnOf(experimentalWorkspace) {
  if (typeof experimentalWorkspace !== "object" || experimentalWorkspace === null) {
    return void 0;
  }
  const register = experimentalWorkspace.register;
  return typeof register === "function" ? register : void 0;
}

// opencode/plugin/oso-code.ts
var advisedSessions = /* @__PURE__ */ new Set();
var busSessions = /* @__PURE__ */ new Set();
var pendingAdvice = /* @__PURE__ */ new Map();
var reanchoredByCompaction = /* @__PURE__ */ new Set();
var orphanAdviceValue;
function orphanWorktreeAdviceOnce(directory, client) {
  if (orphanAdviceValue === void 0) {
    try {
      orphanAdviceValue = buildStaleAdvice(listStale(commonDirOf(directory)));
    } catch (err) {
      orphanAdviceValue = "";
      recordTrace({ origin: "lifecycle.orphan-advice", detail: messageOf2(err), severity: "advisory", client });
    }
  }
  return orphanAdviceValue;
}
function sessionIdOf(value) {
  const sessionID = value?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}
function runLifecycleGate(gate, input, client) {
  const route = routeForGate(routes, gate);
  if (route === void 0) {
    return "";
  }
  const outcome = runAdvisoryGate(route, input);
  if (outcome.kind === "failed") {
    recordTrace({
      origin: `gate.${gate}`,
      detail: outcome.detail,
      severity: "advisory",
      sessionID: input.sessionID,
      client
    });
    return "";
  }
  return outcome.kind === "context" ? outcome.text : "";
}
function armSessionAdvice(sessionID, directory, client) {
  if (sessionID === "" || advisedSessions.has(sessionID)) {
    return;
  }
  advisedSessions.add(sessionID);
  queueSystemAdvice(pendingAdvice, sessionID, orphanWorktreeAdviceOnce(directory, client));
  queueSystemAdvice(
    pendingAdvice,
    sessionID,
    runLifecycleGate("stale", { sessionID, directory, moment: "startup" }, client)
  );
  queueSystemAdvice(
    pendingAdvice,
    sessionID,
    runLifecycleGate("version", { sessionID, directory, moment: "startup" }, client)
  );
}
function markSessionLive(sessionID, directory, client) {
  if (sessionID === "") {
    return;
  }
  try {
    touchMarker(commonDirOf(directory), sessionID, {
      pid: process.pid,
      worktrees: []
    });
  } catch (err) {
    recordTrace({ origin: "session.idle", detail: messageOf2(err), severity: "advisory", sessionID, client });
  }
}
var osoCode = async (pluginInput) => {
  const client = pluginInput?.client;
  const directory = pluginInput?.directory ?? process.cwd();
  try {
    sweepStale(commonDirOf(directory));
  } catch (err) {
    recordTrace({ origin: "lifecycle.sweep", detail: messageOf2(err), severity: "advisory", client });
  }
  registerWorkspaceAdapter({ experimentalWorkspace: pluginInput?.experimental_workspace, client });
  try {
    assertGateRoutesCompile(routes);
  } catch (err) {
    recordTrace({ origin: "gate-routes", detail: messageOf2(err), severity: "enforcement", client });
  }
  return {
    "tool.execute.before": async (input, output) => {
      const call = input;
      const result = output ?? {};
      for (const route of routes) {
        if (route.hook !== "tool.execute.before" || !matchesTool(route.matcher, call.tool)) {
          continue;
        }
        const verdict = runToolGate(route, call, result);
        if (verdict.kind !== "allow") {
          throw new Error(verdict.message);
        }
      }
    },
    "tool.execute.after": async (input, output) => {
      captureTaskVerdict(input, output, directory);
    },
    "shell.env": async (input, output) => {
      const sessionID = input?.sessionID;
      try {
        const cwd = input?.cwd;
        const identity = publishIdentity(cwd ?? process.cwd());
        const target = output ?? {};
        target.env = {
          ...target.env ?? {},
          ...identity,
          OSO_STATE_BIN: stateBinPath2()
        };
        return target;
      } catch (err) {
        recordTrace({ origin: "shell.env", detail: messageOf2(err), severity: "advisory", sessionID, client });
        return output ?? {};
      }
    },
    event: async (input) => {
      const event = input?.event;
      if (event === void 0 || typeof event.type !== "string") {
        return;
      }
      const sessionID = sessionIdOf(event.properties);
      if (sessionID !== "") {
        busSessions.add(sessionID);
      }
      trackSessionEvent(event);
      if (event.type === "session.created") {
        return;
      }
      if (event.type === "session.idle") {
        markSessionLive(sessionID, directory, client);
        dropSystemAdvice(pendingAdvice, sessionID);
        continueUnattendedRun({ sessionID, directory, session: client?.session, client });
        return;
      }
      if (event.type === "session.compacted") {
        if (reanchoredByCompaction.delete(sessionID)) {
          return;
        }
        queueSystemAdvice(
          pendingAdvice,
          sessionID,
          runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" }, client)
        );
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = sessionIdOf(input);
      try {
        armSessionAdvice(sessionID, directory, client);
        const delivery = deliverSystemAdvice(output, pendingAdvice, sessionID);
        if (delivery.kind === "undeliverable") {
          recordTrace({
            origin: "system.transform",
            detail: "the host handed no system prompt array to append the advisory to",
            severity: "advisory",
            sessionID,
            client
          });
        }
      } catch (err) {
        recordTrace({ origin: "system.transform", detail: messageOf2(err), severity: "advisory", sessionID, client });
      }
    },
    "experimental.session.compacting": async (input, output) => {
      const sessionID = sessionIdOf(input);
      if (sessionID === "") {
        return;
      }
      const anchor = runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" }, client);
      const delivery = deliverCompactionContext(output, anchor);
      if (delivery.kind === "delivered") {
        reanchoredByCompaction.add(sessionID);
      }
      if (delivery.kind === "undeliverable") {
        recordTrace({
          origin: "session.compacting",
          detail: "the host handed no compaction context array to append the re-anchor to",
          severity: "advisory",
          sessionID,
          client
        });
      }
    },
    tool: {
      oso_wave: waveTool(client?.session),
      [PLAN_APPROVAL_TOOL_ID]: planApprovalTool(),
      [PLAN_CANCEL_TOOL_ID]: planCancelTool()
    },
    dispose: async () => {
      for (const sessionID of busSessions) {
        runLifecycleGate("teardown", { sessionID, directory, moment: "end" }, client);
      }
      busSessions.clear();
      releaseHeldRuns();
    }
  };
};
export {
  osoCode
};
