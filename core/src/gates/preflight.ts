import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GateOutcome, GateVerdict, HookCaller, HookEnvelope, PreToolUseVerdict } from "../hosts/envelope.ts";
import { GATE_BUNDLE, gateRow, type GateId } from "../routes/routes.ts";
import {
  readStateFile,
  stateLeftAtTheInferredIdentity,
  taskIdentityFor,
  TASK_ROOT_VARIABLE,
  type InferredState,
  type TaskIdentity,
} from "../state/store.ts";

export { stateRecords, stateSays, stateValue } from "../state/store.ts";

export type GateRequest = Readonly<{ envelope: HookEnvelope; argv: readonly string[] }>;

export type GateDefinition<V extends GateVerdict = PreToolUseVerdict> = Readonly<{
  gate: GateId;
  errorSubject: string;
  judge: (request: GateRequest) => GateOutcome<V>;
}>;

export type ArmedState =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unusable"; stateFile: string }>
  | Readonly<{ kind: "moved"; left: InferredState; task: TaskIdentity }>
  | Readonly<{ kind: "readable"; stateFile: string; content: string }>;

type MovedIdentity = Extract<ArmedState, { kind: "moved" }>;

export type StandingState = Extract<ArmedState, { stateFile: string }>;

export type GateDenial = Readonly<{
  gate: GateId;
  message: string;
  event: string;
  session: string;
  detail?: string;
}>;

export function sanitizeSession(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}

export function hookSessionId(envelope: HookEnvelope): string {
  const named = envelope.caller.agentSession;
  return sanitizeSession(named !== "" ? named : envelope.sessionId);
}

export function payloadUnparseable(): GateOutcome {
  return { verdict: { kind: "allow" }, events: [{ event: "payload-unparseable", session: "" }] };
}

export function readArmedState(cwd: string): ArmedState {
  const task = taskIdentityFor(cwd);
  if (task.kind !== "unknown") {
    const read = readStateFile(task.stateFile);
    if (read.kind === "ok") return { kind: "readable", stateFile: task.stateFile, content: read.content };
    if (read.kind === "unreadable") return { kind: "unusable", stateFile: task.stateFile };
  }
  const left = stateLeftAtTheInferredIdentity(cwd, task);
  return left === undefined ? { kind: "absent" } : { kind: "moved", left, task };
}

export function stateFileIfNamed(cwd: string): string | undefined {
  const task = taskIdentityFor(cwd);
  return task.kind === "unknown" ? undefined : task.stateFile;
}

export function osoStateRemedy(session: string, verbAndArguments: string): string {
  return `oso-state --session ${session} ${verbAndArguments}`;
}

export function denied(denial: GateDenial): GateOutcome {
  const route = gateRow(denial.gate);
  return {
    verdict: { kind: "deny", message: denial.message },
    events: [
      {
        event: denial.event,
        session: denial.session,
        command: denial.detail ?? "",
        gate: route.script,
        hookEvent: route.event,
      },
    ],
  };
}

export function unusableStateMessage(stateFile: string, session: string): string {
  return (
    `oso-code: this session is armed but its state file (${stateFile}) cannot be read, ` +
    `so the gate cannot tell whether this call is safe. ` +
    `Remove or repair it (${osoStateRemedy(session, "clear")}), then retry.`
  );
}

export function deniedForUnusableState(gate: GateId, stateFile: string, session: string): GateOutcome {
  return denied({
    gate,
    message: unusableStateMessage(stateFile, session),
    event: "state-unreadable",
    session,
  });
}

export function identityMovedMessage(state: MovedIdentity, session: string): string {
  const named =
    state.task.kind === "unknown"
      ? `this session can name none of its own (${state.task.cause}) until ${TASK_ROOT_VARIABLE} declares one`
      : `${TASK_ROOT_VARIABLE} now names ${state.task.identity}`;
  return (
    `oso-code: the state that arms this session's gates still sits at ${state.left.stateFile}, keyed by the ` +
    `identity earlier releases inferred (${state.left.identity}), while ${named}. Carry it over with ` +
    `${osoStateRemedy(session, "show")} from this directory, or drop it with ${osoStateRemedy(session, "clear")}; ` +
    `until one of those runs, this gate denies rather than allowing on state it no longer reads.`
  );
}

export function deniedForMovedIdentity(gate: GateId, state: MovedIdentity, session: string): GateOutcome {
  return denied({
    gate,
    message: identityMovedMessage(state, session),
    event: "identity-moved-denied",
    session,
    detail: state.left.stateFile,
  });
}

export function allowedWithResidueCounted(session: string, command: string): GateOutcome {
  return { verdict: { kind: "allow" }, events: [{ event: "residue-allowed", session, command }] };
}

export function pluginRootDirectory(): string {
  const configured = process.env["CLAUDE_PLUGIN_ROOT"];
  if (configured !== undefined && configured !== "") return configured;
  return pluginRootAbove(path.dirname(fileURLToPath(import.meta.url)));
}

const PLUGIN_ROOT_WRAPPERS: readonly (readonly string[])[] = [[], ["plugin"]];
const HOOKS_MANIFEST_LOCATIONS: readonly (readonly string[])[] = [["hooks.json"], ["hooks", "hooks.json"]];
const HOOKS_MANIFEST_FINGERPRINT = `/${GATE_BUNDLE}`;

export function pluginRootAbove(moduleDirectory: string): string {
  let candidate = moduleDirectory;
  while (true) {
    for (const wrapper of PLUGIN_ROOT_WRAPPERS) {
      const root = path.join(candidate, ...wrapper);
      if (existsSync(path.join(root, "bin", "oso-state")) && isVerifiedOsoCodeRoot(root)) return root;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        `no ancestor of ${moduleDirectory} carries a verified oso-code bin/oso-state, directly or one level ` +
          "under plugin/, to anchor the plugin root on",
      );
    }
    candidate = parent;
  }
}

export const STATE_BIN_VARIABLE = "OSO_STATE_BIN";

export function installedStateBinPath(): string {
  return path.join(pluginRootDirectory(), "bin", "oso-state");
}

export function stateBinPath(caller: HookCaller): string {
  return caller.stateBin !== "" ? caller.stateBin : installedStateBinPath();
}

function isVerifiedOsoCodeRoot(root: string): boolean {
  return HOOKS_MANIFEST_LOCATIONS.some((segments) => hooksManifestFingerprinted(path.join(root, ...segments)));
}

function hooksManifestFingerprinted(manifestFile: string): boolean {
  try {
    return readFileSync(manifestFile, "utf8").includes(HOOKS_MANIFEST_FINGERPRINT);
  } catch {
    return false;
  }
}
