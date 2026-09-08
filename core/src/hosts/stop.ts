import type { HookCaller, StopVerdict } from "./envelope.ts";
import { GATE_ERROR_EXIT, NOTHING_TO_SAY, spoken, type HookRun } from "./hook-run.ts";

export function stopRun(verdict: StopVerdict, escalated: boolean, caller: HookCaller): HookRun {
  switch (verdict.kind) {
    case "allow":
      return spoken(NOTHING_TO_SAY);
    case "push":
      if (caller.host === "codex") return { exit: GATE_ERROR_EXIT, stdout: "", stderr: `${verdict.reason}\n` };
      return spoken(JSON.stringify({ shouldContinue: true, decision: "block", reason: verdict.reason }));
    case "deny":
      return spoken(escalated ? endedEnvelope(verdict.message) : blockEnvelope(verdict.message));
  }
}

function blockEnvelope(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

function endedEnvelope(reason: string): string {
  return JSON.stringify({ continue: false, stopReason: reason, systemMessage: reason });
}
