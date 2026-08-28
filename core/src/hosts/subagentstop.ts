import type { SubagentStopVerdict } from "./envelope.ts";
import type { HookRun } from "./pretooluse.ts";

const NOTHING_TO_SAY = "{}";

export function subagentStopRun(_verdict: SubagentStopVerdict): HookRun {
  return { exit: 0, stdout: `${NOTHING_TO_SAY}\n`, stderr: "" };
}
