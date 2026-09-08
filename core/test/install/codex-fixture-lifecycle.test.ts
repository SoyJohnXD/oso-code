import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

for (const failInitialization of [false, true]) {
  test(`fixture repository cleanup after ${failInitialization ? "initialization failure" : "suite completion"}`, () => {
    const owner = mkdtempSync(path.join(tmpdir(), "oso-fixture-owner-"));
    const receipt = path.join(owner, "root.json");
    const fixture = new URL("../support/codex-install-fixture.ts", import.meta.url).href;
    const script = path.join(owner, "lifecycle.mjs");
    writeFileSync(script, `
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
const allocate = fs.mkdtempSync;
fs.mkdtempSync = (...args) => {
  const root = allocate(...args);
  fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(root));
  return root;
};
${failInitialization ? 'fs.cpSync = () => { throw new Error("fixture copy failed"); };' : ""}
syncBuiltinESMExports();
const { fixtureRepositoryRoot } = await import(${JSON.stringify(fixture)});
test("owned fixture", () => {
  ${failInitialization ? 'assert.throws(() => fixtureRepositoryRoot(), /fixture copy failed/);' : 'assert.equal(fixtureRepositoryRoot(), fixtureRepositoryRoot());'}
});
`);
    try {
      const environment = { ...process.env };
      delete environment["NODE_TEST_CONTEXT"];
      const run = spawnSync(process.execPath, ["--test", script], { encoding: "utf8", env: environment });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const root: string = JSON.parse(readFileSync(receipt, "utf8"));
      assert.equal(existsSync(root), false, `owned fixture remains: ${root}`);
    } finally {
      if (existsSync(receipt)) rmSync(JSON.parse(readFileSync(receipt, "utf8")), { recursive: true, force: true });
      rmSync(owner, { recursive: true, force: true });
    }
  });
}
