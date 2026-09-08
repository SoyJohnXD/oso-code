import { statSync } from "node:fs";
import { CodexPresentationFailure, resolveCodexPresentation } from "../hosts/codex-presentation.ts";
import { resolveCodexTurn, type CodexTurn } from "../hosts/codex-turn.ts";
import {
  asCommandSubstitutionCaptures,
  type GateOutcome,
  type HookEnvelope,
  type UserPromptVerdict,
} from "../hosts/envelope.ts";
import { matchesPlanPresentation, readPlanForReplacement, runAmendPlan, runApprovePlan, runCancelPlan } from "../state/plan.ts";
import { isDirectory, isReadableRegularFile, readValue, stateFileFor, type LoggedEvent } from "../state/store.ts";
import { isPlanRailFailure, nativePlanFailureCode } from "./planrail.ts";
import { sanitizeSession, type GateDefinition, type GateRequest } from "./preflight.ts";

const APPROVAL_PROMPT = "Implement the plan.";
const CANCEL_TOKEN = "CANCEL OSO PLAN";
const PLAN_INVOCATION = "$oso-code:plan";
const FEEDBACK_AMENDMENT_LABEL = "plan-mode-feedback";
const PENDING = "pending";
const PLAN_DIGEST = /^[0-9a-f]{64}$/;

const OUTSIDE_PLAN_MODE =
  "oso-code: $oso-code:plan requires Codex native Plan Mode. Enter /plan (or use Shift+Tab), " +
  "then invoke $oso-code:plan again.";
const AMENDMENT_REFUSED = "oso-code: the pending document could not be amended; retry the planning message.";
const UNREADABLE_PENDING_STATE =
  "oso-code: the pending plan state is unreadable; native approval cannot open the execution gate.";
const UNREADABLE_CONTROL_PAYLOAD =
  "oso-code: the plan-control prompt arrived in a payload that is not readable JSON, so the pending document " +
  "it would settle cannot be identified; the gate did not change.";
const NO_SESSION_IDENTITY = "oso-code: the plan-control prompt has no valid session identity.";
const NO_REPOSITORY_CONTEXT = "oso-code: the plan-control prompt has no readable repository context.";
const APPROVAL_STILL_IN_PLAN_MODE =
  "oso-code: native plan approval arrived while Codex still reports Plan Mode; use the native approval control " +
  "again after the mode transition completes.";
const APPROVAL_UNATTESTED =
  "oso-code: native plan approval arrived without an attested collaboration mode; execution remains blocked.";
const CANCELLATION_UNATTESTED =
  "oso-code: the cancellation token arrived without an attested collaboration mode; the pending gate remains armed.";
const NO_PENDING_PLAN =
  "oso-code: no pending plan approval exists for this repository; present the complete plan again.";
const FOREIGN_CONTROL_PROMPT =
  "oso-code: this plan-control prompt does not belong to the session that presented the pending plan.";
const NOTHING_PENDING =
  "oso-code: no pending plan approval exists; present the complete plan again before approving or cancelling it.";
const NO_VALID_DIGEST = "oso-code: the pending plan has no valid document digest; present it again before approving.";

const AMENDMENT_GUIDANCE =
  "oso-code: this Plan Mode turn amended the pending document instead of discarding it. Present a COMPLETE replacement proposed_plan, including all unchanged sections and the feedback, then re-emit the internal approval marker for fresh capture.";
const LEGACY_AMENDMENT_GUIDANCE =
  "oso-code: this Plan Mode turn amended the pending document instead of discarding it. Present the amendment — " +
  "what changed and why — not the complete plan, then re-emit the internal approval marker so a fresh capture " +
  "binds the complete updated document before approval can succeed.";
const LEGACY_REFRESH = "oso-code: this preserved plan needs a compatibility refresh before native approval. Enter native Plan Mode (/plan or Shift+Tab); the next Plan interaction will supply the complete preserved document for replacement. No manual file, token or digest handling is needed.";
const NOT_RECORDED = "oso-code: the latest plan was not recorded [latest-presentation-unavailable]; execution remains blocked. Present a complete replacement proposed_plan in native Plan Mode.";
const APPROVAL_GRANTED =
  "oso-code: Codex native plan approval matched the exact pending document. The technical approval gate is open; " +
  "continue with the saved operational plan.";
const CANCELLATION_ACCEPTED =
  "oso-code: CANCEL OSO PLAN accepted for the exact pending document. Its runtime state was cleared; do not " +
  "execute that plan.";

const SILENT: GateOutcome<UserPromptVerdict> = { verdict: { kind: "allow" }, events: [] };

