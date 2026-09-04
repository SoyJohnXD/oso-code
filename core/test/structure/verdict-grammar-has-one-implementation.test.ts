import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { firstLineContaining } from "../support/line-locate.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const VERDICT_GRAMMAR_OWNER = "opencode/plugin/oso/verdict.ts";
const CANONICAL_SEARCH_ROOTS = ["plugin", "codex", "bootstrap", "tests", "tools", "opencode/plugin", "opencode/hooks"];
const ALTERNATION_PATTERN = /\([a-z]+\|[a-z]+\)/g;

const MINIMUM_ALTERNATIONS = 2;
const MINIMUM_ALTERNATIONS_DERIVATION =
  `${VERDICT_GRAMMAR_OWNER}'s STATUS_LINE and VERDICT_LINE regex literals, measured at C5-S5b-2: (done|blocked), (pass|fail) — 2`;

const MINIMUM_SEARCHED_FILES = 100;
const MINIMUM_SEARCHED_FILES_DERIVATION =
  `git ls-files under whichever of ${CANONICAL_SEARCH_ROOTS.join(", ")} exists on disk (opencode/hooks holds none), ` +
  "measured at C5-S5b-2: 121, the tracked files under the searched roots less the file that owns the vocabulary";

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
  (file) => SEARCHED_PREFIXES.some((prefix) => file.startsWith(prefix)) && file !== VERDICT_GRAMMAR_OWNER,
);

provedSomething(
  `${VERDICT_GRAMMAR_OWNER} spelled ${alternations.length} verdict-vocabulary alternation(s) to compare against`,
  alternations.length >= MINIMUM_ALTERNATIONS,
  `${VERDICT_GRAMMAR_OWNER} spelled ${alternations.length} alternation(s), under the ${MINIMUM_ALTERNATIONS}-alternation ` +
    `floor (${MINIMUM_ALTERNATIONS_DERIVATION})`,
);

provedSomething(
  `${searchedFiles.length} tracked file(s) under ${SEARCHED_PREFIXES.join(", ")} were searched for a duplicate verdict-vocabulary alternation`,
  searchedFiles.length >= MINIMUM_SEARCHED_FILES,
  `only ${searchedFiles.length} file(s) were found, under the ${MINIMUM_SEARCHED_FILES}-file floor ` +
    `(${MINIMUM_SEARCHED_FILES_DERIVATION})`,
);

const duplicates = alternations.flatMap((alternation) =>
  searchedFiles.flatMap((file) => {
    const line = firstLineContaining(readTrackedText(file).text, alternation);
    return line === undefined ? [] : [`${VERDICT_GRAMMAR_OWNER} spells ${alternation}, duplicated at ${file}:${line}`];
  }),
);

describe(
  `${VERDICT_GRAMMAR_OWNER} is the sole implementation of the verdict vocabulary a delegated report is read with — ` +
    `no file under ${SEARCHED_PREFIXES.join(", ")} spells the same (word|word) alternation`,
  () => {
    test("no searched file duplicates a verdict-vocabulary alternation the owner spells", () => {
      assert.deepEqual(duplicates, [], duplicates.join("\n"));
    });
  },
);
