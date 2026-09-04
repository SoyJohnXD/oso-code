import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readTextAtCommit } from "../support/prose-inventory.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const SLICE_START = "ddcfb84";
const DESIGN_TARGET_WORDS = 6000;
const CEILING_WORDS = 11000;
const CEILING_DERIVATION =
  "C5-S2c's measured closure, 10,587 words, rounded up to the next 500 — a fixed ceiling amended above the " +
  "design target rather than re-derived from a later total";

const WRAPPER = "plugin/skills/plan/SKILL.md";
const CLAUDE_SKILL_DIR = "plugin/skills/plan";

const ALWAYS_MARKER = /read ALWAYS by this flow/;
const REF_PATTERN = /`([^`<]*\/[^`<]*\.md)`/g;
const CONDITION_PATTERNS: readonly RegExp[] = [
  /\bwhen the change\b/i,
  /\btrigger fires\b/i,
  /\bdidactic register\b/i,
  /\bonly once\b/i,
  /\brubric path\b/i,
  /\bruns as a child of the ROADMAP\b/i,
];

function resolveRef(raw: string, fromFile: string): string {
  const substituted = raw.replaceAll("${CLAUDE_SKILL_DIR}", CLAUDE_SKILL_DIR);
  if (substituted.startsWith("_shared/")) return `plugin/skills/${substituted}`;
  if (substituted.startsWith("plugin/")) return path.posix.normalize(substituted);
  if (substituted.startsWith("../")) return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), substituted));
  return substituted;
}

function refsIn(line: string, fromFile: string): string[] {
  return [...line.matchAll(REF_PATTERN)].map((match) => resolveRef(match[1] as string, fromFile));
}

function alwaysRefsInLine(line: string, fromFile: string): string[] {
  return ALWAYS_MARKER.test(line) ? refsIn(line, fromFile) : [];
}

function isRecursable(file: string): boolean {
  return file === WRAPPER || /\/references\/[^/]+\.md$/.test(file);
}

function deriveAlwaysClosure(): string[] {
  const visited: string[] = [];
  const queue = [WRAPPER, path.posix.join(path.posix.dirname(WRAPPER), "references", "claude.md")];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.includes(file)) continue;
    visited.push(file);
    if (!isRecursable(file)) continue;
    for (const line of readTrackedText(file).text.split("\n")) {
      for (const ref of alwaysRefsInLine(line, file)) if (!visited.includes(ref) && !queue.includes(ref)) queue.push(ref);
    }
  }
  return visited;
}

function deriveConditionals(alwaysFiles: readonly string[]): ReadonlyArray<{ file: string; condition: string | undefined }> {
  const occurrences = new Map<string, string[]>();
  for (const file of alwaysFiles.filter(isRecursable)) {
    for (const line of readTrackedText(file).text.split("\n")) {
      for (const ref of refsIn(line, file)) {
        if (alwaysFiles.includes(ref)) continue;
        occurrences.set(ref, [...(occurrences.get(ref) ?? []), line.trim()]);
      }
    }
  }
  return [...occurrences.entries()].map(([file, lines]) => ({
    file,
    condition: lines.find((line) => CONDITION_PATTERNS.some((pattern) => pattern.test(line))),
  }));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

describe("the closure deriver reads the wrapper's own text rather than a hand-typed file list", () => {
  const STATIC_LIST_SNAPSHOT_BEFORE_THE_PLANT = [
    "plugin/skills/_shared/reporting.md",
    "plugin/skills/_shared/unattended.md",
  ];
  const plantedLine = "See `_shared/planted.md`, read ALWAYS by this flow.";
  const planted = "plugin/skills/_shared/planted.md";

  test("RED observation: a file list frozen before the plant does not contain it", () => {
    assert.ok(!STATIC_LIST_SNAPSHOT_BEFORE_THE_PLANT.includes(planted));
  });
  test("observation after removing the plant: the line-level deriver extracts it live from the text", () => {
    assert.ok(alwaysRefsInLine(plantedLine, WRAPPER).includes(planted));
    assert.deepEqual(alwaysRefsInLine("no marker here, just a path `_shared/planted.md`", WRAPPER), []);
  });
});

describe("the plan wrapper's read-always closure on Claude Code, measured rather than assumed", () => {
  const sliceStartClosure = [
    "plugin/skills/plan/SKILL.md",
    "plugin/skills/_shared/bodies/plan.md",
    "plugin/skills/plan/references/claude.md",
    "plugin/skills/_shared/references/claude.md",
    "plugin/skills/_shared/reporting.md",
    "plugin/skills/_shared/unattended.md",
  ];
  const sliceStartTotal = sliceStartClosure.reduce(
    (sum, file) => sum + wordCount(readTextAtCommit(SLICE_START, file)),
    0,
  );
  provedSomething(
    `the closure at ${SLICE_START} (this slice's own SLICE START) totaled ${sliceStartTotal} words, over the ` +
      `${DESIGN_TARGET_WORDS}-word design target`,
    sliceStartTotal > DESIGN_TARGET_WORDS,
    `the closure at ${SLICE_START} totaled ${sliceStartTotal} words — this check would never have caught the pre-slice tree`,
  );

  const alwaysFiles = deriveAlwaysClosure();
  const conditionals = deriveConditionals(alwaysFiles);

  provedSomething(
    `the deriver walked at least 5 read-always file(s) from ${WRAPPER}`,
    alwaysFiles.length >= 5,
    `the deriver walked only ${alwaysFiles.length} file(s) — a broken walk would also report a small, wrong total`,
  );

  for (const { file, condition } of conditionals) {
    test(`${file} is referenced and ${condition === undefined ? "UNCLASSIFIED" : "read-on-condition"} — excluded from the sum below`, () => {
      assert.ok(condition !== undefined, `${file} matches no known read-on-condition sentence form; classify it explicitly`);
    });
  }

  const perFile = alwaysFiles.map((file) => `${file}=${wordCount(readTrackedText(file).text)}`);
  const total = alwaysFiles.reduce((sum, file) => sum + wordCount(readTrackedText(file).text), 0);
  const gap = total - DESIGN_TARGET_WORDS;

  test(
    `design target ${DESIGN_TARGET_WORDS}; ceiling ${CEILING_WORDS} (${CEILING_DERIVATION}); gap ${gap}; ` +
      `per file: ${perFile.join(", ")}`,
    () => {
      assert.ok(
        total <= CEILING_WORDS,
        `the read-always closure totals ${total} word(s), over its ${CEILING_WORDS} ceiling: ${perFile.join(", ")}`,
      );
    },
  );
});
