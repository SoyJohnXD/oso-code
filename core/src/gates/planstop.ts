import { resolveCodexTurn, transcriptLinesMatching, type CodexTurn } from "../hosts/codex-turn.ts";
import {
  asCommandSubstitutionCaptures,
  escapedField,
  jsonField,
  unescapedJson,
  type GateOutcome,
  type HookEnvelope,
  type StopVerdict,
} from "../hosts/envelope.ts";
import { gateRow } from "../routes/routes.ts";
import { runCapturePlan } from "../state/plan.ts";
import { isDirectory, sha256Hex, type LoggedEvent } from "../state/store.ts";
import { isPlanRailFailure } from "./planrail.ts";
import { sanitizeSession, type GateDefinition, type GateRequest } from "./preflight.ts";

const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const MARKER_PREFIX = "<!-- oso-plan-approval:";
const ESCAPED_NEWLINE = "\\n";

const CAPTURE_BLOCKED = "plan-approval-capture-blocked";
const EVENT_MESSAGE = '"type":"event_msg"';
const ITEM_COMPLETED = '"type":"item_completed"';
const PLAN_ITEM = '"item":{"type":"Plan"';

const UNREADABLE_PAYLOAD =
  "oso-code: the plan approval marker arrived in a payload that is not readable JSON, so the document it " +
  "binds cannot be trusted; present the plan again.";
const NO_SESSION = "oso-code: the plan approval marker arrived without a usable session id.";
const UNSAFE_SESSION = "oso-code: the plan approval marker arrived with an invalid session id.";
const NO_WORKING_DIRECTORY = "oso-code: the plan approval marker arrived without a readable working directory.";
const NOT_PLAN_MODE = "oso-code: the approval document must be presented while Codex is still in Plan Mode.";
const MARKER_OUT_OF_PLACE =
  "oso-code: the plan approval marker must be the exact final line of the message, appearing exactly once.";
const NO_ATTESTATION =
  "oso-code: a marker-only response requires Plan Mode for this turn to be attested from the transcript, " +
  "and none was available.";
const NOT_ONE_PLAN_ITEM =
  "oso-code: the transcript must hold exactly one Plan item for this turn; none or more than one was found.";
const FOREIGN_PLAN_ITEM = "oso-code: the transcript's Plan item does not belong to this turn and thread.";
const EMPTY_PLAN_ITEM = "oso-code: the transcript's Plan item carries no plan text to approve.";
const SELF_MARKING_PLAN_ITEM = "oso-code: the transcript's Plan item text must not itself carry an approval marker.";
const CAPTURE_REFUSED =
  "oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.";

const SILENT: GateOutcome<StopVerdict> = { verdict: { kind: "allow" }, events: [] };

export const PLANSTOP_GATE: GateDefinition<StopVerdict> = {
  gate: "planstop",
  errorSubject: "the plan-approval capture gate",
  judge: judgePlanstop,
};

type ApprovalDocument = Readonly<{ digestInput: string; planDocument: string }>;

function judgePlanstop({ envelope }: GateRequest): GateOutcome<StopVerdict> {
  const message = asCommandSubstitutionCaptures(envelope.lastAssistantMessage);
  if (!lastLineOf(message).startsWith(MARKER_PREFIX)) return SILENT;

  const rawSessionId = envelope.sessionId;
  const sessionId = sanitizeSession(rawSessionId);
  if (envelope.payloadRead === "unparseable") return blocked(UNREADABLE_PAYLOAD, sessionId);
  if (sessionId === "") return blocked(NO_SESSION, "");
  if (sessionId !== rawSessionId) return blocked(UNSAFE_SESSION, sessionId);
  if (!isDirectory(envelope.cwd)) return blocked(NO_WORKING_DIRECTORY, sessionId);

  const turn = resolveCodexTurn(envelope);
  if (turn.mode !== "plan") return blocked(NOT_PLAN_MODE, sessionId);

  const rawMessage = envelope.escapedLastAssistantMessage;
  if (!markerIsTheWholeEnding(message, rawMessage)) return blocked(MARKER_OUT_OF_PLACE, sessionId);

  const document =
    message === PLAN_MARKER
      ? planItemDocument(envelope, turn, rawMessage)
      : { digestInput: rawMessage, planDocument: withoutTrailingMarker(message) };
  if (typeof document === "string") return blocked(document, sessionId);

  try {
    runCapturePlan(envelope.cwd, sessionId, sha256Hex(document.digestInput), document.planDocument);
  } catch (cause) {
    if (!isPlanRailFailure(cause)) throw cause;
    return blocked(CAPTURE_REFUSED, sessionId, cause.message);
  }
  return { verdict: { kind: "allow" }, events: [{ event: "plan-approval-pending", session: sessionId }] };
}

function planItemDocument(envelope: HookEnvelope, turn: CodexTurn, rawMessage: string): ApprovalDocument | string {
  if (turn.source !== "transcript" || envelope.turnId === "" || envelope.transcriptPath === "") return NO_ATTESTATION;

  const items = transcriptLinesMatching(envelope.transcriptPath, [
    EVENT_MESSAGE,
    ITEM_COMPLETED,
    `"turn_id":"${envelope.turnId}"`,
    PLAN_ITEM,
  ]);
  if (items.length !== 1) return NOT_ONE_PLAN_ITEM;

  const item = items[0] as string;
  if (jsonField(item, "turn_id") !== envelope.turnId || jsonField(item, "thread_id") !== envelope.sessionId) {
    return FOREIGN_PLAN_ITEM;
  }

  const rawPlanDocument = escapedField(item, "text");
  const planDocument = asCommandSubstitutionCaptures(unescapedJson(rawPlanDocument));
  if (planDocument === "") return EMPTY_PLAN_ITEM;
  if (planDocument.split("\n").some((line) => line.startsWith(MARKER_PREFIX))) return SELF_MARKING_PLAN_ITEM;

  return { digestInput: `${rawPlanDocument}${ESCAPED_NEWLINE}${rawMessage}`, planDocument };
}

function markerIsTheWholeEnding(message: string, rawMessage: string): boolean {
  const rawEndsWithMarker = rawMessage.endsWith(PLAN_MARKER) || rawMessage.endsWith(`${PLAN_MARKER}${ESCAPED_NEWLINE}`);
  const lines = message.split("\n");
  return (
    rawEndsWithMarker &&
    lines.filter((line) => line.startsWith(MARKER_PREFIX)).length === 1 &&
    lines.filter((line) => line === PLAN_MARKER).length === 1
  );
}

function withoutTrailingMarker(message: string): string {
  const trailer = `\n${PLAN_MARKER}`;
  return message.endsWith(trailer) ? message.slice(0, -trailer.length) : message;
}

function lastLineOf(message: string): string {
  return message.slice(message.lastIndexOf("\n") + 1);
}

function blocked(reason: string, session: string, detail = ""): GateOutcome<StopVerdict> {
  return { verdict: { kind: "deny", message: reason }, events: [captureBlocked(session, detail)] };
}

function captureBlocked(session: string, detail: string): LoggedEvent {
  const route = gateRow("planstop");
  return { event: CAPTURE_BLOCKED, session, command: detail, gate: route.script, hookEvent: route.event };
}
