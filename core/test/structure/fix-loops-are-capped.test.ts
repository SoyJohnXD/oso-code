import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;
type Clause = Readonly<{ name: string; pattern: RegExp }>;

const PLAN_SOURCE = "plugin/skills/plan/SKILL.md";
const PLAN_FILES = [PLAN_SOURCE, "opencode/skills/oso-plan/SKILL.md"];
const DEBUG_SOURCE = "plugin/skills/debug/SKILL.md";
const DEBUG_FILES = [DEBUG_SOURCE, "opencode/skills/oso-debug/SKILL.md"];
const REPORTING_FILE = "plugin/skills/_shared/reporting.md";
const PARALLEL_FILE = "plugin/skills/_shared/parallel.md";
const UNATTENDED_FILE = "plugin/skills/_shared/unattended.md";

const RETIRED_LOOP = /until it passes|strong-tier relaunch|relaunch of applier and verifier on the strong tier/i;
const EMPTY_RESULT_CLAUSE = "an empty or malformed result is marked and counts one round";
const PARALLEL_CLAUSE = "the red slice loop runs under step 3's cap";
const WAVE_ROUNDS_CLAUSE = "a wave's red slice counts its own rounds";

const DIAGNOSIS_CLAUSES: readonly Clause[] = [
  { name: "the diagnosis is automatic and never asks the operator", pattern: /never asking the operator[^.]*read-only diagnosis agent/ },
  { name: "the diagnosis names cause, evidence and a changed strategy", pattern: /diagnosis agent[^.]*`file:line`[^.]*changed strategy/ },
  { name: "the diagnosis is marked", pattern: /`oso-state mark diagnosed`/ },
  { name: "two more rounds follow the diagnosis", pattern: /TWO more fix rounds[^.]*since diagnosis/ },
  { name: "the escalation is marked in the verdict record", pattern: /`oso-state mark escalated`/ },
];

