export type BackgroundTask = Readonly<{
  id: string;
  type: string;
  status: string;
  description: string;
  agentType: string;
}>;

export type BackgroundTasks =
  | Readonly<{ kind: "array"; tasks: readonly BackgroundTask[] }>
  | Readonly<{ kind: "object"; active: readonly string[]; completed: readonly string[] }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unrecognized" }>;

export const NO_BACKGROUND_TASKS: BackgroundTasks = { kind: "absent" };

const UNRECOGNIZED: BackgroundTasks = { kind: "unrecognized" };

export function backgroundTasksIn(document: unknown): BackgroundTasks {
  if (!isRecord(document) || !("background_tasks" in document)) return NO_BACKGROUND_TASKS;
  const named = document["background_tasks"];
  if (Array.isArray(named)) return taskArray(named);
  if (isRecord(named)) return activeAndCompleted(named);
  return UNRECOGNIZED;
}

function taskArray(entries: readonly unknown[]): BackgroundTasks {
  const tasks = entries.flatMap((entry) => backgroundTask(entry) ?? []);
  if (tasks.length !== entries.length) return UNRECOGNIZED;
  return { kind: "array", tasks };
}

function backgroundTask(entry: unknown): BackgroundTask | undefined {
  if (!isRecord(entry) || typeof entry["id"] !== "string") return undefined;
  return {
    id: entry["id"],
    type: textOf(entry["type"]),
    status: textOf(entry["status"]),
    description: textOf(entry["description"]),
    agentType: textOf(entry["agent_type"]),
  };
}

function activeAndCompleted(named: Readonly<Record<string, unknown>>): BackgroundTasks {
  const active = named["active"];
  const completed = named["completed"] ?? [];
  if (!isIdList(active) || !isIdList(completed)) return UNRECOGNIZED;
  return { kind: "object", active, completed };
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}
