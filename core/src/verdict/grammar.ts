export type AgentStatus = "done" | "blocked";
export type VerdictValue = "pass" | "fail" | "blocked";

export const RECORDED_VERDICTS = ["pass", "fail", "blocked", "none"] as const;
export type RecordedVerdict = (typeof RECORDED_VERDICTS)[number];

export interface ParsedAgentVerdict {
  status?: AgentStatus;
  verdict?: VerdictValue;
}

export type VerdictReading =
  | { verdict: VerdictValue; verdict_shape: "valid" }
  | { verdict: "none"; verdict_shape: "malformed" };

export const VERDICT_SHAPES = ["valid", "malformed"] as const;
export type VerdictShape = (typeof VERDICT_SHAPES)[number];

const STATUS_LINE = /^\s*status\s*:\s*(done|blocked)\s*$/i;
const VERDICT_LINE = /^\s*verdict\s*:\s*(pass|fail|blocked)\s*$/i;

export function parseAgentVerdict(text: string): ParsedAgentVerdict {
  const parsed: ParsedAgentVerdict = {};
  for (const line of text.split(/\r?\n/)) {
    const statusMatch = line.match(STATUS_LINE);
    if (statusMatch !== null) {
      parsed.status = statusMatch[1]!.toLowerCase() as AgentStatus;
      continue;
    }
    const verdictMatch = line.match(VERDICT_LINE);
    if (verdictMatch !== null) parsed.verdict = verdictMatch[1]!.toLowerCase() as VerdictValue;
  }
  return parsed;
}

export function readVerdictShape(text: string): VerdictReading {
  const { verdict } = parseAgentVerdict(text);
  return verdict === undefined ? { verdict: "none", verdict_shape: "malformed" } : { verdict, verdict_shape: "valid" };
}

export type SliceBlockReading =
  | { slice: string; verdict: VerdictValue; verdict_shape: "valid"; highRisk?: true }
  | { slice?: string; verdict: "none"; verdict_shape: "malformed" };

const SLICE_LINE = /^\s*slice\s*:\s*(.*?)\s*$/i;
const ID_SHAPE = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SLICE_ID = new RegExp(`^${ID_SHAPE}$`);
const RISK_HIGH_LINE = /^\s*risk\s*:\s*high(?:\s.*)?$/i;

export function isSliceId(value: string): boolean {
  return SLICE_ID.test(value);
}

const TOKEN_LINE = new RegExp(`^\\s*token\\s*:\\s*(${ID_SHAPE})\\s*$`, "i");

export function readLaunchToken(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(TOKEN_LINE)?.[1])
    .find((token) => token !== undefined);
}

export function readSliceBlocks(text: string): SliceBlockReading[] {
  const readings: SliceBlockReading[] = [];
  let block: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (SLICE_LINE.test(line)) {
      if (block !== undefined) readings.push(readSliceBlock(block));
      block = [line];
      continue;
    }
    block?.push(line);
  }
  if (block !== undefined) readings.push(readSliceBlock(block));
  return readings;
}

function readSliceBlock(lines: string[]): SliceBlockReading {
  const id = lines[0]!.match(SLICE_LINE)![1]!;
  if (!isSliceId(id)) return { verdict: "none", verdict_shape: "malformed" };
  const reading = readVerdictShape(lines.join("\n"));
  if (reading.verdict_shape === "malformed") return { slice: id, ...reading };
  if (!lines.some((line) => RISK_HIGH_LINE.test(line))) return { slice: id, ...reading };
  return { slice: id, ...reading, highRisk: true };
}
