export type HookRun = Readonly<{ exit: number; stdout: string; stderr: string }>;

export const GATE_ERROR_EXIT = 2;
export const NOTHING_TO_SAY = "{}";
export const UNSPOKEN: HookRun = { exit: 0, stdout: "", stderr: "" };

export function spoken(stdout: string): HookRun {
  return { exit: 0, stdout: `${stdout}\n`, stderr: "" };
}

export function gateErrorText(subject: string): string {
  return (
    `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. ` +
    "No remedy is known for this failure.\n"
  );
}
