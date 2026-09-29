import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryIdFor, stateFileFor } from "@oso-code/core";
import { osoCode } from "../oso-code.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";
import type { PluginTool } from "./tool.ts";
import type { HostSessionApi } from "./wave.ts";

type CaptureHooks = {
  tool: Record<string, PluginTool>;
  "tool.execute.after"?: (input?: unknown, output?: unknown) => Promise<void>;
};

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

function replyingSession(reply: string): HostSessionApi {
  return {
    create: async (options) => ({ data: { id: "ses-child", directory: options.query.directory } }),
    prompt: async () => ({ data: { parts: [{ type: "text", text: reply }] } }),
    abort: async () => ({ data: true }),
  };
}

async function pluginOver(fixture: RailFixture, session?: HostSessionApi): Promise<CaptureHooks> {
  return (await osoCode({ directory: fixture.repo, client: { session } })) as unknown as CaptureHooks;
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
    const hooks = await pluginOver(fixture, replyingSession(VERIFIER_REPORT));
    const result = await underRailFixtureHome(fixture, () => hooks.tool["oso_wave"]!.execute(
      { children: [{ worktree, agent: "verifier", prompt: "verify slice 3" }] },
      { directory: fixture.repo, sessionID: "ses-root" },
    ));
    assert.match(result.output, /verdict: fail/);
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

function taskResult(subagentType: string, metadata: Record<string, unknown>): [unknown, unknown] {
  return [
    { tool: "task", sessionID: "ses-root", callID: "call-1", args: { subagent_type: subagentType, prompt: "p", description: "d" } },
    {
      title: "d",
      output: `<task id="ses-child" state="completed">\n<task_result>\n${VERIFIER_REPORT}\n</task_result>\n</task>`,
      metadata,
    },
  ];
}

const LAUNCHED_ON = { parentSessionId: "ses-root", sessionId: "ses-child", model: { providerID: "anthropic", modelID: "claude-sonnet-5" } };

test("a foreground task verifier's result, read through the plugin's own tool.execute.after, lands one record", async () => {
  const fixture = armedSliceThree("oso-task-verdict");
  try {
    const hooks = await pluginOver(fixture);
    await underRailFixtureHome(fixture, async () => {
      await hooks["tool.execute.after"]!(...taskResult("oso-verifier", LAUNCHED_ON));
      await hooks["tool.execute.after"]!(...taskResult("oso-applier", LAUNCHED_ON));
      await hooks["tool.execute.after"]!(...taskResult("oso-verifier", { ...LAUNCHED_ON, background: true }));
    });
    assert.deepEqual(recordsOf(fixture).map(capturedFields), [{
      host: "opencode",
      session: fixture.owner,
      change: "hanko",
      slice: "3",
      attempt: 1,
      role: "verifier",
      model: "anthropic/claude-sonnet-5",
      verdict: "fail",
      verdict_shape: "valid",
      escalated: false,
    }]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
