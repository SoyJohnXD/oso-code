import assert from "node:assert/strict";
import { renameSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { runApprovePlan, runCapturePlan } from "../../src/state/plan.ts";
import { readValue, sha256Hex, stateFileFor } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SESSION = "test-session";
const THE_PRESENTED_PLAN = "Repaso de cambios\nFull slice plan: alpha\n";
const THE_PLAN_AN_AMENDMENT_MOVED_ON = `${THE_PRESENTED_PLAN}\n## Execution amendment — S1\n`;
const DIGEST_OF_THE_PRESENTED_PLAN = sha256Hex(THE_PRESENTED_PLAN);

type Settlement = { exit: number; approval: string | undefined };

function approvedWithoutANativePresentation(sandbox: StateSandbox): Settlement {
  return withHookEnvironment({ HOME: sandbox.home }, () => {
    runCapturePlan(sandbox.cwd, SESSION, DIGEST_OF_THE_PRESENTED_PLAN, THE_PRESENTED_PLAN);
    const stateFile = stateFileFor(sandbox.cwd);
    const presented = readValue(stateFile, "plan_snapshot_file") as string;
    renameSync(presented, presented.replace("presented-", "approved-"));
    writeFileSync(readValue(stateFile, "plan_current_file") as string, THE_PLAN_AN_AMENDMENT_MOVED_ON);
    return {
      exit: runApprovePlan(sandbox.cwd, SESSION, DIGEST_OF_THE_PRESENTED_PLAN),
      approval: readValue(stateFile, "plan_approval"),
    };
  });
}

describe(
  "core/src/state/plan.ts: an approval that carries no native presentation settles a plan whose presented " +
    "snapshot was already renamed to approved, even once the operational plan diverged from it, because only a " +
    "native approval compares the current document against the published snapshot",
  () => {
    test("a partially published snapshot approves on the path no native presentation binds", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.deepEqual(approvedWithoutANativePresentation(sandbox), { exit: 0, approval: "approved" });
      });
    });
  },
);
