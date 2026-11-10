import type { Plugin } from "@opencode/plugin";

type ChildSessionApi = Pick<Plugin.Context["session"], "create" | "move" | "wait" | "get" | "prompt" | "context" | "interrupt">;

export interface FakeChildSessions {
  api: ChildSessionApi;
  created: Array<{ directory: string; parentID: string | undefined; agent: string | undefined; title: string | undefined }>;
  moved: string[];
  turns: Array<{ directory: string; text: string }>;
  interrupted: string[];
  owns: (sessionID: string) => boolean;
}

export interface ChildOutcome {
  outcome: "succeeded" | "failed" | "interrupted";
  reply?: string;
  error?: { message: string };
}

export function fakeChildSessions(
  answer: (directory: string) => ChildOutcome,
  pinnedDirectory: (requested: string) => string = (requested) => requested,
): FakeChildSessions {
  const created: FakeChildSessions["created"] = [];
  const moved: string[] = [];
  const turns: FakeChildSessions["turns"] = [];
  const interrupted: string[] = [];
  const directories = new Map<string, string>();
  const prompts = new Map<string, string>();
  const api = {
    create: async (input: { location?: { directory: string } | null; parentID?: string | null; agent?: string | null; title?: string | null }) => {
      const id = `ses-child-${created.length + 1}`;
      const directory = input.location?.directory ?? "";
      created.push({ directory, parentID: input.parentID ?? undefined, agent: input.agent ?? undefined, title: input.title ?? undefined });
      directories.set(id, "the parent's location");
      return { id };
    },
    move: async ({ sessionID, directory }: { sessionID: string; directory: string }) => {
      moved.push(directory);
      directories.set(sessionID, pinnedDirectory(directory));
    },
    wait: async () => {},
    get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: directories.get(sessionID) } }),
    prompt: async ({ sessionID, text }: { sessionID: string; text: string }) => {
      prompts.set(sessionID, text);
      turns.push({ directory: directories.get(sessionID) ?? "", text });
    },
    context: async ({ sessionID }: { sessionID: string }) => {
      const result = answer(directories.get(sessionID) ?? "");
      const reply = result.reply === undefined ? [] : [{ type: "assistant", content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: result.reply }] }];
      return [{ type: "user", text: prompts.get(sessionID) ?? "" }, ...reply, { type: "idle", outcome: result.outcome, error: result.error }];
    },
    interrupt: async ({ sessionID }: { sessionID: string }) => {
      interrupted.push(sessionID);
      return { interrupted: true };
    },
  } as unknown as ChildSessionApi;
  return { api, created, moved, turns, interrupted, owns: (sessionID) => directories.has(sessionID) };
}
