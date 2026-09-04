import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OPENCODE_BINARY_NAME } from "../../src/install/opencode-host.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { writeFixtureEngramShim } from "../../src/install/verify-opencode.ts";
import { guardRepositoryGitConfig } from "./repository-git-config-guard.ts";
import { posixSpelled } from "./repository-paths.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const SHIM_CALL_LOG_KEY = "OSO_OPENCODE_SHIM_CALL_LOG";
export const SHIM_UNANSWERED_EXIT = 64;

const HOST_BINARY_NAMES = [OPENCODE_BINARY_NAME, `${OPENCODE_BINARY_NAME}.exe`, `${OPENCODE_BINARY_NAME}.cmd`] as const;

export type BashRun = Readonly<{ status: number; stdout: string; stderr: string }>;

export type StagedFixture = Readonly<{
  home: string;
  configHome: string;
  configFile: string;
  globalFile: string;
  shims: string;
  installLog: string;
}>;

guardRepositoryGitConfig("an OpenCode install or repair drive in this suite");

export function writeOpenCodeShims(directory: string, callLog: string): string {
  mkdirSync(directory, { recursive: true });
  writeExecutable(
    path.join(directory, OPENCODE_BINARY_NAME),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "$${SHIM_CALL_LOG_KEY}"`,
      'case "$*" in',
      `  --version) printf '${SUPPORTED_OPENCODE_VERSION}\\n' ;;`,
      `  *) exit ${SHIM_UNANSWERED_EXIT} ;;`,
      "esac",
    ].join("\n"),
  );
  writeFixtureEngramShim(directory);
  writeExecutable(path.join(directory, "fallow-mcp"), "#!/bin/sh\nexit 0\n");
  writeFileSync(callLog, "");
  return directory;
}

export function shimAnsweredArgv(callLog: string): string[] {
  return readFileSync(callLog, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

export function stageInstalledFixture(root: string, seed: Readonly<{ config?: string; global?: string }> = {}): StagedFixture {
  const home = path.join(root, "home");
  const configHome = path.join(home, ".config", "opencode");
  const shims = writeOpenCodeShims(path.join(root, "shims"), path.join(root, "shim-calls.log"));
  mkdirSync(configHome, { recursive: true });
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  if (seed.config !== undefined) writeFileSync(path.join(configHome, "opencode.json"), seed.config);
  if (seed.global !== undefined) writeFileSync(path.join(configHome, "AGENTS.md"), seed.global);
  const installLog = path.join(root, "install.log");
  const run = runInOpenCodeFixture(home, fixturePathWith(shims), root, [
    process.execPath,
    path.join(repositoryRoot, "bootstrap", "oso.js"),
    "install",
    "--host",
    "opencode",
    "--yes",
    "--no-impeccable",
    "--no-git-hook",
  ]);
  writeFileSync(installLog, `${run.stdout}${run.stderr}`);
  if (run.status !== 0) throw new Error(`oso install --host opencode could not stage the fixture: ${run.stdout}${run.stderr}`);
  return {
    home,
    configHome,
    configFile: path.join(configHome, "opencode.json"),
    globalFile: path.join(configHome, "AGENTS.md"),
    shims,
    installLog,
  };
}

export function pathWithout(binaryNames: readonly string[], environment: NodeJS.ProcessEnv = process.env): string {
  return (environment["PATH"] ?? "")
    .split(path.delimiter)
    .filter((directory) => directory !== "" && !binaryNames.some((name) => existsSync(path.join(directory, name))))
    .join(path.delimiter);
}

export function pathWithoutOpenCode(environment: NodeJS.ProcessEnv = process.env): string {
  return pathWithout(HOST_BINARY_NAMES, environment);
}

export function copyFixtureHome(fixture: StagedFixture, destination: string): StagedFixture {
  const home = path.join(destination, "home");
  mkdirSync(destination, { recursive: true });
  cpSync(fixture.home, home, { recursive: true });
  const configHome = path.join(home, ".config", "opencode");
  return {
    home,
    configHome,
    configFile: path.join(configHome, "opencode.json"),
    globalFile: path.join(configHome, "AGENTS.md"),
    shims: fixture.shims,
    installLog: fixture.installLog,
  };
}

export function fixtureEnvironment(home: string, pathValue: string, root: string): NodeJS.ProcessEnv {
  return {
    PATH: pathValue,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: path.join(root, "tmp"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    [SHIM_CALL_LOG_KEY]: path.join(root, "shim-calls.log"),
  };
}

export function runInOpenCodeFixture(
  home: string,
  pathValue: string,
  root: string,
  argv: readonly string[],
  overrides: NodeJS.ProcessEnv = {},
): BashRun {
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  const [command, ...rest] = argv;
  return outcomeOf(
    spawnSync(command as string, rest, {
      encoding: "utf8",
      env: { ...fixtureEnvironment(home, pathValue, root), ...overrides },
      maxBuffer: 1024 * 1024 * 8,
    }),
  );
}

export function fixturePathWith(shims: string): string {
  return `${shims}${path.delimiter}${pathWithoutOpenCode()}`;
}

function writeExecutable(file: string, body: string): void {
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
  chmodSync(file, 0o700);
}

function outcomeOf(run: SpawnSyncReturns<string>): BashRun {
  return { status: run.status ?? -1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

export type TreeEntry =
  | Readonly<{ relative: string; kind: "directory"; mode: string }>
  | Readonly<{ relative: string; kind: "file"; mode: string; content: string }>;

export function treeUnder(root: string, skip: (relative: string) => boolean = () => false): TreeEntry[] {
  if (!existsSync(root)) return [];
  return entriesUnder(root)
    .map((absolute) => ({ relative: posixSpelled(absolute.slice(root.length + 1)), absolute }))
    .filter((entry) => !skip(entry.relative))
    .sort((one, other) => one.relative.localeCompare(other.relative))
    .map((entry) => treeEntryAt(entry.relative, entry.absolute));
}

export function entryWithHomeSpelledOnce(entry: TreeEntry, home: string): TreeEntry {
  if (entry.kind === "directory") return entry;
  return { ...entry, content: withHomeSpelledOnce(Buffer.from(entry.content, "base64").toString("utf8"), home) };
}

function withHomeSpelledOnce(text: string, home: string): string {
  return text.split(home).join("<home>").split(posixSpelled(home)).join("<home>");
}

function treeEntryAt(relative: string, absolute: string): TreeEntry {
  const stats = lstatSync(absolute);
  const mode = octalSpelled(stats.mode);
  if (stats.isDirectory()) return { relative, kind: "directory", mode };
  return { relative, kind: "file", mode, content: readFileSync(absolute).toString("base64") };
}

function octalSpelled(mode: number): string {
  return `0${(mode & 0o7777).toString(8).padStart(3, "0")}`;
}

function entriesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return [absolute, ...entriesUnder(absolute)];
    return entry.isFile() && statSync(absolute).isFile() ? [absolute] : [];
  });
}
