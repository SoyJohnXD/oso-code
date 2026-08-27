import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import {
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  unmeasurableSubjectsReport,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "lock-port-case";
const STATE_FILE = ".local/state/oso-code/{repo}.state";
const STATE_LOCK = ".local/state/oso-code/{repo}.state.lock";

provedSomething(
  `at least one of ${STATE_SUBJECTS.length} configured subject(s) is measurable here`,
  STATE_SUBJECTS.some((subject) => skipUnlessSpawnable(subject) === false),
  unmeasurableSubjectsReport(),
);

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: the lock-acquisition bound, which no assertion in tests/hooks-test.sh covers — port tests read from 8c54fd8:plugin/bin/oso-state:59-75, never parity evidence`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      test("a live lock younger than the stale bound exhausts the retries, names the session and writes no state (read from 8c54fd8:plugin/bin/oso-state:61-72)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_LOCK]: { kind: "directory" } });
          const run = sandbox.run(subject, ["--session", SESSION, "set", "mode=plan"]);
          assert.equal(run.exit, 1);
          assert.equal(run.stderr.trimEnd(), `oso-state: could not acquire lock for session ${SESSION}`);
          assert.deepEqual(sandbox.read(STATE_LOCK), { kind: "directory" });
          assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
        });
      });
    },
  );
}
