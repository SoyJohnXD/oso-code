import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mismatchesRunning } from "./support/fixture-runner.ts";
import { loadParityFixtures, PARITY_FIXTURE_DIRECTORY } from "./support/parity-fixture.ts";
import { provedSomething } from "./support/proved.ts";
import { provedTheStateSubjectIsMeasurable, skipUnlessSpawnable, STATE_SUBJECT } from "./support/state-sandbox.ts";

const fixtures = loadParityFixtures();

provedSomething(
  `at least one parity fixture loaded from ${PARITY_FIXTURE_DIRECTORY}`,
  fixtures.length > 0,
  `zero parity fixtures loaded from ${PARITY_FIXTURE_DIRECTORY}`,
);

provedTheStateSubjectIsMeasurable();

describe(
  `${fixtures.length} state CLI fixtures run against ${STATE_SUBJECT.name}`,
  { skip: skipUnlessSpawnable(STATE_SUBJECT) },
  () => {
    for (const fixture of fixtures) {
      test(fixture.name, () => {
        assert.deepEqual(mismatchesRunning(STATE_SUBJECT, fixture), []);
      });
    }
  },
);
