import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  REPOSITORY_RUNS_DIR,
  RUNS_DIR,
  STATE_FILE,
  withStateSandbox,
  type ObservedEntry,
  type SeededEntry,
  type StateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "sess-live";
const REGISTRY = `${REPOSITORY_RUNS_DIR}/${SESSION}/in-flight`;
const ARMED_RUN = `mode=plan\nauto=running\nauto_change=hanko\nsession=${SESSION}\n`;
const STARTED = "started_at=2026-09-28T00:00:00Z\n";

function subagentStart(agentId: string, agentType = "oso-code:applier"): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: "{home}/projects/proj/sess-live.jsonl",
    cwd: "{cwd}",
    prompt_id: "p1",
    agent_id: agentId,
    agent_type: agentType,
    hook_event_name: "SubagentStart",
  });
}

function subagentStop(agentId: string): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: "{home}/projects/proj/sess-live.jsonl",
    cwd: "{cwd}",
    agent_id: agentId,
    agent_type: "oso-code:applier",
    agent_transcript_path: `{home}/projects/proj/sess-live/subagents/agent-${agentId}.jsonl`,
    hook_event_name: "SubagentStop",
    last_assistant_message: "status: done",
    background_tasks: [{ id: agentId, type: "subagent", status: "running", description: "d", agent_type: "x" }],
  });
}

function gateRunIn(sandbox: StateSandbox, gate: string, payload: string): GateRun {
  return withHookEnvironment({ HOME: sandbox.home }, () =>
    runGate([gate], spawnedEnvelope(sandbox.expandJson(payload), process.env)),
  );
}

function afterRuns(
  seed: Readonly<Record<string, SeededEntry>>,
  calls: readonly Readonly<{ gate: string; payload: string }>[],
  observed: readonly string[],
): Readonly<{ runs: GateRun[]; entries: ObservedEntry[] }> {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    const runs = calls.map(({ gate, payload }) => gateRunIn(sandbox, gate, payload));
    return { runs, entries: observed.map((entry) => sandbox.read(entry)) };
  });
}

function unspoken(run: GateRun): Readonly<{ exit: number; stdout: string; stderr: string }> {
  return { exit: run.exit, stdout: run.stdout, stderr: run.stderr };
}

const SILENT = { exit: 0, stdout: "", stderr: "" };

