import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { repositoryRoot } from "../support/state-sandbox.ts";

const BUDGET_VARIABLE = "OSO_TEST_BUDGET_SECONDS";
const NODE_TEST_CONTEXT_VARIABLE = "NODE_TEST_CONTEXT";
const discoveryScript = path.join(repositoryRoot, "core", "scripts", "check-test-discovery.mjs");

const suiteRoot = mkdtempSync(path.join(tmpdir(), "oso-test-budget-"));
after(() => rmSync(suiteRoot, { recursive: true, force: true }));
mkdirSync(path.join(suiteRoot, "test"));
writeFileSync(
  path.join(suiteRoot, "test", "ok.test.ts"),
  'import { test } from "node:test";\ntest("passes", () => {});\n',
);

function runDiscoveryWithBudget(budget: string | undefined) {
  const { [BUDGET_VARIABLE]: _budget, [NODE_TEST_CONTEXT_VARIABLE]: _context, ...environment } = process.env;
  const run = spawnSync(process.execPath, [discoveryScript], {
    cwd: suiteRoot,
    encoding: "utf8",
    env: budget === undefined ? environment : { ...environment, [BUDGET_VARIABLE]: budget },
  });
  return { exit: run.status, stderr: run.stderr };
}

describe("check-test-discovery enforces the wall-clock budget from OSO_TEST_BUDGET_SECONDS", () => {
  test("a suite that outlasts the budget fails even though every test passed, and names the variable and the budget", () => {
    const { exit, stderr } = runDiscoveryWithBudget("0");
    assert.equal(exit, 1, stderr);
    assert.match(stderr, new RegExp(BUDGET_VARIABLE));
    assert.match(stderr, /budget of 0s/);
  });

  test("a suite inside the budget passes and reports its measured seconds", () => {
    const { exit, stderr } = runDiscoveryWithBudget("600");
    assert.equal(exit, 0, stderr);
    assert.match(stderr, /took \d+\.\d+s against a budget of 600s/);
  });

  test("an unset budget leaves the run unmetered", () => {
    const { exit, stderr } = runDiscoveryWithBudget(undefined);
    assert.equal(exit, 0, stderr);
    assert.doesNotMatch(stderr, new RegExp(BUDGET_VARIABLE));
  });

  test("a budget that is not a number is refused before the suite runs", () => {
    const { exit, stderr } = runDiscoveryWithBudget("abc");
    assert.equal(exit, 1, stderr);
    assert.match(stderr, /"abc" is not a non-negative number/);
  });
});
