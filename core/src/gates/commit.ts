import { execFileSync } from "node:child_process";
import path from "node:path";
import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { gitVerb, gitVerbAt, isFedByXargs, isGitCall, isResidueCall, type LexedCommand } from "../shell/lexed-command.ts";
import { lineVerdict, type LexerVerdict } from "../shell/line-verdict.ts";
import {
  allowedWithResidueCounted,
  denied,
  deniedForUnusableState,
  foreignOwner,
  holdsMode,
  hookSessionId,
  payloadUnparseable,
  readArmedState,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";
import { stateFileFor } from "../state/store.ts";

type CommitJudgement = "gated" | "residue";

const COMMIT_SUBJECTS = ["git"];
const GATED_GIT_VERBS = new Set([
  "commit", "commit-tree", "update-ref", "filter-branch", "replace", "fast-import",
]);
const READ_ONLY_GIT_OPTIONS = new Set(["commit:--dry-run", "commit:-h", "commit:--help", "replace:-l"]);

const REMEDY_BY_MODE: Readonly<Record<string, string>> = {
  plan: "Resume plan mode's apply → verify loop until the verifier returns pass",
  quick: "Finish quick mode's close step — run the project's checks to zero warnings",
  debug: "Finish debug mode's close step — run the quality-pass judge to zero warnings",
};
const REMEDY_FOR_ANY_MODE =
  "Finish the active mode's checks to zero warnings — plan mode's apply → verify loop, or quick/debug mode's close step";

export const COMMIT_GATE: GateDefinition = {
  gate: "commit",
  errorSubject: "the commit gate",
  judge: judgeCommit,
};

export function untilGreenMessage(stateContent: string): string {
  const remedy = REMEDY_BY_MODE[stateValue(stateContent, "mode")] ?? REMEDY_FOR_ANY_MODE;
  return `oso-code: the session verify is not green. ${remedy}, then retry the commit.`;
}

export function verifyIsGreen(stateContent: string): boolean {
  return stateValue(stateContent, "verify_green") === "true";
}

export function commitGateArmedFor(stateContent: string, session: string): boolean {
  return holdsMode(stateContent) && foreignOwner(stateContent, session) === undefined;
}

const WAVE_WINDOW_PREFIX = "wave-";
const SLICE_BRANCH_FAMILY = "oso";
const SLICE_BRANCH_SEGMENTS = 3;
const REPOSITORY_REDIRECTING_OPTIONS = ["--git-dir", "--work-tree"];

function windowSliceOf(stateContent: string): string | undefined {
  if (!verifyIsGreen(stateContent)) return undefined;
  if (!stateValue(stateContent, "active_slice").startsWith(WAVE_WINDOW_PREFIX)) return undefined;
  const named = stateValue(stateContent, "green_slice");
  return named === "" ? undefined : named;
}

export function otherSliceBranchRefusal(stateContent: string, branch: string | undefined): string | undefined {
  const window = windowSliceOf(stateContent);
  if (window === undefined || branch === undefined) return undefined;
  const segments = branch.split("/");
  if (segments.length !== SLICE_BRANCH_SEGMENTS || segments[0] !== SLICE_BRANCH_FAMILY) return undefined;
  if (segments[2] === window) return undefined;
  return `oso-code: the green window names slice ${window}, so a commit from branch ${branch} is refused. Commit from the branch of slice ${window}, or wait for that window to close.`;
}

export function currentBranchOf(directory: string): string | undefined {
  try {
    const branch = execFileSync("git", ["-C", directory, "symbolic-ref", "--short", "-q", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch === "" ? undefined : branch;
  } catch {
    return undefined;
  }
}

function judgeCommit({ envelope }: GateRequest): GateOutcome {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("commit", stateFile, session);
  if (!commitGateArmedFor(state.content, session)) return ALLOWED;

  const gitDirectories: Array<string | undefined> = [];
  const verdict = lineVerdict<CommitJudgement>(envelope.commandLine, (command, soFar) => {
    if (isGatedGitCall(command)) gitDirectories.push(gitDirectoryOf(command, envelope.cwd));
    return judgeCommitLine(command, soFar);
  });
  if (verdict === "clear") return ALLOWED;
  if (verifyIsGreen(state.content)) return windowBindingOutcome(state.content, gitDirectories, session, envelope.commandLine);
  if (verdict === "residue" || verdict === "unread") {
    return allowedWithResidueCounted(session, envelope.commandLine);
  }
  return denied({
    gate: "commit",
    message: untilGreenMessage(state.content),
    event: "commit-denied",
    session,
    detail: envelope.commandLine,
  });
}

function windowBindingOutcome(
  stateContent: string,
  gitDirectories: readonly (string | undefined)[],
  session: string,
  commandLine: string,
): GateOutcome {
  for (const directory of gitDirectories) {
    const message = directory === undefined ? undefined : otherSliceBranchRefusal(stateContent, currentBranchOf(directory));
    if (message !== undefined) return denied({ gate: "commit", message, event: "commit-denied", session, detail: commandLine });
  }
  return ALLOWED;
}

function gitDirectoryOf(command: LexedCommand, workingDirectory: string): string | undefined {
  const { at } = gitVerbAt(command);
  const options = command.tokens.slice(1, at);
  if (options.some((token) => REPOSITORY_REDIRECTING_OPTIONS.some((option) => token.startsWith(option)))) return undefined;
  let directory = workingDirectory;
  options.forEach((token, position) => {
    if (token === "-C") directory = path.resolve(directory, options[position + 1] ?? "");
  });
  return directory;
}

function judgeCommitLine(
  command: LexedCommand,
  verdict: CommitJudgement | LexerVerdict,
): CommitJudgement | LexerVerdict {
  if (isGatedGitCall(command)) return "gated";
  if (verdict === "clear" && isResidueCall(command, COMMIT_SUBJECTS)) return "residue";
  return verdict;
}

function isGatedGitCall(command: LexedCommand): boolean {
  if (!isGitCall(command)) return false;
  const verb = gitVerb(command);
  if (verb === "") return isFedByXargs(command);
  if (!GATED_GIT_VERBS.has(verb)) return false;
  return !gitCallOnlyReports(command, verb);
}

function gitCallOnlyReports(command: LexedCommand, verb: string): boolean {
  let valuePosition = false;
  for (const token of command.tokens.slice(1)) {
    if (token === "--") return false;
    if (!valuePosition && READ_ONLY_GIT_OPTIONS.has(`${verb}:${token}`)) return true;
    valuePosition = token.startsWith("-") && !(token.startsWith("--") && token.includes("="));
  }
  return false;
}
