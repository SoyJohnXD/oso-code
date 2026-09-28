import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import path from "node:path";

export const MODES = ["plan", "quick", "debug", "roadmap"] as const;
export type Mode = (typeof MODES)[number];

const GATE_PHRASES = [
  ["the session verify is not green", "commit"],
  ["plan mode is active but no slice is active", "edits"],
  ["an unattended run is in flight", "proddeploy"],
  ["this run is unattended and still in flight", "autocontinue"],
  ["is still marked as waiting on the delegation", "stale"],
  ["was left by another session", "stale"],
  ["is not in this release's", "unknown"],
  ["was compacted while a run was in flight", "reanchor"],
  ["is armed but its state file", "preflight"],
] as const;

export type GateName = (typeof GATE_PHRASES)[number][1] | "unclassified";

export type Denial = Readonly<{ gate: GateName; timestamp: string }>;

export type SessionRecord = {
  sessionId: string;
  mtimeMs: number;
  mode: Mode | null;
  turns: number;
  agentLaunches: number;
  osoStateCalls: number;
  denials: Denial[];
  stopNetTimestamps: string[];
};

export type TreeClassification = {
  sessions: SessionRecord[];
  skipped_lines: number;
  unreadable_files: number;
};

export type TranscriptScope = "main" | "subagent";

export type TranscriptFacts = Omit<SessionRecord, "sessionId" | "mtimeMs"> & { skippedLines: number };

type EventRecord = Readonly<Record<string, unknown>>;

const DENIAL_TEXT = /^(?:PreToolUse:\S+ hook error: )?oso-code:/;
const MODE_COMMAND = /<command-name>\/oso-code:(plan|quick|debug|roadmap)<\/command-name>/;
const AGENT_TOOLS = new Set(["Agent", "Task"]);

export function classifyTree(root: string): TreeClassification {
  const tree: TreeClassification = { sessions: [], skipped_lines: 0, unreadable_files: 0 };
  const sessionsById = new Map<string, SessionRecord>();

  const absorb = (file: string, sessionId: string, scope: TranscriptScope): void => {
    let text: string;
    let mtimeMs: number;
    try {
      text = readFileSync(file, "utf8");
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      tree.unreadable_files += 1;
      return;
    }
    const facts = classifyTranscript(text, scope);
    tree.skipped_lines += facts.skippedLines;
    let record = sessionsById.get(sessionId);
    if (record === undefined) {
      record = emptySession(sessionId);
      sessionsById.set(sessionId, record);
      tree.sessions.push(record);
    }
    mergeFacts(record, facts, mtimeMs);
  };

  for (const project of listEntries(root, tree)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    const entries = listEntries(projectDir, tree);
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.endsWith(".jsonl")) continue;
      absorb(path.join(projectDir, entry.name), path.basename(entry.name, ".jsonl"), "main");
    }
    for (const sessionDir of entries.filter((entry) => entry.isDirectory())) {
      const subagentsDir = path.join(projectDir, sessionDir.name, "subagents");
      for (const file of listEntries(subagentsDir, tree)) {
        if (file.name.endsWith(".jsonl")) absorb(path.join(subagentsDir, file.name), sessionDir.name, "subagent");
      }
    }
  }
  return tree;
}

function classifyTranscript(text: string, scope: TranscriptScope): TranscriptFacts {
  const facts: TranscriptFacts = {
    mode: null,
    turns: 0,
    agentLaunches: 0,
    osoStateCalls: 0,
    denials: [],
    stopNetTimestamps: [],
    skippedLines: 0,
  };
  const turnIds = new Set<string>();
  const toolUseIds = new Set<string>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === undefined) {
      facts.skippedLines += 1;
      continue;
    }
    const timestamp = typeof event["timestamp"] === "string" ? event["timestamp"] : "";
    facts.denials.push(...denialsOf(event, timestamp));
    if (scope === "subagent") continue;
    if (isStopNetBlock(event)) facts.stopNetTimestamps.push(timestamp);
    facts.mode ??= modeOf(event);
    countAssistantWork(event, facts, turnIds, toolUseIds);
  }
  facts.turns = turnIds.size;
  return facts;
}

