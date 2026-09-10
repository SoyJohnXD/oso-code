import type { GateOutcome, HookEnvelope } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { CODEX_METADATA_READINESS_MS, readCodexSessionMetadata } from "../hosts/codex-session-metadata.ts";
import type { HostName } from "../routes/routes.ts";
import { TOOL_ROWS } from "../routes/routes.ts";
import { isNativeResolutionFault, nativeRepositoryIdentity } from "../state/handoff.ts";
import { basenameOf } from "../shell/lexer.ts";
import { lineVerdict } from "../shell/line-verdict.ts";
import { causeOf, stateFileFor } from "../state/store.ts";
import {
  denied,
  deniedForUnusableState,
  payloadUnparseable,
  readArmedState,
  sanitizeSession,
  stateSays,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

const TOOL_NAME = /^[A-Za-z0-9_:.-]+$/;
const PENDING_APPROVAL_MESSAGE =
  'oso-code: plan approval is pending. Use Codex native "Implement the plan." approval, ' +
  "or send exactly CANCEL OSO PLAN to abandon it, before using local tools.";
const LINEAGE_OF_ANYONE_BUT_THE_ROOT = "child, missing, or contradictory native lineage";

type MemoryRefusal = Readonly<{ event: string; message: string }>;

export const UNKNOWN_TOOL_GATE: GateDefinition = {
  gate: "unknown",
  errorSubject: "the unknown-tool gate",
  judge: judgeUnknownTool,
};

function judgeUnknownTool({ envelope, argv }: GateRequest): GateOutcome {
  const configured = readAllowlist(argv);
  if (configured.kind === "misconfigured") return configurationError(configured.cause);
  const allowlist = configured.allowlist;

  const memoryDenial = codexMemoryDenial(envelope);
  if (memoryDenial !== undefined) return memoryDenial;

  const session = sanitizeSession(envelope.sessionId);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("unknown", stateFile, session);

  if (thisSessionsPlanIsPending(state.content, session)) {
    return denied({
      gate: "unknown",
      message: PENDING_APPROVAL_MESSAGE,
      event: "plan-approval-pending-denied",
      session,
    });
  }

  const toolName = envelope.toolName;
  if (TOOL_NAME.test(toolName) && allowlistCarries(allowlist, toolName)) return ALLOWED;

  return denied({
    gate: "unknown",
    message:
      `oso-code: tool '${toolName === "" ? "<missing>" : toolName}' is not in this release's ` +
      `${allowlistHost(envelope.caller.host)} hook allowlist. Use one of the allowed local tools instead: ` +
      `${allowlist.replaceAll("|", ", ")}.`,
    event: "unknown-tool-denied",
    session,
    detail: toolName,
  });
}

function codexMemoryDenial(envelope: HookEnvelope): GateOutcome | undefined {
  if (envelope.caller.host !== "codex") return undefined;
  const tool = envelope.toolName;
  if (tool === "apply_patch") return undefined;
  const reads = ["mcp__engram__mem_context", "mcp__engram__mem_search", "mcp__engram__mem_get_observation"];
  if (reads.includes(tool)) return undefined;
  const memoryTool = tool.startsWith("mcp__engram__");
  const cliVerdict = lineVerdict(envelope.commandLine, (command, verdict) => {
    const executable = basenameOf(command.tokens[0] ?? "");
    if (executable !== "engram" && executable !== "engram.exe") return verdict;
    return ["search", "context", "help", "--help", "-h", "version", "--version", "-v"].includes(command.tokens[1] ?? "") ? verdict : "memory";
  }, { unreadExpandedExecutables: true });
  if (!memoryTool && cliVerdict === "clear") return undefined;
  const known = !memoryTool || TOOL_ROWS.some((row) => row.names.codex === tool);
  const cause = known ? unattestedCodexRoot(envelope) : "unknown Engram method";
  if (cause === undefined) return undefined;
  const shellEffectsAreUnread = !memoryTool && cliVerdict === "unread";
  const refusal = memoryRefusal(cause, shellEffectsAreUnread);
  return denied({ gate: "unknown", session: envelope.sessionId, detail: tool, ...refusal });
}

function memoryRefusal(cause: string, shellEffectsAreUnread: boolean): MemoryRefusal {
  if (shellEffectsAreUnread) {
    return {
      event: "shell-effects-unestablished",
      message: `oso-code: shell effects could not be established; native ROOT attestation is required: ${cause}.`,
    };
  }
  if (cause === LINEAGE_OF_ANYONE_BUT_THE_ROOT) {
    return {
      event: "memory-write-belongs-to-root",
      message:
        `oso-code: semantic memory belongs to the root session, and this call carries ${cause}, ` +
        "so it is not yours to persist. Continue your slice and hand the observation to the parent " +
        "in your report; the parent persists it. This refusal ends the write, never your work.",
    };
  }
  return {
    event: "memory-write-denied",
    message: `oso-code: semantic memory mutations require native ROOT attestation: ${cause}.`,
  };
}

function unattestedCodexRoot(envelope: HookEnvelope): string | undefined {
  try {
    if (envelope.payloadRead !== "json" || envelope.sessionId === "" || envelope.transcriptPath === "") return "missing native hook identity";
    const deadline = performance.now() + CODEX_METADATA_READINESS_MS;
    const native = readCodexSessionMetadata(envelope.transcriptPath, deadline);
    const rootEntrypoint = native.source === "cli" || native.source === "exec";
    if (native.id !== envelope.sessionId || !rootEntrypoint || native.parentThreadId !== undefined || native.agentPath !== undefined || native.agentRole !== undefined || native.threadSpawn !== undefined) return LINEAGE_OF_ANYONE_BUT_THE_ROOT;
    if (nativeRepositoryIdentity(native.cwd, deadline).commonDirectory !== nativeRepositoryIdentity(envelope.cwd, deadline).commonDirectory) return "native repository mismatch";
    return undefined;
  } catch (error) {
    if (!isNativeResolutionFault(error)) throw error;
    return causeOf(error);
  }
}

type AllowlistRead =
  | { readonly kind: "usable"; readonly allowlist: string }
  | { readonly kind: "misconfigured"; readonly cause: string };

function readAllowlist(argv: readonly string[]): AllowlistRead {
  if (argv[0] !== "--allow" || argv.length !== 2) {
    return { kind: "misconfigured", cause: "missing allowlist" };
  }
  const allowlist = argv[1] as string;
  if (allowlist === "") return { kind: "misconfigured", cause: "empty allowlist" };
  if (!allowlist.split("|").every((tool) => TOOL_NAME.test(tool))) {
    return { kind: "misconfigured", cause: "invalid allowlist" };
  }
  return { kind: "usable", allowlist };
}

function configurationError(cause: string): GateOutcome {
  return {
    verdict: { kind: "gateError", subject: `the unknown-tool gate configuration (${cause})` },
    events: [],
  };
}

function thisSessionsPlanIsPending(stateContent: string, session: string): boolean {
  if (!stateSays(stateContent, "plan_approval", "pending")) return false;
  return stateValue(stateContent, "plan_approval_session") === session;
}

function allowlistCarries(allowlist: string, toolName: string): boolean {
  return `|${allowlist}|`.includes(`|${toolName}|`);
}

function allowlistHost(host: HostName): string {
  return host === "opencode" ? "OpenCode" : "Codex";
}
