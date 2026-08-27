import { readFileSync } from "node:fs";
import { runGate } from "../gates/dispatch.ts";
import { logEvent } from "../state/store.ts";

const run = runGate(process.argv.slice(2), readFileSync(0, "utf8"));
if (run.stdout !== "") process.stdout.write(run.stdout);
if (run.stderr !== "") process.stderr.write(run.stderr);
for (const event of run.events) logEvent(event);
process.exit(run.exit);
