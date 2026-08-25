import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  messageOf,
  pinnedSessionTransport,
  runWave,
  type HostSessionApi,
  type SessionTransport,
  type WaveChildResult,
} from "./wave.ts";

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Wave Test",
  GIT_AUTHOR_EMAIL: "wave@test.local",
  GIT_COMMITTER_NAME: "Wave Test",
  GIT_COMMITTER_EMAIL: "wave@test.local",
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...COMMIT_ENV },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout ?? "";
}

function fixtureRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), "oso-wave-repo-"));
  git(repoDir, "init", "-b", "main");
  git(repoDir, "config", "user.name", "Wave Test");
  git(repoDir, "config", "user.email", "wave@test.local");
  writeFileSync(join(repoDir, "marker.txt"), "fixture\n");
  git(repoDir, "add", "marker.txt");
  git(repoDir, "commit", "-m", "fixture");
  return repoDir;
}

interface WorktreeRequest {
  repoDir: string;
  root: string;
  name: string;
  branch: string;
}

function addWorktree(request: WorktreeRequest): string {
  const path = join(request.root, request.name);
  const head = git(request.repoDir, "rev-parse", "HEAD").trim();
  git(request.repoDir, "worktree", "add", "-b", request.branch, path, head);
  return path;
}

interface WavePair {
  repoDir: string;
  applierWorktree: string;
  verifierWorktree: string;
}

