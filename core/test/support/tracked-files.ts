import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "./state-sandbox.ts";

export type TrackedFileText = Readonly<{ file: string; text: string }>;

export function subtractDeletedPaths(candidates: readonly string[], deleted: readonly string[]): string[] {
  const deletedSet = new Set(deleted);
  return candidates.filter((file) => !deletedSet.has(file));
}

export function trackedRepositoryFiles(): string[] {
  const listing = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(listing.status, 0, `git ls-files failed: ${listing.stderr}`);
  const deletion = spawnSync("git", ["ls-files", "--deleted"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(deletion.status, 0, `git ls-files --deleted failed: ${deletion.stderr}`);
  const candidates = listing.stdout.split("\n").filter((line) => line !== "");
  const deleted = deletion.stdout.split("\n").filter((line) => line !== "");
  return subtractDeletedPaths(candidates, deleted);
}

export function readTrackedText(file: string): TrackedFileText {
  return { file, text: readFileSync(path.join(repositoryRoot, file), "utf8") };
}
