import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lexShellCommands, UNREAD_PAYLOAD_MARKER, type LexRecord } from "../../src/shell/lexer.ts";
import { provedSomething } from "../support/proved.ts";

type LexerCase = {
  readonly reads: string;
  readonly readFrom: string;
  readonly line: string;
  readonly records: readonly string[];
};

const OVER_THE_INPUT_BOUND = `echo ${"a".repeat(3072)}`;

const LEXER_CASES: readonly LexerCase[] = [
  {
    reads: "a command word, its arguments and nothing else",
    readFrom: "plugin/hooks/lexer.sh:165-171",
    line: "git commit -m x",
    records: [">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "a separator as the end of one command and the start of the next",
    readFrom: "plugin/hooks/lexer.sh:52",
    line: "cd /repo && git commit",
    records: [">cd", "./repo", ">git", ".commit"],
  },
  {
    reads: "a comment as text nobody runs",
    readFrom: "plugin/hooks/lexer.sh:47,262-265",
    line: "# git commit -m x",
    records: [],
  },
  {
    reads: "a redirection target as no word of the command",
    readFrom: "plugin/hooks/lexer.sh:49,267-275",
    line: ">out.txt git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "an input redirection's target as no word of the command either",
    readFrom: "plugin/hooks/lexer.sh:277-293",
    line: "<in.txt git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "a herestring as more commands",
    readFrom: "plugin/hooks/lexer.sh:280-284,66-69",
    line: 'newgrp <<< "git commit"',
    records: [">newgrp", ".git commit", ">git", ".commit"],
  },
  {
    reads: "a heredoc a shell owns as code",
    readFrom: "plugin/hooks/lexer.sh:335-336",
    line: "bash <<EOF\ngit commit\nEOF",
    records: [">bash", ">git", ".commit"],
  },
  {
    reads: "a heredoc anything else owns as stdin text nobody read as commands",
    readFrom: "plugin/hooks/lexer.sh:337-338",
    line: "docker run -i cat <<EOF\ngit commit\nEOF",
    records: [">docker", ".run", ".-i", ".cat", "<git commit"],
  },
  {
    reads: "a tab-stripping heredoc line by line",
    readFrom: "plugin/hooks/lexer.sh:352-369",
    line: "bash <<-EOF\n\tgit commit\n\tEOF",
    records: [">bash", ">git", ".commit"],
  },
  {
    reads: "a command substitution as more commands",
    readFrom: "plugin/hooks/lexer.sh:218-223,233-253",
    line: "$(echo git) commit",
    records: [">$", ".commit", ">echo", ".git"],
  },
  {
    reads: "a backtick substitution as more commands",
    readFrom: "plugin/hooks/lexer.sh:255-260",
    line: "`echo git` commit",
    records: [">$", ".commit", ">echo", ".git"],
  },
  {
    reads: "a brace expansion as opaque text it never re-lexes",
    readFrom: "plugin/hooks/lexer.sh:224-228",
    line: "g${x}it commit",
    records: [">g${x}it", ".commit"],
  },
  {
    reads: "eval's remaining arguments joined into one payload",
    readFrom: "plugin/hooks/lexer.sh:112-115",
    line: "eval git commit -m x",
    records: [">eval", ".git", ".commit", ".-m", ".x", ">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "a sourced script as a payload it cannot read",
    readFrom: "plugin/hooks/lexer.sh:108-111,400-405",
    line: "source deploy.sh",
    records: [">source", ".deploy.sh", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "an interpreter's -c payload as more commands",
    readFrom: "plugin/hooks/lexer.sh:126-131",
    line: 'bash -c "git commit"',
    records: [">bash", ".-c", ".git commit", ">git", ".commit"],
  },
  {
    reads: "a clustered -c as the command flag, with its payload one position further on",
    readFrom: "plugin/hooks/lexer.sh:129",
    line: 'bash -cO extglob "git commit"',
    records: [">bash", ".-cO", ".extglob", ".git commit", UNREAD_PAYLOAD_MARKER, ">extglob"],
  },
  {
    reads: "an interpreter handed no payload at all as a payload it cannot read",
    readFrom: "plugin/hooks/lexer.sh:141-143",
    line: "echo git commit | bash",
    records: [">echo", ".git", ".commit", ">bash", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a wrapper prefix as words in front of the command word",
    readFrom: "plugin/hooks/lexer.sh:86-102,371-384",
    line: "sudo env X=1 timeout 60 git commit",
    records: [">git", ".commit"],
  },
  {
    reads: "an unresolved wrapper option as a payload it cannot read, its value left the command word",
    readFrom: "plugin/hooks/lexer.sh:89-90",
    line: "sudo -u somebody git commit",
    records: [">somebody", ".git", ".commit", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "xargs as a command whose words stdin completes",
    readFrom: "plugin/hooks/lexer.sh:97-99,386-391",
    line: "echo --prod | xargs vercel",
    records: [">echo", ".--prod", ">vercel", `<${UNREAD_PAYLOAD_MARKER}`],
  },
  {
    reads: "a chain past the payload-depth bound as a payload it cannot read",
    readFrom: "plugin/hooks/lexer.sh:17,151-154",
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
    reads: "a line past the input-bytes bound as one payload it never opened",
    readFrom: "plugin/hooks/lexer.sh:19,27-30",
    line: OVER_THE_INPUT_BOUND,
    records: [UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "the same line one byte under that bound as the command it spells",
    readFrom: "plugin/hooks/lexer.sh:19,27-30",
    line: OVER_THE_INPUT_BOUND.slice(0, 3071),
    records: [">echo", `.${"a".repeat(3066)}`],
  },
];

const CLOSED_DIVERGENCE_CASES: readonly LexerCase[] = [
  {
    reads: "script's -c payload, whose command no token's basename answered",
    readFrom: "plugin/hooks/lexer.sh:121-144, extended to script",
    line: "script -qc 'vercel --prod' /dev/null",
    records: [">script", ".-qc", ".vercel --prod", "./dev/null", UNREAD_PAYLOAD_MARKER, ">vercel", ".--prod"],
  },
  {
    reads: "the operands ssh hands the remote shell after the host",
    readFrom: "plugin/hooks/lexer.sh:112-115, the shape eval's payload already had",
    line: "ssh build-host 'vercel --prod'",
    records: [">ssh", ".build-host", ".vercel --prod", ">vercel", ".--prod"],
  },
  {
    reads: "the same operands unquoted, which ssh joins into one remote command line",
    readFrom: "plugin/hooks/lexer.sh:112-115, the shape eval's payload already had",
    line: "ssh build-host vercel --prod",
    records: [">ssh", ".build-host", ".vercel", ".--prod", ">vercel", ".--prod"],
  },
  {
    reads: "tmux's shell-command operand, with the option in front of it left unresolved",
    readFrom: "plugin/hooks/lexer.sh:86-102, the rule wrapper prefixes already carried",
    line: "tmux new-session -d 'vercel --prod'",
    records: [
      ">tmux", ".new-session", ".-d", ".vercel --prod", UNREAD_PAYLOAD_MARKER, ">vercel", ".--prod",
    ],
  },
  {
    reads: "an xargs replace-string as one word, so the line no longer splits at the brace",
    readFrom: "plugin/hooks/lexer.sh:32,52",
    line: "echo --prod | xargs -I{} vercel {}",
    records: [">echo", ".--prod", ">vercel", ".{}", `<${UNREAD_PAYLOAD_MARKER}`, UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "an ANSI-C quoted option as the option the shell hands the deploy CLI",
    readFrom: "bash(1) QUOTING: ANSI-C Quoting",
    line: "vercel $'--prod'",
    records: [">vercel", ".--prod"],
  },
  {
    reads: "an ANSI-C quoted git verb as that verb",
    readFrom: "bash(1) QUOTING: ANSI-C Quoting",
    line: "git $'commit' -m x",
    records: [">git", ".commit", ".-m", ".x"],
  },
  {
    reads: "an ANSI-C quoted git verb spelled in hex as that verb",
    readFrom: "bash(1) QUOTING: ANSI-C Quoting",
    line: "git $'\\x70\\x75\\x73\\x68' origin main",
    records: [">git", ".push", ".origin", ".main"],
  },
  {
    reads: "a locale-translated option as the untranslated option, and the span itself as unread",
    readFrom: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'vercel $"--prod"',
    records: [">vercel", ".--prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a locale-translated git verb the same way",
    readFrom: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'git $"commit" -m x',
    records: [">git", ".commit", ".-m", ".x", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a locale-translated git verb inside a wrapper's payload the same way too",
    readFrom: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'ssh build-host \'git $"push" origin main\'',
    records: [
      ">ssh", ".build-host", '.git $"push" origin main', ">git", ".push", ".origin", ".main",
      UNREAD_PAYLOAD_MARKER,
    ],
  },
  {
    reads: "the two dollar-quoting forms concatenated as the one word the shell builds from them",
    readFrom: "bash(1) QUOTING: ANSI-C Quoting and Locale-Specific Translation",
    line: 'vercel $\'--pro\'$"d"',
    records: [">vercel", ".--prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "a trap's action as the command the shell runs when the signal fires",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap 'vercel --prod' EXIT",
    records: [">trap", ".vercel --prod", ".EXIT", ">vercel", ".--prod"],
  },
  {
    reads: "a co-process as the command the shell runs asynchronously",
    readFrom: "bash(1) SHELL GRAMMAR: Coprocesses",
    line: "coproc vercel --prod",
    records: [">vercel", ".--prod"],
  },
  {
    reads: "a named co-process's compound command as the commands inside it",
    readFrom: "bash(1) SHELL GRAMMAR: Coprocesses",
    line: "coproc NAME { vercel --prod ; }",
    records: [">NAME", ">vercel", ".--prod"],
  },
  {
    reads: "a mapfile callback as the command the shell runs per batch of lines",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: mapfile -C",
    line: "mapfile -C 'vercel --prod' -c 1 rows",
    records: [">mapfile", ".-C", ".vercel --prod", ".-c", ".1", ".rows", ">vercel", ".--prod"],
  },
  {
    reads: "a completion callback as the command the shell runs to complete the word",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: compgen -C",
    line: "compgen -C 'vercel --prod' foo",
    records: [">compgen", ".-C", ".vercel --prod", ".foo", ">vercel", ".--prod"],
  },
  {
    reads: "an alias definition as a payload no later line of this command can resolve",
    readFrom: "bash(1) ALIASES",
    line: "alias deploy='vercel --prod'",
    records: [">alias", ".deploy=vercel --prod", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "fc as a payload it replays from a history no gate can read",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: fc",
    line: "fc -s",
    records: [">fc", ".-s", UNREAD_PAYLOAD_MARKER],
  },
  {
    reads: "BASH_ENV as a file the shell sources before the command, which the gate cannot read",
    readFrom: "bash(1) INVOCATION: Invoked non-interactively",
    line: "BASH_ENV=./boot.sh bash -c :",
    records: [">bash", ".-c", ".:", UNREAD_PAYLOAD_MARKER, ">:"],
  },
];

const KEPT_SHAPES: readonly LexerCase[] = [
  {
    reads: "a brace group as the end of one command and the start of the next",
    readFrom: "plugin/hooks/lexer.sh:52",
    line: "{ git commit ; }",
    records: [">git", ".commit"],
  },
  {
    reads: "a brace group behind a reserved word as the same",
    readFrom: "plugin/hooks/lexer.sh:52,371-384",
    line: "time { git commit ; }",
    records: [">git", ".commit"],
  },
  {
    reads: "a brace inside a word as an ordinary character",
    readFrom: "bash(1) SHELL GRAMMAR: Compound Commands",
    line: "vercel deploy{a}b",
    records: [">vercel", ".deploy{a}b"],
  },
  {
    reads: "a lone brace in argument position as an ordinary word",
    readFrom: "bash(1) SHELL GRAMMAR: Compound Commands",
    line: "echo { }",
    records: [">echo", ".{", ".}"],
  },
  {
    reads: "a dollar-quote inside double quotes as the literal text it is",
    readFrom: "bash(1) QUOTING: ANSI-C Quoting",
    line: "vercel \"$'--prod'\"",
    records: [">vercel", ".$'--prod'"],
  },
  {
    reads: "an escaped dollar in front of a quote as a literal dollar",
    readFrom: "bash(1) QUOTING",
    line: "vercel \\$'--prod'",
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "a dollar inside double quotes as a literal dollar, translating nothing",
    readFrom: "bash(1) QUOTING: Locale-Specific Translation",
    line: 'vercel "$"--prod""',
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "an escaped dollar in front of a double quote as a literal dollar too",
    readFrom: "bash(1) QUOTING",
    line: 'vercel \\$"--prod"',
    records: [">vercel", ".$--prod"],
  },
  {
    reads: "a trap that resets rather than sets one as no nested command",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap - EXIT",
    records: [">trap", ".-", ".EXIT"],
  },
  {
    reads: "a trap that only lists signals as no nested command",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: trap",
    line: "trap -l",
    records: [">trap", ".-l"],
  },
  {
    reads: "a mapfile with no callback as no nested command",
    readFrom: "bash(1) SHELL BUILTIN COMMANDS: mapfile",
    line: "mapfile -t rows",
    records: [">mapfile", ".-t", ".rows"],
  },
  {
    reads: "an alias that only prints as no unread payload",
    readFrom: "bash(1) ALIASES",
    line: "alias",
    records: [">alias"],
  },
  {
    reads: "a wrapper carrying no command at all as no nested command",
    readFrom: "plugin/hooks/lexer.sh:146-159",
    line: "ssh build-host",
    records: [">ssh", ".build-host"],
  },
  {
    reads: "a multiplexer subcommand that runs nothing as no nested command",
    readFrom: "plugin/hooks/lexer.sh:146-159",
    line: "tmux ls",
    records: [">tmux", ".ls"],
  },
];

const ALL_CASES = [...LEXER_CASES, ...CLOSED_DIVERGENCE_CASES, ...KEPT_SHAPES];

provedSomething(
  `at least one of ${ALL_CASES.length} lexer port cases is exercised`,
  ALL_CASES.length > 0,
  "the lexer port suite carries no case, so it proved nothing about plugin/hooks/lexer.sh",
);

describe("core/src/shell/lexer.ts: port tests read from plugin/hooks/lexer.sh, never parity evidence", () => {
  for (const { reads, readFrom, line, records } of LEXER_CASES) {
    test(`it reads ${reads} (read from ${readFrom})`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: the five divergences and the locale sibling of their class, closed where the shell executes", () => {
  for (const { reads, readFrom, line, records } of CLOSED_DIVERGENCE_CASES) {
    test(`it now reads ${reads} (read from ${readFrom})`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: the shapes those closures must leave where they were", () => {
  for (const { reads, readFrom, line, records } of KEPT_SHAPES) {
    test(`it still reads ${reads} (read from ${readFrom})`, () => {
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
