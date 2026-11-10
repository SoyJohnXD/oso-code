import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryIdFor, stateFileFor } from "@oso-code/core";
import entry from "../oso-code.ts";
import { fakeChildSessions } from "../../test-support/child-sessions.ts";
import { fakeHostContext } from "../../test-support/host-context.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";

const VERIFIER_REPORT = "## Verification\nverdict: fail\nfindings: one";

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    ["-c", "user.name=oso", "-c", "user.email=oso@oso-code.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr ?? "");
}

function armedSliceThree(label: string): RailFixture {
  const fixture = seedRailFixture(label);
  armStateUnder(fixture.home, fixture.repo, fixture.owner, [
    "mode=plan",
    "active_slice=3",
    "verify_green=false",
    "auto_change=hanko",
  ]);
  return fixture;
}

function recordsOf(fixture: RailFixture): Record<string, unknown>[] {
  const verdicts = underFixtureHome(fixture.home, () => {
    const stateFile = stateFileFor(fixture.repo);
    return join(stateFile, "..", "runs", repositoryIdFor(stateFile), "verdicts.jsonl");
  });
  return readFileSync(verdicts, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function capturedFields(record: Record<string, unknown> | undefined): Record<string, unknown> {
  const { host, session, change, slice, attempt, role, model, verdict, verdict_shape, escalated } = record ?? {};
  return { host, session, change, slice, attempt, role, model, verdict, verdict_shape, escalated };
}

test("a verifier child of oso_wave, run through the plugin's own tool, lands one record on the active slice", async () => {
  const fixture = armedSliceThree("oso-wave-verdict");
  try {
    writeFileSync(join(fixture.repo, "marker.txt"), "fixture\n");
    git(fixture.repo, "add", "marker.txt");
    git(fixture.repo, "commit", "-qm", "fixture");
    const worktree = join(fixture.base, "wt-verifier");
    git(fixture.repo, "worktree", "add", "-q", "-b", "oso/verdict/a", worktree);
    const children = fakeChildSessions(() => ({ outcome: "succeeded", reply: VERIFIER_REPORT }));
    const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-root": fixture.repo }, children });
    await entry.setup(host.context);
    const result = await underRailFixtureHome(fixture, () =>
      host.callTool("oso_wave", "ses-root", { children: [{ worktree, agent: "verifier", prompt: "verify slice 3" }] }));
    assert.match(String(result.content), /verdict: fail/);
    assert.deepEqual(recordsOf(fixture).filter((entry) => entry["kind"] !== "arm").map(capturedFields), [{
      host: "opencode",
      session: fixture.owner,
      change: "hanko",
      slice: "3",
      attempt: 1,
      role: "verifier",
      model: null,
      verdict: "fail",
      verdict_shape: "valid",
      escalated: false,
    }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

function subagentCompletion(agent: string, outcome: Record<string, unknown>): Record<string, unknown> {
  return {
    tool: "subagent",
    sessionID: "ses-root",
    agent: "build",
    messageID: "msg-1",
    id: "call-1",
    input: { agent, description: "d", prompt: "p" },
    status: "completed",
    result: { output: { sessionID: "ses-child", ...outcome }, metadata: { sessionID: "ses-child", status: outcome["status"] } },
  };
}

async function executeAfterOver(fixture: RailFixture): Promise<(payload: unknown) => Promise<void>> {
  const host = fakeHostContext({ directory: fixture.repo, sessionDirectories: { "ses-root": fixture.repo } });
  await entry.setup(host.context);
  return host.hook("tool", "execute.after");
}

test("a completed verifier subagent's report, read through the v2 execute.after hook, lands one record and the others none", async () => {
  const fixture = armedSliceThree("oso-v2-subagent-verdict");
  try {
    const executeAfter = await executeAfterOver(fixture);
    await underRailFixtureHome(fixture, async () => {
      await executeAfter(subagentCompletion("oso-verifier", { status: "completed", output: VERIFIER_REPORT }));
      await executeAfter(subagentCompletion("oso-applier", { status: "completed", output: VERIFIER_REPORT }));
      await executeAfter(subagentCompletion("oso-verifier", { status: "running", output: "working in the background" }));
    });
    assert.deepEqual(recordsOf(fixture).map(capturedFields), [{
      host: "opencode",
      session: fixture.owner,
      change: "hanko",
      slice: "3",
      attempt: 1,
      role: "verifier",
      model: null,
      verdict: "fail",
      verdict_shape: "valid",
      escalated: false,
    }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a verifier subagent whose execute.after status is error is recorded as a malformed none, never a valid verdict", async () => {
  const fixture = armedSliceThree("oso-v2-subagent-error");
  try {
    const executeAfter = await executeAfterOver(fixture);
    await underRailFixtureHome(fixture, () => executeAfter({
      ...subagentCompletion("oso-verifier", { status: "completed", output: VERIFIER_REPORT }),
      status: "error",
      result: undefined,
      error: { _tag: "Tool.Error", message: "the subagent failed" },
    }));
    assert.deepEqual(recordsOf(fixture).map(capturedFields), [{
      host: "opencode",
      session: fixture.owner,
      change: "hanko",
      slice: "3",
      attempt: 1,
      role: "verifier",
      model: null,
      verdict: "none",
      verdict_shape: "malformed",
      escalated: false,
    }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
