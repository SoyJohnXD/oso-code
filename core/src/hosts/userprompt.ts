import type { UserPromptVerdict } from "./envelope.ts";
import { NOTHING_TO_SAY, spoken, type HookRun } from "./hook-run.ts";

const HOOK_EVENT = "UserPromptSubmit";

export function userPromptRun(verdict: UserPromptVerdict): HookRun {
  switch (verdict.kind) {
    case "allow":
      return spoken(NOTHING_TO_SAY);
    case "deny":
      return spoken(JSON.stringify({ decision: "block", reason: verdict.message }));
    case "context":
      return spoken(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext: verdict.additionalContext },
        }),
      );
  }
}
