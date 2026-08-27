import type { LoggedEvent } from "../state/store.ts";
import { MAX_LEXED_INPUT_BYTES } from "../shell/lexer.ts";

export type HookEnvelope = Readonly<{
  sessionId: string;
  cwd: string;
  toolName: string;
  filePath: string;
  commandLine: string;
}>;

export type GateVerdict =
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "allow" }
  | { readonly kind: "context"; readonly additionalContext: string }
  | { readonly kind: "push"; readonly reason: string }
  | { readonly kind: "gateError"; readonly subject: string }
  | { readonly kind: "noVerdict" };

export type PreToolUseVerdict = Extract<GateVerdict, { kind: "deny" | "allow" | "gateError" }>;

export type GateOutcome = Readonly<{
  verdict: PreToolUseVerdict;
  events: readonly LoggedEvent[];
}>;

export const ALLOWED: GateOutcome = { verdict: { kind: "allow" }, events: [] };

const JSON_SPACE = "[\\t\\n\\v\\f\\r ]";

export function readEnvelope(payload: string): HookEnvelope {
  return {
    sessionId: jsonField(payload, "session_id"),
    cwd: jsonField(payload, "cwd"),
    toolName: jsonField(payload, "tool_name"),
    filePath: jsonField(payload, "file_path"),
    commandLine: jsonCommandLine(payload),
  };
}

function jsonCommandLine(payload: string): string {
  const escaped = escapedField(payload, "command");
  if ([...escaped].length > MAX_LEXED_INPUT_BYTES) return escaped;
  return jsonField(payload, "command");
}

function jsonField(payload: string, field: string): string {
  return withoutCarriageReturns(unescapeJsonString(escapedField(payload, field)));
}

function escapedField(payload: string, field: string): string {
  const pattern = new RegExp(`"${field}"${JSON_SPACE}*:${JSON_SPACE}*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`);
  return pattern.exec(payload)?.[1] ?? "";
}

const NAMED_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
};

function unescapeJsonString(escaped: string): string {
  let decoded = "";
  let rest = escaped;
  while (rest !== "") {
    const backslash = rest.indexOf("\\");
    if (backslash === -1) return decoded + rest;
    decoded += rest.slice(0, backslash);
    const escape = rest.slice(backslash + 1, backslash + 2);
    decoded += NAMED_ESCAPES[escape] ?? escape;
    rest = rest.slice(backslash + 2);
  }
  return decoded;
}

function withoutCarriageReturns(value: string): string {
  let settled = value;
  for (;;) {
    const collapsed = settled.replaceAll("\r\n", "\n");
    if (collapsed === settled) return settled.replace(/\r$/, "");
    settled = collapsed;
  }
}
