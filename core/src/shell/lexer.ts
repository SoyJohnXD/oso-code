export type LexRecord =
  | { readonly kind: "commandWord"; readonly word: string }
  | { readonly kind: "argument"; readonly word: string }
  | { readonly kind: "stdinText"; readonly text: string }
  | { readonly kind: "unreadPayload" };

export const MAX_LEXED_INPUT_BYTES = 3072;
export const UNREAD_PAYLOAD_MARKER = "!unread-payload";

const MAX_PAYLOAD_DEPTH = 3;
const SPECIAL_CHARACTERS = "'\"\\$`#;&|(){}<> \t\n";
const QUOTED_SPECIAL_CHARACTERS = "\"\\$`";
const WORD_DELIMITERS = " \t\n;&|()<>";
const UNREAD_PAYLOAD: LexRecord = { kind: "unreadPayload" };

const COPROCESS_WORD = "coproc";
const COPROCESS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PREFIX_WORDS = new Set([
  "env", "command", "builtin", "exec", "nice", "nohup", "time", "timeout", "stdbuf",
  "sudo", "doas", "setsid", "xargs", "flock", "ionice", "chrt", "taskset", "unbuffer",
  "then", "else", "elif", "do", "done", "fi", "in", "until", "while", "if", "for",
  "case", "esac", "select", "function", "!", COPROCESS_WORD,
]);
const SHELL_INTERPRETERS = new Set(["bash", "sh", "dash", "zsh", "ksh"]);
const COMMAND_FLAG_READERS = new Set([...SHELL_INTERPRETERS, "script"]);
const SHELL_COMMAND_FLAG = "c";
const CALLBACK_FLAG = "C";
const CALLBACK_FLAG_READERS = new Set(["mapfile", "readarray", "compgen", "complete"]);
const TMUX_SUBCOMMANDS_RUNNING_A_COMMAND = new Set([
  "new-session", "new", "new-window", "neww", "split-window", "splitw",
  "respawn-pane", "respawnp", "respawn-window", "respawnw", "run-shell", "run",
]);
const SOURCING_BUILTINS = new Set(["source", "."]);
const EVAL_WORD = "eval";
const REMOTE_SHELL_WORD = "ssh";
const TERMINAL_MULTIPLEXER_WORD = "tmux";
const TRAP_WORD = "trap";
const TRAP_ARGUMENTS_LEAVING_NO_ACTION = new Set(["-l", "-p", "-"]);
const END_OF_OPTIONS = "--";
const ALIAS_WORD = "alias";
const HISTORY_REPLAYING_WORD = "fc";
const ALIAS_DEFINITION = /^[^-=][^=]*=/;
const ASSIGNMENT_NAMING_A_FILE_THE_SHELL_SOURCES = /^BASH_ENV=/;

export const SHELL_WORDS_THIS_LEXER_READS: ReadonlySet<string> = new Set([
  ...PREFIX_WORDS, ...COMMAND_FLAG_READERS, ...CALLBACK_FLAG_READERS, ...SOURCING_BUILTINS,
  EVAL_WORD, REMOTE_SHELL_WORD, TERMINAL_MULTIPLEXER_WORD, TRAP_WORD, ALIAS_WORD,
  HISTORY_REPLAYING_WORD, "{", "}",
]);

export function lexShellCommands(commandLine: string): readonly LexRecord[] {
  return new CommandLineLexer(commandLine, 0).lex();
}

export function basenameOf(word: string): string {
  const lastSlash = word.lastIndexOf("/");
  return lastSlash === -1 ? word : word.slice(lastSlash + 1);
}

function isShellInterpreter(word: string): boolean {
  return SHELL_INTERPRETERS.has(basenameOf(word));
}

function readsACommandFlag(word: string): boolean {
  return COMMAND_FLAG_READERS.has(basenameOf(word));
}

function readsACallbackFlag(word: string): boolean {
  return CALLBACK_FLAG_READERS.has(basenameOf(word));
}

function definesAnAlias(word: string): boolean {
  return ALIAS_DEFINITION.test(word);
}

function namesAFileTheShellSources(assignment: string): boolean {
  return ASSIGNMENT_NAMING_A_FILE_THE_SHELL_SOURCES.test(assignment);
}

