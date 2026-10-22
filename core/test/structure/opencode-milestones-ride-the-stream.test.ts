import assert from "node:assert/strict";
import { test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const MODES = ["plan", "quick", "debug", "roadmap"] as const;

const SHARED_BINDINGS = [
  "core/src/prose/shared/opencode.md",
  "plugin/skills/_shared/references/opencode.md",
];

const MODE_REFERENCES = MODES.flatMap((mode) => [
  `core/src/prose/skills/${mode}/references/opencode.md`,
  `opencode/skills/oso-${mode}/references/opencode.md`,
]);

const RETIRED_WORDING = [
  "This host takes no such carve-out",
  "no carve-out here",
  "carves NO unattended run",
  "gets no carve-out from that contract",
];

test("the OpenCode shared binding lets a milestone continue with the next tool call in the same turn", () => {
  for (const file of SHARED_BINDINGS) {
    const { text } = readTrackedText(file);
    assert.match(text, /Milestones ride the stream, and the record that carries them/, file);
    assert.match(text, /a milestone never ends the turn, in any run/, file);
    assert.match(text, /next tool call follows in the same turn/, file);
  }
});

test("a question, a blocker, the plan document, the park and the final report still end the turn", () => {
  for (const file of SHARED_BINDINGS) {
    const { text } = readTrackedText(file);
    assert.match(
      text,
      /a question or decision for the operator, a blocker that needs them, the plan document before `oso_plan_approve`, the PARK and the FINAL REPORT/,
      file,
    );
  }
});

test("every OpenCode mode reference names milestones as the exception to its delivery contract", () => {
  for (const file of MODE_REFERENCES) {
    const { text } = readTrackedText(file);
    assert.match(text, /Milestone reports are the exception/, file);
    assert.match(text, /Milestones ride the stream, and the record that carries them/, file);
    assert.doesNotMatch(text, /The unattended run — no carve-out here/, file);
  }
});

test("no OpenCode prose keeps the retired no-carve-out wording", () => {
  for (const file of [...SHARED_BINDINGS, ...MODE_REFERENCES]) {
    const { text } = readTrackedText(file);
    for (const wording of RETIRED_WORDING) assert.ok(!text.includes(wording), `${file}: ${wording}`);
  }
});

test("the neutral reporting contract lets a host carve milestones out for every run", () => {
  const { text } = readTrackedText("plugin/skills/_shared/reporting.md");
  assert.match(text, /MAY carve an UNATTENDED RUN, or every run where text before a same-turn tool call stays on screen, out of that rule/);
});

test("the OpenCode global block lets progress milestones continue and the Claude block keeps its rule", () => {
  const opencode = readTrackedText("bootstrap/opencode-global.md").text;
  assert.match(opencode, /progress milestones continue in the same turn with the next tool call/);
  assert.ok(!opencode.includes("never a tool call in the same turn"));
  const claude = readTrackedText("bootstrap/claude-global.md").text;
  assert.match(claude, /Content the operator must read ends the turn as plain text — never a tool call in the same turn \(the TUI drops it\)\./);
});
