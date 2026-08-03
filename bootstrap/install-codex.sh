#!/usr/bin/env bash
# Install oso-code's Codex surfaces without purging unrelated user state.
#
# Usage: install-codex.sh [--yes] [--no-impeccable] [--no-git-hook]

set -euo pipefail

SUPPORTED_CODEX_VERSION=0.146.0
CONFIG_MARKER_START="# oso-code:start"
CONFIG_MARKER_END="# oso-code:end"
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
  CONFIG_FILE="$CODEX_HOME/config.toml"
  GLOBAL_FILE="$CODEX_HOME/AGENTS.md"
  RUNTIME_ROOT="$HOME/.local/share/oso-code/runtime"
  HOOKS_TARGET="$CODEX_HOME/hooks.json"
  AGENTS_TARGET="$CODEX_HOME/agents"
  MARKETPLACE_ROOT="$HOME/.local/share/oso-code/codex-marketplace"
  MARKETPLACE_TEMPLATE="$REPO_ROOT/.agents/plugins/marketplace.json"
  HASHES_FILE="$SCRIPT_DIR/hook-hashes.txt"
  IMPECCABLE_MOUNT="$HOME/.agents/skills/impeccable"
  IMPECCABLE_OPT_OUT_MARKER="$HOME/.local/state/oso-code/impeccable-opt-out"
  TX_BACKUP_ROOT="$HOME/.local/state/oso-code/install-backup-$(date +%Y%m%d-%H%M%S)-$$"
  TX_MANIFEST="$TX_BACKUP_ROOT/manifest"
  TX_ACTIVE=false
  TX_COMMITTED=false
}

parse_args() {
  ASSUME_YES=false
  INSTALL_IMPECCABLE=true
  INSTALL_GIT_HOOK=true
  for arg in "$@"; do
    case "$arg" in
      --yes) ASSUME_YES=true ;;
      --no-impeccable) INSTALL_IMPECCABLE=false ;;
      --no-git-hook) INSTALL_GIT_HOOK=false ;;
      *) usage_error "unknown flag: $arg" ;;
    esac
  done
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "sha256sum or shasum is required to verify published hook hashes"
  fi
}

