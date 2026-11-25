import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const BYTES_PER_TOKEN = 4;
const GLOBAL_GUIDANCE_BUDGET_TOKENS = 2000;
const OUTPUT_STYLE_BUDGET_TOKENS = 1600;
const DESCRIPTIONS_BUDGET_TOKENS = { claude: 1200, opencode: 1300 };

const CLAUDE_GLOBAL_GUIDANCE = /^bootstrap\/claude-global\.md$/;
const OPENCODE_GLOBAL_GUIDANCE = /^bootstrap\/opencode-global\.md$/;
const OUTPUT_STYLE = /^plugin\/output-styles\/oso\.md$/;
const CLAUDE_DESCRIBED = /^plugin\/(?:skills\/(?!_shared\/)[^/]+\/SKILL|agents\/[^/]+)\.md$/;
const OPENCODE_DESCRIBED = /^opencode\/(?:skills\/[^/]+\/SKILL|agents\/[^/]+)\.md$/;

const FRONTMATTER_FENCE = "---";
const BLOCK_SCALAR_INDICATOR = /^[>|][+-]?$/;

type Entry = Readonly<{ source: string; bytes: number }>;
type Measurement = Readonly<{ tokens: number; largest: Entry | undefined }>;

function bytesOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function measure(entries: readonly Entry[]): Measurement {
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const largest = entries.reduce<Entry | undefined>(
    (best, entry) => (best === undefined || entry.bytes > best.bytes ? entry : best),
    undefined,
  );
  return { tokens: Math.ceil(totalBytes / BYTES_PER_TOKEN), largest };
}

function overrunReport(bucket: string, host: string, budgetTokens: number, entries: readonly Entry[]): string | undefined {
  const { tokens, largest } = measure(entries);
  if (tokens <= budgetTokens) return undefined;
  const contributor = largest === undefined ? "none" : `${largest.source} (${largest.bytes} bytes)`;
  return `${bucket} for ${host} measures ${tokens} tokens by bytes/${BYTES_PER_TOKEN}, over its budget of ${budgetTokens}; largest contributor: ${contributor}`;
}

function frontmatterLines(file: string, text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  assert.equal(lines[0], FRONTMATTER_FENCE, `${file}: no frontmatter opens the file`);
  const closing = lines.indexOf(FRONTMATTER_FENCE, 1);
  assert.notEqual(closing, -1, `${file}: the frontmatter never closes`);
  return lines.slice(1, closing);
}

function continuationOf(lines: readonly string[], keyIndex: number): string[] {
  const continuation: string[] = [];
  for (const line of lines.slice(keyIndex + 1)) {
    if (line !== "" && !/^\s/.test(line)) break;
    continuation.push(line);
  }
  return continuation;
}

function scalarValue(file: string, key: string, lines: readonly string[]): string | undefined {
  const keyIndex = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (keyIndex === -1) return undefined;
  const inline = (lines[keyIndex] ?? "").slice(key.length + 1).trim();
  const continuation = continuationOf(lines, keyIndex).map((line) => line.trim());
  if (BLOCK_SCALAR_INDICATOR.test(inline)) {
    const folded = inline.startsWith(">");
    return continuation.filter((line) => line !== "").join(folded ? " " : "\n");
  }
  if (inline.startsWith('"')) {
    assert.ok(inline.length > 1 && inline.endsWith('"'), `${file}: the ${key} quotes do not close on one line`);
    return JSON.parse(inline) as string;
  }
  if (inline.startsWith("'")) {
    assert.ok(inline.length > 1 && inline.endsWith("'"), `${file}: the ${key} quotes do not close on one line`);
    return inline.slice(1, -1).replace(/''/g, "'");
  }
  return [inline, ...continuation].filter((line) => line !== "").join(" ");
}

function describedEntry({ file, text }: TrackedFileText): Entry {
  const lines = frontmatterLines(file, text);
  const description = scalarValue(file, "description", lines);
  assert.ok(description !== undefined && description !== "", `${file}: no readable description in its frontmatter`);
  const declaredName = scalarValue(file, "name", lines);
  const name = declaredName ?? path.basename(file, ".md");
  assert.ok(name !== "", `${file}: no readable name`);
  return { source: file, bytes: bytesOf(name) + bytesOf(description) };
}

function wholeFileEntry({ file, text }: TrackedFileText): Entry {
  return { source: file, bytes: bytesOf(text) };
}

const trackedFiles = trackedRepositoryFiles();

function filesMatching(pattern: RegExp): string[] {
  return trackedFiles.filter((file) => pattern.test(file));
}

const claudeGlobal = filesMatching(CLAUDE_GLOBAL_GUIDANCE).map(readTrackedText).map(wholeFileEntry);
const opencodeGlobal = filesMatching(OPENCODE_GLOBAL_GUIDANCE).map(readTrackedText).map(wholeFileEntry);
const outputStyle = filesMatching(OUTPUT_STYLE).map(readTrackedText).map(wholeFileEntry);
const claudeDescribed = filesMatching(CLAUDE_DESCRIBED).map(readTrackedText).map(describedEntry);
const opencodeDescribed = filesMatching(OPENCODE_DESCRIBED).map(readTrackedText).map(describedEntry);

