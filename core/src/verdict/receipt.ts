import { readVerdicts, type VerdictRecord, verifierRecordsSinceArm } from "./record.ts";

export type GreenReceipt =
  | Readonly<{ kind: "unguarded" }>
  | Readonly<{ kind: "receipted" }>
  | Readonly<{ kind: "unreceipted"; slice: string }>
  | Readonly<{ kind: "refused"; reason: string }>;

export function greenReceiptOf(verdictsFile: string, preWriteSlice: string): GreenReceipt {
  if (preWriteSlice === "none") return { kind: "unguarded" };
  const newest = verifierRecordsSinceArm(readVerdicts(verdictsFile).entries, preWriteSlice).at(-1);
  if (newest === undefined) return { kind: "unreceipted", slice: preWriteSlice };
  if (newest.verdict === "pass" && newest.verdict_shape === "valid") return { kind: "receipted" };
  return { kind: "refused", reason: refusalReason(preWriteSlice, newest) };
}

function refusalReason(slice: string, record: VerdictRecord): string {
  const verdict = record.verdict_shape === "malformed" ? "malformed" : record.verdict;
  return `the newest verifier record of slice ${slice} is ${verdict}: ${JSON.stringify(record)}`;
}
