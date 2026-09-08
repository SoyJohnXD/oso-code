import { PlanApprovalError, PlanFailure } from "../state/plan.ts";
import { LockTimeoutError, StateFileUnreadableError, isErrnoException } from "../state/store.ts";

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
