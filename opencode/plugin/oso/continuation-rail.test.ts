import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { mock, test } from "node:test";
import {
  appendJournal,
  journalFileFor,
  DELEGATIONS_RETURN_IN_TURN_HOST,
  PUSHES_WITHOUT_PROGRESS_CAP,
} from "@oso-code/core";
import entry from "../oso-code.ts";
import { fakeHostContext, type FakeHostContext } from "../../test-support/host-context.ts";
import {
  continueUnattendedRun,
  trackSessionEvent,
  type ContinuationOutcome,
  type ContinuationRequest,
} from "./continuation-rail.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";

const CONTINUATION_ORDER = DELEGATIONS_RETURN_IN_TURN_HOST.order;
const CAP_MILESTONE = "auto-continue: cap reached after";

const PRODUCTION_DEPLOY = "vercel --prod";
const RUN_CHANGE = "slice-twelve";

interface PostedTurns {
  orders: string[];
  sessionIDs: string[];
  eachTurn: (turn: number) => Promise<void> | void;
}

function launchedAmidstTheRun(childID: string, parentID: string): void {
  trackSessionEvent({ type: "session.created", data: { sessionID: childID, parentID } });
}

function makeFixture(): RailFixture {
  return seedRailFixture("oso-continuation-rail");
}

function armRun(fixture: RailFixture, pairs: readonly string[]): void {
  armStateUnder(fixture.home, fixture.repo, fixture.owner, [`auto_change=${RUN_CHANGE}`, ...pairs]);
  underFixtureHome(fixture.home, () => appendJournal(journalFileFor(fixture.repo), "the run opened"));
}

function journalOf(fixture: RailFixture): string {
  return underFixtureHome(fixture.home, () => readFileSync(journalFileFor(fixture.repo), "utf8"));
}

function postedTurns(eachTurn: (turn: number) => Promise<void> | void = () => {}): PostedTurns {
  return { orders: [], sessionIDs: [], eachTurn };
}

function admitInto(host: PostedTurns, sessionID: string): ContinuationRequest["admitTurn"] {
  return async (order) => {
    host.sessionIDs.push(sessionID);
    host.orders.push(order);
    await host.eachTurn(host.orders.length);
  };
}

async function driveUntilStood(request: ContinuationRequest): Promise<ContinuationOutcome> {
  for (;;) {
    const outcome = await continueUnattendedRun(request);
    if (outcome.kind !== "admitted") {
      return outcome;
    }
  }
}

function idle(fixture: RailFixture, host: PostedTurns, sessionID: string): Promise<ContinuationOutcome> {
  return underRailFixtureHome(fixture, () => driveUntilStood({
    sessionID,
    directory: fixture.repo,
    admitTurn: admitInto(host, sessionID),
  }));
}

