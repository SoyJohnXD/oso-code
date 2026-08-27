import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectationMismatches, type ObservedRun } from "./support/parity-expectations.ts";
import {
  loadParityFixtures,
  PARITY_FIXTURE_DIRECTORY,
  readSuiteLines,
  unresolvedCitations,
  type ParityFixture,
} from "./support/parity-fixture.ts";
import {
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  StateSandbox,
  withStateSandbox,
  type ObservedEntry,
  type StateSubject,
} from "./support/state-sandbox.ts";

const fixtures = loadParityFixtures();

test(`at least one parity fixture loaded from ${PARITY_FIXTURE_DIRECTORY}, or this suite proved nothing`, () => {
  assert.ok(fixtures.length > 0, `zero parity fixtures loaded from ${PARITY_FIXTURE_DIRECTORY}`);
});

test(`all ${fixtures.length} parity fixtures cite an assertion that still stands in tests/hooks-test.sh`, () => {
  const suiteLines = readSuiteLines();
  assert.deepEqual(fixtures.flatMap((fixture) => unresolvedCitations(fixture, suiteLines)), []);
});

test(`at least one of ${STATE_SUBJECTS.length} configured subject(s) is measurable here, or this suite proved nothing`, () => {
  assert.ok(STATE_SUBJECTS.some((subject) => skipUnlessSpawnable(subject) === false), unmeasurableSubjectsReport());
});

for (const subject of STATE_SUBJECTS) {
  describe(
    `${fixtures.length} parity fixtures read from tests/hooks-test.sh, run against ${subject.name}`,
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

function unmeasurableSubjectsReport(): string {
  const reasons = STATE_SUBJECTS.map((subject) => `${subject.name}: ${skipUnlessSpawnable(subject)}`);
  return `zero of ${STATE_SUBJECTS.length} configured subjects were measurable\n${reasons.join("\n")}`;
}
