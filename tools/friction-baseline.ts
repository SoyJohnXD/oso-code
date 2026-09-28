import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

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

const GATES: readonly GateName[] = [...new Set(GATE_PHRASES.map(([, gate]) => gate)), "unclassified"];
const STOP_NET_GATE: GateName = "autocontinue";
const BURST_MIN_BLOCKS = 3;
const BURST_MAX_GAP_MS = 60_000;
const DEFAULT_WINDOW_DAYS = 60;
const MS_PER_DAY = 86_400_000;

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

export type GateCount = { events: number; sessions: number };

export type ModeSummary = {
  sessions: number;
  median_turns: number | null;
  median_agent_launches: number | null;
  median_oso_state_calls: number | null;
};

export type FrictionReport = {
  window_days: number;
  sessions_scanned: number;
  skipped_lines: number;
  unreadable_files: number;
  gates: Record<GateName, GateCount>;
  stop_net_bursts: number;
  oso_state_calls: { total: number; per_session_median: number | null; max: number };
  modes: Record<Mode, ModeSummary>;
  unclassified_session_ids: string[];
};

export function aggregate(tree: TreeClassification, windowDays: number, nowMs: number): FrictionReport {
  const cutoffMs = nowMs - windowDays * MS_PER_DAY;
  const sessions = tree.sessions.filter((session) => session.mtimeMs >= cutoffMs);
  const osoStateCalls = sessions.map((session) => session.osoStateCalls);
  return {
    window_days: windowDays,
    sessions_scanned: sessions.length,
    skipped_lines: tree.skipped_lines,
    unreadable_files: tree.unreadable_files,
    gates: gateCounts(sessions),
    stop_net_bursts: sessions.reduce((total, session) => total + countBursts(session.stopNetTimestamps), 0),
    oso_state_calls: {
      total: osoStateCalls.reduce((total, calls) => total + calls, 0),
      per_session_median: median(osoStateCalls),
      max: Math.max(0, ...osoStateCalls),
    },
    modes: Object.fromEntries(
      MODES.map((mode) => [mode, summarizeMode(sessions.filter((session) => session.mode === mode))]),
    ) as Record<Mode, ModeSummary>,
    unclassified_session_ids: sessions
      .filter((session) => session.denials.some((denial) => denial.gate === "unclassified"))
      .map((session) => session.sessionId),
  };
}

export function renderJson(report: FrictionReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderTable(report: FrictionReport): string {
  const gateRows = GATES.map((gate) => {
    const { events, sessions } = report.gates[gate];
    return `  ${gate.padEnd(14)}${String(events).padStart(7)}${String(sessions).padStart(10)}`;
  });
  const modeRows = MODES.map((mode) => {
    const summary = report.modes[mode];
    const cells = [
      summary.sessions,
      summary.median_turns,
      summary.median_agent_launches,
      summary.median_oso_state_calls,
    ].map((cell) => String(cell ?? "n/a").padStart(11));
    return `  ${mode.padEnd(10)}${cells.join("")}`;
  });
  const modeHeader = ["sessions", "med turns", "med agents", "med oso-st"].map((label) => label.padStart(11));
  const { total, per_session_median, max } = report.oso_state_calls;
  return [
    `friction baseline: last ${report.window_days} days, ${report.sessions_scanned} sessions scanned`,
    `skipped_lines ${report.skipped_lines}, unreadable_files ${report.unreadable_files}`,
    "",
    `  ${"gate".padEnd(14)}${"events".padStart(7)}${"sessions".padStart(10)}`,
    ...gateRows,
    "",
    `stop-net bursts (>=${BURST_MIN_BLOCKS} blocks, gaps <=${BURST_MAX_GAP_MS / 1000}s): ${report.stop_net_bursts}`,
    `oso-state calls: total ${total}, per-session median ${per_session_median ?? "n/a"}, max ${max}`,
    "",
    `  ${"mode".padEnd(10)}${modeHeader.join("")}`,
    ...modeRows,
    "",
    `sessions with unclassified denials: ${report.unclassified_session_ids.join(", ") || "none"}`,
  ].join("\n");
}

function gateCounts(sessions: SessionRecord[]): Record<GateName, GateCount> {
  const counts = Object.fromEntries(GATES.map((gate) => [gate, { events: 0, sessions: 0 }])) as Record<
    GateName,
    GateCount
  >;
  for (const session of sessions) {
    const gatesOfSession = [
      ...session.denials.map((denial) => denial.gate),
      ...session.stopNetTimestamps.map(() => STOP_NET_GATE),
    ];
    for (const gate of gatesOfSession) counts[gate].events += 1;
    for (const gate of new Set(gatesOfSession)) counts[gate].sessions += 1;
  }
  return counts;
}

function countBursts(timestamps: string[]): number {
  const times = timestamps
    .map((timestamp) => Date.parse(timestamp))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
  let bursts = 0;
  let runLength = 0;
  times.forEach((time, index) => {
    const previous = times[index - 1];
    runLength = previous !== undefined && time - previous <= BURST_MAX_GAP_MS ? runLength + 1 : 1;
    if (runLength === BURST_MIN_BLOCKS) bursts += 1;
  });
  return bursts;
}

function summarizeMode(sessions: SessionRecord[]): ModeSummary {
  return {
    sessions: sessions.length,
    median_turns: median(sessions.map((session) => session.turns)),
    median_agent_launches: median(sessions.map((session) => session.agentLaunches)),
    median_oso_state_calls: median(sessions.map((session) => session.osoStateCalls)),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function main(): void {
  try {
    const { values } = parseArgs({
      options: {
        days: { type: "string", default: String(DEFAULT_WINDOW_DAYS) },
        root: { type: "string", default: path.join(homedir(), ".claude", "projects") },
        json: { type: "boolean", default: false },
      },
    });
    const days = Number(values.days);
    if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number, got ${values.days}`);
    if (!statSync(values.root).isDirectory()) throw new Error(`root is not a directory: ${values.root}`);
    const report = aggregate(classifyTree(values.root), days, Date.now());
    console.log(values.json ? renderJson(report) : renderTable(report));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`friction-baseline: ${reason.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
