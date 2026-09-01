import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configHomeOf, type ContractFixture } from "./contract-fixture.ts";

export const HOST_PLUGIN_LOAD_ERROR = "failed to load plugin";

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

export function countHostPluginLoadErrors(binary: string, environment: NodeJS.ProcessEnv, boundSeconds: number): number {
  const run = spawnSync(binary, ["agent", "list", "--print-logs"], {
    env: environment,
    encoding: "utf8",
    timeout: boundSeconds * 1000,
  });
  const log = run.stderr ?? "";
  return log.split("\n").filter((line) => line.includes(HOST_PLUGIN_LOAD_ERROR)).length;
}