function withoutACoprocessName(words: readonly string[]): readonly string[] {
  const trailing = words.at(-1);
  if (trailing === undefined || words.at(-2) !== COPROCESS_WORD) return words;
  return COPROCESS_NAME.test(trailing) ? words.slice(0, -1) : words;
}

function isCommandPrefixWord(word: string): boolean {
  if (/^[A-Za-z_][\s\S]*=/.test(word)) return true;
  if (word.startsWith("-")) return true;
  if (!/[^0-9]/.test(word)) return word !== "";
  return PREFIX_WORDS.has(basenameOf(word));
}

function completesItsWordsFromStdin(word: string): boolean {
  return basenameOf(word) === "xargs";
}

function isSourcingBuiltin(word: string): boolean {
  return SOURCING_BUILTINS.has(word);
}

function withSpacesForNewlines(text: string): string {
  return text.replaceAll("\n", " ");
}

function leadingRunWithout(text: string, stoppers: string): string {
  let length = 0;
  while (length < text.length && !stoppers.includes(text[length] as string)) length += 1;
  return text.slice(0, length);
}

type DecodedSpan = Readonly<{ text: string; length: number }>;

const ANSI_C_NAMED_ESCAPES: Readonly<Record<string, string>> = {
  a: "\u0007", b: "\b", e: "\u001b", E: "\u001b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
  "\\": "\\", "'": "'", '"': '"', "?": "?",
};
const ANSI_C_HEX_ESCAPE_WIDTHS: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };
const OCTAL_ESCAPE_WIDTH = 3;
const OCTAL_DIGIT = /^[0-7]$/;
const HEX_DIGIT = /^[0-9A-Fa-f]$/;
const OCTAL_ESCAPE_MASK = 0xff;
const CONTROL_ESCAPE_MASK = 0x1f;
const DELETE_CODE_POINT = 0x7f;
const HIGHEST_CODE_POINT = 0x10ffff;
const STRING_TERMINATOR = "\0";

function ansiCQuoted(body: string): DecodedSpan {
  const decoded = ansiCDecoded(body);
  const terminator = decoded.text.indexOf(STRING_TERMINATOR);
  return terminator === -1 ? decoded : { text: decoded.text.slice(0, terminator), length: decoded.length };
}

