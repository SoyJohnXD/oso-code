import type { NoVerdictVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, gateErrorText, type HookRun } from "./pretooluse.ts";

export function sessionEndRun(verdict: NoVerdictVerdict): HookRun {
  switch (verdict.kind) {
    case "noVerdict":
      return { exit: 0, stdout: "", stderr: "" };
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}
