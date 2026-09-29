import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BackgroundTasks } from "../hosts/background-tasks.ts";
import { ALLOWED, type GateOutcome, type HookEnvelope, type StopVerdict } from "../hosts/envelope.ts";
import { gateRow, type HostName } from "../routes/routes.ts";
import {
  appendJournal,
  causeOf,
  isDirectory,
  isNameToken,
  journalFileFor,
  readStateFile,
  sha256Hex,
  stateFileFor,
  type LoggedEvent,
} from "../state/store.ts";
import { isCount, removeWaitMark, waitMarkFileFor } from "./delegation.ts";
import { resolveInFlight, type InFlightResolution } from "./in-flight.ts";
import { completedAgentCount } from "./in-flight-registry.ts";
import {
  hookSessionId,
  RUN_ARMED,
  stateRecords,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";
import { watchdogAlive } from "./watch.ts";

export const PUSHES_WITHOUT_PROGRESS_CAP = 3;
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

const RE_ANCHOR_THE_RUN =
  "oso-code: this run is unattended and still in flight, and this turn ended without parking or closing it. " +
  "Continue it: re-read the position from the change's oso/index NEXT: line and from active_slice in oso-state, " +
  "append every milestone to the run journal with oso-state journal, and park the run per the flow's own rules " +
  "if a decision needs the operator.";

type ContinuationHost = Readonly<{
  order: string;
  delegationsReturnInTurn: boolean;
}>;

const NOTIFICATION_RESUMED_HOST: ContinuationHost = {
  order:
    `${RE_ANCHOR_THE_RUN} If a delegation is still in flight, do NOT relaunch it — its completion ` +
    "notification is what resumes the run, so wait for that instead.",
  delegationsReturnInTurn: false,
};

export const DELEGATIONS_RETURN_IN_TURN_HOST: ContinuationHost = {
  order:
    `${RE_ANCHOR_THE_RUN} A delegation on this host returns inside the turn that launched it, so a turn that ` +
    "has ended left none in flight: read the report the launch itself returned rather than waiting for a " +
    "notification this host never sends.",
  delegationsReturnInTurn: true,
};

const CONTINUATION_HOSTS: Readonly<Record<HostName, ContinuationHost>> = {
  claude: NOTIFICATION_RESUMED_HOST,
  opencode: DELEGATIONS_RETURN_IN_TURN_HOST,
};

function continuationHostOf(host: HostName): ContinuationHost {
  return CONTINUATION_HOSTS[host];
}

const CAP_MILESTONE =
  `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress — allowing the stop`;

export const AUTOCONTINUE_GATE: GateDefinition<StopVerdict> = {
  gate: "autocontinue",
  errorSubject: "the unattended-run continuation gate",
  judge: judgeAutocontinue,
};

type OwnedStop = Readonly<{ envelope: HookEnvelope; sessionId: string; projectDir: string; content: string }>;

type RunPosition = Readonly<{
  projectDir: string;
  sessionId: string;
  journalFile: string;
  tallyFile: string;
}>;

type ProgressReading =
  | Readonly<{ kind: "progressed" }>
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "unreadable"; cause: string }>;

type ProgressMeasure = Readonly<{
  since: (tally: string) => ProgressReading;
  recorded: () => string;
}>;

type PushRequest = Readonly<{
  position: RunPosition;
  progress: ProgressMeasure;
  turnAlreadyContinued: boolean;
  order: string;
  observed: string;
}>;

const PROGRESSED: ProgressReading = { kind: "progressed" };
const UNCHANGED: ProgressReading = { kind: "unchanged" };

