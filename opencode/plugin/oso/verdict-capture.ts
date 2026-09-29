import { captureVerifierReport, isVerifierAgent } from "@oso-code/core";
import { deriveRootId } from "./identity.ts";

const TASK_TOOL = "task";

interface TaskCall {
  tool?: unknown;
  args?: { subagent_type?: unknown } | null;
}

interface TaskResult {
  output?: unknown;
  metadata?: {
    background?: unknown;
    model?: { providerID?: unknown; modelID?: unknown } | null;
  } | null;
}

export function captureTaskVerdict(input: unknown, output: unknown, directory: string): void {
  const call = (input ?? {}) as TaskCall;
  const result = (output ?? {}) as TaskResult;
  const subagentType = call.args?.subagent_type;
  if (call.tool !== TASK_TOOL || typeof subagentType !== "string" || !isVerifierAgent(subagentType)) {
    return;
  }
  if (result.metadata?.background === true || typeof result.output !== "string") {
    return;
  }
  captureVerifierReport({
    host: "opencode",
    cwd: directory,
    session: deriveRootId(directory),
    model: launchedModelOf(result),
    report: result.output,
  });
}

function launchedModelOf(result: TaskResult): string | null {
  const model = result.metadata?.model;
  const providerID = model?.providerID;
  const modelID = model?.modelID;
  return typeof providerID === "string" && typeof modelID === "string" ? `${providerID}/${modelID}` : null;
}
