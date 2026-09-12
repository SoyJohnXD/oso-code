import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALLOWED, type GateOutcome, type StopVerdict } from "../hosts/envelope.ts";
import { gateRow, type HostName } from "../routes/routes.ts";
import {
  appendJournal,
  causeOf,
  isDirectory,
  journalFileFor,
  readStateFile,
  type LoggedEvent,
} from "../state/store.ts";
import {
  DELEGATION_WAIT_CEILING_MINUTES,
  DELEGATION_WAIT_RENEWALS_CAP,
  EXPIRED_DELEGATION_CLAUSE,
  isCount,
  isDelegationLabel,
  nowEpochSeconds,
  readWaitMark,
  removeWaitMark,
  waitExpired,
  waitMarkFileFor,
  writeWaitMark,
  type StandingWaitMark,
} from "./delegation.ts";
import { hookSessionId, stateFileIfNamed, stateValue, type GateDefinition, type GateRequest } from "./preflight.ts";

export const PUSHES_WITHOUT_PROGRESS_CAP = 3;
const RUN_ARMED = "running";
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
  sidecarPath: (projectDir: string, runSession: string) => string;
}>;

const NOTIFICATION_RESUMED_HOST: ContinuationHost = {
  order:
    `${RE_ANCHOR_THE_RUN} If a delegation is still in flight, do NOT relaunch it — its completion ` +
    "notification is what resumes the run, so wait for that instead.",
  delegationsReturnInTurn: false,
  sidecarPath: waitMarkFileFor,
};

export const DELEGATIONS_RETURN_IN_TURN_HOST: ContinuationHost = {
  order:
    `${RE_ANCHOR_THE_RUN} A delegation on this host returns inside the turn that launched it, so a turn that ` +
    "has ended left none in flight: read the report the launch itself returned rather than waiting for a " +
    "notification this host never sends.",
  delegationsReturnInTurn: true,
  sidecarPath: waitMarkFileFor,
};

const CONTINUATION_HOSTS: Readonly<Record<HostName, ContinuationHost>> = {
  claude: NOTIFICATION_RESUMED_HOST,
  codex: NOTIFICATION_RESUMED_HOST,
  opencode: DELEGATIONS_RETURN_IN_TURN_HOST,
};

function continuationHostOf(host: HostName): ContinuationHost {
  return CONTINUATION_HOSTS[host];
}

const CAP_MILESTONE =
  `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress — allowing the stop`;

const EXPIRED_DELEGATION_CAP_MILESTONE =
  `auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes with a delegation marked in flight ` +
  `past ${DELEGATION_WAIT_CEILING_MINUTES} minutes — allowing the stop`;

export const AUTOCONTINUE_GATE: GateDefinition<StopVerdict> = {
  gate: "autocontinue",
  errorSubject: "the unattended-run continuation gate",
  judge: judgeAutocontinue,
};

type RunPosition = Readonly<{
  projectDir: string;
  sessionId: string;
  markFile: string;
  tallyFile: string;
  journalBytes: number;
  stateModifiedAtEpochMillis: number;
  run: string;
}>;

function judgeAutocontinue({ envelope }: GateRequest): GateOutcome<StopVerdict> {
  const host = continuationHostOf(envelope.caller.host);
  const sessionId = hookSessionId(envelope);
  if (sessionId === "") return ALLOWED;

  const projectDir = envelope.cwd;
  if (!isDirectory(projectDir)) return ALLOWED;

  const stateFile = stateFileIfNamed(projectDir);
  if (stateFile === undefined) return ALLOWED;
  const content = ownRunState(stateFile, sessionId);
  if (content === undefined) return ALLOWED;

  const markFile = host.sidecarPath(projectDir, sessionId);
  if (stateValue(content, "auto") !== RUN_ARMED) {
    const failure = removeWaitMark(markFile);
    return failure === undefined ? ALLOWED : degraded(sessionId, failure);
  }

  const journalFile = journalFileFor(projectDir);
  const position: RunPosition = {
    projectDir,
    sessionId,
    markFile,
    tallyFile: tallyFileFor(journalFile),
    journalBytes: journalBytesIn(journalFile),
    stateModifiedAtEpochMillis: stateModifiedAtEpochMillisOf(stateFile),
    run: stateValue(content, "auto_change"),
  };

  const label = stateValue(content, "auto_wait");
  if (!isDelegationLabel(label) || host.delegationsReturnInTurn) {
    const failure = removeWaitMark(markFile);
    const pushed = pushUnlessCapped(position, envelope.stopHookActive, host.order, CAP_MILESTONE);
    if (failure === undefined) return pushed;
    return { ...pushed, events: [...pushed.events, degradedEvent(sessionId, failure)] };
  }

  const held = holdUnlessExpired(position, label);
  if (held !== undefined) return held;
  return pushUnlessCapped(
    position,
    envelope.stopHookActive,
    `${host.order} ${EXPIRED_DELEGATION_CLAUSE}`,
    EXPIRED_DELEGATION_CAP_MILESTONE,
  );
}

