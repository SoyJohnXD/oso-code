import { NO_VERDICT, type GateOutcome, type HookEnvelope, type SubagentStopVerdict } from "../hosts/envelope.ts";
import { HandoffFailure, runHandoffPublish, runHandoffRecordUnpublished, type FinishedDelegation } from "../state/handoff.ts";
import { causeOf, isDirectory, type LoggedEvent } from "../state/store.ts";
import { hookSessionId, type GateDefinition, type GateRequest } from "./preflight.ts";

const MARKER_LINE = /^oso-handoff:/;
const MARKER =
  /^oso-handoff:[\t\n\v\f\r ]v=1[\t\n\v\f\r ]slice=([A-Za-z0-9][A-Za-z0-9_-]*)[\t\n\v\f\r ]attempt=([1-9][0-9]*)$/;

const MALFORMED_MARKER = "the final message must begin with one exact oso-handoff marker";

export const HANDOFF_GATE: GateDefinition<SubagentStopVerdict> = {
  gate: "handoff",
  errorSubject: "the subagent-handoff gate",
  judge: judgeHandoff,
};

type Refusal = Readonly<{
  envelope: HookEnvelope;
  delegation: FinishedDelegation | undefined;
  reason: string;
  session: string;
}>;

function judgeHandoff({ envelope }: GateRequest): GateOutcome<SubagentStopVerdict> {
  const message = envelope.lastAssistantMessage;
  const markerLines = message.split("\n").filter((line) => MARKER_LINE.test(line));
  if (markerLines.length === 0) return NO_VERDICT;

  const delegation = delegationNamedBy(envelope, markerLines.length);
  const session = hookSessionId(envelope);
  const agentType = envelope.agentType;
  const refused = (reason: string) => publishFailed({ envelope, delegation, reason, session });

  if (session === "") return refused("missing session_id");
  if (!isDirectory(envelope.cwd)) return refused("missing or unreadable cwd");
  if (envelope.agentId === "") return refused("missing agent_id");
  if (agentType === "") return refused("missing agent_type");
  if (delegation === undefined) return refused(MALFORMED_MARKER);

  try {
    runHandoffPublish(envelope.cwd, { ...delegation, agentType }, session);
  } catch (cause) {
    if (!(cause instanceof HandoffFailure)) throw cause;
    return refused("oso-state rejected the receipt");
  }

  return {
    verdict: NO_VERDICT.verdict,
    events: [published(session, `${agentType}:${delegation.slice}:${delegation.attempt}`)],
  };
}

function delegationNamedBy(envelope: HookEnvelope, markerLineCount: number): FinishedDelegation | undefined {
  const named = MARKER.exec(envelope.lastAssistantMessage.split("\n")[0] ?? "");
  if (markerLineCount !== 1 || named === null || envelope.agentId === "") return undefined;
  return { slice: named[1] as string, attempt: named[2] as string, agentId: envelope.agentId };
}

function publishFailed(refusal: Refusal): GateOutcome<SubagentStopVerdict> {
  const unrecorded = recordTheFinish(refusal);
  return {
    verdict: NO_VERDICT.verdict,
    events: [{ event: "handoff-publish-failed", session: refusal.session, command: refusal.envelope.agentType }],
    stderr: `oso-code: SubagentStop could not publish its handoff: ${refusal.reason}\n${unrecorded}`,
  };
}

function recordTheFinish({ envelope, delegation, reason }: Refusal): string {
  if (delegation === undefined || !isDirectory(envelope.cwd)) return "";
  try {
    runHandoffRecordUnpublished(envelope.cwd, delegation, reason);
    return "";
  } catch (cause) {
    return `oso-code: SubagentStop could not record that its child finished either: ${causeOf(cause)}\n`;
  }
}

function published(session: string, detail: string): LoggedEvent {
  return { event: "handoff-published", session, command: detail };
}
