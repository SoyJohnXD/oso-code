import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { USAGE } from "../../src/state/cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso-state.ts");

test("the TypeScript CLI prints its usage text on stderr and exits 1", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", cliSource],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, USAGE);
  assert.equal(result.stdout, "");
});
