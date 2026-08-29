import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { MANIFEST_HOSTS, manifestPathOf, renderHooksManifest } from "../../src/routes/render.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

provedSomething(
  "core/src/routes/render.ts names at least one manifest host",
  MANIFEST_HOSTS.length > 0,
  "render.ts named no manifest host, so this check compared nothing",
);

describe("the committed hook manifests are what core/src/routes/routes.ts renders", () => {
  for (const host of MANIFEST_HOSTS) {
    const manifest = manifestPathOf(host);

    test(`${manifest} equals a fresh render`, () => {
      assert.equal(readFileSync(path.join(repositoryRoot, manifest), "utf8"), renderHooksManifest(host));
    });

    test(`${manifest} parses as JSON whose every handler names a command`, () => {
      const document: unknown = JSON.parse(renderHooksManifest(host));
      assert.ok(handlersOf(document).length > 0, `${manifest} rendered no handler`);
      for (const handler of handlersOf(document)) {
        assert.equal(typeof handler["type"], "string");
        assert.equal(handler["type"], "command");
        assert.equal(typeof handler["command"], "string");
      }
    });
  }
});

function handlersOf(document: unknown): Record<string, unknown>[] {
  const events = (document as { hooks?: Record<string, unknown[]> }).hooks ?? {};
  return Object.values(events)
    .flat()
    .flatMap((group) => (group as { hooks?: Record<string, unknown>[] }).hooks ?? []);
}
