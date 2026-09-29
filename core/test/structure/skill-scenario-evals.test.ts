import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

type Anchor = Readonly<{ file: string; pattern: string }>;
type ExpectedBehavior = Readonly<{ behavior: string; anchors: readonly Anchor[] }>;
type ScenarioEval = Readonly<{ skills: readonly string[]; query: string; expected_behavior: readonly ExpectedBehavior[] }>;
type ReadFile = (file: string) => string;

const FIXTURE_DIRECTORY = "core/test/fixtures/skill-evals/";
const MINIMUM_SCENARIOS = 4;
const MINIMUM_ANCHORS = 60;

function filesLoadedBy(flow: string): RegExp[] {
  return [
    new RegExp(`^plugin/skills/${flow}/SKILL\\.md$`),
    new RegExp(`^plugin/skills/${flow}/references/claude\\.md$`),
    /^plugin\/skills\/_shared\/[^/]+\.md$/,
    /^plugin\/skills\/_shared\/references\/claude\.md$/,
  ];
}

function unresolvedAnchors(scenario: ScenarioEval, readFile: ReadFile): string[] {
  const flow = scenario.skills.join("");
  const loaded = filesLoadedBy(flow);
  return scenario.expected_behavior.flatMap(({ behavior, anchors }) =>
    anchors.flatMap(({ file, pattern }) => {
      if (!loaded.some((allowed) => allowed.test(file))) return [`${behavior}: ${file} is not loaded by ${flow}`];
      return new RegExp(pattern).test(readFile(file)) ? [] : [`${behavior}: /${pattern}/ absent from ${file}`];
    }),
  );
}

function anchorCount(scenario: ScenarioEval): number {
  return scenario.expected_behavior.reduce((total, { anchors }) => total + anchors.length, 0);
}

const readFromTree: ReadFile = (file) => readTrackedText(file).text;

const scenarios: readonly (readonly [string, ScenarioEval])[] = trackedRepositoryFiles()
  .filter((file) => file.startsWith(FIXTURE_DIRECTORY) && file.endsWith(".json"))
  .map((file) => [file, JSON.parse(readTrackedText(file).text) as ScenarioEval]);

describe("every scenario eval's expected behavior is still instructed by the prose its flow loads", () => {
  for (const [file, scenario] of scenarios) {
    test(`${file} resolves every anchor`, () => {
      assert.equal(scenario.skills.length, 1, `${file} names exactly one flow`);
      assert.ok(scenario.query.length > 0, `${file} carries a query`);
      assert.ok(scenario.expected_behavior.length > 0, `${file} expects at least one behavior`);
      assert.deepEqual(unresolvedAnchors(scenario, readFromTree), []);
    });
  }
});

describe("the checker reports a planted regression", () => {
  const plan: ScenarioEval = {
    skills: ["plan"],
    query: "plan a change",
    expected_behavior: [{ behavior: "iterates the intent", anchors: [{ file: "plugin/skills/plan/SKILL.md", pattern: "## 1\\. Intent" }] }],
  };

  test("an anchor phrase deleted from its file is reported", () => {
    assert.deepEqual(unresolvedAnchors(plan, readFromTree), []);
    const mutated: ReadFile = (file) => readFromTree(file).replace(/## 1\. Intent/g, "");
    assert.deepEqual(unresolvedAnchors(plan, mutated), ["iterates the intent: /## 1\\. Intent/ absent from plugin/skills/plan/SKILL.md"]);
  });

  test("an anchor pointing at a file the flow never loads is reported", () => {
    const foreign: ScenarioEval = {
      ...plan,
      expected_behavior: [{ behavior: "reads a sibling flow", anchors: [{ file: "plugin/skills/debug/SKILL.md", pattern: "Reproduce" }] }],
    };
    assert.deepEqual(unresolvedAnchors(foreign, readFromTree), ["reads a sibling flow: plugin/skills/debug/SKILL.md is not loaded by plan"]);
  });
});

provedSomething(
  `at least ${MINIMUM_SCENARIOS} scenario evals and ${MINIMUM_ANCHORS} anchors were checked`,
  scenarios.length >= MINIMUM_SCENARIOS && scenarios.reduce((total, [, scenario]) => total + anchorCount(scenario), 0) >= MINIMUM_ANCHORS,
  `${scenarios.length} scenarios under ${FIXTURE_DIRECTORY}`,
);
