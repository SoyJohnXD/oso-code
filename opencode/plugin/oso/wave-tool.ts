import { commonDirOf } from "./identity.ts";
import type { PluginTool } from "./tool.ts";
import type { ParsedAgentVerdict } from "./verdict.ts";
import {
  pinnedSessionTransport,
  runWave,
  type HostSessionApi,
  type WaveAgent,
  type WaveChildLaunch,
  type WaveChildResult,
} from "./wave.ts";

const CHILD_BOUND_MS = 30 * 60 * 1000;

export function waveTool(session: HostSessionApi | undefined): PluginTool {
  return {
    description: "Runs one oso-code wave: every child is an oso-applier or oso-verifier session pinned to its own"
      + " git worktree of this project, all children are opened before any of them is prompted, each child's turn"
      + " blocks until it reports, and its status/verdict line is read back in band. A child that cannot be pinned,"
      + " cannot run, or outlives its bound comes back blocked with the reason and never as a verdict.",
    args: {
      children: {
        type: "array",
        description: "One entry per wave child. Every worktree must already exist and belong to this project.",
        items: {
          type: "object",
          properties: {
            worktree: { type: "string", description: "Absolute path of the git worktree the child runs inside." },
            agent: { type: "string", enum: ["applier", "verifier"], description: "Which oso-code agent the child runs as." },
            prompt: { type: "string", description: "The full assignment the child receives as its first and only turn." },
          },
          required: ["worktree", "agent", "prompt"],
        },
      },
    },
    execute: async (args, call) => {
      if (session === undefined) {
        throw new Error("oso_wave cannot run: this host handed the plugin no session API to open children with");
      }
      const projectDirectory = call.directory ?? "";
      if (commonDirOf(projectDirectory) === "") {
        throw new Error(`oso_wave must run inside a git repository, and ${projectDirectory || "the directory the host named"} is not one`);
      }
      const results = await runWave({
        launches: parseLaunches(args),
        transport: pinnedSessionTransport(session),
        projectDirectory,
        parentSessionID: call.sessionID ?? "",
        timeoutMs: CHILD_BOUND_MS,
      });
      return {
        title: waveTitle(results),
        output: results.map(renderChild).join("\n\n"),
        metadata: { children: results.length, blocked: blockedCount(results) },
      };
    },
  };
}

function parseLaunches(args: unknown): WaveChildLaunch[] {
  const children = (args as { children?: unknown } | null | undefined)?.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("oso_wave needs a children array carrying at least one child");
  }
  return children.map(parseLaunch);
}

function parseLaunch(child: unknown, index: number): WaveChildLaunch {
  const record = (typeof child === "object" && child !== null ? child : {}) as Record<string, unknown>;
  const { worktree, agent, prompt } = record;
  if (typeof worktree !== "string" || worktree === "") {
    throw new Error(`oso_wave child ${index} needs a worktree path, not ${JSON.stringify(worktree)}`);
  }
  if (!isWaveAgent(agent)) {
    throw new Error(`oso_wave child ${index} needs agent "applier" or "verifier", not ${JSON.stringify(agent)}`);
  }
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error(`oso_wave child ${index} needs a prompt`);
  }
  return { worktree, agent, prompt };
}

function isWaveAgent(value: unknown): value is WaveAgent {
  return value === "applier" || value === "verifier";
}

function waveTitle(results: readonly WaveChildResult[]): string {
  const blocked = blockedCount(results);
  if (blocked === 0) {
    return `wave: ${results.length} children reported`;
  }
  return `wave: ${results.length} children, ${blocked} blocked`;
}

function blockedCount(results: readonly WaveChildResult[]): number {
  return results.filter((result) => result.outcome === "blocked").length;
}

function renderChild(result: WaveChildResult): string {
  if (result.outcome === "blocked") {
    return `=== ${result.worktree} (${result.agent}) — blocked: ${result.reason} ===`;
  }
  return `=== ${result.worktree} (${result.agent}) — ${verdictSummary(result.verdict)} ===\n${result.raw}`;
}

function verdictSummary(parsed: ParsedAgentVerdict): string {
  const lines: string[] = [];
  if (parsed.status !== undefined) {
    lines.push(`status: ${parsed.status}`);
  }
  if (parsed.verdict !== undefined) {
    lines.push(`verdict: ${parsed.verdict}`);
  }
  return lines.length === 0 ? "no verdict line" : lines.join(", ");
}
