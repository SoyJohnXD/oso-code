import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { stateFileFor } from "../state/store.ts";
import {
  denied,
  deniedForUnusableState,
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

  if (!stateSays(state.content, "mode", "plan")) return ALLOWED;
  if (aSliceIsActive(state.content)) return ALLOWED;

  const remedy = osoStateRemedy(session, "set active_slice=<n>");
  return denied({
    gate: "edits",
    message: `oso-code: plan mode is active but no slice is active. Activate it first (${remedy}), then retry the edit.`,
    event: "edit-denied",
    session,
    detail: envelope.filePath,
  });
}

function aSliceIsActive(stateContent: string): boolean {
  const slices = stateRecords(stateContent, "active_slice");
  return slices.some((slice) => slice !== "") && !slices.includes("none");
}
