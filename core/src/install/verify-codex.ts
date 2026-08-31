import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import {
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  renderCodexManagedConfig,
} from "./codex-config.ts";
import { codexPathsFor, managedFeaturesStatus, type CodexPaths } from "./codex.ts";
import { VerifyReport } from "./report.ts";
import { runTomlRegion } from "./toml-regions.ts";
import { readTomlFile, TomlParseError } from "./toml.ts";
import { trustDivergences } from "./trust.ts";
import { TOOL_ROWS } from "../routes/routes.ts";
import { isErrnoException, isExecutableRegularFile, isReadableRegularFile } from "../state/store.ts";

export const KNOWN_MCP_SERVERS = ["engram", "context7", "fallow"] as const;

export const PROTOCOL_MANDATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  engram: [
    "mem_save",
    "mem_search",
    "mem_context",
    "mem_session_summary",
    "mem_get_observation",
    "mem_save_prompt",
    "mem_current_project",
    "mem_judge",
  ],
};

export type McpServerEntry = Readonly<{ name: string; command: string | undefined; args: readonly string[] }>;

export type VerifyCodexInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}>;

export type VerifyOutcome = Readonly<{ report: string; exitCode: number }>;

export function verifyCodex(input: VerifyCodexInput): VerifyOutcome {
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const report = new VerifyReport();

  checkManagedConfigRegion(report, paths, input.environment);
  checkGlobalGuidance(report, paths, input.repositoryRoot);
  checkPublishedRuntimeBytes(report, paths, input.repositoryRoot);
  checkRuntimeEntrypointsExecutable(report, paths);
  checkAgentPayload(report, paths, input.repositoryRoot);
  checkEngramWiring(report, paths);
  checkImpeccableMount(report, input.homeDirectory);
  checkMcpToolTableDrift(report, paths);

  return { report: report.render(), exitCode: report.exitCode };
}

export function checkManagedConfigRegion(report: VerifyReport, paths: CodexPaths, environment: NodeJS.ProcessEnv): void {
  if (!isReadableRegularFile(paths.configFile)) {
    report.check("managed Codex config", "valid", "missing");
    return;
  }
  const text = readFileSync(paths.configFile, "utf8");
  const extracted = runTomlRegion(text, {
    action: "extract",
    startMarker: CONFIG_MARKER_START,
    endMarker: CONFIG_MARKER_END,
    requireRegion: true,
  });
  if (extracted.exitCode !== 0) {
    report.check("managed Codex config", "valid", "malformed");
    return;
  }
  const fallowCommand = fallowCommandInside(extracted.stdout);
  const expected = renderCodexManagedConfig(paths.codexHome, paths.runtimeRoot, fallowCommand);
  if (extracted.stdout !== expected) {
    report.check("managed Codex config", "valid", "divergent");
    return;
  }
  report.check("managed Codex config", "valid", featuresVerdictOf(managedFeaturesStatus(text)));
  report.detail(`fallow MCP command in the managed region: ${fallowCommand}`);
  report.detail(`CODEX_HOME read as ${environment["CODEX_HOME"] ?? paths.codexHome}`);
}

export function checkGlobalGuidance(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  if (!isReadableRegularFile(paths.globalFile)) {
    report.check("global Codex guidance", "exact", "missing");
    return;
  }
  const installed = regionBetween(readFileSync(paths.globalFile, "utf8"), GLOBAL_MARKER_START, GLOBAL_MARKER_END);
  if (installed === undefined) {
    report.check("global Codex guidance", "exact", "malformed");
    return;
  }
  const source = path.join(repositoryRoot, "bootstrap", "codex-global.md");
  if (!isReadableRegularFile(source)) {
    report.detail(`published guidance unreadable: ${source}`);
    report.check("global Codex guidance", "exact", "source-unreadable");
    return;
  }
  report.check("global Codex guidance", "exact", installed === readFileSync(source, "utf8") ? "exact" : "divergent");
}