async function withWavePair(fn: (pair: WavePair) => void | Promise<void>): Promise<void> {
  const repoDir = fixtureRepo();
  const worktreeRoot = mkdtempSync(join(tmpdir(), "oso-wave-worktrees-"));
  try {
    await fn({
      repoDir,
      applierWorktree: addWorktree({ repoDir, root: worktreeRoot, name: "child-a", branch: "oso/wave/a" }),
      verifierWorktree: addWorktree({ repoDir, root: worktreeRoot, name: "child-b", branch: "oso/wave/b" }),
    });
  } finally {
    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
}

interface TransportLog {
  created: Array<{ directory: string; title: string; parentSessionID: string }>;
  prompted: Array<{ sessionID: string; directory: string; hostAgent: string; prompt: string }>;
  order: string[];
}

function recordingTransport(
  reply: (entry: { sessionID: string; hostAgent: string }) => Promise<string>,
  createDelayMs: (directory: string) => number = () => 0,
): { transport: SessionTransport; log: TransportLog } {
  const log: TransportLog = { created: [], prompted: [], order: [] };
  const transport: SessionTransport = {
    create: async (request) => {
      const delay = createDelayMs(request.directory);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      log.created.push(request);
      log.order.push(`create:${request.directory}`);
      return { id: `ses-${log.created.length}`, directory: request.directory };
    },
    prompt: async (request) => {
      log.prompted.push(request);
      log.order.push(`prompt:${request.sessionID}`);
      return reply(request);
    },
    abort: async (request) => {
      log.order.push(`abort:${request.sessionID}`);
    },
  };
  return { transport, log };
}

function resultFor(results: readonly WaveChildResult[], worktree: string): WaveChildResult {
  const found = results.find((result) => result.worktree === worktree);
  assert.ok(found, `no result for ${worktree}`);
  return found;
}

test("an applier and a verifier each run in a session pinned to their own worktree", async () => {
  await withWavePair(async (pair) => {
    const { transport, log } = recordingTransport(async ({ hostAgent }) =>
      hostAgent === "oso-applier" ? "files: a.ts\nstatus: done\n" : "verdict: pass\n");
    const results = await runWave({
      launches: [
        { worktree: pair.applierWorktree, agent: "applier", prompt: "build slice a" },
        { worktree: pair.verifierWorktree, agent: "verifier", prompt: "verify slice a" },
      ],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });

    assert.deepEqual(log.created.map((entry) => entry.directory).sort(), [pair.applierWorktree, pair.verifierWorktree].sort());
    assert.deepEqual(log.prompted.map((entry) => entry.directory).sort(), [pair.applierWorktree, pair.verifierWorktree].sort());
    assert.deepEqual(log.prompted.map((entry) => entry.hostAgent).sort(), ["oso-applier", "oso-verifier"]);
    assert.deepEqual(log.created.map((entry) => entry.parentSessionID), ["ses-root", "ses-root"]);

    const applier = resultFor(results, pair.applierWorktree);
    assert.equal(applier.outcome, "reported");
    assert.equal(applier.outcome === "reported" && applier.verdict.status, "done");
    assert.equal(applier.outcome === "reported" && applier.verdict.matched, true);
    const verifier = resultFor(results, pair.verifierWorktree);
    assert.equal(verifier.outcome === "reported" && verifier.verdict.verdict, "pass");
    assert.equal(verifier.outcome === "reported" && verifier.raw, "verdict: pass\n");
  });
});

test("the readiness barrier opens every child session before any child is prompted", async () => {
  await withWavePair(async (pair) => {
    const { transport, log } = recordingTransport(
      async () => "status: done\n",
      (directory) => (directory === pair.applierWorktree ? 30 : 0),
    );
    await runWave({
      launches: [
        { worktree: pair.applierWorktree, agent: "applier", prompt: "slow" },
        { worktree: pair.verifierWorktree, agent: "verifier", prompt: "fast" },
      ],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    const lastCreate = log.order.map((entry) => entry.startsWith("create:")).lastIndexOf(true);
    const firstPrompt = log.order.findIndex((entry) => entry.startsWith("prompt:"));
    assert.ok(lastCreate >= 0, `no create recorded: ${log.order.join(", ")}`);
    assert.ok(firstPrompt > lastCreate, `a prompt preceded a create: ${log.order.join(", ")}`);
  });
});

test("a path that is not a worktree of this project is blocked before any session is opened", async () => {
  await withWavePair(async (pair) => {
    const strangerRepo = fixtureRepo();
    const strangerRoot = mkdtempSync(join(tmpdir(), "oso-wave-stranger-"));
    const strangerWorktree = addWorktree(
      { repoDir: strangerRepo, root: strangerRoot, name: "child-x", branch: "oso/wave/x" },
    );
    const { transport, log } = recordingTransport(async () => "status: done\n");
    const results = await runWave({
      launches: [
        { worktree: pair.repoDir, agent: "applier", prompt: "the main checkout is not a worktree" },
        { worktree: strangerWorktree, agent: "applier", prompt: "another repository" },
        { worktree: "relative/path", agent: "verifier", prompt: "not absolute" },
      ],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    rmSync(strangerRoot, { recursive: true, force: true });
    rmSync(strangerRepo, { recursive: true, force: true });

    assert.deepEqual(log.created, []);
    assert.deepEqual(log.prompted, []);
    assert.equal(results.every((result) => result.outcome === "blocked"), true);
    assert.match(results[0]!.outcome === "blocked" ? results[0]!.reason : "", /is not a git worktree, it is root/);
    assert.match(results[1]!.outcome === "blocked" ? results[1]!.reason : "", /belongs to .*, not to this project/);
    assert.match(results[2]!.outcome === "blocked" ? results[2]!.reason : "", /is not an absolute path/);
  });
});

test("a host that opens the child somewhere else is blocked instead of prompted", async () => {
  await withWavePair(async (pair) => {
    const prompted: string[] = [];
    const transport: SessionTransport = {
      create: async (request) => ({ id: "ses-drifted", directory: `${request.directory}-elsewhere` }),
      prompt: async (request) => {
        prompted.push(request.sessionID);
        return "status: done\n";
      },
      abort: async () => {},
    };
    const results = await runWave({
      launches: [{ worktree: pair.applierWorktree, agent: "applier", prompt: "build" }],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    assert.deepEqual(prompted, []);
    assert.equal(results[0]!.outcome, "blocked");
    assert.match(
      results[0]!.outcome === "blocked" ? results[0]!.reason : "",
      /the host pinned the child session to .*-elsewhere, not to /,
    );
  });
});

test("a child that outlives its bound is aborted and comes back blocked, never as a verdict", async () => {
  await withWavePair(async (pair) => {
    const aborted: Array<{ sessionID: string; directory: string }> = [];
    const transport: SessionTransport = {
      create: async (request) => ({ id: "ses-runaway", directory: request.directory }),
      prompt: () => new Promise<string>(() => {}),
      abort: async (request) => {
        aborted.push(request);
      },
    };
    const results = await runWave({
      launches: [{ worktree: pair.applierWorktree, agent: "applier", prompt: "never replies" }],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 40,
    });
    assert.equal(results[0]!.outcome, "blocked");
    assert.equal("verdict" in results[0]!, false);
    assert.match(results[0]!.outcome === "blocked" ? results[0]!.reason : "", /the child turn did not complete: the 40ms bound expired/);
    assert.deepEqual(aborted, [{ sessionID: "ses-runaway", directory: pair.applierWorktree }]);
  });
});

test("a child whose abort also fails names both failures and never loses the cause", async () => {
  await withWavePair(async (pair) => {
    const transport: SessionTransport = {
      create: async (request) => ({ id: "ses-stuck", directory: request.directory }),
      prompt: async () => {
        throw new Error("the child turn exploded");
      },
      abort: async () => {
        throw new Error("abort refused");
      },
    };
    const results = await runWave({
      launches: [{ worktree: pair.applierWorktree, agent: "applier", prompt: "explodes" }],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    const reason = results[0]!.outcome === "blocked" ? results[0]!.reason : "";
    assert.match(reason, /the child turn exploded/);
    assert.match(reason, /the child session was left running: abort refused/);
  });
});

test("a blocked child leaves its siblings reporting intact", async () => {
  await withWavePair(async (pair) => {
    const transport: SessionTransport = {
      create: async (request) => {
        if (request.directory === pair.verifierWorktree) {
          throw new Error("the host refused the session");
        }
        return { id: "ses-a", directory: request.directory };
      },
      prompt: async () => "status: done\n",
      abort: async () => {},
    };
    const results = await runWave({
      launches: [
        { worktree: pair.applierWorktree, agent: "applier", prompt: "build" },
        { worktree: pair.verifierWorktree, agent: "verifier", prompt: "verify" },
      ],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    assert.equal(resultFor(results, pair.applierWorktree).outcome, "reported");
    const blocked = resultFor(results, pair.verifierWorktree);
    assert.equal(blocked.outcome, "blocked");
    assert.match(
      blocked.outcome === "blocked" ? blocked.reason : "",
      /the child session could not be created: the host refused the session/,
    );
  });
});

test("a child that reports without a verdict line is never read as a verdict", async () => {
  await withWavePair(async (pair) => {
    const { transport } = recordingTransport(async () => "I finished the work.\n");
    const results = await runWave({
      launches: [{ worktree: pair.applierWorktree, agent: "applier", prompt: "build" }],
      transport,
      projectDirectory: pair.repoDir,
      parentSessionID: "ses-root",
      timeoutMs: 5_000,
    });
    const only = results[0]!;
    assert.equal(only.outcome, "reported");
    assert.equal(only.outcome === "reported" && only.verdict.matched, false);
    assert.equal(only.outcome === "reported" && only.verdict.status, undefined);
    assert.equal(only.outcome === "reported" && only.verdict.verdict, undefined);
  });
});

test("pinnedSessionTransport drives the host's session create, prompt and abort", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const session: HostSessionApi = {
    create: async (options) => {
      calls.push({ call: "create", ...options });
      return { data: { id: "ses-host", directory: options.query.directory } };
    },
    prompt: async (options) => {
      calls.push({ call: "prompt", ...options });
      return { data: { parts: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "status: done" }] } };
    },
    abort: async (options) => {
      calls.push({ call: "abort", ...options });
      return { data: true };
    },
  };
  const transport = pinnedSessionTransport(session);

  const created = await transport.create({ directory: "/wt/a", title: "oso-applier in /wt/a", parentSessionID: "ses-root" });
  assert.deepEqual(created, { id: "ses-host", directory: "/wt/a" });
  const text = await transport.prompt({ sessionID: "ses-host", directory: "/wt/a", hostAgent: "oso-applier", prompt: "build" });
  assert.equal(text, "status: done");
  await transport.abort({ sessionID: "ses-host", directory: "/wt/a" });

  assert.deepEqual(calls[0], {
    call: "create",
    query: { directory: "/wt/a" },
    body: { title: "oso-applier in /wt/a", parentID: "ses-root" },
  });
  assert.deepEqual(calls[1], {
    call: "prompt",
    path: { id: "ses-host" },
    query: { directory: "/wt/a" },
    body: { agent: "oso-applier", parts: [{ type: "text", text: "build" }] },
  });
  assert.deepEqual(calls[2], { call: "abort", path: { id: "ses-host" }, query: { directory: "/wt/a" } });
});

test("pinnedSessionTransport omits a parent id the wave never supplied", async () => {
  const bodies: unknown[] = [];
  const session: HostSessionApi = {
    create: async (options) => {
      bodies.push(options.body);
      return { data: { id: "ses-host", directory: options.query.directory } };
    },
    prompt: async () => ({ data: { parts: [] } }),
    abort: async () => ({ data: true }),
  };
  await pinnedSessionTransport(session).create({ directory: "/wt/a", title: "t", parentSessionID: "" });
  assert.deepEqual(bodies, [{ title: "t" }]);
});

test("a host call that answers with an error rather than data fails loud and keeps the cause", async () => {
  const session: HostSessionApi = {
    create: async () => ({ error: { data: { message: "unknown project" }, name: "BadRequestError" } }),
    prompt: async () => ({ data: { parts: [] } }),
    abort: async () => ({ data: true }),
  };
  await assert.rejects(
    () => pinnedSessionTransport(session).create({ directory: "/wt/a", title: "t", parentSessionID: "" }),
    /unknown project/,
  );
});

test("a host reply carrying no parts array fails loud instead of parsing to an empty verdict", async () => {
  const session: HostSessionApi = {
    create: async (options) => ({ data: { id: "ses", directory: options.query.directory } }),
    prompt: async () => ({ data: { parts: undefined } }),
    abort: async () => ({ data: true }),
  };
  await assert.rejects(
    () => pinnedSessionTransport(session).prompt({ sessionID: "ses", directory: "/wt/a", hostAgent: "oso-applier", prompt: "p" }),
    /no message parts/,
  );
});

test("messageOf names an error, a string and a host error record without losing the cause", () => {
  assert.equal(messageOf(new Error("boom")), "boom");
  assert.equal(messageOf("plain"), "plain");
  assert.equal(messageOf({ message: "server said no" }), "server said no");
  assert.equal(messageOf({ data: { message: "unknown project" }, name: "BadRequestError" }), "unknown project");
  assert.equal(messageOf({ name: "NotFoundError" }), "NotFoundError");
  assert.match(messageOf({}), /an unnamed failure/);
});
