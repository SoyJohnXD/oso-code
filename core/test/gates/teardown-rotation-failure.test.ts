import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const STATE_ROOT_SEGMENTS = [".local", "state", "oso-code"];
const EVENTS_LOG = ".local/state/oso-code/events.jsonl";
const READ_EXECUTE_ONLY_DIRECTORY = 0o555;
const OWNER_ONLY_DIRECTORY = 0o700;

function stateRootPath(sandbox: StateSandbox): string {
  return path.join(sandbox.home, ...STATE_ROOT_SEGMENTS);
}

function skipUnlessChmodDeniesDirectoryWrites(): false | string {
  if (process.platform !== "win32") return false;
  return (
    "win32 ignores the POSIX write bit chmod clears on a directory, so a directory chmod'd 555 here still " +
    "accepts a rename into it"
  );
}

describe(
  "teardown gate: an aged events.jsonl whose rotation cannot rename (its containing directory chmod'd 555) " +
    "propagates loud, matching plugin/hooks/cleanup-state.sh:76's unguarded 'mv -f' under set -euo pipefail " +
    "(measured: env -u HOME-free bash dies 'Permission denied', exit 1, and separately, mv -f under this bash " +
    "tolerates no race either — a missing source file also dies loud, 'No such file or directory', exit 1) — " +
    "never the exit-0 silent teardown.ts:87-91's now-removed try/catch shipped, undetected because the only " +
    "two rotation fixtures on file cover the success and skip paths alone",
  { skip: skipUnlessChmodDeniesDirectoryWrites() },
  () => {
    test(
      "teardown: rotateAgedEventsLog's renameSync failing on a read-only state directory reaches runGate as " +
        "a loud failure (exit 1, cause on stderr, no stdout, no event), not a swallowed exit 0",
      () => {
        const run = withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [EVENTS_LOG]: { kind: "file", content: '{"event":"aged"}\n', aged: true } });
          const stateRoot = stateRootPath(sandbox);
          chmodSync(stateRoot, READ_EXECUTE_ONLY_DIRECTORY);
          const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
          const result = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["teardown"], stdin));
          chmodSync(stateRoot, OWNER_ONLY_DIRECTORY);
          return result;
        });
        assert.equal(run.exit, 1);
        assert.equal(run.stdout, "");
        assert.match(run.stderr, /^oso-code: cause: /);
        assert.match(run.stderr, /EACCES/);
        assert.deepEqual(run.events, []);
      },
    );
  },
);
