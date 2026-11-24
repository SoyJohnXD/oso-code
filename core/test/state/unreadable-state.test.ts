import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { describe, test } from "node:test";
import {
  makeUnreadable,
  OWNER_ONLY_FILE,
  provedTheStateSubjectIsMeasurable,
  skipUnlessSpawnable,
  STATE_FILE,
  STATE_SUBJECT,
  withStateSandbox,
} from "../support/state-sandbox.ts";
import { skipUnlessChmodMakesFilesUnreadable } from "../support/win32-skip-guards.ts";

const SESSION = "unreadable-state-case";
const PREEXISTING_STATE = "preexisting=1\n";

provedTheStateSubjectIsMeasurable();

describe(`${STATE_SUBJECT.name}: a state file it cannot read`, { skip: skipUnlessSpawnable(STATE_SUBJECT) }, () => {
  test(
    "set on an unreadable existing state file leaves it byte-for-byte intact and fails loudly",
    { skip: skipUnlessChmodMakesFilesUnreadable() },
    () => {
      withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [STATE_FILE]: PREEXISTING_STATE });
        const target = makeUnreadable(sandbox, STATE_FILE);
        const run = sandbox.run(STATE_SUBJECT, ["--session", SESSION, "set", "roadmap=2"]);
        chmodSync(target, OWNER_ONLY_FILE);
        assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
        assert.ok(run.stderr.includes(target), `stderr did not name the unreadable path: ${JSON.stringify(run.stderr)}`);
        assert.deepEqual(sandbox.read(STATE_FILE), { kind: "file", content: PREEXISTING_STATE });
      });
    },
  );

  test(
    "show on an unreadable state file fails loudly instead of reporting the file absent",
    { skip: skipUnlessChmodMakesFilesUnreadable() },
    () => {
      withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [STATE_FILE]: PREEXISTING_STATE });
        const target = makeUnreadable(sandbox, STATE_FILE);
        const run = sandbox.run(STATE_SUBJECT, ["--session", SESSION, "show"]);
        chmodSync(target, OWNER_ONLY_FILE);
        assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
        assert.equal(run.stdout, "");
        assert.doesNotMatch(run.stderr, /^no state at/);
        assert.ok(run.stderr.includes(target), `stderr did not name the unreadable path: ${JSON.stringify(run.stderr)}`);
      });
    },
  );
});
