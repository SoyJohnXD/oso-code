import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonParseError, readJsonFile } from "./json.ts";
import { isPlainObject, OWNED_PERMISSION_VALUES, OWNED_SKILL_MODES, OWNED_SKILL_VERDICT, type ConfigDocument } from "./opencode-config.ts";
import { GLOBAL_MARKER_END, GLOBAL_MARKER_START, opencodePathsFor } from "./opencode.ts";
import type { OpenCodeHostProbes } from "./opencode-host.ts";
import {
  ENGRAM_BINARY_NAME,
  EXPECTED_SKILL_WRAPPER_COUNT,
  installOpenCode,
  openCodeInstallTargets,
  openCodePayloadSources,
  OWNER_INSTALLER,
} from "./opencode-install.ts";
import { openCodeTrustReading, OPENCODE_TRUST_FILE_COUNT, trustDivergenceLine } from "./opencode-trust.ts";
import { isAboveTestedVersion, meetsVersionFloor, SUPPORTED_OPENCODE_VERSION } from "./pins.ts";
import { VerifyReport, type CommandOutcome } from "./report.ts";
import { filesHoldTheSameBytes, isDirectory, isReadableRegularFile } from "../state/store.ts";

export const OPENCODE_NOT_ON_PATH = "opencode-not-on-path";

export const VERSION_ROW_SKIP = "OpenCode CLI version — opencode is not on PATH, so the installed pin could not be probed";

export const LOCAL_CHECKS_SECTION = "local checks:";

export const FIXTURE_ROWS_SKIP = "the fixture-based artifact checks — the isolated install could not complete";

export const OPERATOR_CONFIG_PROBE = {
  theme: "oso-verify-operator-theme",
  permissionKey: "read",
  permissionVerdict: "allow",
  mcpServerName: "oso-verify-operator-server",
  mcpServerCommand: ["operator-cli"],
} as const;

export const OPERATOR_GLOBAL_PROSE = "oso-verify operator prose the installer must not touch";

export const EXPECTED_MODE_COMMAND_COUNT = 4;
export const MODE_COMMAND_AGENT_ROUTE = "build";

export type LocalCheckRowKind = "host" | "config" | "artifact" | "repository";

export type LocalCheckRow = Readonly<{ name: string; kind: LocalCheckRowKind }>;

export const OPENCODE_LOCAL_CHECK_ROWS: readonly LocalCheckRow[] = [
  { name: "OpenCode CLI version", kind: "host" },
  { name: "isolated fixture install", kind: "artifact" },
  { name: "OpenCode config contract", kind: "config" },
  { name: "operator config keys survive an install", kind: "config" },
  { name: "nine skill wrappers and shared bodies installed", kind: "artifact" },
  { name: "agent contracts installed", kind: "artifact" },
  { name: "mode commands installed and routed", kind: "artifact" },
  { name: "plugin entry, modules and routes installed", kind: "artifact" },
  { name: "Engram plugin file installed", kind: "artifact" },
  { name: "global guidance installed", kind: "config" },
  { name: "operator global prose survives an install", kind: "config" },
  { name: "installer-owned targets recorded", kind: "artifact" },
  { name: "published gate bytes as installed", kind: "artifact" },
  { name: "an install outside the named home is refused", kind: "artifact" },
  { name: "OpenCode plugin typecheck", kind: "repository" },
  { name: "OpenCode plugin test suite", kind: "repository" },
  { name: "repository shell syntax", kind: "repository" },
];

const SHELL_SYNTAX_SOURCES: readonly Readonly<{ directory: readonly string[]; suffix: string }>[] = [
  { directory: ["bootstrap"], suffix: ".sh" },
  { directory: ["bootstrap", "lib"], suffix: ".sh" },
  { directory: ["tools"], suffix: ".sh" },
  { directory: ["plugin", "hooks"], suffix: ".sh" },
  { directory: ["tests"], suffix: ".sh" },
  { directory: ["tests", "fixtures"], suffix: ".sh" },
];

const SHELL_SYNTAX_EXTRA_SOURCES: readonly (readonly string[])[] = [["plugin", "git-hooks", "pre-commit"]];

