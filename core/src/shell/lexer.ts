import { runsAReplaceStringAsCode } from "./lexed-command.ts";

export type LexRecord =
  | { readonly kind: "commandWord"; readonly word: string }
  | { readonly kind: "argument"; readonly word: string }
  | { readonly kind: "stdinText"; readonly text: string }
  | { readonly kind: "unreadPayload" };

export const MAX_LEXED_INPUT_BYTES = 32768;
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
const ASSIGNMENT = /^[A-Za-z_][\s\S]*=/;
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

function lengthWithoutACoprocessName(words: readonly string[]): number {
  const trailing = words.at(-1);
  if (trailing === undefined || words.at(-2) !== COPROCESS_WORD) return words.length;
  return COPROCESS_NAME.test(trailing) ? words.length - 1 : words.length;
}

function isAssignment(word: string): boolean {
  return ASSIGNMENT.test(word);
}

function isCommandPrefixWord(word: string): boolean {
  if (isAssignment(word)) return true;
  if (word.startsWith("-")) return true;
  if (!/[^0-9]/.test(word)) return word !== "";
  return PREFIX_WORDS.has(basenameOf(word));
}

function completesItsWordsFromStdin(word: string): boolean {
  return basenameOf(word) === "xargs";
}

function handsStdinAProgramToRun(prefixWords: readonly string[]): boolean {
  const xargsAt = prefixWords.findIndex(completesItsWordsFromStdin);
  return xargsAt !== -1 && prefixWords.slice(xargsAt + 1).some((word) => PREFIX_WORDS.has(basenameOf(word)));
}

