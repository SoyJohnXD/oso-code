import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  provedTheStateSubjectIsMeasurable,
  REPOSITORY_RUNS_DIR,
  skipUnlessSpawnable,
  STATE_SUBJECT,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "journal-timestamp-case";
const RUN_JOURNAL = `${REPOSITORY_RUNS_DIR}/run.log`;
const UTC_TIMESTAMP_MILESTONE_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z the timestamp under test\n$/;

provedTheStateSubjectIsMeasurable();

describe(`${STATE_SUBJECT.name}: the journal timestamp format`, { skip: skipUnlessSpawnable(STATE_SUBJECT) }, () => {
  test("journal stamps its milestone with a UTC %Y-%m-%dT%H:%M:%SZ timestamp", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.run(STATE_SUBJECT, ["--session", SESSION, "journal", "the timestamp under test"]);
      const journal = sandbox.read(RUN_JOURNAL);
      if (journal.kind !== "file") throw new Error(`expected ${RUN_JOURNAL} to be a file, found ${journal.kind}`);
      assert.match(journal.content, UTC_TIMESTAMP_MILESTONE_LINE);
    });
  });
});