export function checkPublishedRuntimeBytes(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  const divergences = trustDivergences(
    path.join(repositoryRoot, "bootstrap", "hook-hashes.txt"),
    (relative) => relative.startsWith("opencode/"),
    (relative) => installedRuntimePathOf(relative, paths),
  );
  for (const divergence of divergences) report.detail(`${divergence.file}: ${divergence.state.kind}`);
  report.check("published runtime bytes", "verified", divergences.length === 0 ? "verified" : `bad:${divergences.length}`);
}

export function checkRuntimeEntrypointsExecutable(report: VerifyReport, paths: CodexPaths): void {
  const entrypoints = [path.join(paths.runtimeRoot, "bin", "oso-state"), path.join(paths.runtimeRoot, "git-hooks", "pre-commit")];
  const missing = entrypoints.filter((entrypoint) => !isExecutableRegularFile(entrypoint));
  for (const entrypoint of missing) report.detail(`not executable: ${entrypoint}`);
  report.check("runtime entrypoints executable", "executable", missing.length === 0 ? "executable" : `not-executable:${missing.length}`);
}

export function checkAgentPayload(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  const sourceDir = path.join(repositoryRoot, "codex", "agents");
  let published: string[];
  try {
    published = readdirSync(sourceDir).filter((name) => name.endsWith(".toml")).sort();
  } catch (cause) {
    if (!isErrnoException(cause) || (cause.code !== "ENOENT" && cause.code !== "ENOTDIR")) throw cause;
    report.detail(`published agents unreadable: ${sourceDir} (${cause.code})`);
    report.check("Codex agents copied exactly", "exact", "source-unreadable");
    return;
  }
  if (published.length === 0) {
    report.detail(`published agents empty: ${sourceDir}`);
    report.check("Codex agents copied exactly", "exact", "source-empty");
    return;
  }
  const installedDir = path.join(paths.codexHome, "agents");
  const divergent = published.filter((name) => {
    const installed = path.join(installedDir, name);
    if (!isReadableRegularFile(installed)) return true;
    return readFileSync(installed, "utf8") !== readFileSync(path.join(sourceDir, name), "utf8");
  });
  for (const name of divergent) report.detail(`divergent agent: ${name}`);
  report.check("Codex agents copied exactly", "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.length}`);
}

export function checkEngramWiring(report: VerifyReport, paths: CodexPaths): void {
  const instructions = path.join(paths.codexHome, "engram-instructions.md");
  const compact = path.join(paths.codexHome, "engram-compact-prompt.md");
  const wired =
    isReadableRegularFile(instructions) &&
    isReadableRegularFile(compact) &&
    mcpServersOf(paths.configFile).some((server) => server.name === "engram");
  report.check("Engram Codex integration", "wired", wired ? "wired" : "incomplete");
}

export function checkImpeccableMount(report: VerifyReport, homeDirectory: string): void {
  const optOut = path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
  if (isReadableRegularFile(optOut)) {
    report.skip("Impeccable Codex mount — the installer recorded --no-impeccable");
    return;
  }
  const mount = path.join(homeDirectory, ".agents", "skills", "impeccable");
  report.check("Impeccable Codex mount", "mounted", isReadableRegularFile(path.join(mount, "SKILL.md")) ? "mounted" : "missing");
}

export function checkMcpToolTableDrift(report: VerifyReport, paths: CodexPaths): void {
  report.check(
    "the hardcoded mandated tool list agrees with core/src/routes/routes.ts in both directions",
    "agree",
    mandatedAgreementStatus(),
  );
  for (const server of mcpServersOf(paths.configFile)) {
    if (server.command === undefined || server.command === "") {
      report.skip(`${server.name} MCP tool drift — no local command in ${paths.configFile} (a remote/URL-based server has no process this check spawns)`);
      continue;
    }
    report.skip(
      `${server.name} MCP tool drift — the live tool list is nightly's; no PR-gate check spawns ${server.command} (G4)`,
    );
  }
}

export function mandatedAgreementStatus(): string {
  const mismatches = [...hardcodedRowsWithNoMandatedRoute(), ...mandatedRoutesNoServerHardcodes()];
  return mismatches.length === 0 ? "agree" : mismatches.join(",");
}

export function hardcodedRowsWithNoMandatedRoute(hardcoded = PROTOCOL_MANDATED_TOOLS): string[] {
  const mismatches: string[] = [];
  for (const server of KNOWN_MCP_SERVERS) {
    for (const bare of hardcoded[server] ?? []) {
      const spelled = `mcp__${server}__${bare}`;
      if (!TOOL_ROWS.some((row) => row.names.codex === spelled && row.mandated === "yes")) {
        mismatches.push(`${spelled}(hardcoded-not-a-yes-row)`);
      }
    }
  }
  return mismatches;
}

export function mandatedRoutesNoServerHardcodes(hardcoded = PROTOCOL_MANDATED_TOOLS): string[] {
  const mismatches: string[] = [];
  for (const row of TOOL_ROWS) {
    if (row.mandated !== "yes" || !row.names.codex.startsWith("mcp__")) continue;
    const server = KNOWN_MCP_SERVERS.find((name) => row.names.codex.startsWith(`mcp__${name}__`));
    if (server === undefined) continue;
    const bare = row.names.codex.slice(`mcp__${server}__`.length);
    if (!(hardcoded[server] ?? []).includes(bare)) mismatches.push(`${row.names.codex}(yes-row-not-hardcoded)`);
  }
  return mismatches;
}

export function mcpServersOf(configFile: string): McpServerEntry[] {
  let document: Record<string, unknown> | undefined;
  try {
    document = readTomlFile(configFile);
  } catch (error) {
    if (error instanceof TomlParseError) return [];
    throw error;
  }
  const servers = document?.["mcp_servers"];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];
  return Object.entries(servers as Record<string, unknown>).map(([name, value]) => {
    const entry = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const command = entry["command"];
    const args = entry["args"];
    return {
      name,
      command: typeof command === "string" ? command : undefined,
      args: Array.isArray(args) ? args.filter((item): item is string => typeof item === "string") : [],
    };
  });
}

