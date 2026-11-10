import type { Plugin } from "@opencode/plugin";

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0];

export type OsoTool = Parameters<ToolEditor["add"]>[0];

export type OsoToolContext = Parameters<OsoTool["execute"]>[1];

export interface ToolHost {
  session: Plugin.Context["session"];
  permission: Plugin.Context["permission"];
  directoryOf: (sessionID: OsoToolContext["sessionID"]) => Promise<string>;
}

export const DIRECT_CALL = { codemode: false } as const;
