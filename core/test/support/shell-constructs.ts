export type ShellConstruct = Readonly<{ named: string; spelled: RegExp }>;

export const CONSTRUCTS_THE_CORPUS_EXERCISES: readonly ShellConstruct[] = [
  { named: "single quoting, which the shell strips and reads literally", spelled: /'/ },
  { named: "double quoting, which the shell strips while leaving its expansions live", spelled: /"/ },
  { named: "a backslash escape, which the shell strips from the word it builds", spelled: /\\/ },
  { named: "ANSI-C quoting, whose escapes the shell decodes into the word", spelled: /\$'/ },
  { named: "a brace, whether the reserved word opening a group or an ordinary character of a word", spelled: /[{}]/ },
  { named: "the separators ; and && and a newline, which the shell traces in a fixed order", spelled: /;|&&|\n/ },
  { named: "a comment, which is no word of the command", spelled: /#/ },
  { named: "input and output redirection with no file-descriptor prefix", spelled: /(^|[^0-9])[<>]/ },
  { named: "a subshell group, whose commands the shell runs in a child and traces in order", spelled: /\(/ },
  { named: "the negation reserved word, which runs the command and inverts its status", spelled: /(^|[;&\n]\s*)!\s/ },
];

export const CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION: readonly ShellConstruct[] = [
  { named: "command substitution, which the oracle would have to execute to measure it", spelled: /\$\(|`/ },
  { named: "arithmetic expansion, whose value the shell computes instead of reading it from the line", spelled: /\$\(\(/ },
  { named: "an arithmetic command, whose words the shell evaluates instead of running them", spelled: /\(\(/ },
  { named: "process substitution, which the oracle would have to execute to measure it", spelled: /[<>]\(/ },
  {
    named: "parameter expansion, named or special, whose argv depends on runtime state no gate can have",
    spelled: /\$[A-Za-z_{$?@*#!0-9-]/,
  },
  {
    named: "locale-specific translation, whose word the shell reads from a catalog and an environment no gate can have",
    spelled: /(^|[^"\\])\$"/,
  },
  { named: "brace expansion, whose argv depends on a comma this corpus never spells", spelled: /\{[^{}]*,[^{}]*\}/ },
  { named: "tilde expansion and pathname globbing, whose argv depends on the filesystem", spelled: /[~*?[]/ },
  {
    named: "a conditional expression, whose bracket is the character pathname globbing is already excluded for",
    spelled: /\[\[/,
  },
  { named: "pipelines, traced from separate processes in no fixed order, and the || an always-succeeding verb never reaches", spelled: /\|/ },
  { named: "background commands, whose trace the shell writes from a process of their own", spelled: /(^|[^&])&([^&]|$)/ },
  {
    named: "a co-process, which the shell runs asynchronously and traces from a process of its own",
    spelled: /(^|[;&\n]\s*)coproc\s/,
  },
  { named: "file-descriptor-prefixed redirection, a divergence of its own outside these five", spelled: /[0-9]>/ },
  {
    named: "a here-string or here-document, whose text the shell hands the command on stdin and not in the argv this corpus compares",
    spelled: /<</,
  },
  {
    named: "an assignment in front of the command, which the shell traces on a line of its own rather than as a word of the command",
    spelled: /(^|[;&\n]\s*)[A-Za-z_][A-Za-z0-9_]*=/,
  },
  {
    named: "a compound command whose branches and iterations the shell picks at run time, so no one trace shows every command it may run",
    spelled: /(^|[;&|(\n]\s*)(if|while|until|for|case|select)\s/,
  },
  {
    named: "a function definition, whose body the shell traces only when the function is called",
    spelled: /(^|[;&\n]\s*)(function\s|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\))/,
  },
  {
    named: "the time reserved word, whose report bash writes to the stream that carries the trace",
    spelled: /(^|[;&\n]\s*)time\s/,
  },
  { named: "a backslash before an ordinary character inside double quotes, a divergence of its own outside these five", spelled: /"[^"]*\\[^$`"\\][^"]*"/ },
  { named: "bytes above U+007F, which bash writes raw under a locale this corpus does not fix", spelled: /[^\u0000-\u007f]/ },
];

export const SHELL_WORDS_RUNNING_NO_COMMAND_OF_THEIR_OWN: ReadonlySet<string> = new Set([
  "[[", "]]", ":", "[", "bg", "break", "caller", "cd", "compopt", "continue", "declare", "dirs",
  "disown", "echo", "enable", "exit", "export", "false", "fg", "getopts", "hash", "help", "jobs",
  "kill", "let", "local", "logout", "popd", "printf", "pushd", "pwd", "read", "readonly", "return",
  "set", "shift", "shopt", "suspend", "test", "times", "true", "type", "typeset", "ulimit", "umask",
  "unalias", "unset", "wait",
]);

export const SHELL_WORDS_WHOSE_COMMAND_ONLY_AN_INTERACTIVE_SHELL_RUNS: ReadonlySet<string> = new Set([
  "bind",
  "history",
]);

export function probesCarryingAnExcludedConstruct(lines: readonly string[]): readonly string[] {
  return lines.flatMap((line) => {
    const outside = outsideSingleQuotedSpans(line);
    return CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION.filter((construct) => construct.spelled.test(outside)).map(
      (construct) => `${JSON.stringify(line)} carries ${construct.named}`,
    );
  });
}

export function exercisedConstructsNoProbeSpells(lines: readonly string[]): readonly string[] {
  return CONSTRUCTS_THE_CORPUS_EXERCISES.filter(
    (construct) => !lines.some((line) => construct.spelled.test(line)),
  ).map((construct) => construct.named);
}

export function shellWordsInNoStanding(
  words: readonly string[],
  readByTheLexer: ReadonlySet<string>,
): readonly string[] {
  return words.filter(
    (word) =>
      !readByTheLexer.has(word) &&
      !SHELL_WORDS_RUNNING_NO_COMMAND_OF_THEIR_OWN.has(word) &&
      !SHELL_WORDS_WHOSE_COMMAND_ONLY_AN_INTERACTIVE_SHELL_RUNS.has(word),
  );
}

function outsideSingleQuotedSpans(line: string): string {
  return line.replace(/"[^"]*"|'[^']*'/g, (span) => (span.startsWith('"') ? span : " "));
}
