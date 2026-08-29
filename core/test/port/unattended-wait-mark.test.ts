import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { closeSlice, type StatePatch } from "../../src/state/transitions.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox, type SeededEntry, type StateSandbox } from "../support/state-sandbox.ts";

const STATE_FILE = ".local/state/oso-code/{repo}.state";
const MARK_FILE = ".local/state/oso-code/runs/{repo}/test-session.waiting";
const CHANGE_KEYED_MARK = ".local/state/oso-code/runs/{repo}/hanko.waiting";

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

const STOP_PAYLOAD = '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}';
const SESSION_START_PAYLOAD = '{"session_id":"another-session","cwd":"{cwd}","source":"startup"}';

function stateText(fields: Readonly<Record<string, string>>, patch: StatePatch = {}): string {
  return `${Object.entries({ ...fields, ...patch })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function mark(run: string, agedSeconds: number, journalBytes = 0, renewals = 0): SeededEntry {
  return {
    kind: "file",
    content: `run=${run}\nsession=test-session\njournal_bytes=${journalBytes}\nrenewals=${renewals}\n`,
    agedSeconds,
  };
}

function judged(
  seed: Readonly<Record<string, SeededEntry>>,
  gate: string,
  payload: string,
  observe: (sandbox: StateSandbox, run: GateRun) => void = () => {},
): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    const run = withHookEnvironment({ HOME: sandbox.home, OSO_STATE_BIN: "oso-state" }, () =>
      runGate([gate], spawnedEnvelope(sandbox.expandJson(payload), process.env)),
    );
    observe(sandbox, run);
    return run;
  });
}

function markedAt(sandbox: StateSandbox, relativePath: string): number {
  return statSync(path.join(sandbox.home, sandbox.expand(relativePath))).mtimeMs;
}

provedSomething(
  "transitions.closeSlice still carries the disarm this reproduction turns on",
  closeSlice()["auto_wait"] === "none",
  "closeSlice no longer returns auto_wait to none, so the hanko reproduction below proves nothing about the close",
);

describe(
  "core/src/gates/autocontinue.ts: the hanko stall reproduced and closed (defect 1 of the four unattended-rail " +
    "defects: auto_wait was never returned to none by a close, so the Stop net believed a delegation that had " +
    "already reported and held every turn-end until the 45-minute ceiling — a run nobody was watching stopped " +
    "dead there)",
  () => {
    test("a wait mark nine minutes old under a slice label still armed holds the turn, which is the stall", () => {
      const run = judged({ [STATE_FILE]: stateText(HANKO_RUN), [MARK_FILE]: mark("hanko", NINE_MINUTES) }, "autocontinue", STOP_PAYLOAD);
      assert.equal(run.stdout, "{}\n");
      assert.deepEqual(
        run.events.map((event) => event.event),
        ["auto-continue-held"],
      );
    });

    test("the same state closed through transitions.closeSlice pushes the run on instead", () => {
      const run = judged(
        { [STATE_FILE]: stateText(HANKO_RUN, closeSlice()), [MARK_FILE]: mark("hanko", NINE_MINUTES) },
        "autocontinue",
        STOP_PAYLOAD,
      );
      assert.match(run.stdout, /"decision":"block"/);
      assert.deepEqual(
        run.events.map((event) => event.event),
        ["auto-continued"],
      );
    });

    test("that close also drops the mark, so the next delegation under the same label gets its own clock", () => {
      let survived: "standing" | "cleared" = "standing";
      judged(
        { [STATE_FILE]: stateText(HANKO_RUN, closeSlice()), [MARK_FILE]: mark("hanko", NINE_MINUTES) },
        "autocontinue",
        STOP_PAYLOAD,
        (sandbox) => {
          survived = sandbox.read(MARK_FILE).kind === "absent" ? "cleared" : "standing";
        },
      );
      assert.equal(survived, "cleared");
    });
  },
);

describe(
  "core/src/gates/delegation.ts: the wait mark is keyed on the RUN — auto_change at arming plus the session id " +
    "(G7) — so a child boundary never re-dates it (defect 3: the mark was keyed on auto_change alone, through " +
    "the journal path it hung off, and every child boundary moved it to a fresh file whose age started over)",
  () => {
    test("a mark armed under one child is still the mark this run reads after auto_change moves on", () => {
      const run = judged(
        {
          [STATE_FILE]: stateText({ ...HANKO_RUN, auto_change: "child-two", auto_wait: "wave-2" }),
          [MARK_FILE]: mark("child-one", PAST_THE_CEILING),
        },
        "autocontinue",
        STOP_PAYLOAD,
      );
      assert.match(run.stdout, /older than 45 minutes/);
    });

    test("carrying that mark into the new child leaves its clock exactly where it stood", () => {
      let before = 0;
      let after = 0;
      withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({
          [STATE_FILE]: stateText({ ...HANKO_RUN, auto_change: "child-two", auto_wait: "wave-2" }),
          [MARK_FILE]: mark("child-one", NINE_MINUTES),
        });
        before = markedAt(sandbox, MARK_FILE);
        withHookEnvironment({ HOME: sandbox.home }, () => runGate(["autocontinue"], spawnedEnvelope(sandbox.expandJson(STOP_PAYLOAD), process.env)));
        after = markedAt(sandbox, MARK_FILE);
        assert.equal(sandbox.read(MARK_FILE).kind === "file" ? (sandbox.read(MARK_FILE) as { content: string }).content : "", "run=child-two\nsession=test-session\njournal_bytes=0\nrenewals=0\n");
      });
      assert.equal(after, before);
    });

    test("a mark left at the old change-keyed path is no mark at all, which is the crossing C2-D20 routes to C6", () => {
      const run = judged(
        {
          [STATE_FILE]: stateText({ ...HANKO_RUN, auto_wait: "wave-2" }),
          [CHANGE_KEYED_MARK]: mark("hanko", PAST_THE_CEILING),
        },
        "autocontinue",
        STOP_PAYLOAD,
      );
      assert.equal(run.stdout, "{}\n");
      assert.deepEqual(
        run.events.map((event) => event.event),
        ["auto-continue-held"],
      );
    });
  },
);

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
          [".local/state/oso-code/runs/{repo}/another-session.waiting"]: {
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
