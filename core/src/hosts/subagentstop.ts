import type { SubagentStopVerdict } from "./envelope.ts";
import { NOTHING_TO_SAY, spoken, type HookRun } from "./hook-run.ts";

export function subagentStopRun(_verdict: SubagentStopVerdict): HookRun {
  return spoken(NOTHING_TO_SAY);
}
