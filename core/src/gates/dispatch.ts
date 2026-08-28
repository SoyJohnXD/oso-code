import type { GateVerdict } from "../hosts/envelope.ts";
import { readEnvelope } from "../hosts/envelope.ts";
import { preToolUseRun, type HookRun } from "../hosts/pretooluse.ts";
import { sessionEndRun } from "../hosts/sessionend.ts";
import { sessionStartRun } from "../hosts/sessionstart.ts";
import { stopRun } from "../hosts/stop.ts";
import { subagentStopRun } from "../hosts/subagentstop.ts";
import { userPromptRun } from "../hosts/userprompt.ts";
import type { LoggedEvent } from "../state/store.ts";
import { AUTOCONTINUE_GATE } from "./autocontinue.ts";
import { COMMIT_GATE } from "./commit.ts";
import { EDITS_GATE } from "./edits.ts";
import { HANDOFF_GATE } from "./handoff.ts";
import { PLANPROMPT_GATE } from "./planprompt.ts";
import { PLANSTOP_GATE } from "./planstop.ts";
import type { GateDefinition, GateRequest } from "./preflight.ts";
import { PROD_DEPLOY_GATE } from "./proddeploy.ts";
import { REANCHOR_GATE } from "./reanchor.ts";
import { STALE_GATE } from "./stale.ts";
import { STATEBIN_GATE } from "./statebin.ts";
import { TEARDOWN_GATE } from "./teardown.ts";
import { UNKNOWN_TOOL_GATE } from "./unknown.ts";
import { VERSION_GATE } from "./version.ts";

export type GateRun = HookRun & Readonly<{ events: readonly LoggedEvent[] }>;

const PRE_TOOL_USE_GATES: readonly GateDefinition[] = [
  COMMIT_GATE,
  EDITS_GATE,
  UNKNOWN_TOOL_GATE,
  PROD_DEPLOY_GATE,
];

const SESSION_START_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "allow" | "context" | "gateError" }>>[] =
  [STALE_GATE, VERSION_GATE, REANCHOR_GATE];

const NO_VERDICT_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "noVerdict" | "gateError" }>>[] = [
  STATEBIN_GATE,
  TEARDOWN_GATE,
];

const STOP_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "allow" | "deny" | "push" }>>[] = [
  AUTOCONTINUE_GATE,
  PLANSTOP_GATE,
];

const USER_PROMPT_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "allow" | "deny" | "context" }>>[] = [
  PLANPROMPT_GATE,
];

const SUBAGENT_STOP_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "noVerdict" }>>[] = [HANDOFF_GATE];

export function runGate(argv: readonly string[], payload: string): GateRun {
  const [name, ...gateArguments] = argv;
  const request: GateRequest = { envelope: readEnvelope(payload), argv: gateArguments };
  const escalated = request.envelope.stopHookActive;

  const run =
    routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ??
    routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ??
    routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ??
    routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun) ??
    routed(USER_PROMPT_GATES, name, request, userPromptRun, loudRun) ??
    routed(SUBAGENT_STOP_GATES, name, request, subagentStopRun, loudRun);

  return run ?? gateErrorRun(`the gate entry point (unknown gate '${name ?? ""}')`);
}

function routed<V extends GateVerdict>(
  gates: readonly GateDefinition<V>[],
  name: string | undefined,
  request: GateRequest,
  transport: (verdict: V) => HookRun,
  onFailure: (subject: string, cause?: unknown) => GateRun,
): GateRun | undefined {
  const gate = gates.find((definition) => definition.gate === name);
  return gate === undefined ? undefined : runWith(gate, request, transport, onFailure);
}

function runWith<V extends GateVerdict>(
  gate: GateDefinition<V>,
  request: GateRequest,
  transport: (verdict: V) => HookRun,
  onFailure: (subject: string, cause?: unknown) => GateRun,
): GateRun {
  try {
    const outcome = gate.judge(request);
    const run = transport(outcome.verdict);
    return { ...run, stderr: run.stderr + (outcome.stderr ?? ""), events: outcome.events };
  } catch (cause) {
    return onFailure(gate.errorSubject, cause);
  }
}

function gateErrorRun(subject: string, cause?: unknown): GateRun {
  const run = preToolUseRun({ kind: "gateError", subject });
  return { ...run, stderr: run.stderr + explainedCause(cause), events: [] };
}

const LOUD_EXIT = 1;

function loudRun(_subject: string, cause?: unknown): GateRun {
  return { exit: LOUD_EXIT, stdout: "", stderr: explainedCause(cause), events: [] };
}

function explainedCause(cause: unknown): string {
  if (cause === undefined) return "";
  return `oso-code: cause: ${cause instanceof Error ? cause.message : String(cause)}\n`;
}
