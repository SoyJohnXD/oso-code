import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { wordCountOf } from "../support/prose-sentences.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;

const PLAN_DIRECTORY = "plugin/skills/plan";
const WRAPPER = `${PLAN_DIRECTORY}/SKILL.md`;
const HOST_FILE = `${PLAN_DIRECTORY}/references/claude.md`;
const SHARED_HOST_FILE = "plugin/skills/_shared/references/claude.md";
const REQUIRED_READS = [
  HOST_FILE,
  SHARED_HOST_FILE,
  "plugin/skills/_shared/reporting.md",
  "plugin/skills/_shared/rubric.md",
];
const WORD_BUDGET = 8000;

const ALWAYS_MARKER = /read ALWAYS by this flow/;
const BACKTICKED_MARKDOWN_PATH = /`([^`]*\/[^`]*\.md)`/g;

function resolveFromPlan(raw: string): string {
  const spelled = raw.replaceAll("<host>", "claude").replaceAll("${CLAUDE_SKILL_DIR}", PLAN_DIRECTORY);
  if (spelled.startsWith("_shared/")) return `plugin/skills/${spelled}`;
  if (spelled.startsWith("plugin/")) return path.posix.normalize(spelled);
  return path.posix.join(PLAN_DIRECTORY, spelled);
}

function namedPaths(text: string): string[] {
  return [...text.matchAll(BACKTICKED_MARKDOWN_PATH)].map(([, raw]) => resolveFromPlan(raw ?? ""));
}

function markedAlwaysIn(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => ALWAYS_MARKER.test(line))
    .flatMap(namedPaths);
}

function alwaysReadFiles(read: ReadFile): string[] {
  const marked = [...markedAlwaysIn(read(WRAPPER)), ...markedAlwaysIn(read(HOST_FILE))];
  return [...new Set([...REQUIRED_READS, ...marked])].filter((file) => file !== WRAPPER).sort();
}

function filesTheWrapperNeverNames(read: ReadFile): string[] {
  const named = new Set(namedPaths(read(WRAPPER)));
  return alwaysReadFiles(read).filter((file) => !named.has(file));
}

function loadedWordCounts(read: ReadFile): ReadonlyArray<readonly [string, number]> {
  return [WRAPPER, ...alwaysReadFiles(read)].map((file) => [file, wordCountOf(read(file))] as const);
}

const readFromTree: ReadFile = (file) => readTrackedText(file).text;

const counts = loadedWordCounts(readFromTree);
const total = counts.reduce((sum, [, words]) => sum + words, 0);
const perFile = counts.map(([file, words]) => `${file}=${words}`).join(", ");

provedSomething(
  `the plan flow's always-read set holds its wrapper and at least the ${REQUIRED_READS.length} files it must read`,
  counts.length > REQUIRED_READS.length && counts.every(([, words]) => words > 0),
  `measured only: ${perFile}`,
);

describe("the plan flow names every file it always reads directly from its SKILL.md, one level deep", () => {
  test("no always-read file is reached only through another reference", () => {
    assert.deepEqual(filesTheWrapperNeverNames(readFromTree), []);
  });

  test(`the always-read prose totals ${total} words, within ${WORD_BUDGET}: ${perFile}`, () => {
    assert.ok(total <= WORD_BUDGET, `the always-read prose totals ${total} words, over ${WORD_BUDGET}: ${perFile}`);
  });
});

describe("the checker reports a planted regression", () => {
  test("a wrapper that stops naming the shared host file is reported", () => {
    const mutated: ReadFile = (file) =>
      file === WRAPPER ? readFromTree(file).replaceAll("`_shared/references/<host>.md`", "the shared host file") : readFromTree(file);
    assert.ok(filesTheWrapperNeverNames(mutated).includes(SHARED_HOST_FILE));
  });

  test("a file the host file alone marks read always is reported", () => {
    const planted = "plugin/skills/_shared/planted.md";
    const mutated: ReadFile = (file) =>
      file === HOST_FILE ? `${readFromTree(file)}\nRead \`_shared/planted.md\`, read ALWAYS by this flow.\n` : readFromTree(file);
    assert.deepEqual(filesTheWrapperNeverNames(mutated), [...filesTheWrapperNeverNames(readFromTree), planted].sort());
  });
});
