#!/usr/bin/env bash

set -euo pipefail

SUPPORTED_CODEX_VERSION=0.146.0
SUPPORTED_IMPECCABLE_VERSION=4.0.2
CONFIG_MARKER_START="# oso-code:start"
CONFIG_MARKER_END="# oso-code:end"
FEATURE_MARKER_START="# oso-code:features:start"
FEATURE_MARKER_END="# oso-code:features:end"
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"
MODEL_INSTRUCTIONS_KEY=model_instructions_file
COMPACT_PROMPT_KEY=experimental_compact_prompt_file
ENGRAM_MARKETPLACE_REMOTE=https://github.com/Gentleman-Programming/engram.git

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  [ -f "$SCRIPT_DIR/lib/codex-managed-config.sh" ] ||
    fail "Codex managed-config renderer is missing"
  . "$SCRIPT_DIR/lib/codex-managed-config.sh"
  [ -f "$SCRIPT_DIR/lib/engram-codex-pointers.sh" ] ||
    fail "Engram Codex pointer normalizer is missing"
  . "$SCRIPT_DIR/lib/engram-codex-pointers.sh"
  [ -f "$SCRIPT_DIR/lib/install-backup.sh" ] ||
    fail "install backup library is missing"
  . "$SCRIPT_DIR/lib/install-backup.sh"
  [ -f "$SCRIPT_DIR/lib/codex-install-backups.sh" ] ||
    fail "the Codex backup identity library is missing"
  . "$SCRIPT_DIR/lib/codex-install-backups.sh"
  CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
  CONFIG_FILE="$CODEX_HOME/config.toml"
  GLOBAL_FILE="$CODEX_HOME/AGENTS.md"
  RUNTIME_ROOT="$HOME/.local/share/oso-code/runtime"
  HOOKS_TARGET="$CODEX_HOME/hooks.json"
  AGENTS_TARGET="$CODEX_HOME/agents"
  MARKETPLACE_ROOT="$HOME/.local/share/oso-code/codex-marketplace"
  MARKETPLACE_TEMPLATE="$REPO_ROOT/.agents/plugins/marketplace.json"
  ENGRAM_MARKETPLACE_CACHE="$CODEX_HOME/.tmp/marketplaces/engram"
  ENGRAM_INSTRUCTIONS_FILE="$CODEX_HOME/engram-instructions.md"
  ENGRAM_COMPACT_FILE="$CODEX_HOME/engram-compact-prompt.md"
  HASHES_FILE="$SCRIPT_DIR/hook-hashes.txt"
  IMPECCABLE_MOUNT="$HOME/.agents/skills/impeccable"
  IMPECCABLE_OPT_OUT_MARKER="$HOME/.local/state/oso-code/impeccable-opt-out"
  INSTALL_BACKUPS_ROOT="$HOME/.local/state/oso-code"
  TX_BACKUP_ROOT="$INSTALL_BACKUPS_ROOT/install-backup-$(date +%Y%m%d-%H%M%S)-$$"
  TX_MANIFEST="$TX_BACKUP_ROOT/manifest"
  TX_ACTIVE=false
  TX_COMMITTED=false
  INSTALL_BACKUP_BUDGET_KIB="$(install_backup_budget_kib)"
  RESTORE_EXERCISED_MARKER="$INSTALL_BACKUPS_ROOT/.install-restore-verified-codex"
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
plugin/git-hooks/pre-commit
plugin/hooks/block-commit-until-green.sh
plugin/hooks/block-edits-without-slice.sh
plugin/hooks/block-unknown-tool.sh
plugin/hooks/publish-subagent-handoff.sh
plugin/hooks/capture-plan-approval.sh
plugin/hooks/approve-plan-token.sh
plugin/hooks/warn-stale-state.sh
plugin/hooks/cleanup-state.sh
plugin/hooks/block-prod-deploy.sh
plugin/bin/oso-state
plugin/hooks/lib.sh
plugin/hooks/lexer.sh
plugin/hooks/reanchor-after-compact.sh'
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in opencode/*) continue ;; esac
    case "$expected" in
      *[!0-9a-f]*|'') fail "invalid published SHA-256 in $HASHES_FILE" ;;
    esac
    [ "${#expected}" -eq 64 ] || fail "invalid published SHA-256 for $relative"
    case "$relative" in
      codex/hooks/hooks.json|plugin/git-hooks/pre-commit|plugin/hooks/*.sh|plugin/bin/oso-state) ;;
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
  [ "$count" -eq 15 ] || fail "published hook manifest must cover exactly 15 Codex trust files (found $count)"
  [ "$paths" = "$required_paths" ] ||
    fail "published hook coverage or order differs from the frozen Codex trust set"
}

load_state_library() {
  [ -f "$REPO_ROOT/plugin/hooks/lib.sh" ] ||
    fail "oso-code state library is missing"
  . "$REPO_ROOT/plugin/hooks/lib.sh"
}

codex_version() {
  codex --version 2>/dev/null | awk '{ print $NF }'
}

preflight_codex_version() {
  local current=""
  if command -v codex >/dev/null 2>&1; then
    current="$(codex_version || true)"
  fi
  [ "$current" = "$SUPPORTED_CODEX_VERSION" ] ||
    fail "Codex CLI must already be exactly $SUPPORTED_CODEX_VERSION (found ${current:-not installed}); run: npm install --global @openai/codex@$SUPPORTED_CODEX_VERSION"
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

strip_toml_managed_features() {
  awk -v action=features-strip \
    -v feature_start_marker="$FEATURE_MARKER_START" \
    -v feature_end_marker="$FEATURE_MARKER_END" \
    -f "$SCRIPT_DIR/lib/toml-regions.awk" "$1"
}

validate_toml_managed_features() {
  local status=0
  codex_managed_features_region_status "$1" \
    "$SCRIPT_DIR/lib/toml-regions.awk" \
    "$FEATURE_MARKER_START" "$FEATURE_MARKER_END" || status=$?
  case "$status" in
    0|1) return 0 ;;
    2) return 2 ;;
    3) return 3 ;;
    *) return "$status" ;;
  esac
}

toml_root_symbols() {
  awk -v action=root-symbols -f "$SCRIPT_DIR/lib/toml-regions.awk" "$1"
}

preflight_config() {
  [ -e "$CONFIG_FILE" ] && [ ! -f "$CONFIG_FILE" ] &&
    fail "Codex config is not a regular file: $CONFIG_FILE"
  [ -f "$CONFIG_FILE" ] || return 0
  local clean feature_clean symbols
  clean="$(mktemp "${TMPDIR:-/tmp}/oso-codex-config.XXXXXX")"
  feature_clean="$(mktemp "${TMPDIR:-/tmp}/oso-codex-features.XXXXXX")"
  symbols="$(mktemp "${TMPDIR:-/tmp}/oso-codex-symbols.XXXXXX")"
  if ! strip_toml_managed_region "$CONFIG_FILE" "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" > "$clean"; then
    rm -f "$clean" "$feature_clean" "$symbols"
    fail "Codex config has malformed oso-code markers"
  fi
  local feature_status=0
  validate_toml_managed_features "$clean" || feature_status=$?
  if [ "$feature_status" -ne 0 ]; then
    rm -f "$clean" "$feature_clean" "$symbols"
    if [ "$feature_status" -eq 3 ]; then
      fail "Codex config has a divergent oso-code features region; it must contain only the published hooks and multi_agent values"
    fi
    fail "Codex config has conflicting features ownership or malformed oso-code feature markers"
  fi
  if ! strip_toml_managed_features "$clean" > "$feature_clean"; then
    rm -f "$clean" "$feature_clean" "$symbols"
    fail "could not inspect the existing Codex features table safely"
  fi
  if ! toml_root_symbols "$feature_clean" > "$symbols"; then
    rm -f "$clean" "$feature_clean" "$symbols"
    fail "could not inspect the existing TOML config safely"
  fi
  if awk '
    /^[[:space:]]*default_permissions[[:space:]]*=/ { found = 1 }
    /^\[agents\][[:space:]]*$/ ||
    /^\[shell_environment_policy\.set\][[:space:]]*$/ ||
    /^\[mcp_servers\.(context7|fallow)\][[:space:]]*$/ ||
    /^\[permissions\.oso(\.|\])[^\r\n]*$/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$symbols"; then
    rm -f "$clean" "$feature_clean" "$symbols"
    fail "Codex config already defines an oso-code-owned table outside the managed region"
  fi
  rm -f "$clean" "$feature_clean" "$symbols"
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
    "block-prod-deploy.sh",
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
  [ -f "$SCRIPT_DIR/lib/codex-managed-config.sh" ] ||
    fail "Codex managed-config renderer is missing"
  [ -f "$SCRIPT_DIR/lib/engram-codex-pointers.sh" ] ||
    fail "Engram Codex pointer normalizer is missing"
  python3 -m json.tool "$MARKETPLACE_TEMPLATE" >/dev/null ||
    fail "Codex marketplace template is invalid JSON"
  python3 -m json.tool "$REPO_ROOT/codex/.codex-plugin/plugin.json" >/dev/null ||
    fail "Codex plugin manifest is invalid JSON"
}

begin_transaction() {
  umask 077
  mkdir -p "$TX_BACKUP_ROOT/items"
  chmod 700 "$TX_BACKUP_ROOT"
  printf '%s\n' "$CODEX_INSTALL_BACKUP_FORMAT" > "$TX_BACKUP_ROOT/format"
  : > "$TX_MANIFEST"
  TX_ACTIVE=true
  backup_target marketplace "$MARKETPLACE_ROOT"
  backup_target hooks-manifest "$HOOKS_TARGET"
  backup_target runtime "$RUNTIME_ROOT"
  backup_target agents "$AGENTS_TARGET"
  backup_target config "$CONFIG_FILE"
  backup_target global "$GLOBAL_FILE"
  backup_target plugins "$CODEX_HOME/plugins"
  backup_target engram-marketplace-cache "$ENGRAM_MARKETPLACE_CACHE"
  backup_target engram-instructions "$ENGRAM_INSTRUCTIONS_FILE"
  backup_target engram-compact "$ENGRAM_COMPACT_FILE"
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

migrate_plan_approval_state() {
  local state_file digest session
  [ -d "$OSO_STATE_DIR" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$(state_value "$state_file" plan_approval)" = pending ] || continue
    if grep -q '^plan_approval_session=' "$state_file"; then
      continue
    fi
    digest="${state_file##*/}"
    digest="${digest%.state}"
    backup_target "state-$digest" "$state_file"
    session="$(state_value "$state_file" session)"
    if [ "$session" = 1 ]; then
      rm -f "$state_file"
      rm -rf "${state_file}.lock"
      info "migrated plan approval state: cleared an unrecoverable pending with no presenting session on disk (${digest})"
    else
      printf 'plan_approval_session=%s\n' "$session" >> "$state_file"
      info "migrated plan approval state: backfilled plan_approval_session from the presenting session (${digest})"
    fi
  done
}

