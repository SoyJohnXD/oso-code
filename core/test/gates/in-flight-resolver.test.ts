import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flagEndedWithoutNotice, resolveInFlight, type InFlightResolution } from "../../src/gates/in-flight.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_RUNS_DIR, withStateSandbox, type ObservedEntry, type SeededEntry } from "../support/state-sandbox.ts";

const SESSION = "sess-live";
const REGISTRY = `${REPOSITORY_RUNS_DIR}/${SESSION}/in-flight`;
const PROJECT = "projects/proj";
const MAIN_TRANSCRIPT = `{home}/${PROJECT}/${SESSION}.jsonl`;

type Task = Readonly<{ id: string; type?: string; agent_type?: string }>;

function registered(agentId: string, agentType: string): string {
  return `agent_id=${agentId}\nagent_type=${agentType}\ntranscript={home}/registered/agent-${agentId}.jsonl\nstarted_at=2026-09-28T00:00:00Z\n`;
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
  before: ObservedEntry[];
  entries: ObservedEntry[];
}>;

function resolvedAfter(
  seed: Readonly<Record<string, SeededEntry>>,
  payloads: readonly string[],
  observed: readonly string[] = [],
): Resolved {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    const before = observed.map((entry) => sandbox.read(entry));
    const resolutions = payloads.map((payload) =>
      withHookEnvironment({ HOME: sandbox.home }, () =>
        resolveInFlight(spawnedEnvelope(sandbox.expandJson(payload), process.env)),
      ),
    );
    return { resolutions, before, entries: observed.map((entry) => sandbox.read(entry)) };
  });
}

function idsIn(resolution: InFlightResolution | undefined): readonly string[] {
  return resolution?.agentIds ?? [];
}

function endedIn(resolution: InFlightResolution | undefined): readonly string[] {
  return resolution?.endedWithoutNotice ?? [];
}

describe("resolveInFlight names the agents still in flight at a Stop or a SubagentStop", () => {
  test("a present background_tasks is authoritative: its subagent entries are the set, whatever the registry holds", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier") },
      [stopPayload(asTasks([{ id: "a1" }, { id: "a3" }, { id: "sh1", type: "shell" }]))],
    );
    assert.deepEqual(idsIn(resolutions[0]), ["a1", "a3"]);
  });

  test("the stopping agent is excluded from a SubagentStop's background_tasks, which still lists it running", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [subagentStopPayload("a1", asTasks([{ id: "a1" }, { id: "a2" }]))],
    );
    assert.deepEqual(idsIn(resolutions[0]), ["a2"]);
    assert.deepEqual(endedIn(resolutions[0]), []);
  });

  test("a registry entry background_tasks no longer lists is named ended-without-notice, and the read leaves the registry byte-identical", () => {
    const { resolutions, before, entries } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [stopPayload(asTasks([{ id: "a1" }])), stopPayload(asTasks([{ id: "a1" }]))],
      [`${REGISTRY}/a1`, `${REGISTRY}/a2`],
    );
    assert.deepEqual(resolutions.map(endedIn), [["a2"], ["a2"]]);
    assert.deepEqual(entries, before);
  });

  test("flagEndedWithoutNotice marks a vanished entry once however many times it runs, and leaves a listed one alone", () => {
    const [kept, flagged] = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") });
      withHookEnvironment({ HOME: sandbox.home }, () => {
        const envelope = spawnedEnvelope(sandbox.expandJson(stopPayload(asTasks([{ id: "a1" }]))), process.env);
        flagEndedWithoutNotice(envelope);
        flagEndedWithoutNotice(envelope);
      });
      return [`${REGISTRY}/a1`, `${REGISTRY}/a2`].map((entry) => sandbox.read(entry));
    });
    assert.doesNotMatch(kept?.kind === "file" ? kept.content : "", /ended_without_notice/);
    const flaggedContent = flagged?.kind === "file" ? flagged.content : "";
    assert.match(flaggedContent, /^agent_id=a2\n[\s\S]*\nended_without_notice=true\n$/);
    assert.equal(flaggedContent.match(/ended_without_notice=/g)?.length, 1);
  });

  test("the tolerated object shape reads its active ids as the set and prunes a completed one still registered", () => {
    const { resolutions } = resolvedAfter(
      { [`${REGISTRY}/a1`]: registered("a1", "applier"), [`${REGISTRY}/a2`]: registered("a2", "verifier") },
      [stopPayload({ active: ["a1"], completed: ["a2"] })],
    );
    assert.deepEqual(idsIn(resolutions[0]), ["a1"]);
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
});
