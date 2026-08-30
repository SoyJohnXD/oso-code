import type { HostName } from "../routes/routes.ts";
import type { LoggedEvent } from "../state/store.ts";
import { MAX_LEXED_INPUT_BYTES } from "../shell/lexer.ts";

export type HookCaller = Readonly<{ host: HostName; agentSession: string; stateBin: string }>;

export type PayloadRead = ParsedPayload["kind"];

export type HookEnvelope = Readonly<{
  caller: HookCaller;
  payloadRead: PayloadRead;
  sessionId: string;
  cwd: string;
  toolName: string;
  filePath: string;
  commandLine: string;
  source: string;
  agentId: string;
  agentType: string;
  permissionMode: string;
  transcriptPath: string;
  turnId: string;
  lastAssistantMessage: string;
  escapedLastAssistantMessage: string;
  prompt: string;
  escapedPrompt: string;
  stopHookActive: boolean;
}>;

export type GateVerdict =
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "allow" }
  | { readonly kind: "context"; readonly additionalContext: string }
  | { readonly kind: "push"; readonly reason: string }
  | { readonly kind: "gateError"; readonly subject: string }
  | { readonly kind: "noVerdict" };

export type PreToolUseVerdict = Extract<GateVerdict, { kind: "deny" | "allow" | "gateError" }>;
export type SessionStartVerdict = Extract<GateVerdict, { kind: "allow" | "context" | "gateError" }>;
export type NoVerdictVerdict = Extract<GateVerdict, { kind: "noVerdict" | "gateError" }>;
export type StopVerdict = Extract<GateVerdict, { kind: "allow" | "deny" | "push" }>;
export type UserPromptVerdict = Extract<GateVerdict, { kind: "allow" | "deny" | "context" }>;
export type SubagentStopVerdict = Extract<GateVerdict, { kind: "noVerdict" }>;

export type GateOutcome<V extends GateVerdict = PreToolUseVerdict> = Readonly<{
  verdict: V;
  events: readonly LoggedEvent[];
  stderr?: string;
}>;

export const ALLOWED: GateOutcome<Extract<GateVerdict, { kind: "allow" }>> = {
  verdict: { kind: "allow" },
  events: [],
};

export const NO_VERDICT: GateOutcome<Extract<GateVerdict, { kind: "noVerdict" }>> = {
  verdict: { kind: "noVerdict" },
  events: [],
};

const JSON_SPACE = "[\\t\\n\\v\\f\\r ]";

const STOP_HOOK_ACTIVE = new RegExp(`"stop_hook_active"${JSON_SPACE}*:${JSON_SPACE}*true`);

const NO_HOOK_FIELD_NAMED: Omit<HookEnvelope, "caller"> = {
  payloadRead: "json",
  sessionId: "",
  cwd: "",
  toolName: "",
  filePath: "",
  commandLine: "",
  source: "",
  agentId: "",
  agentType: "",
  permissionMode: "",
  transcriptPath: "",
  turnId: "",
  lastAssistantMessage: "",
  escapedLastAssistantMessage: "",
  prompt: "",
  escapedPrompt: "",
  stopHookActive: false,
};

type HookTextFields = Omit<HookEnvelope, "caller" | "payloadRead" | "stopHookActive">;

export function hostEnvelope(caller: HookCaller, named: Partial<Omit<HookEnvelope, "caller">>): HookEnvelope {
  const { payloadRead, stopHookActive, ...text } = { ...NO_HOOK_FIELD_NAMED, ...named };
  return { ...asHookFieldValues(text), payloadRead, stopHookActive, caller };
}

function asHookFieldValues(text: HookTextFields): HookTextFields {
  const read = Object.entries(text).map(([name, value]) => [name, asHookFieldValue(value)]);
  return Object.fromEntries(read) as HookTextFields;
}

export function readEnvelope(hookText: string, caller: HookCaller): HookEnvelope {
  const payload = asCommandSubstitutionCaptures(hookText);
  return {
    caller,
    payloadRead: parsedPayload(payload).kind,
    sessionId: jsonField(payload, "session_id"),
    cwd: jsonField(payload, "cwd"),
    toolName: jsonField(payload, "tool_name"),
    filePath: jsonField(payload, "file_path"),
    commandLine: jsonCommandLine(payload),
    source: jsonField(payload, "source"),
    agentId: jsonField(payload, "agent_id"),
    agentType: jsonField(payload, "agent_type"),
    permissionMode: jsonField(payload, "permission_mode"),
    transcriptPath: jsonField(payload, "transcript_path"),
    turnId: jsonField(payload, "turn_id"),
    lastAssistantMessage: jsonField(payload, "last_assistant_message"),
    escapedLastAssistantMessage: escapedField(payload, "last_assistant_message"),
    prompt: jsonField(payload, "prompt"),
    escapedPrompt: escapedField(payload, "prompt"),
    stopHookActive: STOP_HOOK_ACTIVE.test(payload),
  };
}

function jsonCommandLine(payload: string): string {
  const escaped = escapedField(payload, "command");
  if ([...escaped].length > MAX_LEXED_INPUT_BYTES) return asCommandSubstitutionCaptures(escaped);
  return jsonField(payload, "command");
}

export function jsonField(hookText: string, field: string): string {
  const payload = asCommandSubstitutionCaptures(hookText);
  return asHookFieldValue(theFirstStringNamed(payload, field));
}

function theFirstStringNamed(payload: string, field: string): string {
  const payloadRead = parsedPayload(payload);
  if (payloadRead.kind === "unparseable") return unescapedJson(escapedField(payload, field));
  return firstStringNamedWithin(payloadRead.document, field) ?? "";
}

type ParsedPayload =
  | Readonly<{ kind: "json"; document: unknown }>
  | Readonly<{ kind: "unparseable" }>;

function parsedPayload(payload: string): ParsedPayload {
  try {
    return { kind: "json", document: JSON.parse(payload) as unknown };
  } catch {
    return { kind: "unparseable" };
  }
}

function firstStringNamedWithin(document: unknown, field: string): string | undefined {
  const unvisited: unknown[] = [document];
  while (unvisited.length > 0) {
    const node = unvisited.pop();
    if (node === null || typeof node !== "object") continue;
    const named = Array.isArray(node) ? undefined : (node as Record<string, unknown>)[field];
    if (typeof named === "string") return named;
    for (const child of Object.values(node).reverse()) unvisited.push(child);
  }
  return undefined;
}

function asHookFieldValue(value: string): string {
  return asCommandSubstitutionCaptures(withoutCarriageReturns(asCommandSubstitutionCaptures(value)));
}

export function asCommandSubstitutionCaptures(text: string): string {
  return text.replaceAll("\0", "").replace(/\n+$/, "");
}

export function escapedField(hookText: string, field: string): string {
  const pattern = new RegExp(`"${field}"${JSON_SPACE}*:${JSON_SPACE}*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`);
  return pattern.exec(asCommandSubstitutionCaptures(hookText))?.[1] ?? "";
}

const NAMED_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
};

export function unescapedJson(escaped: string): string {
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
