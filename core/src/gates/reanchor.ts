import { ALLOWED, type GateOutcome, type SessionStartVerdict } from "../hosts/envelope.ts";
import { isDirectory, journalFileFor, readStateFile, stateFileFor } from "../state/store.ts";
import { hookSessionId, stateValue, type GateDefinition, type GateRequest } from "./preflight.ts";

export const REANCHOR_GATE: GateDefinition<SessionStartVerdict> = {
  gate: "reanchor",
  errorSubject: "the re-anchor gate",
  judge: judgeReanchor,
};

function judgeReanchor({ envelope }: GateRequest): GateOutcome<SessionStartVerdict> {
  if (envelope.source !== "compact") return ALLOWED;

  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;
  if (!isDirectory(envelope.cwd)) return ALLOWED;

  const stateFile = stateFileFor(envelope.cwd);
  const runMarker = unattendedRunMarker(stateFile, sessionId);
  if (runMarker === undefined) return ALLOWED;

  let unattendedRun = false;
  if (runMarker === "running") {
    unattendedRun = true;
  } else if (!sliceIsArmed(stateFile)) {
    return ALLOWED;
  }

  const context = reanchorContext(journalFileFor(envelope.cwd), unattendedRun);
  return { verdict: { kind: "context", additionalContext: context }, events: [] };
}

function unattendedRunMarker(stateFile: string, sessionId: string): string | undefined {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return undefined;
  if (stateValue(read.content, "session") !== sessionId) return undefined;
  return stateValue(read.content, "auto");
}

function sliceIsArmed(stateFile: string): boolean {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return false;
  if (stateValue(read.content, "mode") !== "plan") return false;
  const activeSlice = stateValue(read.content, "active_slice");
  return activeSlice !== "" && activeSlice !== "none";
}

function reanchorContext(journalFile: string, unattendedRun: boolean): string {
  const lines = [
    "oso-code: this session was compacted while a run was in flight — the window that held the position is " +
      "gone, the run is not. Re-read the position before the next action, from what outlives a compaction:",
    "- the change position: mem_search oso/index, then mem_get_observation on the row it returns, and read " +
      "its NEXT: line.",
    "- the run flags: oso-state show (mode, active_slice, verify_green, auto).",
  ];
  if (journalFile !== "") {
    lines.push(`- the milestones already landed: the run journal at ${journalFile}.`);
  }
  lines.push("Every milestone from here on is still appended with oso-state journal.");
  if (unattendedRun) {
    lines.push(
      "This run is unattended and still in flight: continue it now rather than waiting, and park it per the " +
        "rules of its own flow if a decision needs the operator.",
    );
  }
  return lines.join("\n");
}