function judgeAutocontinue({ envelope }: GateRequest): GateOutcome<StopVerdict> {
  const host = continuationHostOf(envelope.caller.host);
  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;

  const projectDir = envelope.cwd;
  if (!isDirectory(projectDir)) return ALLOWED;

  const content = ownRunState(stateFileFor(projectDir), sessionId);
  if (content === undefined) return ALLOWED;

  const stop: OwnedStop = { envelope, sessionId, projectDir, content };
  return host.delegationsReturnInTurn ? continueInTurnRun(stop, host.order) : continueNotifiedRun(stop, host.order);
}

function continueInTurnRun(stop: OwnedStop, order: string): GateOutcome<StopVerdict> {
  const failure = removeWaitMark(waitMarkFileFor(stop.projectDir, stop.sessionId));
  if (stateValue(stop.content, "auto") !== RUN_ARMED) {
    return failure === undefined ? ALLOWED : degraded(stop.sessionId, failure);
  }
  const position = positionOf(stop);
  const pushed = pushUnlessCapped({
    position,
    progress: journalProgress(position.journalFile),
    turnAlreadyContinued: stop.envelope.stopHookActive,
    order,
    observed: "",
  });
  if (failure === undefined) return pushed;
  return { ...pushed, events: [...pushed.events, degradedEvent(stop.sessionId, failure)] };
}

function continueNotifiedRun(stop: OwnedStop, order: string): GateOutcome<StopVerdict> {
  if (stateValue(stop.content, "auto") !== RUN_ARMED) return ALLOWED;

  const reading = readDelegations(stop);
  if (reading.kind === "unreadable") return degraded(stop.sessionId, reading.cause);

  const { resolution, watchdogLive } = reading;
  const observed =
    `background_tasks=${stop.envelope.backgroundTasks.kind} in_flight=${resolution.agents.length}`;
  if (resolution.agents.length > 0) return awaitingDelegations(stop, watchdogLive, observed);

  const heads = branchHeadsOf(stop.projectDir);
  const pushed = pushUnlessCapped({
    position: positionOf(stop),
    progress: runProgress(snapshotOf(stop, heads)),
    turnAlreadyContinued: stop.envelope.stopHookActive,
    order,
    observed,
  });
  if (heads.kind === "read") return pushed;
  const unreadHeads = gateEvent("auto-continue-heads-unreadable", stop.sessionId, heads.cause);
  return { ...pushed, events: [unreadHeads, ...pushed.events] };
}

type DelegationReading =
  | Readonly<{ kind: "read"; resolution: InFlightResolution; watchdogLive: boolean }>
  | Readonly<{ kind: "unreadable"; cause: string }>;

function readDelegations(stop: OwnedStop): DelegationReading {
  try {
    const resolution = resolveInFlight(stop.envelope);
    const watchdogLive =
      resolution.agents.length > 0 && watchdogAlive(stateFileFor(stop.projectDir), stop.sessionId);
    return { kind: "read", resolution, watchdogLive };
  } catch (cause) {
    return { kind: "unreadable", cause: causeOf(cause) };
  }
}

function awaitingDelegations(stop: OwnedStop, watchdogLive: boolean, observed: string): GateOutcome<StopVerdict> {
  if (watchdogLive) return allowedWith(gateEvent("auto-continue-held", stop.sessionId, observed));
  if (stop.envelope.stopHookActive) {
    return allowedWith(gateEvent("auto-continue-watch-unstarted", stop.sessionId, observed));
  }
  return {
    verdict: { kind: "push", reason: START_THE_WATCH_ORDER },
    events: [gateEvent("auto-continue-watch-requested", stop.sessionId, observed)],
  };
}

const START_THE_WATCH = '"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch';

const START_THE_WATCH_ORDER =
  "oso-code: this unattended run ended its turn with delegations still in flight and no watchdog running for " +
  `this session. Start one as a BACKGROUND Bash task (run_in_background: true): ${START_THE_WATCH} — then end ` +
  "the turn. The watch's exit wakes the run: it exits when every delegation has ended, or when one is stuck, " +
  "long-running or ended without notice, naming it. Do NOT relaunch a delegation still in flight.";

