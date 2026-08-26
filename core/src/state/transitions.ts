export type StatePatch = Readonly<Record<string, string>>;

export function armSlice(sliceId: string): StatePatch {
  return { mode: "plan", active_slice: sliceId, verify_green: "false" };
}

export function closeSlice(): StatePatch {
  return { active_slice: "none", verify_green: "true", auto_wait: "none" };
}

export function armAuto(changeSlug: string): StatePatch {
  return { auto: "running", auto_change: changeSlug };
}

export function park(): StatePatch {
  return { auto: "parked" };
}

export function disarm(): StatePatch {
  return { auto: "done" };
}

export function armWait(label: string): StatePatch {
  return { auto_wait: label };
}

export function clearWait(): StatePatch {
  return { auto_wait: "none" };
}

export function armPlan(): StatePatch {
  return { mode: "plan", active_slice: "none", verify_green: "false" };
}

export function armRun(changeSlug: string): StatePatch {
  return { auto_change: changeSlug };
}

export function closeRun(): StatePatch {
  return { auto_change: "" };
}
