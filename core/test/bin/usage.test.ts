import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso-state.ts");
const bashSource = path.join(repoRoot, "plugin", "bin", "oso-state");

function bashUsageText(): string {
  const bash = readFileSync(bashSource, "utf8");
  const heredoc = bash.match(/cat >&2 <<'EOF'\n([\s\S]*?)\nEOF\n/);
  assert.ok(heredoc, "the bash usage heredoc must be present at plugin/bin/oso-state");
  return `${heredoc[1]}\n`;
}

test("the TypeScript CLI skeleton prints the bash usage text on stderr and exits 1", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", cliSource],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, bashUsageText());
  assert.equal(result.stdout, "");
});
