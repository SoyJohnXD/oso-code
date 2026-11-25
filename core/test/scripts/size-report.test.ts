import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "../support/state-sandbox.ts";

const sizeReportScript = path.join(repositoryRoot, "core", "scripts", "size-report.mjs");

test("the size report exits 0 and prints a row per area plus a total", () => {
  const run = spawnSync(process.execPath, [sizeReportScript], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^core\/src\s+[1-9]\d*\s+[1-9]\d*\s+[1-9]\d*$/m);
  assert.match(run.stdout, /^core\/test\s+[1-9]\d*\s+[1-9]\d*\s+[1-9]\d*$/m);
  assert.match(run.stdout, /^total\s+[1-9]\d*\s+[1-9]\d*\s+[1-9]\d*$/m);
});
