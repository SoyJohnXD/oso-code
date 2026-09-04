import type { LexedCommand } from "../../../src/shell/lexed-command.ts";
import { isResidueCall } from "../../../src/shell/lexed-command.ts";
import { basenameOf } from "../../../src/shell/lexer.ts";
import { lineVerdict } from "../../../src/shell/line-verdict.ts";
import { isRecord } from "./config-fields.ts";
import { sessionParts } from "./session-transcript.ts";

const CALLED = "called";
const RESIDUE = "residue";
type GatedVerbVerdict = typeof CALLED | typeof RESIDUE;

export type GatedVerbReachForm = "lexed" | "residue" | "none";

const OUTCOME_STRENGTH: Readonly<Record<string, number>> = { executed: 4, refused: 3, errored: 2, unfinished: 1 };

export type GatedCallReport = Readonly<{ reachForm: GatedVerbReachForm; outcome: string }>;

function commandCallsTheGatedVerb(command: LexedCommand, gatedVerbWords: readonly string[]): boolean {
  return gatedVerbWords.every((word) => command.tokens.some((token) => basenameOf(token) === word));
}

export function gatedVerbReachForm(commandLine: string, gatedVerbWords: readonly string[]): GatedVerbReachForm {
  const verdict = lineVerdict<GatedVerbVerdict>(commandLine, (command, current) => {
    if (commandCallsTheGatedVerb(command, gatedVerbWords)) return CALLED;
    if (current === "clear" && isResidueCall(command, gatedVerbWords)) return RESIDUE;
    return current;
  });
  if (verdict === CALLED) return "lexed";
  if (verdict === RESIDUE || verdict === "unread") return "residue";
  return "none";
}

function collapsedWhitespace(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
}

type BashToolCall = Readonly<{ status: string; command: string; error: string }>;

function bashToolCallFrom(part: Readonly<Record<string, unknown>>): BashToolCall | undefined {
  if (part["type"] !== "tool" || part["tool"] !== "bash") return undefined;
  const state = isRecord(part["state"]) ? part["state"] : {};
  const input = isRecord(state["input"]) ? state["input"] : {};
  const command = input["command"];
  const error = state["error"];
  return {
    status: String(state["status"]),
    command: typeof command === "string" ? command : "",
    error: collapsedWhitespace(typeof error === "string" ? error : ""),
  };
}

function callOutcome(status: string, errorText: string, denyMarker: string): string {
  if (status === "completed") return "executed";
  if (status === "error") return errorText.includes(denyMarker) ? "refused" : `errored:${errorText.slice(0, 120)}`;
  return `unfinished:${status}`;
}

function outcomeStrength(outcome: string): number {
  return OUTCOME_STRENGTH[outcome.split(":")[0] as string] ?? 0;
}

function strongerOutcome(held: string, candidate: string): string {
  return outcomeStrength(candidate) > outcomeStrength(held) ? candidate : held;
}

export function gatedCallReport(streamText: string, denyMarker: string, gatedVerbWords: readonly string[]): GatedCallReport {
  const parts = sessionParts(streamText);
  if (parts.length === 0) return { reachForm: "none", outcome: "no-session" };
  const gatedVerbPhrase = gatedVerbWords.join(" ");
  let lexedOutcome = "";
  let residueOutcome = "";
  let mentioned = false;
  for (const part of parts) {
    const call = bashToolCallFrom(part);
    if (call === undefined) continue;
    const reachForm = gatedVerbReachForm(call.command, gatedVerbWords);
    if (reachForm === "none") {
      if (call.command.includes(gatedVerbPhrase)) mentioned = true;
      continue;
    }
    const outcome = callOutcome(call.status, call.error, denyMarker);
    if (reachForm === "lexed") lexedOutcome = strongerOutcome(lexedOutcome, outcome);
    else residueOutcome = strongerOutcome(residueOutcome, outcome);
  }
  if (lexedOutcome !== "") return { reachForm: "lexed", outcome: lexedOutcome };
  if (residueOutcome !== "") return { reachForm: "residue", outcome: residueOutcome };
  return { reachForm: "none", outcome: mentioned ? "mentioned-only" : "not-attempted" };
}
