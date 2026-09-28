import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { watchdogAlive } from "../../src/gates/watch.ts";
import { stateFileFor } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
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

describe("watchdogAlive reads this session's watch pid file and asks whether that process lives", () => {
  test("a pid file naming a live process is a live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `${process.pid}\n` }), true);
  });

  test("a pid file naming a process that has exited is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `${exitedPid()}\n` }), false);
  });

  test("a missing pid file is no live watchdog", () => {
    assert.equal(aliveWith({}), false);
  });

  test("a pid file holding no pid is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: "not-a-pid\n" }), false);
  });

  test("another session's live pid file is not this session's watchdog", () => {
    assert.equal(aliveWith({ [`${REPOSITORY_RUNS_DIR}/other-session/watch.pid`]: `${process.pid}\n` }), false);
  });
});
