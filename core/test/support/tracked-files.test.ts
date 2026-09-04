import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "./proved.ts";
import { repositoryRoot } from "./state-sandbox.ts";
import { subtractDeletedPaths, trackedRepositoryFiles } from "./tracked-files.ts";

function gitListDeleted(): string[] {
  const listing = spawnSync("git", ["ls-files", "--deleted"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(listing.status, 0, `git ls-files --deleted failed: ${listing.stderr}`);
  return listing.stdout.split("\n").filter((line) => line !== "");
}

describe("subtractDeletedPaths removes exactly the paths git reports deleted, simulated without touching the real repository", () => {
  test("a path present in both the cached listing and the deleted listing is dropped", () => {
    assert.deepEqual(subtractDeletedPaths(["a.md", "b.md"], ["a.md"]), ["b.md"]);
  });

  test("a path absent from the deleted listing survives untouched, in its original order", () => {
    assert.deepEqual(subtractDeletedPaths(["a.md", "b.md", "c.md"], []), ["a.md", "b.md", "c.md"]);
  });

  test("every path is dropped when the deleted listing covers the whole candidate list", () => {
    assert.deepEqual(subtractDeletedPaths(["a.md", "b.md"], ["a.md", "b.md"]), []);
  });
});

const tracked = trackedRepositoryFiles();
const deletedNow = gitListDeleted();

provedSomething(
  `${tracked.length} file(s) came back from trackedRepositoryFiles()`,
  tracked.length > 0,
  "trackedRepositoryFiles() returned nothing, so the invariants below would hold on an empty list",
);

describe("trackedRepositoryFiles() keeps the promise its name makes against this working tree's own git state", () => {
  for (const file of deletedNow) {
    test(`${file}, which git ls-files --deleted reports gone, is absent from trackedRepositoryFiles()`, () => {
      assert.ok(!tracked.includes(file), `${file} is still returned even though git reports it deleted`);
    });
  }

  test("every path trackedRepositoryFiles() returns exists on disk", () => {
    const missing = tracked.filter((file) => !existsSync(path.join(repositoryRoot, file)));
    assert.deepEqual(missing, [], `these paths do not exist on disk despite being returned: ${missing.join(", ")}`);
  });
});
