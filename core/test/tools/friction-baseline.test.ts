import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregate,
  classifyTranscript,
  classifyTree,
  renderJson,
  renderTable,
  type Delegation,
  type SessionRecord,
  type TreeClassification,
} from "../../../tools/friction-baseline.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/friction/root", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("../../../tools/friction-baseline.ts", import.meta.url));

function sessionNamed(tree: TreeClassification, sessionId: string): SessionRecord {
  const record = tree.sessions.find((session) => session.sessionId === sessionId);
  assert.ok(record, `session ${sessionId} was not classified`);
  return record;
}

test("quoted denial text in user messages, hand-backs, skill bodies and non-denial errors is not counted", () => {
  const record = sessionNamed(classifyTree(FIXTURE_ROOT), "sess-1");
  assert.equal(record.denials.filter((denial) => denial.gate === "commit").length, 1);
  assert.equal(record.denials.filter((denial) => denial.gate === "edits").length, 1);
});

test("structural denials are counted by gate with their timestamps, subagent denials go to the parent session", () => {
  const record = sessionNamed(classifyTree(FIXTURE_ROOT), "sess-1");
  assert.deepEqual(record.denials, [
    { gate: "commit", timestamp: "2026-09-01T10:00:08.000Z" },
    { gate: "edits", timestamp: "2026-09-01T10:00:09.000Z" },
    { gate: "unclassified", timestamp: "2026-09-01T10:00:10.000Z" },
    { gate: "proddeploy", timestamp: "2026-09-01T10:01:02.000Z" },
  ]);
});

test("the Stop-net block is counted once, not again by its stop_hook_summary echo", () => {
  const record = sessionNamed(classifyTree(FIXTURE_ROOT), "sess-1");
  assert.deepEqual(record.stopNetTimestamps, ["2026-09-01T10:00:11.000Z"]);
});

test("an oso-code denial matching no known phrase lands in unclassified", () => {
  const record = sessionNamed(classifyTree(FIXTURE_ROOT), "sess-1");
  assert.equal(record.denials.filter((denial) => denial.gate === "unclassified").length, 1);
});

test("main-session metrics come from the main file only", () => {
  const tree = classifyTree(FIXTURE_ROOT);
  const record = sessionNamed(tree, "sess-1");
  assert.equal(record.mode, "plan");
  assert.equal(record.turns, 3);
  assert.equal(record.agentLaunches, 2);
  assert.equal(record.osoStateCalls, 1);
  const bare = sessionNamed(tree, "sess-2");
  assert.deepEqual(
    { mode: bare.mode, turns: bare.turns, agentLaunches: bare.agentLaunches, osoStateCalls: bare.osoStateCalls, denials: bare.denials.length },
    { mode: null, turns: 1, agentLaunches: 0, osoStateCalls: 0, denials: 0 },
  );
});

test("malformed lines increment skipped_lines", () => {
  const tree = classifyTree(FIXTURE_ROOT);
  assert.equal(tree.skippedLines, 1);
  assert.equal(tree.unreadableFiles, 0);
  assert.equal(tree.sessions.length, 3);
});

test("an unreadable transcript is counted in unreadable_files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "friction-"));
  mkdirSync(path.join(root, "proj"));
  symlinkSync(path.join(root, "missing-target"), path.join(root, "proj", "dangling.jsonl"));
  const tree = classifyTree(root);
  assert.equal(tree.unreadableFiles, 1);
  assert.equal(tree.sessions.length, 0);
});