rollback_transaction() {
  [ "$TX_ACTIVE" = true ] || return 0
  warn "installation failed; restoring the pre-install snapshot"
  restore_backup_manifest "$TX_MANIFEST" "$TX_BACKUP_ROOT/items"
  local failed_count=$RESTORE_FAILED_COUNT failed_items=$RESTORE_FAILED_ITEMS
  if [ "${GIT_HOOKS_CONFIG_CAPTURED:-false}" = true ]; then
    if [ "${GIT_HOOKS_PATH_PRESENT:-false}" = true ]; then
      git -C "$REPO_ROOT" config --local core.hooksPath "$GIT_HOOKS_PATH_VALUE" ||
        warn "could not restore the previous core.hooksPath"
    else
      git -C "$REPO_ROOT" config --local --unset-all core.hooksPath >/dev/null 2>&1 || true
    fi
  fi
  TX_ACTIVE=false
  if [ "$failed_count" -eq 0 ]; then
    warn "rollback complete; snapshot kept at $TX_BACKUP_ROOT"
    return 0
  fi
  warn "rollback incomplete: $failed_count item(s) failed to restore ($failed_items); the pre-install snapshot is still at $TX_BACKUP_ROOT — restore it by hand"
  return 1
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

prune_install_backups() {
  if [ ! -f "$RESTORE_EXERCISED_MARKER" ]; then
    info "backup retention: skipped — the restore path has not been verified on this machine yet; run bootstrap/restore-codex.sh once to enable automatic pruning"
    return 0
  fi
  local backup
  codex_install_backups_newest_first "$INSTALL_BACKUPS_ROOT" |
    install_backups_over_budget | while IFS= read -r backup; do
    rm -rf "$backup"
    info "backup retention: removed $backup (over the ${INSTALL_BACKUP_BUDGET_KIB} KiB budget)"
  done
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
      plugin/git-hooks/pre-commit) cp "$REPO_ROOT/$relative" "$stage/git-hooks/pre-commit" ;;
      plugin/bin/oso-state) cp "$REPO_ROOT/$relative" "$stage/bin/oso-state" ;;
    esac
  done < "$HASHES_FILE"
  chmod 700 "$stage/hooks"/*.sh "$stage/bin/oso-state" "$stage/git-hooks/pre-commit"
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in opencode/*) continue ;; esac
    actual=""
    case "$relative" in
      plugin/hooks/*.sh) actual="$(sha256_file "$stage/hooks/$(basename "$relative")")" ;;
      plugin/git-hooks/pre-commit) actual="$(sha256_file "$stage/git-hooks/pre-commit")" ;;
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
  local role stage dest
  mkdir -p "$CODEX_HOME"
  stage="$(mktemp -d "$CODEX_HOME/.agents-install.XXXXXX")"
  if [ -d "$AGENTS_TARGET" ]; then
    cp -R "$AGENTS_TARGET/." "$stage/"
  fi
  for role in "$REPO_ROOT"/codex/agents/*.toml; do
    dest="$stage/$(basename "$role")"
    [ -L "$dest" ] && rm -f "$dest"
    cp "$role" "$dest"
    chmod 600 "$dest"
  done
  replace_tree "$stage" "$AGENTS_TARGET"
}

engram_marketplace_registered() {
  local listing status=0
  if ! listing="$(codex plugin marketplace list --json)"; then
    fail "could not inspect registered Codex marketplaces before Engram setup"
  fi
  printf '%s' "$listing" | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except (json.JSONDecodeError, OSError):
    raise SystemExit(2)
marketplaces = data.get("marketplaces")
if not isinstance(marketplaces, list):
    raise SystemExit(2)
for marketplace in marketplaces:
    if isinstance(marketplace, dict) and marketplace.get("name") == "engram":
        raise SystemExit(0)
raise SystemExit(1)
' || status=$?
  case "$status" in
    0) return 0 ;;
    1) return 1 ;;
    *) fail "Codex returned malformed marketplace inventory JSON" ;;
  esac
}

validate_stale_engram_marketplace() {
  [ ! -L "$ENGRAM_MARKETPLACE_CACHE" ] ||
    fail "refusing to remove symlinked unregistered Engram marketplace cache: $ENGRAM_MARKETPLACE_CACHE"
  [ -d "$ENGRAM_MARKETPLACE_CACHE" ] ||
    fail "unregistered Engram marketplace cache is not a directory: $ENGRAM_MARKETPLACE_CACHE"
  command -v git >/dev/null 2>&1 ||
    fail "git is required to validate the unregistered Engram marketplace cache"

  local checkout_root remotes remote status manifest plugin_manifest
  local head_commit remote_head_ref remote_head_commit
  checkout_root="$(git -C "$ENGRAM_MARKETPLACE_CACHE" rev-parse --show-toplevel 2>/dev/null || true)"
  [ "$(shell_spelling_of "$checkout_root")" = "$ENGRAM_MARKETPLACE_CACHE" ] ||
    fail "refusing to remove an unregistered Engram marketplace cache that is not an exact Git checkout"
  remotes="$(git -C "$ENGRAM_MARKETPLACE_CACHE" remote 2>/dev/null || true)"
  [ "$remotes" = origin ] ||
    fail "refusing to remove an unregistered Engram marketplace cache with unexpected Git remotes"
  remote="$(git -C "$ENGRAM_MARKETPLACE_CACHE" remote get-url --all origin 2>/dev/null || true)"
  [ "$remote" = "$ENGRAM_MARKETPLACE_REMOTE" ] ||
    fail "refusing to remove an unregistered Engram marketplace cache from an unknown origin"
  head_commit="$(git -C "$ENGRAM_MARKETPLACE_CACHE" rev-parse HEAD 2>/dev/null || true)"
  remote_head_ref="$(git -C "$ENGRAM_MARKETPLACE_CACHE" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null || true)"
  case "$remote_head_ref" in refs/remotes/origin/*) ;; *) remote_head_ref="" ;; esac
  remote_head_commit="$(git -C "$ENGRAM_MARKETPLACE_CACHE" rev-parse "$remote_head_ref" 2>/dev/null || true)"
  [ -n "$head_commit" ] && [ "$head_commit" = "$remote_head_commit" ] ||
    fail "refusing to remove an unregistered Engram marketplace cache with local or unverified commits"
  if ! status="$(git -C "$ENGRAM_MARKETPLACE_CACHE" status --porcelain --untracked-files=all 2>/dev/null)"; then
    fail "could not inspect the unregistered Engram marketplace cache"
  fi
  [ -z "$status" ] ||
    fail "refusing to remove a modified unregistered Engram marketplace cache"

  manifest="$ENGRAM_MARKETPLACE_CACHE/.agents/plugins/marketplace.json"
  plugin_manifest="$ENGRAM_MARKETPLACE_CACHE/plugin/codex/.codex-plugin/plugin.json"
  [ -f "$manifest" ] && [ ! -L "$manifest" ] ||
    fail "unregistered Engram marketplace cache has no trusted marketplace manifest"
  [ -f "$plugin_manifest" ] && [ ! -L "$plugin_manifest" ] ||
    fail "unregistered Engram marketplace cache has no trusted plugin manifest"
  python3 - "$manifest" "$plugin_manifest" <<'PY' ||
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
plugins = data.get("plugins")
if data.get("name") != "engram" or not isinstance(plugins, list) or len(plugins) != 1:
    raise SystemExit(1)
plugin = plugins[0]
if not isinstance(plugin, dict) or plugin.get("name") != "engram":
    raise SystemExit(1)
source = plugin.get("source")
if source != {"source": "local", "path": "./plugin/codex"}:
    raise SystemExit(1)
with open(sys.argv[2], encoding="utf-8") as handle:
    plugin_data = json.load(handle)
if plugin_data.get("name") != "engram":
    raise SystemExit(1)
PY
    fail "unregistered Engram marketplace cache has unexpected Engram manifests"
}

repair_stale_engram_marketplace() {
  if engram_marketplace_registered; then
    return 0
  fi
  if [ ! -e "$ENGRAM_MARKETPLACE_CACHE" ] && [ ! -L "$ENGRAM_MARKETPLACE_CACHE" ]; then
    return 0
  fi
  validate_stale_engram_marketplace
  info "repairing the clean unregistered official Engram marketplace cache"
  codex plugin marketplace remove engram >/dev/null
  if [ -e "$ENGRAM_MARKETPLACE_CACHE" ] || [ -L "$ENGRAM_MARKETPLACE_CACHE" ]; then
    fail "Codex did not remove the unregistered Engram marketplace cache"
  fi
}

normalize_installed_engram_pointers() {
  [ -f "$CONFIG_FILE" ] ||
    fail "engram setup codex did not create Codex config.toml"
  local candidate validation_home status=0
  candidate="$(mktemp "$CODEX_HOME/.config.engram.XXXXXX")"
  normalize_engram_codex_pointers \
    "$CONFIG_FILE" "$candidate" \
    "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" \
    "$MODEL_INSTRUCTIONS_KEY" "$COMPACT_PROMPT_KEY" \
    "$ENGRAM_INSTRUCTIONS_FILE" "$ENGRAM_COMPACT_FILE" \
    "$SCRIPT_DIR/lib/toml-regions.awk" 0 || status=$?
  case "$status" in
    0) ;;
    10)
      rm -f "$candidate"
      fail "Codex config markers changed during Engram setup"
      ;;
    11)
      rm -f "$candidate"
      fail "Engram Codex instruction pointers are missing, duplicated, or unexpected"
      ;;
    *)
      rm -f "$candidate"
      fail "could not normalize Engram Codex instruction pointers"
      ;;
  esac
  if cmp -s "$candidate" "$CONFIG_FILE"; then
    rm -f "$candidate"
    return 0
  fi

  validation_home="$(mktemp -d "$CODEX_HOME/.validate-engram.XXXXXX")"
  cp "$candidate" "$validation_home/config.toml"
  if ! CODEX_HOME="$validation_home" codex sandbox -P oso -- /bin/true >/dev/null; then
    rm -rf "$validation_home"
    rm -f "$candidate"
    fail "Codex rejected normalized Engram instruction pointers; the transaction will be restored"
  fi
  rm -rf "$validation_home"
  chmod 600 "$candidate"
  mv "$candidate" "$CONFIG_FILE"
  info "normalized Engram instruction pointers outside oso-code's managed config region"
}

wire_engram() {
  command -v engram >/dev/null 2>&1 ||
    fail "Engram is required; install its binary, then re-run this installer"
  engram setup codex
  [ -f "$ENGRAM_INSTRUCTIONS_FILE" ] ||
    fail "engram setup codex did not restore engram-instructions.md"
  [ -f "$ENGRAM_COMPACT_FILE" ] ||
    fail "engram setup codex did not restore engram-compact-prompt.md"
  normalize_installed_engram_pointers
}

split_toml_root_sections() {
  local source=$1 root_values=$2 sections=$3
  : > "$root_values"
  : > "$sections"
  awk -v action=split -v root_file="$root_values" -v sections_file="$sections" \
    -f "$SCRIPT_DIR/lib/toml-regions.awk" "$source"
}

write_config_region() {
  local clean feature_clean root_values sections merged_sections feature_block temp validation_home
  mkdir -p "$CODEX_HOME"
  clean="$(mktemp "$CODEX_HOME/.config.clean.XXXXXX")"
  feature_clean="$(mktemp "$CODEX_HOME/.config.features-clean.XXXXXX")"
  root_values="$(mktemp "$CODEX_HOME/.config.root.XXXXXX")"
  sections="$(mktemp "$CODEX_HOME/.config.sections.XXXXXX")"
  merged_sections="$(mktemp "$CODEX_HOME/.config.sections-merged.XXXXXX")"
  feature_block="$(mktemp "$CODEX_HOME/.config.feature-block.XXXXXX")"
  temp="$(mktemp "$CODEX_HOME/.config.new.XXXXXX")"
  if [ -f "$CONFIG_FILE" ]; then
    strip_toml_managed_region "$CONFIG_FILE" "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" > "$clean"
  else
    : > "$clean"
  fi
  local feature_status=0
  validate_toml_managed_features "$clean" || feature_status=$?
  if [ "$feature_status" -ne 0 ]; then
    rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block" "$temp"
    if [ "$feature_status" -eq 3 ]; then
      fail "Codex config changed to a divergent oso-code features region during installation"
    fi
    fail "Codex config changed to malformed features ownership during installation"
  fi
  if ! strip_toml_managed_features "$clean" > "$feature_clean"; then
    rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block" "$temp"
    fail "could not merge the existing Codex features table safely"
  fi
  if ! split_toml_root_sections "$feature_clean" "$root_values" "$sections"; then
    rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block" "$temp"
    fail "could not split the existing TOML config safely"
  fi
  {
    printf '%s\n' "$FEATURE_MARKER_START"
    render_codex_managed_features
    printf '%s\n' "$FEATURE_MARKER_END"
  } > "$feature_block"
  if ! awk -v action=features-merge -v feature_file="$feature_block" \
      -f "$SCRIPT_DIR/lib/toml-regions.awk" "$sections" > "$merged_sections"; then
    rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block" "$temp"
    fail "could not write the merged Codex features table safely"
  fi
  {
    awk 'NF { last = NR } { lines[NR] = $0 } END { for (i = 1; i <= last; i++) print lines[i] }' "$root_values"
    [ -s "$root_values" ] && printf '\n'
    printf '%s\n' "$CONFIG_MARKER_START"
    render_codex_managed_config "$HOME" "$RUNTIME_ROOT"
    printf '%s\n' "$CONFIG_MARKER_END"
    [ -s "$merged_sections" ] && printf '\n'
    cat "$merged_sections"
  } > "$temp"
  validation_home="$(mktemp -d "$CODEX_HOME/.validate.XXXXXX")"
  cp "$temp" "$validation_home/config.toml"
  if ! CODEX_HOME="$validation_home" codex sandbox -P oso -- /bin/true >/dev/null; then
    rm -rf "$validation_home"
    rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block" "$temp"
    fail "Codex rejected the merged config; the original config is unchanged"
  fi
  rm -rf "$validation_home"
  chmod 600 "$temp"
  mv "$temp" "$CONFIG_FILE"
  rm -f "$clean" "$feature_clean" "$root_values" "$sections" "$merged_sections" "$feature_block"
  if ! resolve_fallow_mcp_command "$HOME" >/dev/null; then
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

impeccable_skill_version() {
  [ -f "$1" ] || return 1
  sed -n 's/^version:[[:space:]]*//p' "$1" | head -n1
}

