import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentVerdict } from "./verdict.ts";

test("parses an applier done status", () => {
  const parsed = parseAgentVerdict("finished the work\nstatus: done\n");
  assert.equal(parsed.status, "done");
  assert.equal(parsed.matched, true);
});

test("parses an applier blocked status", () => {
  const parsed = parseAgentVerdict("status: blocked\n");
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.matched, true);
});

test("parses a verifier pass verdict", () => {
  const parsed = parseAgentVerdict("everything checks out\nverdict: pass\n");
  assert.equal(parsed.verdict, "pass");
  assert.equal(parsed.matched, true);
});

test("parses a verifier fail verdict", () => {
  const parsed = parseAgentVerdict("verdict: fail\n");
  assert.equal(parsed.verdict, "fail");
  assert.equal(parsed.matched, true);
});

test("parses both lines when present", () => {
  const parsed = parseAgentVerdict("status: blocked\nverdict: fail\n");
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.verdict, "fail");
  assert.equal(parsed.matched, true);
});

test("tolerates spacing and capitalization", () => {
  const spaced = parseAgentVerdict("status : DONE");
  assert.equal(spaced.status, "done");
  const tight = parseAgentVerdict("verdict:FAIL");
  assert.equal(tight.verdict, "fail");
});

test("an unmatched report is not a verdict", () => {
  const parsed = parseAgentVerdict("the status of the work is done, prose everywhere");
  assert.equal(parsed.matched, false);
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.verdict, undefined);
});

test("empty text is not a verdict", () => {
  const parsed = parseAgentVerdict("");
  assert.equal(parsed.matched, false);
});

test("an unknown status value is not a verdict line", () => {
  const parsed = parseAgentVerdict("status: pending\n");
  assert.equal(parsed.matched, false);
});
