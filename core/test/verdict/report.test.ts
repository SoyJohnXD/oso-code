import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readVerdictShape } from "../../src/verdict/grammar.ts";
import { readVerdicts } from "../../src/verdict/record.ts";
import { renderReportTable, unreceiptedGreensIn, verdictMetrics } from "../../src/verdict/report.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const FIXTURE = path.join(repositoryRoot, "core", "test", "fixtures", "verdicts", "report.jsonl");

function loggedEvent(session: string, event: string, command: string): string {
  return JSON.stringify({ ts: "2026-09-01T10:20:00Z", event, command, session, client: "", schema: 2 });
}

const EVENTS = [
  loggedEvent("ses-a", "set:active_slice=none verify_green=true", ""),
  loggedEvent("ses-a", "verify-green-unreceipted", "2"),
  loggedEvent("ses-b", "verify-green-unreceipted", "3"),
  loggedEvent("ses-elsewhere", "verify-green-unreceipted", "1"),
  "not an event",
].join("\n");

describe("the verdict report reads the records after each slice's newest arm marker", () => {
  const log = readVerdicts(FIXTURE);
  const metrics = verdictMetrics(log, { kind: "read", greens: unreceiptedGreensIn(EVENTS) });

  test("one of three armed slices opened on a fail, so the first-fail rate is 33.3 %", () => {
    assert.equal(metrics.slices, 3);
    assert.equal(metrics.first_fail_rate_percent, 33.3);
    assert.match(renderReportTable(metrics), /first-fail rate\s+33\.3 % \(1 of 3 slices\)/);
  });

  test("the slice that took three verifier rounds sets the maximum, and the median is 2", () => {
    assert.deepEqual(metrics.rounds_per_slice, { max: 3, median: 2 });
  });

  test("a fail recorded before a newer arm marker of its slice never counts, nor a slice never armed", () => {
    assert.deepEqual(metrics.verdicts_by_model, [
      { model: "opus", pass: 1, fail: 2, blocked: 0, none: 0 },
      { model: "sonnet", pass: 1, fail: 0, blocked: 0, none: 0 },
      { model: null, pass: 1, fail: 0, blocked: 0, none: 1 },
    ]);
  });

  test("the malformed verifier report is counted and the line that is no record is skipped and counted", () => {
    assert.equal(metrics.malformed, 1);
    assert.equal(metrics.skipped_lines, 1);
  });

  test("each verify-green-unreceipted event of a session armed here counts; a set green and a foreign session's do not", () => {
    assert.deepEqual(metrics.unreceipted_greens, { count: 2 });
  });

  test("an events log that could not be read is omitted and the reason said", () => {
    const omitted = verdictMetrics(log, { kind: "omitted", reason: "events.jsonl is absent" });
    assert.deepEqual(omitted.unreceipted_greens, { omitted: "events.jsonl is absent" });
    assert.match(renderReportTable(omitted), /unreceipted greens\s+omitted: events\.jsonl is absent/);
  });
});

describe("a report's verdict shape", () => {
  test("a report with no verdict line is malformed and records verdict none", () => {
    assert.deepEqual(readVerdictShape("status: done\nall criteria hold\n"), { verdict: "none", verdict_shape: "malformed" });
  });

  test("a verdict line outside the vocabulary is malformed", () => {
    assert.deepEqual(readVerdictShape("verdict: maybe\n"), { verdict: "none", verdict_shape: "malformed" });
  });

  test("a blocked verdict line is valid", () => {
    assert.deepEqual(readVerdictShape("the bar could not run\nverdict: BLOCKED\n"), {
      verdict: "blocked",
      verdict_shape: "valid",
    });
  });
});
