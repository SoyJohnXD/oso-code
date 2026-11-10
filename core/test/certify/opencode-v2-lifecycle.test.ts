import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DELEGATIONS_RETURN_IN_TURN_HOST } from "../../src/gates/autocontinue.ts";
import { CERTIFY_GUARD } from "./support/certify-guard.ts";
import {
  armProject,
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  installAdapterBundle,
  messageTextOf,
  notesOfKind,
  resolveV2Lane,
  scenarioOutcomeOf,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import { resolvedProbeOrThrow } from "./support/opencode-binary.ts";
import type { ScriptedProviderRequest } from "./support/scripted-provider.ts";

const FOREIGN_SESSION = "left-by-another-session";
const ADVICE_MARKER = "was left by another session";
const ANCHOR_MARKER = "compacted while a run was in flight";
const ADVISORY_TRACE = "oso-code: [advisory]";
const PRIMARY_PROMPT = "SCRIPT subagent";
const CHILD_PROMPT = "You are a subagent spawned by another session.";
const COMPACTION_PROMPT = "You MUST summarize the conversation above";
const UNATTENDED_RUN = ["auto=running", "auto_change=lifecycle-probe"];
const ARMED_SLICE = ["mode=plan", "active_slice=4", "verify_green=false"];
const ECHO_CALL = { text: "hello" };

const { probe, laneCause, laneNotRun } = resolveV2Lane();

function textOfRole(request: ScriptedProviderRequest, role: string): string {
  return request.messages.filter((message) => message.role === role).map((message) => messageTextOf(message.content)).join("\n");
}

describe("the built OpenCode adapter bundle drives its session lifecycle on an isolated OpenCode 2 host", () => {
  let fixture: SpikeFixture | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    const resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    installAdapterBundle(host);
    const drive = async (
      name: string,
      pairs: readonly string[],
      tool: string,
      input: Record<string, unknown>,
      session?: string,
    ): Promise<void> => {
      const project = host.sandbox.seedGitRepository(name);
      if (pairs.length > 0) armProject(host, project, pairs, session);
      outcomes.set(name, await driveScenario(resolved, { ...host, project }, name, tool, input));
    };
    const subagentCall = { agent: "general", description: "child work", prompt: `SCRIPT spike_echo ${JSON.stringify(ECHO_CALL)}` };
    await drive("unattended-idle", UNATTENDED_RUN, "spike_echo", ECHO_CALL);
    await drive("quiet-idle", [], "spike_echo", ECHO_CALL);
    await drive("foreign-state-child", ["auto=running", "auto_change=other-run"], "subagent", subagentCall, FOREIGN_SESSION);
    await drive("compaction", ARMED_SLICE, "spike_compact", {});
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  const outcomeOf = (name: string): ScenarioOutcome => scenarioOutcomeOf(outcomes, name);

  test("an idle turn under an unattended run posts the continuation order back into the session", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const outcome = outcomeOf("unattended-idle");
    const continued = outcome.requests.filter((request) => textOfRole(request, "user").includes(DELEGATIONS_RETURN_IN_TURN_HOST.order));
    assert.ok(continued.length >= 1, outcome.run.stderr);
    assert.ok(notesOfKind(outcome, "idle").length >= 2);
  });

  test("a primary idle with nothing pending posts no continuation", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const outcome = outcomeOf("quiet-idle");
    assert.equal(notesOfKind(outcome, "idle").length, 1);
    assert.equal(outcome.requests.some((request) => textOfRole(request, "user").includes(DELEGATIONS_RETURN_IN_TURN_HOST.order)), false);
  });

  test("system advice reaches every request of the primary session and none of the child session's", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { requests } = outcomeOf("foreign-state-child");
    const primary = requests.filter((request) => textOfRole(request, "user").startsWith(PRIMARY_PROMPT));
    const child = requests.filter((request) => textOfRole(request, "user").startsWith(CHILD_PROMPT));
    assert.ok(primary.length >= 1 && child.length >= 1);
    assert.ok(primary.every((request) => textOfRole(request, "system").includes(ADVICE_MARKER)));
    assert.ok(child.every((request) => !textOfRole(request, "system").includes(ADVICE_MARKER)));
  });

  test("the compaction anchor is in the compaction requests' system prompt and in no other request", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { requests } = outcomeOf("compaction");
    const anchored = requests.filter((request) => textOfRole(request, "system").includes(ANCHOR_MARKER));
    const compacting = requests.filter((request) => textOfRole(request, "user").includes(COMPACTION_PROMPT));
    assert.ok(compacting.length >= 1);
    assert.deepEqual(anchored, compacting);
  });

  test("every scenario exits cleanly at shutdown and traces no advisory", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    for (const [name, outcome] of outcomes) {
      assert.equal(outcome.run.status, 0, `${name}: ${outcome.run.stderr}`);
      assert.equal(outcome.run.stderr.includes(ADVISORY_TRACE), false, `${name}: ${outcome.run.stderr}`);
    }
  });
});
