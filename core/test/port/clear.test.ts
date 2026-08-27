import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { skipUnlessSpawnable, STATE_SUBJECTS, withStateSandbox } from "../support/state-sandbox.ts";

const SESSION = "clear-port-case";
const STATE_FILE = ".local/state/oso-code/{repo}.state";
const STATE_LOCK = ".local/state/oso-code/{repo}.state.lock";
const FOREIGN_STATE = `.local/state/oso-code/${"f".repeat(64)}.state`;
const ARMED_STATE = `mode=plan\nactive_slice=1\nverify_green=false\nsession=${SESSION}\n`;

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: clear, which no assertion in tests/hooks-test.sh covers — port tests read from 8c54fd8:plugin/bin/oso-state:467-472, never parity evidence`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      test("clear removes the state file of the directory it stands in (read from 8c54fd8:plugin/bin/oso-state:49 and :470)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: ARMED_STATE });
          const run = sandbox.run(subject, ["--session", SESSION, "clear"]);
          assert.equal(run.exit, 0);
          assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
        });
      });

      test("clear with no state file to remove still exits 0 (read from 8c54fd8:plugin/bin/oso-state:470)", () => {
        withStateSandbox("workspace", (sandbox) => {
          const run = sandbox.run(subject, ["--session", SESSION, "clear"]);
          assert.equal(run.exit, 0);
          assert.equal(run.stdout, "");
          assert.equal(run.stderr, "");
          assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
        });
      });

      test("clear appends exactly one clear event naming its session (read from 8c54fd8:plugin/bin/oso-state:471)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: ARMED_STATE });
          sandbox.run(subject, ["--session", SESSION, "clear"]);
          const appended = sandbox.eventLogLines();
          assert.equal(appended.length, 1);
          assert.deepEqual(
            pick(appended[0] ?? "", ["event", "command", "session"]),
            { event: "clear", command: "", session: SESSION },
          );
        });
      });

      test("clear leaves another repository's state file alone (read from 8c54fd8:plugin/bin/oso-state:49)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: ARMED_STATE, [FOREIGN_STATE]: "mode=quick\nsession=elsewhere\n" });
          sandbox.run(subject, ["--session", SESSION, "clear"]);
          assert.deepEqual(sandbox.read(FOREIGN_STATE), {
            kind: "file",
            content: "mode=quick\nsession=elsewhere\n",
          });
        });
      });

      test("clear releases the lock it took (read from 8c54fd8:plugin/bin/oso-state:74)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: ARMED_STATE });
          sandbox.run(subject, ["--session", SESSION, "clear"]);
          assert.deepEqual(sandbox.read(STATE_LOCK), { kind: "absent" });
        });
      });
    },
  );
}

function pick(line: string, fields: readonly string[]): Record<string, unknown> {
  const record = JSON.parse(line) as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, record[field]]));
}
