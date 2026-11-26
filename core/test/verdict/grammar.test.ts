import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentVerdict, readLaunchToken, readSliceBlocks, readVerdictShape } from "../../src/verdict/grammar.ts";

test("parses an applier done status", () => {
  const parsed = parseAgentVerdict("finished the work\nstatus: done\n");
  assert.equal(parsed.status, "done");
});

test("parses an applier blocked status", () => {
  const parsed = parseAgentVerdict("status: blocked\n");
  assert.equal(parsed.status, "blocked");
});

test("parses a verifier pass verdict", () => {
  const parsed = parseAgentVerdict("everything checks out\nverdict: pass\n");
  assert.equal(parsed.verdict, "pass");
});

test("parses a verifier fail verdict", () => {
  const parsed = parseAgentVerdict("verdict: fail\n");
  assert.equal(parsed.verdict, "fail");
});

test("parses a verifier blocked verdict", () => {
  const parsed = parseAgentVerdict("the bar could not run\nverdict: blocked\n");
  assert.equal(parsed.verdict, "blocked");
});

test("parses both lines when present", () => {
  const parsed = parseAgentVerdict("status: blocked\nverdict: fail\n");
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.verdict, "fail");
});

test("tolerates spacing and capitalization", () => {
  const spaced = parseAgentVerdict("status : DONE");
  assert.equal(spaced.status, "done");
  const tight = parseAgentVerdict("verdict:FAIL");
  assert.equal(tight.verdict, "fail");
});

test("an unmatched report is not a verdict", () => {
  const parsed = parseAgentVerdict("the status of the work is done, prose everywhere");
  assert.deepEqual(parsed, {});
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.verdict, undefined);
});

test("empty text is not a verdict", () => {
  const parsed = parseAgentVerdict("");
  assert.deepEqual(parsed, {});
});

test("an unknown status value is not a verdict line", () => {
  const parsed = parseAgentVerdict("status: pending\n");
  assert.deepEqual(parsed, {});
});

test("a report with three slice blocks yields three verdicts each carrying its slice id", () => {
  const readings = readSliceBlocks(
    ["slice: s1", "verdict: pass", "", "slice: s2", "verdict: fail", "", "slice: s3", "verdict: blocked"].join("\n"),
  );
  assert.deepEqual(readings, [
    { slice: "s1", verdict: "pass", verdict_shape: "valid" },
    { slice: "s2", verdict: "fail", verdict_shape: "valid" },
    { slice: "s3", verdict: "blocked", verdict_shape: "valid" },
  ]);
});

test("a legacy single-verdict report keeps its last verdict and has no slice blocks", () => {
  const legacy = "verdict: fail\nnotes\nverdict: pass\n";
  assert.equal(parseAgentVerdict(legacy).verdict, "pass");
  assert.deepEqual(readVerdictShape(legacy), { verdict: "pass", verdict_shape: "valid" });
  assert.deepEqual(readSliceBlocks(legacy), []);
});

test("a block with a risk high line is flagged high risk", () => {
  const [block] = readSliceBlocks("slice: s1\nverdict: pass\nrisk: high touches the auth session store\n");
  assert.deepEqual(block, {
    slice: "s1",
    verdict: "pass",
    verdict_shape: "valid",
    highRisk: true,
  });
});

test("a risk line belongs to its own block only", () => {
  const readings = readSliceBlocks("slice: s1\nverdict: pass\nslice: s2\nverdict: pass\nrisk: high migration\n");
  assert.equal(readings[0]!.verdict_shape === "valid" && readings[0]!.highRisk, undefined);
  assert.equal(readings[1]!.verdict_shape === "valid" && readings[1]!.highRisk, true);
});

test("a block without a verdict is malformed for that block and keeps its sibling", () => {
  const readings = readSliceBlocks("slice: s1\nno verdict here\nslice: s2\nverdict: pass\n");
  assert.deepEqual(readings, [
    { slice: "s1", verdict: "none", verdict_shape: "malformed" },
    { slice: "s2", verdict: "pass", verdict_shape: "valid" },
  ]);
});

test("a block whose slice id cannot be parsed is malformed without a slice and keeps its sibling", () => {
  const readings = readSliceBlocks("slice: ../escape\nverdict: pass\nslice: s2\nverdict: fail\nslice:\nverdict: pass\n");
  assert.deepEqual(readings, [
    { verdict: "none", verdict_shape: "malformed" },
    { slice: "s2", verdict: "fail", verdict_shape: "valid" },
    { verdict: "none", verdict_shape: "malformed" },
  ]);
});

test("text before the first slice line is not part of any block", () => {
  const readings = readSliceBlocks("verdict: fail\nslice: s1\nverdict: pass\n");
  assert.deepEqual(readings, [{ slice: "s1", verdict: "pass", verdict_shape: "valid" }]);
});

test("reads the launch token line and none when the report carries no token", () => {
  assert.equal(readLaunchToken("token: t-1.a\nslice: s1\nverdict: pass"), "t-1.a");
  assert.equal(readLaunchToken("slice: s1\nverdict: pass"), undefined);
});
