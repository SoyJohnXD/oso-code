import type { SessionRun } from "./behavior-drive.ts";
import { invokeContractBar } from "./drive.ts";

const HOST_PLUGIN_LOAD_ERROR = "failed to load plugin";
export const HOST_LOAD_PROBE_ARGS: readonly string[] = ["debug", "agents", "--standalone", "--print-logs"];

const HOST_PLUGIN_LOADING_MESSAGE = 'msg="loading plugin"';

export type PluginLoadProof = Readonly<{ loadedLines: readonly string[]; failedLines: readonly string[] }>;

export function runLoadProbe(
  binary: string,
  environment: NodeJS.ProcessEnv,
  projectDirectory: string | undefined,
  boundSeconds: number,
): SessionRun {
  const probeEnvironment = projectDirectory === undefined ? environment : { ...environment, PWD: projectDirectory };
  const run = invokeContractBar({ binary, environment: probeEnvironment, args: HOST_LOAD_PROBE_ARGS, boundSeconds, projectDirectory });
  return { stdout: run.stdout ?? "", stderr: run.stderr ?? "", status: run.status, signal: run.signal, error: run.error };
}

export function failedLoadLinesOf(hostLog: string): readonly string[] {
  return hostLog.split("\n").filter((line) => line.includes(HOST_PLUGIN_LOAD_ERROR));
}

export function pluginLoadProofOf(hostLog: string, pluginFileName: string): PluginLoadProof {
  return {
    loadedLines: hostLog.split("\n").filter((line) => line.includes(HOST_PLUGIN_LOADING_MESSAGE) && line.includes(pluginFileName)),
    failedLines: failedLoadLinesOf(hostLog),
  };
}
