import type { NoVerdictVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, gateErrorText, UNSPOKEN, type HookRun } from "./hook-run.ts";

export function sessionEndRun(verdict: NoVerdictVerdict): HookRun {
  switch (verdict.kind) {
    case "noVerdict":
      return UNSPOKEN;
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}
