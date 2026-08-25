import { recordTrace } from "./trace.ts";
import { messageOf } from "./wave.ts";

export interface WorkspaceAdapterInput {
  experimentalWorkspace?: unknown;
  client?: unknown;
}

export const WORKSPACE_ADAPTER_TYPE = "oso-code";

export function registerWorkspaceAdapter(input: WorkspaceAdapterInput): void {
  const register = registerAdapterFnOf(input.experimentalWorkspace);
  if (register === undefined) {
    recordTrace({
      origin: "workspace.register",
      detail: `the host exposed no experimental workspace registry, so "${WORKSPACE_ADAPTER_TYPE}" is absent from its adapter list`,
      severity: "advisory",
      client: input.client,
    });
    return;
  }
  try {
    register(WORKSPACE_ADAPTER_TYPE, OSO_WORKSPACE_ADAPTER);
  } catch (err) {
    recordTrace({
      origin: "workspace.register",
      detail: messageOf(err),
      severity: "advisory",
      client: input.client,
    });
  }
}

export const OSO_WORKSPACE_ADAPTER = {
  name: "oso-code wave",
  description: "Worktrees for an oso-code wave, created by the oso_wave tool rather than from this dialog",
  configure(): never {
    throw new Error(
      `the "${WORKSPACE_ADAPTER_TYPE}" adapter is registered for discovery only — a wave worktree is created by the oso_wave tool, never by the host workspace dialog`,
    );
  },
};

type RegisterAdapter = (type: string, adapter: typeof OSO_WORKSPACE_ADAPTER) => unknown;

function registerAdapterFnOf(experimentalWorkspace: unknown): RegisterAdapter | undefined {
  if (typeof experimentalWorkspace !== "object" || experimentalWorkspace === null) {
    return undefined;
  }
  const register = (experimentalWorkspace as { register?: unknown }).register;
  return typeof register === "function" ? (register as RegisterAdapter) : undefined;
}
