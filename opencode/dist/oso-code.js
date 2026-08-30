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
  cwd: "",
  toolName: "",
  filePath: "",
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
  stopHookActive: false
};
function hostEnvelope(caller, named) {
  const { payloadRead, stopHookActive, ...text } = { ...NO_HOOK_FIELD_NAMED, ...named };
  return { ...asHookFieldValues(text), payloadRead, stopHookActive, caller };
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
var TOOL_ROWS = [
  { gate: "commit", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", codex: "apply_patch", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", codex: "apply_patch", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", codex: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "handoff", names: { claude: "none", codex: "explorer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-applier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-verifier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-integrator", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-doubt-pass", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-debt-sweep", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-triage", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-security-reviewer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "apply_patch", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_plan", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "request_user_input", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "Agent", opencode: "task" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationspawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationsend_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationfollowup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationwait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationinterrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationlist_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "spawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_input", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "resume_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "close_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "followup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "interrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "create_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "get_goal", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "view_image", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resources", opencode: "list_mcp_resources" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resource_templates", opencode: "list_mcp_resource_templates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "read_mcp_resource", opencode: "read_mcp_resource" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_gen__imagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_genimagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "web__run", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_search", opencode: "engram_mem_search" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_get_observation", opencode: "engram_mem_get_observation" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save", opencode: "engram_mem_save" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_update", opencode: "engram_mem_update" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_context", opencode: "engram_mem_context" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_session_summary", opencode: "engram_mem_session_summary" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_current_project", opencode: "engram_mem_current_project" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save_prompt", opencode: "engram_mem_save_prompt" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_judge", opencode: "engram_mem_judge" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve-library-id", opencode: "context7_resolve-library-id" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__query-docs", opencode: "context7_query-docs" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve_library_id", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__find_dupes", opencode: "fallow_find_dupes" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__get_cleanup_candidates", opencode: "fallow_get_cleanup_candidates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__audit", opencode: "fallow_audit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "read" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "grep" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "glob" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "skill" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "todowrite" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "webfetch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "websearch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "question" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "lsp" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "plan_exit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" }
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
function writeStateValues(cwd, sessionId, pairs) {
  const stateFile = stateFileFor(cwd);
  mkdirSync(stateRootDirectory(), { recursive: true });
  withLock(stateFile, sessionId, () => {
    writeStatePairs(stateFile, pairs, sessionId);
    logEvent({ event: `set:${pairs.join(" ")}`, session: sessionId });
  });
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
  const named = envelope.caller.agentSession;
  return sanitizeSession(named !== "" ? named : envelope.sessionId);
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
function adoptMarkIntoRun(markFile, mark, run) {
  const clock = statSync2(markFile).mtime;
  writeWaitMark(markFile, { ...mark, run });
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
  const named = MARKER.exec(message.split("\n")[0] ?? "");
  if (markerLines.length !== 1 || named === null) {
    return publishFailed(MALFORMED_MARKER, sessionId, agentType);
  }
  const slice = named[1];
  const attempt = named[2];
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
  const run = routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ?? routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ?? routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ?? routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun) ?? routed(USER_PROMPT_GATES, name, request, userPromptRun, loudRun) ?? routed(SUBAGENT_STOP_GATES, name, request, subagentStopRun, loudRun);
  return run ?? gateErrorRun(`${THE_GATE_ENTRY_POINT} (unknown gate '${name ?? ""}')`);
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

// core/src/routes/render.ts
var UNKNOWN_TOOL_MATCHER = ".*";
var DEPLOY_SHAPED_TOOL_NAMES = {
  claude: "mcp__.*deploy.*",
  codex: "mcp__.*deploy.*",
  opencode: ".*deploy.*"
};
var OPENCODE_HOOKS = [
  "tool.execute.before",
  "experimental.chat.system.transform",
  "event",
  "dispose"
];
function openCodeRoutes() {
  return GATE_ROWS.filter((row) => row.wiring.opencode === "wired").map((row) => ({
    hook: openCodeHookNamed(row.mechanism.opencode, row.gate),
    gate: row.gate,
    matcher: matcherFor("opencode", row),
    allow: row.gate === "unknown" ? toolNamesFor("opencode", "unknown") : []
  }));
}
function openCodeHookNamed(mechanism, gate) {
  const hook = OPENCODE_HOOKS.find((candidate) => candidate === mechanism);
  if (hook === void 0) throw new Error(`gate ${gate} names no OpenCode hook the adapter routes: ${mechanism}`);
  return hook;
}
function matcherFor(host, row) {
  const named = toolNamesFor(host, row.gate).join("|");
  if (row.gate === "unknown") return UNKNOWN_TOOL_MATCHER;
  if (row.gate === "handoff") return `^(${named})$`;
  if (row.gate === "proddeploy") return `${named}|${DEPLOY_SHAPED_TOOL_NAMES[host]}`;
  return named;
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

// opencode/plugin/oso/identity.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync6, readFileSync as readFileSync7, statSync as statSync6 } from "node:fs";
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
    if (existsSync6(dotGit)) {
      let isDir = false;
      try {
        isDir = statSync6(dotGit).isDirectory();
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
  return existsSync6(join(dotGit, "HEAD")) && existsSync6(join(dotGit, "objects"));
}
function worktreeGitDir(dotGit, baseDir) {
  let content;
  try {
    content = readFileSync7(dotGit, "utf8");
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
  const path12 = isAbsolute(raw) ? raw : join(baseDir, raw);
  return resolve(path12);
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
function cancelApprovedPlan(directory, owner) {
  writeStateValues(directory, owner, [
    "mode=plan",
    "active_slice=none",
    "verify_green=false",
    "plan_approval=cancelled"
  ]);
}
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
  cancelApprovedPlan(directory, owner);
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

// opencode/plugin/oso/verdict.ts
var STATUS_LINE = /^\s*status\s*:\s*(done|blocked)\s*$/i;
var VERDICT_LINE = /^\s*verdict\s*:\s*(pass|fail)\s*$/i;
function parseAgentVerdict(text) {
  const parsed = { matched: false };
  for (const line of text.split(/\r?\n/)) {
    const statusMatch = line.match(STATUS_LINE);
    if (statusMatch !== null) {
      parsed.status = statusMatch[1].toLowerCase();
      parsed.matched = true;
      continue;
    }
    const verdictMatch = line.match(VERDICT_LINE);
    if (verdictMatch !== null) {
      parsed.verdict = verdictMatch[1].toLowerCase();
      parsed.matched = true;
    }
  }
  return parsed;
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
  verifier: "oso-verifier"
};
async function pinChildSession(launch, projectCommonDir, request) {
  const rejection = worktreeRejection(launch.worktree, projectCommonDir);
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
    return { state: "unpinnable", launch, reason: `the child session could not be created: ${messageOf(error)}` };
  }
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
        prompt: child.launch.prompt
      }),
      request.timeoutMs
    );
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
    const failure = `the child turn did not complete: ${messageOf(error)}`;
    return {
      outcome: "blocked",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      reason: unstopped === void 0 ? failure : `${failure}; ${unstopped}`
    };
  }
}
var ABORT_BOUND_MS = 1e4;
async function stopChild(sessionID, directory, transport) {
  try {
    await withinBound(() => transport.abort({ sessionID, directory }), ABORT_BOUND_MS);
    return void 0;
  } catch (error) {
    return `the child session was left running: ${messageOf(error)}`;
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
    throw new Error(messageOf(result.error));
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
function messageOf(error) {
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
  const filePath = args.filePath;
  return hostEnvelope(callerFor(cwd), {
    sessionId: input.sessionID ?? "",
    cwd,
    toolName: input.tool,
    commandLine: commandLineFor(args),
    filePath: typeof filePath === "string" ? filePath : ""
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
      `the installed gate route table carries a matcher no regular expression compiles from: ${JSON.stringify(matcher)} (${messageOf(err)})`
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
    return { kind: "unusable", detail: `the ${route.gate} gate could not run: ${messageOf(err)}` };
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
var childSessions = /* @__PURE__ */ new Set();
var driving = /* @__PURE__ */ new Set();
function recordSessionLineage(properties) {
  const info = properties?.info;
  const id = info?.id;
  const parentID = info?.parentID;
  if (typeof id === "string" && id !== "" && typeof parentID === "string" && parentID !== "") {
    childSessions.add(id);
  }
}
function continueUnattendedRun(request) {
  if (request.sessionID === "" || childSessions.has(request.sessionID)) {
    return Promise.resolve({ kind: "not-this-runs-session" });
  }
  if (driving.has(request.sessionID)) {
    return Promise.resolve({ kind: "already-driving" });
  }
  driving.add(request.sessionID);
  return postUntilTheRunStops(request).catch((error) => standDownTraced(request, `the continuation rail failed: ${messageOf(error)}`, 0)).finally(() => {
    driving.delete(request.sessionID);
  });
}
async function postUntilTheRunStops(request) {
  let turns = 0;
  for (; ; ) {
    let order;
    try {
      order = nextContinuationOrder(request);
    } catch (error) {
      return standDownTraced(request, `the unattended run could not be read: ${messageOf(error)}`, turns);
    }
    if (order === void 0) {
      return { kind: "stood-down", turns };
    }
    try {
      await postContinuationTurn(request, order);
    } catch (error) {
      return standDownTraced(request, `the continuation turn did not land: ${messageOf(error)}`, turns);
    }
    turns += 1;
  }
}
function nextContinuationOrder(request) {
  const envelope = hostEnvelope(callerFor(request.directory), {
    sessionId: request.sessionID,
    cwd: request.directory
  });
  const run = runGate(["autocontinue"], envelope);
  for (const event of run.events) {
    logEvent(event);
  }
  return run.verdict.kind === "push" ? run.verdict.reason : void 0;
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
  recordTrace({
    origin: "auto-continue",
    detail: reason,
    severity: "advisory",
    sessionID: request.sessionID,
    client: request.client
  });
  return { kind: "failed", reason, turns };
}

// opencode/plugin/oso/lifecycle.ts
import { spawnSync } from "node:child_process";
import { readdirSync as readdirSync3, readFileSync as readFileSync8, rmSync as rmSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname3, join as join2 } from "node:path";
var MARKER_PREFIX2 = "oso-live-";
var MARKER_SUFFIX = ".json";
function markerPath(commonDir, sessionId) {
  return join2(commonDir, `${MARKER_PREFIX2}${sessionId}${MARKER_SUFFIX}`);
}
function readMarkerFile(path12) {
  try {
    return normalizeMarker(JSON.parse(readFileSync8(path12, "utf8")));
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
    if (!entry.startsWith(MARKER_PREFIX2) || !entry.endsWith(MARKER_SUFFIX)) {
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
    for (const path12 of marker.worktrees) {
      orphans.push({ path: path12, sessionId: marker.sessionId });
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
  writeFileSync4(markerPath(commonDir, sessionId), JSON.stringify(marker));
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
    for (const path12 of marker.worktrees) {
      if (removeWorktree(commonDir, path12, git)) {
        reaped.push(path12);
      } else {
        left.push(path12);
        tornDown = false;
      }
    }
    if (tornDown) {
      dropMarkerQuietly(commonDir, marker.sessionId);
    }
  }
  return { reaped, left };
}
function removeWorktree(commonDir, path12, git) {
  const cwd = dirname3(commonDir);
  if (!runGit(git, ["worktree", "remove", path12], cwd)) {
    return false;
  }
  runGit(git, ["worktree", "prune"], cwd);
  return true;
}
function runGit(git, args, cwd) {
  try {
    const result = spawnSync(git, args, { cwd, encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}
function dropMarkerQuietly(commonDir, sessionId) {
  try {
    rmSync6(markerPath(commonDir, sessionId), { force: true });
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
            prompt: { type: "string", description: "The full assignment the child receives as its first and only turn." }
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
  const { worktree, agent, prompt } = record;
  if (typeof worktree !== "string" || worktree === "") {
    throw new Error(`oso_wave child ${index} needs a worktree path, not ${JSON.stringify(worktree)}`);
  }
  if (!isWaveAgent(agent)) {
    throw new Error(`oso_wave child ${index} needs agent "applier" or "verifier", not ${JSON.stringify(agent)}`);
  }
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error(`oso_wave child ${index} needs a prompt`);
  }
  return { worktree, agent, prompt };
}
function isWaveAgent(value) {
  return value === "applier" || value === "verifier";
}
function waveTitle(results) {
  const blocked2 = blockedCount(results);
  if (blocked2 === 0) {
    return `wave: ${results.length} children reported`;
  }
  return `wave: ${results.length} children, ${blocked2} blocked`;
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
      detail: messageOf(err),
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
var orphanAdviceValue;
function orphanWorktreeAdviceOnce(directory, client) {
  if (orphanAdviceValue === void 0) {
    try {
      orphanAdviceValue = buildStaleAdvice(listStale(commonDirOf(directory)));
    } catch (err) {
      orphanAdviceValue = "";
      recordTrace({ origin: "lifecycle.orphan-advice", detail: messageOf(err), severity: "advisory", client });
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
    recordTrace({ origin: "session.idle", detail: messageOf(err), severity: "advisory", sessionID, client });
  }
}
var osoCode = async (pluginInput) => {
  const client = pluginInput?.client;
  const directory = pluginInput?.directory ?? process.cwd();
  try {
    sweepStale(commonDirOf(directory));
  } catch (err) {
    recordTrace({ origin: "lifecycle.sweep", detail: messageOf(err), severity: "advisory", client });
  }
  registerWorkspaceAdapter({ experimentalWorkspace: pluginInput?.experimental_workspace, client });
  try {
    assertGateRoutesCompile(routes);
  } catch (err) {
    recordTrace({ origin: "gate-routes", detail: messageOf(err), severity: "enforcement", client });
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
        recordTrace({ origin: "shell.env", detail: messageOf(err), severity: "advisory", sessionID, client });
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
      if (event.type === "session.created") {
        recordSessionLineage(event.properties);
        return;
      }
      if (event.type === "session.idle") {
        markSessionLive(sessionID, directory, client);
        dropSystemAdvice(pendingAdvice, sessionID);
        continueUnattendedRun({ sessionID, directory, session: client?.session, client });
        return;
      }
      if (event.type === "session.compacted") {
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
        recordTrace({ origin: "system.transform", detail: messageOf(err), severity: "advisory", sessionID, client });
      }
    },
    "experimental.session.compacting": async () => {
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
    }
  };
};
export {
  osoCode
};
