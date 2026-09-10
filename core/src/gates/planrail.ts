import { PlanApprovalError, PlanFailure } from "../state/plan.ts";
import { LockTimeoutError, StateFileUnreadableError, isErrnoException, readValue } from "../state/store.ts";
import { stateFileIfNamed } from "./preflight.ts";

const EXECUTION_AMENDMENT_LANE =
  "An approved plan is already executing here, so its `current.md` is what changes, not the approval: pipe the " +
  "complete slice block to `oso-state --session <id> amend-plan <slice-id>` — on the operator's own request for a " +
  "hot slice, or on one operator confirmation of a cited correction to a slice that has not started. Only a change " +
  "to frozen intent, scope or a ledger decision returns to native Plan Mode for a COMPLETE replacement " +
  "proposed_plan.";

const FRESH_CAPTURE_LANE =
  "No approved plan is executing here, so a fresh capture is what binds the document: present one COMPLETE " +
  "replacement proposed_plan in native Plan Mode, carrying every unchanged section, then the internal approval " +
  "marker.";

export function laneOutOfThePlanRail(cwd: string, sessionId: string): string {
  const stateFile = stateFileIfNamed(cwd);
  if (stateFile === undefined) return FRESH_CAPTURE_LANE;
  const owned = readValue(stateFile, "plan_approval_session") === sessionId;
  return owned && readValue(stateFile, "plan_approval") === "approved" ? EXECUTION_AMENDMENT_LANE : FRESH_CAPTURE_LANE;
}

export function isPlanRailFailure(cause: unknown): cause is Error {
  return (
    cause instanceof PlanFailure ||
    cause instanceof PlanApprovalError ||
    cause instanceof StateFileUnreadableError ||
    cause instanceof LockTimeoutError
  );
}

export function nativePlanFailureCode(cause: unknown): string {
  if (cause instanceof PlanFailure && cause.code !== undefined) return cause.code;
  if (cause instanceof LockTimeoutError) return "state-lock-timeout";
  if (cause instanceof StateFileUnreadableError) return "state-file-unreadable";
  if (isErrnoException(cause) && ["EACCES", "EPERM", "ENOENT", "EEXIST", "ENOTDIR", "EISDIR", "ENOSPC", "EROFS", "EIO", "EMFILE", "ENFILE", "ELOOP"].includes(cause.code ?? "")) return `storage-${cause.code?.toLowerCase()}`;
  throw cause;
}
