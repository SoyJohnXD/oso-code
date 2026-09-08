import { supervisedMain } from "../state/cli.ts";

supervisedMain(process.argv.slice(2)).then((exit) => { process.exitCode = exit; });
