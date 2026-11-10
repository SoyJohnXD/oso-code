import { isAbsolute } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { APPLIER_PROOF_HEADER, parseAgentVerdict, type ParsedAgentVerdict, VERIFIER_AGENT } from "@oso-code/core";
import { commonDirOf, roleOf } from "./identity.ts";
import { captureOpenCodeVerifierReport } from "./verdict-capture.ts";

export type WaveAgent = "applier" | "verifier";

export interface WaveChildLaunch {
  worktree: string;
  agent: WaveAgent;
  prompt: string;
  applierProof?: string;
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
  create(request: { directory: string; title: string; parentSessionID: string; hostAgent: string }): Promise<PinnedSession>;
  prompt(request: { sessionID: string; prompt: string }): Promise<string>;
  interrupt(request: { sessionID: string }): Promise<void>;
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
  verifier: VERIFIER_AGENT,
};

async function pinChildSession(
  launch: WaveChildLaunch,
  projectCommonDir: string,
  request: WaveRequest,
): Promise<PinnedChild> {
  const rejection = proofRejection(launch) ?? worktreeRejection(launch.worktree, projectCommonDir);
  if (rejection !== undefined) {
    return { state: "unpinnable", launch, reason: rejection };
  }
  try {
    const session = await withinBound(
      () => request.transport.create({
        directory: launch.worktree,
        title: `${HOST_AGENT[launch.agent]} in ${launch.worktree}`,
        parentSessionID: request.parentSessionID,
        hostAgent: HOST_AGENT[launch.agent],
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

function proofRejection({ agent, applierProof }: WaveChildLaunch): string | undefined {
  if (agent === "verifier" || applierProof === undefined) {
    return undefined;
  }
  return "applier_proof reaches a verifier child only, and this child runs as an applier";
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
        prompt: promptOf(child.launch),
      }),
      request.timeoutMs,
    );
    if (child.launch.agent === "verifier") {
      captureOpenCodeVerifierReport({ directory: request.projectDirectory, model: null, report: raw });
    }
    return {
      outcome: "reported",
      worktree: child.launch.worktree,
      agent: child.launch.agent,
      sessionID: child.sessionID,
      verdict: parseAgentVerdict(raw),
      raw,
    };
  } catch (error) {
    const unstopped = await interruptChild(child.sessionID, request.transport);
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

function promptOf({ prompt, applierProof }: WaveChildLaunch): string {
  return applierProof === undefined ? prompt : `${prompt}\n\n${APPLIER_PROOF_HEADER}\n${applierProof}`;
}

const INTERRUPT_BOUND_MS = 10_000;

async function interruptChild(sessionID: string, transport: SessionTransport): Promise<string | undefined> {
  try {
    await withinBound(() => transport.interrupt({ sessionID }), INTERRUPT_BOUND_MS);
    return undefined;
  } catch (error) {
    return `the child session was left running: ${messageOf(error)}`;
  }
}

type HostSessions = Plugin.Context["session"];

type SessionMessages = Awaited<ReturnType<HostSessions["context"]>>;

type SessionMessage = SessionMessages[number];

function lastMessageOfType<Type extends SessionMessage["type"]>(
  messages: SessionMessages,
  type: Type,
): Extract<SessionMessage, { type: Type }> | undefined {
  return [...messages].reverse().find((message): message is Extract<SessionMessage, { type: Type }> => message.type === type);
}

export function pinnedSessionTransport(session: HostSessions): SessionTransport {
  return {
    create: async ({ directory, title, parentSessionID, hostAgent }) => {
      const { id } = await session.create({
        location: { directory },
        title,
        agent: hostAgent,
        parentID: parentSessionID === "" ? undefined : parentSessionID,
      });
      await session.move({ sessionID: id, directory });
      await session.wait({ sessionID: id });
      const pinned = await session.get({ sessionID: id });
      return { id, directory: pinned.location.directory };
    },
    prompt: async ({ sessionID, prompt }) => {
      await session.prompt({ sessionID, text: prompt });
      await session.wait({ sessionID });
      return finalReplyText(await session.context({ sessionID }));
    },
    interrupt: async ({ sessionID }) => {
      await session.interrupt({ sessionID });
    },
  };
}

function finalReplyText(messages: SessionMessages): string {
  const lastUser = [...messages].reverse().findIndex((message) => message.type === "user");
  const turn = lastUser === -1 ? messages : messages.slice(messages.length - lastUser);
  const end = lastMessageOfType(turn, "idle");
  if (end === undefined) {
    throw new Error("the host reported no end of turn for the child session");
  }
  if (end.outcome !== "succeeded") {
    throw new Error(`the child turn ended ${end.outcome}${end.error === undefined ? "" : `: ${messageOf(end.error)}`}`);
  }
  const reply = lastMessageOfType(turn, "assistant");
  if (reply === undefined) {
    throw new Error("the host returned no assistant reply for the child session");
  }
  return reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
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
