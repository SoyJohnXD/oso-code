import { runsAReplaceStringAsCode } from "./lexed-command.ts";
import { basenameOf, UNREAD_PAYLOAD_MARKER } from "./lexed-word.ts";
import {
  COPROCESS_WORD,
  isAssignment,
  isCommandPrefixWord,
  PREFIX_WORDS,
  prefixCutOf,
  spelledOption,
  type SpelledOption,
} from "./prefix-words.ts";

export type LexRecord =
  | { readonly kind: "commandWord"; readonly word: string; readonly assignments: readonly string[] }
  | { readonly kind: "argument"; readonly word: string }
  | { readonly kind: "stdinText"; readonly text: string }
  | { readonly kind: "unreadPayload" };

export const MAX_LEXED_INPUT_BYTES = 32768;

const MAX_PAYLOAD_DEPTH = 3;
const SPECIAL_CHARACTERS = "'\"\\$`#;&|(){}<> \t\n";
const QUOTED_SPECIAL_CHARACTERS = "\"\\$`";
const WORD_DELIMITERS = " \t\n;&|()<>";
const ARITHMETIC_OPENING = "((";
const ARITHMETIC_EXPRESSION_CHARACTER = /^[0-9 \t+\-*/%<>=!&|^~?:,.]$/;
const DESCRIPTOR_NUMBER = /^[0-9]+$/;
const DESCRIPTOR_VARIABLE = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const UNREAD_PAYLOAD: LexRecord = { kind: "unreadPayload" };

const COPROCESS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
const RUNNER_CALL_IN_A_FLAG_BUNDLE = /^-[^-c=][^=]*c/;
const RUNNER_PACKAGE_OPTIONS = new Set(["-p", "--package"]);

export const SHELL_WORDS_THIS_LEXER_READS: ReadonlySet<string> = new Set([
  ...PREFIX_WORDS, ...COMMAND_FLAG_READERS, ...CALLBACK_FLAG_READERS, ...SOURCING_BUILTINS,
  EVAL_WORD, REMOTE_SHELL_WORD, TERMINAL_MULTIPLEXER_WORD, TRAP_WORD, ALIAS_WORD,
  HISTORY_REPLAYING_WORD, "{", "}",
]);

