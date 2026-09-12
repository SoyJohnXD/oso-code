import assert from "node:assert/strict";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  STATE_FILE,
  STATE_ROOT_THESE_TESTS_SPELL,
  withStateSandbox,
  type StateSandbox,
} from "../support/state-sandbox.ts";
import { skipUnlessChmodDeniesDirectoryWrites } from "../support/win32-skip-guards.ts";

const SESSION = "degraded-probe";
const READ_EXECUTE_ONLY_DIRECTORY = 0o555;
const OWNER_ONLY_DIRECTORY = 0o700;

function sessionStartStdin(sandbox: StateSandbox): string {
  return sandbox.expandJson(`{"session_id":"${SESSION}","cwd":"{cwd}","hook_event_name":"SessionStart"}`);
}

function commitCallStdin(sandbox: StateSandbox): string {
  return sandbox.expandJson(
    `{"session_id":"${SESSION}","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",` +
      '"tool_input":{"command":"echo hi"}}',
  );
}

function staleRun(sandbox: StateSandbox, env: Readonly<Record<string, string>>) {
  return withHookEnvironment(env, () => runGate(["stale"], spawnedEnvelope(sessionStartStdin(sandbox), process.env)));
}

function commitRun(sandbox: StateSandbox, env: Readonly<Record<string, string>>) {
  return withHookEnvironment(env, () => runGate(["commit"], spawnedEnvelope(commitCallStdin(sandbox), process.env)));
}

function stateRootDirectoryOf(sandbox: StateSandbox): string {
  return path.join(sandbox.home, ...STATE_ROOT_THESE_TESTS_SPELL.split("/"));
}

describe("a session whose gates cannot see their own state says so once, at SessionStart, never silently as an unarmed run", () => {
  test("no task identity resolves here — named distinctly from a plain unarmed run", () => {
    withStateSandbox("workspace", (sandbox) => {
      mkdirSync(stateRootDirectoryOf(sandbox), { recursive: true });
      const run = staleRun(sandbox, { HOME: sandbox.home, USERPROFILE: sandbox.home });
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /OSO_TASK_ROOT/);
      assert.match(run.stdout, /git repository/);
    });
  });

  test("no task identity resolves here, and the state root has never existed on this machine — the notice still fires, and reading it creates nothing", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = staleRun(sandbox, { HOME: sandbox.home, USERPROFILE: sandbox.home });
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /OSO_TASK_ROOT/);
      assert.match(run.stdout, /git repository/);
      assert.equal(sandbox.read(STATE_ROOT_THESE_TESTS_SPELL).kind, "absent");
    });
  });

  test("identity resolves and no state file exists — a normal unarmed run, and the gate stays silent", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = staleRun(sandbox, sandbox.hookEnvironment());
      assert.deepEqual(
        { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
        { exit: 0, stdout: "", stderr: "" },
      );
    });
  });

  test("the state file cannot be read — named as an unreadable file, not as no session armed", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: { kind: "directory" } });
      const run = staleRun(sandbox, sandbox.hookEnvironment());
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /cannot be read/);
    });
  });

  describe("the state root itself cannot be written", { skip: skipUnlessChmodDeniesDirectoryWrites() }, () => {
    test("named as an unwritable directory, not as no session armed", () => {
      withStateSandbox("workspace", (sandbox) => {
        const stateRoot = stateRootDirectoryOf(sandbox);
        mkdirSync(stateRoot, { recursive: true });
        chmodSync(stateRoot, READ_EXECUTE_ONLY_DIRECTORY);
        try {
          const run = staleRun(sandbox, sandbox.hookEnvironment());
          assert.equal(run.exit, 0);
          assert.match(run.stdout, /cannot write the oso-code state directory/);
        } finally {
          chmodSync(stateRoot, OWNER_ONLY_DIRECTORY);
        }
      });
    });
  });

  test("a normal armed run stays silent — the loud notice never fires when the state reads clean", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: `mode=plan\nsession=${SESSION}\n` });
      const run = staleRun(sandbox, sandbox.hookEnvironment());
      assert.deepEqual(
        { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
        { exit: 0, stdout: "", stderr: "" },
      );
    });
  });

  test("the notice fires once at SessionStart and never again on the per-call gates it also allows through", () => {
    withStateSandbox("workspace", (sandbox) => {
      mkdirSync(stateRootDirectoryOf(sandbox), { recursive: true });
      const env = { HOME: sandbox.home, USERPROFILE: sandbox.home };
      const started = staleRun(sandbox, env);
      assert.notEqual(started.stdout, "");
      for (let call = 0; call < 3; call += 1) {
        const run = commitRun(sandbox, env);
        assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      }
    });
  });
});
