import type { Plugin } from "@opencode/plugin";
import { planApprovalTool, planCancelTool, PLAN_APPROVAL_TOOL_ID, PLAN_CANCEL_TOOL_ID } from "./oso/approval.ts";
import { continueUnattendedRun, releaseHeldRuns, trackSessionEvent } from "./oso/continuation-rail.ts";
import {
  assertGateRoutesCompile,
  firstToolGateRefusal,
  routeForGate,
  routes,
  runAdvisoryGate,
  type LifecycleGateInput,
  type ToolExecuteInput,
  type ToolExecuteOutput,
} from "./oso/gates.ts";
import { commonDirOf, publishIdentity } from "./oso/identity.ts";
import { stateBinPath } from "./oso/installed-tree.ts";
import {
  buildStaleAdvice,
  deliverCompactionContext,
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
import { captureSubagentVerdict, captureTaskVerdict } from "./oso/verdict-capture.ts";
import { waveTool } from "./oso/wave-tool.ts";
import { messageOf, type HostSessionApi } from "./oso/wave.ts";

interface PluginClient {
  session?: HostSessionApi;
}

interface PluginInput {
  client?: PluginClient;
  directory?: string;
}

interface HookEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface OsoHooks {
  "tool.execute.before": (input?: unknown, output?: unknown) => Promise<void>;
  "tool.execute.after": (input?: unknown, output?: unknown) => Promise<void>;
  "shell.env": (input?: unknown, output?: unknown) => Promise<unknown>;
  event: (input?: { event?: HookEvent }) => Promise<void>;
  "experimental.chat.system.transform": (input?: unknown, output?: unknown) => Promise<void>;
  "experimental.session.compacting": (input?: unknown, output?: unknown) => Promise<void>;
  tool: Record<string, PluginTool>;
  dispose: () => Promise<void>;
}

const advisedSessions = new Set<string>();

const busSessions = new Set<string>();

const pendingAdvice: PendingSystemAdvice = new Map();

const reanchoredByCompaction = new Set<string>();

let orphanAdviceValue: string | undefined;

function orphanWorktreeAdviceOnce(directory: string): string {
  if (orphanAdviceValue === undefined) {
    try {
      orphanAdviceValue = buildStaleAdvice(listStale(commonDirOf(directory)));
    } catch (err) {
      orphanAdviceValue = "";
      recordTrace({ origin: "lifecycle.orphan-advice", detail: messageOf(err), severity: "advisory" });
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
    });
    return "";
  }
  return outcome.kind === "context" ? outcome.text : "";
}

function armSessionAdvice(sessionID: string, directory: string): void {
  if (sessionID === "" || advisedSessions.has(sessionID)) {
    return;
  }
  advisedSessions.add(sessionID);
  queueSystemAdvice(pendingAdvice, sessionID, orphanWorktreeAdviceOnce(directory));
  queueSystemAdvice(
    pendingAdvice,
    sessionID,
    runLifecycleGate("stale", { sessionID, directory, moment: "startup" }),
  );
  queueSystemAdvice(
    pendingAdvice,
    sessionID,
    runLifecycleGate("version", { sessionID, directory, moment: "startup" }),
  );
}

function markSessionLive(sessionID: string, directory: string): void {
  if (sessionID === "") {
    return;
  }
  try {
    touchMarker(commonDirOf(directory), sessionID, {
      pid: process.pid,
      worktrees: [],
    });
  } catch (err) {
    recordTrace({ origin: "session.idle", detail: messageOf(err), severity: "advisory", sessionID });
  }
}

function checkGateRoutes(): void {
  try {
    assertGateRoutesCompile(routes);
  } catch (err) {
    recordTrace({ origin: "gate-routes", detail: messageOf(err), severity: "enforcement" });
  }
}

function identityEnvFor(cwd: string): Record<string, string> {
  return { ...publishIdentity(cwd), OSO_STATE_BIN: stateBinPath() };
}

type HostSessionID = Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];

async function sessionDirectoryOf(
  ctx: Plugin.Context,
  directories: Map<string, string>,
  sessionID: HostSessionID,
): Promise<string> {
  const known = directories.get(sessionID);
  if (known !== undefined) {
    return known;
  }
  try {
    const { location } = await ctx.session.get({ sessionID });
    directories.set(sessionID, location.directory);
    return location.directory;
  } catch (err) {
    recordTrace({ origin: "session.directory", detail: messageOf(err), severity: "advisory", sessionID });
    return ctx.location.directory;
  }
}

