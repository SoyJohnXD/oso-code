import { PlanFailure, type PlanPresentationBinding } from "../state/plan.ts";
import { isErrnoException, isNameToken, sha256Hex } from "../state/store.ts";
import { CODEX_METADATA_READINESS_MS, CodexMetadataFailure, readBoundedRegularFile, readCodexSessionMetadata } from "./codex-session-metadata.ts";
import { topLevelEscapedField, topLevelRawField, type HookEnvelope } from "./envelope.ts";

export const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
export const PLAN_MARKER_PREFIX = "<!-- oso-plan-approval:";
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
type NativeRecord = Readonly<{ type: string; payload: Record<string, unknown>; wire: string }>;
export type CodexPresentation = Readonly<{ binding: PlanPresentationBinding; digest: string; document: string }>;

export class CodexPresentationFailure extends PlanFailure {
  override readonly code: string;
  constructor(code: string, cause?: unknown) {
    super(`oso-code: plan not recorded [${code}]. Present one complete replacement proposed_plan with the final approval marker.`, { cause });
    this.code = code;
  }
}

export function readCodexTranscript(envelope: HookEnvelope): NativeRecord[] {
  try {
    const deadline = performance.now() + CODEX_METADATA_READINESS_MS;
    const metadata = readCodexSessionMetadata(envelope.transcriptPath, deadline);
    if (metadata.id !== envelope.sessionId || metadata.cwd !== envelope.cwd) throw new CodexPresentationFailure("foreign-session");
    const { text } = readBoundedRegularFile({ file: envelope.transcriptPath, deadline, maxBytes: MAX_TRANSCRIPT_BYTES, firstRecord: false });
    if (!text.endsWith("\n")) throw new CodexPresentationFailure("truncated-transcript");
    const records = text.slice(0, -1).split("\n").map((wire) => {
      const record: unknown = JSON.parse(wire);
      if (!isRecord(record) || typeof record["type"] !== "string" || !isRecord(record["payload"])) throw new CodexPresentationFailure("malformed-record");
      return { type: record["type"], payload: record["payload"], wire };
    });
    const meta = records[0];
    if (meta?.type !== "session_meta" || meta.payload["id"] !== metadata.id || ("session_id" in meta.payload && meta.payload["session_id"] !== metadata.id)) throw new CodexPresentationFailure("foreign-session");
    return records;
  } catch (cause) {
    if (cause instanceof CodexPresentationFailure) throw cause;
    if (!(cause instanceof CodexMetadataFailure) && !(cause instanceof SyntaxError) && !isErrnoException(cause)) throw cause;
    throw new CodexPresentationFailure("unreadable-transcript", cause);
  }
}

export function resolveCodexPresentation(envelope: HookEnvelope, precedingApproval = false): CodexPresentation {
  const { segment, turnId } = presentationSegment(readCodexTranscript(envelope), envelope.turnId, precedingApproval);
  const { final, raw, visible, plans, messageId } = finalPair(segment, envelope.sessionId, turnId);
  if (!precedingApproval && visible !== envelope.lastAssistantMessage && (visible.endsWith("\n") || `${visible}\n` !== envelope.lastAssistantMessage)) throw new CodexPresentationFailure("stop-final-mismatch");
  const rawText = textContent(raw.payload["content"], "output_text");
  const document = pairedDocument({ visible, rawText, plans, sessionId: envelope.sessionId, turnId, envelope, precedingApproval });
  if (!precedingApproval && JSON.parse(`"${envelope.escapedLastAssistantMessage}"`) !== envelope.lastAssistantMessage) throw new CodexPresentationFailure("stop-wire-mismatch");
  const contentDigest = sha256Hex(JSON.stringify([
    topLevelRawField(topLevelRawField(raw.wire, "payload"), "content"),
    topLevelRawField(topLevelRawField(topLevelRawField(final.wire, "payload"), "item"), "content"),
    ...plans.map((plan) => topLevelEscapedField(topLevelRawField(topLevelRawField(plan.wire, "payload"), "item"), "text")),
  ]));
  return { ...document, binding: { version: 1, turnId, messageId, contentDigest } };
}

