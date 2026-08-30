import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deriveRootId, publishIdentity, roleOf } from "./identity.ts";
import { armStateUnder } from "../../test-support/state-fixture.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHARED_GIT_HOOKS_DIR = join(REPO_ROOT, "plugin", "git-hooks");
const RAIL_SESSION = "opencode-identity-rail";

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Identity Test",
  GIT_AUTHOR_EMAIL: "identity@test.local",
  GIT_COMMITTER_NAME: "Identity Test",
  GIT_COMMITTER_EMAIL: "identity@test.local",
};

interface RepoFixture {
  base: string;
  root: string;
  child: string;
  rootId: string;
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...COMMIT_ENV },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
}

function makeRepo(): RepoFixture {
  const base = mkdtempSync(join(tmpdir(), "oso-identity-test-"));
  const root = join(base, "root");
  const child = join(base, "wt1");
  mkdirSync(root);
  runGit(root, ["init", "-b", "main"]);
  writeFileSync(join(root, "seed.txt"), "seed\n");
  runGit(root, ["add", "seed.txt"]);
  runGit(root, ["commit", "-m", "seed"]);
  runGit(root, ["worktree", "add", child, "-b", "feature/x"]);
  return { base, root, child, rootId: deriveRootId(root) };
}

function armSession(cwd: string, home: string, assignments: readonly string[]): void {
  armStateUnder(home, cwd, RAIL_SESSION, assignments);
}

function commitInto(tree: string, home: string, marker: string, file: string) {
  writeFileSync(join(tree, file), `${file}\n`);
  runGit(tree, ["add", file]);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...COMMIT_ENV,
    HOME: home,
    USERPROFILE: home,
    OSO_AGENT: marker,
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  return spawnSync("git", ["commit", "-m", file], { cwd: tree, encoding: "utf8", env });
}

test("a child worktree resolves to its root's session id", () => {
  const fixture = makeRepo();
  try {
    assert.equal(deriveRootId(fixture.child), fixture.rootId);
    assert.equal(deriveRootId(fixture.root), fixture.rootId);
    assert.equal(deriveRootId(join(fixture.root, "missing-subdir")), fixture.rootId);
    assert.equal(roleOf(fixture.child), "child");
    assert.equal(roleOf(fixture.root), "root");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a directory outside any repository has no identity", () => {
  const outside = mkdtempSync(join(tmpdir(), "oso-identity-none-"));
  try {
    assert.equal(roleOf(outside), "none");
    assert.equal(deriveRootId(outside), "");
    const vars = publishIdentity(outside);
    assert.equal(vars.OSO_AGENT, "");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("publishIdentity publishes OSO_AGENT as the root session id for both root and child", () => {
  const fixture = makeRepo();
  try {
    const childVars = publishIdentity(fixture.child);
    assert.equal(childVars.OSO_AGENT, fixture.rootId);
    const rootVars = publishIdentity(fixture.root);
    assert.equal(rootVars.OSO_AGENT, fixture.rootId);
    assert.equal(childVars.OSO_AGENT, rootVars.OSO_AGENT);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a stray .git directory with no HEAD resolves to no identity", () => {
  const outside = mkdtempSync(join(tmpdir(), "oso-identity-stray-git-"));
  try {
    mkdirSync(join(outside, ".git", "info"), { recursive: true });
    writeFileSync(join(outside, ".git", "info", "exclude"), "*.log\n");
    assert.equal(roleOf(outside), "none");
    assert.equal(deriveRootId(outside), "");
    assert.equal(publishIdentity(outside).OSO_AGENT, "");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a stray .git directory inside a real repository still resolves to the enclosing repository's root", () => {
  const base = mkdtempSync(join(tmpdir(), "oso-identity-nested-stray-"));
  try {
    const outer = join(base, "outer");
    mkdirSync(outer);
    runGit(outer, ["init", "-b", "main"]);
    writeFileSync(join(outer, "seed.txt"), "seed\n");
    runGit(outer, ["add", "seed.txt"]);
    runGit(outer, ["commit", "-m", "seed"]);
    const rootId = deriveRootId(outer);

    const inner = join(outer, "inner");
    const deep = join(inner, "deep");
    mkdirSync(join(inner, ".git", "info"), { recursive: true });
    writeFileSync(join(inner, ".git", "info", "exclude"), "*.log\n");
    mkdirSync(deep);

    assert.notEqual(rootId, "");
    assert.equal(deriveRootId(inner), rootId);
    assert.equal(deriveRootId(deep), rootId);
    assert.equal(roleOf(inner), "root");
    assert.equal(publishIdentity(deep).OSO_AGENT, rootId);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the identity published for a worktree is the marker the shared pre-commit hook arms on", () => {
  const fixture = makeRepo();
  const home = join(fixture.base, "home");
  try {
    mkdirSync(home, { recursive: true });
    runGit(fixture.root, ["config", "core.hooksPath", SHARED_GIT_HOOKS_DIR]);
    const marker = publishIdentity(fixture.child).OSO_AGENT;
    assert.equal(marker, fixture.rootId);

    armSession(fixture.root, home, ["mode=plan", "verify_green=false"]);
    const denied = commitInto(fixture.child, home, marker, "red-agent.txt");
    assert.equal(denied.status, 1, denied.stdout ?? "");
    assert.match(denied.stderr ?? "", /the session verify is not green/);

    const unmarked = commitInto(fixture.child, home, "", "red-unmarked.txt");
    assert.equal(unmarked.status, 0, unmarked.stderr ?? "");

    armSession(fixture.root, home, ["verify_green=true"]);
    const allowed = commitInto(fixture.child, home, marker, "green-agent.txt");
    assert.equal(allowed.status, 0, allowed.stderr ?? "");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