function recordCarries(record: LexRecord, text: string): boolean {
  if (record.kind === "commandWord" || record.kind === "argument") return record.word.includes(text);
  return record.kind === "stdinText" && record.text.includes(text);
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

type OptionTable = Readonly<{
  takingAValue: readonly string[];
  takingAnAttachedValueOnly: readonly string[];
  standingAlone: readonly string[];
}>;

const COMMAND_OPTIONS: OptionTable = {
  takingAValue: [],
  takingAnAttachedValueOnly: [],
  standingAlone: ["-p", "-v", "-V"],
};
const COMMAND_LOOKUP_OPTIONS = new Set(["-v", "-V"]);
const XARGS_OPTIONS: OptionTable = {
  takingAValue: [
    "-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s",
    "--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-chars",
  ],
  takingAnAttachedValueOnly: ["-i", "-e", "-l"],
  standingAlone: ["-0", "-o", "-p", "-r", "-t", "-x"],
};
const XARGS_REPLACE_OPTION = "-I";
const XARGS_DEFAULTED_REPLACE_OPTION = "-i";
const XARGS_DEFAULT_REPLACE_STRING = "{}";
const ENV_OPTIONS: OptionTable = {
  takingAValue: ["-u"],
  takingAnAttachedValueOnly: [],
  standingAlone: ["-i", "-0", "-v", "-"],
};
const TIMEOUT_OPTIONS: OptionTable = {
  takingAValue: ["-s", "-k"],
  takingAnAttachedValueOnly: [],
  standingAlone: ["--preserve-status", "--foreground", "-v"],
};
const TIMEOUT_DURATION = /^[0-9]+(\.[0-9]+)?[smhd]?$/;
const FLOCK_OPTIONS: OptionTable = {
  takingAValue: ["-E", "-w"],
  takingAnAttachedValueOnly: [],
  standingAlone: ["-s", "-x", "-u", "-n", "-o"],
};
const FLOCK_LOCK_FILE_OR_DESCRIPTOR = /^[\s\S]+$/;
const FLOCK_COMMAND_OPTIONS = new Set(["-c", "--command"]);
const TASKSET_OPTIONS: OptionTable = {
  takingAValue: [],
  takingAnAttachedValueOnly: [],
  standingAlone: ["-a", "-c"],
};
const TASKSET_MASK_OR_CPU_LIST = /^((0[xX])?[0-9A-Fa-f]+|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)$/;

type KeyedPrefixReading =
  | Readonly<{ kind: "read"; next: number; replaceString: string | undefined }>
  | Readonly<{ kind: "standsAsTheCommand"; payload: string }>
  | Readonly<{ kind: "operandOutsideItsGrammar" }>
  | Readonly<{ kind: "shapeItDoesNotKnow" }>;

const A_SHAPE_IT_DOES_NOT_KNOW: KeyedPrefixReading = { kind: "shapeItDoesNotKnow" };
const AN_OPERAND_OUTSIDE_ITS_GRAMMAR: KeyedPrefixReading = { kind: "operandOutsideItsGrammar" };
const A_LOOKUP_RUNNING_NOTHING: KeyedPrefixReading = { kind: "standsAsTheCommand", payload: "" };

const KEYED_PREFIX_READERS: ReadonlyMap<string, (words: readonly string[], from: number) => KeyedPrefixReading> =
  new Map([
    ["command", readCommandOptions],
    ["xargs", readXargsOptions],
    ["env", (words, from) => readThroughOptions(ENV_OPTIONS, words, from)],
    ["timeout", (words, from) => readThroughOperand(TIMEOUT_OPTIONS, TIMEOUT_DURATION, words, from)],
    ["flock", readFlockOptions],
    ["taskset", (words, from) => readThroughOperand(TASKSET_OPTIONS, TASKSET_MASK_OR_CPU_LIST, words, from)],
  ]);

type PrefixCut = Readonly<{
  length: number;
  leavesTheCommandUnread: boolean;
  replaceString: string | undefined;
  payload: string;
}>;

function prefixCutOf(words: readonly string[]): PrefixCut {
  let at = 0;
  let endsOnAnUnresolvedOption = false;
  let operandOutsideItsGrammar = false;
  let replaceString: string | undefined;
  let payload = "";
  while (at < words.length) {
    const word = words[at] as string;
    const reading = keyedPrefixReading(word, words, at + 1);
    if (reading.kind === "standsAsTheCommand") {
      payload = reading.payload;
      break;
    }
    if (reading.kind === "read") {
      at = reading.next;
      replaceString = reading.replaceString ?? replaceString;
      endsOnAnUnresolvedOption = false;
      continue;
    }
    if (reading.kind === "operandOutsideItsGrammar") operandOutsideItsGrammar = true;
    if (!isCommandPrefixWord(word)) break;
    endsOnAnUnresolvedOption = word.startsWith("-");
    at += 1;
  }
  const leavesTheCommandUnread = endsOnAnUnresolvedOption || operandOutsideItsGrammar;
  return { length: at, leavesTheCommandUnread, replaceString, payload };
}

function keyedPrefixReading(word: string, words: readonly string[], from: number): KeyedPrefixReading {
  if (isAssignment(word)) return A_SHAPE_IT_DOES_NOT_KNOW;
  const reader = KEYED_PREFIX_READERS.get(basenameOf(word));
  return reader === undefined ? A_SHAPE_IT_DOES_NOT_KNOW : reader(words, from);
}

function readCommandOptions(words: readonly string[], from: number): KeyedPrefixReading {
  const read = optionsRead(COMMAND_OPTIONS, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  if (read.options.some(({ option }) => COMMAND_LOOKUP_OPTIONS.has(option))) return A_LOOKUP_RUNNING_NOTHING;
  return { kind: "read", next: read.next, replaceString: undefined };
}

function readXargsOptions(words: readonly string[], from: number): KeyedPrefixReading {
  const read = optionsRead(XARGS_OPTIONS, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  return { kind: "read", next: read.next, replaceString: replaceStringOf(read.options) };
}

function replaceStringOf(options: readonly OptionRead[]): string | undefined {
  const replacing = options
    .filter(({ option }) => option === XARGS_REPLACE_OPTION || option === XARGS_DEFAULTED_REPLACE_OPTION)
    .at(-1);
  if (replacing === undefined) return undefined;
  const defaulted = replacing.option === XARGS_DEFAULTED_REPLACE_OPTION && replacing.value === "";
  return defaulted ? XARGS_DEFAULT_REPLACE_STRING : replacing.value;
}

function readFlockOptions(words: readonly string[], from: number): KeyedPrefixReading {
  const reading = readThroughOperand(FLOCK_OPTIONS, FLOCK_LOCK_FILE_OR_DESCRIPTOR, words, from);
  if (reading.kind !== "read" || !FLOCK_COMMAND_OPTIONS.has(words[reading.next] ?? "")) return reading;
  return { kind: "standsAsTheCommand", payload: words[reading.next + 1] ?? "" };
}

function readThroughOptions(table: OptionTable, words: readonly string[], from: number): KeyedPrefixReading {
  const read = optionsRead(table, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  return { kind: "read", next: read.next, replaceString: undefined };
}

function readThroughOperand(
  table: OptionTable,
  operandGrammar: RegExp,
  words: readonly string[],
  from: number,
): KeyedPrefixReading {
  const read = optionsRead(table, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  const operand = words[read.next];
  if (operand === undefined) return { kind: "read", next: read.next, replaceString: undefined };
  if (!operandGrammar.test(operand)) return AN_OPERAND_OUTSIDE_ITS_GRAMMAR;
  return { kind: "read", next: read.next + 1, replaceString: undefined };
}

type OptionRead = Readonly<{ option: string; value: string }>;
type OptionsRead = Readonly<{ next: number; options: readonly OptionRead[] }>;
type SpelledOption = Readonly<{ name: string; attached: string | undefined }>;

function optionsRead(table: OptionTable, words: readonly string[], from: number): OptionsRead | undefined {
  const options: OptionRead[] = [];
  let at = from;
  while ((words[at] ?? "").startsWith("-")) {
    const option = optionAt(table, words, at);
    if (option === undefined) return undefined;
    options.push(option.read);
    at = option.next;
  }
  return { next: at, options };
}

function optionAt(
  table: OptionTable,
  words: readonly string[],
  at: number,
): Readonly<{ read: OptionRead; next: number }> | undefined {
  const { name, attached } = spelledOption(words[at] as string);
  if (table.standingAlone.includes(name)) {
    return attached === undefined ? { read: { option: name, value: "" }, next: at + 1 } : undefined;
  }
  if (table.takingAnAttachedValueOnly.includes(name)) {
    return { read: { option: name, value: attached ?? "" }, next: at + 1 };
  }
  if (!table.takingAValue.includes(name)) return undefined;
  if (attached !== undefined) return { read: { option: name, value: attached }, next: at + 1 };
  const separate = words[at + 1];
  return separate === undefined ? undefined : { read: { option: name, value: separate }, next: at + 2 };
}

function spelledOption(word: string): SpelledOption {
  if (!word.startsWith("--")) {
    return { name: word.slice(0, 2), attached: word.length > 2 ? word.slice(2) : undefined };
  }
  const equals = word.indexOf("=");
  if (equals === -1) return { name: word, attached: undefined };
  return { name: word.slice(0, equals), attached: word.slice(equals + 1) };
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
  private leadingPrefixWords = 0;
  private replaceString: string | undefined;
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
    if (this.leadingPrefixWords < lengthWithoutACoprocessName(this.commandTokens)) return false;
    return WORD_DELIMITERS.includes(this.rest.slice(0, 1));
  }

  private endToken(): void {
    if (this.tokenOpen && this.redirectTargetPending) {
      this.redirectTargetPending = false;
    } else if (this.tokenOpen) {
      this.pushCommandToken(this.token);
      if (this.herestringPending) {
        this.herestringPending = false;
        this.deferNestedCommands(this.token);
      }
    }
    this.token = "";
    this.tokenOpen = false;
  }

  private pushCommandToken(word: string): void {
    if (this.leadingPrefixWords === this.commandTokens.length && isCommandPrefixWord(word)) {
      this.leadingPrefixWords += 1;
    }
    this.commandTokens.push(word);
  }

  private endCommand(): void {
    this.endToken();
    this.stripCommandPrefixes();
    this.deferPayloadCommands();
    this.markAReplaceStringRunAsCode();
    this.emitCommand();
    this.commandTokens = [];
    this.leadingPrefixWords = 0;
    this.replaceString = undefined;
    this.nested = [];
    this.unreadStdin = "";
    this.redirectTargetPending = false;
  }

  private stripCommandPrefixes(): void {
    if (this.leadingPrefixWords === 0) return;
    this.leadingPrefixWords = 0;
    const cut = prefixCutOf(this.commandTokens);
    const prefixWords = this.commandTokens.slice(0, cut.length);
    this.commandTokens = this.commandTokens.slice(cut.length);
    this.replaceString = cut.replaceString;
    for (const prefixWord of prefixWords) if (namesAFileTheShellSources(prefixWord)) this.markUnread();
    if (this.commandTokens.length === 0) {
      if (handsStdinAProgramToRun(prefixWords)) this.markUnread();
      return;
    }
    if (cut.leavesTheCommandUnread) this.markUnread();
    this.deferNestedCommands(cut.payload);
    if (prefixWords.some(completesItsWordsFromStdin)) this.unreadStdin += UNREAD_PAYLOAD_MARKER;
  }

  private markAReplaceStringRunAsCode(): void {
    const replaceString = this.replaceString;
    if (replaceString === undefined) return;
    const command = { tokens: this.commandTokens, stdin: this.unreadStdin };
    const inNestedPayload = this.nested.some((record) => recordCarries(record, replaceString));
    if (inNestedPayload || runsAReplaceStringAsCode(command, replaceString)) this.markUnread();
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
