import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { trackedRepositoryFiles } from "../support/tracked-files.ts";

const PLUGIN_SKILL_PATTERN = /^plugin\/skills\/([^/]+)\/SKILL\.md$/;
const SKILL_NAMES_FLOOR = 5;
const SKILL_NAMES_DERIVATION =
  "git ls-files plugin/skills/*/SKILL.md, measured at C5-S5b: debt-sweep, debug, doubt-pass, plan, " +
  "quality-pass, quick, roadmap, security-pass, triage — 9";

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
  `${skillNames.length} plugin skill(s) carrying a plugin/skills/<name>/SKILL.md were found`,
  skillNames.length >= SKILL_NAMES_FLOOR,
  `only ${skillNames.length} skill(s) were found, under the ${SKILL_NAMES_FLOOR}-skill floor (${SKILL_NAMES_DERIVATION})`,
);

describe("every plugin skill is wrapped by a codex/skills/<name>/SKILL.md and an opencode/skills/oso-<name>/SKILL.md", () => {
  for (const name of skillNames) {
    test(`plugin/skills/${name}/SKILL.md is wrapped on codex and opencode`, () => {
      assert.ok(
        trackedFileSet.has(`codex/skills/${name}/SKILL.md`),
        `codex/skills/${name}/SKILL.md is missing, so every rule that reads plugin/skills/${name}/SKILL.md's codex sources reads nothing at all`,
      );
      assert.ok(
        trackedFileSet.has(`opencode/skills/oso-${name}/SKILL.md`),
        `opencode/skills/oso-${name}/SKILL.md is missing, so every rule that reads plugin/skills/${name}/SKILL.md's opencode sources reads nothing at all`,
      );
    });
  }
});
