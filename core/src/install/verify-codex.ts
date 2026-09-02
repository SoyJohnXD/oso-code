import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  renderCodexManagedConfig,
} from "./codex-config.ts";
import { codexPathsFor, managedFeaturesStatus, normalizedEngramPointerConfig, type CodexPaths } from "./codex.ts";
import { type CodexHostProbes } from "./codex-host.ts";
import { readJsonObject } from "./json.ts";
import { isAboveTestedVersion, meetsVersionFloor, SUPPORTED_CODEX_VERSION } from "./pins.ts";
import { VerifyReport } from "./report.ts";
import { runTomlRegion } from "./toml-regions.ts";
import { parseTomlDocument, readTomlFile, TomlParseError } from "./toml.ts";
import { trustDivergences } from "./trust.ts";
import { runOsoStateProbe } from "./verify-claude.ts";
import { TOOL_ROWS } from "../routes/routes.ts";
import {
  filesHoldTheSameBytes,
  isDirectory,
  isErrnoException,
  isExecutableRegularFile,
  isReadableRegularFile,
  isRegularNonSymlinkFile,
} from "../state/store.ts";

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
  const configParses = checkCodexConfigParses(report, paths);
  checkPinnedCodexVersion(report, input.host);
  checkHostBinaryContracts(report, input.host);
  checkPluginInstalled(report, paths, input.repositoryRoot, input.host);
  checkPublishedRuntimeBytes(report, paths, input.repositoryRoot);
  checkRuntimeEntrypointsExecutable(report, paths);
  checkAgentPayload(report, paths, input.repositoryRoot);
  checkMarketplacePayload(report, paths, input.repositoryRoot);
  checkManagedConfigRegion(report, paths, input.environment);
  checkHostAcceptsOsoProfile(report, paths, input.host);
  checkGlobalGuidance(report, paths, input.repositoryRoot);
  checkEngramWiring(report, paths, configParses);
  checkStateRoundTrip(report, paths, input.environment);
  checkPlanArtifactRoundTrip(report, paths, input.environment);
  checkCommitHookDeniesRed(report, paths, input.environment);
  checkImpeccableMount(report, input.homeDirectory);
  checkGitCommitGate(report, paths, input.repositoryRoot, input.environment);
  checkMcpToolTableDrift(report, paths, configParses);

  return { report: report.render(), exitCode: report.exitCode };
}

export function checkCodexConfigParses(report: VerifyReport, paths: CodexPaths): boolean {
  if (!isReadableRegularFile(paths.configFile)) {
    report.skip(`Codex config parses — ${paths.configFile} is not present`);
    return true;
  }
  try {
    parseTomlDocument(readFileSync(paths.configFile, "utf8"), paths.configFile);
  } catch (error) {
    if (!(error instanceof TomlParseError)) throw error;
    report.check("Codex config parses", "parses", error.message);
    return false;
  }
  report.check("Codex config parses", "parses", "parses");
  return true;
}

