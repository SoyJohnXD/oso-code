import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectationMismatches } from "../support/parity-expectations.ts";
import {
  GATE_FIXTURE_DIRECTORY,
  loadGateFixtures,
  observeGate,
  type GateFixture,
} from "../support/gate-fixture.ts";
import { readSuiteLines, unresolvedCitations } from "../support/parity-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const fixtures = loadGateFixtures();
const gatesCovered = [...new Set(fixtures.map((fixture) => fixture.gate))].sort();

provedSomething(
  `at least one gate parity fixture loaded from ${GATE_FIXTURE_DIRECTORY}`,
  fixtures.length > 0,
  `zero gate parity fixtures loaded from ${GATE_FIXTURE_DIRECTORY}`,
);

provedSomething(
  `all four PreToolUse gates carry fixtures, not ${gatesCovered.join(", ")}`,
  gatesCovered.join(",") === "commit,edits,proddeploy,unknown",
  `the gate fixtures cover ${gatesCovered.join(", ")} rather than every PreToolUse gate`,
);

test(`all ${fixtures.length} gate fixtures cite an assertion that still stands in tests/hooks-test.sh`, () => {
  const suiteLines = readSuiteLines();
  assert.deepEqual(fixtures.flatMap((fixture) => unresolvedCitations(fixture, suiteLines)), []);
});

describe(`${fixtures.length} gate parity fixtures read from tests/hooks-test.sh`, () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      assert.deepEqual(mismatchesOf(fixture), []);
    });
  }
});

function mismatchesOf(fixture: GateFixture): string[] {
  return withStateSandbox(fixture.cwd, (sandbox) => {
    sandbox.seed(fixture.state_before);
    return expectationMismatches(fixture.expect, observeGate(sandbox, fixture), (text) => sandbox.expand(text));
  });
}