const PLAN_CAP_CLAUSES: readonly Clause[] = [
  { name: "two fix rounds at most", pattern: /at most TWO fix rounds/ },
  { name: "the round is read from the report's active slice row", pattern: /`oso-state report`'s `active slice` row/ },
  ...DIAGNOSIS_CLAUSES,
  { name: "the three routes", pattern: /grant more rounds[^.]*its own slice[^.]*accept the residual/ },
  { name: "only an all-nit remainder is accepted", pattern: /only a remainder of `nit` findings[^.]*never a `blocker` or `structural`/ },
  { name: "the escalation is marked and journaled", pattern: /`\[!\]`[^.]*journal/ },
  { name: EMPTY_RESULT_CLAUSE, pattern: /empty, cut or malformed[^.]*never a verdict[^.]*`oso-state mark empty-result`[^.]*counts one round/ },
];

const DEBUG_CAP_CLAUSES: readonly Clause[] = [
  { name: "two fix rounds at most", pattern: /at most TWO fix rounds/ },
  { name: "the round is read from the report's active slice row", pattern: /`oso-state report`'s `active slice` row/ },
  ...DIAGNOSIS_CLAUSES,
  { name: "the three routes", pattern: /grant more rounds[^.]*its own apply\/verify pass[^.]*accept the residual/ },
  { name: "only an all-nit remainder is accepted", pattern: /only a remainder of `nit` findings[^.]*never a `blocker` or `structural`/ },
  { name: "the escalation is journaled and summarised", pattern: /escalated[^.]*journal[^.]*session summary/ },
  { name: EMPTY_RESULT_CLAUSE, pattern: /empty, cut or malformed[^.]*never a verdict[^.]*`oso-state mark empty-result`[^.]*counts one round/ },
];

const REPORTING_CAP_CLAUSES: readonly Clause[] = [
  { name: "the Closing names an escalated slice or fix", pattern: /\*\*Closing\*\*[^\n]*escalated slice or fix/ },
];

const PARALLEL_CAP_CLAUSES: readonly Clause[] = [
  { name: PARALLEL_CLAUSE, pattern: /loop apply → verify under step 3's two-round cap, diagnosis, routes and empty-result rule/ },
  { name: WAVE_ROUNDS_CLAUSE, pattern: /`active slice` row counts the whole wave, so each red slice counts its own rounds/ },
];

const UNATTENDED_CAP_CLAUSES: readonly Clause[] = [
  { name: "the ROADMAP list maps the fix-round cap", pattern: /\*\*§6 step 3, the fix-round cap\*\*/ },
  { name: "the policy takes the re-slice and the diagnosis is automatic", pattern: /the fix-round cap\*\*[^\n]*automatic[^\n]*policy takes the re-slice/ },
];

const readFromTree: ReadFile = (file) => flowBody(readTrackedText(file).text);

const retiredLoopIn = (read: ReadFile, file: string) => RETIRED_LOOP.test(read(file));

function missingClauses(read: ReadFile, file: string, clauses: readonly Clause[]): string[] {
  const body = read(file);
  return clauses.filter(({ pattern }) => !pattern.test(body)).map(({ name }) => name);
}

describe("every fix loop carries the cap, the ladder and the outcome route", () => {
  for (const file of PLAN_FILES) {
    test(`${file} states the cap clauses and never loops until it passes or relaunches on the strong tier`, () => {
      assert.deepEqual(missingClauses(readFromTree, file, PLAN_CAP_CLAUSES), []);
      assert.equal(retiredLoopIn(readFromTree, file), false);
    });
  }

  for (const file of DEBUG_FILES) {
    test(`${file} states the cap clauses and never loops until it passes or relaunches on the strong tier`, () => {
      assert.deepEqual(missingClauses(readFromTree, file, DEBUG_CAP_CLAUSES), []);
      assert.equal(retiredLoopIn(readFromTree, file), false);
    });
  }

  test(`${REPORTING_FILE} names an escalated slice at the close`, () => {
    assert.deepEqual(missingClauses(readFromTree, REPORTING_FILE, REPORTING_CAP_CLAUSES), []);
  });

  test(`${PARALLEL_FILE} holds the wave's red slice under the same cap`, () => {
    assert.deepEqual(missingClauses(readFromTree, PARALLEL_FILE, PARALLEL_CAP_CLAUSES), []);
    assert.equal(retiredLoopIn(readFromTree, PARALLEL_FILE), false);
  });

  test(`${UNATTENDED_FILE} maps the ladder under AUTO and a ROADMAP`, () => {
    assert.deepEqual(missingClauses(readFromTree, UNATTENDED_FILE, UNATTENDED_CAP_CLAUSES), []);
  });
});

describe("the checker reports a planted regression", () => {
  test("a plan that loops until it passes is reported", () => {
    const planted: ReadFile = (file) => `${readFromTree(file)}\nLoop apply → verify until it passes.\n`;
    assert.equal(retiredLoopIn(planted, PLAN_SOURCE), true);
  });

  test("a plan that keeps the strong-tier relaunch rung is reported", () => {
    const planted: ReadFile = (file) => `${readFromTree(file)}\nAt the cap: ONE relaunch of applier and verifier on the strong tier.\n`;
    assert.equal(retiredLoopIn(planted, PLAN_SOURCE), true);
  });

  test("an unattended file that keeps the strong-tier relaunch is reported", () => {
    const planted: ReadFile = (file) => `${readFromTree(file)}\nthe policy picks the strong-tier relaunch.\n`;
    assert.equal(retiredLoopIn(planted, UNATTENDED_FILE), true);
  });

  test("a plan that drops the diagnosis mark is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("`oso-state mark diagnosed`", "a note");
    assert.ok(missingClauses(mutated, PLAN_SOURCE, PLAN_CAP_CLAUSES).includes("the diagnosis is marked"));
  });

  test("a debug flow that drops the escalation mark is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("`oso-state mark escalated`", "a note");
    assert.ok(missingClauses(mutated, DEBUG_SOURCE, DEBUG_CAP_CLAUSES).includes("the escalation is marked in the verdict record"));
  });

  test("a parallel file that drops the wave round sentence is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("counts the whole wave", "counts one slice");
    assert.deepEqual(missingClauses(mutated, PARALLEL_FILE, PARALLEL_CAP_CLAUSES), [WAVE_ROUNDS_CLAUSE]);
  });

  test("a plan that drops the empty-result route is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("counts one round", "is free");
    assert.ok(missingClauses(mutated, PLAN_SOURCE, PLAN_CAP_CLAUSES).includes(EMPTY_RESULT_CLAUSE));
  });

  test("a debug flow that drops the empty-result route is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("counts one round", "is free");
    assert.ok(missingClauses(mutated, DEBUG_SOURCE, DEBUG_CAP_CLAUSES).includes(EMPTY_RESULT_CLAUSE));
  });

  test("a reporting file that drops the escalation is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("escalated", "closed");
    assert.equal(missingClauses(mutated, REPORTING_FILE, REPORTING_CAP_CLAUSES).length, 1);
  });

  test("a parallel file that drops the cap reference is reported", () => {
    const mutated: ReadFile = (file) => readFromTree(file).replaceAll("two-round cap", "loop");
    assert.ok(missingClauses(mutated, PARALLEL_FILE, PARALLEL_CAP_CLAUSES).includes(PARALLEL_CLAUSE));
  });
});
