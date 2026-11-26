import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { repositoryIdentityFor, sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const SESSION = "test-session";
const NAMED_WINDOW = `mode=plan\nactive_slice=wave-1\nverify_green=true\ngreen_slice=s1\nsession=${SESSION}\n`;

function preToolUseOnBranch(branch: string, commandLine: (repository: string) => string): string {
  return withStateSandbox("workspace", (sandbox) => {
    const repository = sandbox.seedGitRepository("proj");
    spawnSync("git", ["-C", repository, "checkout", "-q", "-b", branch]);
    const key = sha256Hex(repositoryIdentityFor(repository));
    sandbox.seed({ [`.local/state/oso-code/${key}.state`]: NAMED_WINDOW });
    const payload = JSON.stringify({
      session_id: SESSION,
      cwd: repository,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: commandLine(repository) },
    });
    const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["pretooluse"], spawnedEnvelope(payload, process.env)));
    return run.verdict.kind;
  });
}

describe("the PreToolUse layer binds a named window even when the git invocation redirects the repository", () => {
  test("a commit through --git-dir from another slice's branch is refused", () => {
    const kind = preToolUseOnBranch("oso/alpha/s2", (repository) => `git --git-dir='${repository}/.git' commit -m x`);
    assert.equal(kind, "deny");
  });

  test("a commit through -C from the named slice's branch goes through", () => {
    const kind = preToolUseOnBranch("oso/alpha/s1", (repository) => `git -C '${repository}' commit -m x`);
    assert.notEqual(kind, "deny");
  });

  test("a git failure while the window is named is refused", () => {
    const kind = preToolUseOnBranch("oso/alpha/s1", () => "git -C /nonexistent-oso-dir commit -m x");
    assert.equal(kind, "deny");
  });
});
