import { accessSync, constants, statSync } from "node:fs";
import type { GateOutcome, HookEnvelope } from "../hosts/envelope.ts";
import { gateRow, type GateId } from "../routes/routes.ts";
import { readStateFile } from "../state/store.ts";

export type GateRequest = Readonly<{ envelope: HookEnvelope; argv: readonly string[] }>;

export type GateDefinition = Readonly<{
  gate: GateId;
  errorSubject: string;
  judge: (request: GateRequest) => GateOutcome;
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
  const marker = process.env["OSO_AGENT"];
  return sanitizeSession(marker !== undefined && marker !== "" ? marker : envelope.sessionId);
}

export function payloadUnparseable(): GateOutcome {
  return { verdict: { kind: "allow" }, events: [{ event: "payload-unparseable", session: "" }] };
}

export function readArmedState(stateFile: string): ArmedState {
  const stats = statSync(stateFile, { throwIfNoEntry: false });
  if (stats === undefined) return { kind: "absent" };
  if (!stats.isFile() || !isReadable(stateFile)) return { kind: "unusable" };
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") return { kind: "unusable" };
  return { kind: "readable", content: read.content };
}

export function stateMatches(content: string, stateRecord: RegExp): boolean {
  return stateRecord.test(content);
}

export function stateValue(content: string, key: string): string {
  return content
    .split("\n")
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1))
    .join("\n");
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

function isReadable(target: string): boolean {
  try {
    accessSync(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
