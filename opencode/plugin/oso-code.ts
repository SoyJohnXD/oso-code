import type { Plugin } from "@opencode/plugin";
import { planApprovalTool, planCancelTool } from "./oso/approval.ts";
import {
  continueUnattendedRun,
  releaseHeldRuns,
  trackSessionEvent,
  type SessionEvent,
} from "./oso/continuation-rail.ts";
import {
  assertGateRoutesCompile,
  firstToolGateRefusal,
  routeForGate,
  routes,
  runAdvisoryGate,
  type LifecycleGateInput,
} from "./oso/gates.ts";
import { commonDirOf, publishIdentity } from "./oso/identity.ts";
import { stateBinPath } from "./oso/installed-tree.ts";
import {
  buildStaleAdvice,
  dropSystemAdvice,
  listStale,
  queuedSystemAdvice,
  queueSystemAdvice,
  sweepStale,
  touchMarker,
  type PendingSystemAdvice,
} from "./oso/lifecycle.ts";
import type { ToolHost } from "./oso/tool.ts";
import { recordTrace } from "./oso/trace.ts";
import { captureSubagentVerdict } from "./oso/verdict-capture.ts";
import { waveTool } from "./oso/wave-tool.ts";
import { messageOf } from "./oso/wave.ts";

const advisedSessions = new Set<string>();

const busSessions = new Set<string>();

const pendingAdvice: PendingSystemAdvice = new Map();

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

interface KnownSession {
  directory: string;
  primary: boolean;
}

async function sessionOf(
  ctx: Plugin.Context,
  sessions: Map<string, KnownSession>,
  sessionID: HostSessionID,
): Promise<KnownSession> {
  const known = sessions.get(sessionID);
  if (known !== undefined) {
    return known;
  }
  try {
    const { location, parentID } = await ctx.session.get({ sessionID });
    const session = { directory: location.directory, primary: parentID === undefined };
    sessions.set(sessionID, session);
    return session;
  } catch (err) {
    recordTrace({ origin: "session.directory", detail: messageOf(err), severity: "advisory", sessionID });
    return { directory: ctx.location.directory, primary: true };
  }
}

function systemPartOf(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

function sweepStaleWorktrees(directory: string): void {
  try {
    sweepStale(commonDirOf(directory));
  } catch (err) {
    recordTrace({ origin: "lifecycle.sweep", detail: messageOf(err), severity: "advisory" });
  }
}

function endSessions(directory: string): void {
  for (const sessionID of busSessions) {
    runLifecycleGate("teardown", { sessionID, directory, moment: "end" });
  }
  busSessions.clear();
  releaseHeldRuns();
  sweepStaleWorktrees(directory);
}

interface HostEvent {
  type: string;
  data?: { sessionID?: string; parentID?: string };
}

function sessionEventOf(event: HostEvent): SessionEvent {
  const { sessionID, parentID } = event.data ?? {};
  if (event.type === "session.created") {
    return { type: event.type, properties: { info: { id: sessionID, parentID } } };
  }
  return { type: event.type, properties: { sessionID } };
}

function followSessionEvents(ctx: Plugin.Context): () => void {
  const closing = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: closing.signal })) {
        const hostEvent = event as HostEvent;
        const sessionID = hostEvent.data?.sessionID ?? "";
        if (sessionID !== "") {
          busSessions.add(sessionID);
        }
        trackSessionEvent(sessionEventOf(hostEvent));
      }
    } catch (err) {
      if (!closing.signal.aborted) {
        recordTrace({ origin: "events.subscribe", detail: messageOf(err), severity: "advisory" });
      }
    }
  })();
  return () => closing.abort();
}

async function continueOnIdle(
  ctx: Plugin.Context,
  sessions: Map<string, KnownSession>,
  sessionID: HostSessionID,
): Promise<void> {
  const { directory, primary } = await sessionOf(ctx, sessions, sessionID);
  markSessionLive(sessionID, directory);
  dropSystemAdvice(pendingAdvice, sessionID);
  trackSessionEvent({ type: "session.idle", properties: { sessionID } });
  if (primary) {
    await continueUnattendedRun({
      sessionID,
      directory,
      admitTurn: async (order) => {
        await ctx.session.prompt({ sessionID, text: order });
      },
    });
  }
}

async function setup(ctx: Plugin.Context): Promise<() => void> {
  sweepStaleWorktrees(ctx.location.directory);
  checkGateRoutes();
  const sessions = new Map<string, KnownSession>();
  const host: ToolHost = {
    session: ctx.session,
    permission: ctx.permission,
    directoryOf: async (sessionID) => (await sessionOf(ctx, sessions, sessionID)).directory,
  };
  await ctx.tool.transform((editor) => {
    editor.add(waveTool(host));
    editor.add(planApprovalTool(host));
    editor.add(planCancelTool(host));
  });
  await ctx.tool.hook("execute.before", async (call) => {
    const { directory } = await sessionOf(ctx, sessions, call.sessionID);
    const refusal = firstToolGateRefusal(
      { tool: call.tool, sessionID: call.sessionID, callID: call.id, cwd: directory },
      { args: (call.input ?? {}) as Record<string, unknown> },
    );
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
  });
  await ctx.tool.hook("execute.after", async (call) => {
    captureSubagentVerdict(call, (await sessionOf(ctx, sessions, call.sessionID)).directory);
  });
  await ctx.shell.hook("create.before", (creation) => {
    try {
      Object.assign(creation.env, identityEnvFor(creation.cwd));
    } catch (err) {
      recordTrace({ origin: "shell.env", detail: messageOf(err), severity: "advisory" });
    }
  });
  await ctx.session.hook("experimental.idle", async ({ sessionID }) => {
    try {
      await continueOnIdle(ctx, sessions, sessionID);
    } catch (err) {
      recordTrace({ origin: "session.idle", detail: messageOf(err), severity: "advisory", sessionID });
    }
  });
  await ctx.session.hook("context", async ({ sessionID, system }) => {
    try {
      const { directory, primary } = await sessionOf(ctx, sessions, sessionID);
      if (!primary) {
        return;
      }
      armSessionAdvice(sessionID, directory);
      system.push(...queuedSystemAdvice(pendingAdvice, sessionID).map(systemPartOf));
    } catch (err) {
      recordTrace({ origin: "system.transform", detail: messageOf(err), severity: "advisory", sessionID });
    }
  });
  await ctx.session.hook("compaction", async ({ sessionID, system }) => {
    const { directory } = await sessionOf(ctx, sessions, sessionID);
    const anchor = runLifecycleGate("reanchor", { sessionID, directory, moment: "compact" });
    if (anchor !== "") {
      system.push(systemPartOf(anchor));
    }
  });
  const closeEvents = followSessionEvents(ctx);
  return () => {
    closeEvents();
    endSessions(ctx.location.directory);
  };
}

export default { id: "oso-code", setup } satisfies Plugin.Plugin;
