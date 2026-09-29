import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_STUBS } from "../../src/prose/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const MAX_BODY_LINES = 500;
const TOC_THRESHOLD_LINES = 100;
const TOC_WINDOW_LINES = 20;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MINIMUM_SKILLS = 9;
const MINIMUM_REFERENCE_FILES = 10;

const SKILL_FILE = /^plugin\/skills\/[^/]+\/SKILL\.md$/;
const REFERENCE_FILE = /^plugin\/skills\/(_shared|[^/]+\/references)\/.*\.md$/;
const XML_TAG = /<\/?[a-zA-Z][^>]*>/;
const PERSON_PATTERNS = [/\bI (can|will)\b/, /\byou can\b/i, /\bI'm\b/];

type Skill = Readonly<{ name: string; description: string; bodyLines: number }>;

function parseSkill(text: string): Skill {
  const [, frontmatter = "", body = ""] = text.split(/^---$/m);
  const field = (key: string): string =>
    (frontmatter.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1] ?? "").replace(/^"(.*)"$/, "$1");
  return { name: field("name"), description: field("description"), bodyLines: body.replace(/^\n/, "").trimEnd().split("\n").length };
}

function descriptionProblems(description: string): string[] {
  const problems: string[] = [];
  if (description === "") problems.push("is empty");
  if (description.length > MAX_DESCRIPTION_LENGTH) problems.push(`is ${description.length} chars`);
  if (XML_TAG.test(description)) problems.push("contains an XML tag");
  if (PERSON_PATTERNS.some((pattern) => pattern.test(description))) problems.push("uses first or second person");
  return problems;
}

function skillProblems({ name, description, bodyLines }: Skill): string[] {
  const problems = descriptionProblems(description).map((problem) => `description ${problem}`);
  if (bodyLines > MAX_BODY_LINES) problems.push(`body is ${bodyLines} lines`);
  if (name.length > MAX_NAME_LENGTH || !/^[a-z0-9-]+$/.test(name)) problems.push(`name "${name}" breaks the length or charset rule`);
  if (/anthropic|claude/.test(name)) problems.push(`name "${name}" holds a reserved word`);
  return problems;
}

function opensWithTableOfContents(text: string): boolean {
  const opening = text.split("\n").slice(0, TOC_WINDOW_LINES).join("\n");
  return /^#{1,3} (table of )?contents\b/im.test(opening) || (opening.match(/^\s*[-*] \[[^\]]+\]\(#[^)]+\)/gm) ?? []).length >= 3;
}

function tocProblems(text: string): string[] {
  return text.split("\n").length > TOC_THRESHOLD_LINES && !opensWithTableOfContents(text) ? ["opens without a table of contents"] : [];
}

const files = trackedRepositoryFiles();
const skills = files.filter((file) => SKILL_FILE.test(file)).map((file) => [file, parseSkill(readTrackedText(file).text)] as const);
const references = files.filter((file) => REFERENCE_FILE.test(file)).map((file) => [file, readTrackedText(file).text] as const);
const stubs = SKILL_STUBS.flatMap(({ id, description }) => Object.entries(description).map(([host, text]) => [`${id} (${host})`, text] as const));

describe("every SKILL.md follows the authoring best practices", () => {
  for (const [file, skill] of skills) {
    test(`${file} stays inside the body, name and description limits`, () => {
      assert.deepEqual(skillProblems(skill), []);
    });
  }
});

describe("every long reference opens with a table of contents", () => {
  for (const [file, text] of references) {
    test(`${file} is short enough or opens with one`, () => {
      assert.deepEqual(tocProblems(text), []);
    });
  }
});

describe("every generated skill stub description follows the description rules", () => {
  for (const [label, description] of stubs) {
    test(`${label} description is well formed`, () => {
      assert.deepEqual(descriptionProblems(description), []);
    });
  }
});

describe("the checkers report a planted regression", () => {
  const sample: Skill = { name: "sample", description: "Plans a change.", bodyLines: 10 };
  const shortWith = (extra: Partial<Skill>): Skill => ({ ...sample, ...extra });

  test("a 501-line body is reported", () => {
    assert.deepEqual(skillProblems(shortWith({ bodyLines: MAX_BODY_LINES + 1 })), [`body is ${MAX_BODY_LINES + 1} lines`]);
  });

  test("a first-person description is reported", () => {
    assert.deepEqual(skillProblems(shortWith({ description: "I can help you plan." })), ["description uses first or second person"]);
  });

  test("an XML tag in a description is reported", () => {
    assert.deepEqual(descriptionProblems("Runs <b>fast</b>."), ["contains an XML tag"]);
  });

  test("a reserved word or a bad charset in a name is reported", () => {
    assert.equal(skillProblems(shortWith({ name: "claude-helper" })).length, 1);
    assert.equal(skillProblems(shortWith({ name: "Bad_Name" })).length, 1);
    assert.equal(skillProblems(shortWith({ name: "a".repeat(MAX_NAME_LENGTH + 1) })).length, 1);
  });

  test("an empty or over-long description is reported", () => {
    assert.deepEqual(descriptionProblems(""), ["is empty"]);
    assert.deepEqual(descriptionProblems("x".repeat(MAX_DESCRIPTION_LENGTH + 1)), [`is ${MAX_DESCRIPTION_LENGTH + 1} chars`]);
  });

  test("a 101-line reference without a table of contents is reported, and one with it passes", () => {
    const body = Array.from({ length: TOC_THRESHOLD_LINES }, (_, index) => `line ${index}`).join("\n");
    assert.deepEqual(tocProblems(`# Title\n\n${body}`), ["opens without a table of contents"]);
    assert.deepEqual(tocProblems(`# Title\n\n## Contents\n\n${body}`), []);
    assert.deepEqual(tocProblems(`# Title\n- [a](#a)\n- [b](#b)\n- [c](#c)\n${body}`), []);
  });
});

provedSomething(
  `at least ${MINIMUM_SKILLS} SKILL.md files and ${MINIMUM_REFERENCE_FILES} reference files were read`,
  skills.length >= MINIMUM_SKILLS && references.length >= MINIMUM_REFERENCE_FILES && stubs.length >= MINIMUM_SKILLS,
  `${skills.length} skills, ${references.length} references, ${stubs.length} stub descriptions`,
);
