import type { PreToolUseVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, gateErrorText, spoken, UNSPOKEN, type HookRun } from "./hook-run.ts";

const HOOK_EVENT = "PreToolUse";

export function preToolUseRun(verdict: PreToolUseVerdict): HookRun {
  switch (verdict.kind) {
    case "allow":
      return UNSPOKEN;
    case "deny":
      return spoken(denyEnvelope(verdict.message));
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}

function denyEnvelope(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
