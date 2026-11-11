const HOST_PLUGIN_LOAD_ERROR = "failed to load plugin";
const HOST_PLUGIN_LOADING_MESSAGE = 'msg="loading plugin"';

export const HOST_LOAD_PROBE_ARGS: readonly string[] = ["debug", "agents", "--standalone", "--print-logs"];

export type PluginLoadProof = Readonly<{ loadedLines: readonly string[]; failedLines: readonly string[] }>;

export function failedLoadLinesOf(hostLog: string): readonly string[] {
  return hostLog.split("\n").filter((line) => line.includes(HOST_PLUGIN_LOAD_ERROR));
}

export function pluginLoadProofOf(hostLog: string, pluginFileName: string): PluginLoadProof {
  return {
    loadedLines: hostLog.split("\n").filter((line) => line.includes(HOST_PLUGIN_LOADING_MESSAGE) && line.includes(pluginFileName)),
    failedLines: failedLoadLinesOf(hostLog),
  };
}
