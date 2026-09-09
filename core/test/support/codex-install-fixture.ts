import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { after } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONFIG_MARKER_END, CONFIG_MARKER_START } from "../../src/install/codex-config.ts";
import type { CodexHostProbes, HostRun } from "../../src/install/codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { guardRepositoryGitConfig } from "./repository-git-config-guard.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const RELEASED_PERMISSION_KEYS = ["default_permissions", "[permissions.oso]"];

export const PREVIOUS_RELEASE_CONFIG = [
  CONFIG_MARKER_START,
  'default_permissions = "oso"',
  'model = "gpt-6-astra"',
  'model_reasoning_effort = "xhigh"',
  'service_tier = "default"',
  "",
  "[shell_environment_policy.set]",
  'OSO_AGENT = "1"',
  "",
  "[permissions.oso]",
  'extends = ":workspace"',
  "",
  "[permissions.oso.workspace_roots]",
  '"/somewhere/the/operator/kept" = true',
  "",
  '[permissions.oso.filesystem.":workspace_roots"]',
  '"**/.env" = "deny"',
  "",
  "[mcp_servers.fallow]",
  'command = "/usr/bin/fallow-mcp"',
  CONFIG_MARKER_END,
  "",
  "[history]",
  'persistence = "save-all"',
  "",
].join("\n");

export function insideTheManagedRegion(text: string): string {
  return text.split(CONFIG_MARKER_START)[1]?.split(CONFIG_MARKER_END)[0] ?? "";
}

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
