import type { ScanLanguage } from "./languages.ts";

export type CommentForm = "inline" | "doc" | "shebang" | "license";

export type CommentOpening = Readonly<{ line: number; form: CommentForm; text: string }>;

type RawOpening = Readonly<{ line: number; endLine: number; startsLine: boolean; form: CommentForm; text: string }>;

type OpenBlock = Readonly<{ kind: "block"; depth: number; openedAt: number; startsLine: boolean; form: CommentForm; text: string }>;

type Carry = Readonly<{ kind: "code" }> | OpenBlock | Readonly<{ kind: "quoted"; terminator: string; escaped: boolean }>;

type Resumption =
  | Readonly<{ state: "resumed"; at: number; closed: readonly RawOpening[] }>
  | Readonly<{ state: "carried"; carry: Carry }>;

type BlockProgress = Readonly<{ state: "closed"; at: number } | { state: "open"; depth: number }>;

type QuotedRun = Readonly<{ width: number; terminator: string; escaped: boolean }>;

type QuotedSkip = Readonly<{ state: "skipped"; at: number } | { state: "carried"; carry: Carry }>;

const CODE: Carry = { kind: "code" };
const LICENSE_MARKER = /\b(?:Copyright|SPDX-License-Identifier|Licensed under)\b/;
const OPERAND_EXPECTING_KEYWORD =
  /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|do|else|void|throw|yield|await|case)$/;
