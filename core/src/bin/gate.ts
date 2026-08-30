import { readFileSync } from "node:fs";
import { gateErrorRun, runGate, THE_GATE_ENTRY_POINT, type GateRun } from "../gates/dispatch.ts";
import { spawnedEnvelope } from "../hosts/spawned.ts";
import { logEvent } from "../state/store.ts";

function attemptGate(argv: readonly string[]): GateRun {
  try {
    return runGate(argv, spawnedEnvelope(readFileSync(0, "utf8"), process.env));
  } catch (cause) {
    return gateErrorRun(THE_GATE_ENTRY_POINT, cause);
  }
}

const run = attemptGate(process.argv.slice(2));
if (run.stdout !== "") process.stdout.write(run.stdout);
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
