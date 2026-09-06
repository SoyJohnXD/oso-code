import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseTrustManifest, type TrustRow } from "./trust.ts";
import { parseTomlDocument, TomlParseError } from "./toml.ts";
import { readJsonObject } from "./json.ts";
import { isDirectoryNotSymlink, isExecutableRegularFile, isReadableRegularFile } from "../state/store.ts";

export const CODEX_MARKETPLACE_NAME = "oso-code";
export const CODEX_PLUGIN_ID = `${CODEX_MARKETPLACE_NAME}@${CODEX_MARKETPLACE_NAME}`;
export const CODEX_IMPECCABLE_REFERENCES = ["init.md", "document.md", "audit.md"] as const;
export const CODEX_HOOKS_MANIFEST = "codex/hooks/hooks.json";
const CODEX_AGENT_NAMES = ["oso-applier.toml", "oso-debt-sweep.toml", "oso-doubt-pass.toml", "oso-integrator.toml", "oso-security-reviewer.toml", "oso-triage.toml", "oso-verifier.toml"] as const;
const CODEX_SKILL_NAMES = ["debt-sweep", "debug", "doubt-pass", "plan", "quality-pass", "quick", "roadmap", "security-pass", "triage"] as const;
export const CODEX_MARKETPLACE_PAYLOAD_ROWS = [{ named: "marketplace.json", published: ".agents/plugins/marketplace.json", installed: ".agents/plugins/marketplace.json" },
  { named: "plugin.json", published: "codex/.codex-plugin/plugin.json", installed: "codex/.codex-plugin/plugin.json" },
] as const;

export function codexPayloadSources(repositoryRoot: string) {
  return {
    marketplaceTemplate: path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
    pluginManifest: path.join(repositoryRoot, "codex", ".codex-plugin", "plugin.json"),
    skills: path.join(repositoryRoot, "codex", "skills"),
    sharedSkills: path.join(repositoryRoot, "plugin", "skills", "_shared"),
    agents: path.join(repositoryRoot, "codex", "agents"),
    hooksManifest: path.join(repositoryRoot, CODEX_HOOKS_MANIFEST),
    hashes: path.join(repositoryRoot, "bootstrap", "hook-hashes.txt"),
  };
}

export type CodexPayloadSources = Readonly<ReturnType<typeof codexPayloadSources>>;

export function codexRuntimeRows(hashesText: string): TrustRow[] { return parseTrustManifest(hashesText).filter((row) => !row.file.startsWith("opencode/")); }

export function codexRuntimeTargetOf(relative: string, runtimeRoot: string, codexHome: string): string | undefined {
  if (relative === CODEX_HOOKS_MANIFEST) return path.join(codexHome, "hooks.json");
  const match = ([
    ["plugin/dist/", "dist"],
    ["plugin/hooks/", "hooks"],
    ["plugin/git-hooks/", "git-hooks"],
    ["plugin/bin/", "bin"],
  ] as const).find(([prefix]) => relative.startsWith(prefix));
  return match === undefined ? undefined : path.join(runtimeRoot, match[1], relative.slice(match[0].length));
}

export function codexAgentInventory(sources: CodexPayloadSources): Readonly<{ names: readonly string[]; error?: string }> { return directoryInventory(sources.agents, (entry) => entry.name.endsWith(".toml")); }

export function codexSkillInventory(sources: CodexPayloadSources): Readonly<{ names: readonly string[]; error?: string }> { return directoryInventory(sources.skills, (entry) => entry.isDirectory() && entry.name !== "_shared"); }

