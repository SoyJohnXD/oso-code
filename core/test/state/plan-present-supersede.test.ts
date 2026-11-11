import assert from "node:assert/strict";
import { chmodSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  type HeldPlan,
  heldPlanOf,
  PlanFailure,
  presentedPlanOf,
  runAmendPlan,
  runApprovePlan,
  runCancelApprovedPlan,
  runCapturePlan,
  runPresentPlan,
  runSupersedePlan,
} from "../../src/state/plan.ts";
import { GatesOwnedElsewhereError, sha256Hex, writeStateValues } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_PLANS_DIR, STATE_FILE, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";
import { skipUnlessChmodChangesFileMode } from "../support/win32-skip-guards.ts";

const OWNER = "opencode-owner";
const ANOTHER_SESSION = "0f7c2a1e-claude-session";
const HELD = "Repaso de cambios\nFull slice plan: alpha\n";
const NEXT = "Repaso de cambios\nFull slice plan: beta\n";
const LATER = "Repaso de cambios\nFull slice plan: gamma\n";
const UNCHECKED = "S1 — wire it\nDepends-on: none\nVerify: run it by hand\n";
const HELD_DIGEST = sha256Hex(HELD);
const NEXT_DIGEST = sha256Hex(NEXT);
const LATER_DIGEST = sha256Hex(LATER);

type Observed = Readonly<{ state: string; plans: Readonly<Record<string, string>>; events: number }>;

function plansDirectoryOf(sandbox: StateSandbox): string {
  return path.join(sandbox.home, sandbox.expand(REPOSITORY_PLANS_DIR));
}

function observed(sandbox: StateSandbox): Observed {
  const state = sandbox.read(STATE_FILE);
  const directory = plansDirectoryOf(sandbox);
  const names = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile());
  return {
    state: state.kind === "file" ? state.content : `<${state.kind}>`,
    plans: Object.fromEntries(names.map(({ name }) => [name, readFileSync(path.join(directory, name), "utf8")])),
    events: sandbox.eventLogLines().length,
  };
}

function inSandbox<T>(sandbox: StateSandbox, run: () => T): T {
  return withHookEnvironment({ HOME: sandbox.home }, run);
}

function holding(approval: "pending" | "approved", use: (sandbox: StateSandbox) => void): void {
  withStateSandbox("workspace", (sandbox) => {
    inSandbox(sandbox, () => {
      runCapturePlan(sandbox.cwd, OWNER, HELD_DIGEST, HELD);
      if (approval === "approved") runApprovePlan(sandbox.cwd, OWNER, HELD_DIGEST);
      use(sandbox);
    });
  });
}

function present(sandbox: StateSandbox, digest: string, document: string, turn: string, session = OWNER): number {
  return runPresentPlan(sandbox.cwd, session, digest, document, turn);
}

function presentedKeys(digest: string, turn: string): string {
  return `plan_presented_digest=${digest}\nplan_presented_base=${HELD_DIGEST}\nplan_presented_turn=${turn}\n`;
}

function withPresentedKeys(state: string, digest: string, turn: string): string {
  return state.replace(`\nsession=${OWNER}\n`, `\n${presentedKeys(digest, turn)}session=${OWNER}\n`);
}

type Refusal = RegExp | typeof GatesOwnedElsewhereError;

function refusedWith(sandbox: StateSandbox, act: () => unknown, refusal: Refusal): void {
  const before = observed(sandbox);
  if (refusal instanceof RegExp) {
    assert.throws(act, (thrown: unknown) => thrown instanceof PlanFailure && refusal.test(thrown.message));
  } else {
    assert.throws(act, refusal);
  }
  assert.deepEqual(observed(sandbox), before);
}

const SLICE_STILL_ACTIVE = /close or abandon the active slice first/;

function heldAs(approval: "pending" | "approved", document: string): HeldPlan {
  return { kind: "held", approval, digest: sha256Hex(document), document, current: document };
}

