import { readValue, stateFileFor, writeStateValues } from "@oso-code/core";

export type PlanApprovalState =
  | { kind: "approved"; digest: string }
  | { kind: "unapproved"; detail: string };

export function cancelApprovedPlan(directory: string, owner: string): void {
  writeStateValues(directory, owner, [
    "mode=plan",
    "active_slice=none",
    "verify_green=false",
    "plan_approval=cancelled",
  ]);
}

export function approvedPlanFor(directory: string, owner: string): PlanApprovalState {
  const approval = stateKeyOf(directory, "plan_approval");
  if (approval !== "approved") {
    return {
      kind: "unapproved",
      detail: `this repository's plan approval reads ${approval === "" ? "nothing at all" : `"${approval}"`}`,
    };
  }
  const presenter = stateKeyOf(directory, "plan_approval_session");
  if (presenter !== owner) {
    return {
      kind: "unapproved",
      detail: `the approved plan is owned by ${presenter === "" ? "no recorded identity" : presenter}, not by ${owner}`,
    };
  }
  return { kind: "approved", digest: stateKeyOf(directory, "plan_approval_digest") };
}

function stateKeyOf(directory: string, key: string): string {
  return readValue(stateFileFor(directory), key) ?? "";
}
