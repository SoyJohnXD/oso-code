import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { UNREAD_PAYLOAD_MARKER } from "../../src/shell/lexed-word.ts";
import { lexShellCommands, MAX_LEXED_INPUT_BYTES, type LexRecord } from "../../src/shell/lexer.ts";
import { provedSomething } from "../support/proved.ts";

type LexerCase = {
  readonly reads: string;
  readonly manual?: string;
  readonly line: string;
  readonly records: readonly string[];
};

const READABLE_COMMAND_BYTES = MAX_LEXED_INPUT_BYTES - "\n".length;
const AT_THE_INPUT_BOUND = `echo ${"a".repeat(READABLE_COMMAND_BYTES - "echo ".length)}`;
const TWO_BYTE_CHARACTER = "é";
const MULTIBYTE_AT_THE_INPUT_BOUND = `echo ${TWO_BYTE_CHARACTER.repeat(
  (READABLE_COMMAND_BYTES - "echo ".length) / Buffer.byteLength(TWO_BYTE_CHARACTER),
)}`;

const LEXER_CASES: readonly LexerCase[] = [
  {
    reads: "a command word, its arguments and nothing else",
    line: "git commit -m x",
    records: [">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "a separator as the end of one command and the start of the next",
    line: "cd /repo && git commit",
    records: [">cd", "./repo", ">git", ".commit"],
  },
  {
    reads: "a comment as text nobody runs",
    line: "# git commit -m x",
    records: [],
  },
  {
    reads: "a redirection target as no word of the command",
    line: ">out.txt git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "an input redirection's target as no word of the command either",
    line: "<in.txt git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "a redirection's file-descriptor number as no word of the command",
    manual: "POSIX XCU 2.10.1: IO_NUMBER",
    line: "git push origin oso-run/x 2>&1 0</dev/null",
    records: [">git", ".push", ".origin", ".oso-run/x"],
  },
  {
    reads: "digits a blank or a quote parts from the redirection as an argument",
    manual: "POSIX XCU 2.10.1: IO_NUMBER",
    line: "echo 2 >f '3'>g",
    records: [">echo", ".2", ".3"],
  },
  {
    reads: "a herestring as more commands",
    line: 'newgrp <<< "git commit"',
    records: [">newgrp", ".git commit", ">git", ".commit"],
  },
  {
    reads: "a heredoc a shell owns as code",
    line: "bash <<EOF\ngit commit\nEOF",
    records: [">bash", ">git", ".commit"],
  },
  {
    reads: "a heredoc anything else owns as stdin text nobody read as commands",
    line: "docker run -i cat <<EOF\ngit commit\nEOF",
    records: [">docker", ".run", ".-i", ".cat", "<git commit"],
  },
  {
    reads: "a tab-stripping heredoc line by line",
    line: "bash <<-EOF\n\tgit commit\n\tEOF",
    records: [">bash", ">git", ".commit"],
  },
  {
    reads: "a command substitution as more commands",
    line: "$(echo git) commit",
    records: [">$", ".commit", ">echo", ".git"],
  },
  {
    reads: "a backtick substitution as more commands",
    line: "`echo git` commit",
    records: [">$", ".commit", ">echo", ".git"],
  },
  {
    reads: "a brace expansion as opaque text it never re-lexes",
    line: "g${x}it commit",
    records: [">g${x}it", ".commit"],
  },
  {
    reads: "eval's remaining arguments joined into one payload",
    line: "eval git commit -m x",
    records: [">eval", ".git", ".commit", ".-m", ".x", ">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "a sourced script as a payload it cannot read",
    line: "source deploy.sh",
    records: [">source", ".deploy.sh", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "an interpreter's -c payload as more commands",
    line: 'bash -c "git commit"',
    records: [">bash", ".-c", ".git commit", ">git", ".commit"],
  },
  {
    reads: "a clustered -c as the command flag, with its payload one position further on",
    line: 'bash -cO extglob "git commit"',
    records: [">bash", ".-cO", ".extglob", ".git commit", UNREAD_PAYLOAD_MARKER, ">extglob"],
  },
  {
    reads: "an interpreter handed no payload at all as a payload it cannot read",
    line: "echo git commit | bash",
    records: [">echo", ".git", ".commit", ">bash", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a wrapper prefix as words in front of the command word",
    line: "sudo env X=1 timeout 60 git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "an unresolved wrapper option as a payload it cannot read, its value left the command word",
    line: "sudo -u somebody git commit",
    records: [">somebody", ".git", ".commit", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "xargs as a command whose words stdin completes",
    line: "echo --prod | xargs vercel",
    records: [">echo", ".--prod", ">vercel", `<${UNREAD_PAYLOAD_MARKER}`],
  },
  {
    reads: "a chain past the payload-depth bound as a payload it cannot read",
    line: 'bash -c \'bash -c "bash -c \\"bash -c ok\\""\'',
    records: [
      ">bash",
      ".-c",
      '.bash -c "bash -c \\"bash -c ok\\""',
      ">bash",
      ".-c",
      '.bash -c "bash -c ok"',
      ">bash",
      ".-c",
      ".bash -c ok",
      ">bash",
      ".-c",
      ".ok",
      UNREAD_PAYLOAD_MARKER,
    ],
  },
  {
    reads: "a line one byte past the input-bytes bound as one payload it never opened",
    line: `${AT_THE_INPUT_BOUND}a`,
    records: [UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a line whose bytes and sentinel newline fill the input-bytes bound as the command it spells",
    line: AT_THE_INPUT_BOUND,
    records: [">echo", `.${AT_THE_INPUT_BOUND.slice("echo ".length)}`],
  },
  {
    reads: "a multibyte line one byte past the bound as unread, though its characters number half of it",
    line: `${MULTIBYTE_AT_THE_INPUT_BOUND}a`,
    records: [UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a multibyte line filling the bound to its last byte as the command it spells",
    line: MULTIBYTE_AT_THE_INPUT_BOUND,
    records: [">echo", `.${MULTIBYTE_AT_THE_INPUT_BOUND.slice("echo ".length)}`],
  },
];

const CLOSED_DIVERGENCE_CASES: readonly LexerCase[] = [
  {
    reads: "script's -c payload, whose command no token's basename answered",
    line: "script -qc 'vercel --prod' /dev/null",
    records: [">script", ".-qc", ".vercel --prod", "./dev/null", UNREAD_PAYLOAD_MARKER, ">vercel", ".--prod"],
  },
  {
    reads: "the operands ssh hands the remote shell after the host",
    line: "ssh build-host 'vercel --prod'",
    records: [">ssh", ".build-host", ".vercel --prod", ">vercel", ".--prod"],
  },
  {
    reads: "the same operands unquoted, which ssh joins into one remote command line",
    line: "ssh build-host vercel --prod",
    records: [">ssh", ".build-host", ".vercel", ".--prod", ">vercel", ".--prod"],
  },
  {
    reads: "tmux's shell-command operand, with the option in front of it left unresolved",
    line: "tmux new-session -d 'vercel --prod'",
    records: [
      ">tmux", ".new-session", ".-d", ".vercel --prod", UNREAD_PAYLOAD_MARKER, ">vercel", ".--prod",
    ],
  },
  {
    reads: "an xargs replace-string as one word, so the line no longer splits at the brace",
    line: "echo --prod | xargs -I{} vercel {}",
    records: [">echo", ".--prod", ">vercel", ".{}", `<${UNREAD_PAYLOAD_MARKER}`],
  },
  {
    reads: "an ANSI-C quoted option as the option the shell hands the deploy CLI",
    manual: "bash(1) QUOTING: ANSI-C Quoting",
    line: "vercel $'--prod'",
    records: [">vercel", ".--prod"],
  },
  {
    reads: "an ANSI-C quoted git verb as that verb",
    manual: "bash(1) QUOTING: ANSI-C Quoting",
    line: "git $'commit' -m x",
    records: [">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "an ANSI-C quoted git verb spelled in hex as that verb",
    manual: "bash(1) QUOTING: ANSI-C Quoting",
    line: "git $'\\x70\\x75\\x73\\x68' origin main",
    records: [">git", ".push", ".origin", ".main"],
  },
  {
    reads: "a locale-translated option as the untranslated option, and the span itself as unread",
    manual: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'vercel $"--prod"',
    records: [">vercel", ".--prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a locale-translated git verb the same way",
    manual: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'git $"commit" -m x',
    records: [">git", ".commit", ".-m", ".x", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a locale-translated git verb inside a wrapper's payload the same way too",
    manual: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'ssh build-host \'git $"push" origin main\'',
    records: [
      ">ssh", ".build-host", '.git $"push" origin main', ">git", ".push", ".origin", ".main",
      UNREAD_PAYLOAD_MARKER,
    ],
  },
  {
    reads: "the two dollar-quoting forms concatenated as the one word the shell builds from them",
    manual: "bash(1) QUOTING: ANSI-C Quoting and Locale-Specific Translation",
    line: 'vercel $\'--pro\'$"d"',
    records: [">vercel", ".--prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a trap's action as the command the shell runs when the signal fires",
    manual: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap 'vercel --prod' EXIT",
    records: [">trap", ".vercel --prod", ".EXIT", ">vercel", ".--prod"],
  },
  {
    reads: "a co-process as the command the shell runs asynchronously",
    manual: "bash(1) SHELL GRAMMAR: Coprocesses",
    line: "coproc vercel --prod",
    records: [">vercel", ".--prod"],
  },
  {
    reads: "a named co-process's compound command as the commands inside it",
    manual: "bash(1) SHELL GRAMMAR: Coprocesses",
    line: "coproc NAME { vercel --prod ; }",
    records: [">NAME", ">vercel", ".--prod"],
  },
  {
    reads: "a mapfile callback as the command the shell runs per batch of lines",
    manual: "bash(1) SHELL BUILTIN COMMANDS: mapfile -C",
    line: "mapfile -C 'vercel --prod' -c 1 rows",
    records: [">mapfile", ".-C", ".vercel --prod", ".-c", ".1", ".rows", ">vercel", ".--prod"],
  },
  {
    reads: "a completion callback as the command the shell runs to complete the word",
    manual: "bash(1) SHELL BUILTIN COMMANDS: compgen -C",
    line: "compgen -C 'vercel --prod' foo",
    records: [">compgen", ".-C", ".vercel --prod", ".foo", ">vercel", ".--prod"],
  },
  {
    reads: "an alias definition as a payload no later line of this command can resolve",
    manual: "bash(1) ALIASES",
    line: "alias deploy='vercel --prod'",
    records: [">alias", ".deploy=vercel --prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "fc as a payload it replays from a history no gate can read",
    manual: "bash(1) SHELL BUILTIN COMMANDS: fc",
    line: "fc -s",
    records: [">fc", ".-s", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "BASH_ENV as a file the shell sources before the command, which the gate cannot read",
    manual: "bash(1) INVOCATION: Invoked non-interactively",
    line: "BASH_ENV=./boot.sh bash -c :",
    records: [">bash", ".-c", ".:", UNREAD_PAYLOAD_MARKER, ">:"],
  },
];

const KEPT_SHAPES: readonly LexerCase[] = [
  {
    reads: "a brace group as the end of one command and the start of the next",
    line: "{ git commit ; }",
    records: [">git", ".commit"],
  },
  {
    reads: "a brace group behind a reserved word as the same",
    line: "time { git commit ; }",
    records: [">git", ".commit"],
  },
  {
    reads: "a brace inside a word as an ordinary character",
    manual: "bash(1) SHELL GRAMMAR: Compound Commands",
    line: "vercel deploy{a}b",
    records: [">vercel", ".deploy{a}b"],
  },
  {
    reads: "a lone brace in argument position as an ordinary word",
    manual: "bash(1) SHELL GRAMMAR: Compound Commands",
    line: "echo { }",
    records: [">echo", ".{", ".}"],
  },
  {
    reads: "a dollar-quote inside double quotes as the literal text it is",
    manual: "bash(1) QUOTING: ANSI-C Quoting",
    line: "vercel \"$'--prod'\"",
    records: [">vercel", ".$'--prod'"],
  },
  {
    reads: "an escaped dollar in front of a quote as a literal dollar",
    manual: "bash(1) QUOTING",
    line: "vercel \\$'--prod'",
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "a dollar inside double quotes as a literal dollar, translating nothing",
    manual: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'vercel "$"--prod""',
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "an escaped dollar in front of a double quote as a literal dollar too",
    manual: "bash(1) QUOTING",
    line: 'vercel \\$"--prod"',
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "a trap that resets rather than sets one as no nested command",
    manual: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap - EXIT",
    records: [">trap", ".-", ".EXIT"],
  },
  {
    reads: "a trap that only lists signals as no nested command",
    manual: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap -l",
    records: [">trap", ".-l"],
  },
  {
    reads: "a mapfile with no callback as no nested command",
    manual: "bash(1) SHELL BUILTIN COMMANDS: mapfile",
    line: "mapfile -t rows",
    records: [">mapfile", ".-t", ".rows"],
  },
  {
    reads: "an alias that only prints as no unread payload",
    manual: "bash(1) ALIASES",
    line: "alias",
    records: [">alias"],
  },
  {
    reads: "a wrapper carrying no command at all as no nested command",
    line: "ssh build-host",
    records: [">ssh", ".build-host"],
  },
  {
    reads: "a multiplexer subcommand that runs nothing as no nested command",
    line: "tmux ls",
    records: [">tmux", ".ls"],
  },
];

const PREFIX_ARITY_CASES: readonly LexerCase[] = [
  {
    reads: "env's -u value as the name it unsets, never the command word",
    manual: "env(1): -u, --unset=NAME",
    line: "env -u X git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "command -v as a lookup that runs nothing, left unstripped",
    manual: "bash(1) SHELL BUILTIN COMMANDS: command",
    line: "command -v git",
    records: [">command", ".-v", ".git"],
  },
  {
    reads: "a duration outside timeout's grammar as today's command word, and the line as unread",
    manual: "timeout(1): DURATION",
    line: "timeout inf git commit",
    records: [">inf", ".git", ".commit", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "an xargs replace-string as the git verb as a payload it cannot read",
    manual: "xargs(1): -I replace-str",
    line: "echo x | xargs -I{} git {}",
    records: [">echo", ".x", ">git", ".{}", `<${UNREAD_PAYLOAD_MARKER}`, UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "flock's -c payload once, though a heredoc strips the prefixes before the line ends",
    manual: "flock(1): -c, --command",
    line: "flock /tmp/l -c 'git commit' <<EOF\nx\nEOF",
    records: [">flock", "./tmp/l", ".-c", ".git commit", "<x", ">git", ".commit"],
  },
  {
    reads: "env's option value once, though a heredoc strips the prefixes before the line ends",
    manual: "env(1): -u, --unset=NAME",
    line: "env -u X bash <<EOF\ngit commit\nEOF",
    records: [">bash", ">git", ".commit"],
  },
  {
    reads: "an xargs flag bundle defining a replace-string as today's command word, and the line as unread",
    manual: "xargs(1): -i[replace-str]",
    line: "xargs -ri0 0 deploy",
    records: [">deploy", `<${UNREAD_PAYLOAD_MARKER}`, UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a numeric xargs replace-string as the command word, and the line as unread",
    manual: "xargs(1): -I replace-str",
    line: "xargs -I0 0 deploy",
    records: [">0", ".deploy", `<${UNREAD_PAYLOAD_MARKER}`, UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "npx's -c value as the nested command it runs",
    manual: "npm-exec(1): -c, --call",
    line: "npx -c 'git commit'",
    records: [">npx", ".-c", ".git commit", ">git", ".commit"],
  },
  {
    reads: "flock's attached --command= value ahead of its lock file as the nested command it runs",
    manual: "flock(1): -c, --command",
    line: "flock --command='git commit' /tmp/l",
    records: [">flock", ".--command=git commit", "./tmp/l", ">git", ".commit"],
  },
  {
    reads: "npx's -c= value as the nested command it runs",
    manual: "npm-exec(1): -c, --call",
    line: "npx -c='git commit'",
    records: [">npx", ".-c=git commit", ">git", ".commit"],
  },
  {
    reads: "a flag bundle carrying npx's -c as a payload it cannot read",
    manual: "npm-exec(1): -c, --call",
    line: "npx -yc 'git commit'",
    records: [">npx", ".-yc", ".git commit", UNREAD_PAYLOAD_MARKER],
  },
];

const ALL_CASES = [...LEXER_CASES, ...CLOSED_DIVERGENCE_CASES, ...KEPT_SHAPES, ...PREFIX_ARITY_CASES];

provedSomething(
  `at least one of ${ALL_CASES.length} lexer cases is exercised`,
  ALL_CASES.length > 0,
  "the lexer suite carries no case, so it proved nothing about the lexer",
);

function manualSuffix(manual: string | undefined): string {
  return manual === undefined ? "" : ` (${manual})`;
}

describe("core/src/shell/lexer.ts: a line reads as command words, arguments, stdin text and unread payloads", () => {
  for (const { reads, manual, line, records } of LEXER_CASES) {
    test(`it reads ${reads}${manualSuffix(manual)}`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: a word that carries a command the shell runs later, or builds from its quoting, reads as the command the shell executes", () => {
  for (const { reads, manual, line, records } of CLOSED_DIVERGENCE_CASES) {
    test(`it reads ${reads}${manualSuffix(manual)}`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: the shapes that merely look like a carried command are read as the plain words they are", () => {
  for (const { reads, manual, line, records } of KEPT_SHAPES) {
    test(`it reads ${reads}${manualSuffix(manual)}`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: the option arity of the prefix words whose options it knows", () => {
  for (const { reads, manual, line, records } of PREFIX_ARITY_CASES) {
    test(`it reads ${reads}${manualSuffix(manual)}`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

function rendered(records: readonly LexRecord[]): string[] {
  return records.map((record) => {
    switch (record.kind) {
      case "commandWord":
        return `>${record.word}`;
      case "argument":
        return `.${record.word}`;
      case "stdinText":
        return `<${record.text}`;
      case "unreadPayload":
        return UNREAD_PAYLOAD_MARKER;
    }
  });
}