describe(
  "core/src/state/plan.ts: presenting a new plan over a held one stores a snapshot and three keys and nothing else",
  () => {
    test("a presentation over the approved plan adds its snapshot and keys, and changes nothing else", () => {
      holding("approved", (sandbox) => {
        const before = observed(sandbox);
        assert.equal(present(sandbox, NEXT_DIGEST, NEXT, "msg_1"), 0);
        assert.deepEqual(observed(sandbox), {
          state: withPresentedKeys(before.state, NEXT_DIGEST, "msg_1"),
          plans: { ...before.plans, [`presented-${NEXT_DIGEST}.md`]: NEXT },
          events: before.events + 1,
        });
        assert.deepEqual(heldPlanOf(sandbox.cwd), heldAs("approved", HELD));
        assert.deepEqual(presentedPlanOf(sandbox.cwd), { digest: NEXT_DIGEST, base: HELD_DIGEST, turn: "msg_1" });
      });
    });

    for (const activeSlice of ["S2", "wave-1", "debt-sweep"]) {
      test(`a presentation while ${activeSlice} is active is refused and writes nothing`, () => {
        holding("approved", (sandbox) => {
          writeStateValues(sandbox.cwd, OWNER, [`active_slice=${activeSlice}`]);
          refusedWith(sandbox, () => present(sandbox, NEXT_DIGEST, NEXT, "msg_1"), SLICE_STILL_ACTIVE);
        });
      });
    }

    test("a presentation with no plan ever captured is refused", () => {
      withStateSandbox("workspace", (sandbox) => {
        inSandbox(sandbox, () => {
          assert.throws(() => present(sandbox, NEXT_DIGEST, NEXT, "msg_1"), /requires a held plan/);
          assert.equal(sandbox.read(STATE_FILE).kind, "absent");
        });
      });
    });

    type PresentRefusal = Readonly<{
      name: string;
      prepare?: (sandbox: StateSandbox) => unknown;
      attempt: (sandbox: StateSandbox) => unknown;
      refusal: Refusal;
    }>;
    const refusals: readonly PresentRefusal[] = [
      {
        name: "over a cancelled plan",
        prepare: (sandbox) => runCancelApprovedPlan(sandbox.cwd, OWNER, HELD_DIGEST),
        attempt: (sandbox) => present(sandbox, NEXT_DIGEST, NEXT, "msg_1"),
        refusal: /requires a held plan/,
      },
      {
        name: "of other bytes under a presented digest",
        prepare: (sandbox) => present(sandbox, NEXT_DIGEST, NEXT, "msg_1"),
        attempt: (sandbox) => present(sandbox, NEXT_DIGEST, LATER, "msg_2"),
        refusal: /^presented snapshot content disagrees with its approval digest$/,
      },
      {
        name: "of a document whose slice names no Verify check",
        attempt: (sandbox) => present(sandbox, sha256Hex(UNCHECKED), UNCHECKED, "msg_1"),
        refusal: /requires slice S1 to name failing-check: or Verify-exception:/,
      },
      {
        name: "of the document already held",
        attempt: (sandbox) => present(sandbox, HELD_DIGEST, HELD, "msg_1"),
        refusal: /the held plan is already this document/,
      },
      {
        name: "by a session that does not own the gates",
        attempt: (sandbox) => present(sandbox, NEXT_DIGEST, NEXT, "msg_1", ANOTHER_SESSION),
        refusal: GatesOwnedElsewhereError,
      },
    ];
    for (const { name, prepare, attempt, refusal } of refusals) {
      test(`a presentation ${name} is refused and writes nothing`, () => {
        holding("approved", (sandbox) => {
          prepare?.(sandbox);
          refusedWith(sandbox, () => attempt(sandbox), refusal);
        });
      });
    }

    test("presenting the same bytes is idempotent and a different document overwrites only the three keys", () => {
      holding("approved", (sandbox) => {
        const before = observed(sandbox);
        present(sandbox, NEXT_DIGEST, NEXT, "msg_1");
        const once = observed(sandbox);
        assert.equal(present(sandbox, NEXT_DIGEST, NEXT, "msg_1"), 0);
        assert.deepEqual({ ...observed(sandbox), events: once.events }, once);
        present(sandbox, LATER_DIGEST, LATER, "msg_2");
        assert.equal(observed(sandbox).state, withPresentedKeys(before.state, LATER_DIGEST, "msg_2"));
        assert.equal(observed(sandbox).plans[`presented-${NEXT_DIGEST}.md`], NEXT);
      });
    });

    test("a presented record whose snapshot is gone is not recognised", () => {
      holding("approved", (sandbox) => {
        present(sandbox, NEXT_DIGEST, NEXT, "msg_1");
        rmSync(path.join(plansDirectoryOf(sandbox), `presented-${NEXT_DIGEST}.md`));
        assert.equal(presentedPlanOf(sandbox.cwd), undefined);
      });
    });

    test("a capture after a presentation clears the presented keys, and so does abandoning the approved plan", () => {
      holding("approved", (sandbox) => {
        present(sandbox, NEXT_DIGEST, NEXT, "msg_1");
        runCancelApprovedPlan(sandbox.cwd, OWNER, HELD_DIGEST);
        assert.doesNotMatch(observed(sandbox).state, /plan_presented_/);
        runCapturePlan(sandbox.cwd, OWNER, LATER_DIGEST, LATER);
        present(sandbox, NEXT_DIGEST, NEXT, "msg_2");
        runCapturePlan(sandbox.cwd, OWNER, HELD_DIGEST, HELD);
        assert.doesNotMatch(observed(sandbox).state, /plan_presented_/);
        assert.equal(presentedPlanOf(sandbox.cwd), undefined);
      });
    });
  },
);

