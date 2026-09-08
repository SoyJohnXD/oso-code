import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { after } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CodexHostProbes, HostRun } from "../../src/install/codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { guardRepositoryGitConfig } from "./repository-git-config-guard.ts";
import { repositoryRoot } from "./state-sandbox.ts";

const PUBLISHED_FILES_AN_INSTALL_READS = [
  "bootstrap/codex-global.md",
  "bootstrap/hook-hashes.txt",
  ".agents/plugins/marketplace.json",
  "codex/.codex-plugin/plugin.json",
] as const;

const PUBLISHED_DIRECTORIES_AN_INSTALL_READS = [
  "codex/agents",
  "codex/hooks",
  "codex/skills",
  "plugin/skills/_shared",
  "plugin/dist",
  "plugin/hooks",
  "plugin/git-hooks",
  "plugin/bin",
] as const;

const NO_CODEX_ON_THIS_MACHINE: HostRun = { ok: false, output: "codex: command not found" };

export const CODEX_WRITER_HOME_SEGMENT = process.platform === "win32" ? "home-runtime" : 'home-"quoted\\runtime';

export function pinnedHost(overrides: Partial<CodexHostProbes> = {}): CodexHostProbes {
  return {
    version: SUPPORTED_CODEX_VERSION,
    binaryPath: undefined,
    acceptsConfig: () => true,
    sandbox: () => NO_CODEX_ON_THIS_MACHINE,
    pluginListing: () => NO_CODEX_ON_THIS_MACHINE,
    marketplaceListing: () => ({ ok: true, output: JSON.stringify({ marketplaces: [] }) }),
    marketplaceRemove: () => ({ ok: true, output: JSON.stringify({ removed: true }) }),
    marketplaceAdd: (source) => ({
      ok: true,
      output: JSON.stringify({
        marketplaceName: source === "pbakaus/impeccable" ? "impeccable" : "oso-code",
        installedRoot: source === "pbakaus/impeccable" ? path.join(fixtureRepositoryRoot(), "impeccable-source") : source,
      }),
    }),
    pluginAdd: (pluginId) => ({ ok: true, output: JSON.stringify({ pluginId }) }),
    ...overrides,
  };
}

export function hostWithNoCodexBinary(): CodexHostProbes {
  return pinnedHost({ version: undefined });
}

let fixtureRoot: string | undefined;
after(() => {
  if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
});

export function fixtureRepositoryRoot(): string {
  if (fixtureRoot !== undefined) return fixtureRoot;
  const root = mkdtempSync(path.join(tmpdir(), "oso-codex-repo-"));
  try {
    for (const relative of PUBLISHED_FILES_AN_INSTALL_READS) {
      const target = path.join(root, ...relative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(repositoryRoot, ...relative.split("/")), target);
    }
    for (const relative of PUBLISHED_DIRECTORIES_AN_INSTALL_READS) {
      cpSync(path.join(repositoryRoot, ...relative.split("/")), path.join(root, relative), { recursive: true });
    }
    const impeccable = path.join(root, "impeccable-source", ".agents", "skills", "impeccable");
    mkdirSync(path.join(impeccable, "reference"), { recursive: true });
    writeFileSync(
      path.join(impeccable, "SKILL.md"),
      "---\nname: impeccable\nversion: 4.0.2\n---\n# Impeccable fixture\nUse .agents/skills/impeccable through $impeccable.\n",
    );
    for (const reference of ["init.md", "document.md", "audit.md"]) writeFileSync(path.join(impeccable, "reference", reference), `# ${reference}\n`);
    assert.equal(gitIn(root, ["init", "-q"]).status, 0, `the fixture repository root could not be initialised at ${root}`);
    fixtureRoot = root;
    return root;
  } finally {
    if (fixtureRoot !== root) rmSync(root, { recursive: true, force: true });
  }
}

guardRepositoryGitConfig("an install drive in this suite");

function gitIn(root: string, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}
