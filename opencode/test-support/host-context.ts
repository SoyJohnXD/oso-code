import type { Plugin } from "@opencode/plugin";

type Callback = (payload: never) => unknown;

export interface FakeHostContext {
  context: Plugin.Context;
  hook: (surface: "tool" | "shell", name: string) => (payload: unknown) => Promise<void>;
  sessionLookups: () => readonly string[];
}

export interface FakeHostOptions {
  directory: string;
  sessionDirectories?: Readonly<Record<string, string>>;
}

export function fakeHostContext({ directory, sessionDirectories = {} }: FakeHostOptions): FakeHostContext {
  const hooks = new Map<string, Callback>();
  const lookups: string[] = [];
  const registerUnder = (surface: string) => async (name: string, callback: Callback) => {
    hooks.set(`${surface}.${name}`, callback);
    return { dispose: async () => {} };
  };
  const context = {
    location: { directory },
    tool: { hook: registerUnder("tool") },
    shell: { hook: registerUnder("shell") },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        lookups.push(sessionID);
        const known = sessionDirectories[sessionID];
        if (known === undefined) {
          throw new Error(`no session record for ${sessionID}`);
        }
        return { id: sessionID, location: { directory: known } };
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
  };
}
