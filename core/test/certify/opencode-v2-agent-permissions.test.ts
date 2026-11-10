import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { CERTIFY_GUARD } from "./support/certify-guard.ts";
import {
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  messageTextOf,
  PATCH_TOOL_MODEL,
  resolveV2Lane,
  scenarioOutcomeOf,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import { resolvedProbeOrThrow } from "./support/opencode-binary.ts";
import { scriptedPrompt, type ScriptedProviderRequest } from "./support/scripted-provider.ts";

const SHIPPED_AGENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "agents");
const READ_ONLY_AGENT = "oso-doubt-pass";
const IMPLEMENTING_AGENT = "oso-applier";
const CHILD_PROMPT_PREFIX = "You are a subagent spawned by another session.";
const WRITE_TOOLS = ["edit", "write"];
const CONTROL_AGENT = "general";
const ALL_FLAGS = "all";

const { probe, laneCause, laneNotRun } = resolveV2Lane();

function childOfferedTools(requests: readonly ScriptedProviderRequest[]): readonly string[] {
  const child = requests.find((request) => {
    const prompt = [...request.messages].reverse().find((message) => message.role === "user");
    return prompt !== undefined && messageTextOf(prompt.content).startsWith(CHILD_PROMPT_PREFIX);
  });
  if (child === undefined) throw new Error(`no child session request reached the provider: ${requests.length} request(s)`);
  return child.offeredTools;
}

describe("the generated agent frontmatter, loaded by an isolated OpenCode 2 host, withholds the tools a role must not have", () => {
  let fixture: SpikeFixture | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    const resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    for (const agent of [READ_ONLY_AGENT, IMPLEMENTING_AGENT]) {
      copyFileSync(path.join(SHIPPED_AGENTS, `${agent}.md`), path.join(host.sandbox.home, ".config", "opencode", "agent", `${agent}.md`));
    }
    const withFlags = { ...host, environment: { ...host.environment, OPENCODE_FLAGS: ALL_FLAGS } };
    const launch = (name: string, agent: string, options: { model?: string } = {}, target: SpikeFixture = host): Promise<ScenarioOutcome> => {
      const childCall = scriptedPrompt("shell", { command: `touch ${name}.reached`, description: "probe" });
      return driveScenario(resolved, target, name, "subagent", { agent, description: "probe", prompt: childCall }, options);
    };
    for (const agent of [READ_ONLY_AGENT, IMPLEMENTING_AGENT]) {
      outcomes.set(agent, await launch(agent, agent));
      outcomes.set(`${agent}-patch`, await launch(`${agent}-patch`, agent, { model: PATCH_TOOL_MODEL }));
    }
    for (const agent of [READ_ONLY_AGENT, CONTROL_AGENT]) outcomes.set(`${agent}-todo`, await launch(`${agent}-todo`, agent, {}, withFlags));
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  const outcomeOf = (agent: string): ScenarioOutcome => scenarioOutcomeOf(outcomes, agent);

  test("a read-only agent is offered neither shell, subagent, edit nor write, and its scripted shell call never runs", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const outcome = outcomeOf(READ_ONLY_AGENT);
    const offered = childOfferedTools(outcome.requests);
    for (const tool of ["shell", "subagent", ...WRITE_TOOLS]) assert.equal(offered.includes(tool), false, `${tool} offered: ${offered.join(", ")}`);
    assert.equal(offered.includes("read"), true, offered.join(", "));
    assert.equal(outcome.sideEffectExists(`${READ_ONLY_AGENT}.reached`), false);
  });

  test("the applier keeps shell, edit and write, loses subagent, and its scripted shell call runs", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const outcome = outcomeOf(IMPLEMENTING_AGENT);
    const offered = childOfferedTools(outcome.requests);
    for (const tool of ["shell", ...WRITE_TOOLS]) assert.equal(offered.includes(tool), true, `${tool} missing: ${offered.join(", ")}`);
    assert.equal(offered.includes("subagent"), false, offered.join(", "));
    assert.equal(outcome.sideEffectExists(`${IMPLEMENTING_AGENT}.reached`), true);
  });

  test("on a model that is offered patch instead of edit and write, the read-only agent loses patch and the applier keeps it", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const readOnly = childOfferedTools(outcomeOf(`${READ_ONLY_AGENT}-patch`).requests);
    assert.equal(readOnly.includes("patch"), false, readOnly.join(", "));
    const implementing = childOfferedTools(outcomeOf(`${IMPLEMENTING_AGENT}-patch`).requests);
    assert.equal(implementing.includes("patch"), true, implementing.join(", "));
  });

  test("with every experimental flag on, an agent without the deny is offered todowrite and the read-only agent is not", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const control = childOfferedTools(outcomeOf(`${CONTROL_AGENT}-todo`).requests);
    assert.equal(control.includes("todowrite"), true, control.join(", "));
    const readOnly = childOfferedTools(outcomeOf(`${READ_ONLY_AGENT}-todo`).requests);
    assert.equal(readOnly.includes("todowrite"), false, readOnly.join(", "));
  });
});
