import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { watchdogAlive } from "../../src/state/watch.ts";
import { stateFileFor } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { ownProcessStartTime, ownWatchdogRecord } from "../support/process-start.ts";
import { REPOSITORY_RUNS_DIR, withStateSandbox, type SeededEntry } from "../support/state-sandbox.ts";

const SESSION = "sess-watch";
const PID_FILE = `${REPOSITORY_RUNS_DIR}/${SESSION}/watch.pid`;

function aliveWith(seed: Readonly<Record<string, SeededEntry>>): boolean {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home }, () => watchdogAlive(stateFileFor(sandbox.cwd), SESSION));
  });
}

function exitedPid(): number {
  const exited = spawnSync(process.execPath, ["-e", ""]);
  if (exited.pid === undefined) throw new Error("the probe process never started");
  return exited.pid;
}

describe("watchdogAlive reads this session's watch record and confirms its pid is still the process that wrote it", () => {
  test("a record naming a live process and that process's start time is a live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: ownWatchdogRecord() }), true);
  });

  test("a record whose pid lives but whose start time is another process's, a reused pid, is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `watch=${process.pid}:${ownProcessStartTime() + 1}\n` }), false);
  });

  test("a record holding a pid and no start time to confirm it against is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `${process.pid}\n` }), false);
  });

  test("a record naming a process that has exited is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `watch=${exitedPid()}:${ownProcessStartTime()}\n` }), false);
  });

  test("a missing record is no live watchdog", () => {
    assert.equal(aliveWith({}), false);
  });

  test("a record holding no pid is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: "watch=not-a-pid\n" }), false);
  });

  test("another session's live record is not this session's watchdog", () => {
    assert.equal(aliveWith({ [`${REPOSITORY_RUNS_DIR}/other-session/watch.pid`]: ownWatchdogRecord() }), false);
  });
});