const FIXTURE_SHIMS_DIRECTORY = "shims";
const FIXTURE_SHIM_MODE = 0o700;
const FIXTURE_ENGRAM_SHIM = [
  "#!/bin/sh",
  'case "$*" in',
  "  \"setup --help\") printf 'usage: engram setup [<agent>] (claude-code, opencode, codex, ...)\\n'; exit 0 ;;",
  '  "setup opencode")',
  '    mkdir -p "$HOME/.config/opencode/plugins"',
  "    printf 'fixture engram plugin\\n' > \"$HOME/.config/opencode/plugins/engram.ts\"",
  "    exit 0 ;;",
  "  *) exit 64 ;;",
  "esac",
  "",
].join("\n");

const FIXTURE_PREFIX = "oso-opencode-verify.";
const TEMPORARY_PARENT_UNAVAILABLE = "temporary-parent-unavailable";
const DECOY_CONFIG_TEXT = '{"theme":"decoy"}';

export type VerifyOpenCodeInput = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  host: OpenCodeHostProbes;
}>;

export type InstalledOpenCodeTree = Readonly<{ root: string; home: string; configHome: string }>;

export type FixtureStaging = Readonly<{ kind: "ready"; tree: InstalledOpenCodeTree } | { kind: "failed"; result: string }>;

export function verifyOpenCode(input: VerifyOpenCodeInput): CommandOutcome {
  const report = new VerifyReport();
  report.section(LOCAL_CHECKS_SECTION);
  checkPinnedOpenCodeVersion(report, input.host);

  const staged = stageOpenCodeFixture(input);
  if (staged.kind === "failed") {
    report.check("isolated fixture install", "ready", staged.result);
    report.skip(FIXTURE_ROWS_SKIP);
  } else {
    report.check("isolated fixture install", "ready", "ready");
    try {
      checkInstalledTree(report, input, staged.tree);
    } finally {
      rmSync(staged.tree.root, { recursive: true, force: true });
    }
  }

  checkPluginWorkspaceBar(report, input);
  checkRepositoryShellSyntax(report, input);
  return { report: report.render(), exitCode: report.exitCode };
}

function checkInstalledTree(report: VerifyReport, input: VerifyOpenCodeInput, tree: InstalledOpenCodeTree): void {
  const sources = openCodePayloadSources(input.repositoryRoot);
  const configFile = path.join(tree.configHome, "opencode.json");
  const globalFile = path.join(tree.configHome, "AGENTS.md");
  report.check("OpenCode config contract", "valid", openCodeConfigStatus(configFile));
  report.check("operator config keys survive an install", "preserved", openCodeOperatorKeysStatus(configFile));
  report.check("nine skill wrappers and shared bodies installed", "exact", openCodeSkillStatus(input.repositoryRoot, tree.configHome));
  report.check("agent contracts installed", "exact", openCodeAgentStatus(input.repositoryRoot, tree.configHome));
  report.check("mode commands installed and routed", "exact", openCodeCommandStatus(input.repositoryRoot, tree.configHome));
  report.check("plugin entry, modules and routes installed", "exact", openCodePluginStatus(input.repositoryRoot, tree.configHome));
  report.check("Engram plugin file installed", "present", openCodeEngramStatus(tree.configHome));
  report.check("global guidance installed", "exact", openCodeGlobalStatus(globalFile, readFileSync(sources.global, "utf8")));
  report.check("operator global prose survives an install", "preserved", openCodeOperatorGlobalStatus(globalFile, operatorGlobalSeed()));
  report.check("installer-owned targets recorded", "installer-owned", openCodeRegistryStatus(tree.home, tree.configHome));
  report.check("published gate bytes as installed", "verified", openCodeTrustBytesStatus(sources.publishedHashes, tree.configHome));
  report.check("an install outside the named home is refused", "refused", openCodeConfigHomeGuardStatus(input, tree));
}

function checkPinnedOpenCodeVersion(report: VerifyReport, host: OpenCodeHostProbes): void {
  const version = openCodeVersionStatus(host);
  if (version === OPENCODE_NOT_ON_PATH) {
    report.skip(VERSION_ROW_SKIP);
    return;
  }
  if (!meetsVersionFloor(host.version, SUPPORTED_OPENCODE_VERSION)) {
    report.check("OpenCode CLI version", `${SUPPORTED_OPENCODE_VERSION} or newer`, version, `npm install --global opencode-ai@${SUPPORTED_OPENCODE_VERSION}`);
    return;
  }
  report.check("OpenCode CLI version", version, version);
  if (host.versionNote !== undefined) report.note(host.versionNote);
  if (isAboveTestedVersion(host.version, SUPPORTED_OPENCODE_VERSION)) {
    report.note(`OpenCode ${version} is newer than the ${SUPPORTED_OPENCODE_VERSION} this release was verified against, so the rows below are asserted against a host nothing here measured`);
  }
}

