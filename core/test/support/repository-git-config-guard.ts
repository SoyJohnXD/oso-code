import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after } from "node:test";
import { repositoryRoot } from "./state-sandbox.ts";

const CONFIG_AT_IMPORT = localGitConfigOf(repositoryRoot);

export function guardRepositoryGitConfig(driveDescription: string): void {
  after(() => {
    assert.equal(
      localGitConfigOf(repositoryRoot),
      CONFIG_AT_IMPORT,
      `${driveDescription} rewrote the local git config of the repository under test at ${repositoryRoot}; ` +
        "every drive must be handed a fixture repository root so a hook-wiring rail can only reach a fixture",
    );
  });
}

function localGitConfigOf(root: string): string {
  const run = spawnSync("git", ["-C", root, "config", "--local", "--list"], { encoding: "utf8" });
  const status = run.error === undefined ? (run.status ?? 1) : 1;
  return status === 0 ? (run.stdout ?? "") : `unreadable:${status}`;
}
