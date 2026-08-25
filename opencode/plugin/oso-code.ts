import { routes } from "../hooks/routes.ts";
import { planApprovalTool, planCancelTool, PLAN_APPROVAL_TOOL_ID, PLAN_CANCEL_TOOL_ID } from "./oso/approval.ts";
import { continueUnattendedRun, recordSessionLineage } from "./oso/continuation-rail.ts";
import {
  assertGateRoutesCompile,
  checkHarnessInstalled,
  matchesTool,
  resolveStateBin,
  routeForGate,
  runAdvisoryGate,
  runGate,
  type HarnessInstallStatus,
  type LifecycleGateInput,
  type ToolExecuteInput,
  type ToolExecuteOutput,
} from "./oso/gates.ts";
import { commonDirOf, publishIdentity } from "./oso/identity.ts";
import {
  buildStaleAdvice,
  deliverSystemAdvice,
  dropSystemAdvice,
  listStale,
  queueSystemAdvice,
  sweepStale,
  touchMarker,
  type PendingSystemAdvice,
} from "./oso/lifecycle.ts";
import type { PluginTool } from "./oso/tool.ts";
import { recordTrace } from "./oso/trace.ts";
import { waveTool } from "./oso/wave-tool.ts";
import { messageOf, type HostSessionApi } from "./oso/wave.ts";
import { registerWorkspaceAdapter } from "./oso/workspace.ts";

interface PluginClient {
  tui?: {
    showToast?: (message: string, options?: unknown) => unknown;
  };
  session?: HostSessionApi;
}

interface PluginInput {
  client?: PluginClient;
  experimental_workspace?: unknown;
  directory?: string;
}

interface HookEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface OsoHooks {
  "tool.execute.before": (input?: unknown, output?: unknown) => Promise<void>;
  "shell.env": (input?: unknown, output?: unknown) => Promise<unknown>;
  event: (input?: { event?: HookEvent }) => Promise<void>;
  "experimental.chat.system.transform": (input?: unknown, output?: unknown) => Promise<void>;
  "experimental.session.compacting": () => Promise<void>;
  tool: Record<string, PluginTool>;
  dispose: () => Promise<void>;
}

const advisedSessions = new Set<string>();

const busSessions = new Set<string>();

const pendingAdvice: PendingSystemAdvice = new Map();

let orphanAdviceValue: string | undefined;

function orphanWorktreeAdviceOnce(directory: string, client: PluginClient | undefined): string {
  if (orphanAdviceValue === undefined) {
    try {
      orphanAdviceValue = buildStaleAdvice(listStale(commonDirOf(directory)));
    } catch (err) {
      orphanAdviceValue = "";
      recordTrace({ origin: "lifecycle.orphan-advice", detail: messageOf(err), severity: "advisory", client });
    }
  }
  return orphanAdviceValue;
}

function sessionIdOf(value: unknown): string {
  const sessionID = (value as { sessionID?: unknown } | null | undefined)?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}

function runLifecycleGate(
  gate: string,
  input: LifecycleGateInput,
  client: PluginClient | undefined,
): string {
  const route = routeForGate(routes, gate);
  if (route === undefined) {
    return "";
  }
  const outcome = runAdvisoryGate(route, input);
  if (outcome.kind === "failed") {
    recordTrace({
      origin: `gate.${gate}`,
      detail: outcome.detail,
      severity: "advisory",
      sessionID: input.sessionID,
      client,
    });
    return "";
  }
  return outcome.kind === "context" ? outcome.text : "";
}

function armSessionAdvice(sessionID: string, directory: string, client: PluginClient | undefined): void {
  if (sessionID === "" || advisedSessions.has(sessionID)) {
    return;
  }
  advisedSessions.add(sessionID);
  queueSystemAdvice(pendingAdvice, sessionID, orphanWorktreeAdviceOnce(directory, client));
  queueSystemAdvice(
    pendingAdvice,
    sessionID,
    runLifecycleGate("stale", { sessionID, directory, moment: "startup" }, client),
  );
}

const HARNESS_NOT_INSTALLED_PREFIX = "oso-code: harness not installed correctly";

function harnessNotInstalledMessage(missing: readonly string[]): string {
  const detail = missing.length > 0 ? `; missing gate script(s): ${missing.join(", ")}` : "";
  return `${HARNESS_NOT_INSTALLED_PREFIX}${detail} — reinstall via bootstrap/install-opencode.sh`;
}