describe("the SubagentStart and SubagentStop gates keep one registry file per in-flight agent", () => {
  test("a SubagentStart inside this session's unattended run writes the agent's registry file", () => {
    const { runs, entries } = afterRuns(
      { [STATE_FILE]: ARMED_RUN },
      [{ gate: "subagentstart", payload: subagentStart("a1") }],
      [`${REGISTRY}/a1`],
    );
    assert.deepEqual(runs.map(unspoken), [SILENT]);
    const [registered] = entries;
    assert.equal(registered?.kind, "file");
    const content = registered?.kind === "file" ? registered.content : "";
    assert.match(content, /^agent_id=a1$/m);
    assert.match(content, /^agent_type=oso-code:applier$/m);
    assert.match(content, /^transcript=.*[/\\]projects[/\\]proj[/\\]sess-live[/\\]subagents[/\\]agent-a1\.jsonl$/m);
    assert.match(content, /^started_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  });

  test("two starts back to back both land, each in its own file", () => {
    const { entries } = afterRuns(
      { [STATE_FILE]: ARMED_RUN },
      [
        { gate: "subagentstart", payload: subagentStart("a1") },
        { gate: "subagentstart", payload: subagentStart("a2", "oso-code:verifier") },
      ],
      [`${REGISTRY}/a1`, `${REGISTRY}/a2`],
    );
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ["file", "file"],
    );
  });

  test("a SubagentStop removes only its own agent's file", () => {
    const { runs, entries } = afterRuns(
      { [STATE_FILE]: ARMED_RUN },
      [
        { gate: "subagentstart", payload: subagentStart("a1") },
        { gate: "subagentstart", payload: subagentStart("a2") },
        { gate: "subagentstop", payload: subagentStop("a1") },
      ],
      [`${REGISTRY}/a1`, `${REGISTRY}/a2`],
    );
    assert.deepEqual(unspoken(runs[2] as GateRun), SILENT);
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ["absent", "file"],
    );
  });

  test("a SubagentStop whose background_tasks lists only the stopping agent flags a vanished agent ended-without-notice", () => {
    const { runs, entries } = afterRuns(
      {
        [STATE_FILE]: ARMED_RUN,
        [`${REGISTRY}/a1`]: `agent_id=a1\nagent_type=oso-code:applier\n${STARTED}`,
        [`${REGISTRY}/a9`]: `agent_id=a9\nagent_type=oso-code:verifier\n${STARTED}`,
      },
      [{ gate: "subagentstop", payload: subagentStop("a1") }],
      [`${REGISTRY}/a1`, `${REGISTRY}/a9`],
    );
    assert.deepEqual(unspoken(runs[0] as GateRun), SILENT);
    const [stopping, vanished] = entries;
    assert.equal(stopping?.kind, "absent");
    assert.equal(
      vanished?.kind === "file" ? vanished.content : vanished?.kind,
      `agent_id=a9\nagent_type=oso-code:verifier\n${STARTED}ended_without_notice=true\n`,
    );
  });

  const NOT_THIS_SESSIONS_RUN: readonly Readonly<{ why: string; state: string | undefined }>[] = [
    { why: "no state file", state: undefined },
    { why: "a parked run", state: `mode=plan\nauto=parked\nsession=${SESSION}\n` },
    { why: "a run another session owns", state: "mode=plan\nauto=running\nsession=someone-else\n" },
    { why: "a session holding a mode but no unattended run", state: `mode=plan\nsession=${SESSION}\n` },
  ];

  for (const { why, state } of NOT_THIS_SESSIONS_RUN) {
    test(`under ${why} both hooks are silent no-ops that write nothing`, () => {
      const { runs, entries } = afterRuns(
        state === undefined ? {} : { [STATE_FILE]: state },
        [
          { gate: "subagentstart", payload: subagentStart("a1") },
          { gate: "subagentstop", payload: subagentStop("a1") },
        ],
        [`${REPOSITORY_RUNS_DIR}/${SESSION}`],
      );
      assert.deepEqual(runs.map(unspoken), [SILENT, SILENT]);
      assert.deepEqual(entries, [{ kind: "absent" }]);
    });
  }

  test("an agent id carrying a path separator is refused rather than written outside the registry", () => {
    const { runs, entries } = afterRuns(
      { [STATE_FILE]: ARMED_RUN },
      [{ gate: "subagentstart", payload: subagentStart("../escape") }],
      [REGISTRY, `${REPOSITORY_RUNS_DIR}/${SESSION}/escape`],
    );
    assert.deepEqual(unspoken(runs[0] as GateRun), SILENT);
    assert.deepEqual(
      runs[0]?.events.map((event) => [event.event, event.command]),
      [["in-flight-unregistered", "../escape"]],
    );
    assert.deepEqual(entries, [{ kind: "absent" }, { kind: "absent" }]);
  });
});

describe("SessionEnd drops the session's registry, and SessionStart and teardown clear legacy wait marks", () => {
  test("teardown drops the ending session's registry and leaves another session's standing", () => {
    const { entries } = afterRuns(
      {
        [`${REGISTRY}/a1`]: "agent_id=a1\n",
        [`${RUNS_DIR}/another-repo/${SESSION}/in-flight/a9`]: "agent_id=a9\n",
        [`${REPOSITORY_RUNS_DIR}/other-session/in-flight/b1`]: "agent_id=b1\n",
      },
      [{ gate: "teardown", payload: JSON.stringify({ session_id: SESSION, cwd: "{cwd}" }) }],
      [
        `${REPOSITORY_RUNS_DIR}/${SESSION}`,
        `${RUNS_DIR}/another-repo/${SESSION}`,
        `${REPOSITORY_RUNS_DIR}/other-session/in-flight/b1`,
      ],
    );
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ["absent", "absent", "file"],
    );
  });

  const LEGACY_MARKS = [`${REPOSITORY_RUNS_DIR}/${SESSION}.waiting`, `${REPOSITORY_RUNS_DIR}/hanko.waiting`];
  const LEGACY_SEED = Object.fromEntries(LEGACY_MARKS.map((mark) => [mark, `run=hanko\nsession=${SESSION}\n`]));

  for (const gate of ["stale", "teardown"]) {
    test(`the ${gate} gate removes every legacy .waiting mark in the repository's run directory without a word`, () => {
      const { runs, entries } = afterRuns(
        { [STATE_FILE]: ARMED_RUN, ...LEGACY_SEED, [`${REPOSITORY_RUNS_DIR}/hanko.log`]: "journal\n" },
        [{ gate, payload: JSON.stringify({ session_id: SESSION, cwd: "{cwd}", source: "startup" }) }],
        [...LEGACY_MARKS, `${REPOSITORY_RUNS_DIR}/hanko.log`],
      );
      assert.deepEqual(runs[0]?.events, []);
      assert.equal(runs[0]?.stderr, "");
      assert.deepEqual(
        entries.map((entry) => entry.kind),
        ["absent", "absent", "file"],
      );
    });
  }
});
