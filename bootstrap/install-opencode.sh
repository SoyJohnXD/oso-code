#!/usr/bin/env bash

set -euo pipefail

SUPPORTED_OPENCODE_VERSION=1.18.22
IMPECCABLE_REMOTE=https://github.com/pbakaus/impeccable.git
OWNER_INSTALLER=installer
OWNER_OPERATOR=operator
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  SUPPORTED_IMPECCABLE_VERSION="$(sed -n 's/^SUPPORTED_IMPECCABLE_VERSION=//p' "$SCRIPT_DIR/install-codex.sh" | head -1)"
  [ -n "$SUPPORTED_IMPECCABLE_VERSION" ] ||
    fail "could not read the Impeccable version pin from install-codex.sh"
  [ -f "$SCRIPT_DIR/lib/install-backup.sh" ] ||
    fail "the install backup library is missing"
  . "$SCRIPT_DIR/lib/install-backup.sh"
  [ -f "$SCRIPT_DIR/lib/opencode-install-backups.sh" ] ||
    fail "the OpenCode backup identity library is missing"
  . "$SCRIPT_DIR/lib/opencode-install-backups.sh"
  [ -f "$SCRIPT_DIR/lib/opencode-trust-bytes.sh" ] ||
    fail "the published gate hash library is missing"
  . "$SCRIPT_DIR/lib/opencode-trust-bytes.sh"
  [ -f "$SCRIPT_DIR/lib/codex-managed-config.sh" ] ||
    fail "the shared MCP command resolver is missing"
  . "$SCRIPT_DIR/lib/codex-managed-config.sh"
  OPENCODE_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  CONFIG_FILE="$OPENCODE_CONFIG_HOME/opencode.json"
  GLOBAL_FILE="$OPENCODE_CONFIG_HOME/AGENTS.md"
  SKILLS_TARGET="$OPENCODE_CONFIG_HOME/skill"
  AGENTS_TARGET="$OPENCODE_CONFIG_HOME/agent"
  COMMANDS_TARGET="$OPENCODE_CONFIG_HOME/command"
  PLUGIN_TARGET="$OPENCODE_CONFIG_HOME/plugin"
  HOOKS_TARGET="$OPENCODE_CONFIG_HOME/hooks"
  GIT_HOOKS_TARGET="$OPENCODE_CONFIG_HOME/git-hooks"
  STATE_BIN_TARGET="$OPENCODE_CONFIG_HOME/bin"
  DIST_TARGET="$OPENCODE_CONFIG_HOME/dist"
  ENGRAM_PLUGIN_FILE="$OPENCODE_CONFIG_HOME/plugins/engram.ts"
  SKILLS_SOURCE="$REPO_ROOT/opencode/skills"
  SHARED_SKILLS_SOURCE="$REPO_ROOT/plugin/skills/_shared"
  AGENTS_SOURCE="$REPO_ROOT/opencode/agents"
  COMMANDS_SOURCE="$REPO_ROOT/opencode/commands"
  PLUGIN_BUNDLE_SOURCE="$REPO_ROOT/opencode/dist/oso-code.js"
  GATES_SOURCE="$REPO_ROOT/plugin/hooks"
  GIT_HOOKS_SOURCE="$REPO_ROOT/plugin/git-hooks"
  STATE_BIN_SOURCE="$REPO_ROOT/plugin/bin/oso-state"
  STATE_BIN_PACKAGE_SOURCE="$REPO_ROOT/plugin/bin/package.json"
  DIST_SOURCE="$REPO_ROOT/plugin/dist"
  GLOBAL_SOURCE="$SCRIPT_DIR/opencode-global.md"
  HASHES_FILE="$SCRIPT_DIR/hook-hashes.txt"
  IMPECCABLE_MOUNT="$HOME/.agents/skills/impeccable"
  STATE_ROOT="$HOME/.local/state/oso-code"
  PLAN_ARTIFACT_ROOT="$STATE_ROOT/plans"
  IMPECCABLE_OPT_OUT_MARKER="$STATE_ROOT/impeccable-opt-out"
  OWNER_REGISTRY_FILE="$STATE_ROOT/opencode-install-registry"
  RESTORE_EXERCISED_MARKER="$STATE_ROOT/.install-restore-verified-opencode"
  TX_BACKUP_ROOT="$STATE_ROOT/install-backup-$(date +%Y%m%d-%H%M%S)-$$"
  TX_MANIFEST="$TX_BACKUP_ROOT/manifest"
  TX_ACTIVE=false
  TX_COMMITTED=false
  IMPECCABLE_SOURCE=""
  IMPECCABLE_FETCH_DIR=""
  IMPECCABLE_MOUNTED=false
  INSTALL_BACKUP_BUDGET_KIB="$(install_backup_budget_kib)"
}

