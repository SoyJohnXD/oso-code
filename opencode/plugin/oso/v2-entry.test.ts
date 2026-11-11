import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import entry from "../oso-code.ts";
import { fakeHostContext } from "../../test-support/host-context.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";
import { spawnSync } from "node:child_process";
import { DELEGATIONS_RETURN_IN_TURN_HOST, readValue, sha256Hex, stateFileFor } from "@oso-code/core";
import { trackSessionEvent } from "./continuation-rail.ts";
import { commonDirOf, publishIdentity } from "./identity.ts";
import { markerPath, readMarker, touchMarker } from "./lifecycle.ts";
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

test("a shell create.before that cannot publish the identity is traced under the hook's own name and never thrown", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-v2-shell-trace-"));
  const traced = mock.method(console, "error", () => {});
  try {
    const host = fakeHostContext({ directory: cwd });
    await entry.setup(host.context);
    await host.hook("shell", "create.before")({ command: "echo", cwd: undefined, timeout: 1, shell: "sh", env: {} });
    assert.match(String(traced.mock.calls[0]?.arguments[0]), /^oso-code: \[advisory\] create\.before: /);
  } finally {
    traced.mock.restore();
    rmSync(cwd, { recursive: true, force: true });
  }
});

const CONTINUATION_ORDER = DELEGATIONS_RETURN_IN_TURN_HOST.order;
const SYSTEM_ADVICE = /was left by another session/;
const REANCHOR_ADVICE = /compacted while a run was in flight/;

function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function unattendedFixture(label: string): RailFixture {
  const fixture = seedRailFixture(label);
  armStateUnder(fixture.home, fixture.repo, fixture.owner, ["auto_change=slice-twelve", "auto=running"]);
  return fixture;
}

