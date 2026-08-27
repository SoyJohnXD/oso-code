import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenCodeGateRoute } from "../../hooks/routes.ts";
import { publishIdentity } from "./identity.ts";
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

export type GateVerdictKind = "deny" | "allow" | "block";

export interface GateVerdict {
  kind: GateVerdictKind;
  message: string;
}

export interface RunGateOptions {
  hooksDir?: string;
  timeoutMs?: number;
}

export const GATE_TIMEOUT_MS = 10_000;

export const denyVerdict = (message: string): GateVerdict => ({
  kind: "deny",
  message,
});

export const blockVerdict = (message: string): GateVerdict => ({
  kind: "block",
  message,
});

const allowVerdict: GateVerdict = { kind: "allow", message: "" };

export function composeEnvelope(
  input: ToolExecuteInput,
  output: ToolExecuteOutput,
): Record<string, string> {
  const args = output.args ?? {};
  const envelope: Record<string, string> = {
    command: commandLineFor(args),
    session_id: input.sessionID ?? "",
    cwd: input.cwd ?? process.cwd(),
    tool_name: input.tool,
  };
  const filePath = args.filePath;
  if (typeof filePath === "string" && filePath !== "") {
    envelope.file_path = filePath;
  }
  return envelope;
}

export function composeLifecycleEnvelope(input: LifecycleGateInput): Record<string, string> {
  const envelope: Record<string, string> = {
    session_id: input.sessionID,
    cwd: input.directory,
  };
  if (input.moment !== "end") {
    envelope.source = input.moment;
  }
  return envelope;
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

export function assertGateRoutesCompile(routes: readonly OpenCodeGateRoute[]): void {
  for (const route of routes) {
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

export function resolveHookScript(
  script: string,
  hooksDir?: string,
): string {
  if (hooksDir !== undefined && hooksDir !== "") {
    return join(hooksDir, script);
  }
  const explicit = process.env.OSO_HOOKS_DIR;
  if (explicit !== undefined && explicit !== "") {
    return join(explicit, script);
  }
  const installedHooksDir = dirname(fileURLToPath(import.meta.url));
  return resolve(installedHooksDir, "../../hooks", script);
}

export function resolveStateBin(hooksDir?: string): string {
  const dir = resolveHookScript("", hooksDir);
  return resolve(dir, "..", "bin", "oso-state");
}

export function spawnStateBin(
  stateBin: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  return spawnSync("node", [stateBin, ...args], options);
}

function gateEnvironment(directory: string, resolvedScript: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OSO_AGENT: publishIdentity(directory).OSO_AGENT,
    OSO_HOST: "opencode",
    OSO_STATE_BIN: resolveStateBin(dirname(resolvedScript)),
  };
}

type GateRun =
  | { kind: "ran"; status: number; stdout: string; stderr: string }
  | { kind: "unusable"; detail: string };

interface GateInvocation {
  script: string;
  allow: readonly string[];
  envelope: Record<string, string>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

function invokeGate(invocation: GateInvocation): GateRun {
  const { script, envelope, cwd, env, timeoutMs } = invocation;
  const args = [script];
  if (invocation.allow.length > 0) {
    args.push("--allow", invocation.allow.join("|"));
  }
  const result = spawnSync("bash", args, {
    input: JSON.stringify(envelope),
    encoding: "utf8",
    timeout: timeoutMs,
    cwd,
    env,
  });
  if (result.signal !== null) {
    return { kind: "unusable", detail: `gate timed out or was killed: ${script}` };
  }
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "EPIPE") {
    return { kind: "unusable", detail: `gate exited before reading its envelope: ${script}` };
  }
  if (result.error !== undefined) {
    return { kind: "unusable", detail: `gate failed to start: ${result.error.message}` };
  }
  return { kind: "ran", status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function runGate(
  route: OpenCodeGateRoute,
  input: ToolExecuteInput,
  output: ToolExecuteOutput,
  options: RunGateOptions = {},
): GateVerdict {
  const script = resolveHookScript(route.script, options.hooksDir);
  if (!existsSync(script)) {
    return blockVerdict(`oso-code: gate script not found: ${script}`);
  }
  const callDirectory = input.cwd ?? process.cwd();
  const run = invokeGate({
    script,
    allow: route.allow,
    envelope: composeEnvelope(input, output),
    cwd: callDirectory,
    env: gateEnvironment(callDirectory, script),
    timeoutMs: options.timeoutMs ?? GATE_TIMEOUT_MS,
  });
  if (run.kind === "unusable") {
    return blockVerdict(`oso-code: ${run.detail}`);
  }
  return translateGateResult(run.status, run.stdout, run.stderr, script);
}

export function runAdvisoryGate(
  route: OpenCodeGateRoute,
  input: LifecycleGateInput,
  options: RunGateOptions = {},
): AdvisoryOutcome {
  const script = resolveHookScript(route.script, options.hooksDir);
  if (!existsSync(script)) {
    return { kind: "failed", detail: `gate script not found: ${script}` };
  }
  const run = invokeGate({
    script,
    allow: route.allow,
    envelope: composeLifecycleEnvelope(input),
    cwd: input.directory,
    env: gateEnvironment(input.directory, script),
    timeoutMs: options.timeoutMs ?? GATE_TIMEOUT_MS,
  });
  if (run.kind === "unusable") {
    return { kind: "failed", detail: run.detail };
  }
  if (run.status !== 0) {
    const stderr = run.stderr.trim();
    return { kind: "failed", detail: stderr !== "" ? stderr : `gate ${script} exited ${run.status}` };
  }
  const context = additionalContextOf(run.stdout);
  return context === null ? { kind: "silent" } : { kind: "context", text: context };
}

export function routeForGate(
  routes: readonly OpenCodeGateRoute[],
  gate: string,
): OpenCodeGateRoute | undefined {
  return routes.find((route) => route.gate === gate);
}

function translateGateResult(
  status: number,
  stdout: string,
  stderr: string,
  script: string,
): GateVerdict {
  if (status === 0) {
    const decision = denyDecision(stdout);
    if (decision !== null) {
      return denyVerdict(decision);
    }
    return allowVerdict;
  }
  const message = stderr.trim() !== ""
    ? stderr.trim()
    : `oso-code: gate ${script} failed unexpectedly (exit ${status})`;
  return blockVerdict(message);
}

export interface HarnessInstallStatus {
  installed: boolean;
  missing: readonly string[];
}

export function checkHarnessInstalled(
  routes: readonly OpenCodeGateRoute[],
  options: RunGateOptions = {},
): HarnessInstallStatus {
  const scripts = new Set(routes.map((route) => resolveHookScript(route.script, options.hooksDir)));
  const missing = [...scripts].filter((script) => !existsSync(script));
  return { installed: missing.length === 0, missing };
}

function hookSpecificOutput(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const hookOutput = (parsed as { hookSpecificOutput?: unknown }).hookSpecificOutput;
  if (typeof hookOutput !== "object" || hookOutput === null) {
    return null;
  }
  return hookOutput as Record<string, unknown>;
}

function denyDecision(stdout: string): string | null {
  const hookOutput = hookSpecificOutput(stdout);
  if (hookOutput === null || hookOutput.permissionDecision !== "deny") {
    return null;
  }
  const reason = hookOutput.permissionDecisionReason;
  if (typeof reason === "string" && reason !== "") {
    return reason;
  }
  return "oso-code: tool denied by gate";
}

function additionalContextOf(stdout: string): string | null {
  const context = hookSpecificOutput(stdout)?.additionalContext;
  return typeof context === "string" && context !== "" ? context : null;
}
