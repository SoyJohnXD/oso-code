import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { aggregate, classifyOpenCodeDb } from "../../../tools/friction-baseline.ts";

const CLI_PATH = fileURLToPath(new URL("../../../tools/friction-baseline.ts", import.meta.url));
const NOW_MS = Date.parse("2026-09-28T00:00:00.000Z");
const DAY_MS = 86_400_000;
const SECOND_MS = 1_000;
const BASE_MS = NOW_MS - DAY_MS;

const SCHEMA = [
  "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, time_created INTEGER, time_updated INTEGER)",
  "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)",
  "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)",
];

const DENIAL_TEXTS = {
  commit: "oso-code: the session verify is not green, so commits are blocked.",
  edits: "oso-code: plan mode is active but no slice is active, so edits are blocked.",
  proddeploy: "oso-code: an unattended run is in flight, so a production deploy stays with the operator.",
  autocontinue: "oso-code: this run is unattended and still in flight; keep working.",
  waiting: "oso-code: the state is still marked as waiting on the delegation.",
  foreign: "oso-code: the lock was left by another session.",
  unknown: "oso-code: the tool is not in this release's list.",
  reanchor: "oso-code: the session was compacted while a run was in flight.",
  preflight: "oso-code: the run is armed but its state file is missing.",
  novel: "oso-code: a phrase no table knows.",
};

let partCounter = 0;

type Fixture = { db: DatabaseSync; file: string };

function newFixture(schema: readonly string[] = SCHEMA): Fixture {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "friction-oc-")), "opencode.db");
  const db = new DatabaseSync(file);
  for (const statement of schema) db.exec(statement);
  return { db, file };
}

function addSession(db: DatabaseSync, id: string, parentId: string | null, createdMs: number, updatedMs: number): void {
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run(id, parentId, createdMs, updatedMs);
}

function addMessage(db: DatabaseSync, id: string, sessionId: string, role: "user" | "assistant"): void {
  db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(id, sessionId, JSON.stringify({ role, agent: "build" }));
}

function addPart(db: DatabaseSync, sessionId: string, messageId: string, atMs: number, data: object): void {
  partCounter += 1;
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
    `prt_${partCounter}`,
    messageId,
    sessionId,
    atMs,
    JSON.stringify(data),
  );
}

const textPart = (text: string) => ({ type: "text", text });
const denialPart = (error: string) => ({ type: "tool", tool: "bash", state: { status: "error", input: { command: "x" }, error } });
const bashPart = (command: string) => ({ type: "tool", tool: "bash", state: { status: "completed", input: { command } } });
const taskPart = { type: "tool", tool: "task", state: { status: "completed", input: {} } };

function buildFullFixture(): Fixture {
  const fixture = newFixture();
  const { db } = fixture;
  addSession(db, "ses_root", null, BASE_MS, BASE_MS + 600 * SECOND_MS);
  addSession(db, "ses_child", "ses_root", BASE_MS, BASE_MS + 700 * SECOND_MS);
  addSession(db, "ses_old", null, NOW_MS - 100 * DAY_MS, NOW_MS - 100 * DAY_MS);
  addMessage(db, "m_user", "ses_root", "user");
  addMessage(db, "m_asst1", "ses_root", "assistant");
  addMessage(db, "m_asst2", "ses_root", "assistant");
  addPart(db, "ses_root", "m_user", BASE_MS, textPart("run skill/oso-plan/SKILL.md for this change"));
  addPart(db, "ses_root", "m_user", BASE_MS + 100 * SECOND_MS, textPart("oso-code: continue the run"));
  addPart(db, "ses_root", "m_user", BASE_MS + 130 * SECOND_MS, textPart("oso-code: continue the run"));
  addPart(db, "ses_root", "m_user", BASE_MS + 170 * SECOND_MS, textPart("oso-code: continue the run"));
  addPart(db, "ses_root", "m_user", BASE_MS + 400 * SECOND_MS, textPart("quoting oso-code: mid-text is not a push"));
  addPart(db, "ses_root", "m_asst1", BASE_MS + 10 * SECOND_MS, textPart("oso-code: an assistant echo is not a push"));
  Object.values(DENIAL_TEXTS).forEach((error, index) => {
    addPart(db, "ses_root", "m_asst1", BASE_MS + (20 + index) * SECOND_MS, denialPart(error));
  });
  addPart(db, "ses_root", "m_asst1", BASE_MS + 40 * SECOND_MS, denialPart("permission denied by the shell"));
  addPart(db, "ses_root", "m_asst2", BASE_MS + 50 * SECOND_MS, bashPart("oso-state status"));
  addPart(db, "ses_root", "m_asst2", BASE_MS + 51 * SECOND_MS, bashPart('"${OSO_STATE_BIN:-oso-state}" verify'));
  addPart(db, "ses_root", "m_asst2", BASE_MS + 52 * SECOND_MS, bashPart("rg oso-state core/src"));
  addPart(db, "ses_root", "m_asst2", BASE_MS + 53 * SECOND_MS, taskPart);
  addMessage(db, "m_child", "ses_child", "assistant");
  addPart(db, "ses_child", "m_child", BASE_MS + 60 * SECOND_MS, denialPart(DENIAL_TEXTS.proddeploy));
  addPart(db, "ses_child", "m_child", BASE_MS + 61 * SECOND_MS, bashPart("oso-state status"));
  addPart(db, "ses_child", "m_child", BASE_MS + 62 * SECOND_MS, taskPart);
  addMessage(db, "m_old", "ses_old", "assistant");
  addPart(db, "ses_old", "m_old", NOW_MS - 100 * DAY_MS, denialPart(DENIAL_TEXTS.commit));
  return fixture;
}

