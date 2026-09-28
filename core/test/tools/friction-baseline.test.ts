import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyTree, type SessionRecord, type TreeClassification } from "../../../tools/friction-baseline.ts";

const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/friction/root", import.meta.url));

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
