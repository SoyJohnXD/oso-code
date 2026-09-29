import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { inFlightRegistryOf, runsDirectoryOf, stateFileFor, watchPidFileOf } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SESSION = "sess-net";
const CHANGE = "stop-net";
const AGENT = "a1f00d";
const STALE_MARK_AGE_MS = 46 * 60_000;
const START_THE_WATCH = '"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch';
const CAP_LINE = "auto-continue: cap reached after 3 pushes without progress — allowing the stop";

type Project = Readonly<{ sandbox: StateSandbox; repository: string; stateFile: string }>;

type StopShape = Readonly<{ stopHookActive?: boolean; backgroundTasks?: unknown }>;

function runState(fields: Readonly<Record<string, string>> = {}): string {
  const state = {
    mode: "plan",
    auto: "running",
    auto_change: CHANGE,
    active_slice: "S4",
    verify_green: "false",
    session: SESSION,
    ...fields,
  };
  return Object.entries(state)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}

function inProject<T>(state: string, use: (project: Project) => T): T {
  return withStateSandbox("workspace", (sandbox) => {
    const repository = sandbox.seedGitRepository("project");
    return withHookEnvironment({ HOME: sandbox.home }, () => {
      const project = { sandbox, repository, stateFile: stateFileFor(repository) };
      written(project.stateFile, state);
      return use(project);
    });
  });
}

function written(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function mainTranscript(project: Project): string {
  return path.join(project.sandbox.home, ".claude", "projects", "project", `${SESSION}.jsonl`);
}

function stopped(project: Project, shape: StopShape = {}): GateRun {
  const payload = {
    session_id: SESSION,
    transcript_path: mainTranscript(project),
    cwd: project.repository,
    hook_event_name: "Stop",
    stop_hook_active: shape.stopHookActive ?? false,
    ...(shape.backgroundTasks === undefined ? {} : { background_tasks: shape.backgroundTasks }),
  };
  return runGate(["autocontinue"], spawnedEnvelope(JSON.stringify(payload), process.env));
}

function oneRunningSubagent(): unknown[] {
  return [{ id: AGENT, type: "subagent", status: "running", description: "applier", agent_type: "oso-code:applier" }];
}

function freshAgentTranscript(project: Project): void {
  written(path.join(path.dirname(mainTranscript(project)), SESSION, "subagents", `agent-${AGENT}.jsonl`), "{}\n");
}

function staleWaitMark(project: Project): string {
  const mark = path.join(runsDirectoryOf(project.stateFile), `${SESSION}.waiting`);
  written(mark, `run=${CHANGE}\nsession=${SESSION}\njournal_bytes=0\nrenewals=0\n`);
  const aged = new Date(Date.now() - STALE_MARK_AGE_MS);
  utimesSync(mark, aged, aged);
  return mark;
}

function liveWatchdog(project: Project): void {
  written(watchPidFileOf(project.stateFile, SESSION), `${process.pid}\n`);
}

function registryEntry(project: Project, agentId: string): string {
  return path.join(inFlightRegistryOf(project.stateFile, SESSION), agentId);
}

function registered(project: Project, agentId: string): void {
  written(
    registryEntry(project, agentId),
    `agent_id=${agentId}\nagent_type=oso-code:applier\ntranscript=\nstarted_at=${new Date().toISOString()}\n`,
  );
}

function journalFile(project: Project): string {
  return path.join(runsDirectoryOf(project.stateFile), `${CHANGE}.log`);
}

function tallyFile(project: Project): string {
  return path.join(runsDirectoryOf(project.stateFile), `${CHANGE}.pushes`);
}

function subagentGate(project: Project, hookEventName: "SubagentStart" | "SubagentStop"): GateRun {
  const payload = {
    session_id: SESSION,
    transcript_path: mainTranscript(project),
    cwd: project.repository,
    agent_id: AGENT,
    agent_type: "oso-code:applier",
    hook_event_name: hookEventName,
  };
  return runGate([hookEventName.toLowerCase()], spawnedEnvelope(JSON.stringify(payload), process.env));
}

function committedOnASliceBranch(project: Project): void {
  const git = (...argv: string[]): string => {
    const run = spawnSync("git", ["-C", project.repository, ...argv], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`git ${argv.join(" ")} exited ${run.status}: ${run.stderr}`);
    return run.stdout.trim();
  };
  const commit = git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "the applier landed a slice");
  git("update-ref", "refs/heads/slice-1", commit);
}

