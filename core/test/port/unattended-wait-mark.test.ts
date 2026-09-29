import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_RUNS_DIR, STATE_FILE, withStateSandbox, type SeededEntry } from "../support/state-sandbox.ts";

const MARK_FILE = `${REPOSITORY_RUNS_DIR}/test-session.waiting`;
const FOREIGN_SESSION_MARK = `${REPOSITORY_RUNS_DIR}/another-session.waiting`;

const NINE_MINUTES = 9 * 60;
const PAST_THE_CEILING = 46 * 60;

const HANKO_RUN: Readonly<Record<string, string>> = {
  mode: "plan",
  auto: "running",
  auto_change: "hanko",
  active_slice: "18",
  verify_green: "false",
  auto_wait: "18",
  session: "test-session",
};

const SESSION_START_PAYLOAD = '{"session_id":"another-session","cwd":"{cwd}","source":"startup"}';

function stateText(fields: Readonly<Record<string, string>>): string {
  return `${Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function mark(run: string, agedSeconds: number): SeededEntry {
  return {
    kind: "file",
    content: `run=${run}\nsession=test-session\njournal_bytes=0\nrenewals=0\n`,
    agedSeconds,
  };
}

function judged(seed: Readonly<Record<string, SeededEntry>>, gate: string, payload: string): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home, OSO_STATE_BIN: "oso-state" }, () =>
      runGate([gate], spawnedEnvelope(sandbox.expandJson(payload), process.env)),
    );
  });
}

describe(
  "core/src/gates/stale.ts: the 45-minute expiry is reachable without a future Stop (defect 2: it was evaluated " +
    "only inside a Stop, and a held stop is terminal, so a mark left standing stalled the run forever instead " +
    "of expiring) — the SessionStart gate evaluates the same waitExpired(now) delegation.ts exports",
  () => {
    test("SessionStart names a delegation whose mark is past the ceiling and the disarm that drops it", () => {
      const run = judged(
        {
          [STATE_FILE]: stateText({ ...HANKO_RUN, auto_wait: "wave-2" }),
          [MARK_FILE]: mark("hanko", PAST_THE_CEILING),
        },
        "stale",
        SESSION_START_PAYLOAD,
      );
      assert.match(run.stdout, /still marked as waiting on the delegation \\"wave-2\\"/);
      assert.match(run.stdout, /older than 45 minutes/);
      assert.match(run.stdout, /set auto_wait=none/);
    });

    test("SessionStart says nothing about a delegation whose mark is inside the ceiling", () => {
      const run = judged(
        {
          [STATE_FILE]: stateText({ ...HANKO_RUN, session: "another-session", auto_wait: "wave-2" }),
          [FOREIGN_SESSION_MARK]: {
            kind: "file",
            content: "run=hanko\nsession=another-session\njournal_bytes=0\nrenewals=0\n",
            agedSeconds: NINE_MINUTES,
          },
        },
        "stale",
        SESSION_START_PAYLOAD,
      );
      assert.deepEqual({ exit: run.exit, stdout: run.stdout }, { exit: 0, stdout: "" });
    });
  },
);
