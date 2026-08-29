import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "./state-sandbox.ts";

export type TrackedFileText = Readonly<{ file: string; text: string }>;

export function trackedRepositoryFiles(): string[] {
  const listing = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(listing.status, 0, `git ls-files failed: ${listing.stderr}`);
  return listing.stdout.split("\n").filter((line) => line !== "");
}

export function readTrackedText(file: string): TrackedFileText {
  return { file, text: readFileSync(path.join(repositoryRoot, file), "utf8") };
}