type RunSnapshot = Readonly<{
  heads: string;
  flow: readonly string[];
  completedAgents: string;
  completed: readonly string[];
}>;

type HeadsReading = Readonly<{ kind: "read"; digest: string }> | Readonly<{ kind: "unreadable"; cause: string }>;

const FLOW_KEYS = ["active_slice", "verify_green", "auto"] as const;

function snapshotOf(stop: OwnedStop, heads: HeadsReading): RunSnapshot {
  return {
    heads: heads.kind === "read" ? heads.digest : "",
    flow: flowRecordsIn(stop.content),
    completedAgents: String(completedAgentCount(stateFileFor(stop.projectDir), stop.sessionId)),
    completed: completedIn(stop.envelope.backgroundTasks).filter(isNameToken),
  };
}

function snapshotIn(tally: string): RunSnapshot {
  return {
    heads: stateValue(tally, "heads"),
    flow: flowRecordsIn(tally),
    completedAgents: stateValue(tally, "completed_agents"),
    completed: stateRecords(tally, "completed"),
  };
}

function runProgress(current: RunSnapshot): ProgressMeasure {
  return {
    since: (tally) => (progressedBetween(snapshotIn(tally), current) ? PROGRESSED : UNCHANGED),
    recorded: () => serializedSnapshot(current),
  };
}

function progressedBetween(previous: RunSnapshot, current: RunSnapshot): boolean {
  return (
    headsMoved(previous.heads, current.heads) ||
    previous.flow.join("\n") !== current.flow.join("\n") ||
    (isCount(previous.completedAgents) && Number(current.completedAgents) > Number(previous.completedAgents)) ||
    current.completed.some((agentId) => !previous.completed.includes(agentId))
  );
}

function headsMoved(previous: string, current: string): boolean {
  return previous !== "" && current !== "" && previous !== current;
}

function serializedSnapshot(snapshot: RunSnapshot): string {
  return [
    `heads=${snapshot.heads}`,
    ...snapshot.flow,
    `completed_agents=${snapshot.completedAgents}`,
    ...snapshot.completed.map((agentId) => `completed=${agentId}`),
  ]
    .map((line) => `${line}\n`)
    .join("");
}

function flowRecordsIn(content: string): string[] {
  return FLOW_KEYS.flatMap((key) => stateRecords(content, key).map((value) => `${key}=${value}`));
}

function completedIn(backgroundTasks: BackgroundTasks): readonly string[] {
  return backgroundTasks.kind === "object" ? backgroundTasks.completed : [];
}

