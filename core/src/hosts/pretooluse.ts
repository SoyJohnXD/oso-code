import type { PreToolUseVerdict } from "./envelope.ts";

export type HookRun = Readonly<{ exit: number; stdout: string; stderr: string }>;

const HOOK_EVENT = "PreToolUse";
export const GATE_ERROR_EXIT = 2;

export function preToolUseRun(verdict: PreToolUseVerdict): HookRun {
  switch (verdict.kind) {
    case "allow":
      return { exit: 0, stdout: "", stderr: "" };
    case "deny":
      return { exit: 0, stdout: `${denyEnvelope(verdict.message)}\n`, stderr: "" };
    case "gateError":
      return { exit: GATE_ERROR_EXIT, stdout: "", stderr: gateErrorText(verdict.subject) };
  }
}

export function gateErrorText(subject: string): string {
  return (
    `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. ` +
    "No remedy is known for this failure.\n"
  );
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
