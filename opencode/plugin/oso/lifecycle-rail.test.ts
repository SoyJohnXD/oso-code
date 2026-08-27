import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { osoCode } from "../oso-code.ts";
import { publishIdentity } from "./identity.ts";

const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugin/hooks");
const STATE_BIN = resolve(HOOKS_DIR, "..", "bin", "oso-state");
process.env.OSO_HOOKS_DIR = HOOKS_DIR;

type LooseHooks = Record<string, (input?: unknown, output?: unknown) => unknown>;

interface Fixture {
  base: string;
  repo: string;
  home: string;
  identity: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "oso-lifecycle-rail-"));
  const repo = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  const init = spawnSync("git", ["init", "-b", "main"], { cwd: repo, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr ?? "");
  return { base, repo, home, identity: publishIdentity(repo).OSO_AGENT };
}

function armState(fixture: Fixture, session: string, pairs: readonly string[]): void {
  const result = spawnSync(STATE_BIN, ["--session", session, "set", ...pairs], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...process.env, HOME: fixture.home },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
}

function stateFilesOf(fixture: Fixture): string[] {
  const stateDir = join(fixture.home, ".local", "state", "oso-code");
  if (!existsSync(stateDir)) {
    return [];
  }
  return readdirSync(stateDir).filter((entry) => entry.endsWith(".state"));
}

async function withFixtureHome<T>(fixture: Fixture, run: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    return await run();
  } finally {
    process.env.HOME = previous;
  }
}

async function railFor(fixture: Fixture): Promise<LooseHooks> {
  return (await osoCode({ directory: fixture.repo })) as unknown as LooseHooks;
}

async function systemPromptAfter(
  fixture: Fixture,
  hooks: LooseHooks,
  sessionID: string,
): Promise<string[]> {
  const output = { system: ["you are a harness"] };
  await withFixtureHome(fixture, async () => {
    await hooks["experimental.chat.system.transform"]!({ sessionID }, output);
  });
  return output.system;
}

test("the stale gate's own words reach the model through the system prompt", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, "a-session-that-is-not-this-one", ["mode=plan"]);
    const hooks = await railFor(fixture);
    const system = await systemPromptAfter(fixture, hooks, "ses-stale-fires");
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
    armState(fixture, fixture.identity, ["mode=plan"]);
    const hooks = await railFor(fixture);
    const system = await systemPromptAfter(fixture, hooks, "ses-stale-silent");
    assert.deepEqual(system, ["you are a harness"]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the advisory rides every prompt of the turn and stops when the session goes idle", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, "a-session-that-is-not-this-one", ["mode=plan"]);
    const hooks = await railFor(fixture);
    const discarded = await systemPromptAfter(fixture, hooks, "ses-stale-turn");
    assert.equal(discarded.length, 2, "the prompt the host discards carries the advisory");
    const sent = await systemPromptAfter(fixture, hooks, "ses-stale-turn");
    assert.equal(sent.length, 2, "so does the prompt the host actually sends");
    await withFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-stale-turn" } } });
    });
    const afterIdle = await systemPromptAfter(fixture, hooks, "ses-stale-turn");
    assert.deepEqual(afterIdle, ["you are a harness"], "the turn it was queued for is over");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a compaction on the bus puts the re-anchor gate's text on the next system prompt", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.identity, ["mode=plan", "active_slice=s1"]);
    const hooks = await railFor(fixture);
    const beforeCompaction = await systemPromptAfter(fixture, hooks, "ses-compacted");
    assert.deepEqual(beforeCompaction, ["you are a harness"]);
    await withFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.compacted", properties: { sessionID: "ses-compacted" } } });
    });
    const afterCompaction = await systemPromptAfter(fixture, hooks, "ses-compacted");
    assert.equal(afterCompaction.length, 2);
    assert.match(afterCompaction[1]!, /compacted while a run was in flight/);
    await withFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-compacted" } } });
    });
    assert.deepEqual(await systemPromptAfter(fixture, hooks, "ses-compacted"), ["you are a harness"]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("dispose runs the teardown gate and drops the state the scope's sessions armed", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.identity, ["mode=plan"]);
    assert.equal(stateFilesOf(fixture).length, 1, "the fixture armed a state file to tear down");
    const hooks = await railFor(fixture);
    await withFixtureHome(fixture, async () => {
      await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-teardown" } } });
      await hooks.dispose!();
    });
    assert.deepEqual(stateFilesOf(fixture), [], "the teardown gate removed the state file at scope close");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("dispose with no session on the bus leaves the repository's state alone", async () => {
  const fixture = makeFixture();
  try {
    armState(fixture, fixture.identity, ["mode=plan"]);
    const hooks = await railFor(fixture);
    await withFixtureHome(fixture, async () => {
      await hooks.dispose!();
    });
    assert.equal(stateFilesOf(fixture).length, 1);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
