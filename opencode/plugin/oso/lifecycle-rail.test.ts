import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import entry from "../oso-code.ts";
import { fakeHostContext, type FakeHostContext } from "../../test-support/host-context.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder } from "../../test-support/state-fixture.ts";

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugin/hooks");
process.env.OSO_HOOKS_DIR = HOOKS_DIR;

function makeFixture(): RailFixture {
  return seedRailFixture("oso-lifecycle-rail");
}

function armState(fixture: RailFixture, session: string, pairs: readonly string[]): void {
  armStateUnder(fixture.home, fixture.repo, session, pairs);
}

function stateFilesOf(fixture: RailFixture): string[] {
  const stateDir = join(fixture.home, ".local", "state", "oso-code");
  if (!existsSync(stateDir)) {
    return [];
  }
  return readdirSync(stateDir).filter((entry) => entry.endsWith(".state"));
}

interface Rail {
  host: FakeHostContext;
  cleanup: () => void;
}

async function railFor(fixture: RailFixture): Promise<Rail> {
  const host = fakeHostContext({ directory: fixture.repo, defaultSessionDirectory: fixture.repo });
  const cleanup = await entry.setup(host.context);
  return { host, cleanup };
}

async function idleOn(fixture: RailFixture, rail: Rail, sessionID: string): Promise<void> {
  await underRailFixtureHome(fixture, () => rail.host.hook("session", "experimental.idle")({ sessionID, background: [] }));
}

async function systemPromptAfter(
  fixture: RailFixture,
  rail: Rail,
  sessionID: string,
): Promise<string[]> {
  const output = { sessionID, system: [{ type: "text", text: "you are a harness" }] };
  await underRailFixtureHome(fixture, () => rail.host.hook("session", "context")(output));
  return output.system.map((part) => part.text);
}

test("the stale gate's own words reach the model through the system prompt", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, "a-session-that-is-not-this-one", ["mode=plan"]);
    const rail = await railFor(fixture);
    const system = await systemPromptAfter(fixture, rail, "ses-stale-fires");
    assert.equal(system.length, 2, "the gate's advisory is appended to the prompt the host handed over");
    assert.match(system[1]!, /was left by another session/);
    assert.match(system[1]!, /oso-code/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the stale gate stays silent for state this host's own identity armed", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan"]);
    const rail = await railFor(fixture);
    const system = await systemPromptAfter(fixture, rail, "ses-stale-silent");
    assert.deepEqual(system, ["you are a harness"]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the advisory rides every prompt of the turn and stops when the session goes idle", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, "a-session-that-is-not-this-one", ["mode=plan"]);
    const rail = await railFor(fixture);
    const discarded = await systemPromptAfter(fixture, rail, "ses-stale-turn");
    assert.equal(discarded.length, 2, "the prompt the host discards carries the advisory");
    const sent = await systemPromptAfter(fixture, rail, "ses-stale-turn");
    assert.equal(sent.length, 2, "so does the prompt the host actually sends");
    await idleOn(fixture, rail, "ses-stale-turn");
    const afterIdle = await systemPromptAfter(fixture, rail, "ses-stale-turn");
    assert.deepEqual(afterIdle, ["you are a harness"], "the turn it was queued for is over");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

async function compactionContextAfter(
  fixture: RailFixture,
  rail: Rail,
  sessionID: string,
): Promise<string[]> {
  const output = { sessionID, system: [] as Array<{ type: string; text: string }> };
  await underRailFixtureHome(fixture, () => rail.host.hook("session", "compaction")(output));
  return output.system.map((part) => part.text);
}

test("the compaction hook hands the re-anchor gate's text to the compaction itself", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan", "active_slice=s1"]);
    const rail = await railFor(fixture);
    const context = await compactionContextAfter(fixture, rail, "ses-compacting");
    assert.equal(context.length, 1);
    assert.match(context[0]!, /compacted while a run was in flight/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the compaction hook re-anchors an unattended run in flight", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan", "auto=running"]);
    const rail = await railFor(fixture);
    const context = await compactionContextAfter(fixture, rail, "ses-compacting-auto");
    assert.equal(context.length, 1);
    assert.match(context[0]!, /This run is unattended and still in flight/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("with no run in flight the compaction hook adds nothing to the compaction", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan"]);
    const rail = await railFor(fixture);
    assert.deepEqual(await compactionContextAfter(fixture, rail, "ses-idle-compacting"), []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the Cleanup runs the teardown gate and drops the state the scope's sessions armed", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan"]);
    assert.equal(stateFilesOf(fixture).length, 1, "the fixture armed a state file to tear down");
    const rail = await railFor(fixture);
    rail.host.emit({ type: "session.created", data: { sessionID: "ses-teardown" } });
    await new Promise((resolve) => setImmediate(resolve));
    await underRailFixtureHome(fixture, async () => rail.cleanup());
    assert.deepEqual(stateFilesOf(fixture), [], "the teardown gate removed the state file at scope close");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the Cleanup with no session on the bus leaves the repository's state alone", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.owner, ["mode=plan"]);
    const rail = await railFor(fixture);
    await underRailFixtureHome(fixture, async () => rail.cleanup());
    assert.equal(stateFilesOf(fixture).length, 1);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
