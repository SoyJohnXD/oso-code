import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const PLAN_FLOW = "plugin/skills/plan/SKILL.md";
const PLAN_FLOW_ON_OPENCODE = "opencode/skills/oso-plan/SKILL.md";

const RETIRED_RULES: readonly RegExp[] = [
  /never write code/i,
  /never applied inline/i,
  /never inline/i,
  /relaunch the applier/i,
  /execution invariant/i,
];

const THRESHOLD_CLAUSES: readonly Readonly<{ name: string; pattern: RegExp }>[] = [
  { name: "one non-trivial file goes inline", pattern: /one non-trivial file[^.]*INLINE/ },
  { name: "a mechanical edit of any breadth goes inline", pattern: /mechanical edit of any breadth/ },
  { name: "two or more non-trivial files go to the applier", pattern: /[Tt]wo or more non-trivial files[^.]*applier agent/ },
  { name: "a cross-layer contract goes to the applier", pattern: /crosses a contract between layers/ },
  { name: "PARALLEL keeps one applier per worktree", pattern: /PARALLEL waves keep one applier per worktree/ },
  { name: "the milestone names the route taken and why", pattern: /names the route taken and why/ },
];

const EVERY_SLICE_VERIFIED = /[Ee]very slice goes to a FRESH verifier[^.]*whoever wrote it/;
const REVERIFIED_BY_A_FRESH_VERIFIER = /every re-verification is a FRESH verifier/;

const CLOSE_FIXES_FOLLOW_THE_THRESHOLD = /Every fix this close writes follows §6's threshold/;

const flows = [
  { file: PLAN_FLOW, body: flowBody(readTrackedText(PLAN_FLOW).text) },
  { file: PLAN_FLOW_ON_OPENCODE, body: flowBody(readTrackedText(PLAN_FLOW_ON_OPENCODE).text) },
];

describe("the plan flow routes a slice by its size and verifies every slice independently", () => {
  for (const { file, body } of flows) {
    test(`${file} no longer says the orchestrator never writes code or that small fixes are never applied inline`, () => {
      const still = RETIRED_RULES.filter((rule) => rule.test(body)).map(String);
      assert.deepEqual(still, [], `${file} still carries ${still.join(", ")}`);
    });

    test(`${file} names the threshold in every clause`, () => {
      const missing = THRESHOLD_CLAUSES.filter(({ pattern }) => !pattern.test(body)).map(({ name }) => name);
      assert.deepEqual(missing, [], `${file} never states: ${missing.join("; ")}`);
    });

    test(`${file} sends every slice to a fresh verifier whoever wrote it, and every re-verification to another fresh one`, () => {
      assert.match(body, EVERY_SLICE_VERIFIED);
      assert.match(body, REVERIFIED_BY_A_FRESH_VERIFIER);
    });

    test(`${file} writes every close-phase fix by the threshold`, () => {
      assert.match(body, CLOSE_FIXES_FOLLOW_THE_THRESHOLD);
    });
  }
});

const DEBUG_FLOW = "plugin/skills/debug/SKILL.md";
const DEBUG_FLOW_ON_OPENCODE = "opencode/skills/oso-debug/SKILL.md";
const FRONT_SURFACE = "plugin/skills/_shared/front-surface.md";

const DEBUG_RETIRED_RULES: readonly RegExp[] = [/never write it inline/i, /never inline/i, /relaunch the applier/i];

const DEBUG_THRESHOLD_CLAUSES: readonly Readonly<{ name: string; pattern: RegExp }>[] = [
  ...THRESHOLD_CLAUSES.filter(({ name }) => !name.startsWith("PARALLEL")),
  { name: "the close's fixes follow §4's threshold", pattern: /Every fix this close writes follows §4's threshold/ },
];

const debugFlows = [
  { file: DEBUG_FLOW, body: flowBody(readTrackedText(DEBUG_FLOW).text) },
  { file: DEBUG_FLOW_ON_OPENCODE, body: flowBody(readTrackedText(DEBUG_FLOW_ON_OPENCODE).text) },
];

describe("the debug flow and the design-audit fix route follow the same threshold", () => {
  for (const { file, body } of debugFlows) {
    test(`${file} no longer hardwires the applier or forbids an inline fix`, () => {
      const still = DEBUG_RETIRED_RULES.filter((rule) => rule.test(body)).map(String);
      assert.deepEqual(still, [], `${file} still carries ${still.join(", ")}`);
    });

    test(`${file} names the threshold in every clause`, () => {
      const missing = DEBUG_THRESHOLD_CLAUSES.filter(({ pattern }) => !pattern.test(body)).map(({ name }) => name);
      assert.deepEqual(missing, [], `${file} never states: ${missing.join("; ")}`);
    });

    test(`${file} sends every fix to a fresh verifier whoever wrote it, and every re-verification to another fresh one`, () => {
      assert.match(body, /[Ee]very fix goes to a FRESH verifier[^.]*whoever wrote it/);
      assert.match(body, REVERIFIED_BY_A_FRESH_VERIFIER);
    });
  }

  test(`${FRONT_SURFACE} routes the design-audit fix by the threshold and never fixes it inline by rule`, () => {
    const body = flowBody(readTrackedText(FRONT_SURFACE).text);
    assert.doesNotMatch(body, /never fixed inline/);
    assert.match(body, /Fix route[^\n]*follow the threshold/);
  });
});
