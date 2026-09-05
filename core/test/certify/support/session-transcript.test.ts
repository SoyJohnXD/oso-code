import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { approvalPromptAsked, approvedPlanArtifacts, permissionsRequestedIn } from "./session-transcript.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-session-transcript-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

function plansRootOf(fixtureHome: string): string {
  return path.join(fixtureHome, ".local", "state", "oso-code", "plans");
}

test("a fixture HOME that never captured a plan reads none, the boundary holding", () => {
  const fixtureHome = path.join(sandbox, "no-plans-home");
  mkdirSync(fixtureHome, { recursive: true });
  assert.equal(approvedPlanArtifacts(fixtureHome), "none");
});

test("an approved plan artifact on disk is counted and named", () => {
  const fixtureHome = path.join(sandbox, "approved-plan-home");
  mkdirSync(plansRootOf(fixtureHome), { recursive: true });
  writeFileSync(path.join(plansRootOf(fixtureHome), "approved-1.md"), "# plan\n");
  assert.equal(approvedPlanArtifacts(fixtureHome), "present:1");
});

test("a plans root that exists but cannot be listed reads unreadable rather than the none pass value", () => {
  const fixtureHome = path.join(sandbox, "unreadable-plans-home");
  mkdirSync(path.dirname(plansRootOf(fixtureHome)), { recursive: true });
  writeFileSync(plansRootOf(fixtureHome), "not a directory\n");
  assert.equal(approvedPlanArtifacts(fixtureHome), "unreadable");
});

test("a stream carrying no host prompt at all reads an empty list, on both channels together", () => {
  assert.deepEqual(permissionsRequestedIn("status: done\n", "warning: nothing to see\n"), []);
});

test("every prompt the host printed is named once, in the order the child stream carried them, across stdout and stderr", () => {
  const stdout = "! permission requested: external_directory (/home/probe/wt/*); auto-rejecting\nstatus: done\n";
  const stderr = "! permission requested: oso_plan_approve (*)\n";
  assert.deepEqual(permissionsRequestedIn(stdout, stderr), ["external_directory", "oso_plan_approve"]);
});

test("the named reading and the per-tool reading answer the same stream the same way", () => {
  const stdout = "! permission requested: oso_plan_approve (*)\n";
  assert.equal(approvalPromptAsked(stdout, "", "oso_plan_approve"), true);
  assert.equal(approvalPromptAsked(stdout, "", "external_directory"), false);
});
