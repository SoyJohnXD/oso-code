import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectationMismatches } from "../support/parity-expectations.ts";
import {
  duplicatedFixtures,
  GATE_FIXTURE_DIRECTORY,
  loadGateFixtures,
  observeGate,
  repeatedNames,
  type GateFixture,
} from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const fixtures = loadGateFixtures();
const gatesCovered = [...new Set(fixtures.map((fixture) => fixture.gate))].sort();

provedSomething(
  `at least one gate parity fixture loaded from ${GATE_FIXTURE_DIRECTORY}`,
  fixtures.length > 0,
  `zero gate parity fixtures loaded from ${GATE_FIXTURE_DIRECTORY}`,
);

const PORTED_GATES =
  "autocontinue,commit,edits,proddeploy,reanchor,stale,statebin,teardown,unknown,version";

provedSomething(
  `all ten ported gates carry fixtures, not ${gatesCovered.join(", ")}`,
  gatesCovered.join(",") === PORTED_GATES,
  `the gate fixtures cover ${gatesCovered.join(", ")} rather than every ported gate`,
);

describe(`${fixtures.length} gate cases`, () => {
  test("no two cases share the same input and expectation", () => {
    assert.deepEqual(duplicatedFixtures(fixtures), []);
  });

  test("no two cases share a name", () => {
    assert.deepEqual(repeatedNames(fixtures), []);
  });

  test("the duplicate matcher reports equal cases and ignores cases that differ in one field", () => {
    const original = fixtures[0]!;
    const twin = { ...original, name: "a twin under another name" };
    const stricter = { ...original, name: "differs in stdin", stdin: `${original.stdin} ` };
    assert.deepEqual(duplicatedFixtures([original, twin]), [`${twin.name} repeats ${original.name}`]);
    assert.deepEqual(duplicatedFixtures([original, stricter]), []);
    assert.deepEqual(repeatedNames([original, { ...stricter, name: original.name }]), [original.name]);
    assert.deepEqual(repeatedNames([original, stricter]), []);
  });

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
