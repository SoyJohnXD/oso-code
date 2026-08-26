import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { skipUnlessSpawnable, STATE_SUBJECTS, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SESSION = "unreadable-state-port-case";
const STATE_FILE = ".local/state/oso-code/{repo}.state";
const PREEXISTING_STATE = "preexisting=1\n";
const UNREADABLE = 0o000;
const OWNER_READ_WRITE = 0o600;

function makeUnreadable(sandbox: StateSandbox, relativePath: string): string {
  const target = path.join(sandbox.home, sandbox.expand(relativePath));
  chmodSync(target, UNREADABLE);
  return target;
}

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: set against a state file it cannot read, which no assertion in tests/hooks-test.sh covers — port tests read from plugin/bin/oso-state:77-89, never parity evidence`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      test("set on an unreadable existing state file leaves it byte-for-byte intact and fails loudly (read from plugin/bin/oso-state:80)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.seed({ [STATE_FILE]: PREEXISTING_STATE });
          const target = makeUnreadable(sandbox, STATE_FILE);
          const run = sandbox.run(subject, ["--session", SESSION, "set", "newkey=2"]);
          chmodSync(target, OWNER_READ_WRITE);
          assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
          assert.ok(run.stderr.includes(target), `stderr did not name the unreadable path: ${JSON.stringify(run.stderr)}`);
          assert.deepEqual(sandbox.read(STATE_FILE), { kind: "file", content: PREEXISTING_STATE });
        });
      });

      test("set on an absent state file still succeeds and creates it (read from plugin/bin/oso-state:80)", () => {
        withStateSandbox("workspace", (sandbox) => {
          const run = sandbox.run(subject, ["--session", SESSION, "set", "fresh=1"]);
          assert.equal(run.exit, 0, `stderr was ${JSON.stringify(run.stderr)}`);
          const state = sandbox.read(STATE_FILE);
          if (state.kind !== "file") throw new Error(`expected ${STATE_FILE} to be a file, found ${state.kind}`);
          assert.match(state.content, /^fresh=1$/m);
        });
      });
    },
  );
}

const nodeSubject = STATE_SUBJECTS.find((subject) => subject.name === "node plugin/dist/oso-state.js");
if (nodeSubject === undefined) {
  throw new Error("node plugin/dist/oso-state.js is not among the configured state subjects");
}

describe(
  `${nodeSubject.name}: show against a state file it cannot read, a fix plugin/bin/oso-state:465 itself does not carry (it reports the file absent instead) — read from core/src/state/store.ts:83-90 and cli.ts:149-152, never parity evidence`,
  { skip: skipUnlessSpawnable(nodeSubject) },
  () => {
    test("show on an unreadable state file fails loudly instead of reporting the file absent", () => {
      withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [STATE_FILE]: PREEXISTING_STATE });
        const target = makeUnreadable(sandbox, STATE_FILE);
        const run = sandbox.run(nodeSubject, ["--session", SESSION, "show"]);
        chmodSync(target, OWNER_READ_WRITE);
        assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
        assert.equal(run.stdout, "");
        assert.doesNotMatch(run.stderr, /^no state at/);
        assert.ok(run.stderr.includes(target), `stderr did not name the unreadable path: ${JSON.stringify(run.stderr)}`);
      });
    });
  },
);