export function regionBetween(text: string, start: string, end: string): string | undefined {
  const kept: string[] = [];
  let inside = false;
  let starts = 0;
  let ends = 0;
  for (const line of text === "" ? [] : text.replace(/\n$/, "").split("\n")) {
    if (line === start) {
      starts += 1;
      inside = true;
      continue;
    }
    if (line === end) {
      ends += 1;
      inside = false;
      continue;
    }
    if (inside) kept.push(line);
  }
  if (starts !== 1 || ends !== 1 || inside) return undefined;
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

function featuresVerdictOf(status: ReturnType<typeof managedFeaturesStatus>): string {
  switch (status) {
    case "valid":
      return "valid";
    case "missing":
      return "missing-features";
    case "malformed":
      return "malformed-features";
    case "divergent":
      return "divergent-features";
  }
}

function fallowCommandInside(regionText: string): string {
  const row = regionText.split("\n").find((line) => line.startsWith("command = "));
  if (row === undefined) return "";
  const quoted = row.slice("command = ".length).trim();
  return quoted.startsWith('"') && quoted.endsWith('"')
    ? quoted.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
    : quoted;
}

function installedRuntimePathOf(relative: string, paths: CodexPaths): string | undefined {
  if (relative === "codex/hooks/hooks.json") return path.join(paths.codexHome, "hooks.json");
  for (const [prefix, directory] of [
    ["plugin/dist/", "dist"],
    ["plugin/hooks/", "hooks"],
    ["plugin/git-hooks/", "git-hooks"],
    ["plugin/bin/", "bin"],
  ] as const) {
    if (relative.startsWith(prefix)) return path.join(paths.runtimeRoot, directory, relative.slice(prefix.length));
  }
  return undefined;
}
