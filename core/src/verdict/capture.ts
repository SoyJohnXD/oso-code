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
  BATCH_BLOCKED,
  RISK_HIGH_DISCARDED,
  TELEMETRY_WRITE_FAILED,
  type VerdictCapture,
  VERIFIER_ROLE,
  verdictsFileFor,
} from "./record.ts";
import { isBatchSize, type LaunchToken, readWaveLog, wavesFileFor } from "./wave.ts";

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

type CaptureContext = Readonly<{
  verdictsFile: string;
  wavesFile: string;
  session: string;
  change: string | null;
  base: Omit<VerdictCapture, "slice" | "verdict" | "verdict_shape">;
}>;

function appendReportToItsRepository({ host, cwd, session, model, report }: VerifierReport): void {
  if (!isDirectory(cwd)) return;
  const stateFile = stateFileFor(cwd);
  const state = readFileIfPresent(stateFile);
  if (state === undefined) return;
  const change = recordedStateValue(state, "auto_change");
  const context: CaptureContext = {
    verdictsFile: verdictsFileFor(stateFile),
    wavesFile: wavesFileFor(stateFile),
    session,
    change,
    base: { host, session, change, role: VERIFIER_ROLE, model },
  };
  const tokenName = readLaunchToken(report);
  if (tokenName === undefined) appendSingleVerdict(context, report, recordedStateValue(state, "active_slice"));
  else appendTokenBlocks(context, report, tokenName);
}

function appendSingleVerdict({ verdictsFile, base }: CaptureContext, report: string, slice: string | null): void {
  appendVerdict(verdictsFile, { ...base, slice, ...readVerdictShape(report) });
}

function appendTokenBlocks(context: CaptureContext, report: string, tokenName: string): void {
  const { verdictsFile, wavesFile, session, change, base } = context;
  const token = readWaveLog(wavesFile).tokens.filter((registered) => registered.token === tokenName).at(-1);
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
  const batchBlocked = blocks.length === 0 && readVerdictShape(report).verdict === "blocked";
  for (const slice of token.slices) {
    if (batchBlocked) {
      appendMarker(verdictsFile, { kind: BATCH_BLOCKED, slice, session, change });
      continue;
    }
    const block = blocks.find((candidate) => candidate.slice === slice);
    if (discardsHighRisk(block, token)) {
      appendMarker(verdictsFile, { kind: RISK_HIGH_DISCARDED, slice, session, change });
      continue;
    }
    appendVerdict(verdictsFile, tokenRecordOf({ ...base, slice }, token, block));
  }
}

function discardsHighRisk(block: SliceBlockReading | undefined, token: LaunchToken): boolean {
  return block?.verdict_shape === "valid" && block.highRisk === true && isBatchSize(token.slices.length);
}

function tokenRecordOf(base: Omit<VerdictCapture, "verdict" | "verdict_shape">, token: LaunchToken, block: SliceBlockReading | undefined): VerdictCapture {
  const reading: VerdictReading =
    block?.verdict_shape === "valid" ? { verdict: block.verdict, verdict_shape: "valid" } : MALFORMED_READING;
  return { ...base, ...reading, batch: token.slices.length };
}
