import type { StopVerdict } from "./envelope.ts";
import type { HookRun } from "./pretooluse.ts";

const NOTHING_TO_SAY = "{}";

export function stopRun(verdict: StopVerdict, escalated: boolean): HookRun {
  switch (verdict.kind) {
    case "allow":
      return spoken(NOTHING_TO_SAY);
    case "push":
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

function spoken(stdout: string): HookRun {
  return { exit: 0, stdout: `${stdout}\n`, stderr: "" };
}
