import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deriveRootId } from "./identity.ts";
import {
  applySighting,
  CAP_MILESTONE,
  CONTINUATION_ORDER,
  decideContinuation,
  DELEGATION_WAIT_CEILING_MINUTES,
  DELEGATION_WAIT_RENEWALS_CAP,
  EXPIRED_DELEGATION_CAP_MILESTONE,
  EXPIRED_DELEGATION_ORDER,
  PUSHES_WITHOUT_PROGRESS_CAP,
  readUnattendedRun,
  recordContinuationStep,
  type ContinuationStep,
  type StandingSighting,
  type UnattendedRunReading,
} from "./unattended-run.ts";

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugin/hooks");
const STATE_BIN = resolve(HOOKS_DIR, "..", "bin", "oso-state");
process.env.OSO_HOOKS_DIR = HOOKS_DIR;

const CEILING_SECONDS = DELEGATION_WAIT_CEILING_MINUTES * 60;
const A_FINISHED_DELEGATIONS_CLOCK = 2993;

function reading(overrides: Partial<UnattendedRunReading> = {}): UnattendedRunReading {
  return {
    sessionID: "ses-root",
    journalFile: "/nowhere/run.log",
    unattendedRunMarker: "running",
    delegationLabel: "none",
    journalBytes: 0,
    tally: { kind: "absent" },
    sighting: null,
    ...overrides,
  };
}

test("an armed run with nothing delegated pushes the continuation order and clears the delegation mark", () => {
  const decision = decideContinuation(reading({ journalBytes: 120 }));
  assert.deepEqual(decision.sighting, { kind: "clear" });
  assert.deepEqual(decision.step, {
    kind: "push",
    order: CONTINUATION_ORDER,
    tally: { pushes: 1, journalBytes: 120 },
  });
});

test("a run that is no longer marked running stands down and drops the delegation mark", () => {
  const decision = decideContinuation(reading({ unattendedRunMarker: "parked" }));
  assert.deepEqual(decision.sighting, { kind: "clear" });
  assert.equal(decision.step.kind, "stop");
});

test("state armed under another identity reads as no unattended run at all", () => {
  const decision = decideContinuation(reading({ unattendedRunMarker: "" }));
  assert.equal(decision.step.kind, "stop");
  assert.match((decision.step as { reason: string }).reason, /nothing at all/);
});

test("a delegation nobody has marked yet is marked and held rather than pushed", () => {
  const decision = decideContinuation(reading({ delegationLabel: "12", journalBytes: 400 }));
  assert.deepEqual(decision.sighting, {
    kind: "record",
    mark: { label: "12", session: "ses-root", journalBytes: 400, renewals: 0 },
  });
  assert.deepEqual(decision.step, { kind: "hold", label: "12" });
});

test("a delegation whose mark is younger than the ceiling is held without touching its clock", () => {
  const decision = decideContinuation(reading({
    delegationLabel: "12",
    journalBytes: 400,
    sighting: {
      mark: { label: "12", session: "ses-root", journalBytes: 400, renewals: 0 },
      ageSeconds: CEILING_SECONDS - 1,
    },
  }));
  assert.deepEqual(decision.sighting, { kind: "leave" });
  assert.deepEqual(decision.step, { kind: "hold", label: "12" });
});

test("a delegation whose mark outlives the ceiling is pushed past as lost, its mark left standing", () => {
  const decision = decideContinuation(reading({
    delegationLabel: "12",
    journalBytes: 400,
    sighting: {
      mark: { label: "12", session: "ses-root", journalBytes: 400, renewals: 0 },
      ageSeconds: CEILING_SECONDS,
    },
  }));
  assert.deepEqual(decision.sighting, { kind: "leave" });
  assert.equal((decision.step as { order: string }).order, EXPIRED_DELEGATION_ORDER);
});

function markPastTheCeiling(renewals: number): StandingSighting {
  return {
    mark: { label: "12", session: "ses-root", journalBytes: 120, renewals },
    ageSeconds: A_FINISHED_DELEGATIONS_CLOCK,
  };
}