function verdictsOf(runs: readonly GateRun[]): string[] {
  return runs.map((run) => run.verdict.kind);
}

function eventsOf(run: GateRun): string[] {
  return run.events.map((event) => `${event.event}|${event.command ?? ""}`);
}

function reasonOf(run: GateRun): string {
  return run.verdict.kind === "push" ? run.verdict.reason : "";
}

function threePushesWithoutProgress(project: Project): GateRun[] {
  return [stopped(project), stopped(project, { stopHookActive: true }), stopped(project, { stopHookActive: true })];
}

describe("the Claude Stop net reads delegations in flight from background_tasks and the registry, never from auto_wait", () => {
  test("a running subagent under a live watchdog is a hold: the stop is allowed, nothing is pushed and nothing is called lost", () => {
    const run = inProject(runState({ auto_wait: "18" }), (project) => {
      freshAgentTranscript(project);
      staleWaitMark(project);
      liveWatchdog(project);
      return stopped(project, { backgroundTasks: oneRunningSubagent() });
    });
    assert.deepEqual(run.verdict, { kind: "allow" });
    assert.equal(run.stdout, "{}\n");
    assert.deepEqual(eventsOf(run), ["auto-continue-held|background_tasks=array in_flight=1"]);
  });

  test("a running subagent with no watchdog blocks once with the order to start the watch in the background, and never says lost", () => {
    const run = inProject(runState({ auto_wait: "18" }), (project) => {
      freshAgentTranscript(project);
      staleWaitMark(project);
      return stopped(project, { backgroundTasks: oneRunningSubagent() });
    });
    assert.equal(run.verdict.kind, "push");
    assert.ok(reasonOf(run).includes(START_THE_WATCH), `the order never names the watch: ${reasonOf(run)}`);
    assert.match(reasonOf(run), /run_in_background/);
    assert.match(reasonOf(run), /end the turn/);
    assert.doesNotMatch(run.stdout, /lost/);
    assert.deepEqual(eventsOf(run), ["auto-continue-watch-requested|background_tasks=array in_flight=1"]);
  });

  test("the same stop already continued by this hook with still no watchdog is allowed rather than looped, and says so", () => {
    const run = inProject(runState(), (project) =>
      stopped(project, { stopHookActive: true, backgroundTasks: oneRunningSubagent() }),
    );
    assert.deepEqual(run.verdict, { kind: "allow" });
    assert.deepEqual(eventsOf(run), ["auto-continue-watch-unstarted|background_tasks=array in_flight=1"]);
  });

  test("the tolerated object shape is read and recorded as such", () => {
    const run = inProject(runState(), (project) => {
      liveWatchdog(project);
      return stopped(project, { backgroundTasks: { active: [AGENT], completed: [] } });
    });
    assert.deepEqual(eventsOf(run), ["auto-continue-held|background_tasks=object in_flight=1"]);
  });

  test("an unrecognized shape falls back to the registry and the push records the shape it could not read", () => {
    const run = inProject(runState(), (project) => stopped(project, { backgroundTasks: "a1f00d" }));
    assert.equal(run.verdict.kind, "push");
    assert.deepEqual(eventsOf(run), ["auto-continued|background_tasks=unrecognized in_flight=0"]);
  });

  test("a registered agent with background_tasks absent is in flight through the registry", () => {
    const run = inProject(runState(), (project) => {
      registered(project, AGENT);
      liveWatchdog(project);
      return stopped(project);
    });
    assert.deepEqual(eventsOf(run), ["auto-continue-held|background_tasks=absent in_flight=1"]);
  });

  test("a stale auto_wait label and its old mark are no delegation at all: the turn is pushed, the mark untouched, nothing called lost", () => {
    const { run, markAfter } = inProject(runState({ auto_wait: "wave-2" }), (project) => {
      const mark = staleWaitMark(project);
      const before = readFileSync(mark, "utf8");
      const stop = stopped(project);
      return { run: stop, markAfter: readFileSync(mark, "utf8") === before ? "untouched" : "rewritten" };
    });
    assert.equal(run.verdict.kind, "push");
    assert.doesNotMatch(run.stdout, /lost|45 minutes|auto_wait/);
    assert.match(reasonOf(run), /oso\/index NEXT:/);
    assert.equal(markAfter, "untouched");
  });
});

