import { compareVersionsAscending } from "./verify-claude.ts";

export const SUPPORTED_ENGRAM_VERSION = "1.20.0";
export const SUPPORTED_CODEX_VERSION = "0.146.0";
export const SUPPORTED_OPENCODE_VERSION = "1.18.22";

const DOTTED_NUMERIC_VERSION = /^\d+(\.\d+)*$/;

export function meetsVersionFloor(found: string | undefined, floor: string): boolean {
  if (found === undefined || !DOTTED_NUMERIC_VERSION.test(found)) return false;
  return compareVersionsAscending(found, floor) >= 0;
}

export function isAboveTestedVersion(found: string | undefined, tested: string): boolean {
  if (found === undefined || !DOTTED_NUMERIC_VERSION.test(found)) return false;
  return compareVersionsAscending(found, tested) > 0;
}
