import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeChildSessions } from "../../test-support/child-sessions.ts";
import type { OsoToolContext, ToolHost } from "./tool.ts";
import { waveTool } from "./wave-tool.ts";

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Wave Tool Test",
  GIT_AUTHOR_EMAIL: "wave-tool@test.local",
  GIT_COMMITTER_NAME: "Wave Tool Test",
  GIT_COMMITTER_EMAIL: "wave-tool@test.local",
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...COMMIT_ENV } });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout ?? "";
}

interface ToolFixture {
  repoDir: string;
  applierWorktree: string;
  verifierWorktree: string;
}

async function withToolFixture(fn: (fixture: ToolFixture) => Promise<void>): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "oso-wave-tool-"));
  const repoDir = join(base, "repo");
  mkdirSync(repoDir);
  git(repoDir, "init", "-b", "main");
  git(repoDir, "config", "user.name", "Wave Tool Test");
  git(repoDir, "config", "user.email", "wave-tool@test.local");
  writeFileSync(join(repoDir, "marker.txt"), "fixture\n");
  git(repoDir, "add", "marker.txt");
  git(repoDir, "commit", "-m", "fixture");
  const head = git(repoDir, "rev-parse", "HEAD").trim();
  const applierWorktree = join(base, "wt-applier");
  const verifierWorktree = join(base, "wt-verifier");
  git(repoDir, "worktree", "add", "-b", "oso/tool/a", applierWorktree, head);
  git(repoDir, "worktree", "add", "-b", "oso/tool/b", verifierWorktree, head);
  try {
    await fn({ repoDir, applierWorktree, verifierWorktree });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function replyingSessions(replyOf: (directory: string) => string) {
  return fakeChildSessions((directory) => ({ outcome: "succeeded", reply: replyOf(directory) }));
}

function hostIn(directory: string, children: ReturnType<typeof fakeChildSessions>): ToolHost {
  return { session: children.api, directoryOf: async () => directory } as unknown as ToolHost;
}

const CALL = { sessionID: "ses-root" } as unknown as OsoToolContext;

function contentOf(result: { content?: unknown }): string {
  return String(result.content);
}

test("oso_wave declares the children the model must name and the two agents it accepts", () => {
  const tool = waveTool(hostIn(process.cwd(), replyingSessions(() => "")));
  const children = (tool.input as { properties: { children: unknown } }).properties.children as {
    type: string;
    items: { required: string[]; properties: Record<string, { type?: string; enum?: string[] }> };
  };
  assert.equal(children.type, "array");
  assert.deepEqual(children.items.required, ["worktree", "agent", "prompt"]);
  assert.deepEqual(children.items.properties.agent?.enum, ["applier", "verifier"]);
  assert.equal(children.items.properties.applier_proof?.type, "string");
  assert.match(tool.description, /worktree/);
});

test("oso_wave hands the three applier_proof blocks to a verifier child under one header and blocks an applier child that names it", async () => {
  await withToolFixture(async (fixture) => {
    const proofBlock = [
      "proof:",
      "  - criterion: the field reaches a verifier child only",
      "scan:",
      "  - cmd: oso-state scan comments SLICE_START  exit: 0  hits: none",
      "decisions_used:",
      "  - C1-D4",
    ].join("\n");
    const children = replyingSessions(() => "verdict: pass\n");
    const result = await waveTool(hostIn(fixture.repoDir, children)).execute(
      {
        children: [
          { worktree: fixture.applierWorktree, agent: "applier", prompt: "build the slice", applier_proof: proofBlock },
          { worktree: fixture.verifierWorktree, agent: "verifier", prompt: "verify the slice", applier_proof: proofBlock },
        ],
      },
      CALL,
    );

    assert.deepEqual(children.turns, [
      { directory: fixture.verifierWorktree, text: `verify the slice\n\n=== applier_proof ===\n${proofBlock}` },
    ]);
    assert.equal(result.metadata?.blocked, 1);
    assert.match(contentOf(result), /\(applier\) — blocked: .*applier_proof/);
  });
});

test("oso_wave runs both children in their own worktrees and reads each verdict in band", async () => {
  await withToolFixture(async (fixture) => {
    const children = replyingSessions((directory) =>
      directory === fixture.applierWorktree
        ? "files: a.ts — the slice\nstatus: done\n"
        : "verdict: pass\n");
    const result = await waveTool(hostIn(fixture.repoDir, children)).execute(
      {
        children: [
          { worktree: fixture.applierWorktree, agent: "applier", prompt: "build the slice" },
          { worktree: fixture.verifierWorktree, agent: "verifier", prompt: "verify the slice" },
        ],
      },
      CALL,
    );

    const worktrees = [fixture.applierWorktree, fixture.verifierWorktree].sort();
    assert.deepEqual(children.created.map((child) => child.directory).sort(), worktrees);
    assert.deepEqual(children.moved.slice().sort(), worktrees);
    assert.deepEqual(children.turns.map((turn) => turn.directory).sort(), worktrees);
    assert.deepEqual(children.created.map((child) => child.agent).sort(), ["oso-applier", "oso-verifier"]);
    assert.deepEqual(children.created.map((child) => child.parentID), ["ses-root", "ses-root"]);
    assert.deepEqual(result.metadata, { title: "wave: 2 children reported", children: 2, blocked: 0 });
    assert.match(contentOf(result), /\(applier\) — status: done ===/);
    assert.match(contentOf(result), /files: a\.ts — the slice/);
    assert.match(contentOf(result), /\(verifier\) — verdict: pass ===/);
  });
});

test("oso_wave reports a child it could not pin as blocked and never as a verdict", async () => {
  await withToolFixture(async (fixture) => {
    const children = replyingSessions(() => "status: done\n");
    const result = await waveTool(hostIn(fixture.repoDir, children)).execute(
      {
        children: [
          { worktree: fixture.applierWorktree, agent: "applier", prompt: "build the slice" },
          { worktree: fixture.repoDir, agent: "verifier", prompt: "verify from the main checkout" },
        ],
      },
      CALL,
    );
    assert.deepEqual(children.created.map((child) => child.directory), [fixture.applierWorktree]);
    assert.deepEqual(result.metadata, { title: "wave: 2 children, 1 blocked", children: 2, blocked: 1 });
    assert.match(contentOf(result), /blocked: .*is not a git worktree, it is root ===/);
  });
});

test("oso_wave refuses a call the model shaped wrongly", async () => {
  const tool = waveTool(hostIn(process.cwd(), replyingSessions(() => "status: done\n")));
  const call = CALL;
  await assert.rejects(() => tool.execute({}, call), /needs a children array/);
  await assert.rejects(() => tool.execute({ children: [] }, call), /needs a children array/);
  await assert.rejects(
    () => tool.execute({ children: [{ worktree: "/wt/a", agent: "reviewer", prompt: "p" }] }, call),
    /needs agent "applier" or "verifier"/,
  );
  await assert.rejects(
    () => tool.execute({ children: [{ agent: "applier", prompt: "p" }] }, call),
    /needs a worktree path/,
  );
  await assert.rejects(
    () => tool.execute({ children: [{ worktree: "/wt/a", agent: "applier" }] }, call),
    /needs a prompt/,
  );
  await assert.rejects(
    () => tool.execute({ children: [{ worktree: "/wt/a", agent: "verifier", prompt: "p", applier_proof: 7 }] }, call),
    /needs applier_proof as the applier's three report blocks/,
  );
});

test("oso_wave refuses to run in a directory that is no repository", async () => {
  const outside = mkdtempSync(join(tmpdir(), "oso-wave-tool-outside-"));
  await assert.rejects(
    () => waveTool(hostIn(outside, replyingSessions(() => "status: done\n"))).execute({ children: [{ worktree: "/wt/a", agent: "applier", prompt: "p" }] }, CALL),
    /must run inside a git repository/,
  );
  rmSync(outside, { recursive: true, force: true });
});

test("oso_wave runs from the directory of the calling session's record, not a directory fixed at setup", async () => {
  await withToolFixture(async (fixture) => {
    const children = replyingSessions(() => "status: done\n");
    const host = { session: children.api, directoryOf: async (sessionID: string) => (sessionID === "ses-root" ? fixture.repoDir : "/nowhere") } as unknown as ToolHost;
    const result = await waveTool(host).execute({ children: [{ worktree: fixture.applierWorktree, agent: "applier", prompt: "p" }] }, CALL);
    assert.equal(result.metadata?.blocked, 0);
  });
});
