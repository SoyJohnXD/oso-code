import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PlanFailure, runCapturePlan } from "../../src/state/plan.ts";
import { sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { REPOSITORY_PLANS_DIR, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SESSION = "test-session";
const THE_PRESENTED_PLAN = "Repaso de cambios\nFull slice plan: alpha\n";
const A_PLAN_THE_DIGEST_NEVER_NAMED = "Repaso de cambios\nFull slice plan: beta\n";
const DIGEST_OF_THE_PRESENTED_PLAN = sha256Hex(THE_PRESENTED_PLAN);
const A_DIGEST_NO_DOCUMENT_PRODUCED = sha256Hex("a label this repository never derived from a plan");

function captured(sandbox: StateSandbox, digest: string, document: string): number {
  return withHookEnvironment({ HOME: sandbox.home }, () => runCapturePlan(sandbox.cwd, SESSION, digest, document));
}

function presentedSnapshotOf(sandbox: StateSandbox, digest: string): string {
  const snapshot = sandbox.read(`${REPOSITORY_PLANS_DIR}/presented-${digest}.md`);
  return snapshot.kind === "file" ? snapshot.content : `<${snapshot.kind}>`;
}

describe(
  "core/src/state/plan.ts: what binds a capture's digest to its document is the presented snapshot already " +
    "written under that digest, so a second capture naming the same digest for another document is refused " +
    "and the snapshot is left byte-identical",
  () => {
    test("the first capture writes the snapshot its digest labels", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.equal(captured(sandbox, DIGEST_OF_THE_PRESENTED_PLAN, THE_PRESENTED_PLAN), 0);
        assert.equal(presentedSnapshotOf(sandbox, DIGEST_OF_THE_PRESENTED_PLAN), THE_PRESENTED_PLAN);
      });
    });

    test("recapturing the same document under the same digest is idempotent", () => {
      withStateSandbox("workspace", (sandbox) => {
        captured(sandbox, DIGEST_OF_THE_PRESENTED_PLAN, THE_PRESENTED_PLAN);
        assert.equal(captured(sandbox, DIGEST_OF_THE_PRESENTED_PLAN, THE_PRESENTED_PLAN), 0);
        assert.equal(presentedSnapshotOf(sandbox, DIGEST_OF_THE_PRESENTED_PLAN), THE_PRESENTED_PLAN);
      });
    });

    test("a second document offered under that digest is refused and changes nothing", () => {
      withStateSandbox("workspace", (sandbox) => {
        captured(sandbox, DIGEST_OF_THE_PRESENTED_PLAN, THE_PRESENTED_PLAN);
        assert.throws(
          () => captured(sandbox, DIGEST_OF_THE_PRESENTED_PLAN, A_PLAN_THE_DIGEST_NEVER_NAMED),
          (thrown: unknown) =>
            thrown instanceof PlanFailure &&
            thrown.message === "presented snapshot content disagrees with its approval digest",
        );
        assert.equal(presentedSnapshotOf(sandbox, DIGEST_OF_THE_PRESENTED_PLAN), THE_PRESENTED_PLAN);
      });
    });

    test("a first capture under a digest no document produced is accepted, so nothing here hashes the document", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.equal(captured(sandbox, A_DIGEST_NO_DOCUMENT_PRODUCED, THE_PRESENTED_PLAN), 0);
        assert.equal(presentedSnapshotOf(sandbox, A_DIGEST_NO_DOCUMENT_PRODUCED), THE_PRESENTED_PLAN);
      });
    });
  },
);