type ControlAction = "approve" | "cancel";

export const PLANPROMPT_GATE: GateDefinition<UserPromptVerdict> = {
  gate: "planprompt",
  errorSubject: "the plan-approval token gate",
  judge: judgePlanprompt,
};

function judgePlanprompt({ envelope }: GateRequest): GateOutcome<UserPromptVerdict> {
  const rawPrompt = envelope.escapedPrompt;
  const sessionId = sanitizeSession(envelope.sessionId);
  let turn: CodexTurn;
  try {
    turn = resolveCodexTurn(envelope);
  } catch (cause) {
    if (!(cause instanceof CodexPresentationFailure)) throw cause;
    if (controlActionOf(rawPrompt) === undefined && !invokesThePlanSkill(rawPrompt)) return SILENT;
    if (!statePresent(stateFileFor(envelope.cwd)) && !invokesThePlanSkill(rawPrompt)) return SILENT;
    return nativeFailure(cause, sessionId, "turn");
  }

  if (invokesThePlanSkill(rawPrompt) && turn.mode !== "plan") return control(OUTSIDE_PLAN_MODE);

  const action = controlActionOf(rawPrompt);
  if (envelope.payloadRead === "unparseable") {
    return action === undefined ? SILENT : control(UNREADABLE_CONTROL_PAYLOAD);
  }
  if (action === undefined) return amendPendingPlan(envelope, sessionId, turn);

  const stateFile = stateFileFor(envelope.cwd);
  const reachable = controlPromptReaches(envelope, sessionId, action, stateFile);
  if (reachable !== undefined) return reachable;

  const modeRefusal = modeRefusalFor(action, turn);
  if (modeRefusal !== undefined) return control(modeRefusal);
  if (!isReadableRegularFile(stateFile)) return control(NO_PENDING_PLAN);

  if (readValue(stateFile, "plan_approval_session") !== sessionId) return control(FOREIGN_CONTROL_PROMPT);
  if (readValue(stateFile, "plan_approval") !== PENDING) return control(NOTHING_PENDING);
  if (action === "approve" && envelope.caller.host === "codex") {
    if (readValue(stateFile, "plan_presentation_status") === "failed") return control(NOT_RECORDED);
    if (readValue(stateFile, "plan_presentation_version") !== "1") return control(LEGACY_REFRESH);
  }
  const digest = readValue(stateFile, "plan_approval_digest") ?? "";
  if (!PLAN_DIGEST.test(digest)) return control(NO_VALID_DIGEST);

  return settlePendingPlan(envelope, sessionId, action, digest);
}

function amendPendingPlan(
  envelope: HookEnvelope,
  sessionId: string,
  turn: CodexTurn,
): GateOutcome<UserPromptVerdict> {
  if (turn.mode !== "plan") return SILENT;
  if (sessionId === "" || sessionId !== envelope.sessionId || !isDirectory(envelope.cwd)) return SILENT;

  const stateFile = stateFileFor(envelope.cwd);
  if (!isReadableRegularFile(stateFile)) return SILENT;
  if (readValue(stateFile, "plan_approval_session") !== sessionId) return SILENT;
  if (readValue(stateFile, "plan_approval") !== PENDING) return SILENT;
  if (!PLAN_DIGEST.test(readValue(stateFile, "plan_approval_digest") ?? "")) return SILENT;

  try {
    if (envelope.caller.host === "codex" && (readValue(stateFile, "plan_presentation_version") !== "1" || readValue(stateFile, "plan_presentation_status") === "failed")) {
      if (readValue(stateFile, "plan_presentation_status") === "failed" && readValue(stateFile, "plan_current_file") === undefined) return { verdict: { kind: "context", additionalContext: AMENDMENT_GUIDANCE }, events: [] };
      return { verdict: { kind: "context", additionalContext: `${AMENDMENT_GUIDANCE}\n\nPreserved document:\n${readPlanForReplacement(envelope.cwd, sessionId)}` }, events: [] };
    }
    runAmendPlan(envelope.cwd, sessionId, FEEDBACK_AMENDMENT_LABEL, asCommandSubstitutionCaptures(envelope.prompt));
    if (envelope.caller.host === "codex") return { verdict: { kind: "context", additionalContext: `${AMENDMENT_GUIDANCE}\n\nPreserved document:\n${readPlanForReplacement(envelope.cwd, sessionId)}` }, events: [] };
  } catch (cause) {
    if (envelope.caller.host === "codex") return nativeFailure(cause, sessionId, "amend");
    if (!isPlanRailFailure(cause)) throw cause;
    return {
      verdict: { kind: "deny", message: AMENDMENT_REFUSED },
      events: [refusal("plan-approval-amend-blocked", sessionId, cause.message)],
    };
  }
  return { verdict: { kind: "context", additionalContext: LEGACY_AMENDMENT_GUIDANCE }, events: [] };
}

