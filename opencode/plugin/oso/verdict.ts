export type AgentStatus = "done" | "blocked";
export type AgentVerdictValue = "pass" | "fail";

export interface ParsedAgentVerdict {
  status?: AgentStatus;
  verdict?: AgentVerdictValue;
  matched: boolean;
}

const STATUS_LINE = /^\s*status\s*:\s*(done|blocked)\s*$/i;
const VERDICT_LINE = /^\s*verdict\s*:\s*(pass|fail)\s*$/i;

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
      parsed.verdict = verdictMatch[1]!.toLowerCase() as AgentVerdictValue;
      parsed.matched = true;
    }
  }
  return parsed;
}
