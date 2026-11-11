import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentVerdict } from "@oso-code/core";

test("the module exposes the v2 default definition and nothing else", async () => {
  const moduleNamespace: Record<string, unknown> = await import("../oso-code.ts");
  assert.deepEqual(Object.keys(moduleNamespace), ["default"]);
});

test("verdict parsing lives at its canonical module in the core, not re-exported from the plugin entry", () => {
  const parsed = parseAgentVerdict("status: done\n");
  assert.equal(parsed.status, "done");
});