function settlePendingPlan(
  envelope: HookEnvelope,
  sessionId: string,
  action: ControlAction,
  digest: string,
): GateOutcome<UserPromptVerdict> {
  try {
    if (action === "approve") runApprovePlan(envelope.cwd, sessionId, digest, envelope.caller.host === "codex" ? () => resolveCodexPresentation(envelope, true) : undefined);
    else runCancelPlan(envelope.cwd, sessionId, digest);
  } catch (cause) {
    if (envelope.caller.host === "codex") return nativeFailure(cause, sessionId, action);
    if (!isPlanRailFailure(cause)) throw cause;
    return {
      verdict: {
        kind: "deny",
        message: `oso-code: the ${action} request lost its pending compare-and-set; the gate did not change.`,
      },
      events: [refusal(`plan-approval-${action}-blocked`, sessionId, cause.message)],
    };
  }
  const granted = action === "approve" ? APPROVAL_GRANTED : CANCELLATION_ACCEPTED;
  return { verdict: { kind: "context", additionalContext: granted }, events: [] };
}

function controlPromptReaches(
  envelope: HookEnvelope,
  sessionId: string,
  action: ControlAction,
  stateFile: string,
): GateOutcome<UserPromptVerdict> | undefined {
  const ownIdentity = sessionId !== "" && sessionId === envelope.sessionId;
  if (action === "cancel") {
    if (!ownIdentity) return control(NO_SESSION_IDENTITY);
    if (!isDirectory(envelope.cwd)) return control(NO_REPOSITORY_CONTEXT);
    return undefined;
  }
  if (!ownIdentity || !isDirectory(envelope.cwd)) return SILENT;
  if (!statePresent(stateFile)) return SILENT;
  if (!isReadableRegularFile(stateFile)) return control(UNREADABLE_PENDING_STATE);
  if (envelope.caller.host === "codex" && readValue(stateFile, "mode") === "plan" && readValue(stateFile, "plan_approval") === "approved" && readValue(stateFile, "plan_approval_session") === sessionId && readValue(stateFile, "plan_presentation_version") === "1") {
    try {
      const latest = resolveCodexPresentation(envelope, true);
      if (!matchesPlanPresentation(stateFile, latest.binding)) return control(NOT_RECORDED);
    } catch (cause) {
      if (!(cause instanceof CodexPresentationFailure)) throw cause;
      return nativeFailure(cause, sessionId, action);
    }
  }
  if (readValue(stateFile, "plan_approval") !== PENDING) return SILENT;
  return undefined;
}

function modeRefusalFor(action: ControlAction, turn: CodexTurn): string | undefined {
  if (action === "cancel") return turn.mode === "unknown" ? CANCELLATION_UNATTESTED : undefined;
  if (turn.mode === "default") return undefined;
  return turn.mode === "plan" ? APPROVAL_STILL_IN_PLAN_MODE : APPROVAL_UNATTESTED;
}

function nativeFailure(cause: unknown, sessionId: string, action: string): GateOutcome<UserPromptVerdict> {
  const code = nativePlanFailureCode(cause);
  return {
    verdict: { kind: "deny", message: `oso-code: the ${action} request was refused [${code}]; execution remains blocked. Present a complete replacement proposed_plan in native Plan Mode after repairing the reported fault.` },
    events: [refusal(`plan-approval-${action}-blocked`, sessionId, code)],
  };
}

function invokesThePlanSkill(rawPrompt: string): boolean {
  return rawPrompt === PLAN_INVOCATION || rawPrompt.startsWith(`${PLAN_INVOCATION} `);
}

function controlActionOf(rawPrompt: string): ControlAction | undefined {
  if (rawPrompt === APPROVAL_PROMPT) return "approve";
  if (rawPrompt === CANCEL_TOKEN) return "cancel";
  return undefined;
}

function statePresent(stateFile: string): boolean {
  return statSync(stateFile, { throwIfNoEntry: false }) !== undefined;
}

function control(reason: string): GateOutcome<UserPromptVerdict> {
  return { verdict: { kind: "deny", message: reason }, events: [] };
}

function refusal(event: string, session: string, detail: string): LoggedEvent {
  return { event, session, command: detail };
}
