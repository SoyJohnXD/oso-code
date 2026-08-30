import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  provedSomeSubjectIsMeasurable,
  REPOSITORY_RUNS_DIR,
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "journal-timestamp-port-case";
const RUN_JOURNAL = `${REPOSITORY_RUNS_DIR}/run.log`;
const UTC_TIMESTAMP_MILESTONE_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z the timestamp under test\n$/;

provedSomeSubjectIsMeasurable();

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: the journal timestamp format, which journal_texts_in in tests/hooks-test.sh discards before comparing — port tests read from 8c54fd8:plugin/bin/oso-state:488, never parity evidence`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      test("journal stamps its milestone with a UTC date -u +%Y-%m-%dT%H:%M:%SZ timestamp (read from 8c54fd8:plugin/bin/oso-state:488)", () => {
        withStateSandbox("workspace", (sandbox) => {
          sandbox.run(subject, ["--session", SESSION, "journal", "the timestamp under test"]);
          const journal = sandbox.read(RUN_JOURNAL);
          if (journal.kind !== "file") throw new Error(`expected ${RUN_JOURNAL} to be a file, found ${journal.kind}`);
          assert.match(journal.content, UTC_TIMESTAMP_MILESTONE_LINE);
        });
      });
    },
  );
}
