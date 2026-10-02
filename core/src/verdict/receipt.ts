import { readVerdicts, type VerdictRecord, verifierRecordsSinceArm } from "./record.ts";

export type GreenReceipt =
  | Readonly<{ kind: "unguarded" }>
  | Readonly<{ kind: "receipted" }>
  | Readonly<{ kind: "unreceipted"; slice: string }>
  | Readonly<{ kind: "refused"; reason: string }>;

const WAVE_SLICE_PREFIX = "wave-";

export function greenReceiptOf(
  verdictsFile: string,
  preWriteSlice: string,
  written: ReadonlyMap<string, string>,
): GreenReceipt {
  if (written.get("verify_green") !== "true" || preWriteSlice === "none") return { kind: "unguarded" };
  if (keepsTheWaveArmed(preWriteSlice, written)) return { kind: "unreceipted", slice: preWriteSlice };
  const newest = verifierRecordsSinceArm(readVerdicts(verdictsFile).entries, preWriteSlice).at(-1);
  if (newest === undefined) return { kind: "unreceipted", slice: preWriteSlice };
  if (newest.verdict === "pass" && newest.verdict_shape === "valid") return { kind: "receipted" };
  return { kind: "refused", reason: refusalReason(preWriteSlice, newest) };
}

function keepsTheWaveArmed(preWriteSlice: string, written: ReadonlyMap<string, string>): boolean {
  return preWriteSlice.startsWith(WAVE_SLICE_PREFIX) && written.get("active_slice") === preWriteSlice;
}

function refusalReason(slice: string, record: VerdictRecord): string {
  const verdict = record.verdict_shape === "malformed" ? "malformed" : record.verdict;
  return `the newest verifier record of slice ${slice} is ${verdict}: ${JSON.stringify(record)}`;
}
