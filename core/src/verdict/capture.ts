import { VERIFIER_AGENT } from "../prose/routes.ts";
import type { HostName } from "../routes/routes.ts";
import {
  causeOf,
  isDirectory,
  logEvent,
  readFileIfPresent,
  recordedStateValue,
  stateFileFor,
} from "../state/store.ts";
import { readLaunchToken, readSliceBlocks, readVerdictShape, type SliceBlockReading, type VerdictReading } from "./grammar.ts";
import {
  appendMarker,
  appendVerdict,
  RISK_HIGH_DISCARDED,
  TELEMETRY_WRITE_FAILED,
  type VerdictCapture,
  VERIFIER_ROLE,
  verdictsFileFor,
} from "./record.ts";
import { type LaunchToken, readWaveLog, wavesFileFor } from "./wave.ts";

const VERDICT_BLOCK_REJECTED = "verdict-block-rejected";

const MALFORMED_READING = { verdict: "none", verdict_shape: "malformed" } as const;

export type VerifierReport = Readonly<{
  host: HostName;
  cwd: string;
  session: string;
  model: string | null;
  report: string;
}>;

export function isVerifierAgent(agentType: string): boolean {
  return agentType === VERIFIER_AGENT || agentType.endsWith(`:${VERIFIER_AGENT}`);
}

export function captureVerifierReport(report: VerifierReport): void {
  try {
    appendReportToItsRepository(report);
  } catch (error) {
    logEvent({ event: TELEMETRY_WRITE_FAILED, session: report.session, command: causeOf(error) });
  }
}

function appendReportToItsRepository({ host, cwd, session, model, report }: VerifierReport): void {
  if (!isDirectory(cwd)) return;
  const stateFile = stateFileFor(cwd);
  const state = readFileIfPresent(stateFile);
  if (state === undefined) return;
  const verdictsFile = verdictsFileFor(stateFile);
  const change = recordedStateValue(state, "auto_change");
  const base = { host, session, change, role: VERIFIER_ROLE, model };
  const tokenName = readLaunchToken(report);
  if (tokenName === undefined) {
    appendVerdict(verdictsFile, { ...base, slice: recordedStateValue(state, "active_slice"), ...readVerdictShape(report) });
    return;
  }
  const token = readWaveLog(wavesFileFor(stateFile)).tokens.filter((registered) => registered.token === tokenName).at(-1);
  if (token === undefined) {
    logEvent({ event: VERDICT_BLOCK_REJECTED, session, command: `token ${tokenName} is not registered` });
    return;
  }
  const blocks = readSliceBlocks(report);
  for (const block of blocks) {
    if (block.slice !== undefined && !token.slices.includes(block.slice)) {
      logEvent({ event: VERDICT_BLOCK_REJECTED, session, command: `slice ${block.slice} is not under token ${token.token}` });
    }
  }
  for (const slice of token.slices) {
    const block = blocks.find((candidate) => candidate.slice === slice);
    if (block?.verdict_shape === "valid" && block.risk !== undefined) {
      appendMarker(verdictsFile, { kind: RISK_HIGH_DISCARDED, slice, session, change });
      continue;
    }
    appendVerdict(verdictsFile, tokenRecordOf({ ...base, slice }, token, block));
  }
}

function tokenRecordOf(base: Omit<VerdictCapture, "verdict" | "verdict_shape">, token: LaunchToken, block: SliceBlockReading | undefined): VerdictCapture {
  const reading: VerdictReading =
    block?.verdict_shape === "valid" ? { verdict: block.verdict, verdict_shape: "valid" } : MALFORMED_READING;
  return { ...base, ...reading, batch: token.slices.length };
}
