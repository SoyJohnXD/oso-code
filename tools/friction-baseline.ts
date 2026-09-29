import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const MODES = ["plan", "quick", "debug", "roadmap"] as const;
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
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export type Denial = Readonly<{ gate: GateName; timestamp: string }>;

const COMPLETION_STATUSES = ["completed", "failed", "stopped", "killed", "other"] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export type Completion = Readonly<{ atMs: number; status: CompletionStatus }>;

export type Delegation = Readonly<{ launchedAtMs: number; agentId: string | null; completion: Completion | null }>;

export type SubagentWrites = Readonly<{ agentId: string; writeTimesMs: number[] }>;

export type SessionRecord = {
  sessionId: string;
  mtimeMs: number;
  hasMainTranscript: boolean;
  mode: Mode | null;
  turns: number;
  agentLaunches: number;
  osoStateCalls: number;
  denials: Denial[];
  stopNetTimestamps: string[];
  delegations: Delegation[];
  subagentWrites: SubagentWrites[];
};

export type TreeClassification = {
  sessions: SessionRecord[];
  skippedLines: number;
  unreadableFiles: number;
};

type TranscriptScope = "main" | "subagent";

type TranscriptFacts = Omit<SessionRecord, "sessionId" | "mtimeMs" | "hasMainTranscript" | "subagentWrites"> & {
  skippedLines: number;
  writeTimesMs: number[];
};

type LaunchRecord = { launchedAtMs: number; agentId: string | null; resultCompletion: Completion | null };

type Notice = Readonly<{ toolUseId: string | null; taskId: string | null; completion: Completion }>;

type TranscriptTally = Readonly<{
  facts: TranscriptFacts;
  turnIds: Set<string>;
  toolUseIds: Set<string>;
  launches: Map<string, LaunchRecord>;
  notices: Notice[];
}>;

type TranscriptFile = Readonly<
  { file: string; sessionId: string } & ({ scope: "main" } | { scope: "subagent"; agentId: string })
>;

type EventRecord = Readonly<Record<string, unknown>>;