function presentationSegment(records: NativeRecord[], currentTurn: string, precedingApproval: boolean): { segment: NativeRecord[]; turnId: string } {
  const boundaries = records.flatMap((record, index) => isTask(record) && record.payload["turn_id"] === currentTurn ? [index] : []);
  if (boundaries.length !== 1) throw new CodexPresentationFailure("unattested-turn");
  const boundary = boundaries[0] as number;
  if (records.slice(boundary + 1).some(isTask)) throw new CodexPresentationFailure("stale-turn");
  let start = boundary;
  let end = records.length;
  if (precedingApproval) {
    end = boundary;
    const tasks = records.slice(0, end).flatMap((record, index) => isTask(record) ? [index] : []);
    const presentations = tasks.filter((index, position) => {
      const taskEnd = tasks[position + 1] ?? boundary;
      return records[index]?.payload["collaboration_mode_kind"] === "plan" || records.slice(index + 1, taskEnd).some((record) => isPlan(record) || (isFinal(record) && textContent((record.payload["item"] as Record<string, unknown>)["content"], "Text").includes(PLAN_MARKER_PREFIX)));
    });
    start = presentations.at(-1) ?? -1;
    end = tasks.find((index) => index > start) ?? boundary;
  }
  const task = records[start];
  if (task === undefined || task.payload["collaboration_mode_kind"] !== "plan") throw new CodexPresentationFailure("not-plan-presentation");
  const turnId = task.payload["turn_id"];
  if (typeof turnId !== "string" || !isNameToken(turnId)) throw new CodexPresentationFailure("unattested-turn");
  return { segment: records.slice(start + 1, end), turnId };
}

function finalPair(segment: NativeRecord[], sessionId: string, turnId: string) {
  if (segment.some((record) => record.type === "event_msg" && isRecord(record.payload["item"]) && record.payload["item"]["type"] === "AgentMessage" && record.payload["item"]["phase"] === undefined)) throw new CodexPresentationFailure("incomplete-final");
  const finals = segment.flatMap((record, index) => isFinal(record) ? [index] : []);
  const finalIndex = finals.at(-1);
  if (finalIndex === undefined) throw new CodexPresentationFailure("missing-final");
  const previousFinal = finals.at(-2) ?? -1;
  const final = segment[finalIndex] as NativeRecord;
  const item = final.payload["item"] as Record<string, unknown>;
  const messageId = item["id"];
  if (typeof messageId !== "string" || !isNameToken(messageId) || finals.some((index) => index !== finalIndex && (segment[index]?.payload["item"] as Record<string, unknown>)["id"] === messageId)) throw new CodexPresentationFailure("ambiguous-final");
  requireOwner(final, sessionId, turnId);
  const visible = textContent(item["content"], "Text");
  const rawCandidates = segment.filter((record) => record.type === "response_item" && record.payload["role"] === "assistant" && record.payload["id"] === messageId);
  if (rawCandidates.length !== 1) throw new CodexPresentationFailure("missing-or-duplicate-raw");
  const raw = rawCandidates[0] as NativeRecord;
  if (segment.indexOf(raw) <= finalIndex || raw.payload["type"] !== "message" || raw.payload["phase"] !== "final_answer") throw new CodexPresentationFailure("unpaired-raw");
  if (segment.slice(finalIndex + 1).some(isPlan)) throw new CodexPresentationFailure("incomplete-newer-plan");
  if (segment.slice(finalIndex + 1).some((record) => record.type === "response_item" && record.payload["role"] === "assistant" && record.payload["phase"] === "final_answer" && record !== raw)) throw new CodexPresentationFailure("unpaired-newer-final");
  const plans = segment.slice(previousFinal + 1, finalIndex).filter(isPlan);
  return { final, raw, visible, plans, messageId };
}