function ansiCDecoded(body: string): DecodedSpan {
  let text = "";
  let at = 0;
  while (at < body.length) {
    const character = body[at] as string;
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

function ansiCEscapeAt(body: string, at: number): DecodedSpan {
  const marker = body[at];
  if (marker === undefined) return { text: "\\", length: 0 };
  const named = ANSI_C_NAMED_ESCAPES[marker];
  if (named !== undefined) return { text: named, length: 1 };
  if (OCTAL_DIGIT.test(marker)) return octalEscape(body.slice(at));
  const decoded = markedEscape(marker, body.slice(at + 1));
  if (decoded === undefined) return { text: `\\${marker}`, length: 1 };
  return { text: decoded.text, length: 1 + decoded.length };
}

function markedEscape(marker: string, rest: string): DecodedSpan | undefined {
  if (marker === "c") return controlEscape(rest);
  const hexWidth = ANSI_C_HEX_ESCAPE_WIDTHS[marker];
  return hexWidth === undefined ? undefined : hexEscape(rest, hexWidth);
}

function octalEscape(digitsAndRest: string): DecodedSpan {
  const digits = leadingRunOf(digitsAndRest, OCTAL_DIGIT, OCTAL_ESCAPE_WIDTH);
  return { text: String.fromCharCode(parseInt(digits, 8) & OCTAL_ESCAPE_MASK), length: digits.length };
}

function hexEscape(rest: string, width: number): DecodedSpan | undefined {
  const digits = leadingRunOf(rest, HEX_DIGIT, width);
  if (digits === "") return undefined;
  const code = parseInt(digits, 16);
  if (code > HIGHEST_CODE_POINT) return undefined;
  return { text: String.fromCodePoint(code), length: digits.length };
}

function controlEscape(rest: string): DecodedSpan | undefined {
  if (rest === "") return undefined;
  const spelledAsAnEscape = rest.startsWith("\\\\");
  const controlled = spelledAsAnEscape ? "\\" : (rest[0] as string);
  const length = spelledAsAnEscape ? 2 : 1;
  if (controlled === "?") return { text: String.fromCharCode(DELETE_CODE_POINT), length };
  return { text: String.fromCharCode(controlled.toUpperCase().charCodeAt(0) & CONTROL_ESCAPE_MASK), length };
}

function leadingRunOf(text: string, digit: RegExp, width: number): string {
  let length = 0;
  while (length < width && length < text.length && digit.test(text[length] as string)) length += 1;
  return text.slice(0, length);
}

type OperandSplit = Readonly<{ operand: string; rest: readonly string[]; behindAnOption: boolean }>;

function splitAtTheFirstOperand(words: readonly string[]): OperandSplit | undefined {
  const at = words.findIndex((word) => !word.startsWith("-"));
  if (at === -1) return undefined;
  return { operand: words[at] as string, rest: words.slice(at + 1), behindAnOption: at > 0 };
}

type PendingHeredoc = { readonly delimiter: string; readonly stripsTabs: boolean };

class CommandLineLexer {
  private rest: string;
  private readonly depth: number;
  private token = "";
  private tokenOpen = false;
  private redirectTargetPending = false;
  private herestringPending = false;
  private pendingHeredocs: PendingHeredoc[] = [];
  private nested: LexRecord[] = [];
  private unreadStdin = "";
  private commandTokens: string[] = [];
  private readonly records: LexRecord[] = [];

  constructor(commandLine: string, depth: number) {
    this.rest = `${commandLine}\n`;
    this.depth = depth;
  }

  lex(): readonly LexRecord[] {
    if (Buffer.byteLength(this.rest, "utf8") > MAX_LEXED_INPUT_BYTES) return [UNREAD_PAYLOAD];
    while (this.rest !== "") this.takeNext();
    this.endToken();
    this.takeHeredocBodies();
    this.endCommand();
    return this.records;
  }

  private takeNext(): void {
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

  private takeSpecial(character: string): void {
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
      case "\t":
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

  private takeBrace(brace: string): void {
    if (this.braceStandsAsAReservedWord()) {
      this.endCommand();
      return;
    }
    this.token += brace;
    this.tokenOpen = true;
  }

  private braceStandsAsAReservedWord(): boolean {
    if (this.tokenOpen || this.rest === "") return false;
    if (!withoutACoprocessName(this.commandTokens).every(isCommandPrefixWord)) return false;
    return WORD_DELIMITERS.includes(this.rest.slice(0, 1));
  }

  private endToken(): void {
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

  private endCommand(): void {
    this.endToken();
    this.stripCommandPrefixes();
    this.deferPayloadCommands();
    this.emitCommand();
    this.commandTokens = [];
    this.nested = [];
    this.unreadStdin = "";
    this.redirectTargetPending = false;
  }

  private stripCommandPrefixes(): void {
    let prefixWord = "";
    let stdinCompletesTheWords = false;
    while (this.commandTokens.length > 0) {
      const leading = this.commandTokens[0] as string;
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

  private deferPayloadCommands(): void {
    const leading = this.commandTokens[0];
    if (leading === undefined) return;
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

  private deferTrapAction(): void {
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

  private deferRemoteShellPayload(): void {
    const host = splitAtTheFirstOperand(this.commandTokens.slice(1));
    if (host === undefined) return;
    this.deferOperandPayload(host.rest, host.behindAnOption);
  }

  private deferTmuxPayload(): void {
    const subcommand = splitAtTheFirstOperand(this.commandTokens.slice(1));
    if (subcommand === undefined) return;
    if (!TMUX_SUBCOMMANDS_RUNNING_A_COMMAND.has(subcommand.operand)) {
      if (subcommand.behindAnOption) this.markUnread();
      return;
    }
    this.deferOperandPayload(subcommand.rest, false);
  }

  private deferOperandPayload(words: readonly string[], selectorUnresolved: boolean): void {
    const payload = splitAtTheFirstOperand(words);
    if (payload === undefined) return;
    if (selectorUnresolved || payload.behindAnOption) this.markUnread();
    this.deferNestedCommands([payload.operand, ...payload.rest].join(" "));
  }

  private deferInterpreterPayload(): void {
    this.deferOptionValueAsACommand(SHELL_COMMAND_FLAG);
    if (this.nested.length === 0) this.markUnread();
  }

  private deferOptionValueAsACommand(commandFlag: string): void {
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

  private deferNestedCommands(payload: string): void {
    if (payload === "") return;
    if (this.depth >= MAX_PAYLOAD_DEPTH) {
      this.markUnread();
      return;
    }
    this.nested.push(...new CommandLineLexer(payload, this.depth + 1).lex());
  }

  private markUnread(): void {
    this.nested.push(UNREAD_PAYLOAD);
  }

  private emitCommand(): void {
    this.commandTokens.forEach((word, index) => {
      this.records.push(
        index === 0
          ? { kind: "commandWord", word: withSpacesForNewlines(word) }
          : { kind: "argument", word: withSpacesForNewlines(word) },
      );
    });
    if (this.unreadStdin !== "") {
      this.records.push({ kind: "stdinText", text: withSpacesForNewlines(this.unreadStdin) });
    }
    this.records.push(...this.nested);
  }

  private takeEscape(): void {
    if (this.rest.startsWith("\n")) {
      this.rest = this.rest.slice(1);
      return;
    }
    this.token += this.rest.slice(0, 1);
    this.tokenOpen = true;
    this.rest = this.rest.slice(1);
  }

  private takeSingleQuoted(): void {
    const span = this.spanBefore("'");
    this.token += span;
    this.rest = this.rest.slice(span.length + 1);
  }

  private takeDoubleQuoted(): void {
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

  private takeDollar(): void {
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

  private takeLocaleTranslated(): void {
    this.markUnread();
    this.takeDoubleQuoted();
  }

  private takeAnsiCQuoted(): void {
    const quoted = ansiCQuoted(this.rest);
    this.token += quoted.text;
    this.rest = this.rest.slice(quoted.length);
  }

  private takeExpansion(): void {
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

  private takeSubstitutionBody(): string {
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

  private takeBacktick(): void {
    const span = this.spanBefore("`");
    this.token += "$";
    this.rest = this.rest.slice(span.length + 1);
    this.deferNestedCommands(span);
  }

  private dropComment(): void {
    this.rest = this.rest.slice(this.spanBefore("\n").length);
  }

  private takeRedirect(): void {
    this.redirectTargetPending = true;
    while (this.rest !== "" && ">&|".includes(this.rest.slice(0, 1))) {
      this.rest = this.rest.slice(1);
    }
  }

  private takeInputRedirect(): void {
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

  private takeHeredocDelimiter(): string {
    let delimiter = "";
    while (this.rest !== "") {
      const leading = this.rest.slice(0, 1);
      if (leading === " " || leading === "\t") {
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

  private takeHeredocBodies(): void {
    if (this.pendingHeredocs.length === 0) return;
    this.stripCommandPrefixes();
    while (this.pendingHeredocs.length > 0) {
      const heredoc = this.pendingHeredocs.shift() as PendingHeredoc;
      const body = this.takeHeredocBody(heredoc);
      if (isShellInterpreter(this.commandTokens[0] ?? "")) this.deferNestedCommands(body);
      else this.unreadStdin += body;
    }
  }

  private takeHeredocBody(heredoc: PendingHeredoc): string {
    if (heredoc.stripsTabs) return this.takeBodyByLines(heredoc);
    return this.takeBodyToTerminator(heredoc.delimiter) ?? this.takeBodyByLines(heredoc);
  }

  private takeBodyToTerminator(delimiter: string): string | undefined {
    const at = this.rest.indexOf(`\n${delimiter}\n`);
    if (at === -1) return undefined;
    const body = this.rest.slice(0, at);
    this.rest = this.rest.slice(body.length + delimiter.length + 2);
    return body;
  }

  private takeBodyByLines(heredoc: PendingHeredoc): string {
    let body = "";
    while (this.rest !== "") {
      const line = this.spanBefore("\n");
      this.rest = this.rest.slice(line.length + 1);
      const probe = heredoc.stripsTabs ? line.replace(/^\t+/, "") : line;
      if (probe === heredoc.delimiter) return body;
      body += `${line}\n`;
    }
    return body;
  }

  private spanBefore(stopper: string): string {
    const at = this.rest.indexOf(stopper);
    return at === -1 ? this.rest : this.rest.slice(0, at);
  }
}
