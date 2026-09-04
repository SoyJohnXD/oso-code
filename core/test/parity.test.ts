import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mismatchesRunning } from "./support/fixture-runner.ts";
import { loadParityFixtures, PARITY_FIXTURE_DIRECTORY } from "./support/parity-fixture.ts";
import { provedSomething } from "./support/proved.ts";
import { provedSomeSubjectIsMeasurable, skipUnlessSpawnable, STATE_SUBJECTS } from "./support/state-sandbox.ts";

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
          assert.deepEqual(mismatchesRunning(subject, fixture), []);
        });
      }
    },
  );
}
