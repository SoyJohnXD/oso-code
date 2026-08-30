import { appendFileSync } from "node:fs";
import path from "node:path";
import { NO_VERDICT, type GateOutcome, type NoVerdictVerdict } from "../hosts/envelope.ts";
import { pluginRootDirectory, type GateDefinition, type GateRequest } from "./preflight.ts";

export const STATEBIN_GATE: GateDefinition<NoVerdictVerdict> = {
  gate: "statebin",
  errorSubject: "the state-bin gate",
  judge: judgeStatebin,
};

function judgeStatebin(_request: GateRequest): GateOutcome<NoVerdictVerdict> {
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (envFile === undefined || envFile === "") return NO_VERDICT;

  const stateBin = path.join(pluginRootDirectory(), "bin", "oso-state");
  appendFileSync(envFile, `export OSO_STATE_BIN=${stateBin}\n`);
  return NO_VERDICT;
}