export function stageOpenCodeFixture(input: VerifyOpenCodeInput): FixtureStaging {
  const parent = input.environment["TMPDIR"] ?? tmpdir();
  if (!isDirectory(parent)) return { kind: "failed", result: TEMPORARY_PARENT_UNAVAILABLE };
  const root = mkdtempSync(path.join(parent, FIXTURE_PREFIX));
  const home = path.join(root, "home");
  const configHome = path.join(home, ".config", "opencode");
  mkdirSync(configHome, { recursive: true });
  writeFileSync(path.join(configHome, "opencode.json"), `${JSON.stringify(operatorConfigSeed(), null, 2)}\n`);
  writeFileSync(path.join(configHome, "AGENTS.md"), operatorGlobalSeed());
  writeFixtureEngramShim(fixtureShimsIn(root));

  const outcome = installOpenCode({
    homeDirectory: home,
    repositoryRoot: input.repositoryRoot,
    environment: fixtureEnvironmentFor(input.environment, home, root),
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false,
  });
  if (outcome.exitCode === 0) return { kind: "ready", tree: { root, home, configHome } };
  rmSync(root, { recursive: true, force: true });
  return { kind: "failed", result: `install-failed:${lastReportLine(outcome.report)}` };
}

export function fixtureShimsIn(root: string): string {
  return path.join(root, FIXTURE_SHIMS_DIRECTORY);
}

export function writeFixtureEngramShim(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const shim = path.join(directory, ENGRAM_BINARY_NAME);
  writeFileSync(shim, FIXTURE_ENGRAM_SHIM);
  chmodSync(shim, FIXTURE_SHIM_MODE);
  return shim;
}

