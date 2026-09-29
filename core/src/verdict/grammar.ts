export type AgentStatus = "done" | "blocked";
export type VerdictValue = "pass" | "fail" | "blocked";

export const RECORDED_VERDICTS = ["pass", "fail", "blocked", "none"] as const;
export type RecordedVerdict = (typeof RECORDED_VERDICTS)[number];

export interface ParsedAgentVerdict {
  status?: AgentStatus;
  verdict?: VerdictValue;
  matched: boolean;
}

export type VerdictReading =
  | { verdict: VerdictValue; verdict_shape: "valid" }
  | { verdict: "none"; verdict_shape: "malformed" };

export const VERDICT_SHAPES = ["valid", "malformed"] as const;
export type VerdictShape = (typeof VERDICT_SHAPES)[number];

const STATUS_LINE = /^\s*status\s*:\s*(done|blocked)\s*$/i;
const VERDICT_LINE = /^\s*verdict\s*:\s*(pass|fail|blocked)\s*$/i;

export function parseAgentVerdict(text: string): ParsedAgentVerdict {
  const parsed: ParsedAgentVerdict = { matched: false };
  for (const line of text.split(/\r?\n/)) {
    const statusMatch = line.match(STATUS_LINE);
    if (statusMatch !== null) {
      parsed.status = statusMatch[1]!.toLowerCase() as AgentStatus;
      parsed.matched = true;
      continue;
    }
    const verdictMatch = line.match(VERDICT_LINE);
    if (verdictMatch !== null) {
      parsed.verdict = verdictMatch[1]!.toLowerCase() as VerdictValue;
      parsed.matched = true;
    }
  }
  return parsed;
}

export function readVerdictShape(text: string): VerdictReading {
  const { verdict } = parseAgentVerdict(text);
  return verdict === undefined ? { verdict: "none", verdict_shape: "malformed" } : { verdict, verdict_shape: "valid" };
}