test("an idle primary session under an unattended run admits one continuation turn into that session", async () => {
  const fixture = unattendedFixture("oso-v2-idle-run");
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-idle": fixture.repo } });
    await entry.setup(host.context);
    await underRailFixtureHome(fixture, () => host.hook("session", "experimental.idle")({ sessionID: "ses-idle", background: [] }));
    assert.deepEqual(host.prompts(), [{ sessionID: "ses-idle", text: CONTINUATION_ORDER }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("an idle child session and an idle session no run claims admit nothing", async () => {
  const fixture = unattendedFixture("oso-v2-idle-quiet");
  const unarmed = seedRailFixture("oso-v2-idle-unarmed");
  try {
    const host = fakeHostContext({
      directory: fixture.repo,
      sessionDirectories: { "ses-child": fixture.repo, "ses-open": unarmed.repo },
      parentSessions: { "ses-child": "ses-parent" },
    });
    await entry.setup(host.context);
    await underRailFixtureHome(fixture, () => host.hook("session", "experimental.idle")({ sessionID: "ses-child", background: [] }));
    await underRailFixtureHome(unarmed, () => host.hook("session", "experimental.idle")({ sessionID: "ses-open", background: [] }));
    assert.deepEqual(host.prompts(), []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
    rmSync(unarmed.base, { recursive: true, force: true });
  }
});

test("the context hook appends system advice for a primary session and leaves a child session's request alone", async () => {
  const fixture = seedRailFixture("oso-v2-context");
  armStateUnder(fixture.home, fixture.repo, "left-by-another", ["auto_change=slice-twelve", "auto=running"]);
  try {
    const host = fakeHostContext({
      directory: fixture.repo,
      sessionDirectories: { "ses-primary": fixture.repo, "ses-child": fixture.repo },
      parentSessions: { "ses-child": "ses-primary" },
    });
    await entry.setup(host.context);
    const primary = { sessionID: "ses-primary", system: [] as unknown[] };
    const child = { sessionID: "ses-child", system: [] as unknown[] };
    await underRailFixtureHome(fixture, async () => {
      await host.hook("session", "context")(primary);
      await host.hook("session", "context")(child);
    });
    assert.equal(primary.system.length, 1);
    assert.match((primary.system[0] as { type: string; text: string }).text, SYSTEM_ADVICE);
    assert.equal((primary.system[0] as { type: string }).type, "text");
    assert.deepEqual(child.system, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the compaction hook writes the re-anchor into the compaction request, and the context hook never does", async () => {
  const fixture = armedFixture("oso-v2-compaction", false);
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-compact": fixture.repo } });
    await entry.setup(host.context);
    const compaction = { sessionID: "ses-compact", system: [] as unknown[] };
    const context = { sessionID: "ses-compact", system: [] as unknown[] };
    await underRailFixtureHome(fixture, async () => {
      await host.hook("session", "compaction")(compaction);
      await host.hook("session", "context")(context);
    });
    assert.equal(compaction.system.length, 1);
    assert.match((compaction.system[0] as { text: string }).text, REANCHOR_ADVICE);
    assert.deepEqual(context.system, []);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("an error inside the event loop is traced as advisory and never thrown", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-v2-events-"));
  const traced = mock.method(console, "error", () => {});
  try {
    const host = fakeHostContext({ directory: cwd });
    await entry.setup(host.context);
    host.failEvents(new Error("the event stream broke"));
    await settled();
    assert.deepEqual(traced.mock.calls.map((call) => call.arguments), [["oso-code: [advisory] events.subscribe: the event stream broke (state sink also failed)"]]);
  } finally {
    traced.mock.restore();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the Cleanup setup returns closes the event iterator without a trace, and releases the runs held on child sessions", async () => {
  const fixture = unattendedFixture("oso-v2-cleanup");
  const traced = mock.method(console, "error", () => {});
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-held-root": fixture.repo } });
    const cleanup = await entry.setup(host.context);
    host.emit({ type: "session.created", data: { sessionID: "ses-held-child", parentID: "ses-held-root" } });
    await settled();
    await underRailFixtureHome(fixture, () => host.hook("session", "experimental.idle")({ sessionID: "ses-held-root", background: [] }));
    assert.deepEqual(host.prompts(), []);
    cleanup();
    await settled();
    assert.equal(host.eventSubscription()?.aborted, true);
    await underRailFixtureHome(fixture, async () => {
      trackSessionEvent({ type: "session.idle", data: { sessionID: "ses-held-child" } });
      await settled();
    });
    assert.deepEqual(host.prompts(), []);
    assert.deepEqual(traced.mock.calls.filter((call) => String(call.arguments[0]).includes("events.subscribe")), []);
  } finally {
    traced.mock.restore();
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a child session's completion re-drives the run held on it while the plugin is live", async () => {
  const fixture = unattendedFixture("oso-v2-held");
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-live-root": fixture.repo } });
    await entry.setup(host.context);
    host.emit({ type: "session.created", data: { sessionID: "ses-live-child", parentID: "ses-live-root" } });
    await settled();
    await underRailFixtureHome(fixture, async () => {
      await host.hook("session", "experimental.idle")({ sessionID: "ses-live-root", background: [] });
      assert.deepEqual(host.prompts(), []);
      trackSessionEvent({ type: "session.idle", data: { sessionID: "ses-live-child" } });
      await settled();
    });
    assert.deepEqual(host.prompts(), [{ sessionID: "ses-live-root", text: CONTINUATION_ORDER }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

const PLAN_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document.\n";
const OSO_TOOLS = ["oso_wave", "oso_plan_approve", "oso_plan_cancel"];

test("setup registers every oso tool for a direct call by the model", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-v2-tools-"));
  try {
    const host = fakeHostContext({ directory: cwd });
    await entry.setup(host.context);
    for (const name of OSO_TOOLS) {
      assert.deepEqual(host.tool(name).options, { codemode: false }, name);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a plan approval acts on the calling session's directory and asks the host's permission API for that session", async () => {
  const setupRepository = seedRailFixture("oso-v2-tool-setup");
  const sessionRepository = seedRailFixture("oso-v2-tool-session");
  try {
    const host = fakeHostContext({
      directory: setupRepository.repo,
      sessionDirectories: { "ses-elsewhere": sessionRepository.repo },
    });
    await entry.setup(host.context);
    await underRailFixtureHome(sessionRepository, () => host.callTool("oso_plan_approve", "ses-elsewhere", { plan: PLAN_DOCUMENT }));
    underFixtureHome(sessionRepository.home, () => {
      assert.equal(readValue(stateFileFor(sessionRepository.repo), "plan_approval"), "approved");
      assert.equal(existsSync(stateFileFor(setupRepository.repo)), false);
    });
    const [asked] = host.assertions() as Array<{ sessionID: string; action: string; resources: string[] }>;
    assert.equal(asked?.sessionID, "ses-elsewhere");
    assert.equal(asked?.action, "oso_plan_approve");
    assert.deepEqual(asked?.resources, [sha256Hex(PLAN_DOCUMENT)]);
  } finally {
    rmSync(setupRepository.base, { recursive: true, force: true });
    rmSync(sessionRepository.base, { recursive: true, force: true });
  }
});

test("a refused permission assertion leaves the plan unapproved and the refusal reaches the model", async () => {
  const fixture = seedRailFixture("oso-v2-tool-refused");
  try {
    const host = fakeHostContext({
      directory: fixture.repo,
      sessionDirectories: { "ses-refused": fixture.repo },
      refuseAssertions: new Error("The operator rejected this call"),
    });
    await entry.setup(host.context);
    await underRailFixtureHome(fixture, () =>
      assert.rejects(host.callTool("oso_plan_approve", "ses-refused", { plan: PLAN_DOCUMENT }), /operator rejected/));
    underFixtureHome(fixture.home, () => {
      assert.notEqual(readValue(stateFileFor(fixture.repo), "plan_approval"), "approved");
    });
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the registered approval tool returns the delta for a changed plan and supersedes it from a later turn", async () => {
  const fixture = seedRailFixture("oso-v2-tool-delta");
  const revised = `${PLAN_DOCUMENT}## Riesgos\nNone.\n`;
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-delta": fixture.repo } });
    await entry.setup(host.context);
    const approve = (plan: string, messageID?: string) =>
      underRailFixtureHome(fixture, () => host.callTool("oso_plan_approve", "ses-delta", { plan }, messageID));
    await approve(PLAN_DOCUMENT);
    const delta = await approve(revised);
    assert.equal(delta.metadata?.step, "delta");
    assert.equal(host.assertions().length, 1);
    await assert.rejects(approve(revised), /same turn/);
    await approve(revised, "msg-2");
    const asked = host.assertions() as Array<{ resources: string[]; metadata: Record<string, unknown> }>;
    assert.deepEqual(asked.slice(1).map(({ resources, metadata }) => [resources, metadata.base]), [
      [[sha256Hex(revised)], sha256Hex(PLAN_DOCUMENT)],
    ]);
    underFixtureHome(fixture.home, () => {
      assert.equal(readValue(stateFileFor(fixture.repo), "plan_approval_digest"), sha256Hex(revised));
      assert.equal(readValue(stateFileFor(fixture.repo), "plan_revision"), "1");
    });
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

function deadPid(): number {
  const gone = spawnSync("true");
  assert.notEqual(gone.pid, undefined);
  return gone.pid!;
}

test("setup sweeps the markers of dead owners and leaves a live owner's marker standing", async () => {
  const fixture = seedRailFixture("oso-v2-sweep-setup");
  try {
    const commonDir = commonDirOf(fixture.repo);
    touchMarker(commonDir, "ses-dead", { pid: deadPid(), worktrees: [] });
    touchMarker(commonDir, "ses-live", { pid: process.pid, worktrees: [] });
    const host = fakeHostContext({ directory: fixture.repo });
    await entry.setup(host.context);
    assert.equal(existsSync(markerPath(commonDir, "ses-dead")), false);
    assert.equal(existsSync(markerPath(commonDir, "ses-live")), true);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the Cleanup sweeps the markers of owners that died while the plugin was live", async () => {
  const fixture = seedRailFixture("oso-v2-sweep-cleanup");
  try {
    const commonDir = commonDirOf(fixture.repo);
    const host = fakeHostContext({ directory: fixture.repo });
    const cleanup = await entry.setup(host.context);
    touchMarker(commonDir, "ses-died-later", { pid: deadPid(), worktrees: [] });
    cleanup();
    assert.equal(existsSync(markerPath(commonDir, "ses-died-later")), false);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("an idle session touches its live marker with this process, so a live session is never swept", async () => {
  const fixture = seedRailFixture("oso-v2-live-marker");
  try {
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-working": fixture.repo } });
    await entry.setup(host.context);
    await host.hook("session", "experimental.idle")({ sessionID: "ses-working", background: [] });
    assert.equal(readMarker(commonDirOf(fixture.repo), "ses-working")?.pid, process.pid);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
