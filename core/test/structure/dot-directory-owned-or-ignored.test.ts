import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const REPO_OWNED_DOT_DIRECTORIES = new Set([".git", ".github", ".claude-plugin", ".codex-plugin", ".agents"]);
const MINIMUM_DOT_DIRECTORIES = 5;
const MINIMUM_DOT_DIRECTORIES_DERIVATION =
  "readdirSync(repositoryRoot) dot-entries, measured at C5-S5b: .agents, .atl, .claude, .claude-plugin, .fallow, " +
  ".git, .github — 7";

function dotDirectoriesAtRepositoryRoot(): string[] {
  return readdirSync(repositoryRoot)
    .filter((name) => name.startsWith("."))
    .filter((name) => statSync(path.join(repositoryRoot, name)).isDirectory())
    .sort();
}

function isGitIgnored(name: string): boolean {
  const probe = spawnSync("git", ["-C", repositoryRoot, "check-ignore", "-q", "--", name], { encoding: "utf8" });
  return probe.status === 0;
}

const dotDirectories = dotDirectoriesAtRepositoryRoot();

provedSomething(
  `${dotDirectories.length} dot-directory(ies) were found at the repository root`,
  dotDirectories.length >= MINIMUM_DOT_DIRECTORIES,
  `only ${dotDirectories.length} were found, under the ${MINIMUM_DOT_DIRECTORIES}-directory floor (${MINIMUM_DOT_DIRECTORIES_DERIVATION})`,
);

describe("every dot-directory at the repository root is either this repository's own or a line in .gitignore", () => {
  for (const name of dotDirectories) {
    test(`${name}/ is owned or ignored`, () => {
      assert.ok(
        REPO_OWNED_DOT_DIRECTORIES.has(name) || isGitIgnored(name),
        `${name}/ is neither one of this repository's own directories nor a line in .gitignore, so whatever the ` +
          "tool that wrote it leaves there is one commit away from being published",
      );
    });
  }
});
