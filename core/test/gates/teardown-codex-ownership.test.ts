import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { hostEnvelope } from "../../src/hosts/envelope.ts";
import { journalFileFor, LockTimeoutError, stateFileFor, stateRootDirectory, withLock, writeStateValues } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const AGED_PAST_THE_TTL = new Date("2000-01-01");

type OwnedWorkspace = Readonly<{ home: string; cwd: string }>;

function withOwnedWorkspace(use: (workspace: OwnedWorkspace) => void): void {
  withStateSandbox("workspace", (sandbox) => {
    withHookEnvironment({ HOME: sandbox.home }, () => use({ home: sandbox.home, cwd: path.join(sandbox.home, "workspace") }));
  });
}

for (const failedRead of [1, 2]) {
  test(`unreadable owned state retains assets and reports the cause on read ${failedRead}`, (context) => {
    withOwnedWorkspace(({ cwd }) => {
      writeStateValues(cwd, "1", [`plan_approval_session=${OWNER}`]);
      const state = stateFileFor(cwd);
      const before = readFileSync(state, "utf8");
      const waiting = journalFileFor(cwd).replace(/\.log$/, ".waiting");
      const worktrees = path.join(stateRootDirectory(), "worktrees", "1");
      mkdirSync(path.dirname(waiting), { recursive: true });
      mkdirSync(worktrees, { recursive: true });
      writeFileSync(waiting, "waiting");
      const read = fs.readFileSync;
      const failure = Object.assign(new Error("EIO: ownership state storage failed"), { code: "EIO" });
      let reads = 0;
      context.mock.method(fs, "readFileSync", (...args: Parameters<typeof read>) => {
        if (args[0] === state && ++reads === failedRead) throw failure;
        return read(...args);
      });
      syncBuiltinESMExports();
      try {
        const result = runGate(["teardown"], hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId: OWNER }));
        assert.ok(result.stderr.includes(failure.message), result.stderr);
        assert.equal(result.exit, 1);
        assert.equal(result.verdict.kind, "gateError");
        assert.equal(readFileSync(state, "utf8"), before);
        assert.equal(existsSync(`${state}.lock`), false);
        assert.equal(readFileSync(waiting, "utf8"), "waiting");
        assert.equal(existsSync(worktrees), true);
      } finally {
        context.mock.restoreAll();
        syncBuiltinESMExports();
      }
    });
  });
}

for (const sessionId of ["", "1", `${OWNER}\n`, FOREIGN]) {
  test(`invalid or foreign native identity retains state: ${JSON.stringify(sessionId)}`, () => {
    withOwnedWorkspace(({ cwd }) => {
      writeStateValues(cwd, "1", [`plan_approval_session=${OWNER}`]);
      const state = stateFileFor(cwd);
      const before = readFileSync(state, "utf8");
      runGate(["teardown"], hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId }));
      assert.equal(readFileSync(state, "utf8"), before);
    });
  });
}

test("ownership is revalidated after acquiring the lock", (context) => {
  withOwnedWorkspace(({ cwd }) => {
    writeStateValues(cwd, "1", [`plan_approval_session=${OWNER}`]);
    const state = stateFileFor(cwd);
    const mkdir = fs.mkdirSync;
    const replacement = `session=1\nplan_approval_session=${FOREIGN}\n`;
    context.mock.method(fs, "mkdirSync", (...args: Parameters<typeof mkdir>) => {
      const result = mkdir(...args);
      if (args[0] === `${state}.lock`) writeFileSync(state, replacement);
      return result;
    });
    syncBuiltinESMExports();
    try {
      assert.equal(runGate(["teardown"], hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId: OWNER })).exit, 0);
      assert.equal(readFileSync(state, "utf8"), replacement);
      assert.equal(existsSync(`${state}.lock`), false);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
});

test("Codex retains unsafe state and does not sweep foreign aged state or rotate shared events", () => {
  withOwnedWorkspace(({ home, cwd }) => {
    const foreignCwd = path.join(home, "foreign");
    writeStateValues(foreignCwd, "1", [`plan_approval_session=${OWNER}`, "roadmap=running"]);
    const foreignState = stateFileFor(foreignCwd);
    const state = stateFileFor(cwd);
    symlinkSync(foreignState, state);
    const events = path.join(stateRootDirectory(), "events.jsonl");
    utimesSync(foreignState, AGED_PAST_THE_TTL, AGED_PAST_THE_TTL);
    utimesSync(events, AGED_PAST_THE_TTL, AGED_PAST_THE_TTL);
    const before = readFileSync(foreignState, "utf8");
    assert.equal(runGate(["teardown"], hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId: OWNER })).exit, 0);
    assert.equal(existsSync(state), true);
    assert.equal(readFileSync(foreignState, "utf8"), before);
    assert.equal(existsSync(events), true);
    assert.equal(existsSync(`${events}.1`), false);
  });
});

