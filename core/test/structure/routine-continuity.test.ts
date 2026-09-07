import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const ROUTINE_CONTINUITY = "Routine informational milestones may continue in the same turn with the tool call that advances the flow.";
const HUMAN_BOUNDARIES = /questions, permission requests, operator-dependent blockers and completion remain turn boundaries\./i;
const OLD_DELIVERY_RULE = /ENDS the turn as plain text[\s\S]*LATER turn/;
const MODES = ["plan", "quick", "debug", "roadmap"] as const;
const HOSTS = ["codex", "opencode"] as const;

function textOf(file: string): string {
  return readTrackedText(file).text;
}

function deliverySectionOf(text: string): string {
  const heading = "## The delivery contract";
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `delivery contract heading is missing from ${text.slice(0, 40)}`);
  const nextHeading = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, nextHeading === -1 ? text.length : nextHeading);
}

function assertRoutineDelivery(text: string): void {
  const delivery = deliverySectionOf(text);
  assert.ok(delivery.includes(ROUTINE_CONTINUITY), "routine milestones must be allowed to continue in the same turn");
  assert.match(delivery, HUMAN_BOUNDARIES, "human-facing boundaries must remain explicit");
  assert.equal(OLD_DELIVERY_RULE.test(delivery), false, "the old mandatory pause must not remain");
}

describe("routine continuity keeps host delivery and human gates distinct", () => {
  for (const mode of MODES) {
    for (const host of HOSTS) {
      test(`${mode} ${host} reference permits routine same-turn progress`, () => {
        assertRoutineDelivery(textOf(`core/src/prose/skills/${mode}/references/${host}.md`));
        const generated = host === "codex"
          ? `codex/skills/${mode}/references/codex.md`
          : `opencode/skills/oso-${mode}/references/opencode.md`;
        assertRoutineDelivery(textOf(generated));
      });
    }
  }

  test("the negative old-delivery mutation is rejected rather than accepted by a self-fulfilling fixture", () => {
    const source = textOf("core/src/prose/skills/quick/references/opencode.md");
    const oldDelivery = source.replace(
      ROUTINE_CONTINUITY,
      "operator-facing content ENDS the turn as plain text, with any tool call in a LATER turn.",
    );
    assert.throws(() => assertRoutineDelivery(oldDelivery), /routine milestones must be allowed/);
  });

  for (const host of HOSTS) {
    test(`${host} shared binding and global bootstrap retain the same contract`, () => {
      for (const file of [
        `core/src/prose/shared/${host}.md`,
        `plugin/skills/_shared/references/${host}.md`,
        `bootstrap/${host}-global.md`,
      ]) {
        const text = textOf(file);
        assert.ok(text.includes(ROUTINE_CONTINUITY.slice(0, -1)), `${file} omits routine continuity`);
        assert.match(text, HUMAN_BOUNDARIES, `${file} omits human boundaries`);
        assert.equal(text.includes("Content the operator must read ends the turn as plain text — never a tool call in the same turn."), false, `${file} retains the global pause`);
      }
    });
  }

  test("neutral delivery delegates the choice to the host and no longer forces a surface-map pause", () => {
    const reporting = textOf("plugin/skills/_shared/reporting.md");
    assert.match(reporting, /delivery is host-bound/);
    assert.match(reporting, /Routine informational milestones may continue/);
    assert.match(reporting, HUMAN_BOUNDARIES);
    assert.doesNotMatch(reporting, /it ends the turn as plain text, never precedes a tool call in the same turn/);

    const plan = textOf("plugin/skills/plan/SKILL.md");
    assert.match(plan, /surface map and its audited N\/As under the reference file's delivery contract/);
    assert.doesNotMatch(plan, /surface map and its audited N\/As as a turn-ending message/);

    const roadmap = textOf("plugin/skills/roadmap/SKILL.md");
    assert.match(roadmap, /routine milestones to continue in the same turn/);
    assert.doesNotMatch(roadmap, /the report ends the turn and the arming follows in the next one/);
  });

  test("Codex native approval and OpenCode visible approval gates remain intact", () => {
    const codexPlan = textOf("core/src/prose/skills/plan/references/codex.md");
    assert.match(codexPlan, /Implement the plan\./);
    assert.match(codexPlan, /<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->/);
    assert.match(codexPlan, /plan_approval=pending/);

    const openCodePlan = textOf("core/src/prose/skills/plan/references/opencode.md");
    assert.match(openCodePlan, /oso_plan_approve/);
    assert.match(openCodePlan, /same turn when visibility is established/);
    assert.match(openCodePlan, /operator's answer to the host's prompt is still the whole of the approval/);
    assert.match(openCodePlan, /digest it is bound to is the digest of the bytes you passed/);

    const approval = textOf("opencode/plugin/oso/approval.ts");
    assert.match(approval, /same turn/);
    assert.match(approval, /complete document is visible/);
    assert.doesNotMatch(approval, /turn-ending plain text first, then call this tool in a later turn/);
  });

  test("Claude's global delivery contract remains unchanged", () => {
    assert.match(textOf("bootstrap/claude-global.md"), /Content the operator must read ends the turn as plain text/);
    assert.match(textOf("bootstrap/claude-global.md"), /auto=running.*milestones ride the stream/s);
    assert.match(textOf("bootstrap/claude-global.md"), /park and the final report still end it/);
  });
});
