import { isAbsolute } from "node:path";
import { commonDirOf, roleOf } from "./identity.ts";
import { parseAgentVerdict, type ParsedAgentVerdict } from "./verdict.ts";

export type WaveAgent = "applier" | "verifier";

export interface WaveChildLaunch {
  worktree: string;
  agent: WaveAgent;
  prompt: string;
}

export interface WaveChildReported {
  outcome: "reported";
  worktree: string;
  agent: WaveAgent;
  sessionID: string;
  verdict: ParsedAgentVerdict;
  raw: string;
}

export interface WaveChildBlocked {
  outcome: "blocked";
  worktree: string;
  agent: WaveAgent;
  sessionID?: string;
  reason: string;
}

export type WaveChildResult = WaveChildReported | WaveChildBlocked;

export interface PinnedSession {
  id: string;
  directory: string;
}

export interface SessionTransport {
  create(request: { directory: string; title: string; parentSessionID: string }): Promise<PinnedSession>;
  prompt(request: { sessionID: string; directory: string; hostAgent: string; prompt: string }): Promise<string>;
  abort(request: { sessionID: string; directory: string }): Promise<void>;
}

export interface WaveRequest {
  launches: readonly WaveChildLaunch[];
  transport: SessionTransport;
  projectDirectory: string;
  parentSessionID: string;
  timeoutMs: number;
}

export async function runWave(request: WaveRequest): Promise<WaveChildResult[]> {
  const pinned = await pinEveryChildSession(request);
  return Promise.all(pinned.map((child) => collectChildReport(child, request)));
}

type PinnedChild =
  | { state: "pinned"; launch: WaveChildLaunch; sessionID: string }
  | { state: "unpinnable"; launch: WaveChildLaunch; reason: string };

function pinEveryChildSession(request: WaveRequest): Promise<PinnedChild[]> {
  const projectCommonDir = commonDirOf(request.projectDirectory);
  return Promise.all(request.launches.map((launch) => pinChildSession(launch, projectCommonDir, request)));
}

const HOST_AGENT: Record<WaveAgent, string> = {
  applier: "oso-applier",
  verifier: "oso-verifier",
};

async function pinChildSession(
  launch: WaveChildLaunch,
  projectCommonDir: string,
  request: WaveRequest,
): Promise<PinnedChild> {
  const rejection = worktreeRejection(launch.worktree, projectCommonDir);
  if (rejection !== undefined) {
    return { state: "unpinnable", launch, reason: rejection };
  }
  try {
    const session = await withinBound(
      () => request.transport.create({
        directory: launch.worktree,
        title: `${HOST_AGENT[launch.agent]} in ${launch.worktree}`,
        parentSessionID: request.parentSessionID,
      }),
      request.timeoutMs,
    );
    if (session.directory !== launch.worktree) {
      return {
        state: "unpinnable",
        launch,
        reason: `the host pinned the child session to ${session.directory}, not to ${launch.worktree}`,
      };
    }
    return { state: "pinned", launch, sessionID: session.id };
  } catch (error) {
    return { state: "unpinnable", launch, reason: `the child session could not be created: ${messageOf(error)}` };
  }
}

function worktreeRejection(worktree: string, projectCommonDir: string): string | undefined {
  if (!isAbsolute(worktree)) {
    return `${worktree} is not an absolute path`;
  }
  const role = roleOf(worktree);
  if (role !== "child") {
    return `${worktree} is not a git worktree, it is ${role}`;
  }
  const worktreeCommonDir = commonDirOf(worktree);
  if (worktreeCommonDir !== projectCommonDir) {
    return `${worktree} belongs to ${worktreeCommonDir}, not to this project at ${projectCommonDir}`;
  }
  return undefined;
}

async function collectChildReport(child: PinnedChild, request: WaveRequest): Promise<WaveChildResult> {
  if (child.state === "unpinnable") {
    return {
      outcome: "blocked",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      reason: child.reason,
    };
  }
  try {
    const raw = await withinBound(
      () => request.transport.prompt({
        sessionID: child.sessionID,
        directory: child.launch.worktree,
        hostAgent: HOST_AGENT[child.launch.agent],
        prompt: child.launch.prompt,
      }),
      request.timeoutMs,
    );
    return {
      outcome: "reported",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      verdict: parseAgentVerdict(raw),
      raw,
    };
  } catch (error) {
    const unstopped = await stopChild(child.sessionID, child.launch.worktree, request.transport);
    const failure = `the child turn did not complete: ${messageOf(error)}`;
    return {
      outcome: "blocked",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      reason: unstopped === undefined ? failure : `${failure}; ${unstopped}`,
    };
  }
}

const ABORT_BOUND_MS = 10_000;

async function stopChild(
  sessionID: string,
  directory: string,
  transport: SessionTransport,
): Promise<string | undefined> {
  try {
    await withinBound(() => transport.abort({ sessionID, directory }), ABORT_BOUND_MS);
    return undefined;
  } catch (error) {
    return `the child session was left running: ${messageOf(error)}`;
  }
}

interface HostCallResult<T> {
  data?: T;
  error?: unknown;
}

export interface HostSessionApi {
  create(options: {
    query: { directory: string };
    body: { title: string; parentID?: string };
  }): Promise<HostCallResult<PinnedSession>>;
  prompt(options: {
    path: { id: string };
    query?: { directory: string };
    body: { agent?: string; parts: Array<{ type: "text"; text: string }> };
  }): Promise<HostCallResult<{ parts: unknown }>>;
  abort(options: {
    path: { id: string };
    query: { directory: string };
  }): Promise<HostCallResult<unknown>>;
}

export function pinnedSessionTransport(session: HostSessionApi): SessionTransport {
  return {
    create: ({ directory, title, parentSessionID }) => unwrap(session.create({
      query: { directory },
      body: parentSessionID === "" ? { title } : { title, parentID: parentSessionID },
    })),
    prompt: async ({ sessionID, directory, hostAgent, prompt }) => finalMessageText(await unwrap(session.prompt({
      path: { id: sessionID },
      query: { directory },
      body: { agent: hostAgent, parts: [{ type: "text", text: prompt }] },
    }))),
    abort: async ({ sessionID, directory }) => {
      await unwrap(session.abort({ path: { id: sessionID }, query: { directory } }));
    },
  };
}

export async function unwrap<T>(call: Promise<HostCallResult<T>>): Promise<T> {
  const result = await call;
  if (result.data === undefined) {
    throw new Error(messageOf(result.error));
  }
  return result.data;
}

function finalMessageText(reply: { parts: unknown }): string {
  if (!Array.isArray(reply.parts)) {
    throw new Error("the host returned a reply with no message parts");
  }
  return reply.parts.filter(isTextPart).map((part) => part.text).join("\n");
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  const record = part as { type?: unknown; text?: unknown } | null;
  return typeof record === "object"
    && record !== null
    && record.type === "text"
    && typeof record.text === "string";
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error !== "") {
    return error;
  }
  const record = error as { message?: unknown; name?: unknown; data?: { message?: unknown } } | null | undefined;
  return nonEmptyText(record?.message)
    ?? nonEmptyText(record?.data?.message)
    ?? nonEmptyText(record?.name)
    ?? `an unnamed failure: ${JSON.stringify(error)}`;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function withinBound<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the ${timeoutMs}ms bound expired`)), timeoutMs);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