parse_args() {
  ASSUME_YES=false
  INSTALL_IMPECCABLE=true
  WIRE_GIT_HOOK=true
  for arg in "$@"; do
    case "$arg" in
      --yes) ASSUME_YES=true ;;
      --no-impeccable) INSTALL_IMPECCABLE=false ;;
      --no-git-hook) WIRE_GIT_HOOK=false ;;
      *) usage_error "unknown flag: $arg" ;;
    esac
  done
}

probe_opencode_version() {
  command -v opencode >/dev/null 2>&1 || return 0
  opencode --version 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | tr -d '[:space:]' \
    | head -1 || true
}

check_baseline() {
  local installed
  installed="$(probe_opencode_version)"
  if [ -z "$installed" ]; then
    info "opencode not found on PATH — install it first (https://opencode.ai/install)"
    return 1
  fi
  if [ "$installed" != "$SUPPORTED_OPENCODE_VERSION" ]; then
    info "opencode $installed installed; this port pins $SUPPORTED_OPENCODE_VERSION"
    return 1
  fi
  info "opencode $SUPPORTED_OPENCODE_VERSION matches the pin"
}

preflight_payload() {
  [ -f "$GLOBAL_SOURCE" ] ||
    fail "the OpenCode global guidance is missing: $GLOBAL_SOURCE"
  [ -f "$SCRIPT_DIR/lib/mount-impeccable.sh" ] ||
    fail "the Impeccable mount helper is missing"
  [ -f "$SCRIPT_DIR/install-codex.sh" ] ||
    fail "the Codex installer (the Impeccable pin's authority) is missing"
  [ -d "$SKILLS_SOURCE" ] ||
    fail "the OpenCode skill wrappers are missing: $SKILLS_SOURCE"
  [ -d "$SHARED_SKILLS_SOURCE" ] ||
    fail "the shared skill bodies are missing: $SHARED_SKILLS_SOURCE"
  [ -d "$AGENTS_SOURCE" ] ||
    fail "the OpenCode agent contracts are missing: $AGENTS_SOURCE"
  [ -d "$COMMANDS_SOURCE" ] ||
    fail "the OpenCode command templates are missing: $COMMANDS_SOURCE"
  [ -f "$PLUGIN_BUNDLE_SOURCE" ] ||
    fail "the OpenCode plugin bundle is missing: $PLUGIN_BUNDLE_SOURCE"
  [ -d "$GATES_SOURCE" ] ||
    fail "the shared gate script tree is missing: $GATES_SOURCE"
  [ -f "$GATES_SOURCE/lib.sh" ] ||
    fail "the shared gate library is missing: $GATES_SOURCE/lib.sh"
  [ -f "$GATES_SOURCE/lexer.sh" ] ||
    fail "the shared gate lexer is missing: $GATES_SOURCE/lexer.sh"
  [ -f "$GIT_HOOKS_SOURCE/pre-commit" ] ||
    fail "the shared commit hook is missing: $GIT_HOOKS_SOURCE/pre-commit"
  [ -f "$STATE_BIN_SOURCE" ] ||
    fail "the oso-state binary is missing: $STATE_BIN_SOURCE"
  [ -f "$STATE_BIN_PACKAGE_SOURCE" ] ||
    fail "the oso-state module manifest is missing: $STATE_BIN_PACKAGE_SOURCE"
  command -v python3 >/dev/null 2>&1 ||
    fail "python3 is required to render and merge the OpenCode config"
  local wrapper_count=0 agent_count=0 wrapper agent
  for wrapper in "$SKILLS_SOURCE"/oso-*/SKILL.md; do
    [ -f "$wrapper" ] && wrapper_count=$((wrapper_count + 1))
  done
  [ "$wrapper_count" -eq 9 ] ||
    fail "expected exactly 9 OpenCode skill wrappers (found $wrapper_count)"
  for agent in "$AGENTS_SOURCE"/oso-*.md; do
    [ -f "$agent" ] && agent_count=$((agent_count + 1))
  done
  [ "$agent_count" -ge 1 ] ||
    fail "no OpenCode agent contracts found under $AGENTS_SOURCE"
}