describe("with nothing in flight the Claude net pushes, capped at three pushes without progress", () => {
  test("three pushes then the stop stands, and the cap is journaled once", () => {
    const { verdicts, capLines } = inProject(runState(), (project) => {
      const runs = [...threePushesWithoutProgress(project), stopped(project, { stopHookActive: true }), stopped(project)];
      const journal = readFileSync(journalFile(project), "utf8");
      return { verdicts: verdictsOf(runs), capLines: journal.split("\n").filter((line) => line.endsWith(CAP_LINE)).length };
    });
    assert.deepEqual(verdicts, ["push", "push", "push", "allow", "allow"]);
    assert.equal(capLines, 1);
  });

  test("a new commit on any local branch between stops is progress and resets the cap", () => {
    const verdict = inProject(runState(), (project) => {
      threePushesWithoutProgress(project);
      committedOnASliceBranch(project);
      return stopped(project, { stopHookActive: true }).verdict.kind;
    });
    assert.equal(verdict, "push");
  });

  test("an active_slice change is progress and resets the cap", () => {
    const verdict = inProject(runState(), (project) => {
      threePushesWithoutProgress(project);
      written(project.stateFile, runState({ active_slice: "S5" }));
      return stopped(project, { stopHookActive: true }).verdict.kind;
    });
    assert.equal(verdict, "push");
  });

  test("a subagent that starts and completes after the last push is progress even though no stop saw it in flight", () => {
    const verdicts = inProject(runState(), (project) => {
      const pushed = threePushesWithoutProgress(project);
      subagentGate(project, "SubagentStart");
      subagentGate(project, "SubagentStop");
      return verdictsOf([...pushed, stopped(project, { stopHookActive: true })]);
    });
    assert.deepEqual(verdicts, ["push", "push", "push", "push"]);
  });

  test("a SubagentStop for the agent a held stop waited on is progress and resets the cap", () => {
    const verdicts = inProject(runState(), (project) => {
      const pushed = threePushesWithoutProgress(project);
      subagentGate(project, "SubagentStart");
      liveWatchdog(project);
      const held = stopped(project, { stopHookActive: true });
      subagentGate(project, "SubagentStop");
      return verdictsOf([...pushed, held, stopped(project, { stopHookActive: true })]);
    });
    assert.deepEqual(verdicts, ["push", "push", "push", "allow", "push"]);
  });

  test("a held stop spends none of the net: the tally it inherits is the tally it leaves", () => {
    const { before, after, verdict } = inProject(runState(), (project) => {
      threePushesWithoutProgress(project);
      registered(project, AGENT);
      liveWatchdog(project);
      const inherited = readFileSync(tallyFile(project), "utf8");
      const held = stopped(project, { stopHookActive: true });
      return { before: inherited, after: readFileSync(tallyFile(project), "utf8"), verdict: held.verdict.kind };
    });
    assert.equal(verdict, "allow");
    assert.equal(after, before);
    assert.match(after, /^pushes=3$/m);
  });

  test("an id background_tasks newly lists as completed is progress and resets the cap", () => {
    const verdict = inProject(runState(), (project) => {
      threePushesWithoutProgress(project);
      return stopped(project, { stopHookActive: true, backgroundTasks: { active: [], completed: [AGENT] } }).verdict
        .kind;
    });
    assert.equal(verdict, "push");
  });

  test("journal growth alone is no progress on this host: the fourth push still reaches the cap", () => {
    const verdict = inProject(runState(), (project) => {
      threePushesWithoutProgress(project);
      appendFileSync(journalFile(project), "2026-09-28T00:00:00Z the orchestrator wrote a milestone and nothing else moved\n");
      return stopped(project, { stopHookActive: true }).verdict.kind;
    });
    assert.equal(verdict, "allow");
  });
});

describe("the branch-heads reading the progress measure rests on never fails in silence", () => {
  test("a project git cannot read is still pushed, and git's own complaint goes on the record", () => {
    const run = withStateSandbox("workspace", (sandbox) =>
      withHookEnvironment({ HOME: sandbox.home }, () => {
        const project = { sandbox, repository: sandbox.cwd, stateFile: stateFileFor(sandbox.cwd) };
        written(project.stateFile, runState());
        return stopped(project);
      }),
    );
    assert.equal(run.verdict.kind, "push");
    const unreadable = run.events.find((event) => event.event === "auto-continue-heads-unreadable");
    assert.match(unreadable?.command ?? "", /^git for-each-ref refs\/heads exited 128: fatal: not a git repository/);
  });
});