export function lexShellCommands(commandLine: string): readonly LexRecord[] {
  return new CommandLineLexer(commandLine, 0).lex();
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

function namesADescriptor(word: string): boolean {
  return DESCRIPTOR_NUMBER.test(word) || DESCRIPTOR_VARIABLE.test(word);
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

function arithmeticExpansionLength(text: string): number | undefined {
  if (!text.startsWith(ARITHMETIC_OPENING)) return undefined;
  let nesting = 0;
  for (let at = ARITHMETIC_OPENING.length; at < text.length; at += 1) {
    const character = text[at] as string;
    if (character === "(") {
      nesting += 1;
    } else if (character === ")" && nesting > 0) {
      nesting -= 1;
    } else if (character === ")") {
      return text[at + 1] === ")" ? at + 2 : undefined;
    } else if (!ARITHMETIC_EXPRESSION_CHARACTER.test(character)) {
      return undefined;
    }
  }
  return undefined;
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

type RunnerCall = Readonly<{ kind: "payload"; payload: string }> | Readonly<{ kind: "pastReading" }>;
type LeadingCallOption = RunnerCall | Readonly<{ kind: "callOption"; at: number; attached: string | undefined }>;
type PlacedSubcommand =
  | RunnerCall
  | Readonly<{ kind: "subcommand"; leadingOptions: readonly string[]; execArguments: readonly string[] }>;
type RunnerSubcommand = Readonly<{
  names: ReadonlySet<string>;
  callOptions: ReadonlySet<string>;
  callOf: (callArguments: readonly string[]) => RunnerCall;
}>;

const NO_RUNNER_CALL: RunnerCall = { kind: "payload", payload: "" };
const A_RUNNER_CALL_PAST_READING: RunnerCall = { kind: "pastReading" };

const NPM_CALL_OPTIONS: ReadonlySet<string> = new Set(["-c", "--c", "--call"]);
const PNPM_SHELL_MODE_OPTIONS: ReadonlySet<string> = new Set(["-c", "--shell-mode"]);
const YARN_EXEC_OPTIONS: ReadonlySet<string> = new Set();

const RUNNERS_CALLING_A_COMMAND: ReadonlyMap<string, (runnerArguments: readonly string[]) => RunnerCall> = new Map([
  ["npx", callOptionValueOf],
  ["pnpx", shellModeStringOf],
]);
const RUNNER_SUBCOMMANDS_CALLING_A_COMMAND: ReadonlyMap<string, RunnerSubcommand> = new Map([
  ["npm", { names: new Set(["exec", "x"]), callOptions: NPM_CALL_OPTIONS, callOf: callOptionValueOf }],
  ["pnpm", { names: new Set(["exec", "dlx"]), callOptions: PNPM_SHELL_MODE_OPTIONS, callOf: shellModeStringOf }],
  ["yarn", { names: new Set(["exec"]), callOptions: YARN_EXEC_OPTIONS, callOf: shellStringOf }],
]);

function runnerCallOf(words: readonly string[]): RunnerCall {
  const runner = basenameOf(words[0] ?? "");
  const runnerArguments = words.slice(1);
  const directCall = RUNNERS_CALLING_A_COMMAND.get(runner);
  if (directCall !== undefined) return directCall(runnerArguments);
  const subcommand = RUNNER_SUBCOMMANDS_CALLING_A_COMMAND.get(runner);
  if (subcommand === undefined) return NO_RUNNER_CALL;
  const placed = placedSubcommand(runnerArguments, subcommand.names);
  if (placed.kind !== "subcommand") return placed;
  const leadingCalls = placed.leadingOptions.filter((option) => spellsACallOption(option, subcommand.callOptions));
  return subcommand.callOf([...leadingCalls, ...placed.execArguments]);
}

function placedSubcommand(runnerArguments: readonly string[], names: ReadonlySet<string>): PlacedSubcommand {
  const first = operandIndexFrom(runnerArguments, 0);
  if (first === -1) return NO_RUNNER_CALL;
  const second = operandIndexFrom(runnerArguments, first + 1);
  const firstMayBeAnOptionValue = first > 0 && second !== -1 && names.has(runnerArguments[second] as string);
  if (firstMayBeAnOptionValue) return A_RUNNER_CALL_PAST_READING;
  if (!names.has(runnerArguments[first] as string)) return NO_RUNNER_CALL;
  return {
    kind: "subcommand",
    leadingOptions: runnerArguments.slice(0, first),
    execArguments: runnerArguments.slice(first + 1),
  };
}

function spellsACallOption(option: string, callOptions: ReadonlySet<string>): boolean {
  if (RUNNER_CALL_IN_A_FLAG_BUNDLE.test(option)) return true;
  return callOptions.has(runnerSpelledOption(option).name);
}

function operandIndexFrom(words: readonly string[], from: number): number {
  return words.findIndex((word, at) => at >= from && !word.startsWith("-"));
}

function callOptionValueOf(options: readonly string[]): RunnerCall {
  const call = leadingCallOption(options, NPM_CALL_OPTIONS);
  if (call.kind !== "callOption") return call;
  const valueAt = call.attached === undefined ? call.at + 1 : call.at;
  const value = call.attached ?? options[valueAt] ?? "";
  const anotherCallFollows = options.slice(valueAt + 1).some((option) => spellsACallOption(option, NPM_CALL_OPTIONS));
  if (value.startsWith("-") || anotherCallFollows) return A_RUNNER_CALL_PAST_READING;
  return { kind: "payload", payload: value };
}

function shellModeStringOf(options: readonly string[]): RunnerCall {
  const call = leadingCallOption(options, PNPM_SHELL_MODE_OPTIONS);
  if (call.kind !== "callOption") return call;
  return shellStringOf(options.slice(call.at + 1));
}

function shellStringOf(shellWords: readonly string[]): RunnerCall {
  if (shellWords[0]?.startsWith("-")) return A_RUNNER_CALL_PAST_READING;
  return { kind: "payload", payload: shellWords.join(" ") };
}

function leadingCallOption(options: readonly string[], callOptions: ReadonlySet<string>): LeadingCallOption {
  let anOptionMayHoldTheNextWord = false;
  let aWordWasReadAsAnOptionValue = false;
  for (let at = 0; at < options.length; at += 1) {
    const option = options[at] as string;
    if (option === END_OF_OPTIONS) return NO_RUNNER_CALL;
    if (!option.startsWith("-")) {
      if (!anOptionMayHoldTheNextWord) return NO_RUNNER_CALL;
      anOptionMayHoldTheNextWord = false;
      aWordWasReadAsAnOptionValue = true;
      continue;
    }
    if (RUNNER_CALL_IN_A_FLAG_BUNDLE.test(option)) return A_RUNNER_CALL_PAST_READING;
    const { name, attached } = runnerSpelledOption(option);
    if (callOptions.has(name)) {
      return aWordWasReadAsAnOptionValue ? A_RUNNER_CALL_PAST_READING : { kind: "callOption", at, attached };
    }
    const takesThePackage = RUNNER_PACKAGE_OPTIONS.has(name) && attached === undefined;
    if (takesThePackage) at += 1;
    anOptionMayHoldTheNextWord = !takesThePackage && attached === undefined;
  }
  return NO_RUNNER_CALL;
}

function runnerSpelledOption(option: string): SpelledOption {
  const spelled = spelledOption(option);
  if (option.startsWith("--") || !spelled.attached?.startsWith("=")) return spelled;
  return { name: spelled.name, attached: spelled.attached.slice(1) };
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
  private tokenHoldsAQuote = false;
  private redirectTargetPending = false;
  private herestringPending = false;
  private pendingHeredocs: PendingHeredoc[] = [];
  private nested: LexRecord[] = [];
  private unreadStdin = "";
  private commandTokens: string[] = [];
  private assignments: string[] = [];
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
        this.tokenHoldsAQuote = true;
        this.takeSingleQuoted();
        return;
      case '"':
        this.tokenOpen = true;
        this.tokenHoldsAQuote = true;
        this.takeDoubleQuoted();
        return;
      case "\\":
        this.tokenHoldsAQuote = true;
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
        this.dropTheRedirectedDescriptor();
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
    this.tokenHoldsAQuote = false;
  }

  private dropTheRedirectedDescriptor(): void {
    if (this.redirectTargetPending || this.tokenHoldsAQuote || !namesADescriptor(this.token)) return;
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
    this.assignments = [];
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
    this.assignments.push(...prefixWords.filter(isAssignment));
    for (const prefixWord of prefixWords) if (namesAFileTheShellSources(prefixWord)) this.markUnread();
    if (this.commandTokens.length === 0) {
      if (cut.leavesTheCommandUnread || handsStdinAProgramToRun(prefixWords)) this.markUnread();
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
    if (readsACommandFlag(leading)) {
      this.deferInterpreterPayload();
      return;
    }
    this.deferRunnerCall();
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

  private deferRunnerCall(): void {
    const call = runnerCallOf(this.commandTokens);
    if (call.kind === "pastReading") this.markUnread();
    else this.deferNestedCommands(call.payload);
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
          ? { kind: "commandWord", word: withSpacesForNewlines(word), assignments: this.assignments }
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
      this.takeParenthesizedExpansion();
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

  private takeParenthesizedExpansion(): void {
    const arithmeticLength = arithmeticExpansionLength(this.rest);
    if (arithmeticLength !== undefined) {
      this.rest = this.rest.slice(arithmeticLength);
      return;
    }
    this.rest = this.rest.slice(1);
    this.deferNestedCommands(this.takeSubstitutionBody());
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
    this.dropTheRedirectedDescriptor();
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
