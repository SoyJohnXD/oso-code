import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { ereReads } from "../shell/ere.ts";
import { basenameOf } from "../shell/lexer.ts";
import {
  gitVerb,
  isFedByXargs,
  isGitCall,
  isResidueCall,
  PACKAGE_RUNNERS,
  runsCodeFedByXargs,
  type LexedCommand,
} from "../shell/lexed-command.ts";
import { lineVerdict, type LexerVerdict } from "../shell/line-verdict.ts";
import { denyPatternsFileFor, readFileIfPresent, stateFileFor } from "../state/store.ts";
import {
  allowedWithResidueCounted,
  denied,
  deniedForUnusableState,
  hookSessionId,
  osoStateRemedy,
  payloadUnparseable,
  readArmedState,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

type ProductionJudgement = "production" | "push" | "residue";
type RunMarker = "unmarked" | "uncertain" | "armed";
type ProductionBoundary = Readonly<{ runMarker: RunMarker; stateFile: string; session: string }>;
type BoundaryDenial = Readonly<{ message: string; event: string; detail: string }>;

type DenyPatternReading =
  | Readonly<{ kind: "noPatternBites" }>
  | Readonly<{ kind: "aPatternBites" }>
  | Readonly<{ kind: "aPatternIsUnreadable"; pattern: string }>;

const PRODUCTION_BOUNDARY_SUBJECTS = ["git", "deploy", "vercel", "netlify", "firebase"];
const DEPLOY_CLIS = new Set(["vercel", "netlify", "firebase"]);
const STATE_RECORD_LINE = /^([A-Za-z0-9_]+=|[\t\v\f\r ]*$)/;
const RUN_BRANCH_REF = /^oso-run\/[a-z0-9-]+$/;
const RUN_BRANCH_REFSPEC = /^[^:]+:(refs\/heads\/)?oso-run\/[a-z0-9-]+$/;
const PUSH_OPTIONS_TAKING_A_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
const PUSH_OPTIONS_SENDING_MORE_THAN_ITS_REFSPECS = new Set([
  "--tags", "--follow-tags", "--all", "--branches", "--mirror",
]);
const FOLLOW_TAGS_CONFIG = /push\.followtags/i;
const TAKE_THE_RUN_BACK = "set auto=done";

export const PROD_DEPLOY_GATE: GateDefinition = {
  gate: "proddeploy",
  errorSubject: "the production boundary gate",
  judge: judgeProductionBoundary,
};

function judgeProductionBoundary({ envelope }: GateRequest): GateOutcome {
  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const runMarker = runMarkerOf(stateFile, session);
  if (runMarker === "unmarked") return ALLOWED;
  const boundary = { runMarker, stateFile, session };

  if (envelope.toolName.includes("deploy")) {
    return denyProductionBoundary(boundary, mcpDeployStaysWithTheOperator(session), envelope.toolName);
  }
  if (envelope.toolName !== "Bash" && envelope.toolName !== "bash") return ALLOWED;
  return judgeAgainstDenyPatterns(boundary, envelope.commandLine);
}

function judgeAgainstDenyPatterns(boundary: ProductionBoundary, command: string): GateOutcome {
  const reading = howThisRepositoryReadsTheCommand(boundary.stateFile, command);
  switch (reading.kind) {
    case "aPatternBites":
      return denyProductionBoundary(boundary, thisRepositoryDeniesTheCommand(boundary.session), command);
    case "aPatternIsUnreadable":
      return denyUnreadableDenyPattern(boundary, reading.pattern);
    case "noPatternBites":
      return judgeCommandLine(boundary, command);
  }
}

function judgeCommandLine(boundary: ProductionBoundary, command: string): GateOutcome {
  const { runMarker, session } = boundary;
  switch (lineVerdict<ProductionJudgement>(command, judgeProductionLine)) {
    case "production":
      return denyProductionBoundary(boundary, deployStaysWithTheOperator(session), command);
    case "unread":
      return denyProductionBoundary(boundary, theLineIsPastWhatTheBoundaryReads(session), command);
    case "push":
      if (runMarker !== "armed") return ALLOWED;
      return denied({
        gate: "proddeploy",
        message: theRunPushesItsOwnBranchOnly(session),
        event: "run-branch-push-denied",
        session,
        detail: command,
      });
    case "residue":
      return allowedWithResidueCounted(session, command);
    case "clear":
      return ALLOWED;
  }
}

function takeTheRunBack(session: string): string {
  return `Take the run back (${osoStateRemedy(session, TAKE_THE_RUN_BACK)})`;
}

function mcpDeployStaysWithTheOperator(session: string): string {
  return (
    "oso-code: an unattended run is in flight, so an MCP deploy stays with the operator. " +
    `${takeTheRunBack(session)} and run the deploy yourself.`
  );
}

function thisRepositoryDeniesTheCommand(session: string): string {
  return (
    "oso-code: an unattended run is in flight, and this repository denies this command while one is. " +
    `${takeTheRunBack(session)} and run it from your own terminal.`
  );
}

function deployStaysWithTheOperator(session: string): string {
  return (
    "oso-code: an unattended run is in flight, so a production deploy stays with the operator. " +
    `${takeTheRunBack(session)} and deploy from your own terminal, ` +
    "or deploy after the run closes at its pull request."
  );
}

function theLineIsPastWhatTheBoundaryReads(session: string): string {
  return (
    "oso-code: an unattended run is in flight, and this command line is past what the production boundary " +
    "can read, so it is treated as a production deploy. " +
    `${takeTheRunBack(session)} and run it from your own terminal, or spell it in lines this boundary can read.`
  );
}

function aDenyPatternIsPastWhatTheBoundaryReads(session: string, pattern: string): string {
  return (
    "oso-code: an unattended run is in flight, and a deploy-deny pattern of this repository " +
    `(${pattern}) is past what the production boundary can read, so this command is denied rather than ` +
    "allowed on a pattern nothing checked. Rewrite that pattern in the POSIX ERE the boundary reads, or " +
    `${takeTheRunBack(session)} and run it from your own terminal.`
  );
}

function theRunPushesItsOwnBranchOnly(session: string): string {
  return (
    "oso-code: an unattended run is in flight, and it pushes its own oso-run/* branch and nothing else. " +
    "Push that branch instead (git push origin oso-run/<name>), or take the run back " +
    `(${osoStateRemedy(session, TAKE_THE_RUN_BACK)}) and push from your own terminal.`
  );
}

function denyProductionBoundary(boundary: ProductionBoundary, message: string, detail: string): GateOutcome {
  return deniedUnderTheBoundary(boundary, { message, event: "prod-deploy-denied", detail });
}

function denyUnreadableDenyPattern(boundary: ProductionBoundary, pattern: string): GateOutcome {
  return deniedUnderTheBoundary(boundary, {
    message: aDenyPatternIsPastWhatTheBoundaryReads(boundary.session, pattern),
    event: "deploy-deny-pattern-untranslatable",
    detail: pattern,
  });
}

function deniedUnderTheBoundary(boundary: ProductionBoundary, denial: BoundaryDenial): GateOutcome {
  if (boundary.runMarker === "uncertain") {
    return deniedForUnusableState("proddeploy", boundary.stateFile, boundary.session);
  }
  return denied({ gate: "proddeploy", session: boundary.session, ...denial });
}

function judgeProductionLine(
  command: LexedCommand,
  verdict: ProductionJudgement | LexerVerdict,
): ProductionJudgement | LexerVerdict {
  if (runsAProductionDeploy(command)) return "production";
  if (verdict !== "production" && runsCodeFedByXargs(command)) return "unread";
  if (verdict !== "production" && verdict !== "unread" && pushesOffTheRunBranch(command)) return "push";
  if (verdict === "clear" && isResidueCall(command, PRODUCTION_BOUNDARY_SUBJECTS)) return "residue";
  return verdict;
}

function runsAProductionDeploy(command: LexedCommand): boolean {
  const deployCli = deployCommandName(command);
  if (deployCli === undefined) return false;
  if (isFedByXargs(command)) return true;
  if (deployCli === "vercel") return vercelTargetsProduction(command);
  if (deployCli === "netlify") return commandCarries(command, "deploy") && commandCarries(command, "--prod");
  return commandCarries(command, "deploy");
}

function deployCommandName(command: LexedCommand): string | undefined {
  for (const [index, token] of command.tokens.entries()) {
    const word = packageSpecName(token);
    if (DEPLOY_CLIS.has(word)) return word;
    if (index === 0 && !PACKAGE_RUNNERS.has(word)) return undefined;
  }
  return undefined;
}

function packageSpecName(token: string): string {
  const word = basenameOf(token);
  const at = word.lastIndexOf("@");
  return at > 0 ? word.slice(0, at) : word;
}

function vercelTargetsProduction(command: LexedCommand): boolean {
  return command.tokens.some(
    (token, index) =>
      token === "--prod" ||
      token === "--target=production" ||
      (token === "--target" && command.tokens[index + 1] === "production"),
  );
}

function commandCarries(command: LexedCommand, word: string): boolean {
  return command.tokens.includes(word);
}

function pushesOffTheRunBranch(command: LexedCommand): boolean {
  if (!isGitCall(command)) return false;
  const verb = gitVerb(command);
  if (isFedByXargs(command)) return verb === "push" || verb === "";
  if (verb !== "push") return false;
  const pushAt = command.tokens.indexOf(verb);
  if (command.tokens.slice(1, pushAt).some((option) => FOLLOW_TAGS_CONFIG.test(option))) return true;
  return !pushesOnlyRunBranchRefspecs(command.tokens.slice(pushAt + 1));
}

function pushesOnlyRunBranchRefspecs(pushArguments: readonly string[]): boolean {
  const positionals: string[] = [];
  let optionsEnded = false;
  for (let at = 0; at < pushArguments.length; at += 1) {
    const argument = pushArguments[at] as string;
    if (optionsEnded || !argument.startsWith("-")) positionals.push(argument);
    else if (argument === "--") optionsEnded = true;
    else if (PUSH_OPTIONS_SENDING_MORE_THAN_ITS_REFSPECS.has(argument)) return false;
    else if (PUSH_OPTIONS_TAKING_A_VALUE.has(argument)) at += 1;
  }
  const refspecs = positionals.slice(1);
  return refspecs.length > 0 && refspecs.every(isRunBranchRefspec);
}

function isRunBranchRefspec(refspec: string): boolean {
  return RUN_BRANCH_REF.test(refspec) || RUN_BRANCH_REFSPEC.test(refspec);
}

function runMarkerOf(stateFile: string, session: string): RunMarker {
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return "unmarked";
  if (state.kind === "unusable") return "uncertain";
  if (!readsAsStateRecords(state.content)) return "uncertain";
  if (stateValue(state.content, "session") !== session) return "unmarked";
  return stateValue(state.content, "auto") === "running" ? "armed" : "unmarked";
}

function readsAsStateRecords(content: string): boolean {
  return content.split("\n").every((line) => STATE_RECORD_LINE.test(line));
}

function howThisRepositoryReadsTheCommand(stateFile: string, command: string): DenyPatternReading {
  const content = readFileIfPresent(denyPatternsFileFor(stateFile), "skip");
  if (content === undefined) return { kind: "noPatternBites" };
  const readings = content
    .split("\n")
    .filter((pattern) => pattern !== "")
    .map((pattern) => ({ pattern, reading: ereReads(pattern, command) }));
  if (readings.some((one) => one.reading === "matched")) return { kind: "aPatternBites" };
  const unreadable = readings.find((one) => one.reading === "untranslatable");
  if (unreadable === undefined) return { kind: "noPatternBites" };
  return { kind: "aPatternIsUnreadable", pattern: unreadable.pattern };
}