function gateOfDenial(text: string): GateName {
  const match = GATE_PHRASES.find(([phrase]) => text.includes(phrase));
  return match?.[1] ?? "unclassified";
}

function listEntries(dir: string, tree: TreeClassification): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    if (isMissing(cause)) return [];
    tree.unreadable_files += 1;
    return [];
  }
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

function emptySession(sessionId: string): SessionRecord {
  return {
    sessionId,
    mtimeMs: 0,
    mode: null,
    turns: 0,
    agentLaunches: 0,
    osoStateCalls: 0,
    denials: [],
    stopNetTimestamps: [],
  };
}

function mergeFacts(record: SessionRecord, facts: TranscriptFacts, mtimeMs: number): void {
  record.mtimeMs = Math.max(record.mtimeMs, mtimeMs);
  record.mode ??= facts.mode;
  record.turns += facts.turns;
  record.agentLaunches += facts.agentLaunches;
  record.osoStateCalls += facts.osoStateCalls;
  record.denials.push(...facts.denials);
  record.stopNetTimestamps.push(...facts.stopNetTimestamps);
}

function parseEvent(line: string): EventRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is EventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageContent(event: EventRecord): unknown {
  return isRecord(event["message"]) ? event["message"]["content"] : undefined;
}

function contentBlocks(event: EventRecord): EventRecord[] {
  const content = messageContent(event);
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((block) => (block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : ""))
    .join("\n");
}

function denialsOf(event: EventRecord, timestamp: string): Denial[] {
  if (event["type"] !== "user") return [];
  return contentBlocks(event)
    .filter((block) => block["type"] === "tool_result" && block["is_error"] === true)
    .map((block) => textOf(block["content"]))
    .filter((text) => DENIAL_TEXT.test(text))
    .map((text) => ({ gate: gateOfDenial(text), timestamp }));
}

function isStopNetBlock(event: EventRecord): boolean {
  const attachment = event["attachment"];
  if (!isRecord(attachment)) return false;
  if (attachment["type"] !== "hook_blocking_error" || attachment["hookEvent"] !== "Stop") return false;
  const blocking = attachment["blockingError"];
  const text = isRecord(blocking) ? blocking["blockingError"] : blocking;
  return typeof text === "string" && text.startsWith("oso-code:");
}

function modeOf(event: EventRecord): Mode | null {
  if (event["type"] !== "user") return null;
  const text = textOf(messageContent(event)).trimStart();
  if (!text.startsWith("<command-message>") && !text.startsWith("<command-name>")) return null;
  const mode = MODE_COMMAND.exec(text)?.[1];
  return MODES.find((candidate) => candidate === mode) ?? null;
}

function countAssistantWork(
  event: EventRecord,
  facts: TranscriptFacts,
  turnIds: Set<string>,
  toolUseIds: Set<string>,
): void {
  if (event["type"] !== "assistant") return;
  const message = event["message"];
  if (isRecord(message) && typeof message["id"] === "string") turnIds.add(message["id"]);
  for (const block of contentBlocks(event)) {
    if (block["type"] !== "tool_use" || typeof block["id"] !== "string" || toolUseIds.has(block["id"])) continue;
    toolUseIds.add(block["id"]);
    const name = block["name"];
    if (typeof name === "string" && AGENT_TOOLS.has(name)) facts.agentLaunches += 1;
    if (name === "Bash" && commandOf(block).includes("oso-state")) facts.osoStateCalls += 1;
  }
}

function commandOf(toolUse: EventRecord): string {
  const input = toolUse["input"];
  return isRecord(input) && typeof input["command"] === "string" ? input["command"] : "";
}
