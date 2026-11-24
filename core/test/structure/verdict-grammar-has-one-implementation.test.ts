import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { GENERATED_BUNDLES } from "../../src/routes/routes.ts";
import { firstLineContaining } from "../support/line-locate.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const VERDICT_GRAMMAR_OWNER = "core/src/verdict/grammar.ts";
const CANONICAL_SEARCH_ROOTS = ["core/src", "plugin", "bootstrap", "tests", "tools", "opencode/plugin", "opencode/hooks"];
const ALTERNATION_PATTERN = /\([a-z]+(?:\|[a-z]+)+\)/g;

function searchedPrefixes(): string[] {
  return CANONICAL_SEARCH_ROOTS.filter((root) => existsSync(path.join(repositoryRoot, root))).map((root) => `${root}/`);
}

function rightmostAlternationOnLine(line: string): string | undefined {
  const matches = [...line.matchAll(ALTERNATION_PATTERN)];
  const last = matches.at(-1);
  return last === undefined ? undefined : last[0];
}

const trackedFiles = trackedRepositoryFiles();
const trackedFileSet = new Set(trackedFiles);

const alternations = trackedFileSet.has(VERDICT_GRAMMAR_OWNER)
  ? [
      ...new Set(
        readTrackedText(VERDICT_GRAMMAR_OWNER)
          .text.split("\n")
          .flatMap((line) => {
            const found = rightmostAlternationOnLine(line);
            return found === undefined ? [] : [found];
          }),
      ),
    ].sort()
  : [];

const SEARCHED_PREFIXES = searchedPrefixes();

const searchedFiles = trackedFiles.filter(
  (file) =>
    SEARCHED_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
    file !== VERDICT_GRAMMAR_OWNER &&
    !GENERATED_BUNDLES.includes(file),
);

provedSomething(
  `${VERDICT_GRAMMAR_OWNER} spelled a verdict-vocabulary alternation to compare against`,
  alternations.length > 0,
  `${VERDICT_GRAMMAR_OWNER} spelled no verdict-vocabulary alternation, so the search for a duplicate compared against nothing`,
);

provedSomething(
  `a tracked file under ${SEARCHED_PREFIXES.join(", ")}, builder outputs aside, was searched for a duplicate verdict-vocabulary alternation`,
  searchedFiles.length > 0,
  "no file was searched, so no duplicate verdict-vocabulary alternation could have been found",
);

const duplicates = alternations.flatMap((alternation) =>
  searchedFiles.flatMap((file) => {
    const line = firstLineContaining(readTrackedText(file).text, alternation);
    return line === undefined ? [] : [`${VERDICT_GRAMMAR_OWNER} spells ${alternation}, duplicated at ${file}:${line}`];
  }),
);

describe(
  `${VERDICT_GRAMMAR_OWNER} is the sole implementation of the verdict vocabulary a delegated report is read with — ` +
    `no file under ${SEARCHED_PREFIXES.join(", ")} spells the same alternation of two or more words`,
  () => {
    test("no searched file duplicates a verdict-vocabulary alternation the owner spells", () => {
      assert.deepEqual(duplicates, [], duplicates.join("\n"));
    });
  },
);
