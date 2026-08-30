import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { removeWaitMark } from "../../src/gates/delegation.ts";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  REPOSITORY_RUNS_DIR,
  STATE_FILE,
  withStateSandbox,
  type SeededEntry,
} from "../support/state-sandbox.ts";

const SESSION = "test-session";
const MARK_SUFFIX = ".waiting";
const UNREMOVABLE_MARK = `${REPOSITORY_RUNS_DIR}/${SESSION}${MARK_SUFFIX}`;
const EISDIR_CODE = "EISDIR";

const ARMED_RUN: Readonly<Record<string, string>> = {
  mode: "plan",
  auto: "running",
  auto_change: "hanko",
  active_slice: "18",
  verify_green: "false",
  auto_wait: "none",
  session: SESSION,
};

const STOP_PAYLOAD = `{"session_id":"${SESSION}","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}`;

function stateText(fields: Readonly<Record<string, string>>): string {
  return `${Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function judged(state: Readonly<Record<string, string>>, seed: Readonly<Record<string, SeededEntry>> = {}): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({ [STATE_FILE]: stateText(state), ...seed });
    return withHookEnvironment({ HOME: sandbox.home }, () =>
      runGate(["autocontinue"], spawnedEnvelope(sandbox.expandJson(STOP_PAYLOAD), process.env)),
    );
  });
}

function judgedOverAnUnremovableMark(state: Readonly<Record<string, string>>): GateRun {
  return judged(state, { [UNREMOVABLE_MARK]: { kind: "directory" } });
}

function causesNamingNeitherTheMarkNorTheOsCode(run: GateRun): string[] {
  return run.events
    .filter((event) => event.event === "auto-continue-degraded")
    .map((event) => event.command ?? "")
    .filter((cause) => !(cause.includes(`${SESSION}${MARK_SUFFIX}`) && cause.includes(EISDIR_CODE)));
}

function markRemovalOver(seedRunsDirectory: (runs: string) => void): string | undefined {
  const root = mkdtempSync(path.join(tmpdir(), "oso-wait-mark-"));
  try {
    const runs = path.join(root, "runs");
    seedRunsDirectory(runs);
    return removeWaitMark(path.join(runs, `${SESSION}${MARK_SUFFIX}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("removeWaitMark separates a mark that cannot be there from one it cannot remove", () => {
  test("a runs path that is a regular file names no failure — no directory there can hold a mark, which is the absent case force already passes over", () => {
    assert.equal(
      markRemovalOver((runs) => writeFileSync(runs, "a file stands where the run directory belongs\n")),
      undefined,
    );
  });

  test("a mark path that is a directory names the failure, since force passes over an absent mark and not an unremovable one", () => {
    const cause = markRemovalOver((runs) => mkdirSync(path.join(runs, `${SESSION}${MARK_SUFFIX}`), { recursive: true }));
    assert.ok(
      cause !== undefined && cause.includes(`${SESSION}${MARK_SUFFIX}`) && cause.includes(EISDIR_CODE),
      `the removal reported ${String(cause)}, which names neither the mark nor ${EISDIR_CODE}`,
    );
  });
});

describe(
  "core/src/gates/delegation.ts removeWaitMark: rmSync's force already passes over a mark that is not there, " +
    "so a removal that still fails is a real one — a directory standing where the mark belongs, a mode or an " +
    "owner the run cannot unlink — and the frozen 'rm -f … || true' keeps that off the verdict without keeping " +
    "it off the record",
  () => {
    test("a stop outside an armed run allows the stop and records the failed removal as the only event", () => {
      const run = judgedOverAnUnremovableMark({ ...ARMED_RUN, auto: "parked" });

      assert.deepEqual(run.verdict, { kind: "allow" });
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "{}\n", stderr: "" });
      assert.deepEqual(run.events.map((event) => event.event), ["auto-continue-degraded"]);
      assert.deepEqual(causesNamingNeitherTheMarkNorTheOsCode(run), []);
    });

    test("a stop inside an armed run with no delegation still pushes, byte for byte, and records the failure beside the push", () => {
      const pushedOverAnUnremovableMark = judgedOverAnUnremovableMark(ARMED_RUN);
      const pushedWithNoMarkAtAll = judged(ARMED_RUN);

      assert.deepEqual(pushedOverAnUnremovableMark.verdict, pushedWithNoMarkAtAll.verdict);
      assert.equal(pushedOverAnUnremovableMark.stdout, pushedWithNoMarkAtAll.stdout);
      assert.deepEqual(
        { exit: pushedOverAnUnremovableMark.exit, stderr: pushedOverAnUnremovableMark.stderr },
        { exit: 0, stderr: "" },
      );
      assert.deepEqual(
        pushedOverAnUnremovableMark.events.map((event) => event.event),
        ["auto-continued", "auto-continue-degraded"],
      );
      assert.deepEqual(causesNamingNeitherTheMarkNorTheOsCode(pushedOverAnUnremovableMark), []);
    });
  },
);