const DENIAL_TEXT = /^(?:PreToolUse:\S+ hook error: )?oso-code:/;
const MODE_COMMAND = new RegExp(`<command-name>/oso-code:(${MODES.join("|")})</command-name>`);
const OSO_STATE_INVOCATION =
  /(?:^|[;&|(){`\n]|\$\()\s*(?:\w+=\S*\s+)*"?(?:\$\{OSO_STATE_BIN:-)?(?:[^\s"'|;&]*\/)?oso-state\}?"?(?=\s|$|[;&|)}])/;
const AGENT_TOOLS = new Set(["Agent", "Task"]);

export function classifyTree(root: string): TreeClassification {
  const tree: TreeClassification = { sessions: [], skippedLines: 0, unreadableFiles: 0 };
  const sessionsById = new Map<string, SessionRecord>();

  for (const transcript of listTranscripts(root, tree)) {
    const { file, sessionId } = transcript;
    let text: string;
    let mtimeMs: number;
    try {
      text = readFileSync(file, "utf8");
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      tree.unreadableFiles += 1;
      continue;
    }
    const facts = classifyTranscript(text, transcript.scope);
    tree.skippedLines += facts.skippedLines;
    let record = sessionsById.get(sessionId);
    if (record === undefined) {
      record = emptySession(sessionId);
      sessionsById.set(sessionId, record);
      tree.sessions.push(record);
    }
    record.hasMainTranscript ||= transcript.scope === "main";
    if (transcript.scope === "subagent") {
      record.subagentWrites.push({ agentId: transcript.agentId, writeTimesMs: facts.writeTimesMs });
    }
    mergeFacts(record, facts, mtimeMs);
  }
  return tree;
}

function listTranscripts(root: string, tree: TreeClassification): TranscriptFile[] {
  return listEntries(root, tree)
    .filter((project) => project.isDirectory())
    .flatMap((project) => {
      const projectDir = path.join(root, project.name);
      const entries = listEntries(projectDir, tree);
      const mainTranscripts = entries
        .filter((entry) => !entry.isDirectory() && entry.name.endsWith(".jsonl"))
        .map((entry): TranscriptFile => ({
          file: path.join(projectDir, entry.name),
          sessionId: path.basename(entry.name, ".jsonl"),
          scope: "main",
        }));
      const subagentTranscripts = entries
        .filter((entry) => entry.isDirectory())
        .flatMap((sessionDir) => {
          const subagentsDir = path.join(projectDir, sessionDir.name, "subagents");
          return listEntries(subagentsDir, tree)
            .filter((file) => file.name.endsWith(".jsonl"))
            .map((file): TranscriptFile => ({
              file: path.join(subagentsDir, file.name),
              sessionId: sessionDir.name,
              scope: "subagent",
              agentId: path.basename(file.name, ".jsonl").replace(/^agent-/, ""),
            }));
        });
      return [...mainTranscripts, ...subagentTranscripts];
    });
}

function listEntries(dir: string, tree: TreeClassification): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    if (isMissing(cause)) return [];
    tree.unreadableFiles += 1;
    return [];
  }
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export function classifyTranscript(text: string, scope: TranscriptScope): TranscriptFacts {
  const tally: TranscriptTally = {
    facts: {
      mode: null,
      turns: 0,
      agentLaunches: 0,
      osoStateCalls: 0,
      denials: [],
      stopNetTimestamps: [],
      delegations: [],
      skippedLines: 0,
      writeTimesMs: [],
    },
    turnIds: new Set(),
    toolUseIds: new Set(),
    launches: new Map(),
    notices: [],
  };
  const { facts } = tally;

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === undefined) {
      facts.skippedLines += 1;
      continue;
    }
    const timestamp = typeof event["timestamp"] === "string" ? event["timestamp"] : "";
    const timeMs = Date.parse(timestamp);
    facts.denials.push(...denialsOf(event, timestamp));
    if (scope === "subagent") {
      if (!Number.isNaN(timeMs)) facts.writeTimesMs.push(timeMs);
      continue;
    }
    if (isStopNetBlock(event)) facts.stopNetTimestamps.push(timestamp);
    facts.mode ??= modeOf(event);
    countAssistantWork(event, tally, timeMs);
    if (Number.isNaN(timeMs)) continue;
    recordLaunchResults(event, tally.launches, timeMs);
    const notice = noticeOf(event, timeMs);
    if (notice !== null) tally.notices.push(notice);
  }
  facts.turns = tally.turnIds.size;
  facts.delegations = resolveDelegations(tally);
  return facts;
}

function emptySession(sessionId: string): SessionRecord {
  return {
    sessionId,
    mtimeMs: 0,
    hasMainTranscript: false,
    mode: null,
    turns: 0,
    agentLaunches: 0,
    osoStateCalls: 0,
    denials: [],
    stopNetTimestamps: [],
    delegations: [],
    subagentWrites: [],
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
  record.delegations.push(...facts.delegations);
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

function gateOfDenial(text: string): GateName {
  const match = GATE_PHRASES.find(([phrase]) => text.includes(phrase));
  return match?.[1] ?? "unclassified";
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
  return (MODE_COMMAND.exec(text)?.[1] as Mode | undefined) ?? null;
}

function countAssistantWork(
  event: EventRecord,
  { facts, turnIds, toolUseIds, launches }: TranscriptTally,
  timeMs: number,
): void {
  if (event["type"] !== "assistant") return;
  const message = event["message"];
  if (isRecord(message) && typeof message["id"] === "string") turnIds.add(message["id"]);
  for (const block of contentBlocks(event)) {
    const id = block["id"];
    if (block["type"] !== "tool_use" || typeof id !== "string" || toolUseIds.has(id)) continue;
    toolUseIds.add(id);
    const name = block["name"];
    if (typeof name === "string" && AGENT_TOOLS.has(name)) {
      facts.agentLaunches += 1;
      if (!Number.isNaN(timeMs)) launches.set(id, { launchedAtMs: timeMs, agentId: null, resultCompletion: null });
    }
    if (name === "Bash" && OSO_STATE_INVOCATION.test(commandOf(block))) facts.osoStateCalls += 1;
  }
}

function commandOf(toolUse: EventRecord): string {
  const input = toolUse["input"];
  return isRecord(input) && typeof input["command"] === "string" ? input["command"] : "";
}

function recordLaunchResults(event: EventRecord, launches: Map<string, LaunchRecord>, timeMs: number): void {
  if (event["type"] !== "user") return;
  const result = event["toolUseResult"];
  const resultFields = isRecord(result) ? result : {};
  const isAsyncLaunch = resultFields["isAsync"] === true || resultFields["status"] === "async_launched";
  for (const block of contentBlocks(event)) {
    const toolUseId = block["tool_use_id"];
    const launch = block["type"] === "tool_result" && typeof toolUseId === "string" ? launches.get(toolUseId) : undefined;
    if (launch === undefined) continue;
    if (typeof resultFields["agentId"] === "string") launch.agentId = resultFields["agentId"];
    if (isAsyncLaunch) continue;
    launch.resultCompletion = { atMs: timeMs, status: block["is_error"] === true ? "failed" : "completed" };
  }
}

const TASK_NOTIFICATION = "task-notification";
const TASK_NOTIFICATION_OPEN = `<${TASK_NOTIFICATION}>`;

function noticeOf(event: EventRecord, timeMs: number): Notice | null {
  const text = notificationText(event);
  if (text === null) return null;
  const status = tagValue(text, "status");
  return {
    toolUseId: tagValue(text, "tool-use-id"),
    taskId: tagValue(text, "task-id"),
    completion: { atMs: timeMs, status: COMPLETION_STATUSES.find((known) => known === status) ?? "other" },
  };
}

function notificationText(event: EventRecord): string | null {
  const origin = event["origin"];
  if (event["type"] === "user" && isRecord(origin) && origin["kind"] === TASK_NOTIFICATION) {
    return textOf(messageContent(event));
  }
  const content = event["content"];
  if (event["type"] === "queue-operation" && event["operation"] === "enqueue" && typeof content === "string") {
    return content.trimStart().startsWith(TASK_NOTIFICATION_OPEN) ? content : null;
  }
  const attachment = event["attachment"];
  if (!isRecord(attachment) || attachment["type"] !== "queued_command") return null;
  const prompt = attachment["prompt"];
  return attachment["commandMode"] === TASK_NOTIFICATION && typeof prompt === "string" ? prompt : null;
}

function tagValue(text: string, tag: string): string | null {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1] ?? null;
}

function resolveDelegations({ launches, notices }: TranscriptTally): Delegation[] {
  const byToolUseId = earliestCompletionBy(notices, (notice) => notice.toolUseId);
  const byTaskId = earliestCompletionBy(
    notices.filter((notice) => notice.toolUseId === null),
    (notice) => notice.taskId,
  );
  return [...launches].map(([toolUseId, { launchedAtMs, agentId, resultCompletion }]) => ({
    launchedAtMs,
    agentId,
    completion:
      resultCompletion ?? byToolUseId.get(toolUseId) ?? (agentId === null ? undefined : byTaskId.get(agentId)) ?? null,
  }));
}

function earliestCompletionBy(notices: Notice[], keyOf: (notice: Notice) => string | null): Map<string, Completion> {
  const earliest = new Map<string, Completion>();
  for (const notice of notices) {
    const key = keyOf(notice);
    if (key === null) continue;
    const known = earliest.get(key);
    if (known === undefined || notice.completion.atMs < known.atMs) earliest.set(key, notice.completion);
  }
  return earliest;
}

const OPENCODE_BUSY_TIMEOUT_MS = 5_000;
const OPENCODE_REQUIRED_COLUMNS = {
  session: ["id", "parent_id", "time_created", "time_updated"],
  message: ["id", "session_id", "data"],
  part: ["id", "message_id", "session_id", "time_created", "data"],
} as const;
const CONTINUATION_PUSH_PREFIX = "oso-code:";
const SKILL_MODE = new RegExp(`skill/oso-(${MODES.join("|")})/SKILL\\.md`);

type SqlRow = Readonly<Record<string, unknown>>;

export function classifyOpenCodeDb(dbFile: string): TreeClassification {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${OPENCODE_BUSY_TIMEOUT_MS}`);
    assertOpenCodeSchema(db);
    return classifyOpenCodeRows(
      db.prepare("SELECT id, parent_id, time_updated FROM session").all(),
      db.prepare("SELECT id, session_id, data FROM message").all(),
      db.prepare("SELECT session_id, message_id, time_created, data FROM part ORDER BY time_created, id").all(),
    );
  } finally {
    db.close();
  }
}

