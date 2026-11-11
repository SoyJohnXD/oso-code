import { captureVerifierReport, isVerifierAgent } from "@oso-code/core";
import { deriveRootId } from "./identity.ts";

const SUBAGENT_TOOL = "subagent";
const SUBAGENT_RUNNING = "running";

interface SubagentCompletion {
  tool: string;
  input: unknown;
  status: "completed" | "error";
  result?: { output?: unknown };
}

export function captureSubagentVerdict(call: SubagentCompletion, directory: string): void {
  const agent = (call.input as { agent?: unknown } | null)?.agent;
  if (call.tool !== SUBAGENT_TOOL || typeof agent !== "string" || !isVerifierAgent(agent)) {
    return;
  }
  const report = subagentReportOf(call);
  if (report !== undefined) {
    captureOpenCodeVerifierReport({ directory, model: null, report });
  }
}

export function captureOpenCodeVerifierReport(
  { directory, model, report }: { directory: string; model: string | null; report: string },
): void {
  captureVerifierReport({ host: "opencode", cwd: directory, session: deriveRootId(directory), model, report });
}

function subagentReportOf(call: SubagentCompletion): string | undefined {
  if (call.status === "error") {
    return "";
  }
  const outcome = (call.result?.output ?? {}) as { status?: unknown; output?: unknown };
  if (outcome.status === SUBAGENT_RUNNING) {
    return undefined;
  }
  return typeof outcome.output === "string" ? outcome.output : "";
}