function harnessInstallStatus(client: PluginClient | undefined): HarnessInstallStatus {
  try {
    assertGateRoutesCompile(routes);
    return checkHarnessInstalled(routes);
  } catch (err) {
    recordTrace({ origin: "install-check", detail: messageOf(err), severity: "enforcement", client });
    return { installed: false, missing: [] };
  }
}

function markSessionLive(sessionID: string, directory: string, client: PluginClient | undefined): void {
  if (sessionID === "") {
    return;
  }
  try {
    touchMarker(commonDirOf(directory), sessionID, {
      pid: process.pid,
      worktrees: [],
    });
  } catch (err) {
    recordTrace({ origin: "session.idle", detail: messageOf(err), severity: "advisory", sessionID, client });
  }
}

export const osoCode = async (
  pluginInput?: PluginInput,
): Promise<OsoHooks> => {
  const client = pluginInput?.client;
  const directory = pluginInput?.directory ?? process.cwd();
  try {
    sweepStale(commonDirOf(directory));
  } catch (err) {
    recordTrace({ origin: "lifecycle.sweep", detail: messageOf(err), severity: "advisory", client });
  }
  registerWorkspaceAdapter({ experimentalWorkspace: pluginInput?.experimental_workspace, client });
  const installStatus = harnessInstallStatus(client);

  return {
    "tool.execute.before": async (input?: unknown, output?: unknown) => {
      const call = input as ToolExecuteInput;
      const result = (output ?? {}) as ToolExecuteOutput;
      for (const route of routes) {
        if (route.hook !== "tool.execute.before") {
          continue;
        }
        if (!installStatus.installed) {
          throw new Error(harnessNotInstalledMessage(installStatus.missing));
        }
        if (!matchesTool(route.matcher, call.tool)) {
          continue;
        }
        const verdict = runGate(route, call, result);
        if (verdict.kind !== "allow") {
          throw new Error(verdict.message);
        }
      }
    },
    "shell.env": async (input?: unknown, output?: unknown) => {
      const sessionID = (input as { sessionID?: string } | undefined)?.sessionID;
      try {
        const cwd = (input as { cwd?: string } | undefined)?.cwd;
        const identity = publishIdentity(cwd ?? process.cwd());
        const target = (output ?? {}) as { env?: Record<string, string> };
        target.env = {
          ...(target.env ?? {}),
          ...identity,
          OSO_STATE_BIN: resolveStateBin(),
        };
        return target;
      } catch (err) {
        recordTrace({ origin: "shell.env", detail: messageOf(err), severity: "advisory", sessionID, client });
        return output ?? {};
      }
    },
    event: async (input?: { event?: HookEvent }) => {
      const event = input?.event;
      if (event === undefined || typeof event.type !== "string") {
        return;
      }
      const sessionID = sessionIdOf(event.properties);
      if (sessionID !== "") {
        busSessions.add(sessionID);
      }
      if (event.type === "session.created") {
        recordSessionLineage(event.properties);
        return;
      }
      if (event.type === "session.idle") {
        markSessionLive(sessionID, directory, client);
        dropSystemAdvice(pendingAdvice, sessionID);
        continueUnattendedRun({ sessionID, directory, session: client?.session, client });
        return;
      }
      if (event.type === "session.compacted") {
        queueSystemAdvice(
          pendingAdvice,
          sessionID,
          runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" }, client),
        );
      }
    },
    "experimental.chat.system.transform": async (input?: unknown, output?: unknown) => {
      const sessionID = sessionIdOf(input);
      try {
        armSessionAdvice(sessionID, directory, client);
        const delivery = deliverSystemAdvice(output, pendingAdvice, sessionID);
        if (delivery.kind === "undeliverable") {
          recordTrace({
            origin: "system.transform",
            detail: "the host handed no system prompt array to append the advisory to",
            severity: "advisory",
            sessionID,
            client,
          });
        }
      } catch (err) {
        recordTrace({ origin: "system.transform", detail: messageOf(err), severity: "advisory", sessionID, client });
      }
    },
    "experimental.session.compacting": async () => {},
    tool: {
      oso_wave: waveTool(client?.session),
      [PLAN_APPROVAL_TOOL_ID]: planApprovalTool(),
      [PLAN_CANCEL_TOOL_ID]: planCancelTool(),
    },
    dispose: async () => {
      for (const sessionID of busSessions) {
        runLifecycleGate("teardown", { sessionID, directory, moment: "end" }, client);
      }
      busSessions.clear();
    },
  };
};