function assertOpenCodeSchema(db: DatabaseSync): void {
  const problems = Object.entries(OPENCODE_REQUIRED_COLUMNS).flatMap(([table, columns]) => {
    const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column["name"]));
    if (present.size === 0) return [`missing table ${table}`];
    return columns.filter((column) => !present.has(column)).map((column) => `missing column ${table}.${column}`);
  });
  if (problems.length > 0) throw new Error(`OpenCode schema unrecognized: ${problems.join("; ")}`);
}

type OpenCodeSessionIndex = Readonly<{
  parents: Map<string, string | null>;
  records: Map<string, SessionRecord>;
  roles: Map<string, string>;
}>;

function classifyOpenCodeRows(sessionRows: SqlRow[], messageRows: SqlRow[], partRows: SqlRow[]): TreeClassification {
  const parents = new Map(sessionRows.map((row) => [String(row["id"]), row["parent_id"] == null ? null : String(row["parent_id"])]));
  const records = sessionRecordsByRoot(sessionRows, parents);
  const roles = messageRolesCountingTurns(messageRows, records);
  const skippedLines = classifyOpenCodeParts(partRows, { parents, records, roles });
  return { sessions: [...records.values()], skippedLines, unreadableFiles: 0 };
}

function sessionRecordsByRoot(sessionRows: SqlRow[], parents: Map<string, string | null>): Map<string, SessionRecord> {
  const records = new Map<string, SessionRecord>();
  for (const row of sessionRows) {
    const root = rootSessionOf(String(row["id"]), parents);
    let record = records.get(root);
    if (record === undefined) {
      record = { ...emptySession(root), hasMainTranscript: true };
      records.set(root, record);
    }
    record.mtimeMs = Math.max(record.mtimeMs, Number(row["time_updated"]));
  }
  return records;
}

