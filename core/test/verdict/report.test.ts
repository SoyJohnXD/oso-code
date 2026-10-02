import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readVerdictShape } from "../../src/verdict/grammar.ts";
import {
  type Marker,
  readVerdicts,
  type VerdictLogEntry,
  type VerdictRecord,
} from "../../src/verdict/record.ts";
import {
  type GreensRead,
  renderReportTable,
  unreceiptedGreensIn,
  type VerdictMetrics,
  verdictMetrics,
} from "../../src/verdict/report.ts";
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

describe("the verdict report reads the records after each arm marker of their slice", () => {
  const log = readVerdicts(FIXTURE);
  const metrics = verdictMetrics(log, { kind: "read", greens: unreceiptedGreensIn(EVENTS) }, null);

  test("two of four armings opened on a fail, so the first-fail rate is 50.0 %", () => {
    assert.equal(metrics.slices, 4);
    assert.equal(metrics.first_fail_rate_percent, 50);
    assert.match(renderReportTable(metrics), /first-fail rate\s+50\.0 % \(2 of 4 slices\)/);
  });

  test("the slice that took three verifier rounds sets the maximum, and the median is 1.5", () => {
    assert.deepEqual(metrics.rounds_per_slice, { max: 3, median: 1.5 });
  });

  test("a fail recorded before a newer arm marker of its slice still counts for its own arming, a slice never armed does not", () => {
    assert.deepEqual(metrics.verdicts_by_model, [
      { model: "opus", pass: 1, fail: 3, blocked: 0, none: 0 },
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
    const omitted = verdictMetrics(log, { kind: "omitted", reason: "events.jsonl is absent" }, null);
    assert.deepEqual(omitted.unreceipted_greens, { omitted: "events.jsonl is absent" });
    assert.match(renderReportTable(omitted), /unreceipted greens\s+omitted: events\.jsonl is absent/);
  });
});

function armedBy(change: string, time: string): Marker {
  return { kind: "arm", slice: "1", session: `ses-${change}`, change, time };
}

function markedBy(kind: Marker["kind"], time: string): Marker {
  return { kind, slice: "1", session: "ses-alpha", change: "alpha", time };
}

function verifiedBy(change: string, time: string, verdict: VerdictRecord["verdict"]): VerdictRecord {
  return {
    time,
    host: "claude",
    session: `ses-${change}`,
    change,
    slice: "1",
    attempt: 1,
    role: "verifier",
    model: "opus",
    verdict,
    verdict_shape: "valid",
    escalated: false,
  };
}

describe("the verdict report counts each arming of a reused slice id as its own slice", () => {
  const entries: VerdictLogEntry[] = [
    armedBy("alpha", "2026-09-01T10:00:00Z"),
    verifiedBy("alpha", "2026-09-01T10:05:00Z", "fail"),
    verifiedBy("alpha", "2026-09-01T10:10:00Z", "pass"),
    armedBy("beta", "2026-09-02T09:00:00Z"),
    verifiedBy("beta", "2026-09-02T09:05:00Z", "pass"),
  ];
  const metrics = verdictMetrics({ entries, skippedLines: 0 }, { kind: "omitted", reason: "not read" }, null);

  test("slice 1 armed by alpha and re-armed by beta reads as two slices, one of them opened on a fail", () => {
    assert.equal(metrics.slices, 2);
    assert.equal(metrics.first_fail_rate_percent, 50);
    assert.match(renderReportTable(metrics), /first-fail rate\s+50\.0 % \(1 of 2 slices\)/);
  });

  test("alpha's two rounds still set the maximum after beta re-armed the slice", () => {
    assert.deepEqual(metrics.rounds_per_slice, { max: 2, median: 1.5 });
    assert.deepEqual(metrics.verdicts_by_model, [{ model: "opus", pass: 2, fail: 1, blocked: 0, none: 0 }]);
  });
});

describe("the report counts the armed slice's rounds since its arming and since its newest diagnosis", () => {
  const armedWithTwoFails: VerdictLogEntry[] = [
    armedBy("alpha", "2026-09-01T10:00:00Z"),
    verifiedBy("alpha", "2026-09-01T10:01:00Z", "fail"),
    verifiedBy("alpha", "2026-09-01T10:02:00Z", "fail"),
  ];
  const notRead: GreensRead = { kind: "omitted", reason: "not read" };

  function metricsOf(entries: readonly VerdictLogEntry[], armedSlice: string | null): VerdictMetrics {
    return verdictMetrics({ entries, skippedLines: 0 }, notRead, armedSlice);
  }

  test("an empty-result marker counts one round beside the verifier verdicts", () => {
    const metrics = metricsOf([...armedWithTwoFails, markedBy("empty-result", "2026-09-01T10:03:00Z")], "1");
    assert.deepEqual(metrics.active_slice, {
      slice: "1",
      verdicts: ["fail", "fail"],
      rounds: 3,
      rounds_since_diagnosis: null,
    });
    assert.match(renderReportTable(metrics), /^active slice\s+1: 3 rounds, no diagnosis yet; verdicts fail, fail$/m);
  });

  test("a diagnosed marker restarts the rounds since diagnosis at 0 while the rounds keep counting", () => {
    const diagnosed = [...armedWithTwoFails, markedBy("diagnosed", "2026-09-01T10:03:00Z")];
    assert.deepEqual(metricsOf(diagnosed, "1").active_slice, {
      slice: "1",
      verdicts: ["fail", "fail"],
      rounds: 2,
      rounds_since_diagnosis: 0,
    });
    const refailed = metricsOf([...diagnosed, verifiedBy("alpha", "2026-09-01T10:04:00Z", "fail")], "1");
    assert.equal(refailed.active_slice?.rounds, 3);
    assert.equal(refailed.active_slice?.rounds_since_diagnosis, 1);
    assert.match(renderReportTable(refailed), /^active slice\s+1: 3 rounds, 1 since diagnosis; verdicts fail, fail, fail$/m);
  });

  test("four verifier rounds read no slice as escalated, and an escalated marker counts its arming once", () => {
    const fourRounds = [
      ...armedWithTwoFails,
      verifiedBy("alpha", "2026-09-01T10:03:00Z", "fail"),
      verifiedBy("alpha", "2026-09-01T10:04:00Z", "pass"),
    ];
    assert.equal(metricsOf(fourRounds, "1").escalated_slices, 0);
    const escalated = metricsOf(
      [...fourRounds, markedBy("escalated", "2026-09-01T10:05:00Z"), markedBy("escalated", "2026-09-01T10:06:00Z")],
      "1",
    );
    assert.equal(escalated.escalated_slices, 1);
    assert.match(renderReportTable(escalated), /^escalated slices\s+1$/m);
  });

  test("with no armed slice the row says so and its JSON value is null", () => {
    const metrics = metricsOf(armedWithTwoFails, null);
    assert.equal(metrics.active_slice, null);
    assert.match(renderReportTable(metrics), /^active slice\s+none — no slice is armed$/m);
  });

  test("an armed slice with no round since its arming reads 0 rounds", () => {
    const metrics = metricsOf(armedWithTwoFails, "2");
    assert.deepEqual(metrics.active_slice, { slice: "2", verdicts: [], rounds: 0, rounds_since_diagnosis: null });
    assert.match(
      renderReportTable(metrics),
      /^active slice\s+2: 0 rounds, no diagnosis yet; no verifier verdict since its arming$/m,
    );
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
