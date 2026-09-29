import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PlanApprovalError, runCancelApprovedPlan } from "../../src/state/plan.ts";
import { GatesOwnedElsewhereError, sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_FILE, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const OWNER = "opencode-owner";
const A_CLAUDE_SESSION = "0f7c2a1e-claude-session";
const DIGEST = sha256Hex("Repaso de cambios\nFull slice plan: alpha\n");
const ANOTHER_DIGEST = sha256Hex("Repaso de cambios\nFull slice plan: beta\n");

function approvedState(gateOwner: string, planOwner: string = OWNER, approval: string = "approved"): string {
  return [
    "mode=plan",
    "active_slice=2",
    "verify_green=true",
    `plan_approval=${approval}`,
    `plan_approval_digest=${DIGEST}`,
    `plan_approval_session=${planOwner}`,
    "auto=running",
    `session=${gateOwner}`,
    "",
  ].join("\n");
}

function cancelled(sandbox: StateSandbox, digest: string = DIGEST): number {
  return withHookEnvironment({ HOME: sandbox.home }, () => runCancelApprovedPlan(sandbox.cwd, OWNER, digest));
}

function stateOf(sandbox: StateSandbox): string {
  const state = sandbox.read(STATE_FILE);
  return state.kind === "file" ? state.content : `<${state.kind}>`;
}

function refusedLeavingTheStateAsSeeded(
  seeded: string,
  refusal: (thrown: unknown) => boolean,
  digest: string = DIGEST,
): void {
  withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({ [STATE_FILE]: seeded });
    assert.throws(() => cancelled(sandbox, digest), refusal);
    assert.equal(stateOf(sandbox), seeded);
    assert.deepEqual(sandbox.eventLogLines(), []);
  });
}

describe(
  "core/src/state/plan.ts: abandoning an approved plan is a gate-key transition that refuses state another " +
    "session owns and never steals it",
  () => {
    test("a state whose gates another session holds is refused byte-unchanged, naming that session", () => {
      refusedLeavingTheStateAsSeeded(
        approvedState(A_CLAUDE_SESSION),
        (thrown) => thrown instanceof GatesOwnedElsewhereError && thrown.message.includes(A_CLAUDE_SESSION),
      );
    });

    test("an approved plan another session presented is refused byte-unchanged", () => {
      refusedLeavingTheStateAsSeeded(
        approvedState(A_CLAUDE_SESSION, A_CLAUDE_SESSION),
        (thrown) => thrown instanceof PlanApprovalError && thrown.message === "the approved plan belongs to another session",
      );
    });

    test("a plan that is not approved is refused byte-unchanged", () => {
      refusedLeavingTheStateAsSeeded(
        approvedState(OWNER, OWNER, "pending"),
        (thrown) => thrown instanceof PlanApprovalError && thrown.message === "plan approval is not approved",
      );
    });

    test("a digest other than the approved one is refused byte-unchanged", () => {
      refusedLeavingTheStateAsSeeded(
        approvedState(OWNER),
        (thrown) =>
          thrown instanceof PlanApprovalError && thrown.message === "approved plan digest changed before abandonment",
        ANOTHER_DIGEST,
      );
    });

    test("the owner's approved plan is disarmed and marked cancelled, the owner kept and the event logged", () => {
      withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [STATE_FILE]: approvedState(OWNER) });
        assert.equal(cancelled(sandbox), 0);
        assert.equal(
          stateOf(sandbox),
          [
            `plan_approval_digest=${DIGEST}`,
            `plan_approval_session=${OWNER}`,
            "auto=running",
            "mode=plan",
            "active_slice=none",
            "verify_green=false",
            "plan_approval=cancelled",
            `session=${OWNER}`,
            "",
          ].join("\n"),
        );
        const events = sandbox.eventLogLines();
        assert.equal(events.length, 1);
        assert.match(events[0] ?? "", new RegExp(`"event":"plan-approval-abandoned".*"session":"${OWNER}"`));
      });
    });
  },
);
