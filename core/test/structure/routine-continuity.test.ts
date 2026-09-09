import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { renderReference } from "../../src/prose/render.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const MODES = ["plan", "quick", "debug", "roadmap"] as const;
const HOSTS = ["codex", "opencode"] as const;

function textOf(file: string): string {
  return readTrackedText(file).text;
}

describe("routine delivery routes to the rendered host policy", () => {
  for (const host of HOSTS) {
    test(`${host} mode and bootstrap routes resolve to one shared delivery owner`, () => {
      const owner = `plugin/skills/_shared/references/${host}.md`;
      const shared = textOf(owner);
      assert.equal(shared, renderReference(textOf(`core/src/prose/shared/${host}.md`)));
      assert.equal(shared.split("## The delivery contract\n").length - 1, 1);
      for (const file of [
        ...MODES.map((mode) => `core/src/prose/skills/${mode}/references/${host}.md`),
        `bootstrap/${host}-global.md`,
      ]) {
        const route = textOf(file).match(/READ (?:the active skill's shared host )?`([^`]+)`'s \*\*The delivery contract\*\* section NOW/);
        assert.ok(route?.[1], `${file} has no delivery policy route`);
        assert.equal(path.posix.normalize(path.posix.join("plugin/skills/plan", route[1])), owner);
      }
      for (const mode of MODES) {
        const source = textOf(`core/src/prose/skills/${mode}/references/${host}.md`);
        const generated = host === "codex"
          ? `codex/skills/${mode}/references/codex.md`
          : `opencode/skills/oso-${mode}/references/opencode.md`;
        assert.equal(textOf(generated), renderReference(source));
      }
    });
  }
});