for (const ownership of [
  "session=1\n",
  `session=1\nplan_approval_session=${FOREIGN}\n`,
  `session=${FOREIGN}\nplan_approval_session=${OWNER}\n`,
  `session=1\nsession=${OWNER}\nplan_approval_session=${OWNER}\n`,
  `session=1\nplan_approval_session=${OWNER}\nplan_approval_session=${FOREIGN}\n`,
]) {
  test(`uncertain ownership retains aged roadmap state: ${JSON.stringify(ownership)}`, () => {
    withOwnedWorkspace(({ cwd }) => {
      writeStateValues(cwd, "1", []);
      const state = stateFileFor(cwd);
      const content = `mode=plan\nroadmap=running\n${ownership}`;
      writeFileSync(state, content);
      utimesSync(state, AGED_PAST_THE_TTL, AGED_PAST_THE_TTL);
      runGate(["teardown"], hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId: OWNER }));
      assert.equal(readFileSync(state, "utf8"), content);
    });
  });
}

for (const session of ["1", OWNER]) {
  test(`proven owner removes only its state: ${session}`, () => {
    withOwnedWorkspace(({ cwd }) => {
      writeStateValues(cwd, session, [`plan_approval_session=${OWNER}`]);
      const state = stateFileFor(cwd);
      const waiting = journalFileFor(cwd).replace(/\.log$/, ".waiting");
      mkdirSync(path.dirname(waiting), { recursive: true });
      writeFileSync(waiting, "waiting");
      const worktrees = path.join(stateRootDirectory(), "worktrees", session);
      mkdirSync(worktrees, { recursive: true });
      const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "oso-state" }, { cwd, sessionId: OWNER });
      withLock(state, "foreign", () => {
        utimesSync(`${state}.lock`, AGED_PAST_THE_TTL, AGED_PAST_THE_TTL);
        assert.throws(() => withLock(state, OWNER, () => assert.fail("acquired foreign lock"), "retain-existing"), LockTimeoutError);
        assert.equal(runGate(["teardown"], envelope).exit, 0);
        assert.equal(existsSync(state), true);
        assert.equal(existsSync(`${state}.lock`), true);
      });
      assert.equal(runGate(["teardown"], envelope).exit, 0);
      assert.equal(existsSync(state), false);
      assert.equal(existsSync(`${state}.lock`), false);
      assert.equal(existsSync(waiting), true);
      assert.equal(existsSync(worktrees), true);
    });
  });
}

for (const sameRepository of [false, true]) {
  test(`foreign Codex SessionEnd retains native state and cleanup assets: same repository=${sameRepository}`, () => {
    withOwnedWorkspace(({ home }) => {
      const ownerCwd = path.join(home, "owner");
      const foreignCwd = sameRepository ? ownerCwd : path.join(home, "foreign");
      mkdirSync(ownerCwd, { recursive: true });
      mkdirSync(foreignCwd, { recursive: true });
      writeStateValues(ownerCwd, "1", [`plan_approval_session=${OWNER}`, "mode=plan", "roadmap=running"]);
      const state = stateFileFor(ownerCwd);
      const before = readFileSync(state, "utf8");
      const lock = `${state}.lock`;
      const waiting = journalFileFor(foreignCwd).replace(/\.log$/, ".waiting");
      const worktrees = path.join(stateRootDirectory(), "worktrees", "1");
      mkdirSync(lock);
      mkdirSync(path.dirname(waiting), { recursive: true });
      mkdirSync(worktrees, { recursive: true });
      writeFileSync(waiting, "waiting");
      utimesSync(state, AGED_PAST_THE_TTL, AGED_PAST_THE_TTL);
      const result = runGate(["teardown"], hostEnvelope(
        { host: "codex", agentSession: "1", stateBin: "oso-state" },
        { cwd: foreignCwd, sessionId: FOREIGN },
      ));
      assert.equal(result.exit, 0);
      assert.equal(existsSync(state), true);
      assert.equal(readFileSync(state, "utf8"), before);
      for (const asset of [lock, waiting, worktrees]) assert.equal(existsSync(asset), true, asset);
    });
  });
}
