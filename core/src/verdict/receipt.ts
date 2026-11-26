import {
  isMarkerOf,
  isVerifierRecord,
  newestArmingOf,
  readVerdicts,
  RISK_HIGH_DISCARDED,
  type VerdictRecord,
  verifierRecordsSinceArm,
} from "./record.ts";
import { newestWaveNamed, readWaveLog } from "./wave.ts";

export type GreenReceipt =
  | Readonly<{ kind: "unguarded" }>
  | Readonly<{ kind: "receipted" }>
  | Readonly<{ kind: "unreceipted"; slice: string }>
  | Readonly<{ kind: "refused"; reason: string }>;

export type ReceiptFiles = Readonly<{ verdictsFile: string; wavesFile: string }>;

const WAVE_SLICE_PREFIX = "wave-";

export function greenReceiptOf(
  files: ReceiptFiles,
  preWriteSlice: string,
  written: ReadonlyMap<string, string>,
): GreenReceipt {
  if (written.get("verify_green") !== "true" || preWriteSlice === "none") return { kind: "unguarded" };
  const named = written.get("green_slice");
  if (named !== undefined && namesAWindowOf(preWriteSlice, written)) return namedWindowReceipt(files, preWriteSlice, named);
  if (keepsTheWaveArmed(preWriteSlice, written)) return { kind: "unreceipted", slice: preWriteSlice };
  const newest = verifierRecordsSinceArm(readVerdicts(files.verdictsFile).entries, preWriteSlice).at(-1);
  if (newest === undefined) return { kind: "unreceipted", slice: preWriteSlice };
  if (newest.verdict === "pass" && newest.verdict_shape === "valid") return { kind: "receipted" };
  return { kind: "refused", reason: refusalReason(preWriteSlice, newest) };
}

function namedWindowReceipt(files: ReceiptFiles, wave: string, slice: string): GreenReceipt {
  const started = newestWaveNamed(readWaveLog(files.wavesFile), wave);
  if (started === undefined || !started.slices.some((member) => member.slice === slice)) {
    return { kind: "refused", reason: `slice ${slice} is not in the started ${wave}` };
  }
  const arming = newestArmingOf(readVerdicts(files.verdictsFile).entries, slice);
  const newest = arming.filter(isVerifierRecord).at(-1);
  if (newest === undefined) {
    return { kind: "refused", reason: `slice ${slice} has no verifier record since its arm` };
  }
  if (newest.verdict !== "pass" || newest.verdict_shape !== "valid") {
    return { kind: "refused", reason: refusalReason(slice, newest) };
  }
  if (arming.slice(arming.indexOf(newest) + 1).some((entry) => isMarkerOf(RISK_HIGH_DISCARDED, entry))) {
    return { kind: "refused", reason: `slice ${slice} carries a ${RISK_HIGH_DISCARDED} marker newer than its pass and is verified solo` };
  }
  return { kind: "receipted" };
}

function namesAWindowOf(preWriteSlice: string, written: ReadonlyMap<string, string>): boolean {
  const slice = written.get("active_slice") ?? preWriteSlice;
  return preWriteSlice.startsWith(WAVE_SLICE_PREFIX) && slice === preWriteSlice;
}

function keepsTheWaveArmed(preWriteSlice: string, written: ReadonlyMap<string, string>): boolean {
  return preWriteSlice.startsWith(WAVE_SLICE_PREFIX) && written.get("active_slice") === preWriteSlice;
}

function refusalReason(slice: string, record: VerdictRecord): string {
  const verdict = record.verdict_shape === "malformed" ? "malformed" : record.verdict;
  return `the newest verifier record of slice ${slice} is ${verdict}: ${JSON.stringify(record)}`;
}
