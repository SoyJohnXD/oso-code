import type { HostName } from "../routes/routes.ts";
import { causeOf, isDirectory, logEvent, readFileIfPresent, stateFileFor } from "../state/store.ts";
import { readVerdictShape } from "./grammar.ts";
import { appendVerdict, recordedStateValue, TELEMETRY_WRITE_FAILED, VERIFIER_ROLE, verdictsFileFor } from "./record.ts";

export type VerifierReport = Readonly<{
  host: HostName;
  cwd: string;
  session: string;
  model: string | null;
  report: string;
}>;

const VERIFIER_AGENT = "oso-verifier";

export function isVerifierAgent(agentType: string): boolean {
  return agentType === VERIFIER_AGENT || agentType.endsWith(`:${VERIFIER_AGENT}`);
}

export function captureVerifierReport(report: VerifierReport): void {
  try {
    appendReportToItsRepository(report);
  } catch (error) {
    logEvent({ event: TELEMETRY_WRITE_FAILED, session: report.session, command: causeOf(error) });
  }
}

function appendReportToItsRepository({ host, cwd, session, model, report }: VerifierReport): void {
  if (!isDirectory(cwd)) return;
  const stateFile = stateFileFor(cwd);
  const state = readFileIfPresent(stateFile);
  if (state === undefined) return;
  appendVerdict(verdictsFileFor(stateFile), {
    host,
    session,
    change: recordedStateValue(state, "auto_change"),
    slice: recordedStateValue(state, "active_slice"),
    role: VERIFIER_ROLE,
    model,
    ...readVerdictShape(report),
    escalated: false,
  });
}
