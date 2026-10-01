import { basenameOf } from "./lexed-word.ts";

export const COPROCESS_WORD = "coproc";
export const PREFIX_WORDS: ReadonlySet<string> = new Set([
  "env", "command", "builtin", "exec", "nice", "nohup", "time", "timeout", "stdbuf",
  "sudo", "doas", "setsid", "xargs", "flock", "ionice", "chrt", "taskset", "unbuffer",
  "then", "else", "elif", "do", "done", "fi", "in", "until", "while", "if", "for",
  "case", "esac", "select", "function", "!", COPROCESS_WORD,
]);
const ASSIGNMENT = /^[A-Za-z_][\s\S]*=/;

export function isCommandPrefixWord(word: string): boolean {
  if (isAssignment(word)) return true;
  if (word.startsWith("-")) return true;
  if (!/[^0-9]/.test(word)) return word !== "";
  return PREFIX_WORDS.has(basenameOf(word));
}

export function isAssignment(word: string): boolean {
  return ASSIGNMENT.test(word);
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
const XARGS_FLAG_DEFINING_A_REPLACE_STRING = /^-[^-]*[iI]/;
const ENV_OPTIONS: OptionTable = {
  takingAValue: ["-u"],
  takingAnAttachedValueOnly: [],
  standingAlone: ["-i", "-0", "-v", "-"],
};
type OperandPrefixShape = Readonly<{ options: OptionTable; operandGrammar: RegExp }>;

const TIMEOUT_SHAPE: OperandPrefixShape = {
  options: {
    takingAValue: ["-s", "-k"],
    takingAnAttachedValueOnly: [],
    standingAlone: ["--preserve-status", "--foreground", "-v"],
  },
  operandGrammar: /^[0-9]+(\.[0-9]+)?[smhd]?$/,
};
const FLOCK_SHAPE: OperandPrefixShape = {
  options: {
    takingAValue: ["-E", "-w"],
    takingAnAttachedValueOnly: [],
    standingAlone: ["-s", "-x", "-u", "-n", "-o"],
  },
  operandGrammar: /^[\s\S]+$/,
};
const FLOCK_COMMAND_OPTIONS = new Set(["-c", "--command"]);
const TASKSET_SHAPE: OperandPrefixShape = {
  options: {
    takingAValue: [],
    takingAnAttachedValueOnly: [],
    standingAlone: ["-a", "-c"],
  },
  operandGrammar: /^((0[xX])?[0-9A-Fa-f]+|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)$/,
};

type KeyedPrefixReading =
  | Readonly<{ kind: "read"; next: number; replaceString: string | undefined }>
  | Readonly<{ kind: "standsAsTheCommand"; payload: string }>
  | Readonly<{ kind: "operandOutsideItsGrammar" }>
  | Readonly<{ kind: "replaceStringItDoesNotKnow" }>
  | Readonly<{ kind: "shapeItDoesNotKnow" }>;

const A_SHAPE_IT_DOES_NOT_KNOW: KeyedPrefixReading = { kind: "shapeItDoesNotKnow" };
const AN_OPERAND_OUTSIDE_ITS_GRAMMAR: KeyedPrefixReading = { kind: "operandOutsideItsGrammar" };
const A_REPLACE_STRING_IT_DOES_NOT_KNOW: KeyedPrefixReading = { kind: "replaceStringItDoesNotKnow" };
const A_LOOKUP_RUNNING_NOTHING: KeyedPrefixReading = { kind: "standsAsTheCommand", payload: "" };

const KEYED_PREFIX_READERS: ReadonlyMap<string, (words: readonly string[], from: number) => KeyedPrefixReading> =
  new Map([
    ["command", readCommandOptions],
    ["xargs", readXargsOptions],
    ["env", (words, from) => readThroughOptions(ENV_OPTIONS, words, from)],
    ["timeout", (words, from) => readThroughOperand(TIMEOUT_SHAPE, words, from)],
    ["flock", readFlockOptions],
    ["taskset", (words, from) => readThroughOperand(TASKSET_SHAPE, words, from)],
  ]);

type PrefixCut = Readonly<{
  length: number;
  leavesTheCommandUnread: boolean;
  replaceString: string | undefined;
  payload: string;
}>;

export function prefixCutOf(words: readonly string[]): PrefixCut {
  let at = 0;
  let endsOnAnUnresolvedOption = false;
  let aPrefixLeftItUnread = false;
  let replaceString: string | undefined;
  let payload = "";
  while (at < words.length) {
    const word = words[at] as string;
    if (replaceString !== undefined && word.includes(replaceString)) break;
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
    if (readingLeavesItUnread(reading)) aPrefixLeftItUnread = true;
    if (!isCommandPrefixWord(word)) break;
    endsOnAnUnresolvedOption = word.startsWith("-");
    at += 1;
  }
  const leavesTheCommandUnread = endsOnAnUnresolvedOption || aPrefixLeftItUnread;
  return { length: at, leavesTheCommandUnread, replaceString, payload };
}

function readingLeavesItUnread(reading: KeyedPrefixReading): boolean {
  return reading.kind === "operandOutsideItsGrammar" || reading.kind === "replaceStringItDoesNotKnow";
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
  if (read !== undefined) return { kind: "read", next: read.next, replaceString: replaceStringOf(read.options) };
  return definesAReplaceString(words, from) ? A_REPLACE_STRING_IT_DOES_NOT_KNOW : A_SHAPE_IT_DOES_NOT_KNOW;
}

function definesAReplaceString(words: readonly string[], from: number): boolean {
  const followingWords = words.slice(from);
  const firstOperand = followingWords.findIndex((word) => !word.startsWith("-"));
  const optionWords = firstOperand === -1 ? followingWords : followingWords.slice(0, firstOperand);
  return optionWords.some((word) => XARGS_FLAG_DEFINING_A_REPLACE_STRING.test(word));
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
  const reading = readThroughOperand(FLOCK_SHAPE, words, from);
  if (reading.kind !== "read" || !FLOCK_COMMAND_OPTIONS.has(words[reading.next] ?? "")) return reading;
  return { kind: "standsAsTheCommand", payload: words[reading.next + 1] ?? "" };
}

function readThroughOptions(table: OptionTable, words: readonly string[], from: number): KeyedPrefixReading {
  const read = optionsRead(table, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  return { kind: "read", next: read.next, replaceString: undefined };
}

function readThroughOperand(shape: OperandPrefixShape, words: readonly string[], from: number): KeyedPrefixReading {
  const read = optionsRead(shape.options, words, from);
  if (read === undefined) return A_SHAPE_IT_DOES_NOT_KNOW;
  const operand = words[read.next];
  if (operand === undefined) return { kind: "read", next: read.next, replaceString: undefined };
  if (!shape.operandGrammar.test(operand)) return AN_OPERAND_OUTSIDE_ITS_GRAMMAR;
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
