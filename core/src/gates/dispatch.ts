import { readEnvelope } from "../hosts/envelope.ts";
import { preToolUseRun, type HookRun } from "../hosts/pretooluse.ts";
import type { LoggedEvent } from "../state/store.ts";
import { COMMIT_GATE } from "./commit.ts";
import { EDITS_GATE } from "./edits.ts";
import { PROD_DEPLOY_GATE } from "./proddeploy.ts";
import { UNKNOWN_TOOL_GATE } from "./unknown.ts";
import type { GateDefinition } from "./preflight.ts";

export type GateRun = HookRun & Readonly<{ events: readonly LoggedEvent[] }>;

const PRE_TOOL_USE_GATES: readonly GateDefinition[] = [
  COMMIT_GATE,
  EDITS_GATE,
  UNKNOWN_TOOL_GATE,
  PROD_DEPLOY_GATE,
];

export function runGate(argv: readonly string[], payload: string): GateRun {
  const [name, ...gateArguments] = argv;
  const gate = PRE_TOOL_USE_GATES.find((definition) => definition.gate === name);
  if (gate === undefined) return gateErrorRun(`the gate entry point (unknown gate '${name ?? ""}')`);
  try {
    const outcome = gate.judge({ envelope: readEnvelope(payload), argv: gateArguments });
    return { ...preToolUseRun(outcome.verdict), events: outcome.events };
  } catch (cause) {
    return gateErrorRun(gate.errorSubject, cause);
  }
}

function gateErrorRun(subject: string, cause?: unknown): GateRun {
  const run = preToolUseRun({ kind: "gateError", subject });
  return { ...run, stderr: run.stderr + explainedCause(cause), events: [] };
}

function explainedCause(cause: unknown): string {
  if (cause === undefined) return "";
  return `oso-code: cause: ${cause instanceof Error ? cause.message : String(cause)}\n`;
}