export function fixtureEnvironmentFor(environment: NodeJS.ProcessEnv, home: string, root: string): NodeJS.ProcessEnv {
  const inherited = environment["PATH"] ?? "";
  const shims = fixtureShimsIn(root);
  return {
    ...environment,
    PATH: inherited === "" ? shims : `${shims}${path.delimiter}${inherited}`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path.join(root, "tmp"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
  };
}

export function openCodeVersionStatus(host: OpenCodeHostProbes): string {
  return host.version ?? host.versionNote ?? OPENCODE_NOT_ON_PATH;
}

export function openCodeConfigStatus(configFile: string): string {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "malformed";
  const document = read.value;
  if (!Array.isArray(document["plugin"])) return "malformed";
  const servers = document["mcp"];
  if (servers !== undefined && !isPlainObject(servers)) return "malformed";
  for (const server of Object.values(isPlainObject(servers) ? servers : {})) {
    if (!isPlainObject(server) || "env" in server) return "malformed";
  }
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  const skills = isPlainObject(permission["skill"]) ? permission["skill"] : {};
  if (OWNED_SKILL_MODES.some((mode) => skills[mode] !== OWNED_SKILL_VERDICT)) return "malformed";
  for (const grantBoundTool of ["oso_plan_approve", "oso_plan_cancel"] as const) {
    if (permission[grantBoundTool] !== OWNED_PERMISSION_VALUES[grantBoundTool]) return "malformed";
  }
  return "valid";
}

export function operatorConfigSeed(): ConfigDocument {
  return {
    theme: OPERATOR_CONFIG_PROBE.theme,
    permission: { [OPERATOR_CONFIG_PROBE.permissionKey]: OPERATOR_CONFIG_PROBE.permissionVerdict },
    mcp: {
      [OPERATOR_CONFIG_PROBE.mcpServerName]: {
        type: "local",
        command: [...OPERATOR_CONFIG_PROBE.mcpServerCommand],
        enabled: true,
        environment: {},
      },
    },
  };
}

export function openCodeOperatorKeysStatus(configFile: string): string {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "dropped";
  const document = read.value;
  if (document["theme"] !== OPERATOR_CONFIG_PROBE.theme) return "dropped";
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  if (permission[OPERATOR_CONFIG_PROBE.permissionKey] !== OPERATOR_CONFIG_PROBE.permissionVerdict) return "dropped";
  const servers = isPlainObject(document["mcp"]) ? document["mcp"] : {};
  const server = servers[OPERATOR_CONFIG_PROBE.mcpServerName];
  if (!isPlainObject(server)) return "dropped";
  if (JSON.stringify(server["command"]) !== JSON.stringify(OPERATOR_CONFIG_PROBE.mcpServerCommand)) return "dropped";
  return "preserved";
}

export function operatorGlobalSeed(): string {
  return `# Personal OpenCode rules\n\n${OPERATOR_GLOBAL_PROSE}\n`;
}

export function openCodeGlobalStatus(globalFile: string, expectedBody: string): string {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const installed = markerRegionBodyOf(readFileSync(globalFile, "utf8"));
  if (installed === undefined) return "malformed";
  return withoutTrailingNewlines(installed) === withoutTrailingNewlines(expectedBody) ? "exact" : "divergent";
}

export function openCodeOperatorGlobalStatus(globalFile: string, seedText: string): string {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const seedRecords = seedText.split("\n").length - 1;
  const head = readFileSync(globalFile, "utf8").split("\n").slice(0, seedRecords).join("\n");
  return `${head}\n` === seedText ? "preserved" : "rewritten";
}

export function openCodeSkillStatus(repositoryRoot: string, configHome: string): string {
  const sources = openCodePayloadSources(repositoryRoot);
  const wrappers = osoPrefixedNames(sources.skills).filter((name) => isReadableRegularFile(path.join(sources.skills, name, "SKILL.md")));
  const divergent = wrappers.filter((name) => !filesHoldTheSameBytes(path.join(sources.skills, name, "SKILL.md"), path.join(configHome, "skill", name, "SKILL.md")));
  if (wrappers.length !== EXPECTED_SKILL_WRAPPER_COUNT) return `wrapper-count:${wrappers.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  if (!isDirectory(path.join(configHome, "skill", "_shared", "bodies"))) return "missing-shared-bodies";
  if (!isDirectory(path.join(configHome, "skill", "_shared", "platform", "opencode"))) return "missing-platform";
  return treesHoldTheSameBytes(sources.sharedSkills, path.join(configHome, "skill", "_shared")) ? "exact" : "shared-differs";
}

export function openCodeAgentStatus(repositoryRoot: string, configHome: string): string {
  const sources = openCodePayloadSources(repositoryRoot);
  const published = osoPrefixedMarkdownNames(sources.agents);
  const installed = osoPrefixedMarkdownNames(path.join(configHome, "agent"));
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path.join(sources.agents, name), path.join(configHome, "agent", name)));
  if (published.length !== installed.length) return `count:${published.length}!=${installed.length}`;
  return divergent.length === 0 ? "exact" : namedList("divergent", divergent);
}

export function openCodeCommandStatus(repositoryRoot: string, configHome: string): string {
  const sources = openCodePayloadSources(repositoryRoot);
  const published = osoPrefixedMarkdownNames(sources.commands);
  const divergent = published.filter((name) => !filesHoldTheSameBytes(path.join(sources.commands, name), path.join(configHome, "command", name)));
  if (published.length !== EXPECTED_MODE_COMMAND_COUNT) return `count:${published.length}`;
  if (divergent.length > 0) return namedList("divergent", divergent);
  for (const mode of OWNED_SKILL_MODES) {
    const route = agentRouteOf(path.join(configHome, "command", `${mode}.md`));
    if (route !== MODE_COMMAND_AGENT_ROUTE) return `route:${mode}=${route === "" ? "empty" : route}`;
  }
  return "exact";
}

export function openCodePluginStatus(repositoryRoot: string, configHome: string): string {
  const sources = openCodePayloadSources(repositoryRoot);
  if (!filesHoldTheSameBytes(sources.pluginBundle, path.join(configHome, "plugin", "oso-code.js"))) return "entry-divergent";
  const unbundled = directoryEntryNames(path.join(configHome, "plugin")).filter((name) => name.endsWith(".ts") || name === "oso");
  return unbundled.length === 0 ? "exact" : `unbundled-sources:${unbundled.length}`;
}

export function openCodeEngramStatus(configHome: string): string {
  return isReadableRegularFile(path.join(configHome, "plugins", "engram.ts")) ? "present" : "missing";
}

export function openCodeRegistryStatus(home: string, configHome: string): string {
  const paths = opencodePathsFor(home, { XDG_CONFIG_HOME: path.dirname(configHome) });
  const targets = openCodeInstallTargets(paths);
  if (!isReadableRegularFile(targets.ownerRegistry)) return "missing";
  const owned = new Set(
    readFileSync(targets.ownerRegistry, "utf8")
      .split("\n")
      .filter((row) => row.startsWith(`${OWNER_INSTALLER}\t`))
      .map((row) => row.slice(OWNER_INSTALLER.length + 1)),
  );
  const expected = [
    paths.configFile,
    paths.globalFile,
    targets.skills,
    targets.agents,
    targets.commands,
    targets.plugin,
    path.join(targets.stateBin, "oso-state"),
    path.join(targets.gitHooks, "pre-commit"),
    ...directoryEntryNames(targets.hooks)
      .filter((name) => name.endsWith(".sh"))
      .map((name) => path.join(targets.hooks, name)),
  ];
  const missing = expected.filter((target) => installedTargetExists(target) && !owned.has(target)).map((target) => relativeToHome(target, home));
  return missing.length === 0 ? "installer-owned" : namedList("missing", missing);
}

export function openCodeTrustBytesStatus(publishedHashes: string, configHome: string): string {
  const reading = openCodeTrustReading(publishedHashes, "installed", configHome);
  if (reading.divergences.length > 0) return `bad:${foldedLines(reading.divergences.map(trustDivergenceLine))}`;
  return reading.filesRead === OPENCODE_TRUST_FILE_COUNT ? "verified" : `covers:${reading.filesRead}`;
}

export function openCodeConfigHomeGuardStatus(input: VerifyOpenCodeInput, tree: InstalledOpenCodeTree): string {
  const decoy = path.join(tree.root, "decoy-config");
  const decoyConfigHome = path.join(decoy, "opencode");
  mkdirSync(decoyConfigHome, { recursive: true });
  writeFileSync(path.join(decoyConfigHome, "opencode.json"), `${DECOY_CONFIG_TEXT}\n`);

  const outcome = installOpenCode({
    homeDirectory: tree.home,
    repositoryRoot: input.repositoryRoot,
    environment: { ...fixtureEnvironmentFor(input.environment, tree.home, tree.root), XDG_CONFIG_HOME: decoy },
    platform: input.platform,
    host: { version: SUPPORTED_OPENCODE_VERSION },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false,
  });
  if (outcome.exitCode !== 2) return `exit:${outcome.exitCode}`;
  if (readFileSync(path.join(decoyConfigHome, "opencode.json"), "utf8").trim() !== DECOY_CONFIG_TEXT) return "overwrote-the-decoy-config";
  const entries = directoryEntryNames(decoyConfigHome).length;
  return entries === 1 ? "refused" : `wrote-into-the-decoy:${entries}`;
}

function checkPluginWorkspaceBar(report: VerifyReport, input: VerifyOpenCodeInput): void {
  const workspace = path.join(input.repositoryRoot, "opencode");
  if (!isReadableRegularFile(path.join(workspace, "package.json")) || !onPath(input.environment, "npx")) {
    report.skip("OpenCode plugin typecheck — npx or opencode/package.json is not available");
  } else {
    report.check("OpenCode plugin typecheck", "clean", ranCleanly("npx", ["tsc", "--noEmit"], workspace, input.environment) ? "clean" : "fail");
  }
  if (!onPath(input.environment, "node")) {
    report.skip("OpenCode plugin test suite — node is not available");
    return;
  }
  report.check("OpenCode plugin test suite", "pass", ranCleanly("node", ["--test"], workspace, input.environment) ? "pass" : "fail");
}

function checkRepositoryShellSyntax(report: VerifyReport, input: VerifyOpenCodeInput): void {
  const unparseable = shellSourcesUnder(input.repositoryRoot)
    .filter((source) => !ranCleanly("bash", ["-n", source], input.repositoryRoot, input.environment))
    .map((source) => path.basename(source));
  report.check("repository shell syntax", "clean", unparseable.length === 0 ? "clean" : namedList("bad", unparseable));
}

export function shellSourcesUnder(repositoryRoot: string): string[] {
  const globbed = SHELL_SYNTAX_SOURCES.flatMap((source) => {
    const directory = path.join(repositoryRoot, ...source.directory);
    return directoryEntryNames(directory)
      .filter((name) => name.endsWith(source.suffix))
      .map((name) => path.join(directory, name));
  });
  const named = SHELL_SYNTAX_EXTRA_SOURCES.map((segments) => path.join(repositoryRoot, ...segments));
  return [...globbed, ...named].filter(isReadableRegularFile);
}

type ConfigRead = Readonly<{ kind: "missing" } | { kind: "unparseable" } | { kind: "parsed"; value: unknown }>;

function readConfigDocument(configFile: string): ConfigRead {
  if (!isReadableRegularFile(configFile)) return { kind: "missing" };
  try {
    return { kind: "parsed", value: readJsonFile(configFile) };
  } catch (error) {
    if (error instanceof JsonParseError) return { kind: "unparseable" };
    throw error;
  }
}

function markerRegionBodyOf(content: string): string | undefined {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const body: string[] = [];
  let starts = 0;
  let ends = 0;
  let inside = false;
  for (const record of records) {
    if (record === GLOBAL_MARKER_START) {
      starts += 1;
      inside = true;
      continue;
    }
    if (record === GLOBAL_MARKER_END) {
      ends += 1;
      inside = false;
      continue;
    }
    if (inside) body.push(record);
  }
  if (starts !== 1 || ends !== 1 || inside) return undefined;
  return body.join("\n");
}

function withoutTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

function agentRouteOf(commandFile: string): string {
  if (!isReadableRegularFile(commandFile)) return "";
  const routed = readFileSync(commandFile, "utf8")
    .split("\n")
    .flatMap((line) => {
      const match = /^agent:[ \t]*(.*)$/.exec(line);
      return match === null ? [] : [match[1] as string];
    });
  return routed[0] ?? "";
}

function treesHoldTheSameBytes(published: string, installed: string): boolean {
  const publishedFiles = relativeFilesUnder(published);
  const installedFiles = relativeFilesUnder(installed);
  if (publishedFiles.length !== installedFiles.length) return false;
  return publishedFiles.every(
    (relative, index) => relative === installedFiles[index] && filesHoldTheSameBytes(path.join(published, relative), path.join(installed, relative)),
  );
}

function relativeFilesUnder(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { recursive: true })
    .map((entry) => entry.toString())
    .filter((relative) => isReadableRegularFile(path.join(directory, relative)))
    .sort();
}

function installedTargetExists(target: string): boolean {
  return isReadableRegularFile(target) || isDirectory(target);
}

function relativeToHome(target: string, home: string): string {
  return target.startsWith(`${home}${path.sep}`) ? target.slice(home.length + 1) : target;
}

function directoryEntryNames(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch {
    return [];
  }
}

function osoPrefixedNames(directory: string): string[] {
  return directoryEntryNames(directory).filter((name) => name.startsWith("oso-"));
}

function osoPrefixedMarkdownNames(directory: string): string[] {
  return osoPrefixedNames(directory).filter((name) => name.endsWith(".md") && isReadableRegularFile(path.join(directory, name)));
}

function namedList(verdict: string, names: readonly string[]): string {
  return `${verdict}:${names.map((name) => ` ${name}`).join("")}`;
}

function foldedLines(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").replace(/\s+$/, "");
}

function onPath(environment: NodeJS.ProcessEnv, binaryName: string): boolean {
  return spawnSync(binaryName, ["--version"], { env: environment, encoding: "utf8" }).error === undefined;
}

function ranCleanly(command: string, argv: readonly string[], workingDirectory: string, environment: NodeJS.ProcessEnv): boolean {
  const run = spawnSync(command, [...argv], { cwd: workingDirectory, env: environment, encoding: "utf8" });
  return run.error === undefined && run.status === 0;
}

function lastReportLine(report: string): string {
  const lines = report.split("\n").filter((line) => line !== "");
  return lines.at(-1) ?? "";
}
