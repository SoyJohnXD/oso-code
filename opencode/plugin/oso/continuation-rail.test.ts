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
import { osoCode } from "../oso-code.ts";
import {
  continueUnattendedRun,
  trackSessionEvent,
  type ContinuationOutcome,
  type SessionEvent,
} from "./continuation-rail.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";
import type { HostSessionApi } from "./wave.ts";

const CONTINUATION_ORDER = DELEGATIONS_RETURN_IN_TURN_HOST.order;
const CAP_MILESTONE = "auto-continue: cap reached after";

const PRODUCTION_DEPLOY = "vercel --prod";
const RUN_CHANGE = "slice-twelve";

type LooseHooks = Record<string, (input?: unknown, output?: unknown) => unknown>;

interface PostedTurns {
  session: HostSessionApi;
  orders: string[];
  sessionIDs: string[];
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
  const orders: string[] = [];
  const sessionIDs: string[] = [];
  const session: HostSessionApi = {
    create: async () => ({ data: { id: "ses-unused", directory: "" } }),
    prompt: async (options) => {
      sessionIDs.push(options.path.id);
      orders.push(options.body.parts.map((part) => part.text).join("\n"));
      await eachTurn(orders.length);
      return { data: { parts: [{ type: "text", text: "status: done" }] } };
    },
    abort: async () => ({ data: true }),
  };
  return { session, orders, sessionIDs };
}

