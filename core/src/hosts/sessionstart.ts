import type { SessionStartVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, gateErrorText, spoken, UNSPOKEN, type HookRun } from "./hook-run.ts";

const HOOK_EVENT = "SessionStart";

export function sessionStartRun(verdict: SessionStartVerdict): HookRun {
  switch (verdict.kind) {
    case "allow":
      return UNSPOKEN;
    case "context":
      return spoken(contextEnvelope(verdict.additionalContext));
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}

function contextEnvelope(additionalContext: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      additionalContext,
    },
  });
}