export function checkPinnedCodexVersion(report: VerifyReport, host: CodexHostProbes): void {
  const found = host.version ?? host.versionNote ?? "not installed";
  if (!meetsVersionFloor(host.version, SUPPORTED_CODEX_VERSION)) {
    report.check("Codex CLI version", `${SUPPORTED_CODEX_VERSION} or newer`, found, `npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`);
    return;
  }
  report.check("Codex CLI version", found, found);
  if (host.versionNote !== undefined) report.note(host.versionNote);
  if (isAboveTestedVersion(host.version, SUPPORTED_CODEX_VERSION)) {
    report.note(`Codex ${found} is newer than the ${SUPPORTED_CODEX_VERSION} this release was verified against, so the host binary contracts below report unverified rather than pass or fail`);
  }
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

export function checkPluginInstalled(report: VerifyReport, paths: CodexPaths, repositoryRoot: string, host: CodexHostProbes): void {
  const listing = host.pluginListing();
  if (!listing.ok) {
    report.check("oso-code plugin installed", "installed", collapsed(listing.output));
    return;
  }
  const manifest = codexPluginManifestOf(repositoryRoot);
  if (manifest === undefined) {
    report.check("oso-code plugin installed", "installed", "plugin-manifest-unreadable");
    return;
  }
  const sourcePaths = localPluginSourcePaths(listing.output, manifest);
  report.check("oso-code plugin installed", "installed", sourcePaths.includes(path.join(paths.marketplaceRoot, "codex")) ? "installed" : "absent-or-invalid");
}

export function checkMarketplacePayload(report: VerifyReport, paths: CodexPaths, repositoryRoot: string): void {
  const divergent: string[] = MARKETPLACE_PAYLOAD_ROWS.flatMap((row) =>
    filesHoldTheSameBytes(path.join(repositoryRoot, ...row.published.split("/")), path.join(paths.marketplaceRoot, ...row.installed.split("/"))) ? [] : [row.named],
  );
  for (const skill of publishedSkillNames(repositoryRoot)) {
    const installed = path.join(paths.marketplaceRoot, "codex", "skills", skill);
    if (!directoryTreesHoldTheSameBytes(path.join(repositoryRoot, "codex", "skills", skill), installed)) divergent.push(skill);
  }
  if (!directoryTreesHoldTheSameBytes(path.join(repositoryRoot, "plugin", "skills", "_shared"), path.join(paths.marketplaceRoot, "codex", "skills", "_shared"))) {
    divergent.push("shared");
  }
  report.check("staged marketplace payload", "exact", divergent.length === 0 ? "exact" : `divergent:${divergent.map((named) => ` ${named}`).join("")}`);
}

export function checkHostAcceptsOsoProfile(report: VerifyReport, paths: CodexPaths, host: CodexHostProbes): void {
  const expected = `1\n${path.join(paths.runtimeRoot, "bin", "oso-state")}`;
  const run = host.sandbox(["/bin/sh", "-c", 'printf "%s\n%s\n" "${OSO_AGENT:-}" "${OSO_STATE_BIN:-}"']);
  const observed = run.ok ? run.output.trim() : collapsed(run.output);
  report.check("Codex accepts the oso permissions profile", "accepted", observed === expected ? "accepted" : observed === "" ? "rejected-without-output" : observed);
}

export function checkStateRoundTrip(report: VerifyReport, paths: CodexPaths, environment: NodeJS.ProcessEnv): void {
  const probe = runOsoStateProbe(path.join(paths.runtimeRoot, "bin", "oso-state"), environment);
  report.check("installed oso-state round-trip", "probe", probe === "" ? "round-trip-failed:empty" : probe);
}

export function checkPlanArtifactRoundTrip(report: VerifyReport, paths: CodexPaths, environment: NodeJS.ProcessEnv): void {
  const stateBin = path.join(paths.runtimeRoot, "bin", "oso-state");
  report.check("installed Codex plan artifact round-trip", "artifacts", planArtifactRoundTripVerdict(stateBin, environment));
}

export function checkCommitHookDeniesRed(report: VerifyReport, paths: CodexPaths, environment: NodeJS.ProcessEnv): void {
  report.check("installed git hook denies a red agent commit", "denied", commitHookRedVerdict(paths, environment));
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

export function checkEngramWiring(report: VerifyReport, paths: CodexPaths, configParses: boolean): void {
  if (!configParses) {
    report.skip(`Engram Codex integration — ${paths.configFile} is unparseable, so the MCP server table could not be read`);
    return;
  }
  const instructions = path.join(paths.codexHome, "engram-instructions.md");
  const compact = path.join(paths.codexHome, "engram-compact-prompt.md");
  const wired =
    isReadableRegularFile(instructions) &&
    isReadableRegularFile(compact) &&
    isReadableRegularFile(paths.configFile) &&
    mcpServersOf(paths.configFile).some((server) => server.name === "engram") &&
    engramPointersAreNormalized(paths);
  report.check("Engram Codex integration", "wired", wired ? "wired" : "incomplete");
}

function engramPointersAreNormalized(paths: CodexPaths): boolean {
  const text = readFileSync(paths.configFile, "utf8");
  const normalized = normalizedEngramPointerConfig(paths, text);
  return normalized.exitCode === 0 && normalized.stdout === text;
}

export function checkImpeccableMount(report: VerifyReport, homeDirectory: string): void {
  const optOut = path.join(homeDirectory, ".local", "state", "oso-code", "impeccable-opt-out");
  if (isReadableRegularFile(optOut)) {
    report.skip("Impeccable mount — an install recorded --no-impeccable");
    return;
  }
  const mount = path.join(homeDirectory, ".agents", "skills", "impeccable");
  report.check("Impeccable Codex mount", "mounted", isReadableRegularFile(path.join(mount, "SKILL.md")) ? "mounted" : "missing");
}

export function checkMcpToolTableDrift(report: VerifyReport, paths: CodexPaths, configParses: boolean): void {
  report.section(MCP_DRIFT_SECTION);
  report.check("the hardcoded mandated tool list agrees with the routes table in both directions", "agree", mandatedAgreementStatus());
  if (!configParses) {
    report.skip(`MCP server inventory — ${paths.configFile} is unparseable, so per-server tool drift could not be checked`);
    return;
  }
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
  const document = readTomlFile(configFile);
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

const COMMIT_HOOK_PROBE_SESSION = "1";
const COMMIT_HOOK_DENIAL_PHRASE = "oso-code: the session verify is not green.";

function commitHookRedVerdict(paths: CodexPaths, environment: NodeJS.ProcessEnv): string {
  const probeHome = mkdtempSync(path.join(tmpdir(), "oso-commit-hook-probe-"));
  try {
    const probeRepo = path.join(probeHome, "repo");
    mkdirSync(probeRepo, { recursive: true });

    if (spawnSync("git", ["-C", probeRepo, "init", "-q"], { encoding: "utf8" }).status !== 0) return "git-init-failed";
    writeFileSync(path.join(probeRepo, "baseline.txt"), "baseline\n");
    if (spawnSync("git", ["-C", probeRepo, "add", "baseline.txt"], { encoding: "utf8" }).status !== 0) return "setup-failed";
    const baseline = spawnSync(
      "git",
      ["-C", probeRepo, "-c", "core.hooksPath=/dev/null", "-c", "user.name=oso-code", "-c", "user.email=probe@oso-code.invalid", "commit", "-qm", "test: baseline"],
      { encoding: "utf8" },
    );
    if (baseline.status !== 0) return "setup-failed";
    const baseCommit = headOfProbeRepo(probeRepo);

    const env = { ...environment, HOME: probeHome, USERPROFILE: probeHome };
    const armed = spawnSync(
      process.execPath,
      [path.join(paths.runtimeRoot, "bin", "oso-state"), "--session", COMMIT_HOOK_PROBE_SESSION, "set", "mode=quick", "active_slice=none", "verify_green=false"],
      { cwd: probeRepo, env, encoding: "utf8" },
    );
    if (armed.error !== undefined || armed.status !== 0) return "setup-failed";
    const wired = spawnSync("git", ["-C", probeRepo, "config", "core.hooksPath", path.join(paths.runtimeRoot, "git-hooks")], { encoding: "utf8" });
    if (wired.status !== 0) return "setup-failed";

    writeFileSync(path.join(probeRepo, "pending.txt"), "pending\n");
    if (spawnSync("git", ["-C", probeRepo, "add", "pending.txt"], { encoding: "utf8" }).status !== 0) return "setup-failed";

    const attempt = spawnSync(
      "git",
      ["-C", probeRepo, "-c", "user.name=oso-code", "-c", "user.email=probe@oso-code.invalid", "commit", "-m", "test: must be denied"],
      { env: { ...env, OSO_AGENT: "1" }, encoding: "utf8" },
    );
    if (attempt.error === undefined && attempt.status === 0) return "commit-was-allowed";

    const refusal = `${attempt.stdout ?? ""}${attempt.stderr ?? ""}`;
    if (headOfProbeRepo(probeRepo) === baseCommit && refusal.includes(COMMIT_HOOK_DENIAL_PHRASE)) return "denied";
    return refusal === "" ? "empty" : collapsed(refusal);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

function headOfProbeRepo(probeRepo: string): string {
  const result = spawnSync("git", ["-C", probeRepo, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const PLAN_ARTIFACT_PROBE_SESSION = "verify-probe";
const PLAN_ARTIFACT_PROBE_DIGEST = `${"0".repeat(63)}1`;
const PLAN_ARTIFACT_PROBE_SLICE = "probe-slice";
const PLAN_ARTIFACT_PROBE_DOCUMENT = "# Verified plan";
const PLAN_ARTIFACT_AMENDMENT_DOCUMENT = "### Slice probe";
const PLAN_ARTIFACT_AMENDMENT_LINE = `## Execution amendment — ${PLAN_ARTIFACT_PROBE_SLICE}`;

function planArtifactRoundTripVerdict(stateBin: string, environment: NodeJS.ProcessEnv): string {
  const probeHome = mkdtempSync(path.join(tmpdir(), "oso-plan-probe-"));
  try {
    const probeRepo = path.join(probeHome, "repo");
    mkdirSync(probeRepo, { recursive: true });
    const init = spawnSync("git", ["-C", probeRepo, "init", "-q"], { encoding: "utf8" });
    if (init.error !== undefined || init.status !== 0) return "git-init-failed";

    const env = { ...environment, HOME: probeHome, USERPROFILE: probeHome };
    const runStateScript = (input: string | undefined, ...args: string[]) =>
      spawnSync(process.execPath, [stateBin, "--session", PLAN_ARTIFACT_PROBE_SESSION, ...args], { cwd: probeRepo, input, env, encoding: "utf8" });

    const capture = runStateScript(PLAN_ARTIFACT_PROBE_DOCUMENT, "capture-plan", PLAN_ARTIFACT_PROBE_DIGEST);
    if (capture.error !== undefined || capture.status !== 0) return "artifact-round-trip-failed:empty";
    const approve = runStateScript(undefined, "approve-plan", PLAN_ARTIFACT_PROBE_DIGEST);
    if (approve.error !== undefined || approve.status !== 0) return "artifact-round-trip-failed:empty";
    const amend = runStateScript(PLAN_ARTIFACT_AMENDMENT_DOCUMENT, "amend-plan", PLAN_ARTIFACT_PROBE_SLICE);
    if (amend.error !== undefined || amend.status !== 0) return "artifact-round-trip-failed:empty";
    const show = runStateScript(undefined, "show");
    if (show.error !== undefined || show.status !== 0) {
      const failure = collapsed(`${show.stdout ?? ""}${show.stderr ?? ""}`);
      return `artifact-round-trip-failed:${failure === "" ? "empty" : failure}`;
    }
    return planArtifactContractVerdict(show.stdout);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

function planArtifactContractVerdict(stateOutput: string): string {
  const snapshot = stateLineValue(stateOutput, "plan_snapshot_file");
  const current = stateLineValue(stateOutput, "plan_current_file");
  const matches =
    stateLineValue(stateOutput, "plan_approval") === "approved" &&
    stateLineValue(stateOutput, "plan_revision") === "1" &&
    isRegularNonSymlinkFile(snapshot) &&
    readFileSync(snapshot, "utf8") === PLAN_ARTIFACT_PROBE_DOCUMENT &&
    isRegularNonSymlinkFile(current) &&
    readFileSync(current, "utf8").includes(PLAN_ARTIFACT_AMENDMENT_LINE);
  return matches ? "artifacts" : "artifact-contract-mismatch";
}

function stateLineValue(text: string, key: string): string {
  const prefix = `${key}=`;
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? "" : line.slice(prefix.length);
}

function binaryCarriesBoth(binary: string, literals: readonly string[]): boolean {
  const bytes = readFileSync(binary, "latin1");
  return literals.every((literal) => bytes.includes(literal));
}

type CodexPluginManifest = Readonly<{ name: string; version: string }>;

function codexPluginManifestOf(repositoryRoot: string): CodexPluginManifest | undefined {
  let document: Record<string, unknown>;
  try {
    document = readJsonObject(path.join(repositoryRoot, "codex", ".codex-plugin", "plugin.json"));
  } catch {
    return undefined;
  }
  const name = document["name"];
  const version = document["version"];
  return typeof name === "string" && typeof version === "string" ? { name, version } : undefined;
}

function localPluginSourcePaths(listingJson: string, manifest: CodexPluginManifest): string[] {
  let listing: unknown;
  try {
    listing = JSON.parse(listingJson);
  } catch {
    return [];
  }
  const installed = isRecord(listing) ? listing["installed"] : undefined;
  if (!Array.isArray(installed)) return [];
  const expectedPluginId = `${manifest.name}@${manifest.name}`;
  return installed.flatMap((plugin) => {
    if (!isRecord(plugin)) return [];
    if (plugin["pluginId"] !== expectedPluginId) return [];
    if (plugin["marketplaceName"] !== manifest.name) return [];
    if (plugin["version"] !== manifest.version) return [];
    if (plugin["installed"] !== true || plugin["enabled"] !== true) return [];
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

function directoryTreesHoldTheSameBytes(source: string, installed: string): boolean {
  if (!isDirectory(installed)) return false;
  const sourceFiles = relativeFilesUnder(source);
  if (sourceFiles.length === 0) return false;
  const installedFiles = relativeFilesUnder(installed);
  if (sourceFiles.length !== installedFiles.length) return false;
  return sourceFiles.every(
    (relative) => installedFiles.includes(relative) && filesHoldTheSameBytes(path.join(source, relative), path.join(installed, relative)),
  );
}

function relativeFilesUnder(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { recursive: true })
    .map((entry) => entry.toString())
    .filter((relative) => isRegularNonSymlinkFile(path.join(directory, relative)))
    .sort();
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
