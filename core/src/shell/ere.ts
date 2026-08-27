type EreRead = Readonly<{ source: string; after: number }>;

type AtomWidth = "consumesInput" | "assertsALinePosition" | "assertsAWordEdge";

type EreAtom = EreRead & Readonly<{ width: AtomWidth }>;

type EreQuantifier = EreRead & Readonly<{ spelling: "operator" | "interval"; repeatsAtMost: number }>;

const ALPHABETIC_MEMBERS = "\\p{Alphabetic}";
const ALPHANUMERIC_MEMBERS = `${ALPHABETIC_MEMBERS}\\p{Nd}`;
const WHITESPACE_MEMBERS = "\\t\\n\\v\\f\\r \\p{Zs}\\u2028\\u2029";
const WORD_MEMBERS = `_${ALPHANUMERIC_MEMBERS}`;
const NO_BREAK_SPACE = "\\u00a0";

const POSIX_CLASS_MEMBERS: Readonly<Record<string, string>> = {
  alpha: ALPHABETIC_MEMBERS,
  digit: "0-9",
  alnum: ALPHANUMERIC_MEMBERS,
  upper: "\\p{Uppercase}",
  lower: "\\p{Lowercase}",
  space: WHITESPACE_MEMBERS,
  blank: "\\t \\p{Zs}",
  punct: `\\p{P}\\p{S}\\p{M}${NO_BREAK_SPACE}`,
  print: "\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}\\p{Zs}",
  graph: `\\p{L}\\p{M}\\p{N}\\p{P}\\p{S}${NO_BREAK_SPACE}`,
  cntrl: "\\p{Cc}\\u2028\\u2029",
  xdigit: "0-9A-Fa-f",
};

const ON_A_WORD = `(?=[${WORD_MEMBERS}])`;
const OFF_A_WORD = `(?![${WORD_MEMBERS}])`;
const AFTER_A_WORD = `(?<=[${WORD_MEMBERS}])`;
const BEFORE_A_WORD = `(?<![${WORD_MEMBERS}])`;

const GNU_CLASS_ESCAPES: Readonly<Record<string, string>> = {
  w: `[${WORD_MEMBERS}]`,
  W: `[^${WORD_MEMBERS}]`,
  s: `[${WHITESPACE_MEMBERS}]`,
  S: `[^${WHITESPACE_MEMBERS}]`,
};

const GNU_WORD_EDGE_ESCAPES: Readonly<Record<string, string>> = {
  b: `(?:${AFTER_A_WORD}${OFF_A_WORD}|${BEFORE_A_WORD}${ON_A_WORD})`,
  B: `(?:${AFTER_A_WORD}${ON_A_WORD}|${BEFORE_A_WORD}${OFF_A_WORD})`,
  "<": `${BEFORE_A_WORD}${ON_A_WORD}`,
  ">": `${AFTER_A_WORD}${OFF_A_WORD}`,
};

const GNU_LINE_ANCHOR_ESCAPES: Readonly<Record<string, string>> = {
  "`": "^",
  "'": "$",
};

const ANY_CHARACTER_IN_A_LINE = "[^\\n]";
const INTERVAL = /^\{(\d*)(,\d*)?\}/;
const POSIX_CLASS_NAME = /^\[:([A-Za-z]+):\]/;
const BACKREFERENCE = /^[1-9]$/;
const UNESCAPED_IN_JS = /^[A-Za-z0-9]$/;
const ASCII_DIGIT = /^[0-9]$/;
const ASCII_LETTER = /^[A-Za-z]$/;
const RANGE_BLOCKS_EVERY_LOCALE_ORDERS_ALIKE = [ASCII_DIGIT, /^[a-z]$/, /^[A-Z]$/];
const FIRST_NON_ASCII_CODE_POINT = 0x80;
const TOP_LEVEL = 0;
const MATCHES_NOTHING_AS_A_PATTERN_GREP_REJECTS_DOES = false;

export function ereMatches(pattern: string, subject: string): boolean {
  const expression = compiledEre(pattern);
  if (expression === undefined) return MATCHES_NOTHING_AS_A_PATTERN_GREP_REJECTS_DOES;
  return grepLinesOf(subject).some((line) => expression.test(line));
}

