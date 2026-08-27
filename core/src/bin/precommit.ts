import { untilGreenMessage, verifyIsGreen } from "../gates/commit.ts";
import { readArmedState, sanitizeSession, unusableStateMessage } from "../gates/preflight.ts";
import { gateErrorText } from "../hosts/pretooluse.ts";
import { logEvent, stateFileFor, type LoggedEvent } from "../state/store.ts";

export type PreCommitRun = Readonly<{ exit: number; stderr: string; events: readonly LoggedEvent[] }>;

const COMMIT_PROCEEDS: PreCommitRun = { exit: 0, stderr: "", events: [] };
const ABORTED_EXIT = 1;
const HOOK_ERROR_EXIT = 2;

export function preCommitRun(cwd: string, marker: string): PreCommitRun {
  const session = sanitizeSession(marker);
  if (session === "") return COMMIT_PROCEEDS;

  const stateFile = stateFileFor(cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return COMMIT_PROCEEDS;
  if (state.kind === "unusable") {
    return aborted(unusableStateMessage(stateFile, session), "state-unreadable", session);
  }
  if (verifyIsGreen(state.content)) return COMMIT_PROCEEDS;
  return aborted(untilGreenMessage(state.content), "commit-denied", session);
}

export function commitMarkerIn(environment: Readonly<Record<string, string | undefined>>): string {
  const named = environment["CLAUDE_CODE_SESSION_ID"];
  if (named !== undefined && named !== "") return named;
  return environment["OSO_AGENT"] ?? "";
}

function aborted(reason: string, event: string, session: string): PreCommitRun {
  return { exit: ABORTED_EXIT, stderr: `${reason}\n`, events: [{ event, session }] };
}

function hookFailedClosed(cause: unknown): PreCommitRun {
  const explained = cause instanceof Error ? cause.message : String(cause);
  return {
    exit: HOOK_ERROR_EXIT,
    stderr: `${gateErrorText("the commit hook")}oso-code: cause: ${explained}\n`,
    events: [],
  };
}

function attemptPreCommit(): PreCommitRun {
  try {
    return preCommitRun(process.cwd(), commitMarkerIn(process.env));
  } catch (cause) {
    return hookFailedClosed(cause);
  }
}

const run = attemptPreCommit();
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