verify_published_trust_bytes() {
  local root_kind=$1 root=$2 report diverging
  report="$(mktemp "${TMPDIR:-/tmp}/oso-opencode-trust.XXXXXX")"
  opencode_trust_divergence "$HASHES_FILE" "$root_kind" "$root" > "$report"
  diverging="$(tr '\n' ';' < "$report")"
  rm -f "$report"
  [ -z "$diverging" ] ||
    fail "$root_kind gate bytes do not match the published hashes: ${diverging%;}"
  [ "$OPENCODE_TRUST_FILES_READ" -eq "$OPENCODE_TRUST_FILE_COUNT" ] ||
    fail "the published manifest must cover exactly $OPENCODE_TRUST_FILE_COUNT OpenCode trust files (found $OPENCODE_TRUST_FILES_READ)"
  info "verified $OPENCODE_TRUST_FILES_READ $root_kind gate files against the published hashes"
}

published_gate_scripts() {
  local expected relative
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in
      plugin/hooks/*.sh) printf '%s\n' "${relative#plugin/hooks/}" ;;
    esac
  done < "$HASHES_FILE"
}

verify_every_installed_gate_is_published() {
  local published installed unpublished=""
  published="$(published_gate_scripts)"
  for installed in "$HOOKS_TARGET"/*.sh; do
    [ -f "$installed" ] || continue
    printf '%s\n' "$published" | grep -Fxq -- "${installed##*/}" ||
      unpublished="$unpublished ${installed##*/}"
  done
  [ -z "$unpublished" ] ||
    fail "the installed gate tree holds executables no published hash covers:$unpublished — install exactly what bootstrap/hook-hashes.txt publishes"
}

load_state_library() {
  . "$GATES_SOURCE/lib.sh"
}

preflight_config_home() {
  [ -z "${XDG_CONFIG_HOME:-}" ] || [ "$XDG_CONFIG_HOME" = "$HOME/.config" ] ||
    usage_error "XDG_CONFIG_HOME ($XDG_CONFIG_HOME) is not the default for HOME ($HOME/.config), so this install would write outside the home it was pointed at; unset it or point both at the same account"
}

preflight_config() {
  [ -e "$CONFIG_FILE" ] && [ ! -f "$CONFIG_FILE" ] &&
    fail "OpenCode config is not a regular file: $CONFIG_FILE"
  [ -f "$CONFIG_FILE" ] || return 0
  python3 -m json.tool "$CONFIG_FILE" >/dev/null 2>&1 ||
    fail "the existing OpenCode config is not valid JSON: $CONFIG_FILE (back it up and fix it, then re-run)"
}

strip_managed_region() {
  awk -v start="$GLOBAL_MARKER_START" -v end="$GLOBAL_MARKER_END" '
    $0 == start { if (inside) exit 3; inside = 1; seen_start++; next }
    $0 == end { if (!inside) exit 4; inside = 0; seen_end++; next }
    !inside { print }
    END {
      if (inside || seen_start != seen_end || seen_start > 1) exit 5
    }
  ' "$1"
}

preflight_global_agents() {
  [ -e "$GLOBAL_FILE" ] && [ ! -f "$GLOBAL_FILE" ] &&
    fail "the global guidance file is not a regular file: $GLOBAL_FILE"
  [ -f "$GLOBAL_FILE" ] || return 0
  strip_managed_region "$GLOBAL_FILE" >/dev/null ||
    fail "the existing global guidance has malformed oso-code markers: $GLOBAL_FILE (repair the marker pair, then re-run)"
}

confirm_install() {
  [ "$ASSUME_YES" = true ] && return 0
  info "this installs oso-code for OpenCode $SUPPORTED_OPENCODE_VERSION and backs up every replaced artifact"
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) fail "aborted by user" ;; esac
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

begin_transaction() {
  umask 077
  mkdir -p "$TX_BACKUP_ROOT/items"
  chmod 700 "$TX_BACKUP_ROOT"
  printf '%s\n' "$OPENCODE_INSTALL_BACKUP_FORMAT" > "$TX_BACKUP_ROOT/format"
  : > "$TX_MANIFEST"
  TX_ACTIVE=true
  backup_target config "$CONFIG_FILE"
  backup_target global "$GLOBAL_FILE"
  backup_target skills "$SKILLS_TARGET"
  backup_target agents "$AGENTS_TARGET"
  backup_target commands "$COMMANDS_TARGET"
  backup_target plugin "$PLUGIN_TARGET"
  backup_target hooks "$HOOKS_TARGET"
  backup_target git-hooks "$GIT_HOOKS_TARGET"
  backup_target state-bin "$STATE_BIN_TARGET"
  backup_target dist "$DIST_TARGET"
  backup_target engram-plugin "$ENGRAM_PLUGIN_FILE"
  backup_target impeccable "$IMPECCABLE_MOUNT"
  backup_target impeccable-opt-out "$IMPECCABLE_OPT_OUT_MARKER"
  backup_target registry "$OWNER_REGISTRY_FILE"
  info "backup: $TX_BACKUP_ROOT"
}

