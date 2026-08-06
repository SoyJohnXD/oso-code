#!/usr/bin/env bash
# Safely repair Engram's Codex integration after closing Codex.
#
# Usage: repair-engram-codex.sh
# Optional overrides:
#   ENGRAM_DATA_DIR=/absolute/path/to/.engram
#   ENGRAM_BIN=/absolute/path/to/engram
#   ENGRAM_REPAIR_BACKUP_PARENT=/absolute/path/outside/this/repo

set -Eeuo pipefail

ENGRAM_RELEASE_VERSION=1.20.0
ENGRAM_RELEASE_TAG="v$ENGRAM_RELEASE_VERSION"
ENGRAM_RELEASE_REPO=Gentleman-Programming/engram
BACKUP_FORMAT=oso-code-engram-repair-v1
CONFIG_MARKER_START="# oso-code:start"
CONFIG_MARKER_END="# oso-code:end"
MODEL_INSTRUCTIONS_KEY=model_instructions_file
COMPACT_PROMPT_KEY=experimental_compact_prompt_file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
[ -f "$SCRIPT_DIR/lib/engram-codex-pointers.sh" ] || {
  printf '[oso-code] ERROR: Engram Codex pointer normalizer is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/engram-codex-pointers.sh"
TMP_ROOT=""
BACKUP_DIR=""
STAGED_INSTALL=""

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() {
  printf '[oso-code] ERROR: %s\n' "$1" >&2
  if [ -n "$BACKUP_DIR" ]; then
    printf '[oso-code] backup retained at %s\n' "$BACKUP_DIR" >&2
  fi
  exit 1
}
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

cleanup_tmp() {
  [ -z "$STAGED_INSTALL" ] || [ ! -e "$STAGED_INSTALL" ] || rm -f -- "$STAGED_INSTALL"
  [ -z "$TMP_ROOT" ] || rm -rf -- "$TMP_ROOT"
}

on_error() {
  local line=$1 command=$2
  warn "repair stopped at line $line while running: $command"
  if [ -n "$BACKUP_DIR" ]; then
    warn "backup retained at $BACKUP_DIR"
  fi
  warn "no rollback was attempted; do not pair an old Engram binary with a migrated database"
}

trap cleanup_tmp EXIT
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        sed -n '1,8p' "$0"
        exit 0
        ;;
      *) usage_error "unknown argument: $1" ;;
    esac
  done
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required; install it, then re-run this script"
}

has_sha256_tool() {
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1
}

has_download_tool() {
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1
}

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  [ -d "$HOME" ] || fail "HOME is not a directory: $HOME"
  HOME_PHYSICAL="$(cd "$HOME" && pwd -P)"
  [ "$HOME_PHYSICAL" != / ] || fail "refusing to operate with HOME=/"

  ENGRAM_DATA_DIR="${ENGRAM_DATA_DIR:-$HOME/.engram}"
  ENGRAM_BIN="${ENGRAM_BIN:-$HOME/.local/bin/engram}"
  CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
  CONFIG_FILE="$CODEX_HOME/config.toml"
  ENGRAM_INSTRUCTIONS_FILE="$CODEX_HOME/engram-instructions.md"
  ENGRAM_COMPACT_FILE="$CODEX_HOME/engram-compact-prompt.md"
  ENGRAM_DB="$ENGRAM_DATA_DIR/engram.db"
  BACKUP_PARENT="${ENGRAM_REPAIR_BACKUP_PARENT:-$HOME/.local/state/oso-code/engram-repair-backups}"
  REPO_ROOT_PHYSICAL="$(cd "$REPO_ROOT" && pwd -P)"
}

validate_absolute_path() {
  local label=$1 path=$2
  case "$path" in
    /*) ;;
    *) fail "$label must be an absolute path: $path" ;;
  esac
  case "$path" in
    /|*/../*|*/..|*/./*|*/.|*$'\n'*|*$'\r'*|*$'\t'*) fail "unsafe $label path: $path" ;;
  esac
}

