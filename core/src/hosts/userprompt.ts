import type { UserPromptVerdict } from "./envelope.ts";
import type { HookRun } from "./pretooluse.ts";

const HOOK_EVENT = "UserPromptSubmit";
const NOTHING_TO_SAY = "{}";

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

function spoken(stdout: string): HookRun {
  return { exit: 0, stdout: `${stdout}\n`, stderr: "" };
}
