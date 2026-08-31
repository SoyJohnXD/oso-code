import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OPENCODE_BINARY_NAME } from "../../src/install/opencode-host.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { guardRepositoryGitConfig } from "./repository-git-config-guard.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const SHIM_CALL_LOG_KEY = "OSO_OPENCODE_SHIM_CALL_LOG";
export const SHIM_UNANSWERED_EXIT = 64;

const HOST_BINARY_NAMES = [OPENCODE_BINARY_NAME, `${OPENCODE_BINARY_NAME}.exe`, `${OPENCODE_BINARY_NAME}.cmd`] as const;

export type ShimAnsweredCall = Readonly<{
  argv: string;
  spawnedBy: string;
  definedIn: string;
  callerFunction: string;
  callerScript: string;
}>;

export const SHIM_ANSWERED_CALLS: readonly ShimAnsweredCall[] = [
  {
    argv: "--version",
    spawnedBy: "probe_opencode_version",
    definedIn: "bootstrap/install-opencode.sh",
    callerFunction: "check_baseline",
    callerScript: "bootstrap/install-opencode.sh",
  },
  {
    argv: "--version",
    spawnedBy: "opencode_version_of",
    definedIn: "bootstrap/lib/opencode-verification.sh",
    callerFunction: "opencode_version_status",
    callerScript: "bootstrap/verify-opencode.sh",
  },
];

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
  writeExecutable(
    path.join(directory, "engram"),
    [
      "#!/bin/sh",
      'case "$*" in',
      "  \"setup --help\") printf 'usage: engram setup [<agent>] (claude-code, opencode, codex, ...)\\n'; exit 0 ;;",
      '  "setup opencode")',
      '    mkdir -p "$HOME/.config/opencode/plugins"',
      "    printf 'fixture engram plugin\\n' > \"$HOME/.config/opencode/plugins/engram.ts\"",
      "    exit 0 ;;",
      `  *) exit ${SHIM_UNANSWERED_EXIT} ;;`,
      "esac",
    ].join("\n"),
  );
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
    "bash",
    path.join(repositoryRoot, "bootstrap", "install-opencode.sh"),
    "--yes",
    "--no-impeccable",
    "--no-git-hook",
  ]);
  writeFileSync(installLog, `${run.stdout}${run.stderr}`);
  if (run.status !== 0) throw new Error(`bootstrap/install-opencode.sh could not stage the fixture: ${run.stdout}${run.stderr}`);
  return {
    home,
    configHome,
    configFile: path.join(configHome, "opencode.json"),
    globalFile: path.join(configHome, "AGENTS.md"),
    shims,
    installLog,
  };
}

export function pathWithoutOpenCode(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment["PATH"] ?? "")
    .split(path.delimiter)
    .filter((directory) => directory !== "" && !HOST_BINARY_NAMES.some((name) => existsSync(path.join(directory, name))))
    .join(path.delimiter);
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

export function bashRepair(fixture: StagedFixture, root: string, argv: readonly string[]): BashRun {
  return runInOpenCodeFixture(fixture.home, fixturePathWith(fixture.shims), root, [
    "bash",
    path.join(repositoryRoot, "bootstrap", "repair-opencode.sh"),
    ...argv,
  ]);
}

const RENDER_CONFIG_ORACLE = String.raw`
set -uo pipefail
repo="$1"; home="$2"; recorded="$3"; out="$4"
export HOME="$home"
unset XDG_CONFIG_HOME
mkdir -p "$HOME/.config/opencode" || exit 90
. "$repo/bootstrap/install-opencode.sh" || exit 91
initialize_paths || exit 92
TX_BACKUP_ROOT="$HOME/.tx"
mkdir -p "$TX_BACKUP_ROOT/items" || exit 93
[ "$recorded" = "-" ] || cp "$recorded" "$TX_BACKUP_ROOT/items/config" || exit 94
render_config >/dev/null || exit $?
cp "$CONFIG_FILE" "$out/opencode.json" || exit 95
cp "$TX_BACKUP_ROOT/operator-preserved-keys" "$out/preserved" || exit 96
`;

export type BashRender = Readonly<{ status: number; configText: string; preservedKeys: string[]; stderr: string }>;

export function bashRenderedConfig(workspace: string, recordedConfig: string | undefined, fallowCommand: string): BashRender {
  const home = path.join(workspace, "home");
  const out = path.join(workspace, "out");
  mkdirSync(out, { recursive: true });
  const recorded = recordedPath(workspace, recordedConfig);
  const run = spawnSync("bash", ["-c", RENDER_CONFIG_ORACLE, "oracle", repositoryRoot, home, recorded, out], {
    encoding: "utf8",
    env: { PATH: `${path.dirname(fallowCommand)}${path.delimiter}${pathWithoutOpenCode()}`, HOME: home, USERPROFILE: home },
    maxBuffer: 1024 * 1024 * 8,
  });
  if (run.error !== undefined) throw new Error(`bash could not be spawned as the render_config oracle: ${run.error.message}`);
  return {
    status: run.status ?? -1,
    configText: readIfPresent(path.join(out, "opencode.json")),
    preservedKeys: readIfPresent(path.join(out, "preserved")).split("\n").filter((line) => line !== ""),
    stderr: run.stderr,
  };
}

const VERIFY_ROW_ORACLE = String.raw`
set -uo pipefail
repo="$1"; row="$2"; fixture_root="$3"; fixture_home="$4"; config_home="$5"
. "$repo/bootstrap/verify-opencode.sh" || exit 91
LOCAL_FIXTURE_ROOT="$fixture_root"
LOCAL_FIXTURE_HOME="$fixture_home"
LOCAL_FIXTURE_CONFIG_HOME="$config_home"
shift 5
"$row" "$@"
`;

export function bashVerifyRow(
  row: string,
  fixture: StagedFixture,
  root: string,
  pathValue: string,
  rowArguments: readonly string[] = [],
): BashRun {
  const run = spawnSync(
    "bash",
    ["-c", VERIFY_ROW_ORACLE, "oracle", repositoryRoot, row, root, fixture.home, fixture.configHome, ...rowArguments],
    { encoding: "utf8", env: { ...fixtureEnvironment(fixture.home, pathValue, root) }, maxBuffer: 1024 * 1024 * 8 },
  );
  if (run.error !== undefined) throw new Error(`bash could not be spawned as the ${row} oracle: ${run.error.message}`);
  return outcomeOf(run);
}

export function bashIsAvailable(): boolean {
  return spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" }).error === undefined;
}

function recordedPath(workspace: string, recordedConfig: string | undefined): string {
  if (recordedConfig === undefined) return "-";
  const recorded = path.join(workspace, "recorded.json");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(recorded, recordedConfig);
  return recorded;
}

export function fixturePathWith(shims: string): string {
  return `${shims}${path.delimiter}${pathWithoutOpenCode()}`;
}

function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function writeExecutable(file: string, body: string): void {
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
  chmodSync(file, 0o700);
}

function outcomeOf(run: SpawnSyncReturns<string>): BashRun {
  return { status: run.status ?? -1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
