import path from "node:path";
import type { GateOutcome, HookEnvelope } from "../hosts/envelope.ts";
import { ALLOWED } from "../hosts/envelope.ts";
import { opencodePathsFor } from "../install/opencode.ts";
import { openCodeInstallTargets } from "../install/opencode-install.ts";
import { homeDirectoryFrom, stateFileFor } from "../state/store.ts";
import { planAwaitsItsSlice, sliceArmingRemedy } from "./edits.ts";
import {
  denied,
  deniedForUnusableState,
  hookSessionId,
  payloadUnparseable,
  readArmedState,
  type GateDefinition,
  type GateRequest,
} from "./preflight.ts";

const TOOL_NAME = /^[A-Za-z0-9_:.-]+$/;
export const UNKNOWN_TOOL_GATE: GateDefinition = {
  gate: "unknown",
  errorSubject: "the unknown-tool gate",
  judge: judgeUnknownTool,
};

function judgeUnknownTool({ envelope, argv }: GateRequest): GateOutcome {
  const configured = readAllowlist(argv);
  if (configured.kind === "misconfigured") return configurationError(configured.cause);

  const session = hookSessionId(envelope);
  if (session === "") return payloadUnparseable();

  const stateFile = stateFileFor(envelope.cwd);
  const state = readArmedState(stateFile);
  if (state.kind === "absent") return ALLOWED;
  if (state.kind === "unusable") return deniedForUnusableState("unknown", stateFile, session);

  const toolName = envelope.toolName;
  if (RELEASE_SHAPED_TOOL.test(toolName)) return deniedAsRelease(toolName, session);

  const harnessTarget = harnessTreeTargetOf(envelope);
  if (harnessTarget !== undefined) return deniedAsHarnessWrite(toolName, harnessTarget, session);

  if (!planAwaitsItsSlice(state.content, session)) return ALLOWED;
  if (TOOL_NAME.test(toolName) && allowlistCarries(configured.allowlist, toolName)) return ALLOWED;
  return deniedUntilASliceIsArmed(toolName, session);
}

const RELEASE_SHAPED_TOOL = /(deploy|publish|release)/i;

function deniedAsRelease(toolName: string, session: string): GateOutcome {
  return denied({
    gate: "unknown",
    message:
      `oso-code: tool '${toolName}' is shaped like a deploy, publish or release, and this repository carries ` +
      `oso-code run state, so no agent may run it. Run it from your own terminal instead.`,
    event: "release-tool-denied",
    session,
    detail: toolName,
  });
}

function deniedAsHarnessWrite(toolName: string, target: string, session: string): GateOutcome {
  return denied({
    gate: "unknown",
    message:
      `oso-code: '${toolName}' would write ${target}, inside the installed oso-code harness tree, which no agent ` +
      `may change. Change the repository's own copy and reinstall instead.`,
    event: "harness-write-denied",
    session,
    detail: target,
  });
}

function deniedUntilASliceIsArmed(toolName: string, session: string): GateOutcome {
  return denied({
    gate: "unknown",
    message:
      `oso-code: plan mode is active but no slice is active, and tool '${toolName === "" ? "<missing>" : toolName}' ` +
      `is not known to be read-only, so it waits for the slice as an edit would. ` +
      `Activate it first (${sliceArmingRemedy(session)}), then retry the call.`,
    event: "unknown-tool-denied",
    session,
    detail: toolName,
  });
}

function harnessTreeTargetOf(envelope: HookEnvelope): string | undefined {
  const targets = writeTargetsOf(envelope).map((target) => path.resolve(envelope.cwd, target));
  if (targets.length === 0) return undefined;
  const harnessTree = installedHarnessTree();
  return targets.find((target) => harnessTree.some((directory) => liesWithin(directory, target)));
}

const PATCH_TARGET_MARKER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;

function writeTargetsOf({ toolName, filePath, patchText }: HookEnvelope): string[] {
  if (toolName === "edit" || toolName === "write") return filePath === "" ? [] : [filePath];
  if (toolName === "apply_patch") return [...patchText.matchAll(PATCH_TARGET_MARKER)].map((marker) => (marker[1] ?? "").trim());
  return [];
}

function installedHarnessTree(): string[] {
  const paths = opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env);
  const targets = openCodeInstallTargets(paths);
  return [targets.skills, targets.agents, targets.commands, targets.plugin, targets.hooks, paths.stateRoot];
}

function liesWithin(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return !escapes;
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

function allowlistCarries(allowlist: string, toolName: string): boolean {
  return `|${allowlist}|`.includes(`|${toolName}|`);
}
