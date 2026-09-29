import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { watchdogAlive, watchdogRecordOf } from "../../src/state/watch.ts";
import { stateFileFor } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_RUNS_DIR, withStateSandbox, type SeededEntry } from "../support/state-sandbox.ts";

const SESSION = "sess-watch";
const PID_FILE = `${REPOSITORY_RUNS_DIR}/${SESSION}/watch.pid`;

type StartTimeReader = (pid: number) => string | undefined;

function aliveWith(seed: Readonly<Record<string, SeededEntry>>, startOf?: StartTimeReader): boolean {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home }, () =>
      watchdogAlive(stateFileFor(sandbox.cwd), SESSION, startOf),
    );
  });
}

function exitedPid(): number {
  const exited = spawnSync(process.execPath, ["-e", ""]);
  if (exited.pid === undefined) throw new Error("the probe process never started");
  return exited.pid;
}

describe("watchdogAlive reads this session's watch record and confirms its pid is still the process that wrote it", () => {
  test("a record naming a live process and that process's start time is a live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: watchdogRecordOf(process.pid) }), true);
  });

  test("a record whose pid lives but whose start time is another process's, a reused pid, is no live watchdog", () => {
    const startedAt = (): string => "4242";
    assert.equal(aliveWith({ [PID_FILE]: `watch=${process.pid}:4243\n` }, startedAt), false);
    assert.equal(aliveWith({ [PID_FILE]: `watch=${process.pid}:4242\n` }, startedAt), true);
  });

  test("a bare pid with no watch= record around it is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `${process.pid}\n` }), false);
  });

  test("a record naming a process that has exited is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: watchdogRecordOf(exitedPid()) }), false);
  });

  test("a missing record is no live watchdog", () => {
    assert.equal(aliveWith({}), false);
  });

  test("a record holding no pid is no live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: "watch=not-a-pid\n" }), false);
  });

  test("another session's live record is not this session's watchdog", () => {
    const otherSession = `${REPOSITORY_RUNS_DIR}/other-session/watch.pid`;
    assert.equal(aliveWith({ [otherSession]: watchdogRecordOf(process.pid) }), false);
  });
});

describe("on a host with no readable process start time, watchdogAlive confirms the pid lives and its heartbeat is fresh", () => {
  const NO_START_TIME = (): undefined => undefined;
  const STALE_HEARTBEAT_SECONDS = 10 * 60;

  test("a record naming a live process whose heartbeat is fresh is a live watchdog", () => {
    assert.equal(aliveWith({ [PID_FILE]: `watch=${process.pid}:\n` }, NO_START_TIME), true);
  });

  test("a record naming a live process whose heartbeat went stale is no live watchdog", () => {
    const stale = { kind: "file", content: `watch=${process.pid}:\n`, agedSeconds: STALE_HEARTBEAT_SECONDS } as const;
    assert.equal(aliveWith({ [PID_FILE]: stale }, NO_START_TIME), false);
  });

  test("a record naming a process that has exited is no live watchdog, however fresh its heartbeat", () => {
    assert.equal(aliveWith({ [PID_FILE]: `watch=${exitedPid()}:\n` }, NO_START_TIME), false);
  });

  test("a missing record is no live watchdog", () => {
    assert.equal(aliveWith({}, NO_START_TIME), false);
  });
});