function branchHeadsOf(projectDir: string): HeadsReading {
  const listed = spawnSync("git", ["-C", projectDir, "for-each-ref", "refs/heads"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.error !== undefined) {
    return { kind: "unreadable", cause: `git for-each-ref refs/heads could not run: ${causeOf(listed.error)}` };
  }
  if (listed.status !== 0) {
    const exit = listed.status ?? listed.signal;
    return { kind: "unreadable", cause: `git for-each-ref refs/heads exited ${exit}: ${listed.stderr.trim()}` };
  }
  return { kind: "read", digest: sha256Hex(listed.stdout) };
}

function journalProgress(journalFile: string): ProgressMeasure {
  return {
    since: (tally) => {
      const bytesAtLastPush = stateValue(tally, "journal_bytes");
      if (!isCount(bytesAtLastPush)) {
        return { kind: "unreadable", cause: `the push tally holds no count of journal bytes: ${bytesAtLastPush}` };
      }
      return journalBytesIn(journalFile) > Number(bytesAtLastPush) ? PROGRESSED : UNCHANGED;
    },
    recorded: () => `journal_bytes=${journalBytesIn(journalFile)}\n`,
  };
}

function pushUnlessCapped(request: PushRequest): GateOutcome<StopVerdict> {
  const { position, progress } = request;
  const counted = pushesWithoutProgress(position, progress, request.turnAlreadyContinued);
  if (typeof counted !== "number") return counted;

  if (counted > PUSHES_WITHOUT_PROGRESS_CAP) {
    const announced = counted === PUSHES_WITHOUT_PROGRESS_CAP + 1 ? announceCap(position) : [];
    const failure = rememberTally(position, counted, progress);
    const trailing = failure === undefined ? [] : [degradedEvent(position.sessionId, failure)];
    return { verdict: { kind: "allow" }, events: [...announced, ...trailing] };
  }

  const failure = rememberTally(position, counted, progress);
  if (failure !== undefined) return degraded(position.sessionId, failure);
  return {
    verdict: { kind: "push", reason: request.order },
    events: [gateEvent("auto-continued", position.sessionId, request.observed)],
  };
}

function pushesWithoutProgress(
  position: RunPosition,
  progress: ProgressMeasure,
  turnAlreadyContinued: boolean,
): number | GateOutcome<StopVerdict> {
  const started = turnAlreadyContinued ? 1 : 0;
  const stats = statSync(position.tallyFile, { throwIfNoEntry: false });
  if (stats === undefined) return started + 1;

  const read = stats.isFile() ? readStateFile(position.tallyFile) : { kind: "unreadable" as const, cause: "" };
  if (read.kind !== "ok") return degraded(position.sessionId, "the push tally is not a readable file");

  const remembered = stateValue(read.content, "pushes");
  if (!isCount(remembered)) {
    return degraded(position.sessionId, `the push tally holds no count of pushes: ${remembered}`);
  }
  const reading = progress.since(read.content);
  if (reading.kind === "unreadable") return degraded(position.sessionId, reading.cause);
  return (reading.kind === "progressed" ? 0 : Number(remembered)) + 1;
}

function announceCap(position: RunPosition): LoggedEvent[] {
  try {
    appendJournal(position.journalFile, CAP_MILESTONE);
    return [];
  } catch (cause) {
    return [gateEvent("auto-continue-unjournaled", position.sessionId, causeOf(cause))];
  }
}

function rememberTally(position: RunPosition, pushes: number, progress: ProgressMeasure): string | undefined {
  try {
    mkdirSync(path.dirname(position.tallyFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    writeFileSync(position.tallyFile, `pushes=${pushes}\n${progress.recorded()}`, { mode: OWNER_ONLY_FILE });
    return undefined;
  } catch (cause) {
    return causeOf(cause);
  }
}

function positionOf(stop: OwnedStop): RunPosition {
  const journalFile = journalFileFor(stop.projectDir);
  return {
    projectDir: stop.projectDir,
    sessionId: stop.sessionId,
    journalFile,
    tallyFile: tallyFileFor(journalFile),
  };
}

function allowedWith(event: LoggedEvent): GateOutcome<StopVerdict> {
  return { verdict: { kind: "allow" }, events: [event] };
}

function degraded(sessionId: string, cause: string): GateOutcome<StopVerdict> {
  return allowedWith(degradedEvent(sessionId, cause));
}

function degradedEvent(sessionId: string, cause: string): LoggedEvent {
  return gateEvent("auto-continue-degraded", sessionId, cause);
}

function gateEvent(event: string, session: string, detail: string): LoggedEvent {
  const route = gateRow("autocontinue");
  return { event, session, command: detail, gate: route.script, hookEvent: route.event };
}

function ownRunState(stateFile: string, sessionId: string): string | undefined {
  const stats = statSync(stateFile, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) return undefined;
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return undefined;
  return stateValue(read.content, "session") === sessionId ? read.content : undefined;
}

function tallyFileFor(journalFile: string): string {
  return path.join(path.dirname(journalFile), `${path.basename(journalFile, ".log")}.pushes`);
}

function journalBytesIn(journalFile: string): number {
  const stats = statSync(journalFile, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile() ? stats.size : 0;
}
