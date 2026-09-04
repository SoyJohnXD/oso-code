import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  makeUnreadable,
  OWNER_ONLY_FILE,
  STATE_ROOT_THESE_TESTS_SPELL,
  withStateSandbox,
} from "../support/state-sandbox.ts";
import { skipUnlessChmodMakesFilesUnreadable } from "../support/win32-skip-guards.ts";

const ABANDONED_STATE = `${STATE_ROOT_THESE_TESTS_SPELL}/abandoned-unreadable.state`;

test(
  "teardown gate: the abandoned-state sweep prunes an unreadable state file with no readability check first " +
    "(port of plugin/hooks/cleanup-state.sh:79-91, preserved residual, no parity fixture)",
  { skip: skipUnlessChmodMakesFilesUnreadable() },
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [ABANDONED_STATE]: { kind: "file", content: "mode=plan\n", aged: true } });
      const target = makeUnreadable(sandbox, ABANDONED_STATE);
      const stdin = sandbox.expandJson('{"session_id":"test-session"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["teardown"], spawnedEnvelope(stdin, process.env)));
      assert.equal(run.exit, 0);
      try {
        assert.equal(sandbox.read(ABANDONED_STATE).kind, "absent");
      } finally {
        if (existsSync(target)) chmodSync(target, OWNER_ONLY_FILE);
      }
    });
  },
);