test("progress under a standing mark renews the belief window, a bounded number of times", () => {
  const runMoved = decideContinuation(reading({
    delegationLabel: "12",
    journalBytes: 400,
    sighting: markPastTheCeiling(0),
  }));
  assert.deepEqual(runMoved.sighting, {
    kind: "record",
    mark: { label: "12", session: "ses-root", journalBytes: 400, renewals: 1 },
  }, "the run moved under the mark, so the belief window restarts and the renewal is counted");
  assert.deepEqual(runMoved.step, { kind: "hold", label: "12" });

  const runStalled = decideContinuation(reading({
    delegationLabel: "12",
    journalBytes: 120,
    sighting: markPastTheCeiling(0),
  }));
  assert.deepEqual(runStalled.sighting, { kind: "leave" });
  assert.equal(
    (runStalled.step as { order: string }).order,
    EXPIRED_DELEGATION_ORDER,
    "a delegation that journaled nothing does age out, so the ceiling keeps the purpose it was built for",
  );

  const renewalsSpent = decideContinuation(reading({
    delegationLabel: "12",
    journalBytes: 400,
    sighting: markPastTheCeiling(DELEGATION_WAIT_RENEWALS_CAP),
  }));
  assert.deepEqual(renewalsSpent.sighting, { kind: "leave" });
  assert.equal(
    (renewalsSpent.step as { order: string }).order,
    EXPIRED_DELEGATION_ORDER,
    "a run that keeps moving under one mark forever still meets the ceiling, so the hold is bounded",
  );
});

test("the belief window is scoped to one label under one session, and nothing wider", () => {
  const anotherDelegation = decideContinuation(reading({
    delegationLabel: "13",
    journalBytes: 120,
    sighting: markPastTheCeiling(DELEGATION_WAIT_RENEWALS_CAP),
  }));
  assert.deepEqual(anotherDelegation.sighting, {
    kind: "record",
    mark: { label: "13", session: "ses-root", journalBytes: 120, renewals: 0 },
  });
  assert.deepEqual(anotherDelegation.step, { kind: "hold", label: "13" });

  const anotherSession = decideContinuation(reading({
    sessionID: "ses-resumed",
    delegationLabel: "12",
    journalBytes: 120,
    sighting: markPastTheCeiling(DELEGATION_WAIT_RENEWALS_CAP),
  }));
  assert.deepEqual(anotherSession.sighting, {
    kind: "record",
    mark: { label: "12", session: "ses-resumed", journalBytes: 120, renewals: 0 },
  });
  assert.deepEqual(anotherSession.step, { kind: "hold", label: "12" });
});

test("a journal that grew since the last push clears the pushes that moved it nowhere", () => {
  const decision = decideContinuation(reading({
    journalBytes: 900,
    tally: { kind: "counted", tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP, journalBytes: 400 } },
  }));
  assert.deepEqual(decision.step, {
    kind: "push",
    order: CONTINUATION_ORDER,
    tally: { pushes: 1, journalBytes: 900 },
  });
});

test("the push cap announces itself once and stays silent past it", () => {
  const stalled = { journalBytes: 400 };
  const atTheCap = decideContinuation(reading({
    ...stalled,
    tally: { kind: "counted", tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP, journalBytes: 400 } },
  }));
  assert.deepEqual(atTheCap.step, {
    kind: "cap-reached",
    milestone: CAP_MILESTONE,
    tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP + 1, journalBytes: 400 },
  });

  const pastTheCap = decideContinuation(reading({
    ...stalled,
    tally: { kind: "counted", tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP + 1, journalBytes: 400 } },
  }));
  assert.equal(pastTheCap.step.kind, "cap-held");
  assert.equal((pastTheCap.step as { milestone: string }).milestone, CAP_MILESTONE);
});

test("a lost delegation's cap names the delegation rather than the plain stall", () => {
  const decision = decideContinuation(reading({
    delegationLabel: "wave-1",
    journalBytes: 400,
    tally: { kind: "counted", tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP, journalBytes: 400 } },
    sighting: {
      mark: { label: "wave-1", session: "ses-root", journalBytes: 400, renewals: 0 },
      ageSeconds: CEILING_SECONDS,
    },
  }));
  assert.deepEqual(decision.step, {
    kind: "cap-reached",
    milestone: EXPIRED_DELEGATION_CAP_MILESTONE,
    tally: { pushes: PUSHES_WITHOUT_PROGRESS_CAP + 1, journalBytes: 400 },
  });
});

