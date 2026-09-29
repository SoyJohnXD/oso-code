import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { resolveInFlight, type InFlightResolution } from "../../src/gates/in-flight.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_RUNS_DIR, withStateSandbox, type ObservedEntry, type SeededEntry } from "../support/state-sandbox.ts";

const SESSION = "sess-live";
const REGISTRY = `${REPOSITORY_RUNS_DIR}/${SESSION}/in-flight`;
const PROJECT = "projects/proj";
const MAIN_TRANSCRIPT = `{home}/${PROJECT}/${SESSION}.jsonl`;
const TRANSCRIPT_AGE_SECONDS = 600;

type Task = Readonly<{ id: string; type?: string; agent_type?: string }>;

function registered(agentId: string, agentType: string, transcript = `{home}/registered/agent-${agentId}.jsonl`): string {
  return `agent_id=${agentId}\nagent_type=${agentType}\ntranscript=${transcript}\nstarted_at=2026-09-28T00:00:00Z\n`;
}

function asTasks(tasks: readonly Task[]): unknown[] {
  return tasks.map(({ id, type = "subagent", agent_type = "from-payload" }) => ({
    id,
    type,
    status: "running",
    description: "d",
    agent_type,
  }));
}

function stopPayload(backgroundTasks?: unknown): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: MAIN_TRANSCRIPT,
    cwd: "{cwd}",
    hook_event_name: "Stop",
    ...(backgroundTasks === undefined ? {} : { background_tasks: backgroundTasks }),
  });
}

function subagentStopPayload(stopping: string, backgroundTasks?: unknown): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: MAIN_TRANSCRIPT,
    cwd: "{cwd}",
    agent_id: stopping,
    agent_type: "oso-code:applier",
    agent_transcript_path: `{home}/${PROJECT}/${SESSION}/subagents/agent-${stopping}.jsonl`,
    hook_event_name: "SubagentStop",
    ...(backgroundTasks === undefined ? {} : { background_tasks: backgroundTasks }),
  });
}

type Resolved = Readonly<{
  resolutions: InFlightResolution[];
  home: string;
  entries: ObservedEntry[];
}>;

function resolvedAfter(
  seed: Readonly<Record<string, SeededEntry>>,
  payloads: readonly string[],
  observed: readonly string[] = [],
): Resolved {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    const resolutions = payloads.map((payload) =>
      withHookEnvironment({ HOME: sandbox.home }, () =>
        resolveInFlight(spawnedEnvelope(sandbox.expandJson(payload), process.env)),
      ),
    );
    return { resolutions, home: sandbox.home, entries: observed.map((entry) => sandbox.read(entry)) };
  });
}

function idsIn(resolution: InFlightResolution | undefined): readonly string[] {
  return (resolution?.agents ?? []).map((agent) => agent.agentId);
}

function endedIn(resolution: InFlightResolution | undefined): readonly string[] {
  return (resolution?.endedWithoutNotice ?? []).map((agent) => agent.agentId);
}

describe("resolveInFlight names the agents still in flight at a Stop or a SubagentStop", () => {
  test("a present background_tasks is authoritative: its subagent entries are the set, whatever the registry holds", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier") },
      [stopPayload(asTasks([{ id: "a1" }, { id: "a3" }, { id: "sh1", type: "shell" }]))],
    );
    const [resolution] = resolutions;
    assert.equal(resolution?.source, "background_tasks");
    assert.deepEqual(idsIn(resolution), ["a1", "a3"]);
  });

  test("the stopping agent is excluded from a SubagentStop's background_tasks, which still lists it running", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [subagentStopPayload("a1", asTasks([{ id: "a1" }, { id: "a2" }]))],
    );
    assert.deepEqual(idsIn(resolutions[0]), ["a2"]);
    assert.deepEqual(endedIn(resolutions[0]), []);
  });

  test("a registry entry background_tasks no longer lists is flagged, kept for the watch, and reported ended-without-notice exactly once", () => {
    const { resolutions, entries } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [stopPayload(asTasks([{ id: "a1" }])), stopPayload(asTasks([{ id: "a1" }]))],
      [`${REGISTRY}/a1`, `${REGISTRY}/a2`],
    );
    assert.deepEqual(resolutions.map(endedIn), [["a2"], []]);
    assert.deepEqual(resolutions[0]?.endedWithoutNotice.map((agent) => agent.agentType), ["verifier"]);
    const [kept, flagged] = entries.map((entry) => (entry.kind === "file" ? entry.content : entry.kind));
    assert.doesNotMatch(kept ?? "", /ended_without_notice/);
    assert.match(flagged ?? "", /^agent_id=a2\n[\s\S]*\nended_without_notice=true\n$/);
    assert.equal(flagged?.match(/ended_without_notice=/g)?.length, 1);
  });

  test("the tolerated object shape reads its active ids as the set and prunes a completed one still registered", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [stopPayload({ active: ["a1"], completed: ["a2"] })],
    );
    assert.equal(resolutions[0]?.source, "background_tasks");
    assert.deepEqual(idsIn(resolutions[0]), ["a1"]);
    assert.deepEqual(resolutions[0]?.agents.map((agent) => agent.agentType), ["applier"]);
    assert.deepEqual(endedIn(resolutions[0]), ["a2"]);
  });

  for (const [shape, backgroundTasks] of [
    ["absent", undefined],
    ["unrecognized", "a1"],
  ] as const) {
    test(`an ${shape} background_tasks falls back to the registry as the set, pruning nothing`, () => {
      const { resolutions, entries } = resolvedAfter(
        { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
        [stopPayload(backgroundTasks)],
        [`${REGISTRY}/a1`, `${REGISTRY}/a2`],
      );
      assert.equal(resolutions[0]?.source, "registry");
      assert.deepEqual(idsIn(resolutions[0]), ["a1", "a2"]);
      assert.deepEqual(endedIn(resolutions[0]), []);
      assert.deepEqual(
        entries.map((entry) => entry.kind),
        ["file", "file"],
      );
    });
  }

  test("a SubagentStop with no background_tasks excludes the stopping agent from the registry set", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [subagentStopPayload("a1")],
    );
    assert.deepEqual(idsIn(resolutions[0]), ["a2"]);
  });

  test("each agent carries the registry's transcript path, else the one derived from the session transcript", () => {
    const { resolutions, home } = resolvedAfter(
      {
        [`${REGISTRY}/a1`]: registered("a1", "applier"),
        "registered/agent-a1.jsonl": { kind: "file", content: "{}\n", agedSeconds: TRANSCRIPT_AGE_SECONDS },
      },
      [stopPayload(asTasks([{ id: "a1" }, { id: "a3", agent_type: "oso-code:verifier" }]))],
    );
    const [first, derived] = resolutions[0]?.agents ?? [];
    assert.equal(first?.transcript.path, path.join(home, "registered", "agent-a1.jsonl"));
    const age = Date.now() - (first?.transcript.modifiedAtMs ?? 0);
    assert.ok(
      Math.abs(age - TRANSCRIPT_AGE_SECONDS * 1000) < 60_000,
      `the transcript read ${age} ms old, not about ${TRANSCRIPT_AGE_SECONDS} s`,
    );
    assert.equal(derived?.agentType, "oso-code:verifier");
    assert.equal(derived?.transcript.path, path.join(home, PROJECT, SESSION, "subagents", "agent-a3.jsonl"));
    assert.equal(derived?.transcript.modifiedAtMs, undefined);
  });
});
