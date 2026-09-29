import type { GateVerdict, HookEnvelope } from "../hosts/envelope.ts";
import { UNSPOKEN, type HookRun } from "../hosts/hook-run.ts";
import { preToolUseRun } from "../hosts/pretooluse.ts";
import { sessionEndRun } from "../hosts/sessionend.ts";
import { sessionStartRun } from "../hosts/sessionstart.ts";
import { stopRun } from "../hosts/stop.ts";
import { claudePreToolUseGatesFor, PRE_TOOL_USE_ROUTE } from "../routes/routes.ts";
import type { LoggedEvent } from "../state/store.ts";
import { AUTOCONTINUE_GATE } from "./autocontinue.ts";
import { COMMIT_GATE } from "./commit.ts";
import { EDITS_GATE } from "./edits.ts";
import { SUBAGENT_START_GATE, SUBAGENT_STOP_GATE } from "./in-flight.ts";
import type { GateDefinition, GateRequest } from "./preflight.ts";
import { PROD_DEPLOY_GATE } from "./proddeploy.ts";
import { REANCHOR_GATE } from "./reanchor.ts";
import { STALE_GATE } from "./stale.ts";
import { STATEBIN_GATE } from "./statebin.ts";
import { TEARDOWN_GATE } from "./teardown.ts";
import { UNKNOWN_TOOL_GATE } from "./unknown.ts";
import { VERSION_GATE } from "./version.ts";

export type GateRun = HookRun & Readonly<{ verdict: GateVerdict; events: readonly LoggedEvent[] }>;

export const THE_GATE_ENTRY_POINT = "the gate entry point";

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
  SUBAGENT_START_GATE,
  SUBAGENT_STOP_GATE,
];

const STOP_GATES: readonly GateDefinition<Extract<GateVerdict, { kind: "allow" | "deny" | "push" }>>[] = [
  AUTOCONTINUE_GATE,
];

export function runGate(argv: readonly string[], envelope: HookEnvelope): GateRun {
  const [name, ...gateArguments] = argv;
  const request: GateRequest = { envelope, argv: gateArguments };
  const escalated = envelope.stopHookActive;
  if (name === PRE_TOOL_USE_ROUTE) return runPreToolUseGates(claudeGatesMatching(envelope.toolName), request);

  const run =
    routed(PRE_TOOL_USE_GATES, name, request, preToolUseRun, gateErrorRun) ??
    routed(SESSION_START_GATES, name, request, sessionStartRun, loudRun) ??
    routed(NO_VERDICT_GATES, name, request, sessionEndRun, loudRun) ??
    routed(STOP_GATES, name, request, (verdict) => stopRun(verdict, escalated), loudRun);

  return run ?? gateErrorRun(`${THE_GATE_ENTRY_POINT} (unknown gate '${name ?? ""}')`);
}

export function runPreToolUseGates(gates: readonly GateDefinition[], request: GateRequest): GateRun {
  const runs = gates.map((gate) => runWith(gate, request, preToolUseRun, gateErrorRun));
  const decisive =
    runs.find((run) => run.verdict.kind === "deny") ??
    runs.find((run) => run.verdict.kind === "gateError") ??
    NOTHING_DENIED;
  return {
    ...decisive,
    stderr: runs.map((run) => run.stderr).join(""),
    events: runs.flatMap((run) => run.events),
  };
}

const NOTHING_DENIED: GateRun = { ...UNSPOKEN, verdict: { kind: "allow" }, events: [] };

function claudeGatesMatching(toolName: string): readonly GateDefinition[] {
  const matching = claudePreToolUseGatesFor(toolName);
  return PRE_TOOL_USE_GATES.filter((gate) => matching.includes(gate.gate));
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
    return { ...run, stderr: run.stderr + (outcome.stderr ?? ""), verdict: outcome.verdict, events: outcome.events };
  } catch (cause) {
    return onFailure(gate.errorSubject, cause);
  }
}

export function gateErrorRun(subject: string, cause?: unknown): GateRun {
  const verdict: GateVerdict = { kind: "gateError", subject };
  const run = preToolUseRun(verdict);
  return { ...run, stderr: run.stderr + explainedCause(cause), verdict, events: [] };
}

const LOUD_EXIT = 1;

function loudRun(subject: string, cause?: unknown): GateRun {
  return {
    exit: LOUD_EXIT,
    stdout: "",
    stderr: explainedCause(cause),
    verdict: { kind: "gateError", subject },
    events: [],
  };
}

function explainedCause(cause: unknown): string {
  if (cause === undefined) return "";
  return `oso-code: cause: ${cause instanceof Error ? cause.message : String(cause)}\n`;
}
