import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  provedTheStateSubjectIsMeasurable,
  skipUnlessSpawnable,
  STATE_FILE,
  STATE_LOCK,
  STATE_SUBJECT,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "lock-case";

provedTheStateSubjectIsMeasurable();

describe(`${STATE_SUBJECT.name}: the lock-acquisition bound`, { skip: skipUnlessSpawnable(STATE_SUBJECT) }, () => {
  test("a live lock younger than the stale bound exhausts the retries, names the session and writes no state", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_LOCK]: { kind: "directory" } });
      const run = sandbox.run(STATE_SUBJECT, ["--session", SESSION, "set", "mode=plan"]);
      assert.equal(run.exit, 1);
      assert.equal(run.stderr.trimEnd(), `oso-state: could not acquire lock for session ${SESSION}`);
      assert.deepEqual(sandbox.read(STATE_LOCK), { kind: "directory" });
      assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
    });
  });
});