function holdUnlessExpired(position: RunPosition, label: string): GateOutcome<StopVerdict> | undefined {
  const standing = readWaitMark(position.markFile);
  if (standing === undefined || standing.session !== position.sessionId || standing.label !== label) {
    return sightedThenHeld(position, label, 0);
  }
  if (standing.run !== position.run) return adoptedIntoRun(position, label, standing);

  if (!waitExpired(nowEpochSeconds(), standing.markedAtEpochSeconds)) return held(position, label, standing.renewals);
  if (position.journalBytes <= standing.journalBytes) return undefined;
  if (standing.renewals >= DELEGATION_WAIT_RENEWALS_CAP) return undefined;
  return sightedThenHeld(position, label, standing.renewals + 1);
}

function adoptedIntoRun(position: RunPosition, label: string, standing: StandingWaitMark): GateOutcome<StopVerdict> {
  try {
    writeWaitMark(position.markFile, { ...standing, run: position.run });
    return held(position, label, standing.renewals);
  } catch (cause) {
    return degraded(position.sessionId, causeOf(cause));
  }
}

function sightedThenHeld(position: RunPosition, label: string, renewals: number): GateOutcome<StopVerdict> {
  try {
    writeWaitMark(position.markFile, {
      run: position.run,
      session: position.sessionId,
      label,
      journalBytes: position.journalBytes,
      renewals,
    });
  } catch (cause) {
    return degraded(position.sessionId, causeOf(cause));
  }
  return held(position, label, renewals);
}

function pushUnlessCapped(
  position: RunPosition,
  turnAlreadyContinued: boolean,
  order: string,
  capMilestone: string,
): GateOutcome<StopVerdict> {
  const counted = pushesWithoutProgress(position, turnAlreadyContinued);
  if (typeof counted !== "number") return counted;

  if (counted > PUSHES_WITHOUT_PROGRESS_CAP) {
    const announced = counted === PUSHES_WITHOUT_PROGRESS_CAP + 1 ? announceCap(position, capMilestone) : [];
    const failure = rememberPush(position, counted);
    const trailing = failure === undefined ? [] : [degradedEvent(position.sessionId, failure)];
    return { verdict: { kind: "allow" }, events: [...announced, ...trailing] };
  }

  const failure = rememberPush(position, counted);
  if (failure !== undefined) return degraded(position.sessionId, failure);
  return { verdict: { kind: "push", reason: order }, events: [gateEvent("auto-continued", position.sessionId, "")] };
}

function pushesWithoutProgress(
  position: RunPosition,
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
  return (position.stateModifiedAtEpochMillis > stats.mtimeMs ? 0 : Number(remembered)) + 1;
}

function announceCap(position: RunPosition, milestone: string): LoggedEvent[] {
  try {
    appendJournal(journalFileFor(position.projectDir), milestone);
    return [];
  } catch (cause) {
    return [gateEvent("auto-continue-unjournaled", position.sessionId, causeOf(cause))];
  }
}

function rememberPush(position: RunPosition, pushes: number): string | undefined {
  try {
    mkdirSync(path.dirname(position.tallyFile), { recursive: true, mode: OWNER_ONLY_DIRECTORY });
    writeFileSync(position.tallyFile, `pushes=${pushes}\n`, { mode: OWNER_ONLY_FILE });
    return undefined;
  } catch (cause) {
    return causeOf(cause);
  }
}

function held(position: RunPosition, label: string, renewals: number): GateOutcome<StopVerdict> {
  const liveness = `${label} journal_bytes=${position.journalBytes} renewals=${renewals}`;
  return { verdict: { kind: "allow" }, events: [gateEvent("auto-continue-held", position.sessionId, liveness)] };
}

function degraded(sessionId: string, cause: string): GateOutcome<StopVerdict> {
  return { verdict: { kind: "allow" }, events: [degradedEvent(sessionId, cause)] };
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

function stateModifiedAtEpochMillisOf(stateFile: string): number {
  const stats = statSync(stateFile, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile() ? stats.mtimeMs : 0;
}