test("an idle turn under an armed run posts the continuation order back into that same session", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-root");
    assert.equal(outcome.kind, "stood-down");
    assert.deepEqual(host.sessionIDs, ["ses-root", "ses-root", "ses-root"]);
    assert.equal(host.orders[0], CONTINUATION_ORDER);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a run nobody armed is left alone, and no turn is posted at all", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=parked"]);
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-root");
    assert.equal(outcome.kind, "stood-down");
    assert.deepEqual(host.orders, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the pushes a stalled run gets are capped, and the cap says so in the journal once", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const first = await idle(fixture, host, "ses-root");
    assert.equal(first.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
    const journalAfterCap = journalOf(fixture);
    assert.match(journalAfterCap, new RegExp(escapeForPattern(CAP_MILESTONE)));

    const second = await idle(fixture, host, "ses-root");
    assert.equal(second.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP, "the cap survives the milestone it journals itself");
    assert.equal(occurrences(journalOf(fixture), CAP_MILESTONE), 1);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the second idle of one turn is dropped while the first is still posting", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    let releaseTheTurn = (): void => {};
    const heldTurn = new Promise<void>((resolve) => {
      releaseTheTurn = resolve;
    });
    const host = postedTurns(() => heldTurn);
    const firstIdle = idle(fixture, host, "ses-root");
    const secondIdle = await idle(fixture, host, "ses-root");
    assert.deepEqual(secondIdle, { kind: "already-driving" });
    releaseTheTurn();
    await firstIdle;
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP, "one driver posted, the double idle added nothing");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a wave child's idle is never mistaken for the run's own turn ending", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    trackSessionEvent({ type: "session.created", data: { sessionID: "ses-child", parentID: "ses-wave-root" } });
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-child");
    assert.deepEqual(outcome, { kind: "not-this-runs-session" });
    assert.deepEqual(host.orders, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a delegation label left armed holds nothing, because only a child session still running holds the run", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_wait=12"]);
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-label-root");
    assert.equal(outcome.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
    assert.equal(host.orders[0], CONTINUATION_ORDER);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child session the run launched and that is still running holds the run's idle: no turn is posted", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    launchedAmidstTheRun("ses-held-child", "ses-held-root");
    const outcome = await idle(fixture, host, "ses-held-root");
    assert.deepEqual(outcome, { kind: "stood-down" });
    assert.deepEqual(host.orders, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child completing re-drives the held run, and a later child completing resets the cap", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    launchedAmidstTheRun("ses-done-child", "ses-done-root");
    await idle(fixture, host, "ses-done-root");
    assert.deepEqual(host.orders, []);
    await underRailFixtureHome(fixture, async () => {
      trackSessionEvent({ type: "session.idle", data: { sessionID: "ses-done-child" } });
      await yieldUntilRailReachesItsCap();
    });
    assert.deepEqual(host.orders, [CONTINUATION_ORDER], "the completed child re-drives the run held on it, once");

    await idle(fixture, host, "ses-done-root");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);

    launchedAmidstTheRun("ses-later-child", "ses-done-root");
    await underRailFixtureHome(fixture, async () => {
      trackSessionEvent({ type: "session.deleted", data: { sessionID: "ses-later-child" } });
    });
    await idle(fixture, host, "ses-done-root");
    assert.equal(host.orders.length, 2 * PUSHES_WITHOUT_PROGRESS_CAP, "the completed child is progress past the cap");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("journal growth between pushes is no progress: a run that only journals stands down at the cap", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const turnsThatJournal = 2 * PUSHES_WITHOUT_PROGRESS_CAP;
    const host = postedTurns((turn) => {
      if (turn <= turnsThatJournal) appendJournal(journalFileFor(fixture.repo), `turn ${turn} wrote a milestone`);
    });
    const outcome = await idle(fixture, host, "ses-journal-root");
    assert.equal(outcome.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const MINUTE_MS = 60_000;
const CHILD_LAUNCHED_AT_MS = Date.parse("2026-09-29T08:00:00Z");

interface StreamedAdvisories {
  messages: string[];
}

const loggedLines: string[] = [];

console.error = (...args: unknown[]) => {
  loggedLines.push(args.map(String).join(" "));
};

function streamedAdvisories(): StreamedAdvisories {
  loggedLines.length = 0;
  return { messages: loggedLines };
}

function idleAt(
  fixture: RailFixture,
  host: PostedTurns,
  sessionID: string,
  minutesAfterLaunch: number,
): Promise<ContinuationOutcome> {
  return underRailFixtureHome(fixture, () => driveUntilStood({
    sessionID,
    directory: fixture.repo,
    admitTurn: admitInto(host, sessionID),
    now: () => CHILD_LAUNCHED_AT_MS + minutesAfterLaunch * MINUTE_MS,
  }));
}

function launchedChild(childID: string, parentID: string): void {
  trackSessionEvent({ type: "session.created", data: { sessionID: childID, parentID } }, CHILD_LAUNCHED_AT_MS);
}

test("a child silent past the silence threshold is reported by its session id and released from the hold", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    launchedChild("ses-silent-child", "ses-silent-root");

    const held = await idleAt(fixture, host, "ses-silent-root", 59);
    assert.deepEqual(held, { kind: "stood-down" });
    assert.equal(advisories.messages.length, 1);
    assert.match(advisories.messages[0] ?? "", /held while child sessions run: ses-silent-child/);

    const released = await idleAt(fixture, host, "ses-silent-root", 61);
    assert.deepEqual(released, { kind: "stood-down" });
    assert.equal(advisories.messages.length, 2);
    assert.match(advisories.messages[1] ?? "", /ses-silent-child stuck: silent 61 min/);
    assert.match(journalOf(fixture), /ses-silent-child stuck: silent 61 min/);

    await idleAt(fixture, host, "ses-silent-root", 62);
    assert.equal(advisories.messages.length, 2, "a child is reported once");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child still active but in flight past the ceiling is reported as long-running and released from the hold", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    launchedChild("ses-long-child", "ses-long-root");
    trackSessionEvent(
      { type: "session.status", data: { sessionID: "ses-long-child" } },
      CHILD_LAUNCHED_AT_MS + 170 * MINUTE_MS,
    );

    const held = await idleAt(fixture, host, "ses-long-root", 179);
    assert.deepEqual(held, { kind: "stood-down" });

    const released = await idleAt(fixture, host, "ses-long-root", 181);
    assert.deepEqual(released, { kind: "stood-down" });
    assert.match(advisories.messages[1] ?? "", /ses-long-child long-running: in flight 181 min/);
    assert.match(journalOf(fixture), /ses-long-child long-running: in flight 181 min/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a stuck child is reported and the hold released by the hold's own timer, with no further idle of the run", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const advisories = streamedAdvisories();
    const host = await pluginOver(fixture);
    await heldOver(fixture, host, "ses-stuck-child", "ses-stuck-root");
    await settledAfter(fixture, () => mock.timers.tick(59 * MINUTE_MS));
    assert.deepEqual(host.prompts(), []);

    await settledAfter(fixture, () => mock.timers.tick(MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-stuck-child stuck: silent 60 min/);
    assert.match(journalOf(fixture), /ses-stuck-child stuck: silent 60 min/);
    assert.deepEqual(host.prompts(), [{ sessionID: "ses-stuck-root", text: CONTINUATION_ORDER }]);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const CHATTER_EVERY_MINUTES = 5;

async function chatteredUntil(
  fixture: RailFixture,
  host: FakeHostContext,
  minutes: number,
  chattering: string,
): Promise<void> {
  for (let elapsed = CHATTER_EVERY_MINUTES; elapsed <= minutes; elapsed += CHATTER_EVERY_MINUTES) {
    await settledAfter(fixture, () => mock.timers.tick(CHATTER_EVERY_MINUTES * MINUTE_MS));
    host.emit({ type: "session.text.delta", data: { sessionID: chattering } });
    await settledAfter(fixture, () => {});
  }
}

async function heldOver(fixture: RailFixture, host: FakeHostContext, childID: string, rootID: string): Promise<void> {
  host.emit({ type: "session.created", data: { sessionID: childID, parentID: rootID } });
  await settledAfter(fixture, () => {});
  await settledAfter(fixture, () => host.hook("session", "experimental.idle")({ sessionID: rootID, background: [] }));
}

test("a child streaming events past the silence threshold stays held, and is reported only once it goes silent", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const advisories = streamedAdvisories();
    const host = await pluginOver(fixture);
    await heldOver(fixture, host, "ses-streaming-child", "ses-streaming-root");
    await chatteredUntil(fixture, host, 100, "ses-streaming-child");
    assert.deepEqual(host.prompts(), []);
    assert.doesNotMatch(advisories.messages.join("\n"), /ses-streaming-child stuck/);

    await settledAfter(fixture, () => mock.timers.tick(59 * MINUTE_MS));
    assert.deepEqual(host.prompts(), []);
    await settledAfter(fixture, () => mock.timers.tick(MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-streaming-child stuck: silent 60 min/);
    assert.equal(host.prompts().length, 1);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child working through events stays held until it crosses the in-flight ceiling", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const advisories = streamedAdvisories();
    const host = await pluginOver(fixture);
    await heldOver(fixture, host, "ses-working-child", "ses-working-root");
    await chatteredUntil(fixture, host, 175, "ses-working-child");
    assert.deepEqual(host.prompts(), []);
    assert.doesNotMatch(advisories.messages.join("\n"), /ses-working-child (stuck|long-running)/);

    await settledAfter(fixture, () => mock.timers.tick(CHATTER_EVERY_MINUTES * MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-working-child long-running: in flight 180 min/);
    assert.equal(host.prompts().length, 1);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the Cleanup clears a held run's timer, so no turn is posted past the threshold", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = await pluginOver(fixture);
    const cleanup = await entry.setup(host.context);
    await heldOver(fixture, host, "ses-disposed-child", "ses-disposed-root");
    await settledAfter(fixture, () => cleanup());
    await settledAfter(fixture, () => mock.timers.tick(181 * MINUTE_MS));
    assert.deepEqual(host.prompts(), []);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a new commit on the run branch between pushes is progress and earns the run one more push", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns((turn) => {
      if (turn === 1) committedInto(fixture.repo);
    });
    const outcome = await idle(fixture, host, "ses-commit-root");
    assert.equal(outcome.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP + 1);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the order this host is handed names the report the launch returned, never a notification it never sends", () => {
  assert.match(CONTINUATION_ORDER, /read the report the launch itself returned/);
  assert.doesNotMatch(CONTINUATION_ORDER, /do NOT relaunch it/);
});

test("the plugin's own idle hook drives the rail, and a denied production deploy does not stop it", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = await pluginOver(fixture);

    const denial = await underRailFixtureHome(fixture, async () => {
      try {
        await host.hook("tool", "execute.before")({
          tool: "shell",
          sessionID: "ses-root",
          agent: "build",
          messageID: "msg-1",
          id: "call-1",
          input: { command: PRODUCTION_DEPLOY },
        });
        return "allowed";
      } catch (error) {
        return (error as Error).message;
      }
    });
    assert.match(denial, /a production deploy stays with the operator/);

    await settledAfter(fixture, () => host.hook("session", "experimental.idle")({ sessionID: "ses-root", background: [] }));
    assert.deepEqual(host.prompts(), [{ sessionID: "ses-root", text: CONTINUATION_ORDER }], "the denied deploy left the continuation rail armed");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

async function pluginOver(fixture: RailFixture): Promise<FakeHostContext> {
  const host = fakeHostContext({ directory: fixture.repo, defaultSessionDirectory: fixture.repo });
  await entry.setup(host.context);
  return host;
}

async function settledAfter(fixture: RailFixture, act: () => unknown): Promise<void> {
  await underRailFixtureHome(fixture, async () => {
    await act();
    await yieldUntilRailReachesItsCap();
  });
}

function committedInto(repo: string): void {
  const committed = spawnSync(
    "git",
    ["-C", repo, "-c", "user.name=oso", "-c", "user.email=oso@oso-code.invalid", "-c", "commit.gpgsign=false",
      "commit", "--allow-empty", "-qm", "the run landed a slice"],
    { encoding: "utf8" },
  );
  assert.equal(committed.status, 0, committed.stderr);
}

const TICKS_THE_RAIL_NEEDS_TO_REACH_ITS_CAP = 50;

async function yieldUntilRailReachesItsCap(): Promise<void> {
  for (let tick = 0; tick < TICKS_THE_RAIL_NEEDS_TO_REACH_ITS_CAP; tick += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