function messageRolesCountingTurns(messageRows: SqlRow[], records: Map<string, SessionRecord>): Map<string, string> {
  const roles = new Map<string, string>();
  for (const row of messageRows) {
    const role = parseRow(row["data"])?.["role"];
    if (typeof role !== "string") continue;
    roles.set(String(row["id"]), role);
    const record = records.get(String(row["session_id"]));
    if (role === "assistant" && record !== undefined) record.turns += 1;
  }
  return roles;
}

function classifyOpenCodeParts(partRows: SqlRow[], { parents, records, roles }: OpenCodeSessionIndex): number {
  let skippedLines = 0;
  for (const row of partRows) {
    const sessionId = String(row["session_id"]);
    const record = records.get(rootSessionOf(sessionId, parents));
    const part = parseRow(row["data"]);
    if (part === undefined) {
      skippedLines += 1;
      continue;
    }
    if (record === undefined) continue;
    const timeMs = Number(row["time_created"]);
    const timestamp = Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : "";
    const state = isRecord(part["state"]) ? part["state"] : {};
    if (part["type"] === "tool" && state["status"] === "error" && typeof state["error"] === "string") {
      if (DENIAL_TEXT.test(state["error"])) record.denials.push({ gate: gateOfDenial(state["error"]), timestamp });
    }
    if (record.sessionId !== sessionId) continue;
    countOpenCodeMainPart(record, part, state, roles.get(String(row["message_id"])) === "user", timestamp);
  }
  return skippedLines;
}

function countOpenCodeMainPart(
  record: SessionRecord,
  part: EventRecord,
  state: EventRecord,
  fromUser: boolean,
  timestamp: string,
): void {
  if (part["type"] === "text" && fromUser && typeof part["text"] === "string") {
    if (part["text"].trimStart().startsWith(CONTINUATION_PUSH_PREFIX)) record.stopNetTimestamps.push(timestamp);
    record.mode ??= (SKILL_MODE.exec(part["text"])?.[1] as Mode | undefined) ?? null;
  }
  if (part["type"] !== "tool") return;
  if (part["tool"] === "task") record.agentLaunches += 1;
  if (part["tool"] === "bash" && OSO_STATE_INVOCATION.test(commandOf(state))) record.osoStateCalls += 1;
}

function rootSessionOf(sessionId: string, parents: Map<string, string | null>): string {
  const seen = new Set([sessionId]);
  let current = sessionId;
  for (let parent = parents.get(current); parent != null && parents.has(parent) && !seen.has(parent); parent = parents.get(current)) {
    seen.add(parent);
    current = parent;
  }
  return current;
}