test("the OpenCode reader classifies denials, pushes, oso-state calls, turns, launches and mode into hand-counted totals", () => {
  const { file } = buildFullFixture();
  const tree = classifyOpenCodeDb(file);
  assert.deepEqual(tree.sessions.map((session) => session.sessionId).sort(), ["ses_old", "ses_root"]);
  const report = aggregate(tree, 60, NOW_MS);
  assert.equal(report.sessions_scanned, 1);
  assert.deepEqual(report.gates.commit, { events: 1, sessions: 1 });
  assert.deepEqual(report.gates.edits, { events: 1, sessions: 1 });
  assert.deepEqual(report.gates.proddeploy, { events: 2, sessions: 1 });
  assert.deepEqual(report.gates.autocontinue, { events: 4, sessions: 1 });
  assert.deepEqual(report.gates.stale, { events: 2, sessions: 1 });
  assert.deepEqual(report.gates.unknown, { events: 1, sessions: 1 });
  assert.deepEqual(report.gates.reanchor, { events: 1, sessions: 1 });
  assert.deepEqual(report.gates.preflight, { events: 1, sessions: 1 });
  assert.deepEqual(report.gates.unclassified, { events: 1, sessions: 1 });
  assert.equal(report.stop_net_bursts, 1);
  assert.deepEqual(report.oso_state_calls, { total: 2, per_session_median: 2, max: 2 });
  assert.deepEqual(report.modes.plan, { sessions: 1, median_turns: 2, median_agent_launches: 1, median_oso_state_calls: 2 });
  assert.deepEqual(report.unclassified_session_ids, ["ses_root"]);
  assert.equal(report.skipped_lines, 0);
});

test("a subagent session's denials are attributed to its root and its own work is not counted", () => {
  const { file } = buildFullFixture();
  const root = classifyOpenCodeDb(file).sessions.find((session) => session.sessionId === "ses_root");
  assert.ok(root);
  assert.equal(root.denials.filter((denial) => denial.gate === "proddeploy").length, 2);
  assert.equal(root.osoStateCalls, 2);
  assert.equal(root.agentLaunches, 1);
  assert.equal(root.hasMainTranscript, true);
});

test("the window follows session.time_updated, not time_created", () => {
  const { db, file } = newFixture();
  addSession(db, "ses_touched", null, NOW_MS - 200 * DAY_MS, NOW_MS - DAY_MS);
  addSession(db, "ses_stale", null, NOW_MS - DAY_MS, NOW_MS - 90 * DAY_MS);
  db.close();
  const tree = classifyOpenCodeDb(file);
  const windowed = aggregate(tree, 60, NOW_MS);
  assert.equal(windowed.sessions_scanned, 1);
  assert.equal(tree.sessions.find((session) => session.sessionId === "ses_touched")?.mtimeMs, NOW_MS - DAY_MS);
});

test("a database missing a required table fails with an explicit schema error", () => {
  const { file } = newFixture(SCHEMA.slice(0, 2));
  assert.throws(() => classifyOpenCodeDb(file), /^Error: OpenCode schema unrecognized: missing table part$/);
});

test("a database missing a required column fails with an explicit schema error", () => {
  const { file } = newFixture([
    "CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)",
    ...SCHEMA.slice(1),
  ]);
  assert.throws(() => classifyOpenCodeDb(file), /OpenCode schema unrecognized: missing column session\.parent_id/);
});

test("a missing database file fails without creating it", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "friction-oc-")), "absent.db");
  assert.throws(() => classifyOpenCodeDb(file));
  assert.equal(existsSync(file), false);
});

test("the database is opened read-only", () => {
  const { db, file } = buildFullFixture();
  db.close();
  const before = new DatabaseSync(file, { readOnly: true }).prepare("SELECT count(*) AS n FROM part").get();
  classifyOpenCodeDb(file);
  const after = new DatabaseSync(file, { readOnly: true }).prepare("SELECT count(*) AS n FROM part").get();
  assert.deepEqual(after, before);
});

test("the CLI reads OpenCode sessions and prints counts and session ids, never content", () => {
  const { db, file } = buildFullFixture();
  db.close();
  const result = spawnSync(
    process.execPath,
    [CLI_PATH, "--host", "opencode", "--opencode-db", file, "--days", "36500", "--json"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sessions_scanned, 2);
  assert.deepEqual(report.unclassified_session_ids, ["ses_root"]);
  assert.doesNotMatch(result.stdout, /no table knows|continue the run|production deploy/);
});

test("the CLI rejects an unknown host with a one-line message", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--host", "vim"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^friction-baseline: --host must be claude or opencode, got vim\n$/);
});