verify_published_hooks() {
  [ -f "$HASHES_FILE" ] || fail "published hook hash manifest is missing: $HASHES_FILE"
  local expected relative actual count=0 seen=$'\n' paths=""
  local required_paths
  required_paths='codex/hooks/hooks.json
plugin/hooks/block-commit-until-green.sh
plugin/hooks/block-edits-without-slice.sh
plugin/hooks/block-unknown-tool.sh
plugin/hooks/publish-subagent-handoff.sh
plugin/hooks/capture-plan-approval.sh
plugin/hooks/approve-plan-token.sh
plugin/hooks/warn-stale-state.sh
plugin/hooks/cleanup-state.sh
plugin/bin/oso-state
plugin/hooks/lib.sh
plugin/hooks/lexer.sh'
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$expected" in
      *[!0-9a-f]*|'') fail "invalid published SHA-256 in $HASHES_FILE" ;;
    esac
    [ "${#expected}" -eq 64 ] || fail "invalid published SHA-256 for $relative"
    case "$relative" in
      codex/hooks/hooks.json|plugin/hooks/*.sh|plugin/bin/oso-state) ;;
      *) fail "published hook path is outside the Codex trust set: $relative" ;;
    esac
    case "$seen" in
      *$'\n'"$relative"$'\n'*) fail "duplicate published hook path: $relative" ;;
    esac
    seen="$seen$relative"$'\n'
    if [ -n "$paths" ]; then paths="$paths
"; fi
    paths="$paths$relative"
    [ -f "$REPO_ROOT/$relative" ] || fail "published hook source is missing: $relative"
    actual="$(sha256_file "$REPO_ROOT/$relative")"
    [ "$actual" = "$expected" ] ||
      fail "published hook hash mismatch for $relative (expected $expected, got $actual)"
    count=$((count + 1))
  done < "$HASHES_FILE"
  [ "$count" -eq 12 ] || fail "published hook manifest must cover exactly 12 Codex trust files (found $count)"
  [ "$paths" = "$required_paths" ] ||
    fail "published hook coverage or order differs from the frozen Codex trust set"
}

codex_version() {
  codex --version 2>/dev/null | awk '{ print $NF }'
}

ensure_codex_version() {
  local current=""
  if command -v codex >/dev/null 2>&1; then
    current="$(codex_version || true)"
  fi
  if [ "$current" != "$SUPPORTED_CODEX_VERSION" ]; then
    command -v npm >/dev/null 2>&1 ||
      fail "npm is required to install Codex CLI $SUPPORTED_CODEX_VERSION"
    info "installing Codex CLI $SUPPORTED_CODEX_VERSION"
    npm install --global "@openai/codex@$SUPPORTED_CODEX_VERSION"
  fi
  command -v codex >/dev/null 2>&1 || fail "Codex CLI was not installed"
  current="$(codex_version || true)"
  [ "$current" = "$SUPPORTED_CODEX_VERSION" ] ||
    fail "Codex CLI must be exactly $SUPPORTED_CODEX_VERSION (found ${current:-unknown})"
}

confirm_install() {
  [ "$ASSUME_YES" = true ] && return 0
  info "this installs oso-code for Codex $SUPPORTED_CODEX_VERSION and backs up every replaced artifact"
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) fail "aborted by user" ;; esac
}

strip_managed_region() {
  local source=$1 start=$2 end=$3
  awk -v start="$start" -v end="$end" '
    $0 == start { if (inside) exit 3; inside = 1; seen_start++; next }
    $0 == end { if (!inside) exit 4; inside = 0; seen_end++; next }
    !inside { print }
    END {
      if (inside || seen_start != seen_end || seen_start > 1) exit 5
    }
  ' "$source"
}

strip_toml_managed_region() {
  awk -v action=strip -v start_marker="$2" -v end_marker="$3" \
    -f "$SCRIPT_DIR/lib/toml-regions.awk" "$1"
}

toml_root_symbols() {
  awk -v action=root-symbols -f "$SCRIPT_DIR/lib/toml-regions.awk" "$1"
}

preflight_config() {
  [ -e "$CONFIG_FILE" ] && [ ! -f "$CONFIG_FILE" ] &&
    fail "Codex config is not a regular file: $CONFIG_FILE"
  [ -f "$CONFIG_FILE" ] || return 0
  local clean symbols
  clean="$(mktemp "${TMPDIR:-/tmp}/oso-codex-config.XXXXXX")"
  symbols="$(mktemp "${TMPDIR:-/tmp}/oso-codex-symbols.XXXXXX")"
  if ! strip_toml_managed_region "$CONFIG_FILE" "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" > "$clean"; then
    rm -f "$clean" "$symbols"
    fail "Codex config has malformed oso-code markers"
  fi
  if ! toml_root_symbols "$clean" > "$symbols"; then
    rm -f "$clean" "$symbols"
    fail "could not inspect the existing TOML config safely"
  fi
  if awk '
    /^[[:space:]]*default_permissions[[:space:]]*=/ { found = 1 }
    /^\[features\][[:space:]]*$/ ||
    /^\[agents\][[:space:]]*$/ ||
    /^\[shell_environment_policy\.set\][[:space:]]*$/ ||
    /^\[mcp_servers\.(context7|fallow)\][[:space:]]*$/ ||
    /^\[permissions\.oso(\.|\])[^\r\n]*$/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$symbols"; then
    rm -f "$clean" "$symbols"
    fail "Codex config already defines an oso-code-owned table outside the managed region"
  fi
  rm -f "$clean" "$symbols"
}

preflight_global_agents() {
  [ -e "$GLOBAL_FILE" ] && [ ! -f "$GLOBAL_FILE" ] &&
    fail "global AGENTS.md is not a regular file: $GLOBAL_FILE"
  [ -f "$GLOBAL_FILE" ] || return 0
  local clean
  clean="$(mktemp "${TMPDIR:-/tmp}/oso-codex-global.XXXXXX")"
  if ! strip_managed_region "$GLOBAL_FILE" "$GLOBAL_MARKER_START" "$GLOBAL_MARKER_END" > "$clean"; then
    rm -f "$clean"
    fail "global AGENTS.md has malformed oso-code markers"
  fi
  rm -f "$clean"
}

preflight_agents() {
  if [ -L "$AGENTS_TARGET" ]; then
    fail "refusing to replace symlinked Codex agents directory: $AGENTS_TARGET"
  fi
  if [ -e "$AGENTS_TARGET" ] && [ ! -d "$AGENTS_TARGET" ]; then
    fail "Codex agents target is not a directory: $AGENTS_TARGET"
  fi
  return 0
}

preflight_hooks_manifest() {
  [ -e "$HOOKS_TARGET" ] || return 0
  [ -f "$HOOKS_TARGET" ] || fail "Codex hooks manifest is not a regular file: $HOOKS_TARGET"
  local expected escaped
  expected="$(mktemp "${TMPDIR:-/tmp}/oso-codex-hooks.XXXXXX")"
  escaped="${RUNTIME_ROOT//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"
  sed "s|__OSO_HOOKS_DIR__|$escaped/hooks|g" "$REPO_ROOT/codex/hooks/hooks.json" > "$expected"
  if ! cmp -s "$expected" "$HOOKS_TARGET"; then
    # A prior oso-code release is also ours even when its matcher set changed,
    # but merely mentioning our path as an argument is not ownership. Parse the
    # JSON and accept only one of the released handlers as the command word,
    # optionally preceded by the fixed Codex marker.
    if ! python3 - "$HOOKS_TARGET" "$RUNTIME_ROOT/hooks" <<'PY'
import json
import re
import sys

manifest, root = sys.argv[1:]
allowed = {
    "block-commit-until-green.sh",
    "block-edits-without-slice.sh",
    "block-unknown-tool.sh",
    "publish-subagent-handoff.sh",
    "capture-plan-approval.sh",
    "approve-plan-token.sh",
    "warn-stale-state.sh",
    "cleanup-state.sh",
}
with open(manifest, encoding="utf-8") as handle:
    data = json.load(handle)
if not isinstance(data, dict) or set(data) != {"hooks"} or not isinstance(data["hooks"], dict):
    raise SystemExit(1)
allowed_events = {
    "PreToolUse", "SubagentStop", "Stop", "UserPromptSubmit",
    "SessionStart", "SessionEnd",
}
commands = []
for event, groups in data["hooks"].items():
    if event not in allowed_events or not isinstance(groups, list) or not groups:
        raise SystemExit(1)
    for group in groups:
        if not isinstance(group, dict) or not set(group).issubset({"matcher", "hooks"}):
            raise SystemExit(1)
        if "matcher" in group and not isinstance(group["matcher"], str):
            raise SystemExit(1)
        handlers = group.get("hooks")
        if not isinstance(handlers, list) or not handlers:
            raise SystemExit(1)
        for handler in handlers:
            if not isinstance(handler, dict) or set(handler) != {"type", "command"}:
                raise SystemExit(1)
            if handler["type"] != "command" or not isinstance(handler["command"], str):
                raise SystemExit(1)
            commands.append(handler["command"])
if not commands:
    raise SystemExit(1)
prefixes = (f'"{root}"/', f'OSO_AGENT=1 "{root}"/')
allow_args = re.compile(r'^ --allow "[A-Za-z0-9_.:|/-]+"$')
for command in commands:
    prefix = next((item for item in prefixes if command.startswith(item)), None)
    if prefix is None:
        raise SystemExit(1)
    remainder = command[len(prefix):]
    script, separator, arguments = remainder.partition(" ")
    if script not in allowed:
        raise SystemExit(1)
    suffix = f" {arguments}" if separator else ""
    if suffix and (script != "block-unknown-tool.sh" or not allow_args.fullmatch(suffix)):
        raise SystemExit(1)
PY
    then
      rm -f "$expected"
      fail "refusing to replace foreign $HOOKS_TARGET; merge or remove it explicitly first"
    fi
  fi
  rm -f "$expected"
}

preflight_release_payload() {
  command -v python3 >/dev/null 2>&1 ||
    fail "python3 is required to validate Codex plugin metadata"
  [ -f "$MARKETPLACE_TEMPLATE" ] || fail "Codex marketplace template is missing"
  [ -f "$REPO_ROOT/codex/.codex-plugin/plugin.json" ] ||
    fail "Codex plugin manifest is missing"
  [ -f "$SCRIPT_DIR/lib/toml-regions.awk" ] ||
    fail "Codex TOML region parser is missing"
  python3 -m json.tool "$MARKETPLACE_TEMPLATE" >/dev/null ||
    fail "Codex marketplace template is invalid JSON"
  python3 -m json.tool "$REPO_ROOT/codex/.codex-plugin/plugin.json" >/dev/null ||
    fail "Codex plugin manifest is invalid JSON"
}

begin_transaction() {
  umask 077
  mkdir -p "$TX_BACKUP_ROOT/items"
  chmod 700 "$TX_BACKUP_ROOT"
  : > "$TX_MANIFEST"
  TX_ACTIVE=true
  backup_target marketplace "$MARKETPLACE_ROOT"
  backup_target hooks-manifest "$HOOKS_TARGET"
  backup_target runtime "$RUNTIME_ROOT"
  backup_target agents "$AGENTS_TARGET"
  backup_target config "$CONFIG_FILE"
  backup_target global "$GLOBAL_FILE"
  backup_target plugins "$CODEX_HOME/plugins"
  backup_target engram-instructions "$CODEX_HOME/engram-instructions.md"
  backup_target engram-compact "$CODEX_HOME/engram-compact-prompt.md"
  backup_target impeccable "$IMPECCABLE_MOUNT"
  backup_target impeccable-opt-out "$IMPECCABLE_OPT_OUT_MARKER"
  capture_git_hook_config
  info "backup: $TX_BACKUP_ROOT"
}

capture_git_hook_config() {
  GIT_HOOKS_CONFIG_CAPTURED=false
  GIT_HOOKS_PATH_PRESENT=false
  GIT_HOOKS_PATH_VALUE=""
  command -v git >/dev/null 2>&1 || return 0
  git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || return 0
  GIT_HOOKS_CONFIG_CAPTURED=true
  if GIT_HOOKS_PATH_VALUE="$(git -C "$REPO_ROOT" config --local --get core.hooksPath 2>/dev/null)"; then
    GIT_HOOKS_PATH_PRESENT=true
  else
    GIT_HOOKS_PATH_VALUE=""
  fi
}

backup_target() {
  local label=$1 target=$2
  if [ -e "$target" ] || [ -L "$target" ]; then
    cp -a "$target" "$TX_BACKUP_ROOT/items/$label"
    printf 'present\t%s\t%s\n' "$label" "$target" >> "$TX_MANIFEST"
  else
    printf 'absent\t%s\t%s\n' "$label" "$target" >> "$TX_MANIFEST"
  fi
}

rollback_transaction() {
  [ "$TX_ACTIVE" = true ] || return 0
  warn "installation failed; restoring the pre-install snapshot"
  local status label target
  while IFS=$'\t' read -r status label target; do
    [ -n "$target" ] || continue
    rm -rf "$target"
    if [ "$status" = present ]; then
      mkdir -p "$(dirname "$target")"
      cp -a "$TX_BACKUP_ROOT/items/$label" "$target"
    fi
  done < "$TX_MANIFEST"
  if [ "${GIT_HOOKS_CONFIG_CAPTURED:-false}" = true ]; then
    if [ "${GIT_HOOKS_PATH_PRESENT:-false}" = true ]; then
      git -C "$REPO_ROOT" config --local core.hooksPath "$GIT_HOOKS_PATH_VALUE" ||
        warn "could not restore the previous core.hooksPath"
    else
      git -C "$REPO_ROOT" config --local --unset-all core.hooksPath >/dev/null 2>&1 || true
    fi
  fi
  TX_ACTIVE=false
  warn "rollback complete; snapshot kept at $TX_BACKUP_ROOT"
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "${TX_COMMITTED:-false}" != true ]; then
    rollback_transaction || true
  fi
  exit "$rc"
}

checkpoint() {
  if [ "${OSO_INSTALL_FAIL_AFTER:-}" = "$1" ]; then
    fail "injected failure after $1"
  fi
  return 0
}

replace_tree() {
  local stage=$1 target=$2
  mkdir -p "$(dirname "$target")"
  rm -rf "$target"
  mv "$stage" "$target"
}

assemble_marketplace() {
  local parent stage
  parent="$(dirname "$MARKETPLACE_ROOT")"
  mkdir -p "$parent"
  stage="$(mktemp -d "$parent/.codex-marketplace.XXXXXX")"
  mkdir -p "$stage/.agents/plugins" "$stage/codex/.codex-plugin" "$stage/codex/skills"
  cp "$MARKETPLACE_TEMPLATE" "$stage/.agents/plugins/marketplace.json"
  cp "$REPO_ROOT/codex/.codex-plugin/plugin.json" "$stage/codex/.codex-plugin/plugin.json"
  cp -R "$REPO_ROOT/codex/skills/." "$stage/codex/skills/"
  cp -R "$REPO_ROOT/plugin/skills/_shared" "$stage/codex/skills/_shared"
  replace_tree "$stage" "$MARKETPLACE_ROOT"
}

render_hook_manifest() {
  local target=$1 escaped
  escaped="${RUNTIME_ROOT//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"
  sed "s|__OSO_HOOKS_DIR__|$escaped/hooks|g" \
    "$REPO_ROOT/codex/hooks/hooks.json" > "$target"
}

install_runtime_hooks() {
  local stage manifest_stage relative expected actual
  mkdir -p "$(dirname "$RUNTIME_ROOT")" "$CODEX_HOME"
  stage="$(mktemp -d "$(dirname "$RUNTIME_ROOT")/.runtime.XXXXXX")"
  manifest_stage="$(mktemp "$CODEX_HOME/.hooks.XXXXXX")"
  mkdir -p "$stage/hooks" "$stage/bin" "$stage/git-hooks"
  cp "$REPO_ROOT/codex/hooks/hooks.json" "$stage/hooks.json"
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in
      plugin/hooks/*.sh) cp "$REPO_ROOT/$relative" "$stage/hooks/$(basename "$relative")" ;;
      plugin/bin/oso-state) cp "$REPO_ROOT/$relative" "$stage/bin/oso-state" ;;
    esac
  done < "$HASHES_FILE"
  cp "$REPO_ROOT/plugin/git-hooks/pre-commit" "$stage/git-hooks/pre-commit"
  chmod 700 "$stage/hooks"/*.sh "$stage/bin/oso-state" "$stage/git-hooks/pre-commit"
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in
      plugin/hooks/*.sh) actual="$(sha256_file "$stage/hooks/$(basename "$relative")")" ;;
      plugin/bin/oso-state) actual="$(sha256_file "$stage/bin/oso-state")" ;;
      codex/hooks/hooks.json) actual="$(sha256_file "$stage/hooks.json")" ;;
    esac
    [ "$actual" = "$expected" ] || fail "staged hook hash mismatch for $relative"
  done < "$HASHES_FILE"
  render_hook_manifest "$manifest_stage"
  python3 -m json.tool "$manifest_stage" >/dev/null ||
    fail "rendered Codex hooks manifest is invalid JSON"
  replace_tree "$stage" "$RUNTIME_ROOT"
  chmod 600 "$manifest_stage"
  mv "$manifest_stage" "$HOOKS_TARGET"
}

install_agents() {
  local role stage
  mkdir -p "$CODEX_HOME"
  stage="$(mktemp -d "$CODEX_HOME/.agents-install.XXXXXX")"
  if [ -d "$AGENTS_TARGET" ]; then
    cp -R "$AGENTS_TARGET/." "$stage/"
  fi
  for role in "$REPO_ROOT"/codex/agents/*.toml; do
    cp "$role" "$stage/$(basename "$role")"
    chmod 600 "$stage/$(basename "$role")"
  done
  replace_tree "$stage" "$AGENTS_TARGET"
}

wire_engram() {
  command -v engram >/dev/null 2>&1 ||
    fail "Engram is required; install its binary, then re-run this installer"
  engram setup codex
  [ -f "$CODEX_HOME/engram-instructions.md" ] ||
    fail "engram setup codex did not restore engram-instructions.md"
  [ -f "$CODEX_HOME/engram-compact-prompt.md" ] ||
    fail "engram setup codex did not restore engram-compact-prompt.md"
}

toml_quote() {
  local value=$1
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

split_toml_root_sections() {
  local source=$1 root_values=$2 sections=$3
  : > "$root_values"
  : > "$sections"
  awk -v action=split -v root_file="$root_values" -v sections_file="$sections" \
    -f "$SCRIPT_DIR/lib/toml-regions.awk" "$source"
}

write_config_region() {
  local clean root_values sections temp validation_home
  mkdir -p "$CODEX_HOME"
  clean="$(mktemp "$CODEX_HOME/.config.clean.XXXXXX")"
  root_values="$(mktemp "$CODEX_HOME/.config.root.XXXXXX")"
  sections="$(mktemp "$CODEX_HOME/.config.sections.XXXXXX")"
  temp="$(mktemp "$CODEX_HOME/.config.new.XXXXXX")"
  if [ -f "$CONFIG_FILE" ]; then
    strip_toml_managed_region "$CONFIG_FILE" "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" > "$clean"
  else
    : > "$clean"
  fi
  if ! split_toml_root_sections "$clean" "$root_values" "$sections"; then
    rm -f "$clean" "$root_values" "$sections" "$temp"
    fail "could not split the existing TOML config safely"
  fi
  {
    awk 'NF { last = NR } { lines[NR] = $0 } END { for (i = 1; i <= last; i++) print lines[i] }' "$root_values"
    [ -s "$root_values" ] && printf '\n'
    printf '%s\n' "$CONFIG_MARKER_START"
    printf 'default_permissions = "oso"\n\n'
    printf '[features]\n'
    printf 'hooks = true\n'
    printf 'multi_agent = true\n\n'
    printf '[agents]\n'
    printf 'max_threads = 4\n'
    printf 'max_depth = 2\n'
    printf 'job_max_runtime_seconds = 1800\n\n'
    printf '[shell_environment_policy.set]\n'
    printf 'OSO_AGENT = "1"\n'
    printf 'OSO_STATE_BIN = %s\n\n' "$(toml_quote "$RUNTIME_ROOT/bin/oso-state")"
    printf '[permissions.oso]\n'
    printf 'extends = ":workspace"\n\n'
    printf 'description = "oso-code workspace profile"\n\n'
    printf '[permissions.oso.workspace_roots]\n'
    printf '%s = true\n\n' "$(toml_quote "$HOME/.local/state/oso-code/worktrees")"
    printf '[permissions.oso.filesystem]\n'
    printf 'glob_scan_max_depth = 4\n\n'
    printf '[permissions.oso.filesystem.":workspace_roots"]\n'
    printf '"**/secrets/*" = "deny"\n'
    printf '"**/*.key" = "deny"\n'
    printf '"**/*.pem" = "deny"\n'
    printf '"**/.env.*.local" = "deny"\n'
    printf '"**/.env.local" = "deny"\n'
    printf '"**/.env" = "deny"\n'
    printf '".git/**" = "write"\n\n'
    printf '[permissions.oso.network]\n'
    printf 'enabled = true\n\n'
    printf '[permissions.oso.network.domains]\n'
    printf '"*" = "allow"\n\n'
    printf '[mcp_servers.context7]\n'
    printf 'url = "https://mcp.context7.com/mcp"\n'
    printf '\n[mcp_servers.fallow]\n'
    printf 'command = "fallow-mcp"\n'
    printf '%s\n' "$CONFIG_MARKER_END"
    [ -s "$sections" ] && printf '\n'
    cat "$sections"
  } > "$temp"
  validation_home="$(mktemp -d "$CODEX_HOME/.validate.XXXXXX")"
  cp "$temp" "$validation_home/config.toml"
  if ! CODEX_HOME="$validation_home" codex sandbox -P oso -- /bin/true >/dev/null; then
    rm -rf "$validation_home"
    rm -f "$clean" "$root_values" "$sections" "$temp"
    fail "Codex rejected the merged config; the original config is unchanged"
  fi
  rm -rf "$validation_home"
  chmod 600 "$temp"
  mv "$temp" "$CONFIG_FILE"
  rm -f "$clean" "$root_values" "$sections"
  if ! command -v fallow-mcp >/dev/null 2>&1; then
    warn "fallow-mcp is not installed; debt-sweep will use its rubric-only fallback"
  fi
}