const CLOSES_AN_OPERAND = /[\w$)\]]$/;
const RUST_RAW_STRING = /^b?r(#*)"/;
const PYTHON_TRIPLE_QUOTES = ['"""', "'''"] as const;
const SHELL_WORD_BOUNDARY = new Set([" ", "\t", ";", "&", "|", "(", "`"]);

export function commentOpeningsIn(language: ScanLanguage, text: string): CommentOpening[] {
  const lines = text.split("\n");
  const marked = licenseHeaderMarked(openingsOf(language, lines), lines);
  return marked.map(({ line, form, text: openingText }) => ({ line, form, text: openingText }));
}

function openingsOf(language: ScanLanguage, lines: readonly string[]): RawOpening[] {
  const shebang = shebangOpeningOf(lines);
  const firstLine = shebang.length + 1;
  const readsHashComments = language === "python" || language === "shell";
  const body = readsHashComments ? hashOpenings(lines, firstLine, language) : slashOpenings(lines, firstLine, language);
  return [...shebang, ...body];
}

function shebangOpeningOf(lines: readonly string[]): RawOpening[] {
  const first = lines[0];
  if (first === undefined || !first.startsWith("#!")) return [];
  return [{ line: 1, endLine: 1, startsLine: true, form: "shebang", text: first.trim() }];
}

function slashOpenings(lines: readonly string[], firstLine: number, language: ScanLanguage): RawOpening[] {
  const nestsBlocks = language === "rust";
  const openings: RawOpening[] = [];
  let carry: Carry = CODE;
  for (let number = firstLine; number <= lines.length; number += 1) {
    const line = lines[number - 1] as string;
    const resumption = resumeCarry(carry, line, number, nestsBlocks);
    if (resumption.state === "carried") {
      carry = resumption.carry;
      continue;
    }
    openings.push(...resumption.closed);
    carry = CODE;
    let index = resumption.at;
    while (index < line.length) {
      const rest = line.slice(index);
      const lineComment = slashLineCommentFormOf(rest, language);
      if (lineComment !== undefined) {
        openings.push(openingAt(number, index, line, lineComment));
        break;
      }
      if (rest.startsWith("/*")) {
        const block = openedBlockAt(number, index, line, blockCommentFormOf(rest, language));
        const progress = advanceBlock(line, index + 2, 1, nestsBlocks);
        if (progress.state === "open") {
          carry = { ...block, depth: progress.depth };
          break;
        }
        openings.push(closedBlockOpening(block, number));
        index = progress.at;
        continue;
      }
      const quoted = skipQuotedRun(line, index, language);
      if (quoted?.state === "carried") {
        carry = quoted.carry;
        break;
      }
      index = quoted?.at ?? index + skippedWidthOf(line, index, language);
    }
  }
  return openings;
}

function hashOpenings(lines: readonly string[], firstLine: number, language: ScanLanguage): RawOpening[] {
  const openings: RawOpening[] = [];
  let carry: Carry = CODE;
  for (let number = firstLine; number <= lines.length; number += 1) {
    const line = lines[number - 1] as string;
    const resumption = resumeCarry(carry, line, number, false);
    if (resumption.state === "carried") {
      carry = resumption.carry;
      continue;
    }
    carry = CODE;
    let index = resumption.at;
    while (index < line.length) {
      const rest = line.slice(index);
      if (language === "shell" && rest.startsWith("\\")) {
        index += 2;
        continue;
      }
      const quoted = skipQuotedRun(line, index, language);
      if (quoted?.state === "carried") {
        carry = quoted.carry;
        break;
      }
      if (quoted !== undefined) {
        index = quoted.at;
        continue;
      }
      if (rest.startsWith("#") && (language === "python" || opensShellWord(line, index))) {
        openings.push(openingAt(number, index, line, "inline"));
        break;
      }
      index += 1;
    }
  }
  return openings;
}

function resumeCarry(carry: Carry, line: string, number: number, nestsBlocks: boolean): Resumption {
  if (carry.kind === "code") return { state: "resumed", at: 0, closed: [] };
  if (carry.kind === "quoted") {
    const closed = advanceQuoted(line, 0, carry.terminator, carry.escaped);
    return closed === undefined ? { state: "carried", carry } : { state: "resumed", at: closed, closed: [] };
  }
  const progress = advanceBlock(line, 0, carry.depth, nestsBlocks);
  if (progress.state === "open") return { state: "carried", carry: { ...carry, depth: progress.depth } };
  return { state: "resumed", at: progress.at, closed: [closedBlockOpening(carry, number)] };
}

function closedBlockOpening({ openedAt, startsLine, form, text }: OpenBlock, endLine: number): RawOpening {
  return { line: openedAt, endLine, startsLine, form, text };
}

function advanceBlock(line: string, from: number, depth: number, nestsBlocks: boolean): BlockProgress {
  let index = from;
  let open = depth;
  while (index < line.length) {
    if (line.startsWith("*/", index)) {
      open -= 1;
      index += 2;
      if (open <= 0) return { state: "closed", at: index };
      continue;
    }
    if (nestsBlocks && line.startsWith("/*", index)) {
      open += 1;
      index += 2;
      continue;
    }
    index += 1;
  }
  return { state: "open", depth: open };
}

function skipQuotedRun(line: string, index: number, language: ScanLanguage): QuotedSkip | undefined {
  const run = quotedRunOpenedAt(line.slice(index), language);
  if (run === undefined) return undefined;
  const { width, terminator, escaped } = run;
  const closed = advanceQuoted(line, index + width, terminator, escaped);
  if (closed === undefined) return { state: "carried", carry: { kind: "quoted", terminator, escaped } };
  return { state: "skipped", at: closed };
}

function advanceQuoted(line: string, from: number, terminator: string, escaped: boolean): number | undefined {
  let index = from;
  while (index < line.length) {
    if (escaped && line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line.startsWith(terminator, index)) return index + terminator.length;
    index += 1;
  }
  return undefined;
}

function quotedRunOpenedAt(rest: string, language: ScanLanguage): QuotedRun | undefined {
  if (language === "rust") return rustQuotedRunAt(rest);
  if (language === "python") return pythonQuotedRunAt(rest);
  if (language === "shell") return shellQuotedRunAt(rest);
  return scriptQuotedRunAt(rest);
}

function rustQuotedRunAt(rest: string): QuotedRun | undefined {
  const raw = RUST_RAW_STRING.exec(rest);
  if (raw !== null) return { width: raw[0].length, terminator: `"${raw[1] as string}`, escaped: false };
  return rest.startsWith('"') ? { width: 1, terminator: '"', escaped: true } : undefined;
}

function pythonQuotedRunAt(rest: string): QuotedRun | undefined {
  const triple = PYTHON_TRIPLE_QUOTES.find((quotes) => rest.startsWith(quotes));
  if (triple !== undefined) return { width: triple.length, terminator: triple, escaped: true };
  return singleCharacterQuotedRunAt(rest, ['"', "'"], true);
}

function shellQuotedRunAt(rest: string): QuotedRun | undefined {
  if (rest.startsWith("'")) return { width: 1, terminator: "'", escaped: false };
  return singleCharacterQuotedRunAt(rest, ['"'], true);
}

function scriptQuotedRunAt(rest: string): QuotedRun | undefined {
  return singleCharacterQuotedRunAt(rest, ['"', "'", "`"], true);
}

function singleCharacterQuotedRunAt(rest: string, quotes: readonly string[], escaped: boolean): QuotedRun | undefined {
  const quote = quotes.find((candidate) => rest.startsWith(candidate));
  return quote === undefined ? undefined : { width: 1, terminator: quote, escaped };
}

function skippedWidthOf(line: string, index: number, language: ScanLanguage): number {
  if (language === "rust" && line[index] === "'") return rustTickWidthAt(line, index);
  if (line[index] !== "/" || !opensRegexAt(line, index)) return 1;
  const closed = advanceQuoted(line, index + 1, "/", true);
  return closed === undefined ? 1 : closed - index;
}

function rustTickWidthAt(line: string, index: number): number {
  if (line[index + 1] === "\\") {
    const closed = advanceQuoted(line, index + 1, "'", true);
    return closed === undefined ? 1 : closed - index;
  }
  return line[index + 2] === "'" ? 3 : 1;
}

function opensRegexAt(line: string, index: number): boolean {
  const before = line.slice(0, index).trimEnd();
  if (before === "") return true;
  if (OPERAND_EXPECTING_KEYWORD.test(before)) return true;
  return !CLOSES_AN_OPERAND.test(before);
}

function opensShellWord(line: string, index: number): boolean {
  if (index === 0) return true;
  return SHELL_WORD_BOUNDARY.has(line[index - 1] as string);
}

function slashLineCommentFormOf(rest: string, language: ScanLanguage): CommentForm | undefined {
  if (!rest.startsWith("//")) return undefined;
  if (language !== "rust") return "inline";
  return rest.startsWith("///") || rest.startsWith("//!") ? "doc" : "inline";
}

function blockCommentFormOf(rest: string, language: ScanLanguage): CommentForm {
  if (rest.startsWith("/**")) return "doc";
  return language === "rust" && rest.startsWith("/*!") ? "doc" : "inline";
}

function openedBlockAt(line: number, column: number, text: string, form: CommentForm): OpenBlock {
  return { kind: "block", depth: 1, openedAt: line, startsLine: opensLine(text, column), form, text: text.trim() };
}

function openingAt(line: number, column: number, text: string, form: CommentForm): RawOpening {
  return { line, endLine: line, startsLine: opensLine(text, column), form, text: text.trim() };
}

function opensLine(line: string, column: number): boolean {
  return line.slice(0, column).trim() === "";
}

function licenseHeaderMarked(openings: readonly RawOpening[], lines: readonly string[]): RawOpening[] {
  const headerEnd = headerEndLineOf(openings, lines);
  if (headerEnd === 0 || !LICENSE_MARKER.test(lines.slice(0, headerEnd).join("\n"))) return [...openings];
  return openings.map((opening) =>
    opening.form === "inline" && opening.line <= headerEnd ? { ...opening, form: "license" } : opening,
  );
}

function headerEndLineOf(openings: readonly RawOpening[], lines: readonly string[]): number {
  const covered = new Set<number>();
  for (const opening of openings) {
    if (!opening.startsLine) continue;
    for (let line = opening.line; line <= opening.endLine; line += 1) covered.add(line);
  }
  let end = 0;
  for (let number = 1; number <= lines.length; number += 1) {
    if ((lines[number - 1] as string).trim() !== "" && !covered.has(number)) return end;
    end = number;
  }
  return end;
}
