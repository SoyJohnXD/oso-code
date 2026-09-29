import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { stateFileFor } from "../state/store.ts";
import {
  denied,
  deniedForUnusableState,
  foreignOwner,
  hookSessionId,
  osoStateRemedy,
  payloadUnparseable,
  readArmedState,
  stateRecords,
  stateSays,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

export const EDITS_GATE: GateDefinition = {
  gate: "edits",
  errorSubject: "the slice gate",
  judge: judgeEdits,
};

function judgeEdits({ envelope }: GateRequest): GateOutcome {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("edits", stateFile, session);

  if (!planAwaitsItsSlice(state.content, session)) return ALLOWED;

  return denied({
    gate: "edits",
    message: `oso-code: plan mode is active but no slice is active. Activate it first (${sliceArmingRemedy(session)}), then retry the edit.`,
    event: "edit-denied",
    session,
    detail: envelope.filePath,
  });
}

export function planAwaitsItsSlice(stateContent: string, session: string): boolean {
  if (foreignOwner(stateContent, session) !== undefined) return false;
  return stateSays(stateContent, "mode", "plan") && !aSliceIsActive(stateContent);
}

export function sliceArmingRemedy(session: string): string {
  return osoStateRemedy(session, "set active_slice=<n>");
}

function aSliceIsActive(stateContent: string): boolean {
  const slices = stateRecords(stateContent, "active_slice");
  return slices.some((slice) => slice !== "") && !slices.includes("none");
}