export function codexPayloadRefusal(sources: CodexPayloadSources): string | undefined {
  const required = [
    [sources.marketplaceTemplate, "the Codex marketplace manifest", isReadableRegularFile],
    [sources.pluginManifest, "the Codex plugin manifest", isReadableRegularFile],
    [sources.hooksManifest, "the Codex hooks manifest", isReadableRegularFile],
    [sources.hashes, "the published hook hash manifest", isReadableRegularFile],
    [sources.skills, "the Codex skill wrappers", isDirectoryNotSymlink],
    [sources.sharedSkills, "the shared Codex skill references", isDirectoryNotSymlink],
    [sources.agents, "the Codex agent contracts", isDirectoryNotSymlink],
  ] as const;
  const missing = required.find(([target, , valid]) => !valid(target));
  if (missing !== undefined) return `${missing[1]} is missing or invalid: ${missing[0]}`;
  const skillRefusal = inventoryRefusal(
    codexSkillInventory(sources),
    sources.skills,
    CODEX_SKILL_NAMES,
    "Codex skill wrappers",
    (name) => path.join(sources.skills, name, "SKILL.md"),
    (file, name) => frontmatterField(readFileSync(file, "utf8"), "name") === name ? undefined : `Codex skill wrapper identity mismatch at ${file}: expected name ${name}`,
  );
  if (skillRefusal !== undefined) return skillRefusal;
  const agentRefusal = inventoryRefusal(
    codexAgentInventory(sources),
    sources.agents,
    CODEX_AGENT_NAMES,
    "Codex agent contracts",
    (name) => path.join(sources.agents, name),
    (file, name) => {
      try {
        return parseTomlDocument(readFileSync(file, "utf8"), file)["name"] === name.slice(0, -5) ? undefined : `Codex agent identity mismatch at ${file}`;
      } catch (error) { return `Codex agent contract is invalid TOML: ${file} (${error instanceof TomlParseError ? error.message : String(error)})`; }
    },
  );
  if (agentRefusal !== undefined) return agentRefusal;

  let marketplace: Record<string, unknown>, plugin: Record<string, unknown>, hooks: Record<string, unknown>;
  try {
    [marketplace, plugin, hooks] = [sources.marketplaceTemplate, sources.pluginManifest, sources.hooksManifest].map(readJsonObject) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
  } catch (error) { return `Codex publication metadata is invalid: ${error instanceof Error ? error.message : String(error)}`; }
  const marketplacePlugin = Array.isArray(marketplace["plugins"]) && marketplace["plugins"].length === 1 ? marketplace["plugins"][0] : undefined;
  const source = isRecord(marketplacePlugin) ? marketplacePlugin["source"] : undefined;
  if (marketplace["name"] !== CODEX_MARKETPLACE_NAME || !isRecord(marketplacePlugin) || marketplacePlugin["name"] !== CODEX_MARKETPLACE_NAME) return `Codex marketplace manifest is not the oso-code publication: ${sources.marketplaceTemplate}`;
  if (!isRecord(source) || source["source"] !== "local" || source["path"] !== "./codex") return `Codex marketplace manifest has an unexpected local plugin source: ${sources.marketplaceTemplate}`;
  if (plugin["name"] !== CODEX_MARKETPLACE_NAME || typeof plugin["version"] !== "string" || plugin["skills"] !== "./skills/") return `Codex plugin manifest has an unexpected identity or skills entrypoint: ${sources.pluginManifest}`;
  if (!isRecord(hooks["hooks"])) return `Codex hooks manifest has no hooks object: ${sources.hooksManifest}`;

  const rows = codexRuntimeRows(readFileSync(sources.hashes, "utf8"));
  if (rows.length === 0) return `no Codex runtime rows found in ${sources.hashes}`;
  const root = path.join(path.dirname(sources.hashes), "..");
  const missingRuntime = rows.filter((row) => row.file !== CODEX_HOOKS_MANIFEST).map((row) => path.join(root, ...row.file.split("/"))).find((file) => !isReadableRegularFile(file));
  if (missingRuntime !== undefined) return `published Codex runtime entry is missing or invalid: ${missingRuntime}`;
  const missingEntrypoint = [path.join(root, "plugin", "bin", "oso-state"), path.join(root, "plugin", "git-hooks", "pre-commit")].find((entrypoint) => !isExecutableRegularFile(entrypoint));
  if (missingEntrypoint !== undefined) return `published Codex runtime entrypoint is not executable: ${missingEntrypoint}`;
}

function inventoryRefusal(
  inventory: Readonly<{ names: readonly string[]; error?: string }>,
  directory: string,
  expected: readonly string[],
  label: string,
  fileOf: (name: string) => string,
  validate: (file: string, name: string) => string | undefined,
): string | undefined {
  if (inventory.error !== undefined) return `unable to read the ${label.toLowerCase()} under ${directory}: ${inventory.error}`;
  const wanted = [...expected].sort();
  if (JSON.stringify(inventory.names) !== JSON.stringify(wanted)) return `${label} do not match the published inventory under ${directory}: ${inventoryDifference(wanted, inventory.names)}`;
  for (const name of expected) {
    const file = fileOf(name);
    const refusal = !isReadableRegularFile(file) ? `${label.slice(0, -1)} is missing or invalid: ${file}` : validate(file, name);
    if (refusal !== undefined) return refusal;
  }
}

function directoryInventory(directory: string, include: (entry: { name: string; isDirectory: () => boolean }) => boolean): Readonly<{ names: readonly string[]; error?: string }> {
  try {
    return { names: readdirSync(directory, { withFileTypes: true }).filter(include).map((entry) => entry.name).sort() };
  } catch (error) { return { names: [], error: error instanceof Error ? error.message : String(error) }; }
}

function inventoryDifference(expected: readonly string[], actual: readonly string[]): string {
  return `missing ${expected.filter((name) => !actual.includes(name)).join(", ") || "none"}; unexpected ${actual.filter((name) => !expected.includes(name)).join(", ") || "none"}`;
}

export function frontmatterField(text: string, field: string): string | undefined {
  const row = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]?.split("\n").find((line) => line.startsWith(`${field}:`));
  return row?.slice(field.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