async function setup(ctx: Plugin.Context): Promise<void> {
  checkGateRoutes();
  const directories = new Map<string, string>();
  await ctx.tool.hook("execute.before", async (call) => {
    const cwd = await sessionDirectoryOf(ctx, directories, call.sessionID);
    const refusal = firstToolGateRefusal(
      { tool: call.tool, sessionID: call.sessionID, callID: call.id, cwd },
      { args: (call.input ?? {}) as Record<string, unknown> },
    );
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
  });
  await ctx.tool.hook("execute.after", async (call) => {
    captureSubagentVerdict(call, await sessionDirectoryOf(ctx, directories, call.sessionID));
  });
  await ctx.shell.hook("create.before", (creation) => {
    try {
      Object.assign(creation.env, identityEnvFor(creation.cwd));
    } catch (err) {
      recordTrace({ origin: "shell.env", detail: messageOf(err), severity: "advisory" });
    }
  });
}

export default { id: "oso-code", setup } satisfies Plugin.Plugin;

export const osoCode = async (
  pluginInput?: PluginInput,
): Promise<OsoHooks> => {
  const client = pluginInput?.client;
  const directory = pluginInput?.directory ?? process.cwd();
  try {
    sweepStale(commonDirOf(directory));
  } catch (err) {
    recordTrace({ origin: "lifecycle.sweep", detail: messageOf(err), severity: "advisory" });
  }
  checkGateRoutes();

  return {
    "tool.execute.before": async (input?: unknown, output?: unknown) => {
      const refusal = firstToolGateRefusal(input as ToolExecuteInput, (output ?? {}) as ToolExecuteOutput);
      if (refusal !== undefined) {
        throw new Error(refusal);
      }
    },
    "tool.execute.after": async (input?: unknown, output?: unknown) => {
      captureTaskVerdict(input, output, directory);
    },
    "shell.env": async (input?: unknown, output?: unknown) => {
      const sessionID = (input as { sessionID?: string } | undefined)?.sessionID;
      try {
        const cwd = (input as { cwd?: string } | undefined)?.cwd;
        const target = (output ?? {}) as { env?: Record<string, string> };
        target.env = { ...(target.env ?? {}), ...identityEnvFor(cwd ?? process.cwd()) };
        return target;
      } catch (err) {
        recordTrace({ origin: "shell.env", detail: messageOf(err), severity: "advisory", sessionID });
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
      trackSessionEvent(event);
      if (event.type === "session.created") {
        return;
      }
      if (event.type === "session.idle") {
        markSessionLive(sessionID, directory);
        dropSystemAdvice(pendingAdvice, sessionID);
        continueUnattendedRun({ sessionID, directory, session: client?.session });
        return;
      }
      if (event.type === "session.compacted") {
        if (reanchoredByCompaction.delete(sessionID)) {
          return;
        }
        queueSystemAdvice(
          pendingAdvice,
          sessionID,
          runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" }),
        );
      }
    },
    "experimental.chat.system.transform": async (input?: unknown, output?: unknown) => {
      const sessionID = sessionIdOf(input);
      try {
        armSessionAdvice(sessionID, directory);
        const delivery = deliverSystemAdvice(output, pendingAdvice, sessionID);
        if (delivery.kind === "undeliverable") {
          recordTrace({
            origin: "system.transform",
            detail: "the host handed no system prompt array to append the advisory to",
            severity: "advisory",
            sessionID,
          });
        }
      } catch (err) {
        recordTrace({ origin: "system.transform", detail: messageOf(err), severity: "advisory", sessionID });
      }
    },
    "experimental.session.compacting": async (input?: unknown, output?: unknown) => {
      const sessionID = sessionIdOf(input);
      if (sessionID === "") {
        return;
      }
      const anchor = runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" });
      const delivery = deliverCompactionContext(output, anchor);
      if (delivery.kind === "delivered") {
        reanchoredByCompaction.add(sessionID);
      }
      if (delivery.kind === "undeliverable") {
        recordTrace({
          origin: "session.compacting",
          detail: "the host handed no compaction context array to append the re-anchor to",
          severity: "advisory",
          sessionID,
        });
      }
    },
    tool: {
      oso_wave: waveTool(client?.session),
      [PLAN_APPROVAL_TOOL_ID]: planApprovalTool(),
      [PLAN_CANCEL_TOOL_ID]: planCancelTool(),
    },
    dispose: async () => {
      for (const sessionID of busSessions) {
        runLifecycleGate("teardown", { sessionID, directory, moment: "end" });
      }
      busSessions.clear();
      releaseHeldRuns();
    },
  };
};
