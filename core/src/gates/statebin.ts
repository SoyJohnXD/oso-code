import { appendFileSync } from "node:fs";
import { NO_VERDICT, type GateOutcome, type NoVerdictVerdict } from "../hosts/envelope.ts";
import { installedStateBinPath, STATE_BIN_VARIABLE, type GateDefinition, type GateRequest } from "./preflight.ts";

export const STATEBIN_GATE: GateDefinition<NoVerdictVerdict> = {
  gate: "statebin",
  errorSubject: "the state-bin gate",
  judge: judgeStatebin,
};

function judgeStatebin(_request: GateRequest): GateOutcome<NoVerdictVerdict> {
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (envFile === undefined || envFile === "") return NO_VERDICT;

  appendFileSync(envFile, `export ${STATE_BIN_VARIABLE}=${installedStateBinPath()}\n`);
  return NO_VERDICT;
}