function grepLinesOf(subject: string): readonly string[] {
  const lines = subject.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function compiledEre(pattern: string): RegExp | undefined {
  const source = jsSourceOf(pattern);
  if (source === undefined) return undefined;
  try {
    return new RegExp(source, "u");
  } catch {
    return undefined;
  }
}

function jsSourceOf(pattern: string): string | undefined {
  const read = readAlternation(pattern, 0, TOP_LEVEL);
  if (read === undefined || read.after !== pattern.length) return undefined;
  return read.source;
}

function readAlternation(pattern: string, from: number, depth: number): EreRead | undefined {
  let source = "";
  let cursor = from;
  for (;;) {
    const branch = readBranch(pattern, cursor, depth);
    if (branch === undefined) return undefined;
    source += branch.source;
    cursor = branch.after;
    if (pattern[cursor] !== "|") return { source, after: cursor };
    source += "|";
    cursor += 1;
  }
}

function readBranch(pattern: string, from: number, depth: number): EreRead | undefined {
  let source = "";
  let cursor = from;
  for (;;) {
    const settled = pastQuantifiersWithNothingToRepeat(pattern, cursor, depth);
    if (settled === undefined) return undefined;
    cursor = settled;
    if (branchEndsAt(pattern, cursor, depth)) return { source, after: cursor };
    const piece = readPiece(pattern, cursor, depth);
    if (piece === undefined) return undefined;
    source += piece.source;
    cursor = piece.after;
  }
}

function branchEndsAt(pattern: string, at: number, depth: number): boolean {
  const character = pattern[at];
  if (character === undefined || character === "|") return true;
  return character === ")" && depth > TOP_LEVEL;
}

function pastQuantifiersWithNothingToRepeat(pattern: string, from: number, depth: number): number | undefined {
  let cursor = from;
  for (;;) {
    const quantifier = readQuantifier(pattern, cursor);
    if (quantifier === undefined) return cursor;
    if (endsAnEmptyGroup(pattern, quantifier, depth)) return undefined;
    cursor = quantifier.after;
  }
}

function endsAnEmptyGroup(pattern: string, quantifier: EreQuantifier, depth: number): boolean {
  return depth > TOP_LEVEL && quantifier.spelling === "operator" && pattern[quantifier.after] === ")";
}

function readPiece(pattern: string, from: number, depth: number): EreRead | undefined {
  const atom = readAtom(pattern, from, depth);
  if (atom === undefined) return undefined;
  if (atom.width === "assertsAWordEdge") return withDemotedQuantifiers(pattern, atom, depth);
  return withQuantifiers(pattern, atom, depth);
}

function withQuantifiers(pattern: string, atom: EreAtom, depth: number): EreRead | undefined {
  let piece: EreRead = atom;
  for (;;) {
    const quantifier = readQuantifier(pattern, piece.after);
    if (quantifier === undefined) return piece;
    if (atom.width !== "consumesInput" && endsAnEmptyGroup(pattern, quantifier, depth)) return undefined;
    piece = { source: `(?:${piece.source})${quantifier.source}`, after: quantifier.after };
  }
}

function withDemotedQuantifiers(pattern: string, atom: EreAtom, depth: number): EreRead | undefined {
  let cursor = atom.after;
  for (;;) {
    const quantifier = readQuantifier(pattern, cursor);
    if (quantifier === undefined) return { source: atom.source, after: cursor };
    if (endsAnEmptyGroup(pattern, quantifier, depth)) return undefined;
    if (quantifier.spelling === "operator") {
      cursor = quantifier.after;
      continue;
    }
    if (quantifier.repeatsAtMost === 0) return { source: "", after: quantifier.after };
    return { source: atom.source, after: cursor + 1 };
  }
}

function readQuantifier(pattern: string, at: number): EreQuantifier | undefined {
  const character = pattern[at];
  if (character === "*" || character === "+") {
    return { source: character, after: at + 1, spelling: "operator", repeatsAtMost: Infinity };
  }
  if (character === "?") return { source: character, after: at + 1, spelling: "operator", repeatsAtMost: 1 };
  const interval = INTERVAL.exec(pattern.slice(at));
  if (interval === null) return undefined;
  const [spelled, low = "", high] = interval;
  if (low === "" && high === undefined) return undefined;
  return {
    source: `{${low === "" ? "0" : low}${high ?? ""}}`,
    after: at + spelled.length,
    spelling: "interval",
    repeatsAtMost: intervalCeiling(low, high),
  };
}

function intervalCeiling(low: string, high: string | undefined): number {
  if (high === undefined) return Number(low);
  const spelledHigh = high.slice(1);
  return spelledHigh === "" ? Infinity : Number(spelledHigh);
}

function readAtom(pattern: string, from: number, depth: number): EreAtom | undefined {
  const character = characterAt(pattern, from);
  if (character === ".") return consuming(ANY_CHARACTER_IN_A_LINE, from + 1);
  if (character === "^" || character === "$") {
    return { source: character, after: from + 1, width: "assertsALinePosition" };
  }
  if (character === "[") return asAtom(readBracket(pattern, from), "consumesInput");
  if (character === "(") return asAtom(readGroup(pattern, from, depth), "consumesInput");
  if (character === "\\") return readEscape(pattern, from);
  return consuming(asJsLiteral(character), from + character.length);
}

function consuming(source: string, after: number): EreAtom {
  return { source, after, width: "consumesInput" };
}

function asAtom(read: EreRead | undefined, width: AtomWidth): EreAtom | undefined {
  return read === undefined ? undefined : { ...read, width };
}

function readGroup(pattern: string, from: number, depth: number): EreRead | undefined {
  const inner = readAlternation(pattern, from + 1, depth + 1);
  if (inner === undefined || pattern[inner.after] !== ")") return undefined;
  return { source: `(${inner.source})`, after: inner.after + 1 };
}

function readEscape(pattern: string, from: number): EreAtom | undefined {
  if (from + 1 >= pattern.length) return undefined;
  const escaped = characterAt(pattern, from + 1);
  const after = from + 1 + escaped.length;
  const wordEdge = GNU_WORD_EDGE_ESCAPES[escaped];
  if (wordEdge !== undefined) return { source: wordEdge, after, width: "assertsAWordEdge" };
  const lineAnchor = GNU_LINE_ANCHOR_ESCAPES[escaped];
  if (lineAnchor !== undefined) return { source: lineAnchor, after, width: "assertsALinePosition" };
  const characterClass = GNU_CLASS_ESCAPES[escaped];
  if (characterClass !== undefined) return consuming(characterClass, after);
  if (BACKREFERENCE.test(escaped)) return consuming(`\\${escaped}`, after);
  return consuming(asJsLiteral(escaped), after);
}

function readBracket(pattern: string, from: number): EreRead | undefined {
  const negated = pattern[from + 1] === "^";
  let cursor = from + (negated ? 2 : 1);
  let members = "";
  if (pattern[cursor] === "]") {
    members += asJsLiteral("]");
    cursor += 1;
  }
  for (;;) {
    const character = pattern[cursor];
    if (character === undefined) return undefined;
    if (character === "]") return { source: `[${negated ? "^" : ""}${members}]`, after: cursor + 1 };
    const member = readBracketMember(pattern, cursor);
    if (member === undefined) return undefined;
    members += member.source;
    cursor = member.after;
  }
}

function readBracketMember(pattern: string, from: number): EreRead | undefined {
  if (pattern.startsWith("[:", from)) return readPosixClass(pattern, from);
  if (pattern.startsWith("[.", from)) return readCollatingSymbol(pattern, from);
  if (pattern.startsWith("[=", from)) return readEquivalenceClass(pattern, from);
  return readRangeOrCharacter(pattern, from);
}

function readPosixClass(pattern: string, from: number): EreRead | undefined {
  const named = POSIX_CLASS_NAME.exec(pattern.slice(from));
  if (named === null) return undefined;
  const members = POSIX_CLASS_MEMBERS[named[1] as string];
  if (members === undefined) return undefined;
  return namedMemberEndingAt(members, from + named[0].length, pattern);
}

function readCollatingSymbol(pattern: string, from: number): EreRead | undefined {
  const symbol = characterAt(pattern, from + 2);
  const closing = from + 2 + symbol.length;
  if (symbol === "" || !pattern.startsWith(".]", closing)) return undefined;
  return namedMemberEndingAt(asJsLiteral(symbol), closing + 2, pattern);
}

function readEquivalenceClass(pattern: string, from: number): EreRead | undefined {
  const representative = characterAt(pattern, from + 2);
  const closing = from + 2 + representative.length;
  if (!pattern.startsWith("=]", closing)) return undefined;
  const members = equivalentToInEveryLocale(representative);
  if (members === undefined) return undefined;
  return namedMemberEndingAt(members, closing + 2, pattern);
}

function equivalentToInEveryLocale(representative: string): string | undefined {
  if (ASCII_DIGIT.test(representative)) return asJsLiteral(representative);
  if (!ASCII_LETTER.test(representative)) return undefined;
  return asJsLiteral(representative.toLowerCase()) + asJsLiteral(representative.toUpperCase());
}

function namedMemberEndingAt(members: string, after: number, pattern: string): EreRead | undefined {
  const next = pattern[after];
  if (next === "-" && pattern[after + 1] !== "]" && pattern[after + 1] !== undefined) return undefined;
  return { source: members, after };
}

function readRangeOrCharacter(pattern: string, from: number): EreRead | undefined {
  const low = characterAt(pattern, from);
  const dash = from + low.length;
  const highStarts = dash + 1;
  if (pattern[dash] !== "-" || highStarts >= pattern.length || pattern[highStarts] === "]") {
    return { source: asJsLiteral(low), after: dash };
  }
  const high = characterAt(pattern, highStarts);
  if (!rangeReadsByCodePoint(low, high)) return undefined;
  return { source: `${asJsLiteral(low)}-${asJsLiteral(high)}`, after: highStarts + high.length };
}

function rangeReadsByCodePoint(low: string, high: string): boolean {
  if (low === high) return (low.codePointAt(0) ?? 0) < FIRST_NON_ASCII_CODE_POINT;
  return RANGE_BLOCKS_EVERY_LOCALE_ORDERS_ALIKE.some(
    (block) => block.test(low) && block.test(high) && low < high,
  );
}

function characterAt(pattern: string, at: number): string {
  const codePoint = pattern.codePointAt(at);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function asJsLiteral(character: string): string {
  if (UNESCAPED_IN_JS.test(character)) return character;
  return `\\u{${(character.codePointAt(0) ?? 0).toString(16)}}`;
}
