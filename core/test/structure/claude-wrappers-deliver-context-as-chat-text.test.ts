import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { hostFileOf } from "../support/flow-reads.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;
type Clause = Readonly<{ name: string; pattern: RegExp }>;

const PLAN_WRAPPER = hostFileOf("plan");
const CLAUDE_WRAPPERS = [PLAN_WRAPPER, hostFileOf("roadmap")];
const PLAN_SOURCE = "plugin/skills/plan/SKILL.md";
const PLAN_FILES = [PLAN_SOURCE, "opencode/skills/oso-plan/SKILL.md"];

const RETIRED_FIELD_RULE = /travels INSIDE the `AskUserQuestion` fields|never as prose before the call/;
const RETIRED_FINDINGS_ROUTE = /`Doubt Pass: findings` go to the operator like §6 blocked questions/;

const CONTEXT_CLAUSE = "context ends the turn as chat text the operator replies to";
const DECISION_CLAUSE = "a question carries only a decision with short options, never its context";
const FINDINGS_AS_TEXT_CLAUSE = "doubt-pass findings reach the operator as text";

const WRAPPER_CLAUSES: readonly Clause[] = [
  { name: "the TUI drops text before a same-turn tool call", pattern: /drops assistant text that precedes a tool call in the same turn/ },
  {
    name: CONTEXT_CLAUSE,
    pattern: /intent[^.]*findings[^.]*reconciliations[^.]*recommendations[^.]*ENDS the turn as plain chat text, where the operator replies/,
  },
  { name: "the tool call comes in a later turn", pattern: /the tool call comes in a LATER turn/ },
  {
    name: DECISION_CLAUSE,
    pattern: /A question carries only a genuine enumerable decision, each option one or two lines, never its context/,
  },
];

const DOUBT_PASS_CLAUSES: readonly Clause[] = [
  { name: FINDINGS_AS_TEXT_CLAUSE, pattern: /`Doubt Pass: findings` reach the operator as text/ },
  { name: "only a decision the findings leave goes to a question round", pattern: /only a decision they leave goes to a question round/ },
];

const readWrapper: ReadFile = (file) => readTrackedText(file).text;
const readFlow: ReadFile = (file) => flowBody(readTrackedText(file).text);

function missingClauses(read: ReadFile, file: string, clauses: readonly Clause[]): string[] {
  const text = read(file);
  return clauses.filter(({ pattern }) => !pattern.test(text)).map(({ name }) => name);
}

describe("the plan and roadmap Claude wrappers deliver context as chat text and keep a question to its decision", () => {
  for (const file of CLAUDE_WRAPPERS) {
    test(`${file} states the delivery clauses and never routes context into the question fields`, () => {
      assert.deepEqual(missingClauses(readWrapper, file, WRAPPER_CLAUSES), []);
      assert.equal(RETIRED_FIELD_RULE.test(readWrapper(file)), false);
    });
  }
});

describe("the plan flow delivers doubt-pass findings as text and sends only a decision they leave to a round", () => {
  for (const file of PLAN_FILES) {
    test(`${file} states the doubt-pass clauses and never routes findings like §6 blocked questions`, () => {
      assert.deepEqual(missingClauses(readFlow, file, DOUBT_PASS_CLAUSES), []);
      assert.equal(RETIRED_FINDINGS_ROUTE.test(readFlow(file)), false);
    });
  }
});

describe("the checker reports a planted regression", () => {
  test("a wrapper that sends a round's context into the question fields is reported", () => {
    const planted: ReadFile = (file) =>
      `${readWrapper(file)}\nContext a question round needs travels INSIDE the \`AskUserQuestion\` fields, never as prose before the call.\n`;
    assert.equal(RETIRED_FIELD_RULE.test(planted(PLAN_WRAPPER)), true);
  });

  test("a wrapper that no longer ends the turn with the context as chat text is reported", () => {
    const mutated: ReadFile = (file) => readWrapper(file).replaceAll("plain chat text", "a question field");
    assert.ok(missingClauses(mutated, PLAN_WRAPPER, WRAPPER_CLAUSES).includes(CONTEXT_CLAUSE));
  });

  test("a wrapper whose question carries its context is reported", () => {
    const mutated: ReadFile = (file) => readWrapper(file).replaceAll("never its context", "with its context");
    assert.ok(missingClauses(mutated, PLAN_WRAPPER, WRAPPER_CLAUSES).includes(DECISION_CLAUSE));
  });

  test("a plan that routes doubt-pass findings like §6 blocked questions is reported", () => {
    const planted: ReadFile = (file) => `${readFlow(file)}\n\`Doubt Pass: findings\` go to the operator like §6 blocked questions.\n`;
    assert.equal(RETIRED_FINDINGS_ROUTE.test(planted(PLAN_SOURCE)), true);
  });

  test("a plan that sends the findings themselves to a question round is reported", () => {
    const mutated: ReadFile = (file) => readFlow(file).replaceAll("reach the operator as text", "go to a question round");
    assert.ok(missingClauses(mutated, PLAN_SOURCE, DOUBT_PASS_CLAUSES).includes(FINDINGS_AS_TEXT_CLAUSE));
  });
});