preflight_prerequisites() {
  local tool
  for tool in awk basename chmod cmp codex cp date dirname find mkdir mktemp mv pgrep pkill rm sed sleep sqlite3 tar uname; do
    require_command "$tool"
  done
  has_sha256_tool || fail "sha256sum or shasum is required to verify the Engram release"
  has_download_tool || fail "curl or wget is required to download the Engram release"
  [ -x "$SCRIPT_DIR/verify-codex.sh" ] || fail "Codex verifier is missing or not executable: $SCRIPT_DIR/verify-codex.sh"
  validate_absolute_path "ENGRAM_DATA_DIR" "$ENGRAM_DATA_DIR"
  validate_absolute_path "ENGRAM_BIN" "$ENGRAM_BIN"
  validate_absolute_path "CODEX_HOME" "$CODEX_HOME"
  validate_absolute_path "backup parent" "$BACKUP_PARENT"
  [ -d "$ENGRAM_DATA_DIR" ] || fail "Engram data directory is missing: $ENGRAM_DATA_DIR"
  [ -f "$ENGRAM_DB" ] || fail "Engram DB is missing: $ENGRAM_DB"
  [ -x "$ENGRAM_BIN" ] || fail "Engram binary is missing or not executable: $ENGRAM_BIN"
  "$ENGRAM_BIN" version >/dev/null 2>&1 || fail "existing Engram binary is not runnable: $ENGRAM_BIN"
}

resolve_release_asset() {
  local kernel machine
  kernel="$(uname -s)"
  machine="$(uname -m)"
  [ "$kernel" = Linux ] || fail "this repair supports Linux only (found $kernel)"
  case "$machine" in
    x86_64|amd64) ENGRAM_RELEASE_ARCH=amd64 ;;
    aarch64|arm64) ENGRAM_RELEASE_ARCH=arm64 ;;
    *) fail "unsupported Linux architecture: $machine" ;;
  esac
  ENGRAM_ASSET="engram_${ENGRAM_RELEASE_VERSION}_linux_${ENGRAM_RELEASE_ARCH}.tar.gz"
  ENGRAM_RELEASE_BASE="https://github.com/$ENGRAM_RELEASE_REPO/releases/download/$ENGRAM_RELEASE_TAG"
}

physical_candidate_path() {
  local target=$1 ancestor suffix component physical
  ancestor=$target
  suffix=""
  while [ ! -e "$ancestor" ] && [ ! -L "$ancestor" ]; do
    component="$(basename "$ancestor")"
    suffix="/$component$suffix"
    ancestor="$(dirname "$ancestor")"
  done
  if [ -d "$ancestor" ]; then
    physical="$(cd "$ancestor" && pwd -P)"
  elif [ -e "$ancestor" ] && [ ! -L "$ancestor" ]; then
    component="$(basename "$ancestor")"
    suffix="/$component$suffix"
    ancestor="$(dirname "$ancestor")"
    [ -d "$ancestor" ] || fail "path ancestor is not a directory: $ancestor"
    physical="$(cd "$ancestor" && pwd -P)"
  else
    fail "path resolves through a symlink that is not a directory: $ancestor"
  fi
  printf '%s' "$physical$suffix"
}