const BUCKETS = [
  { bucket: "global guidance", host: "Claude", budget: GLOBAL_GUIDANCE_BUDGET_TOKENS, entries: claudeGlobal },
  { bucket: "global guidance", host: "OpenCode", budget: GLOBAL_GUIDANCE_BUDGET_TOKENS, entries: opencodeGlobal },
  { bucket: "output style", host: "Claude", budget: OUTPUT_STYLE_BUDGET_TOKENS, entries: outputStyle },
  { bucket: "skill and agent descriptions", host: "Claude", budget: DESCRIPTIONS_BUDGET_TOKENS.claude, entries: claudeDescribed },
  { bucket: "skill and agent descriptions", host: "OpenCode", budget: DESCRIPTIONS_BUDGET_TOKENS.opencode, entries: opencodeDescribed },
] as const;

for (const { bucket, host, entries } of BUCKETS) {
  provedSomething(
    `the ${bucket} of ${host} was read from at least one non-empty tracked file`,
    entries.length > 0 && entries.every((entry) => entry.bytes > 0),
    `${bucket} for ${host} read no tracked file or an empty one, so its budget check looked at a tree it did not recognise`,
  );
}

describe("the context every session loads at startup stays within three measured buckets, and SessionStart hook output is excluded because it is conditional", () => {
  for (const { bucket, host, budget, entries } of BUCKETS) {
    test(`the ${bucket} of ${host} stays within ${budget} tokens, estimated as bytes/${BYTES_PER_TOKEN}`, () => {
      assert.equal(overrunReport(bucket, host, budget, entries), undefined);
    });
  }
});

const PLANTED_ENTRIES: readonly Entry[] = [
  { source: "planted/small.md", bytes: 40 },
  { source: "planted/large.md", bytes: 4001 },
];

describe("overrunReport, read over planted entries this repository does not ship", () => {
  test("names the bucket, the host, the measured tokens, the budget and the largest contributor when the text is over budget", () => {
    const report = overrunReport("planted bucket", "planted host", 1000, PLANTED_ENTRIES);
    assert.ok(report !== undefined, "an overrun went unreported");
    assert.match(report, /planted bucket for planted host measures 1011 tokens/);
    assert.match(report, /over its budget of 1000/);
    assert.match(report, /planted\/large\.md \(4001 bytes\)/);
  });

  test("reports nothing when the text sits exactly at its budget", () => {
    assert.equal(overrunReport("planted bucket", "planted host", 1011, PLANTED_ENTRIES), undefined);
  });
});

const PLANTED_FRONTMATTER = {
  plain: ["---", "name: planted", "description: A plain description", "  that continues here", "model: x", "---", "body"],
  folded: ["---", "name: planted", "description: >", "  folded one", "  folded two", "---", "body"],
  literal: ["---", "name: planted", "description: |", "  literal one", "  literal two", "---", "body"],
  doubleQuoted: ["---", "name: planted", 'description: "quoted: with a colon"', "---", "body"],
  singleQuoted: ["---", "name: planted", "description: 'it''s quoted'", "---", "body"],
  nameFromFile: ["---", "description: only a description", "---", "body"],
  noDescription: ["---", "name: planted", "---", "body"],
  unclosedQuote: ["---", "name: planted", 'description: "never closes', "---", "body"],
  noFrontmatter: ["body only"],
} as const;

function plantedEntry(lines: readonly string[]): Entry {
  return describedEntry({ file: "planted/planted.md", text: lines.join("\n") });
}

describe("describedEntry, read over planted frontmatter this repository does not ship", () => {
  test("counts the name and the description of a plain, folded, literal, double-quoted and single-quoted form", () => {
    const planted = PLANTED_FRONTMATTER;
    assert.equal(plantedEntry(planted.plain).bytes, bytesOf("planted") + bytesOf("A plain description that continues here"));
    assert.equal(plantedEntry(planted.folded).bytes, bytesOf("planted") + bytesOf("folded one folded two"));
    assert.equal(plantedEntry(planted.literal).bytes, bytesOf("planted") + bytesOf("literal one\nliteral two"));
    assert.equal(plantedEntry(planted.doubleQuoted).bytes, bytesOf("planted") + bytesOf("quoted: with a colon"));
    assert.equal(plantedEntry(planted.singleQuoted).bytes, bytesOf("planted") + bytesOf("it's quoted"));
  });

  test("takes the name from the file when the frontmatter declares none", () => {
    assert.equal(plantedEntry(PLANTED_FRONTMATTER.nameFromFile).bytes, bytesOf("planted") + bytesOf("only a description"));
  });

  test("fails loudly on a missing description, an unclosed quote and a file with no frontmatter", () => {
    assert.throws(() => plantedEntry(PLANTED_FRONTMATTER.noDescription), /no readable description/);
    assert.throws(() => plantedEntry(PLANTED_FRONTMATTER.unclosedQuote), /quotes do not close/);
    assert.throws(() => plantedEntry(PLANTED_FRONTMATTER.noFrontmatter), /no frontmatter opens the file/);
  });
});
