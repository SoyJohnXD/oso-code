import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendJournal,
  journalFileFor,
  DELEGATIONS_RETURN_IN_TURN_HOST,
  PUSHES_WITHOUT_PROGRESS_CAP,
} from "@oso-code/core";
import { osoCode } from "../oso-code.ts";
import { continueUnattendedRun, recordSessionLineage, type ContinuationOutcome } from "./continuation-rail.ts";
import { deriveRootId } from "./identity.ts";
import { armStateUnder, underFixtureHome, underFixtureHomeAsync } from "../../test-support/state-fixture.ts";
import type { HostSessionApi } from "./wave.ts";

const CONTINUATION_ORDER = DELEGATIONS_RETURN_IN_TURN_HOST.order;
const CAP_MILESTONE = "auto-continue: cap reached after";

const PRODUCTION_DEPLOY = "vercel --prod";
const RUN_CHANGE = "slice-twelve";

type LooseHooks = Record<string, (input?: unknown, output?: unknown) => unknown>;

interface Fixture {
  base: string;
  repo: string;
  home: string;
  owner: string;
}

interface PostedTurns {
  session: HostSessionApi;
  orders: string[];
  sessionIDs: string[];
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "oso-continuation-rail-"));
  const repo = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  const init = spawnSync("git", ["init", "-b", "main"], { cwd: repo, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr ?? "");
  return { base, repo, home, owner: deriveRootId(repo) };
}

function armRun(fixture: Fixture, pairs: readonly string[]): void {
  armStateUnder(fixture.home, fixture.repo, fixture.owner, [`auto_change=${RUN_CHANGE}`, ...pairs]);
  underFixtureHome(fixture.home, () => appendJournal(journalFileFor(fixture.repo), "the run opened"));
}

function journalOf(fixture: Fixture): string {
  return underFixtureHome(fixture.home, () => readFileSync(journalFileFor(fixture.repo), "utf8"));
}

function withFixtureHome<T>(fixture: Fixture, run: () => Promise<T>): Promise<T> {
  return underFixtureHomeAsync(fixture.home, run);
}

function postedTurns(holdEachTurn?: Promise<void>): PostedTurns {
  const orders: string[] = [];
  const sessionIDs: string[] = [];
  const session: HostSessionApi = {
    create: async () => ({ data: { id: "ses-unused", directory: "" } }),
    prompt: async (options) => {
      sessionIDs.push(options.path.id);
      orders.push(options.body.parts.map((part) => part.text).join("\n"));
      await holdEachTurn;
      return { data: { parts: [{ type: "text", text: "status: done" }] } };
    },
    abort: async () => ({ data: true }),
  };
  return { session, orders, sessionIDs };
}

function idle(fixture: Fixture, host: PostedTurns, sessionID: string): Promise<ContinuationOutcome> {
  return withFixtureHome(fixture, () => continueUnattendedRun({
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
    const host = postedTurns(heldTurn);
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
    recordSessionLineage({ sessionID: "ses-child", info: { id: "ses-child", parentID: "ses-root" } });
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-child");
    assert.deepEqual(outcome, { kind: "not-this-runs-session" });
    assert.deepEqual(host.orders, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a delegation label left armed holds nothing here, because a delegation on this host returned in its own turn", async () => {
  const fixture = makeFixture();
  try {
    armRun(fixture, ["auto=running", "auto_wait=12"]);
    const host = postedTurns();
    const outcome = await idle(fixture, host, "ses-root");
    assert.equal(outcome.kind, "stood-down");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
    assert.equal(host.orders[0], CONTINUATION_ORDER);
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
    const outcome = await withFixtureHome(fixture, () => continueUnattendedRun({
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

    const denial = await withFixtureHome(fixture, async () => {
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

    await withFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-root" } } });
      await yieldUntilRailReachesItsCap();
    });
    assert.equal(host.orders[0], CONTINUATION_ORDER, "the denied deploy left the continuation rail armed");
    assert.equal(host.orders.length, PUSHES_WITHOUT_PROGRESS_CAP);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

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
