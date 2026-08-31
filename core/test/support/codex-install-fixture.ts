import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { CodexHostProbes, HostRun } from "../../src/install/codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const PUBLISHED_FILES_AN_INSTALL_READS = ["bootstrap/codex-global.md"] as const;

const NO_CODEX_ON_THIS_MACHINE: HostRun = { ok: false, output: "codex: command not found" };

export function pinnedHost(overrides: Partial<CodexHostProbes> = {}): CodexHostProbes {
  return {
    version: SUPPORTED_CODEX_VERSION,
    binaryPath: undefined,
    acceptsConfig: () => true,
    sandbox: () => NO_CODEX_ON_THIS_MACHINE,
    pluginListing: () => NO_CODEX_ON_THIS_MACHINE,
    ...overrides,
  };
}

export function hostWithNoCodexBinary(): CodexHostProbes {
  return pinnedHost({ version: undefined });
}

let fixtureRoot: string | undefined;

export function fixtureRepositoryRoot(): string {
  if (fixtureRoot !== undefined) return fixtureRoot;
  const root = mkdtempSync(path.join(tmpdir(), "oso-codex-repo-"));
  for (const relative of PUBLISHED_FILES_AN_INSTALL_READS) {
    const target = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repositoryRoot, ...relative.split("/")), target);
  }
  assert.equal(gitIn(root, ["init", "-q"]).status, 0, `the fixture repository root could not be initialised at ${root}`);
  fixtureRoot = root;
  return root;
}

const REAL_REPOSITORY_LOCAL_CONFIG = localGitConfigOf(repositoryRoot);

after(() => {
  assert.equal(
    localGitConfigOf(repositoryRoot),
    REAL_REPOSITORY_LOCAL_CONFIG,
    `an install drive in this suite rewrote the local git config of the repository under test at ${repositoryRoot}; ` +
      "every drive must be handed fixtureRepositoryRoot() so a hook-wiring rail can only reach a fixture",
  );
});

function localGitConfigOf(root: string): string {
  const run = gitIn(root, ["config", "--local", "--list"]);
  return run.status === 0 ? run.stdout : `unreadable:${run.status}`;
}

function gitIn(root: string, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}
