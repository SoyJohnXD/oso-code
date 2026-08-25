import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildStaleAdvice,
  deliverSystemAdvice,
  listMarkers,
  dropSystemAdvice,
  markerPath,
  queueSystemAdvice,
  readMarker,
  sweepStale,
  touchMarker,
  type PendingSystemAdvice,
} from "./lifecycle.ts";

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Lifecycle Test",
  GIT_AUTHOR_EMAIL: "lifecycle@test.local",
  GIT_COMMITTER_NAME: "Lifecycle Test",
  GIT_COMMITTER_EMAIL: "lifecycle@test.local",
};

interface WorktreeFixture {
  base: string;
  root: string;
  wt1: string;
  commonDir: string;
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...COMMIT_ENV },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
}

function makeRepo(): WorktreeFixture {
  const base = mkdtempSync(join(tmpdir(), "oso-lifecycle-test-"));
  const root = join(base, "root");
  const wt1 = join(base, "wt1");
  mkdirSync(root);
  runGit(root, ["init", "-b", "main"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  runGit(root, ["add", "seed.txt"]);
  runGit(root, ["commit", "-m", "seed"]);
  runGit(root, ["worktree", "add", wt1, "-b", "feature/x"]);
  return { base, root, wt1, commonDir: join(root, ".git") };
}

function deadPid(): number {
  const gone = spawnSync("true");
  assert.notEqual(gone.pid, undefined);
  return gone.pid!;
}

test("the sweep never touches a live owner's worktree", () => {
  const fixture = makeRepo();
  try {
    touchMarker(fixture.commonDir, "ses-live", {
      pid: process.pid,
      worktrees: [fixture.wt1],
    });
    const result = sweepStale(fixture.commonDir);
    assert.deepEqual(result.reaped, []);
    assert.deepEqual(result.left, []);
    assert.ok(existsSync(fixture.wt1), "live owner's worktree must survive the sweep");
    assert.ok(
      existsSync(markerPath(fixture.commonDir, "ses-live")),
      "live owner's marker must survive the sweep",
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a dead owner's worktree is reaped and its marker dropped", () => {
  const fixture = makeRepo();
  try {
    touchMarker(fixture.commonDir, "ses-dead", {
      pid: deadPid(),
      worktrees: [fixture.wt1],
    });
    const result = sweepStale(fixture.commonDir);
    assert.ok(result.reaped.includes(fixture.wt1), "dead owner's worktree is reaped");
    assert.ok(!existsSync(fixture.wt1), "dead owner's worktree must be removed");
    assert.ok(
      !existsSync(markerPath(fixture.commonDir, "ses-dead")),
      "dead owner's marker must be dropped after full teardown",
    );
    const listed = spawnSync("git", ["worktree", "list"], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(listed.status, 0, listed.stderr ?? "");
    assert.ok(!listed.stdout.includes(fixture.wt1), "the worktree must be pruned from git");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a failed worktree remove keeps the marker standing", () => {
  const fixture = makeRepo();
  try {
    const ghost = join(fixture.base, "ghost");
    touchMarker(fixture.commonDir, "ses-ghost", {
      pid: deadPid(),
      worktrees: [ghost],
    });
    const result = sweepStale(fixture.commonDir);
    assert.ok(result.left.includes(ghost), "the failed remove is recorded as left");
    assert.ok(
      existsSync(markerPath(fixture.commonDir, "ses-ghost")),
      "marker must stay when teardown fails",
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("touchMarker rewrites updatedAt on each touch", async () => {
  const base = mkdtempSync(join(tmpdir(), "oso-lifecycle-touch-"));
  try {
    const commonDir = join(base, ".git");
    mkdirSync(commonDir);
    touchMarker(commonDir, "ses-touch", { pid: process.pid, worktrees: [] });
    const first = readMarker(commonDir, "ses-touch");
    assert.ok(first !== null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    touchMarker(commonDir, "ses-touch", { pid: process.pid, worktrees: [] });
    const second = readMarker(commonDir, "ses-touch");
    assert.ok(second !== null);
    assert.ok(second.updatedAt > first.updatedAt, "updatedAt must move forward on touch");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("stale advice lists orphaned worktrees or stays empty", () => {
  assert.equal(buildStaleAdvice([]), "");
  const advice = buildStaleAdvice([
    { path: "/tmp/orphan/wt1", sessionId: "ses-x" },
    { path: "/tmp/orphan/wt2", sessionId: "ses-y" },
  ]);
  assert.match(advice, /\/tmp\/orphan\/wt1/);
  assert.match(advice, /\/tmp\/orphan\/wt2/);
  assert.match(advice, /ses-x/);
  assert.match(advice, /ses-y/);
});

test("queued advice is appended to the system prompt array in place", () => {
  const advice = "stale: /tmp/orphan/wt1";
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", advice);
  const output = { system: ["you are a harness"] };
  const delivery = deliverSystemAdvice(output, pending, "ses-a");
  assert.deepEqual(delivery, { kind: "delivered", entries: 1 });
  assert.deepEqual(output.system, ["you are a harness", advice]);
});

test("advice rides every prompt of the turn, because the host sends only the last", () => {
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", "the advisory");
  const discarded = { system: ["you are a harness"] };
  const sent = { system: ["you are a harness"] };
  assert.deepEqual(deliverSystemAdvice(discarded, pending, "ses-a"), { kind: "delivered", entries: 1 });
  assert.deepEqual(deliverSystemAdvice(sent, pending, "ses-a"), { kind: "delivered", entries: 1 });
  assert.deepEqual(sent.system, ["you are a harness", "the advisory"]);
});

test("advice stops riding prompts once its session is dropped", () => {
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", "the advisory");
  dropSystemAdvice(pending, "ses-a");
  const output = { system: ["you are a harness"] };
  assert.deepEqual(deliverSystemAdvice(output, pending, "ses-a"), { kind: "empty" });
  assert.deepEqual(output.system, ["you are a harness"]);
});

test("advice queued for one session never reaches another", () => {
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", "for a");
  const output = { system: ["base"] };
  assert.deepEqual(deliverSystemAdvice(output, pending, "ses-b"), { kind: "empty" });
  assert.deepEqual(output.system, ["base"]);
});

test("advice accumulates until a system prompt it can reach arrives", () => {
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", "first");
  const promptless = { prompt: "the shape the host does not use" };
  assert.deepEqual(deliverSystemAdvice(promptless, pending, "ses-a"), { kind: "undeliverable" });
  queueSystemAdvice(pending, "ses-a", "second");
  const output = { system: ["base"] };
  assert.deepEqual(deliverSystemAdvice(output, pending, "ses-a"), { kind: "delivered", entries: 2 });
  assert.deepEqual(output.system, ["base", "first", "second"]);
});

test("empty advice and unknown sessions never occupy the queue", () => {
  const pending: PendingSystemAdvice = new Map();
  queueSystemAdvice(pending, "ses-a", "");
  queueSystemAdvice(pending, "", "orphaned advice");
  assert.equal(pending.size, 0);
  const output = { system: ["base"] };
  assert.deepEqual(deliverSystemAdvice(output, pending, "ses-a"), { kind: "empty" });
});

test("a corrupt marker file is ignored", () => {
  const base = mkdtempSync(join(tmpdir(), "oso-lifecycle-corrupt-"));
  try {
    const commonDir = join(base, ".git");
    mkdirSync(commonDir);
    writeFileSync(join(commonDir, "oso-live-garbage.json"), "not json {");
    assert.deepEqual(listMarkers(commonDir), []);
    const result = sweepStale(commonDir);
    assert.deepEqual(result, { reaped: [], left: [] });
    assert.ok(
      existsSync(join(commonDir, "oso-live-garbage.json")),
      "the sweep must leave unrelated files alone",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
