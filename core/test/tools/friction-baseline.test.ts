import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  aggregate,
  classifyTree,
  renderJson,
  renderTable,
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
  assert.equal(tree.skipped_lines, 1);
  assert.equal(tree.unreadable_files, 0);
  assert.equal(tree.sessions.length, 2);
});

test("an unreadable transcript is counted in unreadable_files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "friction-"));
  mkdirSync(path.join(root, "proj"));
  symlinkSync(path.join(root, "missing-target"), path.join(root, "proj", "dangling.jsonl"));
  const tree = classifyTree(root);
  assert.equal(tree.unreadable_files, 1);
  assert.equal(tree.sessions.length, 0);
});

const NOW_MS = Date.parse("2026-09-28T00:00:00.000Z");
const DAY_MS = 86_400_000;

function sessionWith(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    sessionId: "s",
    mtimeMs: NOW_MS,
    mode: null,
    turns: 0,
    agentLaunches: 0,
    osoStateCalls: 0,
    denials: [],
    stopNetTimestamps: [],
    ...overrides,
  };
}

function treeOf(...sessions: SessionRecord[]): TreeClassification {
  return { sessions, skipped_lines: 0, unreadable_files: 0 };
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
  ];
  for (const output of outputs) {
    for (const text of fixtureText) assert.equal(output.includes(text), false, `leaked: ${text}`);
    assert.match(output, /sess-1/);
  }
  assert.equal(report.skipped_lines, 1);
  assert.equal(report.unreadable_files, 0);
  assert.equal(report.gates.autocontinue.events, 1);
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
  assert.equal(JSON.parse(result.stdout).sessions_scanned, 2);
});
