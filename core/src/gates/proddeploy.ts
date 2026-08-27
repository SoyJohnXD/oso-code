import path from "node:path";
import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { ereMatches } from "../shell/ere.ts";
import { basenameOf, UNREAD_PAYLOAD_MARKER } from "../shell/lexer.ts";
import { gitVerb, isGitCall, isResidueCall, type LexedCommand } from "../shell/lexed-command.ts";
import { lineVerdict, type LexerVerdict } from "../shell/line-verdict.ts";
import { readStateFile, repositoryIdFor, stateFileFor, stateRootDirectory } from "../state/store.ts";
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

const PRODUCTION_BOUNDARY_SUBJECTS = ["git", "deploy", "vercel", "netlify", "firebase"];
const DEPLOY_CLIS = new Set(["vercel", "netlify", "firebase"]);
const PACKAGE_RUNNERS = new Set(["npx", "npm", "pnpm", "pnpx", "yarn", "bun", "bunx", "deno"]);
const STATE_RECORD_LINE = /^([A-Za-z0-9_]+=|[\t\v\f\r ]*$)/;
const RUN_BRANCH_REF = /^oso-run\/[a-z0-9-]+$/;
const RUN_BRANCH_REFSPEC = /^[^:]+:(refs\/heads\/)?oso-run\/[a-z0-9-]+$/;
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

  const command = envelope.commandLine;
  if (!aDenyPatternOfThisRepositoryMatches(stateFile, command)) return judgeCommandLine(boundary, command);
  return denyProductionBoundary(boundary, thisRepositoryDeniesTheCommand(session), command);
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

function theRunPushesItsOwnBranchOnly(session: string): string {
  return (
    "oso-code: an unattended run is in flight, and it pushes its own oso-run/* branch and nothing else. " +
    "Push that branch instead (git push origin oso-run/<name>), or take the run back " +
    `(${osoStateRemedy(session, TAKE_THE_RUN_BACK)}) and push from your own terminal.`
  );
}

function denyProductionBoundary(boundary: ProductionBoundary, message: string, detail: string): GateOutcome {
  if (boundary.runMarker === "uncertain") {
    return deniedForUnusableState("proddeploy", boundary.stateFile, boundary.session);
  }
  return denied({ gate: "proddeploy", message, event: "prod-deploy-denied", session: boundary.session, detail });
}

function judgeProductionLine(
  command: LexedCommand,
  verdict: ProductionJudgement | LexerVerdict,
): ProductionJudgement | LexerVerdict {
  if (runsAProductionDeploy(command)) return "production";
  if (verdict !== "production" && verdict !== "unread" && pushesOffTheRunBranch(command)) return "push";
  if (verdict === "clear" && isResidueCall(command, PRODUCTION_BOUNDARY_SUBJECTS)) return "residue";
  return verdict;
}

function runsAProductionDeploy(command: LexedCommand): boolean {
  const deployCli = deployCommandName(command);
  if (deployCli === undefined) return false;
  if (command.stdin.includes(UNREAD_PAYLOAD_MARKER)) return true;
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
  if (gitVerb(command) !== "push") return false;
  return !command.tokens.slice(1).some((token) => RUN_BRANCH_REF.test(token) || RUN_BRANCH_REFSPEC.test(token));
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

function aDenyPatternOfThisRepositoryMatches(stateFile: string, command: string): boolean {
  const patternsFile = path.join(
    stateRootDirectory(),
    "deploy-deny",
    `${repositoryIdFor(stateFile)}.patterns`,
  );
  const read = readStateFile(patternsFile);
  if (read.kind !== "ok") return false;
  return read.content.split("\n").some((pattern) => pattern !== "" && ereMatches(pattern, command));
}