rewrite_state_keys() {
  local state_file=$1 pair key staged
  shift
  for pair in "$@"; do
    key="${pair%%=*}"
    staged="$(mktemp "$STATE_ROOT/.state-migration.XXXXXX")"
    grep -v "^${key}=" "$state_file" > "$staged" || true
    printf '%s\n' "$pair" >> "$staged"
    chmod 600 "$staged"
    mv "$staged" "$state_file"
  done
}

back_up_state_file_once() {
  local state_file=$1 repository=$2
  [ "$STATE_FILE_BACKED_UP" = false ] || return 0
  backup_target "state-$repository" "$state_file"
  STATE_FILE_BACKED_UP=true
}

migrate_renamed_identity() {
  local state_file=$1 repository=$2 agent session
  agent="${repository:0:16}"
  session="$(state_value "$state_file" session)"
  [[ "$session" =~ ^ses[A-Za-z0-9]+$ ]] || return 0
  back_up_state_file_once "$state_file" "$repository"
  rewrite_state_keys "$state_file" "session=$agent"
  if [ -n "$(state_value "$state_file" plan_approval_session)" ]; then
    rewrite_state_keys "$state_file" "plan_approval_session=$agent"
  fi
  info "migrated the renamed identity in ${state_file##*/}: session $session is now $agent"
}

migrate_relocated_approval() {
  local state_file=$1 repository=$2 plan_dir approved plan_digest
  [ -z "$(state_value "$state_file" plan_approval)" ] || return 0
  plan_dir="$PLAN_ARTIFACT_ROOT/$repository"
  for approved in "$plan_dir"/approved-*.md; do
    [ -f "$approved" ] || continue
    plan_digest="${approved##*/approved-}"
    plan_digest="${plan_digest%.md}"
    back_up_state_file_once "$state_file" "$repository"
    rewrite_state_keys "$state_file" \
      plan_approval=approved \
      "plan_approval_digest=$plan_digest" \
      "plan_approval_session=${repository:0:16}" \
      "plan_snapshot_file=$approved" \
      "plan_current_file=$plan_dir/current.md" \
      plan_revision=0
    info "migrated the relocated plan approval into ${state_file##*/}: $plan_digest"
    return 0
  done
}

migrate_opencode_state() {
  local state_file repository
  [ -d "$STATE_ROOT" ] || return 0
  for state_file in "$STATE_ROOT"/*.state; do
    [ -f "$state_file" ] || continue
    repository="${state_file##*/}"
    repository="${repository%.state}"
    STATE_FILE_BACKED_UP=false
    migrate_renamed_identity "$state_file" "$repository"
    migrate_relocated_approval "$state_file" "$repository"
  done
}

