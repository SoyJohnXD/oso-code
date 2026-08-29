import type { GateOutcome } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import type { HostName } from "../routes/routes.ts";
import { stateFileFor } from "../state/store.ts";
import {
  denied,
  deniedForUnusableState,
  payloadUnparseable,
  readArmedState,
  sanitizeSession,
  stateMatches,
  stateValue,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

const TOOL_NAME = /^[A-Za-z0-9_:.-]+$/;
const PLAN_APPROVAL_PENDING = /^plan_approval=pending$/m;
const PENDING_APPROVAL_MESSAGE =
  'oso-code: plan approval is pending. Use Codex native "Implement the plan." approval, ' +
  "or send exactly CANCEL OSO PLAN to abandon it, before using local tools.";

export const UNKNOWN_TOOL_GATE: GateDefinition = {
  gate: "unknown",
  errorSubject: "the unknown-tool gate",
  judge: judgeUnknownTool,
};

function judgeUnknownTool({ envelope, argv }: GateRequest): GateOutcome {
  const configured = readAllowlist(argv);
  if (configured.kind === "misconfigured") return configurationError(configured.cause);
  const allowlist = configured.allowlist;

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
  if (!stateMatches(stateContent, PLAN_APPROVAL_PENDING)) return false;
  return stateValue(stateContent, "plan_approval_session") === session;
}

function allowlistCarries(allowlist: string, toolName: string): boolean {
  return `|${allowlist}|`.includes(`|${toolName}|`);
}

function allowlistHost(host: HostName): string {
  return host === "opencode" ? "OpenCode" : "Codex";
}
