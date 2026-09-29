import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { isPrivateRegularFile } from "../../src/state/store.ts";
import {
  appendArmMarker,
  appendVerdict,
  armedSliceOf,
  readVerdicts,
  recordsSinceArm,
  type VerdictCapture,
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
  escalated: false,
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
    appendArmMarker(verdictsFile, { slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, CAPTURE);
    appendVerdict(verdictsFile, { ...CAPTURE, role: "applier" });
    appendVerdict(verdictsFile, { ...CAPTURE, slice: "5" });
    appendVerdict(verdictsFile, CAPTURE);
    appendArmMarker(verdictsFile, { slice: "2", session: "ses-record", change: "beta" });
    appendVerdict(verdictsFile, CAPTURE);
    const attempts = readVerdicts(verdictsFile).entries.flatMap((entry) => ("attempt" in entry ? [entry.attempt] : []));
    assert.deepEqual(attempts, [1, 2, 1, 2, 1]);
  });

  test("a record with a null slice reads back whole and joins no armed slice", () => {
    appendArmMarker(verdictsFile, { slice: "2", session: "ses-record", change: "alpha" });
    appendVerdict(verdictsFile, { ...CAPTURE, slice: null });
    const log = readVerdicts(verdictsFile);
    assert.deepEqual(
      log.entries.flatMap((entry) => ("attempt" in entry ? [{ slice: entry.slice, attempt: entry.attempt }] : [])),
      [{ slice: null, attempt: 1 }],
    );
    assert.equal(log.skippedLines, 0);
    assert.deepEqual(recordsSinceArm(log.entries), []);
  });

  test("each record is one JSON line in the ledger's field order, in an owner-only file", () => {
    appendArmMarker(verdictsFile, { slice: "2", session: "ses-record", change: null });
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

  test("a write that fails returns false and logs telemetry-write-failed instead of throwing", () => {
    writeFileSync(path.join(stateDirectory, "runs"), "a file where the runs directory belongs");
    assert.equal(appendVerdict(verdictsFile, CAPTURE), false);
    const events = readFileSync(path.join(stateDirectory, "events.jsonl"), "utf8");
    assert.match(events, /"event":"telemetry-write-failed"/);
  });
});

describe("the pairs that arm a slice", () => {
  test("active_slice=<X> together with verify_green=false arms X", () => {
    assert.equal(armedSliceOf(["mode=plan", "active_slice=3", "verify_green=false"]), "3");
  });

  test("active_slice=none, a slice without verify_green=false, or a green slice arms nothing", () => {
    assert.equal(armedSliceOf(["active_slice=none", "verify_green=false"]), undefined);
    assert.equal(armedSliceOf(["active_slice=3"]), undefined);
    assert.equal(armedSliceOf(["active_slice=3", "verify_green=true"]), undefined);
  });
});
