import assert from "node:assert/strict";
import { test } from "node:test";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { runGate } from "../../src/gates/dispatch.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const STATE_FILE = ".local/state/oso-code/{repo}.state";

test(
  "stale gate: a missing session id never suppresses the advisory, so a foreign session's state still warns " +
    "(port of bea25f6:plugin/hooks/warn-stale-state.sh:8-13, preserved residual, no parity fixture)",
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nsession=other-session\n" });
      const stdin = sandbox.expandJson('{"cwd":"{cwd}"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["stale"], stdin));
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /"additionalContext"/);
    });
  },
);
