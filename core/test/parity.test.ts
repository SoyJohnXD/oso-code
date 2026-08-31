import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectationMismatches, type ObservedRun } from "./support/parity-expectations.ts";
import { loadParityFixtures, PARITY_FIXTURE_DIRECTORY, type ParityFixture } from "./support/parity-fixture.ts";
import { provedSomething } from "./support/proved.ts";
import {
  provedSomeSubjectIsMeasurable,
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  StateSandbox,
  withStateSandbox,
  type ObservedEntry,
  type StateSubject,
} from "./support/state-sandbox.ts";

const fixtures = loadParityFixtures();

provedSomething(
  `at least one parity fixture loaded from ${PARITY_FIXTURE_DIRECTORY}`,
  fixtures.length > 0,
  `zero parity fixtures loaded from ${PARITY_FIXTURE_DIRECTORY}`,
);

provedSomeSubjectIsMeasurable();

for (const subject of STATE_SUBJECTS) {
  describe(
    `${fixtures.length} parity fixtures, each quoting the assertion it was ported from, run against ${subject.name}`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      for (const fixture of fixtures) {
        test(fixture.name, () => {
          assert.deepEqual(mismatchesAgainst(subject, fixture), []);
        });
      }
    },
  );
}

function mismatchesAgainst(subject: StateSubject, fixture: ParityFixture): string[] {
  return withStateSandbox(fixture.cwd, (sandbox) => {
    sandbox.seed(fixture.state_before);
    const eventsBefore = sandbox.eventLogLines().length;
    const run = sandbox.run(subject, fixture.argv, { stdin: fixture.stdin, env: fixture.env });
    const observed: ObservedRun = {
      ...run,
      entries: entriesTheExpectationNames(sandbox, fixture),
      eventsAppended: sandbox.eventLogLines().slice(eventsBefore),
    };
    return expectationMismatches(fixture.expect, observed, (text) => sandbox.expand(text));
  });
}

function entriesTheExpectationNames(sandbox: StateSandbox, fixture: ParityFixture): Map<string, ObservedEntry> {
  const named = Object.keys(fixture.expect.state_after ?? {});
  return new Map(named.map((entryPath) => [entryPath, sandbox.read(entryPath)]));
}
