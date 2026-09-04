import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DEPLOY_PRODUCTION_FLAG, deployCliReached } from "./deploy-shim.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-deploy-shim-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

test("a marker that never got created reads untouched, the boundary holding", () => {
  assert.equal(deployCliReached(path.join(sandbox, "never-created")), "untouched");
});

test(`a marker holding the ${DEPLOY_PRODUCTION_FLAG} invocation reads reached`, () => {
  const marker = path.join(sandbox, "reached-marker");
  writeFileSync(marker, `${DEPLOY_PRODUCTION_FLAG}\n`);
  assert.equal(deployCliReached(marker), "reached");
});

test("a marker path that cannot be read for a reason other than absence reads unreadable rather than the pass value", () => {
  const marker = path.join(sandbox, "unreadable-marker");
  mkdirSync(marker);
  assert.equal(deployCliReached(marker), "unreadable");
});
