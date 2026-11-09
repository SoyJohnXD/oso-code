import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sessionOutcomeDescription, type SessionRun } from "./behavior-drive.ts";
import { configHomeOf, type ContractFixture } from "./contract-fixture.ts";
import { failedLoadLinesOf, HOST_LOAD_PROBE_ARGS, runLoadProbe } from "./plugin-load-proof.ts";

export const PLUGIN_ENTRY_WITHOUT_A_FUNCTION_EXPORT = `export const osoCodeHooks = {
  "tool.execute.before": async () => {},
};
`;

export const PLUGIN_ENTRY_THAT_REGISTERS_NOTHING = `export const osoCode = async () => ({
  hooks: {
    "tool.execute.before": async () => {
      throw new Error("a hook map under a hooks key is never reached by this host");
    },
  },
});
`;

export function pluginEntryPathIn(fixture: ContractFixture): string {
  return path.join(configHomeOf(fixture), "plugin", "oso-code.js");
}

export function readPluginEntry(entryPath: string): string {
  return readFileSync(entryPath, "utf8");
}

export function writePluginEntry(entryPath: string, contents: string): void {
  writeFileSync(entryPath, contents);
}

export type HostPluginLoadReading =
  | Readonly<{ kind: "counted"; count: number }>
  | Readonly<{ kind: "unread"; reason: string }>;

const HOST_LOG_TAIL_LINES = 3;

function hostLogUnread(binary: string, boundSeconds: number, run: SessionRun): HostPluginLoadReading {
  const tail = run.stderr.trimEnd().split("\n").slice(-HOST_LOG_TAIL_LINES).join(" / ");
  return {
    kind: "unread",
    reason:
      `${binary} ${HOST_LOAD_PROBE_ARGS.join(" ")} ${sessionOutcomeDescription(run)} under its ${boundSeconds}s bound, so its ` +
      `host log was never read: ${tail === "" ? "it wrote nothing to stderr" : tail}`,
  };
}

export function countHostPluginLoadErrors(binary: string, environment: NodeJS.ProcessEnv, boundSeconds: number): HostPluginLoadReading {
  const run = runLoadProbe(binary, environment, undefined, boundSeconds);
  if (run.error !== undefined || run.status !== 0) return hostLogUnread(binary, boundSeconds, run);
  return { kind: "counted", count: failedLoadLinesOf(run.stderr).length };
}
