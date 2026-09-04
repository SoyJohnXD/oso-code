import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  makeUnreadable,
  OWNER_ONLY_FILE,
  STATE_FILE,
  withStateSandbox,
} from "../support/state-sandbox.ts";
import { skipUnlessChmodMakesFilesUnreadable } from "../support/win32-skip-guards.ts";

test(
  "stale gate: an unreadable state file reads the same as a foreign session's, so it still warns " +
    "(port of plugin/hooks/warn-stale-state.sh:11-13, preserved residual, no parity fixture)",
  { skip: skipUnlessChmodMakesFilesUnreadable() },
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nsession=other-session\n" });
      const target = makeUnreadable(sandbox, STATE_FILE);
      const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["stale"], spawnedEnvelope(stdin, process.env)));
      chmodSync(target, OWNER_ONLY_FILE);
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /"additionalContext"/);
    });
  },
);
