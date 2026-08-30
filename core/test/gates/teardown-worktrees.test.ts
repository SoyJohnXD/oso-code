import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  skipUnlessGitSeedsRepositories,
  STATE_ROOT_THESE_TESTS_SPELL,
  withStateSandbox,
  type StateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "test-session";
const WORKTREE_REPO = "worktree-repo";
const VANISHED_REPO = "vanished-repo";
const BASE_FILE = "base.txt";

describe(
  "teardown gate: the git-worktree half of plugin/hooks/cleanup-state.sh, ported from tests/hooks-test.sh:5940-6044",
  { skip: skipUnlessGitSeedsRepositories() },
  () => {
    test("session end removes the session's worktree tree, deregisters it and leaves an audit line", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        sandbox.seedWaveWorktree(repository, SESSION);
        sandbox.seed({ [stateFileOf(SESSION)]: waveState(SESSION, WORKTREE_REPO) });
        assert.equal(sandbox.worktreesRegisteredFor(repository, SESSION), 1);

        runTeardown(sandbox, SESSION);

        assert.equal(existsSync(sandbox.worktreeTreeOf(SESSION)), false);
        assert.equal(sandbox.worktreesRegisteredFor(repository, SESSION), 0);
        assert.ok(loggedEvent(sandbox, "worktree-removed"), "no worktree-removed line was written");
      });
    });

    test("the 7-day sweep removes an abandoned session's worktree tree and deregisters it", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        sandbox.seedWaveWorktree(repository, "wt-abandoned");
        sandbox.seed({
          [stateFileOf("wt-abandoned")]: { kind: "file", content: waveState("wt-abandoned", WORKTREE_REPO), aged: true },
        });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-abandoned"), 1);

        runTeardown(sandbox, SESSION);

        assert.equal(existsSync(sandbox.worktreeTreeOf("wt-abandoned")), false);
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-abandoned"), 0);
      });
    });

    test("a worktree whose session holds a live lock survives the sweep", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        const worktree = sandbox.seedWaveWorktree(repository, "wt-locked");
        sandbox.seed({
          [stateFileOf("wt-locked")]: { kind: "file", content: waveState("wt-locked", WORKTREE_REPO), aged: true },
          [`${stateFileOf("wt-locked")}.lock`]: { kind: "directory" },
        });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-locked"), 1);

        runTeardown(sandbox, SESSION);

        assert.equal(existsSync(worktree), true);
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-locked"), 1);
      });
    });

    test("the emptied tree of a killed run is removed and the worktree it left behind is deregistered", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        const worktree = sandbox.seedWaveWorktree(repository, "wt-crashed");
        sandbox.seed({ [stateFileOf("wt-crashed")]: waveState("wt-crashed", WORKTREE_REPO) });
        rmSync(worktree, { recursive: true, force: true });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-crashed"), 1);

        runTeardown(sandbox, "wt-crashed");

        assert.equal(existsSync(sandbox.worktreeTreeOf("wt-crashed")), false);
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-crashed"), 0);
      });
    });

    test("a session whose repo is gone loses its state file, keeps its worktree and records the failure", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(VANISHED_REPO);
        const worktree = sandbox.seedWaveWorktree(repository, "wt-lost-repo");
        sandbox.seed({ [stateFileOf("wt-lost-repo")]: waveState("wt-lost-repo", VANISHED_REPO) });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-lost-repo"), 1);
        rmSync(repository, { recursive: true, force: true });

        runTeardown(sandbox, "wt-lost-repo");

        assert.equal(existsSync(path.join(sandbox.home, stateFileOf("wt-lost-repo"))), false);
        assert.equal(existsSync(worktree), true);
        assert.ok(loggedEvent(sandbox, "worktree-teardown-failed"), "no worktree-teardown-failed line was written");
      });
    });

    test("a session whose prune could not run still loses its state file and records the failure", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(VANISHED_REPO);
        const worktree = sandbox.seedWaveWorktree(repository, "wt-no-prune");
        sandbox.seed({ [stateFileOf("wt-no-prune")]: waveState("wt-no-prune", VANISHED_REPO) });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-no-prune"), 1);
        rmSync(repository, { recursive: true, force: true });
        rmSync(worktree, { recursive: true, force: true });

        runTeardown(sandbox, "wt-no-prune");

        assert.equal(existsSync(path.join(sandbox.home, stateFileOf("wt-no-prune"))), false);
        assert.ok(loggedEvent(sandbox, "worktree-prune-failed"), "no worktree-prune-failed line was written");
      });
    });

    test("a worktree holding uncommitted work survives session end, stays registered and is recorded", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        const worktree = sandbox.seedWaveWorktree(repository, "wt-dirty");
        sandbox.seed({ [stateFileOf("wt-dirty")]: waveState("wt-dirty", WORKTREE_REPO) });
        writeFileSync(path.join(worktree, BASE_FILE), "uncommitted\n");
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-dirty"), 1);

        runTeardown(sandbox, "wt-dirty");

        assert.equal(existsSync(worktree), true);
        assert.equal(readFileSync(path.join(worktree, BASE_FILE), "utf8"), "uncommitted\n");
        assert.equal(sandbox.worktreesRegisteredFor(repository, "wt-dirty"), 1);
        assert.ok(loggedEvent(sandbox, "worktree-teardown-failed"), "no worktree-teardown-failed line was written");
        assert.equal(existsSync(path.join(sandbox.home, stateFileOf("wt-dirty"))), false);
      });
    });

    test("clearing an orphaned pending drops its owner's state file and removes that owner's worktree tree", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        sandbox.seedWaveWorktree(repository, "orphan-wt-owner");
        sandbox.seed({
          [stateFileOf("orphan-wt-owner")]:
            `${waveState("orphan-wt-owner", WORKTREE_REPO)}plan_approval=pending\nplan_approval_session=orphan-wt-real\n`,
        });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "orphan-wt-owner"), 1);

        runTeardown(sandbox, "orphan-wt-real", { OSO_AGENT: "1" });

        assert.equal(existsSync(path.join(sandbox.home, stateFileOf("orphan-wt-owner"))), false);
        assert.equal(existsSync(sandbox.worktreeTreeOf("orphan-wt-owner")), false);
        assert.equal(sandbox.worktreesRegisteredFor(repository, "orphan-wt-owner"), 0);
      });
    });

    test("clearing a roadmap in flight reaches past an earlier-sorting decoy to the state that names the worktree", () => {
      withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository(WORKTREE_REPO);
        sandbox.seedWaveWorktree(repository, "zz-roadmap-wt");
        sandbox.seed({
          [stateFileOf("aa-roadmap-wt-decoy")]: "mode=plan\nsession=zz-roadmap-wt\n",
          [stateFileOf("zz-roadmap-wt")]:
            `${waveState("zz-roadmap-wt", WORKTREE_REPO)}roadmap=auth-hardening\n`,
        });
        assert.equal(sandbox.worktreesRegisteredFor(repository, "zz-roadmap-wt"), 1);

        runTeardown(sandbox, "zz-roadmap-wt");

        assert.equal(existsSync(path.join(sandbox.home, stateFileOf("zz-roadmap-wt"))), false);
        assert.equal(existsSync(sandbox.worktreeTreeOf("zz-roadmap-wt")), false);
        assert.equal(sandbox.worktreesRegisteredFor(repository, "zz-roadmap-wt"), 0);
      });
    });
  },
);

function stateFileOf(sessionId: string): string {
  return `${STATE_ROOT_THESE_TESTS_SPELL}/${sessionId}.state`;
}

function waveState(sessionId: string, repository: string): string {
  return `mode=plan\nrepo_path={home}/${repository}\nsession=${sessionId}\n`;
}

function runTeardown(sandbox: StateSandbox, sessionId: string, env: Readonly<Record<string, string>> = {}): void {
  const stdin = sandbox.expandJson(`{"session_id":"${sessionId}","cwd":"{cwd}"}`);
  const run = withHookEnvironment({ HOME: sandbox.home, ...env }, () => runGate(["teardown"], spawnedEnvelope(stdin, process.env)));
  assert.equal(run.exit, 0, `the teardown gate failed: ${run.stderr}`);
}

function loggedEvent(sandbox: StateSandbox, event: string): boolean {
  return sandbox.eventLogLines().some((line) => line.includes(`"event":"${event}"`));
}

