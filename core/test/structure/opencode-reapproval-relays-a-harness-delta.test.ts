import assert from "node:assert/strict";
import { test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const REFERENCES = ["plan", "roadmap"].flatMap((mode) => [
  `core/src/prose/skills/${mode}/references/opencode.md`,
  `opencode/skills/oso-${mode}/references/opencode.md`,
]);

const RETIRED_WHOLE_PLAN_WORDING = [
  "binds a FRESH digest",
  "present the complete repaso-first plan again",
  "Re-present the whole document",
  "crosses the grant again on a new digest",
];

test("every OpenCode re-approval reference relays the harness delta and calls again in a later turn", () => {
  for (const file of REFERENCES) {
    const { text } = readTrackedText(file);
    assert.match(text, /delta the harness computed/, file);
    assert.match(text, /relay[^.]*delta[^.]*VERBATIM/i, file);
    assert.match(text, /identical (plan|document) bytes in a later turn/, file);
    for (const wording of RETIRED_WHOLE_PLAN_WORDING) assert.ok(!text.includes(wording), `${file}: ${wording}`);
  }
});