function parseRow(data: unknown): EventRecord | undefined {
  return typeof data === "string" ? parseEvent(data) : undefined;
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
  delegation_liveness: DelegationLiveness;
};

export type DurationDistribution = {
  count: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
};

const IDLE_GAP_THRESHOLDS_MIN = [15, 30, 45, 60] as const;
type IdleGapThreshold = `${(typeof IDLE_GAP_THRESHOLDS_MIN)[number]}m`;

export type DelegationLiveness = {
  launches: number;
  orphans: number;
  orphan_session_ids: string[];
  statuses: Record<CompletionStatus, number>;
  stop_net_blocks: { delegation_in_flight: number; none_in_flight: number };
  launch_to_completion: DurationDistribution & { at_least_45_min: number };
  idle_gaps: DurationDistribution & { share_at_least: Record<IdleGapThreshold, number | null> };
  lingering: DurationDistribution;
};

export function aggregate(tree: TreeClassification, windowDays: number, nowMs: number): FrictionReport {
  const cutoffMs = nowMs - windowDays * MS_PER_DAY;
  const windowed = tree.sessions.filter((session) => session.mtimeMs >= cutoffMs);
  const sessions = windowed.filter((session) => session.hasMainTranscript);
  const osoStateCalls = sessions.map((session) => session.osoStateCalls);
  return {
    window_days: windowDays,
    sessions_scanned: sessions.length,
    skipped_lines: tree.skippedLines,
    unreadable_files: tree.unreadableFiles,
    gates: gateCounts(windowed),
    stop_net_bursts: sessions.reduce((total, session) => total + countBursts(session.stopNetTimestamps), 0),
    oso_state_calls: {
      total: osoStateCalls.reduce((total, calls) => total + calls, 0),
      per_session_median: median(osoStateCalls),
      max: Math.max(0, ...osoStateCalls),
    },
    modes: Object.fromEntries(
      MODES.map((mode) => [mode, summarizeMode(sessions.filter((session) => session.mode === mode))]),
    ) as Record<Mode, ModeSummary>,
    unclassified_session_ids: windowed
      .filter((session) => session.denials.some((denial) => denial.gate === "unclassified"))
      .map((session) => session.sessionId),
    delegation_liveness: delegationLiveness(sessions),
  };
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

const LONG_DELEGATION_MIN = 45;

type FinishedSubagentIdle = Readonly<{ maxGapMs: number; lingeringMs: number }>;

function delegationLiveness(sessions: SessionRecord[]): DelegationLiveness {
  const delegations = sessions.flatMap((session) => session.delegations);
  const durations = delegations.flatMap(({ launchedAtMs, completion }) =>
    completion === null ? [] : [completion.atMs - launchedAtMs],
  );
  const finished = sessions.flatMap(finishedSubagentIdle);
  const maxGaps = finished.map((subagent) => subagent.maxGapMs);
  const isOrphan = (delegation: Delegation) => delegation.completion === null;
  return {
    launches: delegations.length,
    orphans: delegations.filter(isOrphan).length,
    orphan_session_ids: sessions
      .filter((session) => session.delegations.some(isOrphan))
      .map((session) => session.sessionId),
    statuses: statusCounts(delegations),
    stop_net_blocks: stopNetBlocksByFlight(sessions),
    launch_to_completion: {
      ...distribution(durations),
      at_least_45_min: durations.filter((ms) => ms >= LONG_DELEGATION_MIN * MS_PER_MINUTE).length,
    },
    idle_gaps: { ...distribution(maxGaps), share_at_least: shareAtLeast(maxGaps) },
    lingering: distribution(finished.map((subagent) => subagent.lingeringMs)),
  };
}

function finishedSubagentIdle(session: SessionRecord): FinishedSubagentIdle[] {
  const writesByAgent = new Map(session.subagentWrites.map(({ agentId, writeTimesMs }) => [agentId, writeTimesMs]));
  return session.delegations.flatMap(({ agentId, completion }) => {
    if (agentId === null || completion === null) return [];
    const writesUntilCompletion = (writesByAgent.get(agentId) ?? [])
      .filter((time) => time <= completion.atMs)
      .sort((a, b) => a - b);
    const lastWriteMs = writesUntilCompletion.at(-1);
    if (lastWriteMs === undefined) return [];
    return [{ maxGapMs: largestGap(writesUntilCompletion), lingeringMs: completion.atMs - lastWriteMs }];
  });
}

function largestGap(sortedTimesMs: number[]): number {
  return sortedTimesMs.reduce(
    (largest, time, index) => Math.max(largest, time - (sortedTimesMs[index - 1] ?? time)),
    0,
  );
}

function statusCounts(delegations: Delegation[]): Record<CompletionStatus, number> {
  const counts = Object.fromEntries(COMPLETION_STATUSES.map((status) => [status, 0])) as Record<
    CompletionStatus,
    number
  >;
  for (const { completion } of delegations) if (completion !== null) counts[completion.status] += 1;
  return counts;
}

function stopNetBlocksByFlight(sessions: SessionRecord[]): DelegationLiveness["stop_net_blocks"] {
  const inFlightPerBlock = sessions.flatMap((session) =>
    session.stopNetTimestamps
      .map((timestamp) => Date.parse(timestamp))
      .filter((time) => !Number.isNaN(time))
      .map((time) => session.delegations.some((delegation) => isInFlightAt(delegation, time))),
  );
  const inFlight = inFlightPerBlock.filter(Boolean).length;
  return { delegation_in_flight: inFlight, none_in_flight: inFlightPerBlock.length - inFlight };
}

function isInFlightAt({ launchedAtMs, completion }: Delegation, timeMs: number): boolean {
  return launchedAtMs < timeMs && (completion === null || completion.atMs > timeMs);
}

function distribution(valuesMs: number[]): DurationDistribution {
  const sorted = [...valuesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50_ms: nearestRank(sorted, 0.5),
    p90_ms: nearestRank(sorted, 0.9),
    p99_ms: nearestRank(sorted, 0.99),
    max_ms: sorted.at(-1) ?? null,
  };
}

function nearestRank(sorted: number[], fraction: number): number | null {
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}

function shareAtLeast(maxGapsMs: number[]): Record<IdleGapThreshold, number | null> {
  return Object.fromEntries(
    IDLE_GAP_THRESHOLDS_MIN.map((minutes) => {
      const reached = maxGapsMs.filter((gap) => gap >= minutes * MS_PER_MINUTE).length;
      return [`${minutes}m`, maxGapsMs.length === 0 ? null : Number((reached / maxGapsMs.length).toFixed(3))];
    }),
  ) as Record<IdleGapThreshold, number | null>;
}

export function renderJson(report: FrictionReport): string {
  return JSON.stringify(report, null, 2);
}

const GATE_COLUMNS = { gate: 14, events: 7, sessions: 10 } as const;
const MODE_COLUMNS = { mode: 10, cell: 11 } as const;

export function renderTable(report: FrictionReport): string {
  const gateRows = GATES.map((gate) => {
    const { events, sessions } = report.gates[gate];
    return `  ${gate.padEnd(GATE_COLUMNS.gate)}${String(events).padStart(GATE_COLUMNS.events)}${String(sessions).padStart(GATE_COLUMNS.sessions)}`;
  });
  const modeRows = MODES.map((mode) => {
    const summary = report.modes[mode];
    const cells = [
      summary.sessions,
      summary.median_turns,
      summary.median_agent_launches,
      summary.median_oso_state_calls,
    ].map((cell) => String(cell ?? "n/a").padStart(MODE_COLUMNS.cell));
    return `  ${mode.padEnd(MODE_COLUMNS.mode)}${cells.join("")}`;
  });
  const modeHeader = ["sessions", "med turns", "med agents", "med oso-st"].map((label) => label.padStart(MODE_COLUMNS.cell));
  const { total, per_session_median, max } = report.oso_state_calls;
  return [
    `friction baseline: last ${report.window_days} days, ${report.sessions_scanned} sessions scanned`,
    `skipped_lines ${report.skipped_lines}, unreadable_files ${report.unreadable_files}`,
    "",
    `  ${"gate".padEnd(GATE_COLUMNS.gate)}${"events".padStart(GATE_COLUMNS.events)}${"sessions".padStart(GATE_COLUMNS.sessions)}`,
    ...gateRows,
    "",
    `stop-net bursts (>=${BURST_MIN_BLOCKS} blocks, gaps <=${BURST_MAX_GAP_MS / 1000}s): ${report.stop_net_bursts}`,
    `oso-state calls: total ${total}, per-session median ${per_session_median ?? "n/a"}, max ${max}`,
    "",
    `  ${"mode".padEnd(MODE_COLUMNS.mode)}${modeHeader.join("")}`,
    ...modeRows,
    "",
    ...livenessRows(report.delegation_liveness),
    "",
    `sessions with unclassified denials: ${report.unclassified_session_ids.join(", ") || "none"}`,
  ].join("\n");
}

const DISTRIBUTION_COLUMNS = { label: 22, cell: 8 } as const;

function livenessRows(liveness: DelegationLiveness): string[] {
  const { stop_net_blocks: stopBlocks, launch_to_completion: durations, idle_gaps: idleGaps } = liveness;
  const statuses = COMPLETION_STATUSES.map((status) => `${status} ${liveness.statuses[status]}`).join(", ");
  const shares = IDLE_GAP_THRESHOLDS_MIN.map(
    (minutes) => `>=${minutes}m ${idleGaps.share_at_least[`${minutes}m`] ?? "n/a"}`,
  ).join(", ");
  const header = ["count", "p50", "p90", "p99", "max"].map((label) => label.padStart(DISTRIBUTION_COLUMNS.cell));
  return [
    `delegation liveness: ${liveness.launches} launches, ${liveness.orphans} orphans`,
    `  stop-net blocks: ${stopBlocks.delegation_in_flight} with a delegation in flight, ${stopBlocks.none_in_flight} with none in flight`,
    `  completion statuses: ${statuses}`,
    `  ${"minutes".padEnd(DISTRIBUTION_COLUMNS.label)}${header.join("")}`,
    distributionRow("launch->completion", durations),
    distributionRow("max idle gap", idleGaps),
    distributionRow("lingering", liveness.lingering),
    `  launches >=${LONG_DELEGATION_MIN} min: ${durations.at_least_45_min}`,
    `  finished subagents by max idle gap: ${shares}`,
    `  sessions with orphan launches: ${liveness.orphan_session_ids.join(", ") || "none"}`,
  ];
}

function distributionRow(label: string, { count, p50_ms, p90_ms, p99_ms, max_ms }: DurationDistribution): string {
  const minutes = [p50_ms, p90_ms, p99_ms, max_ms].map((ms) =>
    ms === null ? "n/a" : (ms / MS_PER_MINUTE).toFixed(1),
  );
  const cells = [String(count), ...minutes].map((cell) => cell.padStart(DISTRIBUTION_COLUMNS.cell));
  return `  ${label.padEnd(DISTRIBUTION_COLUMNS.label)}${cells.join("")}`;
}

function openCodeDefaultDb(): string {
  const dataHome = process.env["XDG_DATA_HOME"] || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "opencode.db");
}

