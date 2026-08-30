import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { gitVerb, isGitCall, isResidueCall, type LexedCommand } from "../shell/lexed-command.ts";
import { lineVerdict, type LexerVerdict } from "../shell/line-verdict.ts";
import {
  allowedWithResidueCounted,
  denied,
  deniedForUnusableState,
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

function judgeCommit({ envelope }: GateRequest): GateOutcome {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("commit", stateFile, session);

  const verdict = lineVerdict<CommitJudgement>(envelope.commandLine, judgeCommitLine);
  if (verdict === "clear") return ALLOWED;
  if (verifyIsGreen(state.content)) return ALLOWED;
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
  if (verb === "" || !GATED_GIT_VERBS.has(verb)) return false;
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
