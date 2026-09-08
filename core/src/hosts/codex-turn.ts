import { readFileSync } from "node:fs";
import { isReadableRegularFile } from "../state/store.ts";
import { jsonField, type HookEnvelope } from "./envelope.ts";
import { isTask, readCodexTranscript } from "./codex-presentation.ts";

export type CodexTurnMode = "plan" | "default" | "unknown";
export type CodexTurnSource = "transcript" | "permission_mode" | "unavailable";

export type CodexTurn = Readonly<{ mode: CodexTurnMode; source: CodexTurnSource }>;

const UNATTESTED: CodexTurn = { mode: "unknown", source: "unavailable" };

const SESSION_META = '"type":"session_meta"';
const EVENT_MESSAGE = '"type":"event_msg"';
const TASK_STARTED = '"type":"task_started"';
const MODE_KIND_FIELD = '"collaboration_mode_kind":"';

const PERMISSION_MODES: Readonly<Record<string, CodexTurnMode>> = {
  plan: "plan",
  default: "default",
  acceptEdits: "default",
  dontAsk: "default",
  bypassPermissions: "default",
};

const ATTESTABLE_MODES: Readonly<Record<string, CodexTurnMode>> = { plan: "plan", default: "default" };

export function resolveCodexTurn(envelope: HookEnvelope): CodexTurn {
  if (envelope.caller.host === "codex" && envelope.transcriptPath !== "") {
    const records = readCodexTranscript(envelope);
    const tasks = records.filter(isTask);
    const candidates = tasks.filter((task) => task.payload["turn_id"] === envelope.turnId);
    const task = candidates[0];
    if (candidates.length !== 1 || task !== tasks.at(-1)) return UNATTESTED;
    const kind = task?.payload["collaboration_mode_kind"];
    const mode = typeof kind === "string" ? ATTESTABLE_MODES[kind] : undefined;
    return mode === undefined ? UNATTESTED : { mode, source: "transcript" };
  }
  const attested = attestedFromTranscript(envelope);
  if (attested !== undefined) return attested;
  return { mode: PERMISSION_MODES[envelope.permissionMode] ?? "unknown", source: sourceFor(envelope.permissionMode) };
}

export function transcriptLinesMatching(transcriptPath: string, fragments: readonly string[]): string[] {
  return transcriptLines(transcriptPath).filter((line) => fragments.every((fragment) => line.includes(fragment)));
}

function sourceFor(permissionMode: string): CodexTurnSource {
  return PERMISSION_MODES[permissionMode] === undefined ? "unavailable" : "permission_mode";
}

function attestedFromTranscript(envelope: HookEnvelope): CodexTurn | undefined {
  const { transcriptPath, turnId, sessionId } = envelope;
  if (transcriptPath === "") return undefined;
  if (!isReadableRegularFile(transcriptPath)) return UNATTESTED;
  if (turnId === "" || sessionId === "") return undefined;

  const meta = transcriptLines(transcriptPath)[0] ?? "";
  const metaSession = jsonField(meta, "session_id");
  if (metaSession !== sessionId) return metaSession === "" ? undefined : UNATTESTED;
  if (!meta.includes(SESSION_META)) return undefined;

  const candidates = transcriptLinesMatching(transcriptPath, [
    EVENT_MESSAGE,
    TASK_STARTED,
    `"turn_id":"${turnId}"`,
    MODE_KIND_FIELD,
  ]);
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) return UNATTESTED;

  const candidate = candidates[0] as string;
  if (jsonField(candidate, "turn_id") !== turnId) return UNATTESTED;
  const mode = ATTESTABLE_MODES[jsonField(candidate, "collaboration_mode_kind")];
  if (mode === undefined) return UNATTESTED;
  return { mode, source: "transcript" };
}

function transcriptLines(transcriptPath: string): string[] {
  try {
    return readFileSync(transcriptPath, "utf8").split("\n");
  } catch {
    return [];
  }
}
