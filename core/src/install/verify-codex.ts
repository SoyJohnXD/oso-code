import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  renderCodexManagedConfig,
} from "./codex-config.ts";
import { codexPathsFor, managedFeaturesStatus, type CodexPaths } from "./codex.ts";
import { type CodexHostProbes } from "./codex-host.ts";
import { SUPPORTED_CODEX_VERSION } from "./pins.ts";
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
  host: CodexHostProbes;
}>;

export type VerifyOutcome = Readonly<{ report: string; exitCode: number }>;

export const LOCAL_CHECKS_SECTION = "local checks:";
export const MCP_DRIFT_SECTION = "MCP tool table drift:";

export function verifyCodex(input: VerifyCodexInput): VerifyOutcome {
  const paths = codexPathsFor(input.homeDirectory, input.environment);
  const report = new VerifyReport();

  report.section(LOCAL_CHECKS_SECTION);
  checkPinnedCodexVersion(report, input.host);
  checkHostBinaryContracts(report, input.host);
  checkPluginInstalled(report, paths, input.host);
  checkPublishedRuntimeBytes(report, paths, input.repositoryRoot);
  checkRuntimeEntrypointsExecutable(report, paths);
  checkAgentPayload(report, paths, input.repositoryRoot);
  checkMarketplacePayload(report, paths, input.repositoryRoot);
  checkManagedConfigRegion(report, paths, input.environment);
  checkHostAcceptsOsoProfile(report, paths, input.host);
  checkGlobalGuidance(report, paths, input.repositoryRoot);
  checkEngramWiring(report, paths);
  checkStateRoundTrip(report, paths);
  checkPlanArtifactRoundTrip(report, paths);
  checkCommitHookDeniesRed(report, paths);
  checkImpeccableMount(report, input.homeDirectory);
  checkGitCommitGate(report, paths, input.repositoryRoot, input.environment);
  checkMcpToolTableDrift(report, paths);

  return { report: report.render(), exitCode: report.exitCode };
}

export function checkPinnedCodexVersion(report: VerifyReport, host: CodexHostProbes): void {
  report.check("Codex CLI version", SUPPORTED_CODEX_VERSION, host.version ?? "not installed");
}

export function checkHostBinaryContracts(report: VerifyReport, host: CodexHostProbes): void {
  for (const contract of HOST_BINARY_CONTRACTS) {
    if (host.binaryPath === undefined) {
      report.skip(`${contract.shortLabel} — codex is not on PATH, so the host contract could not be asserted`);
      continue;
    }
    if (host.version !== SUPPORTED_CODEX_VERSION) {
      report.unverified(
        `${contract.shortLabel} — claims were verified against Codex ${SUPPORTED_CODEX_VERSION} only; installed ` +
          `${host.version ?? "not installed"} falls outside that window, so pass/fail is not asserted here`,
      );
      continue;
    }
    report.check(contract.name, "conformant", binaryCarriesBoth(host.binaryPath, contract.literals) ? "conformant" : "nonconformant");
  }
}

export function checkPluginInstalled(report: VerifyReport, paths: CodexPaths, host: CodexHostProbes): void {
  const listing = host.pluginListing();
  if (!listing.ok) {
    report.check("oso-code plugin installed", "installed", collapsed(listing.output));
    return;
  }
  report.check("oso-code plugin installed", "installed", localPluginSourcePaths(listing.output).includes(path.join(paths.marketplaceRoot, "codex")) ? "installed" : "absent-or-invalid");
}

