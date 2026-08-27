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
  stateMatches,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

const PLAN_MODE = /^mode=plan$/m;
const ANY_ACTIVE_SLICE = /^active_slice=./m;
const CLOSED_SLICE_SENTINEL = /^active_slice=none$/m;

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

  if (!stateMatches(state.content, PLAN_MODE)) return ALLOWED;
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
  return stateMatches(stateContent, ANY_ACTIVE_SLICE) && !stateMatches(stateContent, CLOSED_SLICE_SENTINEL);
}