fetch_pinned_impeccable_source() {
  local marketplace_result installed_root source
  marketplace_result="$(codex plugin marketplace add pbakaus/impeccable \
    --ref "skill-v$SUPPORTED_IMPECCABLE_VERSION" --json)"
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
  printf '%s' "$source"
}

mount_impeccable() {
  local source
  if ! source="$(find_impeccable_source)" ||
     [ "$(impeccable_skill_version "$source/SKILL.md")" != "$SUPPORTED_IMPECCABLE_VERSION" ]; then
    source="$(fetch_pinned_impeccable_source)"
  fi
  "$SCRIPT_DIR/lib/mount-impeccable.sh" "$source"
  [ "$(impeccable_skill_version "$IMPECCABLE_MOUNT/SKILL.md")" = "$SUPPORTED_IMPECCABLE_VERSION" ] ||
    fail "Impeccable is pinned to skill-v$SUPPORTED_IMPECCABLE_VERSION but the mounted skill reports version $(impeccable_skill_version "$IMPECCABLE_MOUNT/SKILL.md")"
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
}

running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

shell_spelling_of() {
  if running_on_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

legacy_oso_git_hooks_path() {
  local configured=$1 local_configured=$2 hooks_dir entry
  [ "$local_configured" = "$configured" ] || return 1
  hooks_dir="$(shell_spelling_of "$configured")"
  [ "$hooks_dir" = "$REPO_ROOT/plugin/git-hooks" ] || return 1
  [ -d "$hooks_dir" ] && [ ! -L "$hooks_dir" ] || return 1
  [ -f "$hooks_dir/pre-commit" ] && [ ! -L "$hooks_dir/pre-commit" ] \
    && [ -x "$hooks_dir/pre-commit" ] || return 1

  for entry in "$hooks_dir"/* "$hooks_dir"/.[!.]* "$hooks_dir"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    [ "${entry##*/}" = pre-commit ] || return 1
  done
  return 0
}

