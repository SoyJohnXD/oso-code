import { commonDirOf } from "./identity.ts";
import { DIRECT_CALL, type OsoTool, type ToolHost } from "./tool.ts";
import { BATCH_MAX_SLICES, isSliceId, readSliceBlocks, type ParsedAgentVerdict } from "@oso-code/core";
import {
  pinnedSessionTransport,
  runWave,
  type BatchPacket,
  type WaveAgent,
  type WaveChildLaunch,
  type WaveChildReported,
  type WaveChildResult,
} from "./wave.ts";

const CHILD_BOUND_MS = 30 * 60 * 1000;
const MAX_WAVE_CHILDREN = 4;

export function waveTool(host: ToolHost): OsoTool {
  return {
    name: "oso_wave",
    description: "Runs one oso-code wave: every child is an oso-applier or oso-verifier session pinned to its own"
      + " git worktree of this project (a verifier child may instead carry a batch of up to 3 packets and run pinned to the"
      + " project directory), a wave holds at most 4 children, all children are opened before any of them is prompted, each child's turn"
      + " blocks until it reports, and its status/verdict line is read back in band. A child that cannot be pinned,"
      + " cannot run, or outlives its bound comes back blocked with the reason and never as a verdict.",
    input: {
      type: "object",
      properties: {
        children: {
          type: "array",
          description: "One entry per wave child. Every worktree must already exist and belong to this project.",
          items: {
            type: "object",
            properties: {
              worktree: { type: "string", description: "Absolute path of the git worktree the child runs inside." },
              agent: { type: "string", enum: ["applier", "verifier"], description: "Which oso-code agent the child runs as." },
              prompt: { type: "string", description: "The full assignment the child receives as its first and only turn." },
              applier_proof: {
                type: "string",
                description: "The applier's proof, scan, and decisions_used report blocks for the slice this child verifies,"
                  + " verbatim and alone — a verifier child's field, which an applier child offered it comes back blocked for.",
              },
              packets: {
                type: "array",
                description: "A verifier child's batch: up to 3 slice packets, in place of worktree and applier_proof."
                  + " The child runs pinned to the project directory and each packet's worktree and applier_proof reach it.",
                items: {
                  type: "object",
                  properties: {
                    slice: { type: "string", description: "The slice id, unique within the batch." },
                    goal: { type: "string", description: "The slice's goal, verbatim." },
                    files: { type: "string", description: "The slice's expected files, verbatim." },
                    worktree: { type: "string", description: "Absolute path of the slice's git worktree." },
                    slice_start: { type: "string", description: "The ref the slice's diff is judged against." },
                    criteria: { type: "string", description: "The slice's verify criteria, verbatim." },
                    decision_block: { type: "string", description: "The ledger decisions relevant to the slice, verbatim." },
                    applier_proof: { type: "string", description: "The slice's applier proof, scan, and decisions_used blocks, verbatim and alone." },
                  },
                  required: ["slice", "goal", "files", "worktree", "slice_start", "criteria", "decision_block", "applier_proof"],
                },
              },
            },
            required: ["agent", "prompt"],
          },
        },
      },
      required: ["children"],
    },
    options: DIRECT_CALL,
    execute: async (input, call) => {
      const projectDirectory = await host.directoryOf(call.sessionID);
      if (commonDirOf(projectDirectory) === "") {
        throw new Error(`oso_wave must run inside a git repository, and ${projectDirectory} is not one`);
      }
      const results = await runWave({
        launches: parseLaunches(input),
        transport: pinnedSessionTransport(host.session),
        projectDirectory,
        parentSessionID: call.sessionID,
        timeoutMs: CHILD_BOUND_MS,
      });
      return {
        content: results.map(renderChild).join("\n\n"),
        metadata: { title: waveTitle(results), children: results.length, blocked: blockedCount(results) },
      };
    },
  };
}

function parseLaunches(args: unknown): WaveChildLaunch[] {
  const children = (args as { children?: unknown } | null | undefined)?.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("oso_wave needs a children array carrying at least one child");
  }
  if (children.length > MAX_WAVE_CHILDREN) {
    throw new Error(`oso_wave runs at most ${MAX_WAVE_CHILDREN} children per call, and this call carries ${children.length}`);
  }
  return children.map(parseLaunch);
}

