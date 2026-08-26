import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRuntimeState, StateInvariantError } from "../../src/state/schema.ts";

test("parseRuntimeState raises StateInvariantError on mode=none carrying active_slice=3", () => {
  assert.throws(() => parseRuntimeState({ mode: "none", active_slice: "3" }), StateInvariantError);
});

test("parseRuntimeState accepts mode=none with no active slice", () => {
  const state = parseRuntimeState({ mode: "none" });
  assert.equal(state.mode, "none");
  assert.equal(state.activeSlice, "none");
});

test("parseRuntimeState accepts an armed plan slice", () => {
  const state = parseRuntimeState({ mode: "plan", active_slice: "3", verify_green: "false" });
  assert.equal(state.activeSlice, "3");
  assert.equal(state.verifyGreen, false);
});
