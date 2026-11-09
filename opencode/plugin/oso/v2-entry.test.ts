import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import entry from "../oso-code.ts";
import { fakeHostContext } from "../../test-support/host-context.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder } from "../../test-support/state-fixture.ts";
import { publishIdentity } from "./identity.ts";
import { stateBinPath } from "./installed-tree.ts";

const COMMIT_CALL = { command: "git commit -m x" };

function armedFixture(label: string, verifyGreen: boolean): RailFixture {
  const fixture = seedRailFixture(label);
  armStateUnder(fixture.home, fixture.repo, fixture.owner, ["mode=plan", "active_slice=4", `verify_green=${verifyGreen}`]);
  return fixture;
}

function executeBefore(sessionID: string, tool: string, input: unknown): Record<string, unknown> {
  return { tool, sessionID, agent: "build", messageID: "msg-1", id: "call-1", input };
}

test("the default export is the v2 definition with the plugin's id and a setup function", () => {
  assert.equal(entry.id, "oso-code");
  assert.equal(typeof entry.setup, "function");
});

test("the gate hook refuses a commit-shaped call with the gate's own message while verify_green is false", async () => {
  const fixture = armedFixture("oso-v2-gate-red", false);
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-red": fixture.repo } });
    await entry.setup(host.context);
    const refusal = await underRailFixtureHome(fixture, async () => {
      try {
        await host.hook("tool", "execute.before")(executeBefore("ses-red", "shell", COMMIT_CALL));
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    });
    assert.match(refusal ?? "", /oso-code/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the gate hook lets the same commit-shaped call through once verify_green is true", async () => {
  const fixture = armedFixture("oso-v2-gate-green", true);
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-green": fixture.repo } });
    await entry.setup(host.context);
    await underRailFixtureHome(fixture, () =>
      host.hook("tool", "execute.before")(executeBefore("ses-green", "shell", COMMIT_CALL)));
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the gate judges the directory of the calling session's record, never the one the plugin was set up in", async () => {
  const red = armedFixture("oso-v2-multi-red", false);
  const unarmed = seedRailFixture("oso-v2-multi-open");
  try {
    const host = fakeHostContext({
      directory: unarmed.repo,
      sessionDirectories: { "ses-red": red.repo, "ses-open": unarmed.repo },
    });
    await entry.setup(host.context);
    const gate = host.hook("tool", "execute.before");
    await underRailFixtureHome(red, async () => {
      await assert.rejects(gate(executeBefore("ses-red", "shell", COMMIT_CALL)), /oso-code/);
      await gate(executeBefore("ses-open", "shell", COMMIT_CALL));
      await assert.rejects(gate(executeBefore("ses-red", "shell", COMMIT_CALL)), /oso-code/);
    });
    assert.deepEqual(host.sessionLookups(), ["ses-red", "ses-open"]);
  } finally {
    rmSync(red.base, { recursive: true, force: true });
    rmSync(unarmed.base, { recursive: true, force: true });
  }
});

test("a session the host cannot resolve falls back to the directory the plugin was set up in", async () => {
  const fixture = armedFixture("oso-v2-gate-fallback", false);
  try {
    const host = fakeHostContext({ directory: fixture.repo });
    await entry.setup(host.context);
    await underRailFixtureHome(fixture, () =>
      assert.rejects(host.hook("tool", "execute.before")(executeBefore("ses-unknown", "shell", COMMIT_CALL)), /oso-code/));
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("shell create.before publishes the identity variables and OSO_STATE_BIN derived from the payload's cwd", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-v2-shell-"));
  try {
    const host = fakeHostContext({ directory: cwd });
    await entry.setup(host.context);
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    await host.hook("shell", "create.before")({ command: "echo", cwd, timeout: 1, shell: "sh", env });
    assert.deepEqual(env, { PATH: "/usr/bin", ...publishIdentity(cwd), OSO_STATE_BIN: stateBinPath() });
    assert.notEqual(env.OSO_AGENT, "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