function parseLaunch(child: unknown, index: number): WaveChildLaunch {
  const record = (typeof child === "object" && child !== null ? child : {}) as Record<string, unknown>;
  const { worktree, agent, prompt, applier_proof: applierProof, packets } = record;
  if (packets !== undefined) {
    return parseBatchLaunch(record, index);
  }
  if (typeof worktree !== "string" || worktree === "") {
    throw new Error(`oso_wave child ${index} needs a worktree path, not ${JSON.stringify(worktree)}`);
  }
  if (!isWaveAgent(agent)) {
    throw new Error(`oso_wave child ${index} needs agent "applier" or "verifier", not ${JSON.stringify(agent)}`);
  }
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error(`oso_wave child ${index} needs a prompt`);
  }
  if (applierProof !== undefined && (typeof applierProof !== "string" || applierProof === "")) {
    throw new Error(`oso_wave child ${index} needs applier_proof as the applier's three report blocks, not ${JSON.stringify(applierProof)}`);
  }
  return { worktree, agent, prompt, applierProof };
}

function parseBatchLaunch(record: Record<string, unknown>, index: number): WaveChildLaunch {
  const { worktree, agent, prompt, applier_proof: applierProof, packets } = record;
  if (agent !== "verifier") {
    throw new Error(`oso_wave child ${index} carries packets, which only a verifier child may, not ${JSON.stringify(agent)}`);
  }
  if (worktree !== undefined || applierProof !== undefined) {
    throw new Error(`oso_wave child ${index} carries packets, so its worktree and applier_proof belong inside each packet`);
  }
  if (typeof prompt !== "string" || prompt === "") {
    throw new Error(`oso_wave child ${index} needs a prompt`);
  }
  if (!Array.isArray(packets) || packets.length === 0) {
    throw new Error(`oso_wave child ${index} needs packets carrying at least one packet`);
  }
  if (packets.length > BATCH_MAX_SLICES) {
    throw new Error(`oso_wave child ${index} carries ${packets.length} packets, and a batch holds at most ${BATCH_MAX_SLICES}`);
  }
  const parsed = packets.map((packet, packetIndex) => parsePacket(packet, index, packetIndex));
  const duplicate = parsed.find((packet, position) => parsed.findIndex((other) => other.slice === packet.slice) !== position);
  if (duplicate !== undefined) {
    throw new Error(`oso_wave child ${index} names the slice id ${duplicate.slice} in more than one packet`);
  }
  return { agent, prompt, packets: parsed };
}

function parsePacket(packet: unknown, childIndex: number, index: number): BatchPacket {
  const record = (typeof packet === "object" && packet !== null ? packet : {}) as Record<string, unknown>;
  const { slice, goal, files, worktree, slice_start: sliceStart, criteria, decision_block: decisionBlock, applier_proof: applierProof } = record;
  const where = `oso_wave child ${childIndex} packet ${index}`;
  if (typeof slice !== "string" || !isSliceId(slice)) {
    throw new Error(`${where} needs a slice id matching the slice id rule, not ${JSON.stringify(slice)}`);
  }
  return {
    slice,
    goal: requiredText(goal, "goal", where),
    files: requiredText(files, "files", where),
    worktree: requiredText(worktree, "a worktree path", where),
    sliceStart: requiredText(sliceStart, "slice_start", where),
    criteria: requiredText(criteria, "criteria", where),
    decisionBlock: requiredText(decisionBlock, "decision_block", where),
    applierProof: requiredText(applierProof, "applier_proof as the applier's three report blocks", where),
  };
}

function requiredText(value: unknown, need: string, where: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${where} needs ${need}, not ${JSON.stringify(value)}`);
  }
  return value;
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
  return `=== ${result.worktree} (${result.agent}) — ${verdictSummary(result)} ===\n${result.raw}`;
}

function verdictSummary({ verdict: parsed, raw }: WaveChildReported): string {
  const lines: string[] = [];
  if (parsed.status !== undefined) {
    lines.push(`status: ${parsed.status}`);
  }
  const blocks = readSliceBlocks(raw);
  if (blocks.length > 1) {
    lines.push(`verdict: ${blocks.map((block) => `${block.slice ?? "unnamed"} ${block.verdict}`).join(", ")}`);
  } else if (parsed.verdict !== undefined) {
    lines.push(`verdict: ${parsed.verdict}`);
  }
  return lines.length === 0 ? "no verdict line" : lines.join(", ");
}
