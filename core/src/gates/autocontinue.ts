import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BackgroundTasks } from "../hosts/background-tasks.ts";
import { ALLOWED, type GateOutcome, type HookEnvelope, type StopVerdict } from "../hosts/envelope.ts";
import { gateRow, type HostName } from "../routes/routes.ts";
import { completedAgentCount } from "../state/in-flight-registry.ts";
import {
  appendJournal,
  causeOf,
  isDirectory,
  isNameToken,
  journalFileFor,
  readStateFile,
  sha256Hex,
  StateFileUnreadableError,
  stateFileFor,
  type LoggedEvent,
} from "../state/store.ts";
import { watchdogAlive } from "../state/watch.ts";
import { isCount } from "./delegation.ts";
import { adoptUnregistered, flagEndedWithoutNotice, resolveInFlight, type InFlightResolution } from "./in-flight.ts";
import {
  hookSessionId,
  ownRunState,
  RUN_ARMED,
  stateRecords,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

export const PUSHES_WITHOUT_PROGRESS_CAP = 3;
export const RUN_HELD_EVENT = "auto-continue-held";
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
    "has ended left none in flight, or the rail released it by session id: read the report the launch " +
    "itself returned rather than waiting for a notification this host never sends.",
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
  pushedEvent: string;
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
  if (stateValue(stop.content, "auto") !== RUN_ARMED) return ALLOWED;

  const childrenInFlight = activeIn(stop.envelope.backgroundTasks);
  if (childrenInFlight.length > 0) {
    const observed = `children_in_flight=${childrenInFlight.join(",")}`;
    return allowedWith(gateEvent(RUN_HELD_EVENT, stop.sessionId, observed));
  }
  return pushedWithRunProgress(stop, { order, pushedEvent: "auto-continued", observed: "" });
}

function continueNotifiedRun(stop: OwnedStop, order: string): GateOutcome<StopVerdict> {
  if (stateValue(stop.content, "auto") !== RUN_ARMED) return ALLOWED;

  const reading = readDelegations(stop);
  if (reading.kind === "unreadable") return degraded(stop.sessionId, reading.cause);

  const continued = continuedPastDelegations(stop, order, reading);
  const unreadableEntries = reading.resolution.unreadable.map((entry) =>
    gateEvent("auto-continue-registry-unreadable", stop.sessionId, `${entry.agentId}: ${entry.cause}`),
  );
  return { ...continued, events: [...unreadableEntries, ...continued.events] };
}

type DelegationReading =
  | Readonly<{ kind: "read"; resolution: InFlightResolution; watchdogLive: boolean }>
  | Readonly<{ kind: "unreadable"; cause: string }>;

function continuedPastDelegations(
  stop: OwnedStop,
  order: string,
  { resolution, watchdogLive }: Extract<DelegationReading, { kind: "read" }>,
): GateOutcome<StopVerdict> {
  const observed = observedDelegations(stop.envelope.backgroundTasks, resolution);
  if (!needsWatchdog(resolution)) {
    return pushedWithRunProgress(stop, { order, pushedEvent: "auto-continued", observed });
  }
  if (watchdogLive) return allowedWith(gateEvent(RUN_HELD_EVENT, stop.sessionId, observed));
  if (stop.envelope.stopHookActive) {
    return allowedWith(gateEvent("auto-continue-watch-unstarted", stop.sessionId, observed));
  }
  return pushedWithRunProgress(stop, {
    order: START_THE_WATCH_ORDER,
    pushedEvent: "auto-continue-watch-requested",
    observed,
  });
}

type RunPush = Pick<PushRequest, "order" | "pushedEvent" | "observed">;

function pushedWithRunProgress(stop: OwnedStop, push: RunPush): GateOutcome<StopVerdict> {
  const heads = branchHeadsOf(stop.projectDir);
  const pushed = pushedOrDegraded(stop, heads, push);
  if (heads.kind === "read") return pushed;
  const unreadHeads = gateEvent("auto-continue-heads-unreadable", stop.sessionId, heads.cause);
  return { ...pushed, events: [unreadHeads, ...pushed.events] };
}

function pushedOrDegraded(stop: OwnedStop, heads: HeadsReading, push: RunPush): GateOutcome<StopVerdict> {
  try {
    return pushUnlessCapped({
      position: positionOf(stop),
      progress: runProgress(snapshotOf(stop, heads)),
      turnAlreadyContinued: stop.envelope.stopHookActive,
      ...push,
    });
  } catch (cause) {
    if (cause instanceof StateFileUnreadableError) return degraded(stop.sessionId, causeOf(cause));
    throw cause;
  }
}

function readDelegations(stop: OwnedStop): DelegationReading {
  try {
    adoptUnregistered(stop.envelope);
    flagEndedWithoutNotice(stop.envelope);
    const resolution = resolveInFlight(stop.envelope);
    const watchdogLive = needsWatchdog(resolution) && watchdogAlive(stateFileFor(stop.projectDir), stop.sessionId);
    return { kind: "read", resolution, watchdogLive };
  } catch (cause) {
    return { kind: "unreadable", cause: causeOf(cause) };
  }
}

function needsWatchdog(resolution: InFlightResolution): boolean {
  const { agentIds, endedWithoutNotice, unreadable } = resolution;
  return agentIds.length > 0 || endedWithoutNotice.length > 0 || unreadable.length > 0;
}

function observedDelegations(backgroundTasks: BackgroundTasks, resolution: InFlightResolution): string {
  const unfiltered = backgroundTasks.kind === "object" ? " subagent_filter=none" : "";
  const inFlight = `background_tasks=${backgroundTasks.kind}${unfiltered} in_flight=${resolution.agentIds.length}`;
  const ended = resolution.endedWithoutNotice.length;
  return ended === 0 ? inFlight : `${inFlight} ended_without_notice=${ended}`;
}

const START_THE_WATCH = '"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch';

const START_THE_WATCH_ORDER =
  "oso-code: this unattended run ended its turn with delegations still in flight or ended without notice, and " +
  `no watchdog running for this session. Start one as a BACKGROUND Bash task (run_in_background: true): ${START_THE_WATCH} — then end ` +
  "the turn. The watch's exit wakes the run: it exits when every delegation has ended, or when one is stuck, " +
  "long-running, unreadable or ended without notice, naming it. Do NOT relaunch a delegation still in flight.";

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

function activeIn(backgroundTasks: BackgroundTasks): readonly string[] {
  return backgroundTasks.kind === "object" ? backgroundTasks.active : [];
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
    events: [gateEvent(request.pushedEvent, position.sessionId, request.observed)],
  };
}

function pushesWithoutProgress(
  position: RunPosition,
  progress: ProgressMeasure,
  turnAlreadyContinued: boolean,
): number | GateOutcome<StopVerdict> {
  const started = turnAlreadyContinued ? 1 : 0;
  const read = readStateFile(position.tallyFile);
  if (read.kind === "absent") return started + 1;
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

function tallyFileFor(journalFile: string): string {
  return path.join(path.dirname(journalFile), `${path.basename(journalFile, ".log")}.pushes`);
}
