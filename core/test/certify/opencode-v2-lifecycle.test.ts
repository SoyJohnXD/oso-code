import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test, type TestContext } from "node:test";
import { DELEGATIONS_RETURN_IN_TURN_HOST } from "../../src/gates/autocontinue.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { CERTIFY, CERTIFY_GUARD } from "./support/certify-guard.ts";
import {
  armProject,
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  notesOfKind,
  v2LaneCause,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import {
  laneNotRun,
  resolveOpenCodeBinaryProbe,
  resolvedProbeOrThrow,
  type OpenCodeBinaryProbe,
  type ResolvedProbe,
} from "./support/opencode-binary.ts";
import type { ScriptedProviderRequest } from "./support/scripted-provider.ts";

const OVERRIDE_ENV_VAR = "OSO_V2_HOST_SPIKE_OPENCODE_BIN";
const BUNDLE_OVERRIDE_ENV_VAR = "OSO_V2_LIFECYCLE_BUNDLE";
const REPOSITORY_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUNDLE_SOURCE = process.env[BUNDLE_OVERRIDE_ENV_VAR] ?? path.join(REPOSITORY_ROOT, "opencode", "dist", "oso-code.js");
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

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = v2LaneCause(probe);

function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function textOfRole(request: ScriptedProviderRequest, role: string): string {
  return request.messages.filter((message) => message.role === role).map((message) => textOf(message.content)).join("\n");
}

describe("the built OpenCode adapter bundle drives its session lifecycle on an isolated OpenCode 2 host", () => {
  let fixture: SpikeFixture | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    const resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    host.writeExtraPlugin("oso-code.js", readFileSync(BUNDLE_SOURCE, "utf8"));
    const drive = async (
      name: string,
      pairs: readonly string[],
      tool: string,
      input: Record<string, unknown>,
      session?: string,
    ): Promise<void> => {
      const project = host.sandbox.seedGitRepository(name);
      if (pairs.length > 0) armProject(host, project, pairs, session);
      outcomes.set(name, await driveScenario(resolved as ResolvedProbe, { ...host, project }, name, tool, input));
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

  function lane(t: TestContext): boolean {
    return laneNotRun(t, probe, laneCause);
  }

  function outcomeOf(name: string): ScenarioOutcome {
    const outcome = outcomes.get(name);
    if (outcome === undefined) throw new Error(`unreachable: scenario ${name} was expected to have run`);
    return outcome;
  }

  test("an idle turn under an unattended run posts the continuation order back into the session", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const outcome = outcomeOf("unattended-idle");
    const continued = outcome.requests.filter((request) => textOfRole(request, "user").includes(DELEGATIONS_RETURN_IN_TURN_HOST.order));
    assert.ok(continued.length >= 1, outcome.run.stderr);
    assert.ok(notesOfKind(outcome, "idle").length >= 2);
  });

  test("a primary idle with nothing pending posts no continuation", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const outcome = outcomeOf("quiet-idle");
    assert.equal(notesOfKind(outcome, "idle").length, 1);
    assert.equal(outcome.requests.some((request) => textOfRole(request, "user").includes(DELEGATIONS_RETURN_IN_TURN_HOST.order)), false);
  });

  test("system advice reaches every request of the primary session and none of the child session's", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const { requests } = outcomeOf("foreign-state-child");
    const primary = requests.filter((request) => textOfRole(request, "user").startsWith(PRIMARY_PROMPT));
    const child = requests.filter((request) => textOfRole(request, "user").startsWith(CHILD_PROMPT));
    assert.ok(primary.length >= 1 && child.length >= 1);
    assert.ok(primary.every((request) => textOfRole(request, "system").includes(ADVICE_MARKER)));
    assert.ok(child.every((request) => !textOfRole(request, "system").includes(ADVICE_MARKER)));
  });

  test("the compaction anchor is in the compaction requests' system prompt and in no other request", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const { requests } = outcomeOf("compaction");
    const anchored = requests.filter((request) => textOfRole(request, "system").includes(ANCHOR_MARKER));
    const compacting = requests.filter((request) => textOfRole(request, "user").includes(COMPACTION_PROMPT));
    assert.ok(compacting.length >= 1);
    assert.deepEqual(anchored, compacting);
  });

  test("every scenario exits cleanly at shutdown and traces no advisory", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    for (const [name, outcome] of outcomes) {
      assert.equal(outcome.run.status, 0, `${name}: ${outcome.run.stderr}`);
      assert.equal(outcome.run.stderr.includes(ADVISORY_TRACE), false, `${name}: ${outcome.run.stderr}`);
    }
  });
});
