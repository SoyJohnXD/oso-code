import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;
type Clause = Readonly<{ name: string; pattern: RegExp }>;

const PLAN_SOURCE = "plugin/skills/plan/SKILL.md";
const PLAN_FILES = [PLAN_SOURCE, "opencode/skills/oso-plan/SKILL.md"];
const PARALLEL_FILE = "plugin/skills/_shared/parallel.md";
const UNATTENDED_FILE = "plugin/skills/_shared/unattended.md";

const RETIRED_LOOP = /until it passes/i;
const EMPTY_RESULT_CLAUSE = "an empty or malformed result counts against the cap";
const PARALLEL_CLAUSE = "the red slice loop runs under step 3's cap";

const PLAN_CAP_CLAUSES: readonly Clause[] = [
  { name: "two fix rounds at most", pattern: /at most TWO fix rounds/ },
  { name: "the round is read from the report's active slice row", pattern: /`oso-state report`'s `active slice` row/ },
  { name: "the strong tier gets one relaunch of applier and verifier", pattern: /ONE relaunch of applier and verifier on the strong tier/ },
  { name: "the three routes", pattern: /grant more rounds[^.]*its own slice[^.]*accept the residual/ },
  { name: "only an all-nit remainder is accepted", pattern: /only a remainder of `nit` findings[^.]*never a `blocker` or `structural`/ },
  { name: "the escalation is marked and journaled", pattern: /`\[!\]`[^.]*journal/ },
  { name: EMPTY_RESULT_CLAUSE, pattern: /empty, cut or malformed[^.]*never a verdict[^.]*counts against the cap/ },
];

const PARALLEL_CAP_CLAUSES: readonly Clause[] = [
  { name: PARALLEL_CLAUSE, pattern: /loop apply → verify under step 3's two-round cap, ladder and empty-result route/ },
];

const UNATTENDED_CAP_CLAUSES: readonly Clause[] = [
  { name: "the ROADMAP list maps the fix-round cap", pattern: /\*\*§6 step 3, the fix-round cap\*\*/ },
  { name: "the policy picks the strong tier and the re-slice", pattern: /the fix-round cap\*\*[^\n]*policy picks[^\n]*re-slice/ },
];

const readFromTree: ReadFile = (file) => flowBody(readTrackedText(file).text);

function missingClauses(read: ReadFile, file: string, clauses: readonly Clause[]): string[] {
  const body = read(file);
  return clauses.filter(({ pattern }) => !pattern.test(body)).map(({ name }) => name);
}

describe("every fix loop carries the cap, the ladder and the outcome route", () => {
  for (const file of PLAN_FILES) {
    test(`${file} states the cap clauses and never loops until it passes`, () => {
      assert.deepEqual(missingClauses(readFromTree, file, PLAN_CAP_CLAUSES), []);
      assert.doesNotMatch(readFromTree(file), RETIRED_LOOP);
    });
  }

  test(`${PARALLEL_FILE} holds the wave's red slice under the same cap`, () => {
    assert.deepEqual(missingClauses(readFromTree, PARALLEL_FILE, PARALLEL_CAP_CLAUSES), []);
    assert.doesNotMatch(readFromTree(PARALLEL_FILE), RETIRED_LOOP);
  });

  test(`${UNATTENDED_FILE} maps the ladder under AUTO and a ROADMAP`, () => {
    assert.deepEqual(missingClauses(readFromTree, UNATTENDED_FILE, UNATTENDED_CAP_CLAUSES), []);
  });
});

describe("the checker reports a planted regression", () => {
  test("a plan that loops until it passes is reported", () => {
    const planted = `${readFromTree(PLAN_SOURCE)}\nLoop apply → verify until it passes.\n`;
    assert.match(planted, RETIRED_LOOP);
  });

  test("a plan that drops the empty-result route is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("counts against the cap", "is free");
    assert.ok(missingClauses(mutated, PLAN_SOURCE, PLAN_CAP_CLAUSES).includes(EMPTY_RESULT_CLAUSE));
  });

  test("a parallel file that drops the cap reference is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("two-round cap", "loop");
    assert.deepEqual(missingClauses(mutated, PARALLEL_FILE, PARALLEL_CAP_CLAUSES), [PARALLEL_CLAUSE]);
  });
});
