import { INERT_VERB } from "./shell-xtrace.ts";

export type ArgvProbe = Readonly<{ construct: string; line: string }>;
export type EquivalenceProbe = Readonly<{ construct: string; escaped: string; literal: string }>;
export type LexerCorpus = Readonly<{
  argvProbes: readonly ArgvProbe[];
  equivalences: readonly EquivalenceProbe[];
}>;

const ANSI_C_ESCAPES_DECODING_TO_PRINTABLE_TEXT: readonly string[] = [
  "\\\\", "\\'", '\\"', "\\?",
  "\\x41", "\\x7e", "\\x2d", "\\x2D",
  "\\101", "\\176", "\\55", "\\1013",
  "\\u0041", "\\u41", "\\u002d", "\\U00000041", "\\U0000002d",
  "\\q", "\\-", "\\8", "\\9", "\\z", "\\.", "\\/",
  "\\x", "\\xzz", "\\u", "\\uzz", "\\U", "\\Uzz",
  "\\0", "\\x00", "\\u0000", "\\U00000000",
];

const ANSI_C_ESCAPES_DECODING_TO_A_CONTROL_CHARACTER: readonly Readonly<{ escape: string; decoded: string }>[] = [
  { escape: "\\n", decoded: "\n" },
  { escape: "\\t", decoded: "\t" },
  { escape: "\\r", decoded: "\r" },
  { escape: "\\a", decoded: "\u0007" },
  { escape: "\\b", decoded: "\b" },
  { escape: "\\e", decoded: "\u001b" },
  { escape: "\\E", decoded: "\u001b" },
  { escape: "\\f", decoded: "\f" },
  { escape: "\\v", decoded: "\v" },
  { escape: "\\x01", decoded: "\u0001" },
  { escape: "\\x1b", decoded: "\u001b" },
  { escape: "\\x7f", decoded: "\u007f" },
  { escape: "\\001", decoded: "\u0001" },
  { escape: "\\033", decoded: "\u001b" },
  { escape: "\\177", decoded: "\u007f" },
  { escape: "\\cA", decoded: "\u0001" },
  { escape: "\\ca", decoded: "\u0001" },
  { escape: "\\c?", decoded: "\u007f" },
  { escape: "\\c[", decoded: "\u001b" },
  { escape: "\\c]", decoded: "\u001d" },
  { escape: "\\c^", decoded: "\u001e" },
  { escape: "\\c_", decoded: "\u001f" },
  { escape: "\\c~", decoded: "\u001e" },
  { escape: "\\c!", decoded: "\u0001" },
  { escape: "\\c1", decoded: "\u0011" },
  { escape: "\\cz", decoded: "\u001a" },
  { escape: "\\c\\\\", decoded: "\u001c" },
];

const DOLLAR_QUOTING_CONTEXTS: readonly Readonly<{ named: string; spell: (span: string) => string }>[] = [
  { named: "alone", spell: (span) => span },
  { named: "behind a literal", spell: (span) => `x${span}` },
  { named: "in front of a literal", spell: (span) => `${span}y` },
  { named: "as one word beside two plain ones", spell: (span) => `pre ${span} post` },
  { named: "concatenated across all three quoting forms", spell: (span) => `'a'${span}"b"` },
];

const QUOTING_COMPOSITION_LINES: readonly string[] = [
  "a'b'\"c\"d", "''", "'a b'", '"a b"', "a\\ b", "\\a\\b", '"a"$\'b\'c',
  "x''y", "$''", "a$''b", "'--prod'", '"--prod"',
];

const BRACE_LINES: readonly string[] = [
  "-I{} k", "{} l", "a{b c}d", "{e f}", "}g h{", "} x", "{ x", "x{ }y", "vercel{} --prod",
];

const BRACE_GROUP_LINES: readonly string[] = [
  `{ ${INERT_VERB} g h ; }`,
  `{ ${INERT_VERB} i ; } ; ${INERT_VERB} j`,
];

const SUBSHELL_GROUP_LINES: readonly string[] = [
  `( ${INERT_VERB} k ) ; ${INERT_VERB} l`,
  `( ${INERT_VERB} m ; ${INERT_VERB} n )`,
];

const NEGATION_LINES: readonly string[] = [
  `! ${INERT_VERB} o`,
  `${INERT_VERB} p ; ! ${INERT_VERB} q`,
];

