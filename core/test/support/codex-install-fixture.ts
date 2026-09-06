import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CodexHostProbes, HostRun } from "../../src/install/codex-host.ts";
import { COMPACT_PROMPT_KEY, FEATURE_MARKER_END, MODEL_INSTRUCTIONS_KEY } from "../../src/install/codex-config.ts";
import { SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
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
    setupEngram: (homeDirectory, codexHome) => setupFixtureEngram(homeDirectory, codexHome),
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
}

function setupFixtureEngram(_homeDirectory: string, codexHome: string): HostRun {
  const configFile = path.join(codexHome, "config.toml");
  const existing = removeTomlTable(removeTomlTable(removeTomlTable(readFileSync(configFile, "utf8"), "[mcp_servers.engram]"), "[marketplaces.engram]"), '[plugins."engram@engram"]');
  const pointer = `model_instructions_file = ${JSON.stringify(path.join(codexHome, "engram-instructions.md"))}\n`;
  const compact = `experimental_compact_prompt_file = ${JSON.stringify(path.join(codexHome, "engram-compact-prompt.md"))}\n`;
  const document = parseTomlDocument(existing, configFile);
  const root = typeof document[MODEL_INSTRUCTIONS_KEY] === "string" && typeof document[COMPACT_PROMPT_KEY] === "string" ? existing : `${pointer}${compact}\n${existing}`;
  const nativeRegistrations = [
    "[marketplaces.engram]",
    'source_type = "git"',
    'source = "https://github.com/Gentleman-Programming/engram.git"',
    'ref = "main"',
    "",
    '[plugins."engram@engram"]',
    "enabled = true",
  ].join("\n");
  const featureEnd = `${FEATURE_MARKER_END}\n`;
  const withRegistration = root.includes(featureEnd)
    ? root.replace(featureEnd, `${nativeRegistrations}\n${featureEnd}`)
    : `${root}\n${nativeRegistrations}\n`;
  const engram = `${withRegistration}\n[mcp_servers.engram]\ncommand = "engram"\nargs = ["mcp", "--tools=agent"]\n`;
  writeFileSync(configFile, engram);
  writeFileSync(path.join(codexHome, "engram-instructions.md"), "# Engram fixture instructions\n");
  writeFileSync(path.join(codexHome, "engram-compact-prompt.md"), "# Engram fixture compact prompt\n");
  return { ok: true, output: "engram setup codex" };
}

function removeTomlTable(text: string, header: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (!inside && line === header) {
      inside = true;
      continue;
    }
    if (inside && line.startsWith("[")) inside = false;
    if (!inside) kept.push(line);
  }
  return kept.join("\n");
}

guardRepositoryGitConfig("an install drive in this suite");

function gitIn(root: string, argv: readonly string[]) {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8" });
  return { status: run.error === undefined ? (run.status ?? 1) : 1, stdout: run.stdout ?? "" };
}
