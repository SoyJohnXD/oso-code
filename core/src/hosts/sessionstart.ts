import type { SessionStartVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, gateErrorText, type HookRun } from "./pretooluse.ts";

const HOOK_EVENT = "SessionStart";

export function sessionStartRun(verdict: SessionStartVerdict): HookRun {
  switch (verdict.kind) {
    case "allow":
      return { exit: 0, stdout: "", stderr: "" };
    case "context":
      return { exit: 0, stdout: `${contextEnvelope(verdict.additionalContext)}\n`, stderr: "" };
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