describe(
  "core/src/state/plan.ts: superseding after the grant promotes the presented plan and keeps every earlier snapshot",
  () => {
    test("the approved plan is superseded, its revision advanced, gates re-armed and presented keys removed", () => {
      holding("approved", (sandbox) => {
        writeStateValues(sandbox.cwd, OWNER, ["auto=running"]);
        runAmendPlan(sandbox.cwd, OWNER, "S1", "keep the receipts\n");
        present(sandbox, LATER_DIGEST, LATER, "msg_1");
        present(sandbox, NEXT_DIGEST, NEXT, "msg_2");
        assert.equal(runSupersedePlan(sandbox.cwd, OWNER, NEXT_DIGEST), 0);
        const directory = plansDirectoryOf(sandbox);
        const after = observed(sandbox);
        assert.deepEqual(after.plans, {
          [`approved-${HELD_DIGEST}.md`]: HELD,
          [`presented-${LATER_DIGEST}.md`]: LATER,
          [`approved-${NEXT_DIGEST}.md`]: NEXT,
          "current.md": NEXT,
        });
        assert.equal(
          after.state,
          [
            "auto=running",
            "mode=plan",
            "active_slice=none",
            "verify_green=false",
            "plan_approval=approved",
            `plan_approval_digest=${NEXT_DIGEST}`,
            `plan_approval_session=${OWNER}`,
            `plan_snapshot_file=${path.join(directory, `approved-${NEXT_DIGEST}.md`)}`,
            `plan_current_file=${path.join(directory, "current.md")}`,
            "plan_revision=2",
            `session=${OWNER}`,
            "",
          ].join("\n"),
        );
        const superseded = new RegExp(`"event":"plan-superseded","command":"${NEXT_DIGEST}"`);
        assert.match(sandbox.eventLogLines().at(-1) ?? "", superseded);
      });
    });

    test("a pending plan never approved is superseded into an approved plan of the new digest", () => {
      holding("pending", (sandbox) => {
        present(sandbox, NEXT_DIGEST, NEXT, "msg_1");
        runSupersedePlan(sandbox.cwd, OWNER, NEXT_DIGEST);
        assert.deepEqual(heldPlanOf(sandbox.cwd), heldAs("approved", NEXT));
        assert.equal(observed(sandbox).plans[`presented-${HELD_DIGEST}.md`], HELD);
      });
    });

    type SupersedeRefusal = Readonly<{
      name: string;
      spoil: (sandbox: StateSandbox) => void;
      digest?: string;
      session?: string;
      skip?: false | string;
      refusal: Refusal;
    }>;
    const refusals: readonly SupersedeRefusal[] = [
      {
        name: "for a digest other than the presented one",
        spoil: () => undefined,
        digest: LATER_DIGEST,
        refusal: /presented plan to carry this digest/,
      },
      {
        name: "when the presented snapshot is missing",
        spoil: (sandbox) => rmSync(path.join(plansDirectoryOf(sandbox), `presented-${NEXT_DIGEST}.md`)),
        refusal: /presented snapshot is missing or unsafe/,
      },
      {
        name: "when the presented snapshot is not private",
        spoil: (sandbox) => chmodSync(path.join(plansDirectoryOf(sandbox), `presented-${NEXT_DIGEST}.md`), 0o644),
        skip: skipUnlessChmodChangesFileMode(),
        refusal: /presented snapshot is missing or unsafe/,
      },
      {
        name: "while a slice is active",
        spoil: (sandbox) => writeStateValues(sandbox.cwd, OWNER, ["active_slice=wave-2"]),
        refusal: SLICE_STILL_ACTIVE,
      },
      {
        name: "for a session that does not own the gates",
        spoil: () => undefined,
        session: ANOTHER_SESSION,
        refusal: GatesOwnedElsewhereError,
      },
    ];
    for (const { name, spoil, digest = NEXT_DIGEST, session = OWNER, skip = false, refusal } of refusals) {
      test(`a supersede ${name} is refused and writes nothing`, { skip }, () => {
        holding("approved", (sandbox) => {
          present(sandbox, NEXT_DIGEST, NEXT, "msg_1");
          spoil(sandbox);
          refusedWith(sandbox, () => runSupersedePlan(sandbox.cwd, session, digest), refusal);
        });
      });
    }
  },
);