interface Fixture {
  base: string;
  repo: string;
  home: string;
  owner: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "oso-unattended-run-"));
  const repo = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  const init = spawnSync("git", ["init", "-b", "main"], { cwd: repo, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr ?? "");
  return { base, repo, home, owner: deriveRootId(repo) };
}

function runState(fixture: Fixture, args: readonly string[]): string {
  const result = spawnSync(STATE_BIN, args, {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...process.env, HOME: fixture.home },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout ?? "";
}

function withFixtureHome<T>(fixture: Fixture, run: () => T): T {
  const previous = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    return run();
  } finally {
    process.env.HOME = previous;
  }
}

function armRun(fixture: Fixture, pairs: readonly string[]): void {
  runState(fixture, ["--session", fixture.owner, "set", ...pairs]);
}

function journalMilestone(fixture: Fixture, text: string): void {
  runState(fixture, ["journal", text]);
}

function journalPath(fixture: Fixture): string {
  return runState(fixture, ["journal", "--path"]).trim();
}

function ageFile(path: string, seconds: number): void {
  const when = new Date(Date.now() - seconds * 1000);
  utimesSync(path, when, when);
}

test("the run reading names the journal the state binary itself resolves", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve"]);
    journalMilestone(fixture, "the run opened");
    const read = withFixtureHome(fixture, () => readUnattendedRun({
      directory: fixture.repo,
      owner: fixture.owner,
      sessionID: "ses-root",
    }));
    assert.equal(read.journalFile, journalPath(fixture));
    assert.match(read.journalFile, /slice-twelve\.log$/);
    assert.equal(read.unattendedRunMarker, "running");
    assert.equal(read.journalBytes, statSync(read.journalFile).size);
    assert.deepEqual(read.tally, { kind: "absent" });
    assert.equal(read.sighting, null);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a run marked by another identity is not this identity's to continue", () => {
  const fixture = makeFixture();
  try {
    runState(fixture, ["--session", "a-session-that-is-not-this-one", "set", "auto=running"]);
    const read = withFixtureHome(fixture, () => readUnattendedRun({
      directory: fixture.repo,
      owner: fixture.owner,
      sessionID: "ses-root",
    }));
    assert.equal(read.unattendedRunMarker, "");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const AUTO_CONTINUE_HOOK = resolve(HOOKS_DIR, "auto-continue.sh");

type BashNetTurn = "posted" | "withheld";

function bashNetTurn(fixture: Fixture, sessionID: string): BashNetTurn {
  const result = spawnSync("bash", [AUTO_CONTINUE_HOOK], {
    cwd: fixture.repo,
    encoding: "utf8",
    input: JSON.stringify({ session_id: sessionID, cwd: fixture.repo, hook_event_name: "Stop" }),
    env: { ...process.env, HOME: fixture.home, OSO_AGENT: "" },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return (result.stdout ?? "").includes('"decision":"block"') ? "posted" : "withheld";
}

function markFileOf(journalFile: string): string {
  return `${journalFile.replace(/\.log$/, "")}.waiting`;
}

test("the delegation mark the bash net writes reads back here whole, renewal count included", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve", "auto_wait=12"]);
    journalMilestone(fixture, "the delegation went out");
    const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: fixture.owner };

    assert.equal(bashNetTurn(fixture, fixture.owner), "withheld");
    const read = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    assert.deepEqual(read.sighting?.mark, {
      label: "12",
      session: fixture.owner,
      journalBytes: read.journalBytes,
      renewals: 0,
    });
    assert.deepEqual(decideContinuation(read).step, { kind: "hold", label: "12" });
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the delegation mark this host writes is the one the bash net renews and then stops believing", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve", "auto_wait=12"]);
    journalMilestone(fixture, "the delegation went out");
    const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: fixture.owner };
    const opened = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    const markFile = markFileOf(opened.journalFile);

    applySighting(opened.journalFile, {
      kind: "record",
      mark: {
        label: "12",
        session: fixture.owner,
        journalBytes: opened.journalBytes,
        renewals: DELEGATION_WAIT_RENEWALS_CAP - 1,
      },
    });
    ageFile(markFile, A_FINISHED_DELEGATIONS_CLOCK);
    journalMilestone(fixture, "the run moved while the delegation stayed marked in flight");
    assert.equal(bashNetTurn(fixture, fixture.owner), "withheld");
    assert.equal(
      withFixtureHome(fixture, () => readUnattendedRun(lookup)).sighting?.mark.renewals,
      DELEGATION_WAIT_RENEWALS_CAP,
      "the bash net read this host's renewal count and spent the last of it",
    );

    ageFile(markFile, A_FINISHED_DELEGATIONS_CLOCK);
    journalMilestone(fixture, "the run moved again under a mark with no renewals left");
    assert.equal(bashNetTurn(fixture, fixture.owner), "posted");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the push tally round-trips through the sidecar the journal names", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve"]);
    journalMilestone(fixture, "the run opened");
    const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: "ses-root" };
    const opened = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    recordContinuationStep(lookup, opened.journalFile, {
      kind: "push",
      order: CONTINUATION_ORDER,
      tally: { pushes: 2, journalBytes: opened.journalBytes },
    });

    const stalled = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    assert.deepEqual(stalled.tally, { kind: "counted", tally: { pushes: 2, journalBytes: opened.journalBytes } });
    assert.deepEqual(nextStepOf(stalled), {
      kind: "push",
      order: CONTINUATION_ORDER,
      tally: { pushes: 3, journalBytes: opened.journalBytes },
    });

    appendFileSync(opened.journalFile, "2026-08-22T00:00:00Z a milestone landed\n");
    const progressed = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    assert.deepEqual(nextStepOf(progressed), {
      kind: "push",
      order: CONTINUATION_ORDER,
      tally: { pushes: 1, journalBytes: progressed.journalBytes },
    });
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const MALFORMED_TALLIES: ReadonlyArray<readonly [string, string]> = [
  ["a tally that counts no pushes", "pushes=banana\njournal_bytes=0\n"],
  ["a tally that counts no journal bytes", "pushes=1\njournal_bytes=later\n"],
  ["a tally with nothing in it at all", ""],
];

