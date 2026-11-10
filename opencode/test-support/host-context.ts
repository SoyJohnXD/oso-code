import type { Plugin } from "@opencode/plugin";

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
}

export interface FakeHostOptions {
  directory: string;
  sessionDirectories?: Readonly<Record<string, string>>;
  parentSessions?: Readonly<Record<string, string>>;
}

export function fakeHostContext({ directory, sessionDirectories = {}, parentSessions = {} }: FakeHostOptions): FakeHostContext {
  const hooks = new Map<string, Callback>();
  const lookups: string[] = [];
  const prompted: { sessionID: string; text: string }[] = [];
  const steps: EventStep[] = [];
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
    tool: { hook: registerUnder("tool") },
    shell: { hook: registerUnder("shell") },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => {
        subscription = options?.signal;
        subscription?.addEventListener("abort", () => wake());
        return { [Symbol.asyncIterator]: () => ({ next: nextStep }) };
      },
    },
    session: {
      hook: registerUnder("session"),
      prompt: async (input: { sessionID: string; text: string }) => {
        prompted.push(input);
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        lookups.push(sessionID);
        const known = sessionDirectories[sessionID];
        if (known === undefined) {
          throw new Error(`no session record for ${sessionID}`);
        }
        return { id: sessionID, parentID: parentSessions[sessionID], location: { directory: known } };
      },
    },
  } as unknown as Plugin.Context;
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
  };
}
