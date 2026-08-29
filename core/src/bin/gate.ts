import { readFileSync } from "node:fs";
import { runGate } from "../gates/dispatch.ts";
import { spawnedEnvelope } from "../hosts/spawned.ts";
import { logEvent } from "../state/store.ts";

const run = runGate(process.argv.slice(2), spawnedEnvelope(readFileSync(0, "utf8"), process.env));
if (run.stdout !== "") process.stdout.write(run.stdout);
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
