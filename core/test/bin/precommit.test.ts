import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { provedSomething } from "../support/proved.ts";
import {
  repositoryRoot,
  skipUnlessSpawnable,
  STATE_FILE,
  withStateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const PRE_COMMIT_HOOK: StateSubject = {
  name: "node core/src/bin/precommit.ts",
  command: [
    process.execPath,
    "--experimental-strip-types",
    path.join(repositoryRoot, "core", "src", "bin", "precommit.ts"),
  ],
};

const SESSION = "test-session";
const HOST_SESSION = { CLAUDE_CODE_SESSION_ID: SESSION };

provedSomething(
  `${PRE_COMMIT_HOOK.name} is spawnable here`,
  skipUnlessSpawnable(PRE_COMMIT_HOOK) === false,
  `${PRE_COMMIT_HOOK.name} cannot be spawned here, so the git layer's own boundary was never measured`,
);

describe("the git pre-commit hook's own boundary", { skip: skipUnlessSpawnable(PRE_COMMIT_HOOK) }, () => {
  test("a repository with no state file commits untouched", () => {
    const run = withStateSandbox("workspace", (sandbox) =>
      sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION }),
    );
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("a terminal naming no session commits untouched", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, []);
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("the marker a host with no session id sets arms the same gate when it names the owner", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nverify_green=false\nsession=opencode-probe\n" });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: { OSO_AGENT: "opencode-probe" } });
    });
    assert.equal(run.exit, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /^oso-code: the session verify is not green\./);
  });

  test("a marker naming a session other than the state's owner commits untouched", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nverify_green=false\nsession=owner-session\n" });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("a state file carrying no mode arms no flow, so the owner's commit goes through", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `roadmap=harness-friction\nauto=running\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("the git layer denies a commit while verify is red", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.equal(run.exit, 1);
    assert.equal(run.stdout, "");
    assert.equal(
      run.stderr,
      "oso-code: the session verify is not green. Resume plan mode's apply → verify loop until the verifier returns pass, then retry the commit.\n",
    );
  });

  test("the git layer lets a commit through once verify is green", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `mode=plan\nverify_green=true\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("the git layer denies a state path it cannot read", () => {
    const { run, home } = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: { kind: "directory" } });
      return { run: sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION }), home: sandbox.home };
    });
    assert.equal(run.exit, 1);
    assert.match(run.stderr, /cannot be read/);
    assert.match(run.stderr, new RegExp(`oso-state --session ${SESSION} clear`));
    assert.ok(run.stderr.includes(home));
  });

  test("the git layer records its deny as the matcher's event", () => {
    const events = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
      return sandbox.eventLogLines();
    });
    assert.equal(events.length, 1);
    const record = JSON.parse(events[0] as string) as Record<string, unknown>;
    assert.equal(record["event"], "commit-denied");
    assert.equal(record["session"], SESSION);
    assert.equal(record["command"], "");
    assert.equal(Object.hasOwn(record, "gate"), false);
    assert.equal(Object.hasOwn(record, "hook_event"), false);
  });

  describe("a named green window binds the commit to its slice's branch", () => {
    const NAMED_WINDOW = `mode=plan\nactive_slice=wave-1\nverify_green=true\ngreen_slice=s1\nsession=${SESSION}\n`;

    function runOnBranch(branch: string, state: string): { exit: number; stderr: string } {
      return withStateSandbox("workspace", (sandbox) => {
        const repository = sandbox.seedGitRepository("proj");
        spawnSync("git", ["-C", repository, "checkout", "-q", "-b", branch]);
        const key = createHash("sha256").update(path.join(repository, ".git")).digest("hex");
        sandbox.seed({ [`.local/state/oso-code/${key}.state`]: state });
        return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION, cwd: repository });
      });
    }

    test("a commit from another slice's branch is refused", () => {
      const run = runOnBranch("oso/alpha/s2", NAMED_WINDOW);
      assert.equal(run.exit, 1);
      assert.match(run.stderr, /names slice s1.*oso\/alpha\/s2/);
    });

    test("a commit from the named slice's branch goes through", () => {
      assert.equal(runOnBranch("oso/alpha/s1", NAMED_WINDOW).exit, 0);
    });

    test("a branch outside the oso family goes through", () => {
      assert.equal(runOnBranch("main", NAMED_WINDOW).exit, 0);
    });

    test("an unnamed wave window and a sequential green leave every branch free", () => {
      assert.equal(runOnBranch("oso/alpha/s2", NAMED_WINDOW.replace("green_slice=s1\n", "")).exit, 0);
      assert.equal(runOnBranch("oso/alpha/s2", NAMED_WINDOW.replace("wave-1", "3")).exit, 0);
    });
  });
});
