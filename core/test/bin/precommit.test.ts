import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";
import { provedSomething } from "../support/proved.ts";
import {
  repositoryRoot,
  skipUnlessSpawnable,
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

const STATE_PATH = ".local/state/oso-code/{repo}.state";
const SESSION = "test-session";
const HOST_SESSION = { CLAUDE_CODE_SESSION_ID: SESSION };

provedSomething(
  `${PRE_COMMIT_HOOK.name} is spawnable here`,
  skipUnlessSpawnable(PRE_COMMIT_HOOK) === false,
  `${PRE_COMMIT_HOOK.name} cannot be spawned here, so the git layer's own boundary was never measured`,
);

describe("the git pre-commit hook's own boundary", { skip: skipUnlessSpawnable(PRE_COMMIT_HOOK) }, () => {
  test("a repository with no state file commits untouched (read from tests/hooks-test.sh:6855)", () => {
    const run = withStateSandbox("workspace", (sandbox) =>
      sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION }),
    );
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("a terminal naming no session commits untouched (read from tests/hooks-test.sh:6856)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, []);
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("the marker a host with no session id sets arms the same gate (read from tests/hooks-test.sh:6867)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: { OSO_AGENT: "codex-probe" } });
    });
    assert.equal(run.exit, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /^oso-code: the session verify is not green\./);
  });

  test("the git layer denies a commit while verify is red (read from tests/hooks-test.sh:6866)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.equal(run.exit, 1);
    assert.equal(run.stdout, "");
    assert.equal(
      run.stderr,
      "oso-code: the session verify is not green. Resume plan mode's apply → verify loop until the verifier returns pass, then retry the commit.\n",
    );
  });

  test("the git layer lets a commit through once verify is green (read from tests/hooks-test.sh:6870)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: `mode=plan\nverify_green=true\nsession=${SESSION}\n` });
      return sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION });
    });
    assert.deepEqual(run, { exit: 0, stdout: "", stderr: "" });
  });

  test("the git layer denies a state path it cannot read (read from tests/hooks-test.sh:6908)", () => {
    const { run, home } = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: { kind: "directory" } });
      return { run: sandbox.run(PRE_COMMIT_HOOK, [], { env: HOST_SESSION }), home: sandbox.home };
    });
    assert.equal(run.exit, 1);
    assert.match(run.stderr, /cannot be read/);
    assert.match(run.stderr, new RegExp(`oso-state --session ${SESSION} clear`));
    assert.ok(run.stderr.includes(home));
  });

  test("the git layer records its deny as the matcher's event (read from tests/hooks-test.sh:6871)", () => {
    const events = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_PATH]: `mode=plan\nverify_green=false\nsession=${SESSION}\n` });
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
});
