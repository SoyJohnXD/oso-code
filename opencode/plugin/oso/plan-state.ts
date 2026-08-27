import { join } from "node:path";
import { resolveStateBin, spawnStateBin } from "./gates.ts";
import { repoStateDir } from "./plan.ts";

export interface ApprovedPlan {
  directory: string;
  commonDir: string;
  owner: string;
  digest: string;
}

export type PlanApprovalState =
  | { kind: "approved"; digest: string }
  | { kind: "unapproved"; detail: string };

export function armApprovedPlan(plan: ApprovedPlan): void {
  const artifacts = repoStateDir(plan.commonDir);
  publishStatePairs(plan.directory, plan.owner, [
    "mode=plan",
    "plan_approval=approved",
    `plan_approval_digest=${plan.digest}`,
    `plan_approval_session=${plan.owner}`,
    `plan_snapshot_file=${join(artifacts, `approved-${plan.digest}.md`)}`,
    `plan_current_file=${join(artifacts, "current.md")}`,
    "plan_revision=0",
  ]);
}

export function cancelApprovedPlan(directory: string, owner: string): void {
  publishStatePairs(directory, owner, [
    "mode=plan",
    "active_slice=none",
    "verify_green=false",
    "plan_approval=cancelled",
  ]);
}

export function approvedPlanFor(directory: string, owner: string): PlanApprovalState {
  const approval = readStateKey(directory, owner, "plan_approval");
  if (approval !== "approved") {
    return {
      kind: "unapproved",
      detail: `this repository's plan approval reads ${approval === "" ? "nothing at all" : `"${approval}"`}`,
    };
  }
  const presenter = readStateKey(directory, owner, "plan_approval_session");
  if (presenter !== owner) {
    return {
      kind: "unapproved",
      detail: `the approved plan is owned by ${presenter === "" ? "no recorded identity" : presenter}, not by ${owner}`,
    };
  }
  return { kind: "approved", digest: readStateKey(directory, owner, "plan_approval_digest") };
}

function publishStatePairs(directory: string, owner: string, pairs: readonly string[]): void {
  runStateCommand(directory, owner, ["set", ...pairs]);
}

function readStateKey(directory: string, owner: string, key: string): string {
  return runStateCommand(directory, owner, ["get", key]).trim();
}

export function runStateCommand(directory: string, owner: string, args: readonly string[]): string {
  const stateBin = resolveStateBin();
  const verb = args[0] ?? "";
  const run = spawnStateBin(stateBin, ["--session", owner, ...args], { cwd: directory, encoding: "utf8" });
  if (run.error !== undefined) {
    throw new Error(`oso-code could not run "${stateBin} ${verb}": ${run.error.message}`);
  }
  if (run.status !== 0) {
    const detail = (run.stderr ?? "").trim();
    throw new Error(`oso-code could not run "${stateBin} ${verb}": ${detail || `it exited ${run.status}`}`);
  }
  return run.stdout ?? "";
}
