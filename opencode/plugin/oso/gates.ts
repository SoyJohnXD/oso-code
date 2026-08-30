import {
  hostEnvelope,
  logEvent,
  openCodeRoutes,
  runGate,
  type GateVerdict,
  type HookCaller,
  type HookEnvelope,
  type OpenCodeRoute,
} from "@oso-code/core";
import { publishIdentity } from "./identity.ts";
import { stateBinPath } from "./installed-tree.ts";
import { messageOf } from "./wave.ts";

export interface ToolExecuteInput {
  tool: string;
  sessionID?: string;
  callID?: string;
  cwd?: string;
}

export interface ToolExecuteOutput {
  args?: Record<string, unknown>;
}

export type LifecycleMoment = "startup" | "compact" | "end";

export interface LifecycleGateInput {
  sessionID: string;
  directory: string;
  moment: LifecycleMoment;
}

export type AdvisoryOutcome =
  | { kind: "context"; text: string }
  | { kind: "silent" }
  | { kind: "failed"; detail: string };

type HostToolVerdictKind = "deny" | "allow" | "block";

export interface HostToolVerdict {
  kind: HostToolVerdictKind;
  message: string;
}

export const routes: readonly OpenCodeRoute[] = openCodeRoutes();

const denyVerdict = (message: string): HostToolVerdict => ({
  kind: "deny",
  message,
});

const blockVerdict = (message: string): HostToolVerdict => ({
  kind: "block",
  message,
});

const allowVerdict: HostToolVerdict = { kind: "allow", message: "" };

export function callerFor(directory: string): HookCaller {
  return { host: "opencode", agentSession: publishIdentity(directory).OSO_AGENT, stateBin: stateBinPath() };
}

export function composeEnvelope(input: ToolExecuteInput, output: ToolExecuteOutput): HookEnvelope {
  const cwd = input.cwd ?? process.cwd();
  const args = output.args ?? {};
  const filePath = args.filePath;
  return hostEnvelope(callerFor(cwd), {
    sessionId: input.sessionID ?? "",
    cwd,
    toolName: input.tool,
    commandLine: commandLineFor(args),
    filePath: typeof filePath === "string" ? filePath : "",
  });
}

export function composeLifecycleEnvelope(input: LifecycleGateInput): HookEnvelope {
  return hostEnvelope(callerFor(input.directory), {
    sessionId: input.sessionID,
    cwd: input.directory,
    source: input.moment === "end" ? "" : input.moment,
  });
}

function commandLineFor(args: Record<string, unknown>): string {
  const script = args.script;
  if (typeof script === "string") {
    return script;
  }
  const command = args.command;
  if (typeof command === "string") {
    return command;
  }
  return "";
}

export function matchesTool(matcher: string, tool: string): boolean {
  return routeMatcher(matcher).test(tool);
}

export function assertGateRoutesCompile(gateRoutes: readonly OpenCodeRoute[]): void {
  for (const route of gateRoutes) {
    routeMatcher(route.matcher);
  }
}

function routeMatcher(matcher: string): RegExp {
  try {
    return new RegExp(matcher);
  } catch (err) {
    throw new Error(
      `the installed gate route table carries a matcher no regular expression compiles from:`
        + ` ${JSON.stringify(matcher)} (${messageOf(err)})`,
    );
  }
}

export function routeForGate(
  gateRoutes: readonly OpenCodeRoute[],
  gate: string,
): OpenCodeRoute | undefined {
  return gateRoutes.find((route) => route.gate === gate);
}

function argvFor(route: OpenCodeRoute): string[] {
  return route.allow.length > 0 ? [route.gate, "--allow", route.allow.join("|")] : [route.gate];
}

type GateJudgement =
  | { kind: "judged"; verdict: GateVerdict; stderr: string }
  | { kind: "unusable"; detail: string };

function judge(route: OpenCodeRoute, envelope: HookEnvelope): GateJudgement {
  try {
    const run = runGate(argvFor(route), envelope);
    for (const event of run.events) {
      logEvent(event);
    }
    return { kind: "judged", verdict: run.verdict, stderr: run.stderr };
  } catch (err) {
    return { kind: "unusable", detail: `the ${route.gate} gate could not run: ${messageOf(err)}` };
  }
}

function failureDetail(gate: string, stderr: string): string {
  const reported = stderr.trim();
  return reported !== "" ? reported : `oso-code: gate ${gate} failed unexpectedly and reported no cause`;
}

export function runToolGate(
  route: OpenCodeRoute,
  input: ToolExecuteInput,
  output: ToolExecuteOutput,
): HostToolVerdict {
  const judged = judge(route, composeEnvelope(input, output));
  if (judged.kind === "unusable") {
    return blockVerdict(`oso-code: ${judged.detail}`);
  }
  if (judged.verdict.kind === "deny") {
    return denyVerdict(judged.verdict.message);
  }
  if (judged.verdict.kind === "gateError") {
    return blockVerdict(failureDetail(route.gate, judged.stderr));
  }
  return allowVerdict;
}

export function runAdvisoryGate(route: OpenCodeRoute, input: LifecycleGateInput): AdvisoryOutcome {
  const judged = judge(route, composeLifecycleEnvelope(input));
  if (judged.kind === "unusable") {
    return { kind: "failed", detail: judged.detail };
  }
  if (judged.verdict.kind === "gateError") {
    return { kind: "failed", detail: failureDetail(route.gate, judged.stderr) };
  }
  return judged.verdict.kind === "context"
    ? { kind: "context", text: judged.verdict.additionalContext }
    : { kind: "silent" };
}
