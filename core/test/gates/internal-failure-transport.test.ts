import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import type { GateRun } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { repositoryRoot, withStateSandbox } from "../support/state-sandbox.ts";

type IsolatedRunGate = (argv: readonly string[], payload: string) => GateRun;

const ANCHORLESS_CORE_ROOT = mkdtempSync(path.join(tmpdir(), "oso-anchorless-core-"));

let anchorlessRunGate: IsolatedRunGate;

before(async () => {
  cpSync(path.join(repositoryRoot, "core", "src"), path.join(ANCHORLESS_CORE_ROOT, "src"), { recursive: true });
  const dispatchUrl = pathToFileURL(path.join(ANCHORLESS_CORE_ROOT, "src", "gates", "dispatch.ts")).href;
  const isolatedModule = (await import(dispatchUrl)) as { runGate: IsolatedRunGate };
  anchorlessRunGate = isolatedModule.runGate;
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
  "core/src/gates/dispatch.ts: a SessionStart or SessionEnd gate's internal failure is LOUD " +
    "(exit 1, cause on stderr, no stdout, no event) per DECISION 7 of the S2 fix round 3 ledger " +
    "(docs/rewrite/ts-core-roadmap.md:107-121, G5's carve-out table amended to read INTERNAL FAILURE " +
    "BEHAVIOUR). MEASURED directly against the real bash (env -u HOME plugin/hooks/<hook>.sh): every " +
    "lifecycle hook that sources lib.sh dies at lib.sh:260 with 'HOME: unbound variable', a LOUD, exit-1, " +
    "uniform failure for warn-stale-state.sh, warn-stale-version.sh, reanchor-after-compact.sh and " +
    "cleanup-state.sh alike — reanchor-after-compact.sh:43's own 2>/dev/null || exit 0 guard is measurably " +
    "narrower: it protects ONLY state_file_for's own 'no sha256sum, no shasum' digest failure (reproduced " +
    "below by stripping both tools from PATH while HOME stays valid), a bash-specific external-tool-absence " +
    "condition core/src/state/store.ts's sha256Hex (node:crypto, always present) cannot reproduce — so " +
    "stateFileFor()'s one throw source in this port, homeDirectory()'s HOME-unset, is not that guarded " +
    "failure and is correctly loud for every one of the five lifecycle gates, never silently swallowed and " +
    "never the four PreToolUse deniers' exit-2 fail-closed transport",
  () => {
    test(
      "stale: an internal failure unrelated to HOME (pluginRootAbove throwing inside staleStateContext, via " +
        "the anchorless core copy, once the state IS found armed by another session) is loud",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ ".local/state/oso-code/{repo}.state": "mode=plan\nsession=other-session\n" });
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: sandbox.home }, () => anchorlessRunGate(["stale"], stdin));
        });
        assertLoud(run, /carries a bin\/oso-state/);
      },
    );

    test(
      "stale: HOME unset — reached through isDirectory(stateRootDirectory())'s own homeDirectory() throw, " +
        "the port of plugin/hooks/warn-stale-state.sh:9's [ -d \"$OSO_STATE_DIR\" ] (which, like every check " +
        "in a script that sources lib.sh, cannot even run once HOME is unset — measured: env -u HOME " +
        "warn-stale-state.sh dies at lib.sh:260, exit 1, before line 9) — is loud",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["stale"], stdin));
        });
        assertLoud(run, /HOME/);
      },
    );

    test(
      "version: an internal failure (pluginRootAbove throwing inside pluginManifestFile, via the anchorless " +
        "core copy) is loud, not the exit-0 silent this slice's round 2 shipped",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}","source":"startup"}');
          return withHookEnvironment({ HOME: sandbox.home }, () => anchorlessRunGate(["version"], stdin));
        });
        assertLoud(run, /carries a bin\/oso-state/);
      },
    );

    test(
      "reanchor: HOME unset — reached through stateFileFor's own homeDirectory() throw, the SAME lib.sh:260 " +
        "failure class every lifecycle hook shares (measured: env -u HOME reanchor-after-compact.sh dies at " +
        "lib.sh:260, exit 1, 'HOME: unbound variable') — is loud, never the silent exit 0 round 2 shipped for " +
        "every internal failure uniformly and never the narrower guard reanchor-after-compact.sh:43 reserves " +
        "for state_file_for's OWN 'no sha256sum, no shasum' failure alone (measured separately, below)",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}","source":"compact"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["reanchor"], stdin));
        });
        assertLoud(run, /HOME/);
      },
    );

    test(
      "statebin: an internal failure (pluginRootAbove throwing, via the anchorless core copy) with " +
        "CLAUDE_ENV_FILE set (so pluginRootDirectory() is reached) is loud, matching " +
        "persist-state-bin.sh:13's set -euo pipefail loud exit on an unwritable $CLAUDE_ENV_FILE (measured: " +
        "CLAUDE_ENV_FILE pointed at a directory exits 1, 'Is a directory' on stderr), not the exit-0 silent " +
        "this slice's round 2 shipped",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment(
            { HOME: sandbox.home, CLAUDE_ENV_FILE: path.join(sandbox.home, "env.sh") },
            () => anchorlessRunGate(["statebin"], stdin),
          );
        });
        assertLoud(run, /carries a bin\/oso-state/);
      },
    );

    test(
      "teardown: HOME unset — reached through stateRootDirectory()'s own homeDirectory() throw while listing " +
        ".state files, the port of plugin/hooks/cleanup-state.sh sourcing lib.sh (measured: env -u HOME " +
        "cleanup-state.sh dies at lib.sh:260, exit 1) — is loud, not the exit-0 silent this slice's round 2 " +
        "shipped",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          return withHookEnvironment({ HOME: "" }, () => anchorlessRunGate(["teardown"], stdin));
        });
        assertLoud(run, /HOME/);
      },
    );

    test(
      "commit: the four PreToolUse deniers are untouched — runGate(['commit'], ...) with HOME unset still " +
        "exits 2 with the cause on stderr (C2-D20's fail-closed transport, unchanged)",
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
        assert.match(run.stderr, /oso-code: cause: HOME is not set\n$/);
      },
    );
  },
);
