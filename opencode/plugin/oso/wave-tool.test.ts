import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { waveTool } from "./wave-tool.ts";
import { type HostSessionApi } from "./wave.ts";

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

function replyingSessionApi(replyOf: (directory: string) => string): {
  session: HostSessionApi;
  directories: { created: string[]; prompted: string[] };
  agents: string[];
} {
  const directories = { created: [] as string[], prompted: [] as string[] };
  const agents: string[] = [];
  const openDirectories = new Map<string, string>();
  const session: HostSessionApi = {
    create: async (options) => {
      const id = `ses-${directories.created.length + 1}`;
      directories.created.push(options.query.directory);
      openDirectories.set(id, options.query.directory);
      return { data: { id, directory: options.query.directory } };
    },
    prompt: async (options) => {
      directories.prompted.push(options.query?.directory ?? "the wave sent no directory");
      agents.push(options.body.agent ?? "the wave sent no agent");
      return { data: { parts: [{ type: "text", text: replyOf(openDirectories.get(options.path.id) ?? "") }] } };
    },
    abort: async () => ({ data: true }),
  };
  return { session, directories, agents };
}

test("oso_wave declares the children the model must name and the two agents it accepts", () => {
  const tool = waveTool(undefined);
  const children = tool.args.children as { type: string; items: { required: string[]; properties: Record<string, { enum?: string[] }> } };
  assert.equal(children.type, "array");
  assert.deepEqual(children.items.required, ["worktree", "agent", "prompt"]);
  assert.deepEqual(children.items.properties.agent?.enum, ["applier", "verifier"]);
  assert.match(tool.description, /worktree/);
});

test("oso_wave runs both children in their own worktrees and reads each verdict in band", async () => {
  await withToolFixture(async (fixture) => {
    const { session, directories, agents } = replyingSessionApi((directory) =>
      directory === fixture.applierWorktree
        ? "files: a.ts — the slice\nstatus: done\n"
        : "verdict: pass\n");
    const result = await waveTool(session).execute(
      {
        children: [
          { worktree: fixture.applierWorktree, agent: "applier", prompt: "build the slice" },
          { worktree: fixture.verifierWorktree, agent: "verifier", prompt: "verify the slice" },
        ],
      },
      { sessionID: "ses-root", directory: fixture.repoDir },
    );

    assert.deepEqual(directories.created.slice().sort(), [fixture.applierWorktree, fixture.verifierWorktree].sort());
    assert.deepEqual(directories.prompted.slice().sort(), [fixture.applierWorktree, fixture.verifierWorktree].sort());
    assert.deepEqual(agents.slice().sort(), ["oso-applier", "oso-verifier"]);
    assert.equal(result.title, "wave: 2 children reported");
    assert.deepEqual(result.metadata, { children: 2, blocked: 0 });
    assert.match(result.output, /\(applier\) — status: done ===/);
    assert.match(result.output, /files: a\.ts — the slice/);
    assert.match(result.output, /\(verifier\) — verdict: pass ===/);
  });
});

test("oso_wave reports a child it could not pin as blocked and never as a verdict", async () => {
  await withToolFixture(async (fixture) => {
    const { session, directories } = replyingSessionApi(() => "status: done\n");
    const result = await waveTool(session).execute(
      {
        children: [
          { worktree: fixture.applierWorktree, agent: "applier", prompt: "build the slice" },
          { worktree: fixture.repoDir, agent: "verifier", prompt: "verify from the main checkout" },
        ],
      },
      { sessionID: "ses-root", directory: fixture.repoDir },
    );
    assert.deepEqual(directories.created, [fixture.applierWorktree]);
    assert.equal(result.title, "wave: 2 children, 1 blocked");
    assert.deepEqual(result.metadata, { children: 2, blocked: 1 });
    assert.match(result.output, /blocked: .*is not a git worktree, it is root ===/);
  });
});

test("oso_wave refuses a call the model shaped wrongly", async () => {
  const { session } = replyingSessionApi(() => "status: done\n");
  const tool = waveTool(session);
  const call = { sessionID: "ses-root", directory: process.cwd() };
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
});

test("oso_wave refuses to run where the host offers no session surface or no repository", async () => {
  await assert.rejects(
    () => waveTool(undefined).execute({ children: [{ worktree: "/wt/a", agent: "applier", prompt: "p" }] }, { directory: process.cwd() }),
    /no session API/,
  );
  const outside = mkdtempSync(join(tmpdir(), "oso-wave-tool-outside-"));
  const { session } = replyingSessionApi(() => "status: done\n");
  await assert.rejects(
    () => waveTool(session).execute({ children: [{ worktree: "/wt/a", agent: "applier", prompt: "p" }] }, { directory: outside }),
    /must run inside a git repository/,
  );
  rmSync(outside, { recursive: true, force: true });
});