merge_global_agents() {
  local clean temp
  mkdir -p "$CODEX_HOME"
  clean="$(mktemp "$CODEX_HOME/.agents.clean.XXXXXX")"
  temp="$(mktemp "$CODEX_HOME/.agents.new.XXXXXX")"
  if [ -f "$GLOBAL_FILE" ]; then
    strip_managed_region "$GLOBAL_FILE" "$GLOBAL_MARKER_START" "$GLOBAL_MARKER_END" > "$clean" ||
      fail "global AGENTS.md has malformed oso-code markers"
  else
    : > "$clean"
  fi
  {
    awk 'NF { last = NR } { lines[NR] = $0 } END { for (i = 1; i <= last; i++) print lines[i] }' "$clean"
    [ -s "$clean" ] && printf '\n'
    printf '%s\n' "$GLOBAL_MARKER_START"
    cat "$SCRIPT_DIR/codex-global.md"
    printf '%s\n' "$GLOBAL_MARKER_END"
  } > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$GLOBAL_FILE"
  rm -f "$clean"
}

wire_oso_plugin() {
  codex plugin marketplace add "$MARKETPLACE_ROOT" --json
  codex plugin add oso-code@oso-code --json
}

find_impeccable_source() {
  if [ -n "${OSO_IMPECCABLE_SOURCE:-}" ]; then
    printf '%s' "$OSO_IMPECCABLE_SOURCE"
    return 0
  fi
  if [ -n "${OSO_IMPECCABLE_MARKETPLACE_JSON:-}" ]; then
    command -v python3 >/dev/null 2>&1 || return 1
    python3 - "$OSO_IMPECCABLE_MARKETPLACE_JSON" <<'PY'
import json, os, sys
path = os.path.abspath(sys.argv[1])
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
root = os.path.dirname(os.path.dirname(os.path.dirname(path)))
for plugin in data.get("plugins", []):
    source = plugin.get("source", {})
    if plugin.get("name") == "impeccable" and source.get("source") == "local":
        candidate = os.path.join(root, source.get("path", ""), ".agents", "skills", "impeccable")
        if os.path.isfile(os.path.join(candidate, "SKILL.md")):
            print(os.path.abspath(candidate), end="")
            break
PY
    return $?
  fi
  local candidate
  for candidate in \
    "$HOME/.claude/plugins/marketplaces/impeccable/.agents/skills/impeccable" \
    "$HOME/.codex/plugins/marketplaces/impeccable/.agents/skills/impeccable"; do
    if [ -f "$candidate/SKILL.md" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

mount_impeccable() {
  local source marketplace_result installed_root
  if ! source="$(find_impeccable_source)"; then
    marketplace_result="$(codex plugin marketplace add pbakaus/impeccable --json)"
    command -v python3 >/dev/null 2>&1 ||
      fail "python3 is required to resolve Impeccable's installed marketplace root"
    installed_root="$(printf '%s' "$marketplace_result" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("installedRoot", ""), end="")
')"
    [ -n "$installed_root" ] ||
      fail "Codex did not report Impeccable's installedRoot"
    codex plugin add impeccable@impeccable --json
    source="$installed_root/.agents/skills/impeccable"
    [ -f "$source/SKILL.md" ] ||
      fail "Impeccable marketplace has no Codex .agents build at $source"
  fi
  "$SCRIPT_DIR/lib/mount-impeccable.sh" "$source"
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
}

git_hooks_owner() {
  local configured git_dir hook
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$configured" ] && [ "$configured" != "$RUNTIME_ROOT/git-hooks" ]; then
    printf 'core.hooksPath=%s' "$configured"
    return 0
  fi
  git_dir="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
  for hook in "$git_dir"/hooks/*; do
    case "$hook" in *.sample) continue ;; esac
    [ -f "$hook" ] && { printf '%s' "$hook"; return 0; }
  done
}

wire_git_hook() {
  local owner
  command -v git >/dev/null 2>&1 || fail "git is required to wire the commit gate"
  owner="$(git_hooks_owner)"
  [ -z "$owner" ] || fail "refusing to replace existing git hook owner: $owner"
  git -C "$REPO_ROOT" config core.hooksPath "$RUNTIME_ROOT/git-hooks"
}

main() {
  initialize_paths
  parse_args "$@"
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  verify_published_hooks
  preflight_release_payload
  preflight_config
  preflight_global_agents
  preflight_agents
  preflight_hooks_manifest
  confirm_install
  ensure_codex_version
  trap on_exit EXIT
  begin_transaction
  checkpoint after-backup
  assemble_marketplace
  checkpoint after-plugin
  install_runtime_hooks
  checkpoint after-hooks
  install_agents
  checkpoint after-agents
  wire_engram
  checkpoint after-engram
  write_config_region
  checkpoint after-config
  merge_global_agents
  checkpoint after-global
  wire_oso_plugin
  if [ "$INSTALL_IMPECCABLE" = true ]; then
    mount_impeccable
  else
    info "skipping Impeccable (--no-impeccable)"
    mkdir -p "$(dirname "$IMPECCABLE_OPT_OUT_MARKER")"
    printf 'skipped by --no-impeccable on %s\n' "$(date +%Y-%m-%d)" > "$IMPECCABLE_OPT_OUT_MARKER"
  fi
  checkpoint after-impeccable
  if [ "$INSTALL_GIT_HOOK" = true ]; then
    wire_git_hook
  else
    info "skipping the git commit hook (--no-git-hook)"
  fi
  checkpoint after-git-hook
  TX_COMMITTED=true
  TX_ACTIVE=false
  info "installed oso-code for Codex $SUPPORTED_CODEX_VERSION"
  warn "review and trust the installed user hooks with /hooks; published file hashes verify their bytes but do not synthesize Codex trusted_hash entries"
  info "restart Codex and start a new thread to load the plugin, agents, hooks, MCPs, and global guidance"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
