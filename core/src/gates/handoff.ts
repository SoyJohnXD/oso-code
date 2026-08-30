import { NO_VERDICT, type GateOutcome, type SubagentStopVerdict } from "../hosts/envelope.ts";
import { HandoffFailure, runHandoffPublish } from "../state/handoff.ts";
import { isDirectory, type LoggedEvent } from "../state/store.ts";
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

function judgeHandoff({ envelope }: GateRequest): GateOutcome<SubagentStopVerdict> {
  const message = envelope.lastAssistantMessage;
  const markerLines = message.split("\n").filter((line) => MARKER_LINE.test(line));
  if (markerLines.length === 0) return NO_VERDICT;

  const sessionId = hookSessionId(envelope);
  const agentType = envelope.agentType;
  if (sessionId === "") return publishFailed("missing session_id", "", agentType);
  if (!isDirectory(envelope.cwd)) return publishFailed("missing or unreadable cwd", sessionId, agentType);
  if (envelope.agentId === "") return publishFailed("missing agent_id", sessionId, agentType);
  if (agentType === "") return publishFailed("missing agent_type", sessionId, "");

  const named = MARKER.exec(message.split("\n")[0] ?? "");
  if (markerLines.length !== 1 || named === null) {
    return publishFailed(MALFORMED_MARKER, sessionId, agentType);
  }

  const slice = named[1] as string;
  const attempt = named[2] as string;
  try {
    runHandoffPublish(envelope.cwd, { slice, attempt, agentId: envelope.agentId, agentType }, sessionId);
  } catch (cause) {
    if (!(cause instanceof HandoffFailure)) throw cause;
    return publishFailed("oso-state rejected the receipt", sessionId, agentType);
  }

  return {
    verdict: NO_VERDICT.verdict,
    events: [published(sessionId, `${agentType}:${slice}:${attempt}`)],
  };
}

function publishFailed(reason: string, session: string, agentType: string): GateOutcome<SubagentStopVerdict> {
  return {
    verdict: NO_VERDICT.verdict,
    events: [{ event: "handoff-publish-failed", session, command: agentType }],
    stderr: `oso-code: SubagentStop could not publish its handoff: ${reason}\n`,
  };
}

function published(session: string, detail: string): LoggedEvent {
  return { event: "handoff-published", session, command: detail };
}
