import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_STUBS } from "../../src/prose/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;

const OPERATOR_TERM = /\bthe (user|human)\b/i;
const JUDGE_TERM = /(?<![\w-])reviewer\b/i;
const FLOW_MARKDOWN = /^plugin\/skills\/.+\.md$/;
const RUBRIC = "plugin/skills/_shared/rubric.md";
const RENDERED_SKILL = /^opencode\/skills\/[^/]+\/SKILL\.md$/;
const FORK_FRONTMATTER = /^context: fork$/m;
const FLOW_SKILL = /^plugin\/skills\/([^/]+)\/SKILL\.md$/;

function offendingLines(pattern: RegExp, text: string): string[] {
  return text.split("\n").flatMap((line, index) => (pattern.test(line) ? [`line ${index + 1}: ${line.trim().slice(0, 80)}`] : []));
}

function violations(pattern: RegExp, files: readonly string[], read: ReadFile): string[] {
  return files.flatMap((file) => offendingLines(pattern, read(file)).map((line) => `${file} ${line}`));
}

const tracked = trackedRepositoryFiles();
const proseFiles = tracked.filter((file) => FLOW_MARKDOWN.test(file) && file !== RUBRIC);
const renderedSkills = tracked.filter((file) => RENDERED_SKILL.test(file));
const forkContextSkills = tracked.flatMap((file) => {
  const skill = FLOW_SKILL.exec(file)?.[1];
  return skill && FORK_FRONTMATTER.test(readTrackedText(file).text) ? [skill] : [];
});
const forkContextFiles = tracked.filter((file) =>
  forkContextSkills.some((skill) => file.startsWith(`plugin/skills/${skill}/`) || file.startsWith(`core/src/prose/skills/${skill}/`)),
).filter((file) => file.endsWith(".md"));
const stubDescriptions = SKILL_STUBS.flatMap(({ id, description }) => Object.values(description).map((text) => `${id}: ${text}`));
const readFromTree: ReadFile = (file) => readTrackedText(file).text;

provedSomething(
  "the terminology guard reads flow prose, rendered skills, stub descriptions and the fork-context skills",
  proseFiles.length > 20 && renderedSkills.length > 0 && stubDescriptions.length > 0 && forkContextSkills.length === 4 && forkContextFiles.length > 8,
  `measured only: ${proseFiles.length} prose files, ${renderedSkills.length} rendered skills, ${stubDescriptions.length} stub descriptions, ${forkContextFiles.length} fork-context files`,
);

describe("the person is the operator everywhere skill prose names them", () => {
  test("no flow or judge prose says the user or the human", () => {
    assert.deepEqual(violations(OPERATOR_TERM, proseFiles, readFromTree), []);
  });

  test("no rendered OpenCode skill says the user or the human", () => {
    assert.deepEqual(violations(OPERATOR_TERM, renderedSkills, readFromTree), []);
  });

  test("no skill stub description says the user or the human", () => {
    assert.deepEqual(stubDescriptions.filter((text) => OPERATOR_TERM.test(text)), []);
  });
});

describe("the fork-context skills call themselves the judge", () => {
  test("no fork-context skill says reviewer", () => {
    assert.deepEqual(violations(JUDGE_TERM, forkContextFiles, readFromTree), []);
  });
});

describe("the checker reports a planted regression", () => {
  test("a line saying the user is reported", () => {
    const mutated: ReadFile = () => "Ask the operator.\nLet the User decide.";
    assert.equal(violations(OPERATOR_TERM, ["planted.md"], mutated).length, 1);
  });

  test("user-facing compounds and the operator pass", () => {
    assert.deepEqual(violations(OPERATOR_TERM, ["planted.md"], () => "A user-facing screen. The operator decides."), []);
  });

  test("a line saying reviewer is reported and review passes", () => {
    const mutated: ReadFile = () => "A security review.\nThe native reviewer runs.";
    assert.equal(violations(JUDGE_TERM, ["planted.md"], mutated).length, 1);
  });

  test("an agent identifier holding reviewer passes", () => {
    assert.deepEqual(violations(JUDGE_TERM, ["planted.md"], () => "Run as the `oso-security-reviewer` agent."), []);
  });
});