export function checkMarketplacePayload(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  const divergent: string[] = MARKETPLACE_PAYLOAD_ROWS.flatMap((row) =>
    sameBytes(path.join(repositoryRoot, ...row.published.split("/")), path.join(paths.marketplaceRoot, ...row.installed.split("/"))) ? [] : [row.named],
  );
  for (const skill of publishedSkillNames(repositoryRoot)) {
    const installed = path.join(paths.marketplaceRoot, "codex", "skills", skill, "SKILL.md");
    if (!sameBytes(path.join(repositoryRoot, "codex", "skills", skill, "SKILL.md"), installed)) divergent.push(skill);
  }
  if (!isDirectoryAt(path.join(paths.marketplaceRoot, "codex", "skills", "_shared"))) divergent.push("shared");
  report.check("staged marketplace payload", "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.map((named) => ` ${named}`).join("")}`);
}

export function checkHostAcceptsOsoProfile(report: VerifyReport, paths: CodexPaths, host: CodexHostProbes): void {
  const expected = `1\n${path.join(paths.runtimeRoot, "bin", "oso-state")}`;
  const run = host.sandbox(["/bin/sh", "-c", 'printf "%s\n%s\n" "${OSO_AGENT:-}" "${OSO_STATE_BIN:-}"']);
  const observed = run.ok ? run.output.trim() : collapsed(run.output);
  report.check("Codex accepts the oso permissions profile", "accepted", observed === expected ? "accepted" : observed === "" ? "rejected-without-output" : observed);
}

export function checkStateRoundTrip(report: VerifyReport, paths: CodexPaths): void {
  report.check("installed oso-state round-trip", "probe", installedEntrypointVerdict(paths, "round-trip-failed:empty"));
}

export function checkPlanArtifactRoundTrip(report: VerifyReport, paths: CodexPaths): void {
  report.check("installed Codex plan artifact round-trip", "artifacts", installedEntrypointVerdict(paths, "artifact-round-trip-failed:empty"));
}

export function checkCommitHookDeniesRed(report: VerifyReport, paths: CodexPaths): void {
  report.check("installed git hook denies a red agent commit", "denied", installedEntrypointVerdict(paths, "setup-failed"));
}

export function checkGitCommitGate(report: VerifyReport, paths: CodexPaths, repositoryRoot: string, environment: NodeJS.ProcessEnv): void {
  const wired = path.join(paths.runtimeRoot, "git-hooks");
  const configured = gitConfigured(repositoryRoot, environment);
  if (configured === wired && isExecutableRegularFile(path.join(wired, "pre-commit"))) {
    report.check("git commit gate", "wired", "wired");
    return;
  }
  report.note("git commit gate is not wired for this checkout; the installer may have run with --no-git-hook");
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
  const expected = renderCodexManagedConfig(paths.homeDirectory, paths.runtimeRoot, fallowCommand);
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

export const CODEX_HOOKS_MANIFEST = "codex/hooks/hooks.json";
export const RENDERED_HOOKS_DIR_TOKEN = "__OSO_HOOKS_DIR__";

export function unrenderedHooksManifest(text: string, runtimeRoot: string): string {
  return text.replaceAll(path.posix.join(runtimeRoot, "dist"), RENDERED_HOOKS_DIR_TOKEN);
}

export function checkPublishedRuntimeBytes(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  const divergences = trustDivergences(
    path.join(repositoryRoot, "bootstrap", "hook-hashes.txt"),
    (relative) => relative.startsWith("opencode/"),
    (relative) => installedRuntimePathOf(relative, paths),
    (relative, target) =>
      relative === CODEX_HOOKS_MANIFEST
        ? Buffer.from(unrenderedHooksManifest(readFileSync(target, "utf8"), paths.runtimeRoot), "utf8")
        : readFileSync(target),
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
    report.check(AGENT_PAYLOAD_CHECK, "exact", "source-unreadable");
    return;
  }
  if (published.length === 0) {
    report.detail(`published agents empty: ${sourceDir}`);
    report.check(AGENT_PAYLOAD_CHECK, "exact", "source-empty");
    return;
  }
  const installedDir = path.join(paths.codexHome, "agents");
  const divergent = published.filter((name) => {
    const installed = path.join(installedDir, name);
    if (!isReadableRegularFile(installed)) return true;
    return readFileSync(installed, "utf8") !== readFileSync(path.join(sourceDir, name), "utf8");
  });
  for (const name of divergent) report.detail(`divergent agent: ${name}`);
  report.check(AGENT_PAYLOAD_CHECK, "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.map((named) => ` ${named}`).join("")}`);
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
    report.skip("Impeccable mount — install-codex.sh recorded --no-impeccable");
    return;
  }
  const mount = path.join(homeDirectory, ".agents", "skills", "impeccable");
  report.check("Impeccable Codex mount", "mounted", isReadableRegularFile(path.join(mount, "SKILL.md")) ? "mounted" : "missing");
}

export function checkMcpToolTableDrift(report: VerifyReport, paths: CodexPaths): void {
  report.section(MCP_DRIFT_SECTION);
  report.check("the hardcoded mandated tool list agrees with tools/hook-gates.txt in both directions", "agree", mandatedAgreementStatus());
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
  if (relative === CODEX_HOOKS_MANIFEST) return path.join(paths.codexHome, "hooks.json");
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

const AGENT_PAYLOAD_CHECK = "seven Codex agents copied exactly";

const HOST_BINARY_CONTRACTS = [
  {
    shortLabel: "Codex host contract",
    name: "Codex binary matches the fork_turns host contract",
    literals: [
      "fork_context is not supported in MultiAgentV2; use fork_turns instead",
      "fork_turns must be `none`, `all`, or a positive integer string",
    ],
  },
  {
    shortLabel: "Codex permission-override contract",
    name: "Codex binary matches the default_permissions override contract",
    literals: [
      "default_permissions refers to undefined profile `",
      "`permission_profile` and `default_permissions` overrides cannot both be set",
    ],
  },
] as const;

const MARKETPLACE_PAYLOAD_ROWS = [
  { named: "marketplace.json", published: ".agents/plugins/marketplace.json", installed: ".agents/plugins/marketplace.json" },
  { named: "plugin.json", published: "codex/.codex-plugin/plugin.json", installed: "codex/.codex-plugin/plugin.json" },
] as const;

function installedEntrypointVerdict(paths: CodexPaths, absentVerdict: string): string {
  return isExecutableRegularFile(path.join(paths.runtimeRoot, "bin", "oso-state")) ? "installed-probe-is-nightly-only" : absentVerdict;
}

function binaryCarriesBoth(binary: string, literals: readonly string[]): boolean {
  const bytes = readFileSync(binary, "latin1");
  return literals.every((literal) => bytes.includes(literal));
}

function localPluginSourcePaths(listingJson: string): string[] {
  let listing: unknown;
  try {
    listing = JSON.parse(listingJson);
  } catch {
    return [];
  }
  const installed = isRecord(listing) ? listing["installed"] : undefined;
  if (!Array.isArray(installed)) return [];
  return installed.flatMap((plugin) => {
    if (!isRecord(plugin) || plugin["installed"] !== true || plugin["enabled"] !== true) return [];
    const source = plugin["source"];
    if (!isRecord(source) || source["source"] !== "local" || typeof source["path"] !== "string") return [];
    return [source["path"]];
  });
}

function publishedSkillNames(repositoryRoot: string): string[] {
  try {
    return readdirSync(path.join(repositoryRoot, "codex", "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function sameBytes(published: string, installed: string): boolean {
  if (!isReadableRegularFile(published) || !isReadableRegularFile(installed)) return false;
  return readFileSync(published).equals(readFileSync(installed));
}

function isDirectoryAt(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function gitConfigured(repositoryRoot: string, environment: NodeJS.ProcessEnv): string {
  const run = spawnSync("git", ["-C", repositoryRoot, "config", "--get", "core.hooksPath"], { env: environment, encoding: "utf8" });
  return run.error === undefined && run.status === 0 ? (run.stdout ?? "").trim() : "";
}

function collapsed(text: string): string {
  return text.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