const OPERATOR_LINES: readonly string[] = [
  `${INERT_VERB} a ; ${INERT_VERB} b`,
  `${INERT_VERB} c && ${INERT_VERB} d`,
  `${INERT_VERB} e\n${INERT_VERB} f`,
  `${INERT_VERB} g ;\n${INERT_VERB} h`,
];

const COMMENT_AND_REDIRECTION_LINES: readonly string[] = [
  "a # b", "a >/dev/null", "a > /dev/null", "a </dev/null", ">/dev/null a",
];

const DOLLAR_QUOTE_THE_SHELL_DOES_NOT_DECODE_LINES: readonly string[] = [
  "\"$'--prod'\"", "\"$'commit'\"", "\"x$'y'\"",
  "\\$'\\x41'", "\\$'--prod'", "\\$'commit'",
];

const DOLLAR_SIGIL_NO_QUOTING_FORM_FOLLOWS_LINES: readonly string[] = [
  '"$"--prod""', '\\$"--prod"', '\\$"commit"',
  '$\\"--prod\\"', "$\\'--prod\\'", "$\\--prod", '$ "--prod"',
];

const DIVERGENCE_SPELLING_LINES: readonly string[] = [
  "vercel $'--prod'", "vercel --prod", "vercel $'--pro'$'d'", "vercel $'\\x2d\\x2dprod'",
  "git $'commit' -m x", "git commit -m x", "git $'\\x70\\x75\\x73\\x68' origin main",
  "git $'push' origin main", "git push origin main", "vercel $'--target' $'production'",
];

export function lexerCorpus(): LexerCorpus {
  return { argvProbes: argvProbes(), equivalences: equivalenceProbes() };
}

function argvProbes(): readonly ArgvProbe[] {
  return [
    ...ansiCArgvProbes(),
    ...underTheInertVerb("quoting forms composed into one word", QUOTING_COMPOSITION_LINES),
    ...underTheInertVerb("a brace that is no reserved word", BRACE_LINES),
    ...asWritten("a brace group, where the brace is a reserved word", BRACE_GROUP_LINES),
    ...asWritten("a subshell group, whose commands the shell runs in a child", SUBSHELL_GROUP_LINES),
    ...asWritten("the negation reserved word in front of a command", NEGATION_LINES),
    ...asWritten("operators the shell traces in a fixed order", OPERATOR_LINES),
    ...underTheInertVerb("comments and redirections, which are no words of the command", COMMENT_AND_REDIRECTION_LINES),
    ...underTheInertVerb("a dollar-quote the shell does not read as ANSI-C", DOLLAR_QUOTE_THE_SHELL_DOES_NOT_DECODE_LINES),
    ...underTheInertVerb(
      "a dollar sigil the shell leaves literal, because no quoting form follows it",
      DOLLAR_SIGIL_NO_QUOTING_FORM_FOLLOWS_LINES,
    ),
    ...underTheInertVerb("the divergence spellings and the siblings they mimic", DIVERGENCE_SPELLING_LINES),
  ];
}

function ansiCArgvProbes(): readonly ArgvProbe[] {
  return ANSI_C_ESCAPES_DECODING_TO_PRINTABLE_TEXT.flatMap((escape) =>
    DOLLAR_QUOTING_CONTEXTS.flatMap((context) => [
      {
        construct: `an ANSI-C escape decoding to printable text, ${context.named}`,
        line: `${INERT_VERB} ${context.spell(`$'${escape}'`)}`,
      },
      {
        construct: `an ANSI-C escape decoding to printable text, ${context.named} and between neighbours`,
        line: `${INERT_VERB} ${context.spell(`$'x${escape}y'`)}`,
      },
    ]),
  );
}

function equivalenceProbes(): readonly EquivalenceProbe[] {
  return ANSI_C_ESCAPES_DECODING_TO_A_CONTROL_CHARACTER.flatMap(({ escape, decoded }) =>
    DOLLAR_QUOTING_CONTEXTS.map((context) => ({
      construct: `an ANSI-C escape decoding to a control character, ${context.named}`,
      escaped: `${INERT_VERB} ${context.spell(`$'x${escape}y'`)}`,
      literal: `${INERT_VERB} ${context.spell(`'x${decoded}y'`)}`,
    })),
  );
}

function underTheInertVerb(construct: string, lines: readonly string[]): readonly ArgvProbe[] {
  return lines.map((line) => ({ construct, line: `${INERT_VERB} ${line}` }));
}

function asWritten(construct: string, lines: readonly string[]): readonly ArgvProbe[] {
  return lines.map((line) => ({ construct, line }));
}
