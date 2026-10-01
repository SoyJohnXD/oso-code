import { basenameOf, UNREAD_PAYLOAD_MARKER } from "./lexer.ts";

export const GIT_VERB_UNRESOLVED = "?";
export const PACKAGE_RUNNERS: ReadonlySet<string> = new Set([
  "npx", "npm", "pnpm", "pnpx", "yarn", "bun", "bunx", "deno",
]);

export type LexedCommand = Readonly<{ tokens: readonly string[]; stdin: string }>;

const GIT_COMMAND_WORDS = new Set(["git", "git.exe"]);
const SUBJECT_READING_INTERPRETERS = new Set(["python", "node", "perl", "ruby", "php"]);
const INTERPRETER_CODE_FLAG = /^-[A-Za-z]*[ce]/;
const GIT_OPTIONS_TAKING_A_VALUE = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--attr-source",
]);
const GIT_OPTIONS_PRINTING_AND_EXITING = new Set([
  "-h", "--help", "-v", "--version", "--exec-path", "--html-path", "--man-path", "--info-path",
]);
const GIT_OPTIONS_STANDING_ALONE = new Set([
  "-p", "-P", "--paginate", "--no-pager", "--bare",
  "--no-replace-objects", "--no-lazy-fetch", "--no-optional-locks", "--no-advice",
  "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs",
]);

export function isGitCall(command: LexedCommand): boolean {
  const commandWord = command.tokens[0];
  return commandWord !== undefined && GIT_COMMAND_WORDS.has(basenameOf(commandWord));
}

export function gitVerb(command: LexedCommand): string {
  for (let index = 1; index < command.tokens.length; index += 1) {
    const argument = command.tokens[index] as string;
    if (argument.startsWith("--") && argument.includes("=")) continue;
    if (!argument.startsWith("-")) return argument;
    if (GIT_OPTIONS_PRINTING_AND_EXITING.has(argument)) return "";
    if (GIT_OPTIONS_TAKING_A_VALUE.has(argument)) index += 1;
    else if (!GIT_OPTIONS_STANDING_ALONE.has(argument)) return GIT_VERB_UNRESOLVED;
  }
  return "";
}

export function isFedByXargs(command: LexedCommand): boolean {
  return command.stdin.includes(UNREAD_PAYLOAD_MARKER);
}

export function runsCodeFedByXargs(command: LexedCommand): boolean {
  const [commandWord, ...commandArguments] = command.tokens;
  if (commandWord === undefined || !isFedByXargs(command)) return false;
  if (PACKAGE_RUNNERS.has(basenameOf(commandWord))) return true;
  return isSubjectReadingInterpreter(commandWord) && !namesAFixedScript(commandArguments);
}

export function isResidueCall(command: LexedCommand, subjects: readonly string[]): boolean {
  const commandWord = command.tokens[0];
  if (commandWord === undefined) return false;
  if (commandWord.includes("$")) return true;
  if (isGitCall(command)) {
    const verb = gitVerb(command);
    return verb === GIT_VERB_UNRESOLVED || verb.includes("$");
  }
  return isInterpreterHandedASubject(command, subjects);
}

export function runsAReplaceStringAsCode(command: LexedCommand, replaceString: string): boolean {
  const [commandWord, ...commandArguments] = command.tokens;
  if (commandWord === undefined) return false;
  if (commandWord.includes(replaceString)) return true;
  if (isGitCall(command)) return gitVerb(command).includes(replaceString);
  if (PACKAGE_RUNNERS.has(basenameOf(commandWord))) {
    return commandArguments.some((argument) => argument.includes(replaceString));
  }
  if (!isSubjectReadingInterpreter(commandWord)) return false;
  return commandArguments.some(
    (argument, index) =>
      argument.includes(replaceString) && holdsInterpreterCode(argument, commandArguments[index - 1]),
  );
}

function isInterpreterHandedASubject(command: LexedCommand, subjects: readonly string[]): boolean {
  if (!isSubjectReadingInterpreter(command.tokens[0] as string)) return false;
  if (command.tokens.slice(1).some((argument) => mentionsASubject(argument, subjects))) return true;
  return mentionsASubject(command.stdin, subjects);
}

function isSubjectReadingInterpreter(commandWord: string): boolean {
  return SUBJECT_READING_INTERPRETERS.has(basenameOf(commandWord).replace(/[0-9][\s\S]*$/, ""));
}

function namesAFixedScript(interpreterArguments: readonly string[]): boolean {
  return interpreterArguments.some(
    (argument, index) => !argument.startsWith("-") && !(interpreterArguments[index - 1]?.startsWith("-") ?? false),
  );
}

function holdsInterpreterCode(argument: string, previousArgument: string | undefined): boolean {
  return INTERPRETER_CODE_FLAG.test(argument) || INTERPRETER_CODE_FLAG.test(previousArgument ?? "");
}

function mentionsASubject(text: string, subjects: readonly string[]): boolean {
  return subjects.some((subject) => text.includes(subject));
}
