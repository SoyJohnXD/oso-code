import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  provedTheStateSubjectIsMeasurable,
  skipUnlessSpawnable,
  STATE_FILE,
  STATE_LOCK,
  STATE_ROOT_THESE_TESTS_SPELL,
  STATE_SUBJECT,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "clear-case";
const FOREIGN_STATE = `${STATE_ROOT_THESE_TESTS_SPELL}/${"f".repeat(64)}.state`;
const ARMED_STATE = `mode=plan\nactive_slice=1\nverify_green=false\nsession=${SESSION}\n`;

provedTheStateSubjectIsMeasurable();

describe(`${STATE_SUBJECT.name}: clear`, { skip: skipUnlessSpawnable(STATE_SUBJECT) }, () => {
  test("clear removes the state file of the directory it stands in", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: ARMED_STATE });
      const run = sandbox.run(STATE_SUBJECT, ["--session", SESSION, "clear"]);
      assert.equal(run.exit, 0);
      assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
    });
  });

  test("clear with no state file to remove still exits 0", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = sandbox.run(STATE_SUBJECT, ["--session", SESSION, "clear"]);
      assert.equal(run.exit, 0);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, "");
      assert.deepEqual(sandbox.read(STATE_FILE), { kind: "absent" });
    });
  });

  test("clear appends exactly one clear event naming its session", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: ARMED_STATE });
      sandbox.run(STATE_SUBJECT, ["--session", SESSION, "clear"]);
      const appended = sandbox.eventLogLines();
      assert.equal(appended.length, 1);
      assert.deepEqual(pick(appended[0] ?? "", ["event", "command", "session"]), {
        event: "clear",
        command: "",
        session: SESSION,
      });
    });
  });

  test("clear leaves another repository's state file alone", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: ARMED_STATE, [FOREIGN_STATE]: "mode=quick\nsession=elsewhere\n" });
      sandbox.run(STATE_SUBJECT, ["--session", SESSION, "clear"]);
      assert.deepEqual(sandbox.read(FOREIGN_STATE), {
        kind: "file",
        content: "mode=quick\nsession=elsewhere\n",
      });
    });
  });

  test("clear releases the lock it took", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: ARMED_STATE });
      sandbox.run(STATE_SUBJECT, ["--session", SESSION, "clear"]);
      assert.deepEqual(sandbox.read(STATE_LOCK), { kind: "absent" });
    });
  });
});

function pick(line: string, fields: readonly string[]): Record<string, unknown> {
  const record = JSON.parse(line) as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, record[field]]));
}
