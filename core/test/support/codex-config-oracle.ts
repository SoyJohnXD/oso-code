import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "./state-sandbox.ts";

export const THE_CONFIG_ORACLE =
  "bootstrap/lib/toml-regions.awk driven by bootstrap/install-codex.sh's own write_config_region assembly, " +
  "with bootstrap/lib/codex-managed-config.sh rendering the body over a fixture CODEX_HOME";

export const THE_HOME_ANCHOR_ORACLE =
  "bootstrap/install-codex.sh's own initialize_paths deriving CODEX_HOME and RUNTIME_ROOT from a fixture HOME alone, " +
  "then write_config_region's call render_codex_managed_config \"$HOME\" \"$RUNTIME_ROOT\" (install-codex.sh:788, " +
  "verify-codex.sh:283) and resolve_fallow_mcp_command \"$HOME\" (install-codex.sh:804) — neither side is handed the anchor";

export type BashRebuild = Readonly<{ status: number; text: string; stderr: string }>;

const PIPELINE = String.raw`
set -uo pipefail
repo="$1"; source_file="$2"; target_home="$3"; runtime_root="$4"; fallow="$5"
. "$repo/bootstrap/lib/codex-managed-config.sh"
resolve_fallow_mcp_command() { printf '%s\n' "$fallow"; }
awk_script="$repo/bootstrap/lib/toml-regions.awk"
start='# oso-code:start'; end='# oso-code:end'
fstart='# oso-code:features:start'; fend='# oso-code:features:end'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
clean="$work/clean"; feature_clean="$work/feature-clean"
root_values="$work/root"; sections="$work/sections"
merged="$work/merged"; block="$work/block"

awk -v action=strip -v start_marker="$start" -v end_marker="$end" -f "$awk_script" "$source_file" > "$clean" || exit 21
awk -v action=features-strip -v feature_start_marker="$fstart" -v feature_end_marker="$fend" \
  -f "$awk_script" "$clean" > "$feature_clean" || exit 22
: > "$root_values"; : > "$sections"
awk -v action=split -v root_file="$root_values" -v sections_file="$sections" -f "$awk_script" "$feature_clean" || exit 23
{ printf '%s\n' "$fstart"; render_codex_managed_features; printf '%s\n' "$fend"; } > "$block"
awk -v action=features-merge -v feature_file="$block" -f "$awk_script" "$sections" > "$merged" || exit 24
{
  awk 'NF { last = NR } { lines[NR] = $0 } END { for (i = 1; i <= last; i++) print lines[i] }' "$root_values"
  [ -s "$root_values" ] && printf '\n'
  printf '%s\n' "$start"
  render_codex_managed_config "$target_home" "$runtime_root"
  printf '%s\n' "$end"
  [ -s "$merged" ] && printf '\n'
  cat "$merged"
} || exit 25
exit 0
`;

const OWNED_KEY_PREFLIGHT = String.raw`
set -uo pipefail
repo="$1"; source_file="$2"
awk_script="$repo/bootstrap/lib/toml-regions.awk"
start='# oso-code:start'; end='# oso-code:end'
fstart='# oso-code:features:start'; fend='# oso-code:features:end'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
awk -v action=strip -v start_marker="$start" -v end_marker="$end" -f "$awk_script" "$source_file" > "$work/clean" || exit 21
awk -v action=features-strip -v feature_start_marker="$fstart" -v feature_end_marker="$fend" \
  -f "$awk_script" "$work/clean" > "$work/feature-clean" || exit 22
awk -v action=root-symbols -f "$awk_script" "$work/feature-clean" > "$work/symbols" || exit 23
if awk '
  /^[[:space:]]*default_permissions[[:space:]]*=/ { found = 1 }
  /^\[agents\][[:space:]]*$/ ||
  /^\[shell_environment_policy\.set\][[:space:]]*$/ ||
  /^\[mcp_servers\.(context7|fallow)\][[:space:]]*$/ ||
  /^\[permissions\.oso(\.|\])[^\r\n]*$/ { found = 1 }
  END { exit found ? 0 : 1 }
' "$work/symbols"; then
  exit 30
fi
exit 0
`;

export function bashRebuiltRegion(
  workspace: string,
  configText: string,
  targetHome: string,
  runtimeRoot: string,
  fallowCommand: string,
): BashRebuild {
  const sourceFile = writeFixtureConfig(workspace, configText);
  const run = spawnSync("bash", ["-c", PIPELINE, "oracle", repositoryRoot, sourceFile, targetHome, runtimeRoot, fallowCommand], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
    maxBuffer: 1024 * 1024 * 8,
  });
  if (run.error !== undefined) throw new Error(`bash could not be spawned as the config oracle: ${run.error.message}`);
  return { status: run.status ?? -1, text: run.stdout, stderr: run.stderr };
}

const HOME_ANCHORED_REGION = String.raw`
set -uo pipefail
repo="$1"; home="$2"; PATH="$3"
. "$repo/bootstrap/lib/codex-managed-config.sh"
HOME="$home"
RUNTIME_ROOT="$HOME/.local/share/oso-code/runtime"
render_codex_managed_config "$HOME" "$RUNTIME_ROOT"
`;

const HOME_ANCHORED_FALLOW = String.raw`
set -uo pipefail
repo="$1"; home="$2"; PATH="$3"
. "$repo/bootstrap/lib/codex-managed-config.sh"
HOME="$home"
resolve_fallow_mcp_command "$HOME" || printf 'fallow-mcp\n'
`;

export function bashManagedRegionForHome(homeDirectory: string, pathValue: string): BashRebuild {
  return runAnchorOracle(HOME_ANCHORED_REGION, "region", homeDirectory, pathValue);
}

export function bashFallowCommandForHome(homeDirectory: string, pathValue: string): BashRebuild {
  return runAnchorOracle(HOME_ANCHORED_FALLOW, "fallow", homeDirectory, pathValue);
}

function runAnchorOracle(script: string, label: string, homeDirectory: string, pathValue: string): BashRebuild {
  const run = spawnSync("bash", ["-c", script, "oracle", repositoryRoot, homeDirectory, pathValue], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
    maxBuffer: 1024 * 1024 * 8,
  });
  if (run.error !== undefined) throw new Error(`bash could not be spawned as the ${label} anchor oracle: ${run.error.message}`);
  return { status: run.status ?? -1, text: run.stdout, stderr: run.stderr };
}

export function bashRefusesOwnedKeyOutsideTheRegion(workspace: string, configText: string): boolean {
  const sourceFile = writeFixtureConfig(workspace, configText);
  const run = spawnSync("bash", ["-c", OWNED_KEY_PREFLIGHT, "oracle", repositoryRoot, sourceFile], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  if (run.error !== undefined) throw new Error(`bash could not be spawned as the preflight oracle: ${run.error.message}`);
  if (run.status !== 0 && run.status !== 30) throw new Error(`the preflight oracle itself failed at exit ${run.status}: ${run.stderr}`);
  return run.status === 30;
}

export function bashIsAvailable(): boolean {
  return spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" }).error === undefined;
}

function writeFixtureConfig(workspace: string, configText: string): string {
  mkdirSync(workspace, { recursive: true });
  const sourceFile = path.join(workspace, "config.toml");
  writeFileSync(sourceFile, configText);
  return sourceFile;
}
