import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GateOutcome, GateVerdict, HookEnvelope, PreToolUseVerdict } from "../hosts/envelope.ts";
import { GATE_BUNDLE, gateRow, type GateId } from "../routes/routes.ts";
import { readStateFile } from "../state/store.ts";

export { stateRecords, stateSays, stateValue } from "../state/store.ts";

export type GateRequest = Readonly<{ envelope: HookEnvelope; argv: readonly string[] }>;

export type GateDefinition<V extends GateVerdict = PreToolUseVerdict> = Readonly<{
  gate: GateId;
  errorSubject: string;
  judge: (request: GateRequest) => GateOutcome<V>;
}>;

export type ArmedState =
  | { readonly kind: "absent" }
  | { readonly kind: "unusable" }
  | { readonly kind: "readable"; readonly content: string };

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

export function readArmedState(stateFile: string): ArmedState {
  const read = readStateFile(stateFile);
  if (read.kind === "absent") return { kind: "absent" };
  if (read.kind === "unreadable") return { kind: "unusable" };
  return { kind: "readable", content: read.content };
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
