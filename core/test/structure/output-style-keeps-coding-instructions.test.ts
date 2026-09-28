import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const OUTPUT_STYLE = "plugin/output-styles/oso.md";

function frontmatterOf(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${OUTPUT_STYLE} opens with no frontmatter block`);
  return match[1] ?? "";
}

describe("the output style keeps the host's coding instructions", () => {
  test("the frontmatter declares keep-coding-instructions: true", () => {
    const lines = frontmatterOf(readTrackedText(OUTPUT_STYLE).text).split("\n");
    assert.ok(lines.includes("keep-coding-instructions: true"), `${OUTPUT_STYLE} frontmatter lacks keep-coding-instructions: true`);
  });
});