function openCodeDbFile(dbFile: string): string {
  if (!statSync(dbFile).isFile()) throw new Error(`opencode database is not a file: ${dbFile}`);
  return dbFile;
}

function classifyClaudeRoot(root: string): TreeClassification {
  if (!statSync(root).isDirectory()) throw new Error(`root is not a directory: ${root}`);
  return classifyTree(root);
}

function main(): void {
  try {
    const { values } = parseArgs({
      options: {
        days: { type: "string", default: String(DEFAULT_WINDOW_DAYS) },
        root: { type: "string", default: path.join(homedir(), ".claude", "projects") },
        json: { type: "boolean", default: false },
        host: { type: "string", default: "claude" },
        "opencode-db": { type: "string", default: openCodeDefaultDb() },
      },
    });
    const days = Number(values.days);
    if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number, got ${values.days}`);
    if (values.host !== "claude" && values.host !== "opencode") {
      throw new Error(`--host must be claude or opencode, got ${values.host}`);
    }
    const tree = values.host === "opencode" ? classifyOpenCodeDb(openCodeDbFile(values["opencode-db"])) : classifyClaudeRoot(values.root);
    const report = aggregate(tree, days, Date.now());
    console.log(values.json ? renderJson(report) : renderTable(report));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`friction-baseline: ${reason.split("\n")[0]}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
