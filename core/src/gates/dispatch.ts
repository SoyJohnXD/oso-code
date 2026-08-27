import type { GateVerdict } from "../hosts/envelope.ts";
import { readEnvelope } from "../hosts/envelope.ts";
import { preToolUseRun, type HookRun } from "../hosts/pretooluse.ts";
import { sessionEndRun } from "../hosts/sessionend.ts";
import { sessionStartRun } from "../hosts/sessionstart.ts";
import type { LoggedEvent } from "../state/store.ts";
import { COMMIT_GATE } from "./commit.ts";
import { EDITS_GATE } from "./edits.ts";
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

export function runGate(argv: readonly string[], payload: string): GateRun {
  const [name, ...gateArguments] = argv;
  const request: GateRequest = { envelope: readEnvelope(payload), argv: gateArguments };

  const preToolUse = PRE_TOOL_USE_GATES.find((definition) => definition.gate === name);
  if (preToolUse !== undefined) return runWith(preToolUse, request, preToolUseRun, gateErrorRun);

  const sessionStart = SESSION_START_GATES.find((definition) => definition.gate === name);
  if (sessionStart !== undefined) return runWith(sessionStart, request, sessionStartRun, loudRun);

  const sessionEnd = NO_VERDICT_GATES.find((definition) => definition.gate === name);
  if (sessionEnd !== undefined) return runWith(sessionEnd, request, sessionEndRun, loudRun);

  return gateErrorRun(`the gate entry point (unknown gate '${name ?? ""}')`);
}

function runWith<V extends GateVerdict>(
  gate: GateDefinition<V>,
  request: GateRequest,
  transport: (verdict: V) => HookRun,
  onFailure: (subject: string, cause?: unknown) => GateRun,
): GateRun {
  try {
    const outcome = gate.judge(request);
    return { ...transport(outcome.verdict), events: outcome.events };
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
