import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const UNREADABLE = 0o000;
const OWNER_READ_WRITE = 0o600;
const ABANDONED_STATE = ".local/state/oso-code/abandoned-unreadable.state";

function makeUnreadable(sandbox: StateSandbox, relativePath: string): string {
  const target = path.join(sandbox.home, sandbox.expand(relativePath));
  chmodSync(target, UNREADABLE);
  return target;
}

function skipUnlessChmodMakesFilesUnreadable(): false | string {
  if (process.platform !== "win32") return false;
  return "win32 ignores the POSIX read bit chmod clears, so a file chmod'd unreadable here still reads back readable";
}

test(
  "teardown gate: the abandoned-state sweep prunes an unreadable state file with no readability check first " +
    "(port of plugin/hooks/cleanup-state.sh:79-91, preserved residual, no parity fixture)",
  { skip: skipUnlessChmodMakesFilesUnreadable() },
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [ABANDONED_STATE]: { kind: "file", content: "mode=plan\n", aged: true } });
      const target = makeUnreadable(sandbox, ABANDONED_STATE);
      const stdin = sandbox.expandJson('{"session_id":"test-session"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["teardown"], stdin));
      assert.equal(run.exit, 0);
      try {
        assert.equal(sandbox.read(ABANDONED_STATE).kind, "absent");
      } finally {
        if (existsSync(target)) chmodSync(target, OWNER_READ_WRITE);
      }
    });
  },
);
