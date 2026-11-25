import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { trackedRepositoryFiles } from "../support/tracked-files.ts";

const PLUGIN_SKILL_PATTERN = /^plugin\/skills\/([^/]+)\/SKILL\.md$/;

function pluginSkillNames(trackedFiles: readonly string[]): string[] {
  return trackedFiles
    .flatMap((file) => {
      const match = file.match(PLUGIN_SKILL_PATTERN);
      return match === null ? [] : [match[1] as string];
    })
    .sort();
}

const trackedFiles = trackedRepositoryFiles();
const trackedFileSet = new Set(trackedFiles);
const skillNames = pluginSkillNames(trackedFiles);

provedSomething(
  "a plugin skill carrying a plugin/skills/<name>/SKILL.md was found",
  skillNames.length > 0,
  "no plugin/skills/<name>/SKILL.md was found, so no skill was checked for its opencode wrapper",
);

describe("every plugin skill is wrapped by an opencode/skills/oso-<name>/SKILL.md", () => {
  for (const name of skillNames) {
    test(`plugin/skills/${name}/SKILL.md is wrapped on opencode`, () => {
      assert.ok(
        trackedFileSet.has(`opencode/skills/oso-${name}/SKILL.md`),
        `opencode/skills/oso-${name}/SKILL.md is missing, so every rule that reads plugin/skills/${name}/SKILL.md's opencode sources reads nothing at all`,
      );
    });
  }
});
