import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { runsDirectoryOf, stateFileFor } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const SESSION = "ses-run";
const CHILD = "ses-child";
const CHANGE = "opencode-children";

type Project = Readonly<{ repository: string; stateFile: string }>;

type ChildSessions = Readonly<{ active: readonly string[]; completed: readonly string[] }>;

const NO_CHILDREN: ChildSessions = { active: [], completed: [] };

function inOpenCodeProject<T>(use: (project: Project) => T): T {
  return withStateSandbox("workspace", (sandbox) => {
    const repository = sandbox.seedGitRepository("project");
    return withHookEnvironment({ HOME: sandbox.home, OSO_HOST: "opencode" }, () => {
      const project = { repository, stateFile: stateFileFor(repository) };
      written(project.stateFile, armedRunState());
      return use(project);
    });
  });
}

function armedRunState(): string {
  return `mode=plan\nauto=running\nauto_change=${CHANGE}\nactive_slice=S6\nverify_green=false\nsession=${SESSION}\n`;
}

function written(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function idled(project: Project, children: ChildSessions = NO_CHILDREN): GateRun {
  const payload = {
    session_id: SESSION,
    cwd: project.repository,
    hook_event_name: "Stop",
    background_tasks: children,
  };
  return runGate(["autocontinue"], spawnedEnvelope(JSON.stringify(payload), process.env));
}

function verdictsOf(runs: readonly GateRun[]): string[] {
  return runs.map((run) => run.verdict.kind);
}

function cappedWithoutProgress(project: Project): GateRun[] {
  return [idled(project), idled(project), idled(project), idled(project)];
}

function journalFile(project: Project): string {
  return path.join(runsDirectoryOf(project.stateFile), `${CHANGE}.log`);
}

describe("the OpenCode continuation holds while a child session it launched is still running", () => {
  test("a child session in flight holds the idle: nothing is pushed and the hold names the child", () => {
    const run = inOpenCodeProject((project) => idled(project, { active: [CHILD], completed: [] }));
    assert.equal(run.verdict.kind, "allow");
    assert.deepEqual(
      run.events.map((event) => `${event.event}|${event.command ?? ""}`),
      [`auto-continue-held|children_in_flight=${CHILD}`],
    );
  });

  test("a child session completing after the cap is progress and resets it", () => {
    const verdicts = inOpenCodeProject((project) => [
      ...cappedWithoutProgress(project),
      idled(project, { active: [], completed: [CHILD] }),
    ]);
    assert.deepEqual(verdictsOf(verdicts), ["push", "push", "push", "allow", "push"]);
  });
});

describe("the OpenCode continuation measures progress by commits and flow, never by journal growth", () => {
  test("journal growth between pushes is no progress: the fourth idle still reaches the cap", () => {
    const verdicts = inOpenCodeProject((project) => {
      mkdirSync(path.dirname(journalFile(project)), { recursive: true });
      return [0, 1, 2, 3].map((push) => {
        appendFileSync(journalFile(project), `2026-09-29T00:00:0${push}Z a milestone and nothing else moved\n`);
        return idled(project);
      });
    });
    assert.deepEqual(verdictsOf(verdicts), ["push", "push", "push", "allow"]);
  });

  test("a legacy .waiting mark is left where it lies, since nothing reads it any longer", () => {
    const { run, markStillThere } = inOpenCodeProject((project) => {
      const mark = path.join(runsDirectoryOf(project.stateFile), `${SESSION}.waiting`);
      mkdirSync(mark, { recursive: true });
      const judged = idled(project);
      return { run: judged, markStillThere: statSync(mark, { throwIfNoEntry: false }) !== undefined };
    });
    assert.equal(run.verdict.kind, "push");
    assert.deepEqual(run.events.map((event) => event.event), ["auto-continued"]);
    assert.equal(markStillThere, true);
  });
});
