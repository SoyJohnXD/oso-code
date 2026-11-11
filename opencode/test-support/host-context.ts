import type { Plugin } from "@opencode/plugin";
import type { FakeChildSessions } from "./child-sessions.ts";
import type { OsoTool, OsoToolContext } from "../plugin/oso/tool.ts";

type Callback = (payload: never) => unknown;

type EventStep = { event: unknown } | { error: Error };

export interface FakeHostContext {
  context: Plugin.Context;
  hook: (surface: "tool" | "shell" | "session", name: string) => (payload: unknown) => Promise<void>;
  sessionLookups: () => readonly string[];
  prompts: () => readonly { sessionID: string; text: string }[];
  emit: (event: unknown) => void;
  failEvents: (error: Error) => void;
  eventSubscription: () => AbortSignal | undefined;
  tool: (name: string) => OsoTool;
  callTool: (name: string, sessionID: string, input: unknown, messageID?: string) => ReturnType<OsoTool["execute"]>;
  assertions: () => readonly unknown[];
}

export interface FakeHostOptions {
  directory: string;
  sessionDirectories?: Readonly<Record<string, string>>;
  parentSessions?: Readonly<Record<string, string>>;
  defaultSessionDirectory?: string;
  refuseAssertions?: Error;
  children?: FakeChildSessions;
  operatorTurns?: Readonly<Record<string, string>>;
}

function transcriptOf(operatorTurns: Readonly<Record<string, string>>): readonly { id: string; type: string }[] {
  return Object.entries(operatorTurns).flatMap(([assistant, operator], index, turns) => [
    ...(turns[index - 1]?.[1] === operator ? [] : [{ id: operator, type: "user" }]),
    { id: assistant, type: "assistant" },
  ]);
}

export function fakeHostContext({
  directory,
  sessionDirectories = {},
  parentSessions = {},
  defaultSessionDirectory,
  refuseAssertions,
  children,
  operatorTurns = {},
}: FakeHostOptions): FakeHostContext {
  const hooks = new Map<string, Callback>();
  const lookups: string[] = [];
  const prompted: { sessionID: string; text: string }[] = [];
  const steps: EventStep[] = [];
  const tools = new Map<string, OsoTool>();
  const asserted: unknown[] = [];
  let subscription: AbortSignal | undefined;
  let wake: () => void = () => {};
  const push = (step: EventStep): void => {
    steps.push(step);
    wake();
  };
  const registerUnder = (surface: string) => async (name: string, callback: Callback) => {
    hooks.set(`${surface}.${name}`, callback);
    return { dispose: async () => {} };
  };
  const nextStep = async (): Promise<IteratorResult<unknown>> => {
    while (steps.length === 0 && subscription?.aborted !== true) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    const step = steps.shift();
    if (step === undefined) {
      return { done: true, value: undefined };
    }
    if ("error" in step) {
      throw step.error;
    }
    return { done: false, value: step.event };
  };
  const context = {
    location: { directory },
    tool: {
      hook: registerUnder("tool"),
      transform: async (callback: (editor: { add: (tool: OsoTool) => void }) => void) => {
        callback({ add: (tool) => tools.set(tool.name, tool) });
        return { dispose: async () => {} };
      },
    },
    permission: {
      assert: async (input: unknown) => {
        asserted.push(input);
        if (refuseAssertions !== undefined) {
          throw refuseAssertions;
        }
      },
    },
    shell: { hook: registerUnder("shell") },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => {
        subscription = options?.signal;
        subscription?.addEventListener("abort", () => wake());
        return { [Symbol.asyncIterator]: () => ({ next: nextStep }) };
      },
    },
    session: {
      ...children?.api,
      hook: registerUnder("session"),
      prompt: async (input: { sessionID: string; text: string }) => {
        if (children?.owns(input.sessionID) === true) {
          return children.api.prompt(input);
        }
        prompted.push(input);
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        if (children?.owns(sessionID) === true) {
          return children.api.get({ sessionID });
        }
        lookups.push(sessionID);
        const known = sessionDirectories[sessionID] ?? defaultSessionDirectory;
        if (known === undefined) {
          throw new Error(`no session record for ${sessionID}`);
        }
        return { id: sessionID, parentID: parentSessions[sessionID], location: { directory: known } };
      },
      context: async ({ sessionID }: { sessionID: string }) => {
        if (children?.owns(sessionID) === true) {
          return children.api.context({ sessionID });
        }
        return transcriptOf(operatorTurns);
      },
    },
  } as unknown as Plugin.Context;
  const registeredTool = (name: string): OsoTool => {
    const tool = tools.get(name);
    if (tool === undefined) {
      throw new Error(`the plugin registered no tool named ${name}`);
    }
    return tool;
  };
  return {
    context,
    hook: (surface, name) => {
      const callback = hooks.get(`${surface}.${name}`);
      if (callback === undefined) {
        throw new Error(`the plugin registered no ${surface} hook named ${name}`);
      }
      return async (payload) => {
        await (callback as (payload: unknown) => unknown)(payload);
      };
    },
    sessionLookups: () => lookups,
    prompts: () => prompted,
    emit: (event) => push({ event }),
    failEvents: (error) => push({ error }),
    eventSubscription: () => subscription,
    tool: registeredTool,
    callTool: (name, sessionID, input, messageID = "msg-1") => {
      const call = {
        sessionID,
        agent: "build",
        messageID,
        id: "call-1",
        signal: new AbortController().signal,
        progress: async () => {},
      } as unknown as OsoToolContext;
      return registeredTool(name).execute(input, call);
    },
    assertions: () => asserted,
  };
}