rollback_transaction() {
  [ "$TX_ACTIVE" = true ] || return 0
  warn "installation failed; restoring the pre-install snapshot"
  restore_backup_manifest "$TX_MANIFEST" "$TX_BACKUP_ROOT/items"
  local failed_count=$RESTORE_FAILED_COUNT failed_items=$RESTORE_FAILED_ITEMS
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
  if [ -n "$IMPECCABLE_FETCH_DIR" ] && [ -d "$IMPECCABLE_FETCH_DIR" ]; then
    rm -rf "$IMPECCABLE_FETCH_DIR"
  fi
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
    info "backup retention: skipped — the restore path has not been verified on this machine yet; run bootstrap/restore-opencode.sh once to enable automatic pruning"
    return 0
  fi
  local backup
  opencode_install_backups_newest_first "$STATE_ROOT" |
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


install_skills() {
  local stage
  mkdir -p "$OPENCODE_CONFIG_HOME"
  stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.skills-install.XXXXXX")"
  cp -R "$SKILLS_SOURCE"/oso-* "$stage/"
  rm -rf "$stage/_shared"
  cp -R "$SHARED_SKILLS_SOURCE" "$stage/_shared"
  replace_tree "$stage" "$SKILLS_TARGET"
  info "installed 9 skill wrappers and the shared bodies into $SKILLS_TARGET"
}

install_agents() {
  local stage agent dest
  mkdir -p "$OPENCODE_CONFIG_HOME"
  stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.agents-install.XXXXXX")"
  for agent in "$AGENTS_SOURCE"/oso-*.md; do
    [ -f "$agent" ] || continue
    dest="$stage/$(basename "$agent")"
    cp "$agent" "$dest"
  done
  replace_tree "$stage" "$AGENTS_TARGET"
  info "installed the OpenCode agent contracts into $AGENTS_TARGET"
}

install_commands() {
  local stage command dest
  mkdir -p "$OPENCODE_CONFIG_HOME"
  stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.commands-install.XXXXXX")"
  for command in "$COMMANDS_SOURCE"/oso-*.md; do
    [ -f "$command" ] || continue
    dest="$stage/$(basename "$command")"
    cp "$command" "$dest"
  done
  replace_tree "$stage" "$COMMANDS_TARGET"
  info "installed the mode slash commands into $COMMANDS_TARGET"
}

published_dist_files() {
  local expected relative
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in
      plugin/dist/*) printf '%s\n' "${relative#plugin/dist/}" ;;
    esac
  done < "$HASHES_FILE"
}

install_plugin() {
  local stage hooks_stage state_bin_stage dist_stage script bundle
  mkdir -p "$OPENCODE_CONFIG_HOME"
  stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.plugin-install.XXXXXX")"
  cp "$PLUGIN_BUNDLE_SOURCE" "$stage/oso-code.js"
  replace_tree "$stage" "$PLUGIN_TARGET"

  hooks_stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.hooks-install.XXXXXX")"
  while IFS= read -r script; do
    [ -n "$script" ] || continue
    cp "$GATES_SOURCE/$script" "$hooks_stage/$script"
  done <<EOF
$(published_gate_scripts)
EOF
  chmod 700 "$hooks_stage"/*.sh
  replace_tree "$hooks_stage" "$HOOKS_TARGET"

  state_bin_stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.bin-install.XXXXXX")"
  cp "$STATE_BIN_SOURCE" "$state_bin_stage/oso-state"
  cp "$STATE_BIN_PACKAGE_SOURCE" "$state_bin_stage/package.json"
  chmod 700 "$state_bin_stage/oso-state"
  replace_tree "$state_bin_stage" "$STATE_BIN_TARGET"

  dist_stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.dist-install.XXXXXX")"
  while IFS= read -r bundle; do
    [ -n "$bundle" ] || continue
    cp "$DIST_SOURCE/$bundle" "$dist_stage/$bundle"
  done <<EOF
$(published_dist_files)
EOF
  replace_tree "$dist_stage" "$DIST_TARGET"
  info "installed the OpenCode plugin into $PLUGIN_TARGET, the gate tree into $HOOKS_TARGET, oso-state into $STATE_BIN_TARGET and the committed bundles into $DIST_TARGET"
}

install_git_hook() {
  local stage
  mkdir -p "$OPENCODE_CONFIG_HOME"
  stage="$(mktemp -d "$OPENCODE_CONFIG_HOME/.git-hooks-install.XXXXXX")"
  cp "$GIT_HOOKS_SOURCE/pre-commit" "$stage/pre-commit"
  chmod 700 "$stage/pre-commit"
  replace_tree "$stage" "$GIT_HOOKS_TARGET"
  info "installed the shared pre-commit hook into $GIT_HOOKS_TARGET, the sibling of $HOOKS_TARGET it reads session state through"
}

existing_git_hooks_owner() {
  local configured git_dir hook
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  if [ -n "$configured" ] && [ "$configured" != "$GIT_HOOKS_TARGET" ]; then
    printf 'core.hooksPath=%s' "$configured"
    return 0
  fi
  git_dir="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
  for hook in "$git_dir"/hooks/*; do
    case "$hook" in *.sample) continue ;; esac
    if [ -f "$hook" ]; then
      printf '%s' "$hook"
      return 0
    fi
  done
  return 0
}

wire_git_hook() {
  local owner error
  local wiring_remedy="git -C <repo> config core.hooksPath $GIT_HOOKS_TARGET"
  if ! command -v git >/dev/null 2>&1; then
    warn "git commit hook: not wired — git is not on PATH; wire it later with: $wiring_remedy"
    return 0
  fi
  if ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    warn "git commit hook: not wired — $REPO_ROOT is not a git repository; wire one later with: $wiring_remedy"
    return 0
  fi
  owner="$(existing_git_hooks_owner)"
  if [ -n "$owner" ]; then
    warn "git commit hook: not wired in $REPO_ROOT — $owner already owns this repo's hooks and core.hooksPath would take them out of git's reach; the plugin's own commit gate still applies here — to run both, call $GIT_HOOKS_TARGET/pre-commit from your own pre-commit"
    return 0
  fi
  if error="$(git -C "$REPO_ROOT" config --local core.hooksPath "$GIT_HOOKS_TARGET" 2>&1)"; then
    info "git commit hook: core.hooksPath wired in $REPO_ROOT, and every linked worktree inherits it — for another repo: $wiring_remedy"
  else
    warn "git commit hook: git config failed: $error — wire it by hand with: $wiring_remedy"
  fi
}

merge_global_agents() {
  local clean temp
  mkdir -p "$OPENCODE_CONFIG_HOME"
  clean="$(mktemp "$OPENCODE_CONFIG_HOME/.agents.clean.XXXXXX")"
  temp="$(mktemp "$OPENCODE_CONFIG_HOME/.agents.new.XXXXXX")"
  if [ -f "$GLOBAL_FILE" ]; then
    if ! strip_managed_region "$GLOBAL_FILE" > "$clean"; then
      rm -f "$clean" "$temp"
      fail "the existing global guidance has malformed oso-code markers: $GLOBAL_FILE (repair the marker pair, then re-run)"
    fi
  else
    : > "$clean"
  fi
  {
    awk 'NF { last = NR } { lines[NR] = $0 } END { for (i = 1; i <= last; i++) print lines[i] }' "$clean"
    [ -s "$clean" ] && printf '\n'
    printf '%s\n' "$GLOBAL_MARKER_START"
    cat "$GLOBAL_SOURCE"
    printf '%s\n' "$GLOBAL_MARKER_END"
  } > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$GLOBAL_FILE"
  rm -f "$clean"
  info "merged the global guidance into the oso-code region of $GLOBAL_FILE"
}

render_config() {
  local output keys existing fallow_command resolved
  output="$(mktemp "$OPENCODE_CONFIG_HOME/.config.new.XXXXXX")"
  keys="$TX_BACKUP_ROOT/operator-preserved-keys"
  existing="$TX_BACKUP_ROOT/items/config"
  [ -f "$existing" ] || existing=""
  fallow_command="fallow-mcp"
  if resolved="$(resolve_fallow_mcp_command "$HOME")"; then
    fallow_command="$resolved"
  else
    warn "fallow-mcp is not installed; the installed MCP entry falls back to the bare name"
  fi
  OSO_FALLOW_COMMAND="$fallow_command" python3 - "$existing" "$output" "$keys" <<'PY'
import json
import os
import sys

existing_path, output_path, keys_path = sys.argv[1:4]

OWNED_SKILL_MODES = ("oso-plan", "oso-quick", "oso-debug", "oso-roadmap")
OWNED_TASK_PATTERN = "*"
OWNED_PERMISSION_VALUES = {
    "question": "allow",
    "plan_enter": "allow",
    "plan_exit": "allow",
    "oso_plan_approve": "ask",
    "oso_plan_cancel": "ask",
}
OWNED_MCP = {
    "context7": {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp",
        "enabled": True,
    },
    "engram": {
        "type": "local",
        "command": ["engram", "mcp", "--tools=agent"],
        "enabled": True,
        "environment": {},
    },
    "fallow": {
        "type": "local",
        "command": [os.environ.get("OSO_FALLOW_COMMAND", "fallow-mcp")],
        "enabled": True,
        "environment": {},
    },
}


def owned_object(container, key):
    value = container.get(key)
    if value is None:
        value = {}
        container[key] = value
    if not isinstance(value, dict):
        raise SystemExit(
            'the existing opencode.json holds a non-object "%s"; fix it and re-run' % key
        )
    return value


config = {}
if existing_path:
    with open(existing_path, encoding="utf-8") as handle:
        config = json.load(handle)
if not isinstance(config, dict):
    raise SystemExit("the existing opencode.json is not a JSON object")

preserved = [key for key in config if key not in ("permission", "mcp", "plugin")]

config.setdefault("$schema", "https://opencode.ai/config.json")
plugins = config.get("plugin")
if plugins is None:
    config["plugin"] = []
elif not isinstance(plugins, list):
    raise SystemExit('the existing opencode.json holds a non-array "plugin"; fix it and re-run')

permission = owned_object(config, "permission")
preserved += [
    "permission." + name
    for name in permission
    if name not in OWNED_PERMISSION_VALUES and name not in ("skill", "task")
]

skills = owned_object(permission, "skill")
preserved += ["permission.skill." + name for name in skills if name not in OWNED_SKILL_MODES]
for mode in OWNED_SKILL_MODES:
    skills[mode] = "deny"

delegations = owned_object(permission, "task")
preserved += [
    "permission.task." + pattern for pattern in delegations if pattern != OWNED_TASK_PATTERN
]
delegations[OWNED_TASK_PATTERN] = "allow"

permission.update(OWNED_PERMISSION_VALUES)

servers = owned_object(config, "mcp")
preserved += ["mcp." + name for name in servers if name not in OWNED_MCP]
for name, declaration in OWNED_MCP.items():
    servers.setdefault(name, declaration)

with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")

with open(keys_path, "w", encoding="utf-8") as handle:
    for key in preserved:
        handle.write(key + "\n")
PY
  python3 - "$output" <<'PY' || fail "the rendered config violates the host contract"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

assert isinstance(data.get("plugin"), list), "plugin must be an array"
assert data.get("permission", {}).get("oso_plan_approve") == "ask", \
    "the plan approval tool must carry permission ask"
assert data.get("permission", {}).get("oso_plan_cancel") == "ask", \
    "the plan cancel tool must carry permission ask"
assert data.get("mcp", {}).get("context7"), "context7 MCP server is missing"
assert data.get("mcp", {}).get("engram"), "engram MCP server is missing"
assert data.get("mcp", {}).get("fallow"), "fallow MCP server is missing"
for name, server in data.get("mcp", {}).items():
    if not isinstance(server, dict):
        raise SystemExit("malformed MCP server: " + name)
    if "env" in server:
        raise SystemExit("MCP server uses the env key, not environment: " + name)
PY
  python3 -m json.tool "$output" >/dev/null ||
    fail "rendered OpenCode config is invalid JSON"
  chmod 600 "$output"
  mv "$output" "$CONFIG_FILE"
  info "wrote the OpenCode config to $CONFIG_FILE, preserving $(wc -l < "$keys" | tr -d ' ') operator key(s)"
}

wire_engram() {
  local help_text
  command -v engram >/dev/null 2>&1 || {
    warn "engram is not on PATH; the operator's prior Engram wiring stays as backed up"
    return 0
  }
  help_text="$(engram setup --help 2>/dev/null || true)"
  case "$help_text" in
    *opencode*) ;;
    *)
      warn "engram setup does not advertise OpenCode support; skipping its installer and preserving the operator's prior wiring"
      return 0
      ;;
  esac
  if engram setup opencode >/dev/null 2>&1; then
    info "wired Engram through its own installer (engram setup opencode)"
    return 0
  fi
  warn "engram setup opencode failed; restoring the operator's prior Engram plugin from the backup snapshot"
  if [ -f "$TX_BACKUP_ROOT/items/engram-plugin" ]; then
    mkdir -p "$(dirname "$ENGRAM_PLUGIN_FILE")"
    cp -a "$TX_BACKUP_ROOT/items/engram-plugin" "$ENGRAM_PLUGIN_FILE"
  fi
}

impeccable_skill_version() {
  [ -f "$1" ] || return 1
  sed -n 's/^version:[[:space:]]*//p' "$1" | head -n1
}

find_impeccable_source() {
  if [ -n "${OSO_IMPECCABLE_SOURCE:-}" ]; then
    printf '%s' "$OSO_IMPECCABLE_SOURCE"
    return 0
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

fetch_pinned_impeccable_source() {
  command -v git >/dev/null 2>&1 ||
    fail "git is required to fetch the pinned Impeccable marketplace; install git, or pass --no-impeccable"
  mkdir -p "$STATE_ROOT"
  IMPECCABLE_FETCH_DIR="$(mktemp -d "$STATE_ROOT/impeccable-fetch.XXXXXX")"
  if ! git clone --quiet --depth 1 \
    --branch "skill-v$SUPPORTED_IMPECCABLE_VERSION" \
    "${OSO_IMPECCABLE_REMOTE:-$IMPECCABLE_REMOTE}" "$IMPECCABLE_FETCH_DIR" 2>/dev/null; then
    rm -rf "$IMPECCABLE_FETCH_DIR"
    IMPECCABLE_FETCH_DIR=""
    fail "could not fetch Impeccable skill-v$SUPPORTED_IMPECCABLE_VERSION from ${OSO_IMPECCABLE_REMOTE:-$IMPECCABLE_REMOTE}; check network access, or pass --no-impeccable"
  fi
  IMPECCABLE_SOURCE="$IMPECCABLE_FETCH_DIR/.agents/skills/impeccable"
  [ -f "$IMPECCABLE_SOURCE/SKILL.md" ] ||
    fail "the pinned Impeccable checkout has no .agents skills build at $IMPECCABLE_SOURCE"
}

mount_impeccable() {
  IMPECCABLE_SOURCE=""
  IMPECCABLE_FETCH_DIR=""
  local found
  found="$(find_impeccable_source || true)"
  if [ -n "$found" ] &&
     [ "$(impeccable_skill_version "$found/SKILL.md")" = "$SUPPORTED_IMPECCABLE_VERSION" ]; then
    IMPECCABLE_SOURCE="$found"
  else
    fetch_pinned_impeccable_source
  fi
  "$SCRIPT_DIR/lib/mount-impeccable.sh" "$IMPECCABLE_SOURCE"
  [ "$(impeccable_skill_version "$IMPECCABLE_MOUNT/SKILL.md")" = "$SUPPORTED_IMPECCABLE_VERSION" ] ||
    fail "Impeccable is pinned to skill-v$SUPPORTED_IMPECCABLE_VERSION but the mounted skill reports version $(impeccable_skill_version "$IMPECCABLE_MOUNT/SKILL.md"); refusing to leave an unpinned install — remove it and re-run"
  IMPECCABLE_MOUNTED=true
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
  info "mounted the pinned Impeccable skill at $IMPECCABLE_MOUNT"
}

write_owner_registry() {
  local tmp keys gate
  mkdir -p "$STATE_ROOT"
  tmp="$(mktemp "$STATE_ROOT/.opencode-registry.XXXXXX")"
  keys="$TX_BACKUP_ROOT/operator-preserved-keys"
  : > "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$CONFIG_FILE" >> "$tmp"
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    printf '%s\t%s:%s\n' "$OWNER_OPERATOR" "$CONFIG_FILE" "$key" >> "$tmp"
  done < "$keys" 2>/dev/null || true
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$GLOBAL_FILE" >> "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$SKILLS_TARGET" >> "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$AGENTS_TARGET" >> "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$COMMANDS_TARGET" >> "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$PLUGIN_TARGET" >> "$tmp"
  for gate in "$HOOKS_TARGET"/*.sh; do
    [ -f "$gate" ] || continue
    printf '%s\t%s\n' "$OWNER_INSTALLER" "$gate" >> "$tmp"
  done
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$STATE_BIN_TARGET/oso-state" >> "$tmp"
  printf '%s\t%s\n' "$OWNER_INSTALLER" "$GIT_HOOKS_TARGET/pre-commit" >> "$tmp"
  if [ "$IMPECCABLE_MOUNTED" = true ]; then
    printf '%s\t%s\n' "$OWNER_INSTALLER" "$IMPECCABLE_MOUNT" >> "$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$OWNER_REGISTRY_FILE"
  info "recorded the installed-target owner registry at $OWNER_REGISTRY_FILE"
}

main() {
  initialize_paths
  parse_args "$@"
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  [ -d "$HOME" ] || fail "HOME is not a directory: $HOME"
  preflight_config_home
  preflight_payload
  verify_published_trust_bytes source "$REPO_ROOT"
  load_state_library
  preflight_config
  preflight_global_agents
  if ! check_baseline; then
    fail "host baseline not met — upgrade opencode to $SUPPORTED_OPENCODE_VERSION and re-run"
  fi
  confirm_install
  trap on_exit EXIT
  begin_transaction
  checkpoint after-backup
  migrate_opencode_state
  checkpoint after-state-migration
  install_skills
  checkpoint after-skills
  install_agents
  checkpoint after-agents
  install_commands
  checkpoint after-commands
  install_plugin
  checkpoint after-plugin
  install_git_hook
  checkpoint after-git-hook
  verify_published_trust_bytes installed "$OPENCODE_CONFIG_HOME"
  verify_every_installed_gate_is_published
  checkpoint after-trust-verification
  merge_global_agents
  checkpoint after-global
  wire_engram
  checkpoint after-engram
  render_config
  checkpoint after-config
  if [ "$INSTALL_IMPECCABLE" = true ]; then
    mount_impeccable
  else
    info "skipping Impeccable (--no-impeccable)"
    mkdir -p "$(dirname "$IMPECCABLE_OPT_OUT_MARKER")"
    printf 'skipped by --no-impeccable on %s\n' "$(date +%Y-%m-%d)" > "$IMPECCABLE_OPT_OUT_MARKER"
  fi
  checkpoint after-impeccable
  write_owner_registry
  if [ "$WIRE_GIT_HOOK" = true ]; then
    wire_git_hook
  else
    info "skipping the git commit hook wiring (--no-git-hook); the hook is installed at $GIT_HOOKS_TARGET/pre-commit"
  fi
  TX_COMMITTED=true
  TX_ACTIVE=false
  prune_install_backups || true
  info "installed oso-code for OpenCode $SUPPORTED_OPENCODE_VERSION"
  info "restart OpenCode and start a new session to load the plugin, skills, agents, commands, MCP servers and global guidance"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
