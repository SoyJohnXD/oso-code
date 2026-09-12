import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadGateFixtures, observeGate, type GateFixture } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { STATE_ROOT_THESE_TESTS_SPELL, withStateSandbox } from "../support/state-sandbox.ts";

const READ_ONLY_JUDGE_GATES = ["commit", "edits", "unknown", "proddeploy", "reanchor", "stale"] as const;

function neverSeedsState(fixture: GateFixture): boolean {
  return Object.keys(fixture.state_before).length === 0;
}

function judgesAnAbsentRoot(fixture: GateFixture): boolean {
  return (READ_ONLY_JUDGE_GATES as readonly string[]).includes(fixture.gate) && neverSeedsState(fixture);
}

const coldFixtures = loadGateFixtures().filter(judgesAnAbsentRoot);

provedSomething(
  `at least one fixture per read-only judge gate (${READ_ONLY_JUDGE_GATES.join(", ")}) judges an absent state root`,
  READ_ONLY_JUDGE_GATES.every((gate) => coldFixtures.some((fixture) => fixture.gate === gate)),
  `only these fixtures judge an absent root: ${coldFixtures.map((fixture) => fixture.gate).join(", ") || "none"}`,
);

describe(
  "a gate that only judges whether a session is armed never creates the state root it finds absent — " +
    "requireWritableStateRoot's mkdirSync belongs to the write path (writeStateValues) alone, and a read-time " +
    "probe reused from that write path would leave every one of these judgments a hidden write",
  () => {
    for (const fixture of coldFixtures) {
      test(`${fixture.gate}: "${fixture.name}" leaves the state root absent`, () => {
        withStateSandbox(fixture.cwd, (sandbox) => {
          sandbox.seed(fixture.state_before);
          observeGate(sandbox, fixture);
          assert.equal(sandbox.read(STATE_ROOT_THESE_TESTS_SPELL).kind, "absent");
        });
      });
    }
  },
);