reject_backup_location() {
  local candidate=$1 data_physical
  case "$candidate" in
    "$REPO_ROOT_PHYSICAL"|"$REPO_ROOT_PHYSICAL"/*) fail "backup parent must be outside this repository: $BACKUP_PARENT" ;;
  esac
  data_physical="$(cd "$ENGRAM_DATA_DIR" && pwd -P)"
  case "$candidate" in
    "$data_physical"|"$data_physical"/*) fail "backup parent must be outside the live Engram data directory: $BACKUP_PARENT" ;;
  esac
}

create_backup_root() {
  local candidate
  [ ! -e "$BACKUP_PARENT" ] || [ -d "$BACKUP_PARENT" ] ||
    fail "backup parent is not a directory: $BACKUP_PARENT"
  candidate="$(physical_candidate_path "$BACKUP_PARENT")"
  reject_backup_location "$candidate"
  umask 077
  mkdir -p "$BACKUP_PARENT"
  candidate="$(cd "$BACKUP_PARENT" && pwd -P)"
  reject_backup_location "$candidate"
  BACKUP_DIR="$(mktemp -d "$BACKUP_PARENT/repair-$(date +%Y%m%d-%H%M%S).XXXXXX")"
  chmod 700 "$BACKUP_DIR"
  printf '%s\n' "$BACKUP_FORMAT" > "$BACKUP_DIR/format"
  printf '%s\n' "$ENGRAM_DATA_DIR" > "$BACKUP_DIR/engram-data-dir.target"
  printf '%s\n' "$ENGRAM_BIN" > "$BACKUP_DIR/engram-bin.target"
  printf '%s\n' "$CODEX_HOME" > "$BACKUP_DIR/codex-home.target"
}

sqlite_quote_path() {
  printf '%s' "$1" | sed 's/"/""/g'
}

create_sqlite_backup() {
  local backup_path check quoted_path
  backup_path="$BACKUP_DIR/engram.db.sqlite-backup"
  quoted_path="$(sqlite_quote_path "$backup_path")"
  sqlite3 "$ENGRAM_DB" ".backup \"$quoted_path\""
  chmod 600 "$backup_path"
  check="$(sqlite3 "$backup_path" 'PRAGMA integrity_check;')"
  [ "$check" = ok ] || fail "SQLite backup integrity check failed: $check"
}

copy_current_binary() {
  cp -p "$ENGRAM_BIN" "$BACKUP_DIR/engram.current"
  chmod 700 "$BACKUP_DIR/engram.current"
  "$ENGRAM_BIN" version > "$BACKUP_DIR/engram.current.version" 2>&1
}

run_portable_export() {
  ENGRAM_DATA_DIR="$ENGRAM_DATA_DIR" "$ENGRAM_BIN" export "$BACKUP_DIR/engram-export.json" \
    > "$BACKUP_DIR/engram-export.log" 2>&1
  [ -s "$BACKUP_DIR/engram-export.json" ] || fail "Engram export produced an empty file"
  chmod 600 "$BACKUP_DIR/engram-export.json" "$BACKUP_DIR/engram-export.log"
}

copy_codex_file() {
  local label=$1 source=$2 destination
  [ -f "$source" ] || return 0
  destination="$BACKUP_DIR/codex/$label"
  mkdir -p "$(dirname "$destination")"
  cp -p "$source" "$destination"
  chmod 600 "$destination"
}

copy_codex_backup_files() {
  copy_codex_file config.toml "$CONFIG_FILE"
  copy_codex_file AGENTS.md "$CODEX_HOME/AGENTS.md"
  copy_codex_file engram-instructions.md "$ENGRAM_INSTRUCTIONS_FILE"
  copy_codex_file engram-compact-prompt.md "$ENGRAM_COMPACT_FILE"
  copy_codex_file hooks.json "$CODEX_HOME/hooks.json"
}

create_backup() {
  create_backup_root
  copy_current_binary
  create_sqlite_backup
  run_portable_export
  copy_codex_backup_files
  info "backup: $BACKUP_DIR"
}

# curl and wget each ship their own portable connect/transfer timeout flags,
# so a stalled repair download names itself instead of hanging indefinitely --
# no GNU timeout(1) workaround needed here the way the in-shell bounded-
# subshell idiom (plugin/skills/_shared/front-surface.md, reused by
# verify-codex.sh) exists for a command with no such flag of its own.
ENGRAM_DOWNLOAD_BOUND_SECONDS="${OSO_ENGRAM_DOWNLOAD_BOUND_SECONDS:-120}"

download_file() {
  local url=$1 destination=$2 label=$3 rc=0
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 \
      --connect-timeout "$ENGRAM_DOWNLOAD_BOUND_SECONDS" \
      --max-time "$ENGRAM_DOWNLOAD_BOUND_SECONDS" \
      -o "$destination" "$url" || rc=$?
    case "$rc" in
      0) return 0 ;;
      # curl's own reserved code for --connect-timeout/--max-time firing.
      28) fail "SLOW: download of $label did not finish within ${ENGRAM_DOWNLOAD_BOUND_SECONDS}s: $url" ;;
      *) fail "UNAVAILABLE: download of $label failed: $url (curl exit $rc)" ;;
    esac
  else
    wget -q --tries=3 --timeout="$ENGRAM_DOWNLOAD_BOUND_SECONDS" -O "$destination" "$url" || rc=$?
    # wget has no code of its own reserved for a fired --timeout the way curl's
    # 28 is, so a nonzero exit here is reported the same honest way curl's own
    # non-timeout failures are -- never a guessed cause the tool never confirmed.
    [ "$rc" -eq 0 ] ||
      fail "UNAVAILABLE: download of $label failed: $url (wget exit $rc)"
  fi
}

verify_selected_checksum() {
  local selected hash
  selected="$TMP_ROOT/selected-checksums.txt"
  awk -v asset="$ENGRAM_ASSET" '
    $2 == asset { print; rows++ }
    END { exit rows == 1 ? 0 : 1 }
  ' "$TMP_ROOT/checksums.txt" > "$selected" || fail "checksums.txt does not contain exactly one row for $ENGRAM_ASSET"
  hash="$(awk '{ print $1 }' "$selected")"
  case "$hash" in
    *[!0-9a-f]*|'') fail "selected Engram checksum is invalid" ;;
  esac
  [ "${#hash}" -eq 64 ] || fail "selected Engram checksum is not a SHA-256 digest"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TMP_ROOT" && sha256sum -c "$selected")
  else
    (cd "$TMP_ROOT" && shasum -a 256 -c "$selected")
  fi
}

download_release() {
  TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/oso-engram-repair.XXXXXX")"
  info "downloading Engram $ENGRAM_RELEASE_TAG for linux/$ENGRAM_RELEASE_ARCH"
  download_file "$ENGRAM_RELEASE_BASE/checksums.txt" "$TMP_ROOT/checksums.txt" "Engram checksums"
  download_file "$ENGRAM_RELEASE_BASE/$ENGRAM_ASSET" "$TMP_ROOT/$ENGRAM_ASSET" "Engram release archive"
  verify_selected_checksum
}

stage_release_binary() {
  local extract_dir candidates candidate_count
  extract_dir="$TMP_ROOT/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$TMP_ROOT/$ENGRAM_ASSET" -C "$extract_dir"
  candidates="$TMP_ROOT/engram-candidates.txt"
  find "$extract_dir" -type f -name engram -print > "$candidates"
  candidate_count="$(awk 'END { print NR + 0 }' "$candidates")"
  [ "$candidate_count" -eq 1 ] || fail "release archive must contain exactly one engram binary (found $candidate_count)"
  STAGED_BINARY="$(awk 'NR == 1 { print }' "$candidates")"
  chmod 700 "$STAGED_BINARY"
}

validate_staged_binary() {
  local version_output
  version_output="$("$STAGED_BINARY" version 2>&1)" || fail "staged Engram binary could not run"
  [ "$version_output" = "engram $ENGRAM_RELEASE_VERSION" ] ||
    fail "staged Engram binary reported '$version_output', expected 'engram $ENGRAM_RELEASE_VERSION'"
}

install_staged_binary() {
  local target_dir
  target_dir="$(dirname "$ENGRAM_BIN")"
  mkdir -p "$target_dir"
  STAGED_INSTALL="$(mktemp "$target_dir/.engram.$ENGRAM_RELEASE_VERSION.XXXXXX")"
  cp "$STAGED_BINARY" "$STAGED_INSTALL"
  chmod 755 "$STAGED_INSTALL"
  "$STAGED_INSTALL" version >/dev/null 2>&1 || fail "staged install binary is not runnable"
  mv -f "$STAGED_INSTALL" "$ENGRAM_BIN"
  STAGED_INSTALL=""
  info "installed Engram $ENGRAM_RELEASE_VERSION at $ENGRAM_BIN"
}

ensure_tmp_root() {
  [ -n "$TMP_ROOT" ] || TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/oso-engram-repair.XXXXXX")"
}

write_normalized_codex_config() {
  local destination=$1
  normalize_engram_codex_pointers \
    "$CONFIG_FILE" "$destination" \
    "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" \
    "$MODEL_INSTRUCTIONS_KEY" "$COMPACT_PROMPT_KEY" \
    "$ENGRAM_INSTRUCTIONS_FILE" "$ENGRAM_COMPACT_FILE" \
    "$SCRIPT_DIR/lib/toml-regions.awk" 1
}

validate_normalized_codex_config() {
  local candidate=$1 validation_home
  ensure_tmp_root
  validation_home="$(mktemp -d "$TMP_ROOT/codex-config.XXXXXX")"
  cp "$candidate" "$validation_home/config.toml"
  CODEX_HOME="$validation_home" codex sandbox -P oso -- /bin/true
}

normalize_engram_codex_config() {
  local candidate
  [ -f "$CONFIG_FILE" ] || fail "Codex config is missing after engram setup codex: $CONFIG_FILE"
  [ -n "$BACKUP_DIR" ] || fail "backup root must exist before Codex config repair"
  copy_codex_file config.before-engram-pointer-normalize.toml "$CONFIG_FILE"
  ensure_tmp_root
  candidate="$(mktemp "$TMP_ROOT/config.normalized.XXXXXX")"
  write_normalized_codex_config "$candidate" ||
    fail "Codex config has malformed markers or invalid Engram pointer ownership"
  validate_normalized_codex_config "$candidate" ||
    fail "Codex rejected the normalized config candidate"
  if cmp -s "$CONFIG_FILE" "$candidate"; then
    info "Codex config Engram pointers already normalized"
    return 0
  fi
  STAGED_INSTALL="$(mktemp "$CODEX_HOME/.config.repair.XXXXXX")"
  cp "$candidate" "$STAGED_INSTALL"
  chmod 600 "$STAGED_INSTALL"
  mv -f "$STAGED_INSTALL" "$CONFIG_FILE"
  STAGED_INSTALL=""
  info "normalized Engram Codex pointers outside the oso-code managed region"
}

refuse_if_codex_running() {
  if [ "${OSO_AGENT:-}" = 1 ]; then
    fail "run this from a normal terminal after closing Codex; OSO_AGENT is set"
  fi
  if pgrep -x codex >/dev/null 2>&1; then
    warn "Codex appears to be running:"
    pgrep -ax codex >&2 || true
    fail "close Codex completely before repairing Engram"
  fi
}

stop_stale_engram_processes() {
  local attempt pids
  pids="$(pgrep -x engram 2>/dev/null || true)"
  [ -n "$pids" ] || return 0
  info "stopping existing Engram processes before replacing the binary"
  pkill -TERM -x engram || fail "could not signal existing Engram processes; stop them manually, then re-run"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x engram >/dev/null 2>&1 || return 0
    sleep 1
  done
  fail "Engram is still running; stop it manually, then re-run this script"
}

run_repaired_engram() {
  info "running Engram version"
  "$ENGRAM_BIN" version
  info "running Engram doctor --json"
  ENGRAM_DATA_DIR="$ENGRAM_DATA_DIR" "$ENGRAM_BIN" doctor --json
  info "running Engram stats"
  ENGRAM_DATA_DIR="$ENGRAM_DATA_DIR" "$ENGRAM_BIN" stats
  info "running Engram setup codex"
  ENGRAM_DATA_DIR="$ENGRAM_DATA_DIR" "$ENGRAM_BIN" setup codex
  normalize_engram_codex_config
}

run_codex_verifier() {
  info "running Codex verifier"
  ENGRAM_DATA_DIR="$ENGRAM_DATA_DIR" CODEX_HOME="$CODEX_HOME" bash "$SCRIPT_DIR/verify-codex.sh"
}

test_path_inside_root() {
  local label=$1 path=$2 root=$3 candidate
  validate_absolute_path "$label" "$path"
  candidate="$(physical_candidate_path "$path")"
  case "$candidate" in
    "$root"|"$root"/*) ;;
    *) fail "$label resolves outside repair test root: $path -> $candidate" ;;
  esac
}

run_repaired_engram_test_mode() {
  local test_root codex_test_bin
  [ -n "${OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT:-}" ] ||
    fail "repair test root is required for test mode"
  [ -n "${OSO_REPAIR_ENGRAM_CODEX_TEST_BACKUP_DIR:-}" ] ||
    fail "repair test backup directory is required for test mode"
  validate_absolute_path "repair test root" "$OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT"
  [ -d "$OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT" ] ||
    fail "repair test root is not a directory: $OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT"
  test_root="$(cd "$OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT" && pwd -P)"
  case "$test_root" in
    /tmp/*) ;;
    *) fail "repair test root must be under /tmp: $test_root" ;;
  esac
  initialize_paths
  BACKUP_DIR="$OSO_REPAIR_ENGRAM_CODEX_TEST_BACKUP_DIR"
  TMPDIR="$test_root/tmp"
  test_path_inside_root HOME "$HOME" "$test_root"
  test_path_inside_root CODEX_HOME "$CODEX_HOME" "$test_root"
  test_path_inside_root ENGRAM_DATA_DIR "$ENGRAM_DATA_DIR" "$test_root"
  test_path_inside_root ENGRAM_BIN "$ENGRAM_BIN" "$test_root"
  test_path_inside_root BACKUP_DIR "$BACKUP_DIR" "$test_root"
  test_path_inside_root TMPDIR "$TMPDIR" "$test_root"
  test_path_inside_root CONFIG_FILE "$CONFIG_FILE" "$test_root"
  test_path_inside_root ENGRAM_INSTRUCTIONS_FILE "$ENGRAM_INSTRUCTIONS_FILE" "$test_root"
  test_path_inside_root ENGRAM_COMPACT_FILE "$ENGRAM_COMPACT_FILE" "$test_root"
  test_path_inside_root ENGRAM_DB "$ENGRAM_DB" "$test_root"
  test_path_inside_root "SQLite backup file" "$BACKUP_DIR/engram.db.sqlite-backup" "$test_root"
  test_path_inside_root "Engram export JSON" "$BACKUP_DIR/engram-export.json" "$test_root"
  test_path_inside_root "Engram export log" "$BACKUP_DIR/engram-export.log" "$test_root"
  test_path_inside_root "backup codex directory" "$BACKUP_DIR/codex" "$test_root"
  test_path_inside_root \
    "pre-normalize backup config" \
    "$BACKUP_DIR/codex/config.before-engram-pointer-normalize.toml" \
    "$test_root"
  codex_test_bin="$(command -v codex 2>/dev/null || true)"
  [ -n "$codex_test_bin" ] || fail "codex test shim is missing"
  test_path_inside_root "codex test shim" "$codex_test_bin" "$test_root"
  mkdir -p "$TMPDIR"
  mkdir -p "$BACKUP_DIR"
  run_repaired_engram
}

main() {
  parse_args "$@"
  initialize_paths
  preflight_prerequisites
  resolve_release_asset
  refuse_if_codex_running
  stop_stale_engram_processes
  create_backup
  download_release
  stage_release_binary
  validate_staged_binary
  install_staged_binary
  run_repaired_engram
  run_codex_verifier
  info "backup retained at $BACKUP_DIR"
  info "restart Codex now so it reloads the repaired Engram integration"
}

if [ "${OSO_REPAIR_ENGRAM_CODEX_TEST_RUN_REPAIRED:-}" = 1 ]; then
  [ "${BASH_SOURCE[0]}" = "$0" ] || fail "test run mode must execute the helper"
  run_repaired_engram_test_mode
else
  main "$@"
fi