function idle(fixture: RailFixture, host: PostedTurns, sessionID: string): Promise<ContinuationOutcome> {
  return underRailFixtureHome(fixture, () => continueUnattendedRun({
    sessionID,
    directory: fixture.repo,
    session: host.session,
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
    assert.equal(first.kind === "stood-down" ? first.turns : -1, PUSHES_WITHOUT_PROGRESS_CAP);
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
    trackSessionEvent({ type: "session.created", properties: { info: { id: "ses-child", parentID: "ses-wave-root" } } });
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
    const hooks = await pluginOver(fixture, host);
    await announced(fixture, hooks, "session.created", { info: { id: "ses-held-child", parentID: "ses-held-root" } });
    const outcome = await idle(fixture, host, "ses-held-root");
    assert.deepEqual(outcome, { kind: "stood-down", turns: 0 });
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
    const hooks = await pluginOver(fixture, host);
    await announced(fixture, hooks, "session.created", { info: { id: "ses-done-child", parentID: "ses-done-root" } });
    await idle(fixture, host, "ses-done-root");
    await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-done-child" } } }));
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);

    await announced(fixture, hooks, "session.created", { info: { id: "ses-later-child", parentID: "ses-done-root" } });
    await announced(fixture, hooks, "session.deleted", { sessionID: "ses-later-child", info: { id: "ses-later-child" } });
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
  client: { tui: { showToast: (toast: unknown) => void } };
  messages: string[];
}

function streamedAdvisories(): StreamedAdvisories {
  const messages: string[] = [];
  const client = {
    tui: {
      showToast: (toast: unknown) => {
        messages.push((toast as { body: { message: string } }).body.message);
      },
    },
  };
  return { client, messages };
}

function idleAt(
  fixture: RailFixture,
  host: PostedTurns,
  sessionID: string,
  minutesAfterLaunch: number,
  advisories: StreamedAdvisories,
): Promise<ContinuationOutcome> {
  return underRailFixtureHome(fixture, () => continueUnattendedRun({
    sessionID,
    directory: fixture.repo,
    session: host.session,
    client: advisories.client,
    now: () => CHILD_LAUNCHED_AT_MS + minutesAfterLaunch * MINUTE_MS,
  }));
}

function launchedChild(childID: string, parentID: string): void {
  trackSessionEvent({ type: "session.created", properties: { info: { id: childID, parentID } } }, CHILD_LAUNCHED_AT_MS);
}

test("a child silent past the silence threshold is reported by its session id and released from the hold", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    launchedChild("ses-silent-child", "ses-silent-root");

    const held = await idleAt(fixture, host, "ses-silent-root", 59, advisories);
    assert.deepEqual(held, { kind: "stood-down", turns: 0 });
    assert.equal(advisories.messages.length, 1);
    assert.match(advisories.messages[0] ?? "", /held while child sessions run: ses-silent-child/);

    const released = await idleAt(fixture, host, "ses-silent-root", 61, advisories);
    assert.deepEqual(released, { kind: "stood-down", turns: PUSHES_WITHOUT_PROGRESS_CAP });
    assert.equal(advisories.messages.length, 2);
    assert.match(advisories.messages[1] ?? "", /ses-silent-child stuck: silent 61 min/);
    assert.match(journalOf(fixture), /ses-silent-child stuck: silent 61 min/);

    await idleAt(fixture, host, "ses-silent-root", 62, advisories);
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
      { type: "session.status", properties: { sessionID: "ses-long-child", status: { type: "busy" } } },
      CHILD_LAUNCHED_AT_MS + 170 * MINUTE_MS,
    );

    const held = await idleAt(fixture, host, "ses-long-root", 179, advisories);
    assert.deepEqual(held, { kind: "stood-down", turns: 0 });

    const released = await idleAt(fixture, host, "ses-long-root", 181, advisories);
    assert.deepEqual(released, { kind: "stood-down", turns: PUSHES_WITHOUT_PROGRESS_CAP });
    assert.match(advisories.messages[1] ?? "", /ses-long-child long-running: in flight 181 min/);
    assert.match(journalOf(fixture), /ses-long-child long-running: in flight 181 min/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a held run is re-driven by its child completing through the plugin's own event hook, with no further idle of the run", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    const hooks = await pluginOver(fixture, host, advisories);
    await announced(fixture, hooks, "session.created", { info: { id: "ses-woken-child", parentID: "ses-woken-root" } });
    await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-woken-root" } } }));
    assert.deepEqual(host.orders, []);
    assert.match(advisories.messages.join("\n"), /held while child sessions run: ses-woken-child/);

    await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-woken-child" } } }));
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
    assert.deepEqual([...new Set(host.sessionIDs)], ["ses-woken-root"]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a stuck child is reported and the hold released by the hold's own timer, with no further idle of the run", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    const hooks = await pluginOver(fixture, host, advisories);
    await announced(fixture, hooks, "session.created", { info: { id: "ses-stuck-child", parentID: "ses-stuck-root" } });
    await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-stuck-root" } } }));
    await settledAfter(fixture, () => mock.timers.tick(59 * MINUTE_MS));
    assert.deepEqual(host.orders, []);

    await settledAfter(fixture, () => mock.timers.tick(MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-stuck-child stuck: silent 60 min/);
    assert.match(journalOf(fixture), /ses-stuck-child stuck: silent 60 min/);
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const CHATTER_EVERY_MINUTES = 5;

async function chatteredUntil(
  fixture: RailFixture,
  hooks: LooseHooks,
  minutes: number,
  event: SessionEvent,
): Promise<void> {
  for (let elapsed = CHATTER_EVERY_MINUTES; elapsed <= minutes; elapsed += CHATTER_EVERY_MINUTES) {
    await settledAfter(fixture, () => mock.timers.tick(CHATTER_EVERY_MINUTES * MINUTE_MS));
    await settledAfter(fixture, () => hooks.event!({ event }));
  }
}

async function heldOver(fixture: RailFixture, hooks: LooseHooks, childID: string, rootID: string): Promise<void> {
  await announced(fixture, hooks, "session.created", { info: { id: childID, parentID: rootID } });
  await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: rootID } } }));
}

