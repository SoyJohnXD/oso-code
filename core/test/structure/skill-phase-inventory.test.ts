import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type Entry = readonly [number, string];
type SkillText = (flow: string) => string;

const PHASES: readonly (readonly [string, readonly Entry[]])[] = [
  ["quick", [[1, "micro-intent"], [2, "substantiality"], [3, "iterate"], [4, "close"]]],
  ["plan", [[0, "resume"], [1, "intent"], [2, "surface mapping"], [3, "decision rounds"], [4, "slicing"], [5, "repaso"], [6, "execution"], [7, "close"]]],
  ["debug", [[0, "resume"], [1, "reproduce"], [2, "localize"], [3, "diagnosis freeze"], [4, "fix"], [5, "close"]]],
  ["roadmap", [[1, "queue"], [2, "autonomy policy"], [3, "approval"], [4, "chain"], [5, "presence phase"]]],
];

const PLAN_STEPS: readonly (readonly [number, readonly Entry[]])[] = [
  [6, [[1, "activate"], [2, "apply"], [3, "verify"], [4, "verifier's `pass`"]]],
  [7, [[1, "activate the sweep"], [2, "judge"], [3, "fix"], [4, "design audit"], [5, "index"], [6, "summary"], [7, "green, last"], [8, "commit"], [9, "close the state"]]],
];

const readSkill: SkillText = (flow) => readTrackedText(`plugin/skills/${flow}/SKILL.md`).text;

function missingInOrder(expected: readonly Entry[], found: readonly Entry[], texts: readonly string[]): string[] {
  const missing: string[] = [];
  let cursor = 0;
  for (const [number, key] of expected) {
    const at = found.findIndex(([n], index) => index >= cursor && n === number && (texts[index] ?? "").toLowerCase().includes(key));
    if (at < 0) missing.push(`${number}. ${key}`);
    else cursor = at + 1;
  }
  return missing;
}

function missingPhases(flow: string, expected: readonly Entry[], read: SkillText): string[] {
  const headings = [...read(flow).matchAll(/^## (\d+)\. (.*)$/gm)];
  const found = headings.map(([, n]): Entry => [Number(n), ""]);
  return missingInOrder(expected, found, headings.map(([, , title]) => title ?? ""));
}

function missingSteps(section: number, expected: readonly Entry[], read: SkillText): string[] {
  const body = read("plan");
  const rest = body.slice(body.search(new RegExp(`^## ${section}\\. `, "m")) + 1);
  const end = rest.search(/^## /m);
  const steps = [...rest.slice(0, end < 0 ? undefined : end).matchAll(/^(\d+)\. (.*)$/gm)];
  return missingInOrder(expected, steps.map(([, n]): Entry => [Number(n), ""]), steps.map(([, , text]) => text ?? ""));
}

describe("every flow keeps its phases in order", () => {
  for (const [flow, expected] of PHASES) {
    test(`${flow} keeps ${expected.length} numbered phases`, () => {
      assert.deepEqual(missingPhases(flow, expected, readSkill), []);
    });
  }
});

describe("plan keeps its numbered execution and close steps in order", () => {
  for (const [section, expected] of PLAN_STEPS) {
    test(`plan section ${section} keeps steps 1 to ${expected.length}`, () => {
      assert.deepEqual(missingSteps(section, expected, readSkill), []);
    });
  }
});

describe("the checker reports a planted regression", () => {
  const planPhases: readonly Entry[] = [[3, "decision rounds"], [4, "slicing"], [5, "repaso"]];
  const debugPhases: readonly Entry[] = [[2, "localize"], [3, "diagnosis freeze"]];
  const closeSteps: readonly Entry[] = [[6, "summary"], [7, "green, last"]];

  test("a phase heading removed is reported", () => {
    const mutated: SkillText = (flow) => readSkill(flow).replace(/^## 4\. Slicing.*$/m, "");
    assert.deepEqual(missingPhases("plan", planPhases, mutated), ["4. slicing"]);
  });

  test("phases out of order are reported", () => {
    const swapped: SkillText = (flow) => readSkill(flow).replace(/^## 2\. (.*)$/m, "## 9. $1").replace(/^## 3\. /m, "## 2. ");
    assert.notDeepEqual(missingPhases("debug", debugPhases, swapped), []);
  });

  test("a numbered step removed from a section is reported", () => {
    const mutated: SkillText = (flow) => readSkill(flow).replace(/^7\. \*\*Green, last\*\*.*$/m, "");
    assert.deepEqual(missingSteps(7, closeSteps, mutated), ["7. green, last"]);
  });
});

provedSomething(
  "the inventory covers four flows and every plan step",
  PHASES.length === 4 && PLAN_STEPS.reduce((total, [, steps]) => total + steps.length, 0) === 13,
  "the phase or step inventory shrank",
);
