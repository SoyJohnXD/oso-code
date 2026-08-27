import { existsSync } from "node:fs";
import path from "node:path";
import { ALLOWED, type GateOutcome, type SessionStartVerdict } from "../hosts/envelope.ts";
import { CHANGE_SLUG_PATTERN, isDirectory, readStateFile, stateFileFor, stateRootDirectory } from "../state/store.ts";
import { hookSessionId, pluginRootDirectory, stateValue, type GateDefinition, type GateRequest } from "./preflight.ts";

const DELEGATION_WAIT_CEILING_SECONDS = 45 * 60;
const ROADMAP_DISARMED_SENTINEL = "none";
const ROADMAP_PLACEHOLDER = "{roadmap}";

export const STALE_GATE: GateDefinition<SessionStartVerdict> = {
  gate: "stale",
  errorSubject: "the stale-state gate",
  judge: judgeStale,
};

function judgeStale({ envelope }: GateRequest): GateOutcome<SessionStartVerdict> {
  if (!isDirectory(stateRootDirectory())) return ALLOWED;

  const stateFile = stateFileFor(envelope.cwd);
  if (!existsSync(stateFile)) return ALLOWED;

  const content = contentOf(stateFile);
  const sessionId = hookSessionId(envelope);
  if (stateValue(content, "session") === sessionId) return ALLOWED;

  const context = staleStateContext(stateFile, content, sessionId);
  return { verdict: { kind: "context", additionalContext: context }, events: [] };
}

function staleStateContext(stateFile: string, content: string, sessionId: string): string {
  const skillPrefix = skillPrefixFor();
  const stateBin = quoted(stateBinPath());
  const clearCommand = `${stateBin} --session ${quoted(sessionId)} clear`;
  const leftByAnother =
    `oso-code: this repository's own runtime state (${path.basename(stateFile)}) was left by another session, ` +
    "and its flags arm this session's gates too";

  const roadmapValue = stateValue(content, "roadmap");
  const roadmapInFlight = roadmapValue === ROADMAP_DISARMED_SENTINEL ? "" : roadmapValue;
  if (roadmapInFlight === "") {
    return (
      `${leftByAnother} — if the user is resuming an oso-code plan change, run ${skillPrefix}plan {change} ` +
      `so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale ` +
      `and ${clearCommand} drops it.`
    );
  }

  const routeSlug = CHANGE_SLUG_PATTERN.test(roadmapInFlight) ? roadmapInFlight : ROADMAP_PLACEHOLDER;
  const disarmCommand = `${stateBin} --session ${quoted(sessionId)} set roadmap=none`;
  return (
    `${leftByAnother}, and it names a roadmap in flight — if the user is resuming that roadmap, run ` +
    `${skillPrefix}roadmap ${routeSlug} so its chain re-reads its own record and arms the child that record ` +
    `leaves un-run; if that roadmap is over or abandoned, ${disarmCommand} drops the claim it makes on this ` +
    `repository and ${clearCommand} drops the whole file.`
  );
}

function skillPrefixFor(): string {
  if (process.env["OSO_HOST"] === "opencode") return "/oso-";
  const agent = process.env["OSO_AGENT"];
  if (agent !== undefined && agent !== "") return "$oso-code:";
  return "/oso-code:";
}

function stateBinPath(): string {
  const configured = process.env["OSO_STATE_BIN"];
  if (configured !== undefined && configured !== "") return configured;
  return path.join(pluginRootDirectory(), "bin", "oso-state");
}

function contentOf(stateFile: string): string {
  const read = readStateFile(stateFile);
  return read.kind === "ok" ? read.content : "";
}

function quoted(value: string): string {
  return `"${value}"`;
}

export function waitExpired(now: number, markedAtEpochSeconds: number): boolean {
  return now - markedAtEpochSeconds >= DELEGATION_WAIT_CEILING_SECONDS;
}