git_hooks_owner() {
  local configured local_configured git_dir hook
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  local_configured="$(git -C "$REPO_ROOT" config --local --get-all core.hooksPath 2>/dev/null || true)"
  if [ -n "$configured" ] &&
     [ "$(shell_spelling_of "$configured")" != "$RUNTIME_ROOT/git-hooks" ]; then
    if ! legacy_oso_git_hooks_path "$configured" "$local_configured"; then
      printf 'core.hooksPath=%s' "$configured"
      return 0
    fi
  fi
  git_dir="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
  for hook in "$git_dir"/hooks/*; do
    case "$hook" in *.sample) continue ;; esac
    [ -f "$hook" ] && { printf '%s' "$hook"; return 0; }
  done
}

wire_git_hook() {
  local configured local_configured owner
  command -v git >/dev/null 2>&1 || fail "git is required to wire the commit gate"
  owner="$(git_hooks_owner)"
  [ -z "$owner" ] || fail "refusing to replace existing git hook owner: $owner"
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  local_configured="$(git -C "$REPO_ROOT" config --local --get-all core.hooksPath 2>/dev/null || true)"
  if legacy_oso_git_hooks_path "$configured" "$local_configured"; then
    [ -f "$RUNTIME_ROOT/git-hooks/pre-commit" ] \
      && [ ! -L "$RUNTIME_ROOT/git-hooks/pre-commit" ] \
      && [ -x "$RUNTIME_ROOT/git-hooks/pre-commit" ] \
      && cmp -s "$(shell_spelling_of "$configured")/pre-commit" \
        "$RUNTIME_ROOT/git-hooks/pre-commit" ||
      fail "the staged git hook differs from the published checkout hook"
    info "migrating oso-code's checkout hook to the self-contained runtime"
  elif [ -n "$configured" ] &&
       [ "$(shell_spelling_of "$configured")" != "$RUNTIME_ROOT/git-hooks" ]; then
    fail "refusing to replace existing git hook owner: core.hooksPath=$configured"
  fi
  owner="$(git_hooks_owner)"
  [ -z "$owner" ] || fail "refusing to replace existing git hook owner: $owner"
  git -C "$REPO_ROOT" config core.hooksPath "$RUNTIME_ROOT/git-hooks"
}

main() {
  initialize_paths
  parse_args "$@"
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  verify_published_hooks
  load_state_library
  preflight_release_payload
  preflight_config
  preflight_global_agents
  preflight_agents
  preflight_hooks_manifest
  preflight_codex_version
  confirm_install
  trap on_exit EXIT
  begin_transaction
  checkpoint after-backup
  migrate_plan_approval_state
  checkpoint after-state-migration
  repair_stale_engram_marketplace
  checkpoint after-engram-marketplace-repair
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
  prune_install_backups || true
  info "installed oso-code for Codex $SUPPORTED_CODEX_VERSION"
  warn "review and trust the installed user hooks with /hooks; published file hashes verify their bytes but do not synthesize Codex trusted_hash entries"
  info "restart Codex and start a new thread to load the plugin, agents, hooks, MCPs, and global guidance"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
