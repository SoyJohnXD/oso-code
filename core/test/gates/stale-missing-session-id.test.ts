import assert from "node:assert/strict";
import { test } from "node:test";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

test(
  "stale gate: a missing session id never suppresses the advisory, so a foreign session's state still warns",
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nsession=other-session\n" });
      const stdin = sandbox.expandJson('{"cwd":"{cwd}"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["stale"], spawnedEnvelope(stdin, process.env)));
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /"additionalContext"/);
    });
  },
);
