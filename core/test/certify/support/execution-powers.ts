import { CONTRACT_BAR_BOUND_SECONDS, invokeContractBar } from "./drive.ts";

export type AgentToolDrive = Readonly<{
  binary: string;
  environment: NodeJS.ProcessEnv;
  projectDirectory: string;
  agent: string;
}>;

export type ToolCall = Readonly<{ tool: string; params: Readonly<Record<string, string>> }>;

export type HostToolOutcome =
  | Readonly<{ kind: "refused" }>
  | Readonly<{ kind: "executed" }>
  | Readonly<{ kind: "undriven"; reason: string }>;

type ExecutionPower = Readonly<{ label: string; call: ToolCall }>;

const PROBE_FILE_CONTENT = "written by the contract bar\n";

export function writeCall(filePath: string): ToolCall {
  return { tool: "write", params: { filePath, content: PROBE_FILE_CONTENT } };
}

function bashCall(command: string): ToolCall {
  return { tool: "bash", params: { command, description: "contract bar execution power" } };
}

const EXECUTION_PHASE_POWERS: readonly ExecutionPower[] = [
  { label: "the state command", call: bashCall("oso-state set active_slice=1") },
  { label: "the slice commit", call: bashCall("git commit -m slice") },
  { label: "the slice's own edits", call: writeCall("src/slice.ts") },
];

const HOST_REFUSAL_PHRASES = ["prevents you from using this specific tool call", "is disabled for agent"] as const;

export function hostOutcomeOfToolCall(drive: AgentToolDrive, call: ToolCall): HostToolOutcome {
  const args = ["debug", "agent", drive.agent, "--tool", call.tool, "--params", JSON.stringify(call.params)];
  const run = invokeContractBar({
    binary: drive.binary,
    environment: drive.environment,
    projectDirectory: drive.projectDirectory,
    args,
    boundSeconds: CONTRACT_BAR_BOUND_SECONDS,
  });
  const label = `opencode ${args.join(" ")}`;
  if (run.error !== undefined || run.signal !== null) {
    return { kind: "undriven", reason: `${label} did not complete: ${run.error?.message ?? run.signal}` };
  }
  const streams = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (HOST_REFUSAL_PHRASES.some((phrase) => streams.includes(phrase))) return { kind: "refused" };
  if (run.status !== 0) return { kind: "undriven", reason: `${label} exited ${run.status} without refusing it: ${streams}` };
  return { kind: "executed" };
}

export function executionPowersTheHostWithheld(drive: AgentToolDrive): readonly string[] {
  return EXECUTION_PHASE_POWERS.map((power) => ({ power, outcome: hostOutcomeOfToolCall(drive, power.call) }))
    .filter(({ outcome }) => outcome.kind !== "executed")
    .map(({ power, outcome }) => `${power.label} ${outcome.kind === "undriven" ? outcome.reason : outcome.kind}`);
}
