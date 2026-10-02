import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { isPrivateRegularFile, splitPair } from "../../src/state/store.ts";
import {
  appendMarker,
  appendVerdict,
  newlyArmedSliceOf,
  readVerdicts,
  type VerdictCapture,
  verifierRecordsSinceArm,
} from "../../src/verdict/record.ts";

const CAPTURE: VerdictCapture = {
  host: "claude",
  session: "ses-record",
  change: "alpha",
  slice: "2",
  role: "verifier",
  model: "opus",
  verdict: "fail",
  verdict_shape: "valid",
};

let stateDirectory = "";
let verdictsFile = "";

beforeEach(() => {
  stateDirectory = mkdtempSync(path.join(tmpdir(), "oso-verdicts-"));
  process.env["OSO_STATE_DIR"] = stateDirectory;
  verdictsFile = path.join(stateDirectory, "runs", "repo", "verdicts.jsonl");
});

afterEach(() => {
  delete process.env["OSO_STATE_DIR"];
  rmSync(stateDirectory, { recursive: true, force: true });
});

describe("the verdict record writer", () => {
  test("attempt counts the slice's verifier records since its newest arm marker, and never another slice's", () => {
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendVerdict(verdictsFile, { ...CAPTURE, role: "applier" });
    appendVerdict(verdictsFile, { ...CAPTURE, slice: "5" });
    appendVerdict(verdictsFile, CAPTURE);
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "beta" });
    appendVerdict(verdictsFile, CAPTURE);
    const attempts = readVerdicts(verdictsFile).entries.flatMap((entry) => ("attempt" in entry ? [entry.attempt] : []));
    assert.deepEqual(attempts, [1, 2, 1, 2, 1]);
  });

  test("a record with a null slice reads back whole and joins no armed slice", () => {
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, { ...CAPTURE, slice: null });
    const log = readVerdicts(verdictsFile);
    assert.deepEqual(
      log.entries.flatMap((entry) => ("attempt" in entry ? [{ slice: entry.slice, attempt: entry.attempt }] : [])),
      [{ slice: null, attempt: 1 }],
    );
    assert.equal(log.skippedLines, 0);
    assert.deepEqual(verifierRecordsSinceArm(log.entries, null), []);
    assert.deepEqual(verifierRecordsSinceArm(log.entries, "2"), []);
  });

  test("each record is one JSON line in the ledger's field order, in an owner-only file", () => {
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: null });
    appendVerdict(verdictsFile, CAPTURE);
    const lines = readFileSync(verdictsFile, "utf8").trimEnd().split("\n");
    const [marker, record] = lines.map((line) => Object.keys(JSON.parse(line) as object));
    assert.deepEqual(marker, ["kind", "slice", "session", "change", "time"]);
    assert.deepEqual(record, [
      "time",
      "host",
      "session",
      "change",
      "slice",
      "attempt",
      "role",
      "model",
      "verdict",
      "verdict_shape",
      "escalated",
    ]);
    assert.ok(isPrivateRegularFile(verdictsFile));
  });

  test("a record is escalated only when its slice's newest arming already carries an escalated marker", () => {
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendMarker(verdictsFile, { kind: "escalated", slice: "5", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendMarker(verdictsFile, { kind: "escalated", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "beta" });
    appendVerdict(verdictsFile, CAPTURE);
    const records = readVerdicts(verdictsFile).entries.flatMap((entry) => ("attempt" in entry ? [entry] : []));
    assert.deepEqual(
      records.map(({ attempt, escalated }) => ({ attempt, escalated })),
      [
        { attempt: 1, escalated: false },
        { attempt: 2, escalated: false },
        { attempt: 3, escalated: true },
        { attempt: 1, escalated: false },
      ],
    );
  });

  test("a mark reads back as a marker of its slice in the arm marker's field order, and an unknown kind is skipped", () => {
    appendMarker(verdictsFile, { kind: "arm", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendMarker(verdictsFile, { kind: "empty-result", slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendFileSync(verdictsFile, `${JSON.stringify({ kind: "fixed", slice: "2", session: "ses-record", change: null, time: "t" })}\n`);
    const lines = readFileSync(verdictsFile, "utf8").trimEnd().split("\n");
    assert.deepEqual(Object.keys(JSON.parse(lines[2] ?? "{}") as object), ["kind", "slice", "session", "change", "time"]);
    const log = readVerdicts(verdictsFile);
    assert.deepEqual(
      log.entries.map((entry) => ("kind" in entry ? entry.kind : entry.attempt)),
      ["arm", 1, "empty-result", 2],
    );
    assert.equal(log.skippedLines, 1);
  });

  test("a write that fails returns false and logs telemetry-write-failed instead of throwing", () => {
    writeFileSync(path.join(stateDirectory, "runs"), "a file where the runs directory belongs");
    assert.equal(appendVerdict(verdictsFile, CAPTURE), false);
    const events = readFileSync(path.join(stateDirectory, "events.jsonl"), "utf8");
    assert.match(events, /"event":"telemetry-write-failed"/);
  });
});

function writtenOf(pairs: readonly string[]): ReadonlyMap<string, string> {
  return new Map(pairs.map(splitPair));
}

describe("the pairs that arm a slice", () => {
  test("active_slice=<X> together with verify_green=false arms X over no slice or another slice", () => {
    assert.equal(newlyArmedSliceOf("none", writtenOf(["mode=plan", "active_slice=3", "verify_green=false"])), "3");
    assert.equal(newlyArmedSliceOf("2", writtenOf(["active_slice=3", "verify_green=false"])), "3");
  });

  test("active_slice=none, a slice without verify_green=false, or a green slice arms nothing", () => {
    assert.equal(newlyArmedSliceOf("none", writtenOf(["active_slice=none", "verify_green=false"])), undefined);
    assert.equal(newlyArmedSliceOf("none", writtenOf(["active_slice=3"])), undefined);
    assert.equal(newlyArmedSliceOf("none", writtenOf(["active_slice=3", "verify_green=true"])), undefined);
  });

  test("naming the slice already armed again, as a resume does, arms nothing", () => {
    assert.equal(newlyArmedSliceOf("3", writtenOf(["mode=plan", "active_slice=3", "verify_green=false"])), undefined);
  });
});
