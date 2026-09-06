import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { GENERATED_BUNDLES } from "../../src/routes/routes.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const bundleChecker = pathToFileURL(path.join(repositoryRoot, "core/scripts/lib/bundle.mjs")).href;
const registeredBundle = GENERATED_BUNDLES[0];

if (registeredBundle === undefined) throw new Error("the shared generated bundle list is empty");

function runFreshnessCheck(target: string, expected: string, actual: string) {
  writeFileSync(target, actual);
  const source = [
    `import { checkFreshArtifacts } from ${JSON.stringify(bundleChecker)};`,
    `checkFreshArtifacts("test", "C1-A18 fixture", [{ path: ${JSON.stringify(target)}, name: ${JSON.stringify(registeredBundle)}, text: ${JSON.stringify(expected)} }]);`,
  ].join("\n");
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" });
}

describe("registered generated outputs require exact regeneration", () => {
  test("fresh bytes pass the shared artifact check", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "oso-generated-fresh-"));
    try {
      const target = path.join(directory, "registered-output.js");
      const result = runFreshnessCheck(target, "builder output\n", "builder output\n");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a manually changed byte fails the shared artifact check", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "oso-generated-stale-"));
    try {
      const target = path.join(directory, "registered-output.js");
      const result = runFreshnessCheck(target, "builder output\n", "builder output\nmanual edit\n");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /plugin\/dist\/oso-state\.js is stale against C1-A18 fixture/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
