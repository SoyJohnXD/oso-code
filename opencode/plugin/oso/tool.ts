export interface HostPermissionRequest {
  permission: string;
  patterns: readonly string[];
  always: readonly string[];
  metadata: Record<string, unknown>;
}

export interface PluginToolCall {
  sessionID?: string;
  directory?: string;
  ask?: (request: HostPermissionRequest) => Promise<unknown>;
}

export interface PluginToolResult {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
}

export interface PluginTool {
  description: string;
  args: Record<string, unknown>;
  execute(args: unknown, call: PluginToolCall): Promise<PluginToolResult>;
}