test("a malformed push tally stands the run down on both hosts, never posting a turn on either", () => {
  for (const [shape, contents] of MALFORMED_TALLIES) {
    const fixture = makeFixture();
    try {
      armRun(fixture, ["auto=running", "auto_change=slice-twelve"]);
      journalMilestone(fixture, "the run opened");
      const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: fixture.owner };
      const opened = withFixtureHome(fixture, () => readUnattendedRun(lookup));
      writeFileSync(tallyFileOf(opened.journalFile), contents);

      assert.equal(bashNetTurn(fixture, fixture.owner), "withheld", shape);
      const step = nextStepOf(withFixtureHome(fixture, () => readUnattendedRun(lookup)));
      assert.equal(step.kind, "stop", shape);
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  }
});

test("a tally that is a directory rather than a file stands the run down on both hosts", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve"]);
    journalMilestone(fixture, "the run opened");
    const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: fixture.owner };
    const opened = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    mkdirSync(tallyFileOf(opened.journalFile), { recursive: true });

    assert.equal(bashNetTurn(fixture, fixture.owner), "withheld");
    const read = withFixtureHome(fixture, () => readUnattendedRun(lookup));
    assert.deepEqual(read.tally, { kind: "unusable", cause: "the push tally is not a readable file" });
    assert.equal(nextStepOf(read).kind, "stop");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a tally that was never written is no pushes so far on both hosts, so the turn is posted", () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_change=slice-twelve"]);
    journalMilestone(fixture, "the run opened");
    const lookup = { directory: fixture.repo, owner: fixture.owner, sessionID: fixture.owner };
    const read = withFixtureHome(fixture, () => readUnattendedRun(lookup));

    assert.deepEqual(read.tally, { kind: "absent" });
    assert.equal(nextStepOf(read).kind, "push");
    assert.equal(bashNetTurn(fixture, fixture.owner), "posted");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

function tallyFileOf(journalFile: string): string {
  return `${journalFile.replace(/\.log$/, "")}.pushes`;
}

function nextStepOf(read: UnattendedRunReading): ContinuationStep {
  return decideContinuation(read).step;
}