describe("core/src/state/plan.ts: the held plan is read from the snapshot its state keys name", () => {
  test("no plan is held before a capture or after a cancellation", () => {
    withStateSandbox("workspace", (sandbox) => {
      inSandbox(sandbox, () => {
        assert.deepEqual(heldPlanOf(sandbox.cwd), { kind: "none" });
        runCapturePlan(sandbox.cwd, OWNER, HELD_DIGEST, HELD);
        runApprovePlan(sandbox.cwd, OWNER, HELD_DIGEST);
        runCancelApprovedPlan(sandbox.cwd, OWNER, HELD_DIGEST);
        assert.deepEqual(heldPlanOf(sandbox.cwd), { kind: "none" });
      });
    });
  });

  test("a pending plan is held as its presented snapshot", () => {
    holding("pending", (sandbox) => {
      assert.deepEqual(heldPlanOf(sandbox.cwd), heldAs("pending", HELD));
    });
  });

  test("a held snapshot that is not private or is gone throws", { skip: skipUnlessChmodChangesFileMode() }, () => {
    holding("approved", (sandbox) => {
      const snapshot = path.join(plansDirectoryOf(sandbox), `approved-${HELD_DIGEST}.md`);
      chmodSync(snapshot, 0o644);
      const namingTheSnapshot = (thrown: unknown) => thrown instanceof PlanFailure && thrown.message.includes(snapshot);
      assert.throws(() => heldPlanOf(sandbox.cwd), namingTheSnapshot);
      rmSync(snapshot);
      assert.throws(() => heldPlanOf(sandbox.cwd), PlanFailure);
    });
  });
});
