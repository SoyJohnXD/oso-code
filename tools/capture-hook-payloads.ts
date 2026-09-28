import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CAPTURED_EVENTS = ["Stop", "SubagentStart", "SubagentStop"] as const;
const RUN_TIMEOUT_MS = 8 * 60_000;
const SESSION_LINKED_ENV = /^(?:CLAUDE|OSO_)/;
const ENUM_KEYS = new Set(["hook_event_name", "status", "type", "agent_type", "stop_hook_active", "permission_mode"]);

const PROBE_PROMPT = [
  'Call the Agent tool exactly once with subagent_type "general-purpose", run_in_background true,',
  'description "echo probe" and prompt "Run the Bash command `echo probe` and reply with its output only."',
  "Then wait for that background agent's task notification before you finish, and reply with the single word done.",
].join(" ");

const APPEND_PAYLOAD_SCRIPT = `
import { appendFileSync, readFileSync } from "node:fs";
const [, , file, event] = process.argv;
const raw = readFileSync(0, "utf8");
let payload;
try { payload = JSON.parse(raw); } catch { payload = { unparsed_bytes: raw.length }; }
appendFileSync(file, JSON.stringify({ event, payload }) + "\\n");
`;

type Shape = string | Shape[] | { [key: string]: Shape };

type CapturedPayload = Readonly<{ event: string; payload: unknown }>;

function main(): void {
  const probeDir = mkdtempSync(path.join(tmpdir(), "hook-payload-probe-"));
  const payloadFile = path.join(probeDir, "payloads.jsonl");
  const appendScript = path.join(probeDir, "append-payload.mjs");
  const settingsFile = path.join(probeDir, "capture-settings.json");
  writeFileSync(appendScript, APPEND_PAYLOAD_SCRIPT);
  writeFileSync(settingsFile, JSON.stringify(captureSettings(appendScript, payloadFile)));

  const startedMs = Date.now();
  const run = spawnSync(
    "claude",
    [
      "-p",
      PROBE_PROMPT,
      "--model",
      "haiku",
      "--setting-sources",
      "project",
      "--settings",
      settingsFile,
      "--strict-mcp-config",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Agent",
      "Bash(echo:*)",
      "--output-format",
      "json",
    ],
    { cwd: probeDir, env: detachedEnv(), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: RUN_TIMEOUT_MS },
  );
  const captured = existsSync(payloadFile) ? readCaptured(payloadFile) : [];
  console.log(
    JSON.stringify(
      {
        probe_dir: probeDir,
        claude_exit: run.status,
        claude_signal: run.signal,
        spawn_error: run.error?.message ?? null,
        stderr_first_line: run.error === undefined && run.status !== 0 ? (run.stderr.split("\n")[0] ?? "") : null,
        run_seconds: Math.round((Date.now() - startedMs) / 1000),
        payloads: captured.map(({ event, payload }) => ({ event, shape: shapeOf(payload) })),
        correlation: correlate(captured),
      },
      null,
      2,
    ),
  );
  if (run.status !== 0 || run.error !== undefined) process.exitCode = 1;
}

function captureSettings(appendScript: string, payloadFile: string): object {
  const hookFor = (event: string) => [
    { hooks: [{ type: "command", command: `"${process.execPath}" "${appendScript}" "${payloadFile}" ${event}` }] },
  ];
  return { hooks: Object.fromEntries(CAPTURED_EVENTS.map((event) => [event, hookFor(event)])) };
}

function detachedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !SESSION_LINKED_ENV.test(key)));
}

function readCaptured(payloadFile: string): CapturedPayload[] {
  return readFileSync(payloadFile, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as CapturedPayload);
}

function shapeOf(value: unknown, key = ""): Shape {
  if (Array.isArray(value)) return value.length === 0 ? ["empty"] : [shapeOf(value[0])];
  if (value === null) return "null";
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([field, nested]) => [field, shapeOf(nested, field)]));
  }
  return ENUM_KEYS.has(key) ? `${typeof value}=${String(value)}` : typeof value;
}

function correlate(captured: CapturedPayload[]): object {
  const startedAgentIds = new Set(
    captured.filter(({ event }) => event === "SubagentStart").flatMap(({ payload }) => stringField(payload, "agent_id")),
  );
  const withBackgroundTasks = captured.filter(({ payload }) => fieldOf(payload, "background_tasks") !== undefined);
  return {
    subagent_start_count: startedAgentIds.size,
    background_tasks_by_event: withBackgroundTasks.map(({ event, payload }) => {
      const ids = backgroundTaskIds(fieldOf(payload, "background_tasks"));
      return { event, kind: ids.kind, ids_equal_subagent_start_agent_id: ids.values.some((id) => startedAgentIds.has(id)) };
    }),
    agent_transcript_path: captured
      .filter(({ event }) => event === "SubagentStop")
      .map(({ payload }) => {
        const transcriptPath = stringField(payload, "agent_transcript_path")[0];
        return { present: transcriptPath !== undefined, exists: transcriptPath !== undefined && existsSync(transcriptPath) };
      }),
  };
}

function fieldOf(payload: unknown, field: string): unknown {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[field] : undefined;
}

function stringField(payload: unknown, field: string): string[] {
  const value = fieldOf(payload, field);
  return typeof value === "string" ? [value] : [];
}

function backgroundTaskIds(tasks: unknown): { kind: string; values: string[] } {
  if (Array.isArray(tasks)) return { kind: "array", values: tasks.flatMap((task) => stringField(task, "id")) };
  if (typeof tasks !== "object" || tasks === null) return { kind: typeof tasks, values: [] };
  const listed = Object.values(tasks).filter(Array.isArray).flat();
  return { kind: "object", values: listed.filter((id): id is string => typeof id === "string") };
}

if (import.meta.main) main();
