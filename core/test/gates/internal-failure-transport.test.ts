import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { GateRun } from "../../src/gates/dispatch.ts";
import type { HookEnvelope } from "../../src/hosts/envelope.ts";
import { unresolvedHomeCause, withHookEnvironment } from "../support/gate-fixture.ts";
import { repositoryRoot, STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

type IsolatedRunGate = (argv: readonly string[], payload: string) => GateRun;

const ANCHORLESS_CORE_ROOT = mkdtempSync(path.join(tmpdir(), "oso-anchorless-core-"));

let anchorlessRunGate: IsolatedRunGate;

before(async () => {
  cpSync(path.join(repositoryRoot, "core", "src"), path.join(ANCHORLESS_CORE_ROOT, "src"), { recursive: true });
  const anchorless = (name: string): string =>
    pathToFileURL(path.join(ANCHORLESS_CORE_ROOT, "src", "hosts", name)).href;
  const dispatchUrl = pathToFileURL(path.join(ANCHORLESS_CORE_ROOT, "src", "gates", "dispatch.ts")).href;
  const dispatch = (await import(dispatchUrl)) as {
    runGate: (argv: readonly string[], envelope: HookEnvelope) => GateRun;
  };
  const spawned = (await import(anchorless("spawned.ts"))) as {
    spawnedEnvelope: (payload: string, environment: NodeJS.ProcessEnv) => HookEnvelope;
  };
  anchorlessRunGate = (argv, payload) => dispatch.runGate(argv, spawned.spawnedEnvelope(payload, process.env));
});

after(() => {
  rmSync(ANCHORLESS_CORE_ROOT, { recursive: true, force: true });
});

function assertLoud(run: GateRun, causeKeyword: RegExp): void {
  assert.equal(run.exit, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /^oso-code: cause: /);
  assert.match(run.stderr, causeKeyword);
  assert.deepEqual(run.events, []);
}

describe(
  "every lifecycle gate's internal failure is loud: exit 1, the cause on stderr, no stdout and no event, " +
    "while the four PreToolUse deniers keep their exit-2 fail-closed transport",
  () => {
    test(
      "stale: an internal failure unrelated to HOME (pluginRootAbove throwing inside staleStateContext, via " +
        "the anchorless core copy, once the state IS found armed by another session) is loud",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: "mode=plan\nsession=other-session\n" });
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: sandbox.home }, () => anchorlessRunGate(["stale"], stdin));
        });
        assertLoud(run, /carries a verified oso-code bin\/oso-state/);
      },
    );

    test(
      "stale: HOME unset — reached through isDirectory(stateRootDirectory())'s own homeDirectory() throw — is loud",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["stale"], stdin));
        });
        assertLoud(run, new RegExp(unresolvedHomeCause()));
      },
    );

    test(
      "version: an internal failure (pluginRootAbove throwing inside pluginManifestFile, via the anchorless " +
        "core copy) is loud, never a silent exit 0",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}","source":"startup"}');
          return withHookEnvironment({ HOME: sandbox.home }, () => anchorlessRunGate(["version"], stdin));
        });
        assertLoud(run, /carries a verified oso-code bin\/oso-state/);
      },
    );

    test(
      "reanchor: HOME unset, reached through stateFileFor's own homeDirectory() throw, is loud with the cause " +
        "on stderr, never a silent exit 0",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}","source":"compact"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["reanchor"], stdin));
        });
        assertLoud(run, new RegExp(unresolvedHomeCause()));
      },
    );

    test(
      "statebin: an internal failure (pluginRootAbove throwing, via the anchorless core copy) with " +
        "CLAUDE_ENV_FILE set (so pluginRootDirectory() is reached) is loud, with the cause on stderr",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment(
            { HOME: sandbox.home, CLAUDE_ENV_FILE: path.join(sandbox.home, "env.sh") },
            () => anchorlessRunGate(["statebin"], stdin),
          );
        });
        assertLoud(run, /carries a verified oso-code bin\/oso-state/);
      },
    );

    test(
      "teardown: HOME unset — reached through stateRootDirectory()'s own homeDirectory() throw while listing " +
        ".state files — is loud, never an exit-0 silent teardown",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["teardown"], stdin));
        });
        assertLoud(run, new RegExp(unresolvedHomeCause()));
      },
    );

    test(
      "autocontinue: HOME unset — reached through stateFileFor's own homeDirectory() throw while naming the " +
        "run's state — is loud",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson(
            '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}',
          );
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["autocontinue"], stdin));
        });
        assertLoud(run, new RegExp(unresolvedHomeCause()));
      },
    );

    test(
      "commit: the four PreToolUse deniers are untouched — runGate(['commit'], ...) with HOME unset still " +
        "exits 2 with the cause on stderr, the fail-closed transport unchanged",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson(
            '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
              '"tool_input":{"command":"git commit -m x"}}',
          );
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["commit"], stdin));
        });
        assert.equal(run.exit, 2);
        assert.equal(run.stdout, "");
        assert.match(run.stderr, /the commit gate failed unexpectedly and blocked this call/);
        assert.match(run.stderr, new RegExp(`oso-code: cause: ${unresolvedHomeCause()}\\n$`));
      },
    );
  },
);