test("a child streaming message parts past the silence threshold stays held, and is reported only once it goes silent", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    const hooks = await pluginOver(fixture, host, advisories);
    await heldOver(fixture, hooks, "ses-streaming-child", "ses-streaming-root");
    await chatteredUntil(fixture, hooks, 100, {
      type: "message.part.updated",
      properties: { part: { id: "prt-streaming", messageID: "msg-streaming", sessionID: "ses-streaming-child" } },
    });
    assert.deepEqual(host.orders, []);
    assert.doesNotMatch(advisories.messages.join("\n"), /ses-streaming-child stuck/);

    await settledAfter(fixture, () => mock.timers.tick(59 * MINUTE_MS));
    assert.deepEqual(host.orders, []);
    await settledAfter(fixture, () => mock.timers.tick(MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-streaming-child stuck: silent 60 min/);
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child updating its messages stays held until it crosses the in-flight ceiling", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    const hooks = await pluginOver(fixture, host, advisories);
    await heldOver(fixture, hooks, "ses-working-child", "ses-working-root");
    await chatteredUntil(fixture, hooks, 175, {
      type: "message.updated",
      properties: { info: { id: "msg-working", sessionID: "ses-working-child", role: "assistant" } },
    });
    assert.deepEqual(host.orders, []);
    assert.doesNotMatch(advisories.messages.join("\n"), /ses-working-child (stuck|long-running)/);

    await settledAfter(fixture, () => mock.timers.tick(CHATTER_EVERY_MINUTES * MINUTE_MS));
    assert.match(advisories.messages.join("\n"), /ses-working-child long-running: in flight 180 min/);
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the parent's own message events are no activity of its child, even one whose message id reads like the child", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const advisories = streamedAdvisories();
    const hooks = await pluginOver(fixture, host, advisories);
    await heldOver(fixture, hooks, "ses-quiet-child", "ses-chatty-root");
    await chatteredUntil(fixture, hooks, 55, {
      type: "message.updated",
      properties: { info: { id: "ses-quiet-child", sessionID: "ses-chatty-root", role: "assistant" } },
    });
    await chatteredUntil(fixture, hooks, 5, {
      type: "message.part.updated",
      properties: { part: { id: "prt-root", messageID: "ses-quiet-child", sessionID: "ses-chatty-root" } },
    });
    assert.match(advisories.messages.join("\n"), /ses-quiet-child stuck: silent 60 min/);
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    mock.timers.reset();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("disposing the plugin clears a held run's timer, so no turn is posted past the threshold", async () => {
  const fixture = makeFixture();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: CHILD_LAUNCHED_AT_MS });
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const hooks = await pluginOver(fixture, host);
    await announced(fixture, hooks, "session.created", { info: { id: "ses-disposed-child", parentID: "ses-disposed-root" } });
    await settledAfter(fixture, () => hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-disposed-root" } } }));
    await settledAfter(fixture, () => hooks.dispose!());
    await settledAfter(fixture, () => mock.timers.tick(181 * MINUTE_MS));
    assert.deepEqual(host.orders, []);
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

test("a host that hands the plugin no session api leaves the run standing instead of throwing", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const outcome = await underRailFixtureHome(fixture, () => continueUnattendedRun({
      sessionID: "ses-root",
      directory: fixture.repo,
    }));
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /no session api/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the plugin's own idle event drives the rail, and a denied production deploy does not stop it", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running"]);
    const host = postedTurns();
    const hooks = (await osoCode({
      directory: fixture.repo,
      client: { session: host.session },
    })) as unknown as LooseHooks;

    const denial = await underRailFixtureHome(fixture, async () => {
      try {
        await hooks["tool.execute.before"]!(
          { tool: "bash", sessionID: "ses-root", cwd: fixture.repo },
          { args: { command: PRODUCTION_DEPLOY } },
        );
        return "allowed";
      } catch (error) {
        return (error as Error).message;
      }
    });
    assert.match(denial, /a production deploy stays with the operator/);

    await underRailFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-root" } } });
      await yieldUntilRailReachesItsCap();
    });
    assert.equal(host.orders[0], CONTINUATION_ORDER, "the denied deploy left the continuation rail armed");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

async function pluginOver(
  fixture: RailFixture,
  host: PostedTurns,
  advisories: StreamedAdvisories = streamedAdvisories(),
): Promise<LooseHooks> {
  const client = { session: host.session, tui: advisories.client.tui };
  return (await osoCode({ directory: fixture.repo, client })) as unknown as LooseHooks;
}

async function settledAfter(fixture: RailFixture, act: () => unknown): Promise<void> {
  await underRailFixtureHome(fixture, async () => {
    await act();
    await yieldUntilRailReachesItsCap();
  });
}

async function announced(
  fixture: RailFixture,
  hooks: LooseHooks,
  type: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await underRailFixtureHome(fixture, async () => {
    await hooks.event!({ event: { type, properties } });
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
