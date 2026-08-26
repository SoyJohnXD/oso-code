import assert from "node:assert/strict";
import { test } from "node:test";
import {
  armAuto,
  armPlan,
  armRun,
  armSlice,
  armWait,
  clearWait,
  closeRun,
  closeSlice,
  disarm,
  park,
} from "../../src/state/transitions.ts";

test("closeSlice returns auto_wait to none in the same patch that closes the slice", () => {
  const patch = closeSlice();
  assert.equal(patch["auto_wait"], "none", "a slice close that omits auto_wait=none leaves a delegation mark stuck");
  assert.equal(patch["active_slice"], "none");
  assert.equal(patch["verify_green"], "true");
});

test("armSlice arms plan mode on the given slice with a red bar", () => {
  assert.deepEqual(armSlice("3"), { mode: "plan", active_slice: "3", verify_green: "false" });
});

test("armPlan arms plan mode with no slice active yet", () => {
  assert.deepEqual(armPlan(), { mode: "plan", active_slice: "none", verify_green: "false" });
});

test("armAuto arms the unattended marker under its change slug", () => {
  assert.deepEqual(armAuto("ts-core-rewrite"), { auto: "running", auto_change: "ts-core-rewrite" });
});

test("park suspends an unattended run without disarming it", () => {
  assert.deepEqual(park(), { auto: "parked" });
});

test("disarm marks the unattended run done", () => {
  assert.deepEqual(disarm(), { auto: "done" });
});

test("armWait marks a delegation label as awaited", () => {
  assert.deepEqual(armWait("wave-2"), { auto_wait: "wave-2" });
});

test("clearWait returns the wait marker to its none sentinel", () => {
  assert.deepEqual(clearWait(), { auto_wait: "none" });
});

test("armRun writes the change slug every mode's start journals under", () => {
  assert.deepEqual(armRun("ts-core-rewrite"), { auto_change: "ts-core-rewrite" });
});

test("closeRun clears the change slug so the next run inherits no journal", () => {
  assert.deepEqual(closeRun(), { auto_change: "" });
});