function pairedDocument(input: Readonly<{ visible: string; rawText: string; plans: NativeRecord[]; sessionId: string; turnId: string; envelope: HookEnvelope; precedingApproval: boolean }>): Pick<CodexPresentation, "digest" | "document"> {
  const { visible, rawText, plans } = input;
  const blocks = [...rawText.matchAll(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/g)];
  if (blocks.length === 0) {
    if (plans.length !== 0 || rawText.includes("<proposed_plan") || rawText !== visible) throw new CodexPresentationFailure("unpaired-plan");
    const document = withoutMarker(visible);
    if (document === "") throw new CodexPresentationFailure("empty-plan");
    const wire = input.precedingApproval ? JSON.stringify(visible).slice(1, -1) : input.envelope.escapedLastAssistantMessage;
    return { document, digest: sha256Hex(wire) };
  }
  if (blocks.length !== 1 || plans.length !== 1 || rawText.split("<proposed_plan>").length !== 2 || rawText.split("</proposed_plan>").length !== 2) throw new CodexPresentationFailure("ambiguous-plan");
  const plan = plans[0] as NativeRecord;
  requireOwner(plan, input.sessionId, input.turnId);
  const planItem = plan.payload["item"] as Record<string, unknown>;
  if (typeof planItem["id"] !== "string" || !isNameToken(planItem["id"])) throw new CodexPresentationFailure("missing-plan-id");
  const document = planItem["text"];
  if (typeof document !== "string" || document === "") throw new CodexPresentationFailure("empty-plan");
  if (document.includes(PLAN_MARKER_PREFIX) || blocks[0]?.[1] !== `\n${document}`) throw new CodexPresentationFailure("plan-body-mismatch");
  withoutMarker(rawText);
  const split = visible === PLAN_MARKER || visible === `${PLAN_MARKER}\n`;
  if (!split && visible !== rawText) throw new CodexPresentationFailure("raw-final-mismatch");
  if (split && rawText !== `<proposed_plan>\n${document}</proposed_plan>\n${visible}`) throw new CodexPresentationFailure("split-framing-mismatch");
  const wire = input.precedingApproval ? JSON.stringify(visible).slice(1, -1) : input.envelope.escapedLastAssistantMessage;
  const rawItem = topLevelRawField(topLevelRawField(plan.wire, "payload"), "item");
  const digestInput = split ? `${topLevelEscapedField(rawItem, "text")}\\n${wire}` : wire;
  return { document, digest: sha256Hex(digestInput) };
}

function withoutMarker(text: string): string {
  const ended = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!ended.endsWith(`\n${PLAN_MARKER}`) || ended.split(PLAN_MARKER_PREFIX).length !== 2) throw new CodexPresentationFailure("marker-placement");
  return ended.slice(0, -PLAN_MARKER.length - 1);
}

export function isTask(record: NativeRecord): boolean {
  return record.type === "event_msg" && record.payload["type"] === "task_started";
}

function isFinal(record: NativeRecord): boolean {
  const item = record.payload["item"];
  return record.type === "event_msg" && record.payload["type"] === "item_completed" && isRecord(item) && item["type"] === "AgentMessage" && item["phase"] === "final_answer";
}

function isPlan(record: NativeRecord): boolean {
  const item = record.payload["item"];
  return record.type === "event_msg" && isRecord(item) && item["type"] === "Plan";
}

function requireOwner(record: NativeRecord, sessionId: string, turnId: string): void {
  if (record.payload["type"] !== "item_completed" || record.payload["thread_id"] !== sessionId || record.payload["turn_id"] !== turnId) throw new CodexPresentationFailure("foreign-presentation");
}

function textContent(content: unknown, type: string): string {
  if (!Array.isArray(content) || content.length !== 1 || !isRecord(content[0]) || content[0]["type"] !== type || typeof content[0]["text"] !== "string") throw new CodexPresentationFailure("malformed-content");
  return content[0]["text"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
