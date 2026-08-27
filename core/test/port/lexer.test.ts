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

const PINNED_HOLE_CASES: readonly LexerCase[] = [
  {
    reads: "script -qc, whose payload no token's basename answers",
    readFrom: "tests/hooks-test.sh:777",
    line: "script -qc 'vercel --prod' /dev/null",
    records: [">script", ".-qc", ".vercel --prod", "./dev/null"],
  },
  {
    reads: "ssh, whose payload no token's basename answers",
    readFrom: "tests/hooks-test.sh:777",
    line: "ssh build-host 'vercel --prod'",
    records: [">ssh", ".build-host", ".vercel --prod"],
  },
  {
    reads: "tmux new-session, whose payload no token's basename answers",
    readFrom: "tests/hooks-test.sh:777",
    line: "tmux new-session -d 'vercel --prod'",
    records: [">tmux", ".new-session", ".-d", ".vercel --prod"],
  },
  {
    reads: "an xargs replace-string, whose brace ends the command and leaves a clean word",
    readFrom: "tests/hooks-test.sh:5111",
    line: "echo --prod | xargs -I{} vercel {}",
    records: [">echo", ".--prod", ">vercel"],
  },
];

provedSomething(
  `at least one of ${LEXER_CASES.length + PINNED_HOLE_CASES.length} lexer port cases is exercised`,
  LEXER_CASES.length + PINNED_HOLE_CASES.length > 0,
  "the lexer port suite carries no case, so it proved nothing about plugin/hooks/lexer.sh",
);

describe("core/src/shell/lexer.ts: port tests read from plugin/hooks/lexer.sh, never parity evidence", () => {
  for (const { reads, readFrom, line, records } of LEXER_CASES) {
    test(`it reads ${reads} (read from ${readFrom})`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }
});

describe("core/src/shell/lexer.ts: the two PINNED HOLES, ported record for record and kept as holes", () => {
  for (const { reads, readFrom, line, records } of PINNED_HOLE_CASES) {
    test(`it still cannot see the payload inside ${reads} (pinned at ${readFrom})`, () => {
      assert.deepEqual(rendered(lexShellCommands(line)), records);
    });
  }

  test("the same wrapper with its payload unquoted leaves the verb a token of its own (pinned at tests/hooks-test.sh:784)", () => {
    assert.deepEqual(rendered(lexShellCommands("ssh build-host vercel --prod")), [
      ">ssh",
      ".build-host",
      ".vercel",
      ".--prod",
    ]);
  });
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