function bashLine(id: string, command: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-01T10:00:00.000Z",
    message: { id: `msg-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  });
}

function osoStateCallsIn(...commands: string[]): number {
  const text = commands.map((command, index) => bashLine(`t${index}`, command)).join("\n");
  return classifyTranscript(text, "main").osoStateCalls;
}

test("the pure classifier turns transcript text into facts without touching the filesystem", () => {
  const text = [
    JSON.stringify({ type: "user", message: { content: "<command-name>/oso-code:quick</command-name>" } }),
    bashLine("t1", "oso-state status"),
    "not json",
  ].join("\n");
  const facts = classifyTranscript(text, "main");
  assert.deepEqual(
    { mode: facts.mode, turns: facts.turns, osoStateCalls: facts.osoStateCalls, skippedLines: facts.skippedLines },
    { mode: "quick", turns: 1, osoStateCalls: 1, skippedLines: 1 },
  );
});

test("oso-state invocations count, including bin overrides, paths and shell function bodies", () => {
  assert.equal(osoStateCallsIn("oso-state status"), 1);
  assert.equal(osoStateCallsIn('"${OSO_STATE_BIN:-oso-state}" --session s1 verify'), 1);
  assert.equal(osoStateCallsIn("./plugin/bin/oso-state scan comments abc"), 1);
  assert.equal(osoStateCallsIn("cd plugin && oso-state status | head"), 1);
  assert.equal(osoStateCallsIn('O(){ "${OSO_STATE_BIN:-oso-state}" "$@"; }\nO status\nO verify'), 1);
  assert.equal(osoStateCallsIn("oso-state status", "oso-state verify"), 2);
});

test("oso-state named as an argument or a path being read is not a call", () => {
  assert.equal(osoStateCallsIn("rg oso-state core/src"), 0);
  assert.equal(osoStateCallsIn("ls plugin/bin/oso-state"), 0);
  assert.equal(osoStateCallsIn("cat plugin/bin/oso-state"), 0);
  assert.equal(osoStateCallsIn("grep -r oso-state . | wc -l"), 0);
  assert.equal(osoStateCallsIn("git commit -m 'fix oso-state'"), 0);
  assert.equal(osoStateCallsIn("oso-state-helper run"), 0);
});

test("a session directory with only subagent transcripts keeps its denials but is not a scanned session", () => {
  const root = mkdtempSync(path.join(tmpdir(), "friction-"));
  const subagents = path.join(root, "proj", "orphan", "subagents");
  mkdirSync(subagents, { recursive: true });
  const denial = JSON.stringify({
    type: "user",
    timestamp: "2026-09-01T10:01:02.000Z",
    message: {
      content: [
        {
          type: "tool_result",
          is_error: true,
          content:
            "PreToolUse:Bash hook error: oso-code: an unattended run is in flight, so a production deploy stays with the operator.",
        },
      ],
    },
  });
  writeFileSync(path.join(subagents, "agent-x.jsonl"), `${denial}\n`);
  const report = aggregate(classifyTree(root), 36500, Date.now());
  assert.equal(report.sessions_scanned, 0);
  assert.deepEqual(report.gates.proddeploy, { events: 1, sessions: 1 });
  assert.deepEqual(report.oso_state_calls, { total: 0, per_session_median: null, max: 0 });
  assert.equal(report.modes.plan.median_turns, null);
});

const NOW_MS = Date.parse("2026-09-28T00:00:00.000Z");
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function sessionWith(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    sessionId: "s",
    mtimeMs: NOW_MS,
    hasMainTranscript: true,
    mode: null,
    turns: 0,
    agentLaunches: 0,
    osoStateCalls: 0,
    denials: [],
    stopNetTimestamps: [],
    delegations: [],
    subagentWrites: [],
    ...overrides,
  };
}

function treeOf(...sessions: SessionRecord[]): TreeClassification {
  return { sessions, skippedLines: 0, unreadableFiles: 0 };
}

function stopNetAt(...secondsFromStart: number[]): string[] {
  const start = Date.parse("2026-09-20T00:00:00.000Z");
  return secondsFromStart.map((seconds) => new Date(start + seconds * 1000).toISOString());
}

test("three Stop blocks with consecutive gaps of exactly 60 s form a burst", () => {
  const report = aggregate(treeOf(sessionWith({ stopNetTimestamps: stopNetAt(0, 60, 120) })), 60, NOW_MS);
  assert.equal(report.stop_net_bursts, 1);
});

test("a 61 s gap breaks the burst", () => {
  const report = aggregate(treeOf(sessionWith({ stopNetTimestamps: stopNetAt(0, 60, 121) })), 60, NOW_MS);
  assert.equal(report.stop_net_bursts, 0);
});

test("a long run of close blocks is one burst and two separate runs are two", () => {
  const report = aggregate(
    treeOf(sessionWith({ stopNetTimestamps: stopNetAt(0, 5, 10, 15, 20, 1000, 1005, 1010) })),
    60,
    NOW_MS,
  );
  assert.equal(report.stop_net_bursts, 2);
});

test("Stop-net blocks count as gate autocontinue alongside denials", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        denials: [
          { gate: "autocontinue", timestamp: "" },
          { gate: "commit", timestamp: "" },
        ],
        stopNetTimestamps: stopNetAt(0, 5),
      }),
      sessionWith({ sessionId: "other", denials: [{ gate: "commit", timestamp: "" }] }),
    ),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.gates.autocontinue, { events: 3, sessions: 1 });
  assert.deepEqual(report.gates.commit, { events: 2, sessions: 2 });
  assert.deepEqual(report.gates.stale, { events: 0, sessions: 0 });
});

test("per-mode medians use the middle value, average the middle pair, and are null for an empty mode", () => {
  const report = aggregate(
    treeOf(
      sessionWith({ mode: "plan", turns: 10, agentLaunches: 1, osoStateCalls: 4 }),
      sessionWith({ mode: "plan", turns: 30, agentLaunches: 3, osoStateCalls: 6 }),
      sessionWith({ mode: "plan", turns: 20, agentLaunches: 2, osoStateCalls: 5 }),
      sessionWith({ mode: "quick", turns: 4, agentLaunches: 0, osoStateCalls: 1 }),
      sessionWith({ mode: "quick", turns: 8, agentLaunches: 1, osoStateCalls: 2 }),
    ),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.modes.plan, {
    sessions: 3,
    median_turns: 20,
    median_agent_launches: 2,
    median_oso_state_calls: 5,
  });
  assert.deepEqual(report.modes.quick, {
    sessions: 2,
    median_turns: 6,
    median_agent_launches: 0.5,
    median_oso_state_calls: 1.5,
  });
  assert.deepEqual(report.modes.debug, {
    sessions: 0,
    median_turns: null,
    median_agent_launches: null,
    median_oso_state_calls: null,
  });
  assert.deepEqual(report.oso_state_calls, { total: 18, per_session_median: 4, max: 6 });
});

test("an empty window renders null medians as n/a in the table", () => {
  const table = renderTable(aggregate(treeOf(), 60, NOW_MS));
  assert.match(table, /per-session median n\/a, max 0/);
  assert.match(table, /debug\s+0\s+n\/a\s+n\/a\s+n\/a/);
});

test("a session whose mtime is older than the window is excluded", () => {
  const report = aggregate(
    treeOf(
      sessionWith({ sessionId: "fresh", mtimeMs: NOW_MS - 59 * DAY_MS, osoStateCalls: 2 }),
      sessionWith({ sessionId: "stale", mtimeMs: NOW_MS - 61 * DAY_MS, osoStateCalls: 9 }),
    ),
    60,
    NOW_MS,
  );
  assert.equal(report.sessions_scanned, 1);
  assert.equal(report.oso_state_calls.total, 2);
});

test("unclassified denials are bucketed and their session ids listed", () => {
  const report = aggregate(
    treeOf(sessionWith({ sessionId: "odd", denials: [{ gate: "unclassified", timestamp: "" }] })),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.gates.unclassified, { events: 1, sessions: 1 });
  assert.deepEqual(report.unclassified_session_ids, ["odd"]);
});

test("rendered table and JSON hold no fixture message text, only counts, gate names, modes and session ids", () => {
  const report = aggregate(classifyTree(FIXTURE_ROOT), 36500, Date.now());
  const outputs = [renderTable(report), renderJson(report)];
  const fixtureText = [
    "Finish the",
    "brand new refusal",
    "why did I see",
    "Skill body",
    "Activate it first",
    "some other plugin",
    "without parking",
    "Describe the liveness task",
    "liveness prompt prose",
    "Liveness summary prose",
    "liveness result prose",
    "subagent working prose",
    "agent3",
    "tu-30",
  ];
  for (const output of outputs) {
    for (const text of fixtureText) assert.equal(output.includes(text), false, `leaked: ${text}`);
    assert.match(output, /sess-1/);
  }
  assert.equal(report.skipped_lines, 1);
  assert.equal(report.unreadable_files, 0);
  assert.equal(report.gates.autocontinue.events, 3);
  assert.deepEqual(report.delegation_liveness.stop_net_blocks, { delegation_in_flight: 2, none_in_flight: 1 });
  assert.equal(report.delegation_liveness.launch_to_completion.max_ms, 50 * MINUTE_MS);
  assert.equal(report.delegation_liveness.lingering.max_ms, 10 * MINUTE_MS);
  assert.equal(report.delegation_liveness.idle_gaps.max_ms, 35 * MINUTE_MS);
  assert.match(outputs[0] ?? "", /delegation liveness/);
  assert.equal(report.modes.plan.sessions, 1);
  assert.deepEqual(JSON.parse(outputs[1] ?? ""), report);
});

test("the CLI exits non-zero with a one-line stderr message for a missing root", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--root", "/nonexistent-friction-root"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^friction-baseline: [^\n]*\n$/);
});

test("the CLI prints parseable JSON for a fixture root", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--root", FIXTURE_ROOT, "--days", "36500", "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).sessions_scanned, 3);
});

const LAUNCH_MS = Date.parse("2026-09-20T00:00:00.000Z");

function minutesAfterLaunch(minutes: number): number {
  return LAUNCH_MS + minutes * MINUTE_MS;
}

function isoAt(minutes: number): string {
  return new Date(minutesAfterLaunch(minutes)).toISOString();
}

function delegation(overrides: Partial<Delegation>): Delegation {
  return { launchedAtMs: LAUNCH_MS, agentId: null, completion: null, ...overrides };
}

test("a Stop block while a launch is in flight counts as in flight, one after its completion as none in flight", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        delegations: [delegation({ completion: { atMs: minutesAfterLaunch(20), status: "completed" } })],
        stopNetTimestamps: [isoAt(10), isoAt(30)],
      }),
    ),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.delegation_liveness.stop_net_blocks, { delegation_in_flight: 1, none_in_flight: 1 });
});

test("a Stop block before any launch is none in flight, one while an orphan is still open is in flight", () => {
  const report = aggregate(
    treeOf(sessionWith({ delegations: [delegation({})], stopNetTimestamps: [isoAt(-5), isoAt(500)] })),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.delegation_liveness.stop_net_blocks, { delegation_in_flight: 1, none_in_flight: 1 });
});

test("launch to completion durations give nearest-rank percentiles, the max and the count of at least 45 minutes", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        delegations: [5, 10, 20, 45, 90].map((minutes) =>
          delegation({ completion: { atMs: minutesAfterLaunch(minutes), status: "completed" } }),
        ),
      }),
    ),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.delegation_liveness.launch_to_completion, {
    count: 5,
    p50_ms: 20 * MINUTE_MS,
    p90_ms: 90 * MINUTE_MS,
    p99_ms: 90 * MINUTE_MS,
    max_ms: 90 * MINUTE_MS,
    at_least_45_min: 2,
  });
});

test("idle gaps take each finished subagent's largest gap between writes and bucket the share by threshold", () => {
  const finished = (agentId: string) =>
    delegation({ agentId, completion: { atMs: minutesAfterLaunch(200), status: "completed" } });
  const report = aggregate(
    treeOf(
      sessionWith({
        delegations: [finished("quick"), finished("slow"), finished("stalled"), delegation({ agentId: "open" })],
        subagentWrites: [
          { agentId: "quick", writeTimesMs: [1, 2, 3].map(minutesAfterLaunch) },
          { agentId: "slow", writeTimesMs: [0, 20, 36].map(minutesAfterLaunch) },
          { agentId: "stalled", writeTimesMs: [0, 61, 70].map(minutesAfterLaunch) },
          { agentId: "open", writeTimesMs: [0, 150].map(minutesAfterLaunch) },
        ],
      }),
    ),
    60,
    NOW_MS,
  );
  const { idle_gaps } = report.delegation_liveness;
  assert.equal(idle_gaps.count, 3);
  assert.equal(idle_gaps.max_ms, 61 * MINUTE_MS);
  assert.equal(idle_gaps.p50_ms, 20 * MINUTE_MS);
  assert.deepEqual(idle_gaps.share_at_least, { "15m": 0.667, "30m": 0.333, "45m": 0.333, "60m": 0.333 });
});

test("writes after the completion signal are outside the finished subagent's idle gaps and lingering", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        delegations: [delegation({ agentId: "resumed", completion: { atMs: minutesAfterLaunch(30), status: "completed" } })],
        subagentWrites: [{ agentId: "resumed", writeTimesMs: [0, 25, 400].map(minutesAfterLaunch) }],
      }),
    ),
    60,
    NOW_MS,
  );
  assert.equal(report.delegation_liveness.idle_gaps.max_ms, 25 * MINUTE_MS);
  assert.equal(report.delegation_liveness.lingering.max_ms, 5 * MINUTE_MS);
});

test("lingering runs from the subagent's last write to its completion signal", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        delegations: [
          delegation({ agentId: "a", completion: { atMs: minutesAfterLaunch(12), status: "completed" } }),
          delegation({ agentId: "b", completion: { atMs: minutesAfterLaunch(40), status: "completed" } }),
          delegation({ completion: { atMs: minutesAfterLaunch(3), status: "completed" } }),
        ],
        subagentWrites: [
          { agentId: "a", writeTimesMs: [0, 10].map(minutesAfterLaunch) },
          { agentId: "b", writeTimesMs: [0, 39].map(minutesAfterLaunch) },
        ],
      }),
    ),
    60,
    NOW_MS,
  );
  assert.deepEqual(report.delegation_liveness.lingering, {
    count: 2,
    p50_ms: 1 * MINUTE_MS,
    p90_ms: 2 * MINUTE_MS,
    p99_ms: 2 * MINUTE_MS,
    max_ms: 2 * MINUTE_MS,
  });
});

test("an orphan launch and a killed completion are counted with the orphan's session id", () => {
  const report = aggregate(
    treeOf(
      sessionWith({
        sessionId: "with-orphan",
        delegations: [delegation({}), delegation({ completion: { atMs: minutesAfterLaunch(4), status: "killed" } })],
      }),
      sessionWith({
        sessionId: "clean",
        delegations: [delegation({ completion: { atMs: minutesAfterLaunch(4), status: "completed" } })],
      }),
    ),
    60,
    NOW_MS,
  );
  const liveness = report.delegation_liveness;
  assert.equal(liveness.launches, 3);
  assert.equal(liveness.orphans, 1);
  assert.deepEqual(liveness.orphan_session_ids, ["with-orphan"]);
  assert.deepEqual(liveness.statuses, { completed: 1, failed: 0, stopped: 0, killed: 1, other: 0 });
});

function transcriptOf(...events: object[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function agentLaunch(id: string, minutes: number): object {
  return {
    type: "assistant",
    timestamp: isoAt(minutes),
    message: { id: `msg-${id}`, content: [{ type: "tool_use", id, name: "Agent", input: { prompt: "p" } }] },
  };
}

function launchResult(toolUseId: string, minutes: number, toolUseResult: object, isError = false): object {
  return {
    type: "user",
    timestamp: isoAt(minutes),
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError, content: "r" }] },
    toolUseResult,
  };
}

function notification(tags: Record<string, string>): string {
  const body = Object.entries(tags)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join("\n");
  return `<task-notification>\n${body}\n<summary>s</summary>\n</task-notification>`;
}

test("the classifier pairs launches with the earliest structural notification and ignores quoted notifications", () => {
  const text = transcriptOf(
    agentLaunch("tu-a", 0),
    launchResult("tu-a", 0.1, { isAsync: true, status: "async_launched", agentId: "ag-a" }),
    { type: "user", timestamp: isoAt(1), message: { content: notification({ "tool-use-id": "tu-a", status: "failed" }) } },
    {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: isoAt(5),
      content: notification({ "task-id": "ag-a", "tool-use-id": "tu-a", status: "completed" }),
    },
    {
      type: "user",
      timestamp: isoAt(6),
      origin: { kind: "task-notification" },
      message: { content: notification({ "task-id": "ag-a", "tool-use-id": "tu-a", status: "completed" }) },
    },
    agentLaunch("tu-b", 10),
    launchResult("tu-b", 10.1, { isAsync: true, status: "async_launched", agentId: "ag-b" }),
    {
      type: "attachment",
      timestamp: isoAt(20),
      attachment: {
        type: "queued_command",
        commandMode: "task-notification",
        prompt: notification({ "task-id": "ag-b", status: "killed" }),
      },
    },
    agentLaunch("tu-c", 30),
    launchResult("tu-c", 32, { status: "completed", agentId: "ag-c" }),
    agentLaunch("tu-d", 40),
    launchResult("tu-d", 40.5, {}, true),
    agentLaunch("tu-e", 50),
    launchResult("tu-e", 50.1, { isAsync: true, status: "async_launched", agentId: "ag-e" }),
  );
  assert.deepEqual(classifyTranscript(text, "main").delegations, [
    { launchedAtMs: minutesAfterLaunch(0), agentId: "ag-a", completion: { atMs: minutesAfterLaunch(5), status: "completed" } },
    { launchedAtMs: minutesAfterLaunch(10), agentId: "ag-b", completion: { atMs: minutesAfterLaunch(20), status: "killed" } },
    { launchedAtMs: minutesAfterLaunch(30), agentId: "ag-c", completion: { atMs: minutesAfterLaunch(32), status: "completed" } },
    { launchedAtMs: minutesAfterLaunch(40), agentId: null, completion: { atMs: minutesAfterLaunch(40.5), status: "failed" } },
    { launchedAtMs: minutesAfterLaunch(50), agentId: "ag-e", completion: null },
  ]);
});

test("an unknown notification status is bucketed as other, never echoed", () => {
  const text = transcriptOf(agentLaunch("tu-x", 0), {
    type: "user",
    timestamp: isoAt(3),
    origin: { kind: "task-notification" },
    message: { content: notification({ "tool-use-id": "tu-x", status: "some free text" }) },
  });
  assert.deepEqual(classifyTranscript(text, "main").delegations, [
    { launchedAtMs: minutesAfterLaunch(0), agentId: null, completion: { atMs: minutesAfterLaunch(3), status: "other" } },
  ]);
});

test("the tree walk records each subagent's write times under the agent id its file names", () => {
  const record = sessionNamed(classifyTree(FIXTURE_ROOT), "sess-3");
  const writes = ["2026-09-03T08:00:01.000Z", "2026-09-03T08:05:00.000Z", "2026-09-03T08:40:00.000Z"];
  assert.deepEqual(record.subagentWrites, [{ agentId: "agent3", writeTimesMs: writes.map((iso) => Date.parse(iso)) }]);
  assert.equal(record.delegations.length, 1);
});

test("the table renders the liveness section with n/a for empty distributions", () => {
  const table = renderTable(aggregate(treeOf(), 60, NOW_MS));
  assert.match(table, /delegation liveness: 0 launches, 0 orphans/);
  assert.match(table, /stop-net blocks: 0 with a delegation in flight, 0 with none in flight/);
  assert.match(table, /launch->completion\s+0\s+n\/a\s+n\/a\s+n\/a\s+n\/a/);
});
