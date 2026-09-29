import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowBody } from "../../src/prose/render.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const THRESHOLD_DEFINITION = "plugin/skills/_shared/reporting.md";
const FRONT_SURFACE = "plugin/skills/_shared/front-surface.md";

const MECHANICAL_EDIT_CLAUSE = /mechanical edit of any breadth/;

const THRESHOLD_CLAUSES: readonly Readonly<{ name: string; pattern: RegExp }>[] = [
  { name: "one non-trivial file goes inline", pattern: /one non-trivial file[^.]*INLINE/ },
  { name: "a mechanical edit of any breadth goes inline", pattern: MECHANICAL_EDIT_CLAUSE },
  { name: "two or more non-trivial files go to the applier", pattern: /[Tt]wo or more non-trivial files[^.]*applier agent/ },
  { name: "a cross-layer contract goes to the applier", pattern: /crosses a contract between layers/ },
  { name: "the Arming milestone names the route taken and why", pattern: /\*\*Arming\*\*[^\n]*names its route[^\n]*and why/ },
  { name: "inline work follows the applier agent file's rules", pattern: /follow the applier agent file's rules/ },
];

const CITES_THE_DEFINITION = /threshold defined at `_shared\/reporting\.md`/;
const REVERIFIED_BY_A_FRESH_VERIFIER = /every re-verification is a FRESH verifier/;

const FLOW_ROWS = [
  {
    flow: "plan",
    files: ["plugin/skills/plan/SKILL.md", "opencode/skills/oso-plan/SKILL.md"],
    retired: [/never write code/i, /never applied inline/i, /never inline/i, /relaunch the applier/i, /execution invariant/i],
    extraClauses: [
      { name: "PARALLEL keeps one applier per worktree", pattern: /PARALLEL waves keep one applier per worktree/ },
      { name: "the close's fixes follow §6's threshold", pattern: /Conformance findings\*\*[^\n]*fix by §6's threshold/ },
      { name: "the apply step is the threshold's applier side", pattern: /\*\*Apply\*\* — over the threshold, launch the `oso-applier` agent/ },
      { name: "a blocked applier is answered and the slice completed by the threshold", pattern: /the threshold completes the slice — inline under it, else a FRESH applier/ },
      { name: "debt findings go to the applier over the threshold", pattern: /Debt findings\*\* → over the threshold, launch the `oso-applier` agent/ },
    ],
    verifiedPattern: /[Ee]very slice goes to a FRESH verifier[^.]*whoever wrote it/,
  },
  {
    flow: "debug",
    files: ["plugin/skills/debug/SKILL.md", "opencode/skills/oso-debug/SKILL.md"],
    retired: [/never write it inline/i, /never inline/i, /relaunch the applier/i],
    extraClauses: [
      { name: "the close's fixes follow §4's threshold", pattern: /Debt Sweep: findings`[^\n]*fixed by §4's threshold/ },
    ],
    verifiedPattern: /[Ee]very fix goes to a FRESH verifier[^.]*whoever wrote it/,
  },
] as const;

describe("the threshold is defined once", () => {
  const definition = flowBody(readTrackedText(THRESHOLD_DEFINITION).text);

  test(`${THRESHOLD_DEFINITION} states every clause of the threshold`, () => {
    const missing = THRESHOLD_CLAUSES.filter(({ pattern }) => !pattern.test(definition)).map(({ name }) => name);
    assert.deepEqual(missing, [], `${THRESHOLD_DEFINITION} never states: ${missing.join("; ")}`);
  });

  for (const { flow, files } of FLOW_ROWS) {
    for (const file of files) {
      test(`${file} cites the definition and never restates it`, () => {
        const body = flowBody(readTrackedText(file).text);
        assert.match(body, CITES_THE_DEFINITION, `${flow} flow ${file} never cites the threshold`);
        assert.doesNotMatch(body, MECHANICAL_EDIT_CLAUSE, `${file} restates the threshold`);
      });
    }
  }

  test(`${FRONT_SURFACE} cites the definition and never restates it`, () => {
    const body = flowBody(readTrackedText(FRONT_SURFACE).text);
    assert.match(body, CITES_THE_DEFINITION);
    assert.doesNotMatch(body, MECHANICAL_EDIT_CLAUSE);
  });
});

for (const { flow, files, retired, extraClauses, verifiedPattern } of FLOW_ROWS) {
  describe(`the ${flow} flow routes work by its size and verifies independently`, () => {
    for (const file of files) {
      const body = flowBody(readTrackedText(file).text);

      test(`${file} carries no retired hardwired-applier rule`, () => {
        const still = retired.filter((rule) => rule.test(body)).map(String);
        assert.deepEqual(still, [], `${file} still carries ${still.join(", ")}`);
      });

      test(`${file} names its own clauses of the threshold`, () => {
        const missing = extraClauses.filter(({ pattern }) => !pattern.test(body)).map(({ name }) => name);
        assert.deepEqual(missing, [], `${file} never states: ${missing.join("; ")}`);
      });

      test(`${file} sends every unit to a fresh verifier whoever wrote it, and every re-verification to another fresh one`, () => {
        assert.match(body, verifiedPattern);
        assert.match(body, REVERIFIED_BY_A_FRESH_VERIFIER);
      });
    }
  });
}

describe("the design-audit fix route", () => {
  const body = flowBody(readTrackedText(FRONT_SURFACE).text);

  test("follows the threshold under PLAN and never fixes inline by rule", () => {
    assert.doesNotMatch(body, /never fixed inline/);
    assert.doesNotMatch(body, /under PLAN and DEBUG/);
    assert.match(body, /Fix route[^\n]*under PLAN, findings[^\n]*follow the threshold/);
  });

  test("keeps QUICK's findings on the applier agent, since QUICK defines no threshold", () => {
    assert.match(body, /Fix route[^\n]*under QUICK[^\n]*always go to the `oso-applier` agent/);
  });

  test("ties the model-profile sentence to the applier route", () => {
    assert.match(body, /An applier fix runs on the model the profile names/);
  });
});

describe("the close's applier fixes read as the threshold's applier side", () => {
  for (const file of FLOW_ROWS.flatMap(({ files }) => files)) {
    test(`${file} ties the model-profile sentence to the applier route`, () => {
      const body = flowBody(readTrackedText(file).text);
      assert.doesNotMatch(body, /That fix runs on the model the profile names/);
      assert.match(body, /[Aa]n applier fix runs on the model the profile names/);
    });

    test(`${file} states the close's threshold once per bullet, never as a preamble`, () => {
      const body = flowBody(readTrackedText(file).text);
      assert.doesNotMatch(body, /Every fix this close writes follows/);
    });
  }
});

describe("the front-surface coach payload reaches inline authors", () => {
  const row = flowBody(readTrackedText(FRONT_SURFACE).text)
    .split("\n")
    .find((line) => line.startsWith("| Coach payload"));
  const [, , plan, , debug] = (row ?? "").split("|");

  test("PLAN's cell has the orchestrator READ the design docs and Impeccable paths itself when writing inline", () => {
    assert.match(plan ?? "", /inline[^|]*READS them itself/);
  });

  test("DEBUG's cell has the orchestrator READ the design docs and Impeccable paths itself when writing inline", () => {
    assert.match(debug ?? "", /inline[^|]*READS them itself/);
  });
});

describe("no flow step hardwires the applier where either route can run", () => {
  const HARDWIRED = [
    /Applier `blocked` →/,
    /then delegates the fix/,
    /FIX \(the relaunch above\)/,
    /rides that same relaunch/,
    /Both delegations below/,
    /before delegating/,
    /instead of delegating/,
  ];

  for (const file of FLOW_ROWS.flatMap(({ files }) => files)) {
    test(`${file} carries no applier-only wording at a shared step`, () => {
      const { text } = readTrackedText(file);
      const still = HARDWIRED.filter((rule) => rule.test(text)).map(String);
      assert.deepEqual(still, [], `${file} still carries ${still.join(", ")}`);
    });
  }
});
