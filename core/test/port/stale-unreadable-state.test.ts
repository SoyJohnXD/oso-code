import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const UNREADABLE = 0o000;
const OWNER_READ_WRITE = 0o600;
const STATE_FILE = ".local/state/oso-code/{repo}.state";

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
  "stale gate: an unreadable state file reads the same as a foreign session's, so it still warns " +
    "(port of plugin/hooks/warn-stale-state.sh:11-13, preserved residual, no parity fixture)",
  { skip: skipUnlessChmodMakesFilesUnreadable() },
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nsession=other-session\n" });
      const target = makeUnreadable(sandbox, STATE_FILE);
      const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["stale"], spawnedEnvelope(stdin, process.env)));
      chmodSync(target, OWNER_READ_WRITE);
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /"additionalContext"/);
    });
  },
);
