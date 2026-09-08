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
  return { ...(caller.host === "codex" ? text : asHookFieldValues(text)), payloadRead, stopHookActive, caller };
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
    sessionId: hookIdentityField(payload, caller, "session_id"),
    cwd: hookIdentityField(payload, caller, "cwd"),
    toolName: jsonField(payload, "tool_name"),
    filePath: jsonField(payload, "file_path"),
    commandLine: jsonCommandLine(payload, caller),
    source: jsonField(payload, "source"),
    agentId: jsonField(payload, "agent_id"),
    agentType: jsonField(payload, "agent_type"),
    permissionMode: hookIdentityField(payload, caller, "permission_mode"),
    transcriptPath: hookIdentityField(payload, caller, "transcript_path"),
    turnId: hookIdentityField(payload, caller, "turn_id"),
    lastAssistantMessage: hookIdentityField(payload, caller, "last_assistant_message"),
    escapedLastAssistantMessage: caller.host === "codex" ? topLevelEscapedField(payload, "last_assistant_message") : escapedField(payload, "last_assistant_message"),
    prompt: hookIdentityField(payload, caller, "prompt"),
    escapedPrompt: caller.host === "codex" ? topLevelEscapedField(payload, "prompt") : escapedField(payload, "prompt"),
    stopHookActive: caller.host === "codex" ? topLevelRawField(payload, "stop_hook_active") === "true" : STOP_HOOK_ACTIVE.test(payload),
  };
}

export function topLevelEscapedField(payload: string, field: string): string {
  const raw = topLevelRawField(payload, field);
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : "";
}

export function topLevelRawField(payload: string, field: string): string {
  if (parsedPayload(payload).kind !== "json") return "";
  const tokens = [...payload.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)];
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const text = token?.[0];
    if (depth === 1 && text?.startsWith('"') && tokens[index + 1]?.[0] === ":" && JSON.parse(text) === field) {
      const start = tokens[index + 2];
      if (start === undefined) return "";
      if (start[0] !== "{" && start[0] !== "[") return start[0];
      let nested = 0;
      for (const value of tokens.slice(index + 2)) {
        if (value[0] === "{" || value[0] === "[") nested++;
        if (value[0] === "}" || value[0] === "]") nested--;
        if (nested === 0) return payload.slice(start.index, value.index + value[0].length);
      }
    }
    if (text === "{" || text === "[") depth++;
    if (text === "}" || text === "]") depth--;
  }
  return "";
}

function hookIdentityField(payload: string, caller: HookCaller, field: string): string {
  if (caller.host !== "codex") return jsonField(payload, field);
  const parsed = parsedPayload(payload);
  if (parsed.kind !== "json" || parsed.document === null || typeof parsed.document !== "object" || Array.isArray(parsed.document)) return "";
  const value = (parsed.document as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function jsonCommandLine(payload: string, caller: HookCaller): string {
  const field = caller.host === "codex" && jsonField(payload, "cmd") !== "" ? "cmd" : "command";
  const escaped = escapedField(payload, field);
  if ([...escaped].length > MAX_LEXED_INPUT_BYTES) return asCommandSubstitutionCaptures(escaped);
  return jsonField(payload, field);
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
