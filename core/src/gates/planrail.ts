import { PlanApprovalError, PlanFailure } from "../state/plan.ts";
import { LockTimeoutError, StateFileUnreadableError } from "../state/store.ts";

export function isPlanRailFailure(cause: unknown): cause is Error {
  return (
    cause instanceof PlanFailure ||
    cause instanceof PlanApprovalError ||
    cause instanceof StateFileUnreadableError ||
    cause instanceof LockTimeoutError
  );
}
