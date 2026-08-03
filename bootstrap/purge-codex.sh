#!/usr/bin/env bash
# Back up and remove Codex user state before a clean oso-code installation.
#
# Usage:
#   purge-codex.sh [--yes]
#   purge-codex.sh --restore BACKUP_DIR

set -euo pipefail

BACKUP_FORMAT=oso-code-codex-purge-v1

info() { printf '[oso-code] %s\n' "$1"; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  [ -d "$HOME" ] || fail "HOME is not a directory: $HOME"
  HOME_PHYSICAL="$(cd "$HOME" && pwd -P)"
  [ "$HOME_PHYSICAL" != / ] || fail "refusing to operate with HOME=/"

  CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
  AGENTS_HOME="$HOME/.agents"
  BACKUP_PARENT="$HOME/.local/state/oso-code/purge-backups"
  [ "$CODEX_HOME" = "$HOME/.codex" ] ||
    fail "CODEX_HOME must be exactly HOME/.codex for a full Codex reset"
  validate_target "$CODEX_HOME" "CODEX_HOME"
  validate_target "$AGENTS_HOME" "agents home"
  [ "$CODEX_HOME" != "$AGENTS_HOME" ] ||
    fail "CODEX_HOME and the agents home must be different directories"
  reject_backup_overlap "$CODEX_HOME"
  reject_backup_overlap "$AGENTS_HOME"
}

validate_target() {
  local target=$1 label=$2 parent parent_physical
  case "$target" in
    /*) ;;
    *) fail "$label must be an absolute path: $target" ;;
  esac
  case "$target" in
    "$HOME"|/|*/../*|*/..|*/./*|*/.|*$'\n'*|*$'\r'*|*$'\t'*)
      fail "unsafe $label path: $target"
      ;;
  esac
  case "$target" in
    "$HOME"/*) ;;
    *) fail "$label must remain below HOME: $target" ;;
  esac
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    [ -d "$target" ] || fail "$label is not a directory: $target"
    parent="$(dirname "$target")"
    parent_physical="$(cd "$parent" && pwd -P)"
    case "$parent_physical" in
      "$HOME_PHYSICAL"|"$HOME_PHYSICAL"/*) ;;
      *) fail "$label resolves outside HOME: $target" ;;
    esac
  fi
}

reject_backup_overlap() {
  local target=$1
  case "$BACKUP_PARENT" in
    "$target"|"$target"/*) fail "backup root would be inside purge target: $target" ;;
  esac
  case "$target" in
    "$BACKUP_PARENT"|"$BACKUP_PARENT"/*) fail "purge target would contain existing backups: $target" ;;
  esac
}

parse_args() {
  MODE=purge
  ASSUME_YES=false
  RESTORE_BACKUP=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes)
        [ "$MODE" = purge ] || usage_error "--yes cannot be combined with --restore"
        ASSUME_YES=true
        shift
        ;;
      --restore)
        [ "$MODE" = purge ] || usage_error "--restore may be specified only once"
        [ "$ASSUME_YES" = false ] || usage_error "--yes cannot be combined with --restore"
        [ "$#" -ge 2 ] || usage_error "--restore requires a backup directory"
        MODE=restore
        RESTORE_BACKUP=$2
        shift 2
        ;;
      *) usage_error "unknown argument: $1" ;;
    esac
  done
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "sha256sum or shasum is required to verify the backup"
  fi
}

directory_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

confirm_purge() {
  [ "$ASSUME_YES" = true ] && return 0
  info "this will remove all of $CODEX_HOME and $AGENTS_HOME after a verified backup"
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "aborted by user" ;;
  esac
}

create_backup_root() {
  umask 077
  preflight_backup_parent
  mkdir -p "$BACKUP_PARENT"
  local physical
  physical="$(cd "$BACKUP_PARENT" && pwd -P)"
  validate_physical_backup_root "$physical"
  BACKUP_DIR="$(mktemp -d "$BACKUP_PARENT/purge-$(date +%Y%m%d-%H%M%S).XXXXXX")"
  chmod 700 "$BACKUP_DIR"
  printf '%s\n' "$BACKUP_FORMAT" > "$BACKUP_DIR/format"
  printf '%s\n' "$CODEX_HOME" > "$BACKUP_DIR/codex-home.target"
  printf '%s\n' "$AGENTS_HOME" > "$BACKUP_DIR/agents-home.target"
  : > "$BACKUP_DIR/manifest.sha256"
}

preflight_backup_parent() {
  local ancestor=$BACKUP_PARENT suffix="" component physical candidate
  while [ ! -e "$ancestor" ] && [ ! -L "$ancestor" ]; do
    component="$(basename "$ancestor")"
    suffix="/$component$suffix"
    ancestor="$(dirname "$ancestor")"
  done
  [ -d "$ancestor" ] || fail "backup ancestor is not a directory: $ancestor"
  physical="$(cd "$ancestor" && pwd -P)"
  candidate="$physical$suffix"
  validate_physical_backup_root "$candidate"
}

validate_physical_backup_root() {
  local physical=$1
  case "$physical" in
    "$HOME_PHYSICAL"/*) ;;
    *) fail "backup root resolves outside HOME: $BACKUP_PARENT" ;;
  esac
  reject_physical_backup_overlap "$physical" "$CODEX_HOME"
  reject_physical_backup_overlap "$physical" "$AGENTS_HOME"
}

reject_physical_backup_overlap() {
  local backup_physical=$1 target=$2 target_physical
  [ -d "$target" ] && [ ! -L "$target" ] || return 0
  target_physical="$(cd "$target" && pwd -P)"
  case "$backup_physical" in
    "$target_physical"|"$target_physical"/*)
      fail "backup root resolves inside purge target: $target"
      ;;
  esac
}

archive_target() {
  local label=$1 target=$2 archive
  if [ -L "$target" ]; then
    printf 'symlink\n' > "$BACKUP_DIR/$label.state"
    archive="$BACKUP_DIR/$label.tar"
    tar -cf "$archive" -C "$(dirname "$target")" "$(basename "$target")"
  elif [ ! -e "$target" ]; then
    printf 'absent\n' > "$BACKUP_DIR/$label.state"
    return 0
  else
    if find "$target" -type s -print -quit 2>/dev/null | grep -q .; then
      fail "cannot create a complete backup while a socket exists below: $target"
    fi
    printf 'directory\n' > "$BACKUP_DIR/$label.state"
    archive="$BACKUP_DIR/$label.tar"
    tar -cf "$archive" -C "$target" .
  fi
  chmod 600 "$archive"
  tar -tf "$archive" >/dev/null || fail "could not read staged backup: $archive"
}

write_backup_manifest() {
  local name
  : > "$BACKUP_DIR/manifest.sha256"
  for name in format codex-home.target codex-home.state \
    agents-home.target agents-home.state; do
    printf '%s  %s\n' "$(sha256_file "$BACKUP_DIR/$name")" "$name" \
      >> "$BACKUP_DIR/manifest.sha256"
  done
  for name in codex-home agents-home; do
    [ "$(cat "$BACKUP_DIR/$name.state")" = absent ] ||
      printf '%s  %s.tar\n' "$(sha256_file "$BACKUP_DIR/$name.tar")" "$name" \
        >> "$BACKUP_DIR/manifest.sha256"
  done
}

backup_state() {
  create_backup_root
  archive_target codex-home "$CODEX_HOME"
  archive_target agents-home "$AGENTS_HOME"
  write_backup_manifest
  verify_backup "$BACKUP_DIR"
}

expected_manifest_hash() {
  local backup=$1 file_name=$2
  awk -v file="$file_name" '
    $2 == file { count++; hash = $1 }
    END { if (count == 1) print hash; else exit 1 }
  ' "$backup/manifest.sha256"
}

verify_manifest_file() {
  local backup=$1 name=$2 expected actual
  expected="$(expected_manifest_hash "$backup" "$name")" ||
    fail "backup hash entry is missing or duplicated: $name"
  case "$expected" in
    *[!0-9a-f]*|'') fail "backup hash is invalid: $name" ;;
  esac
  [ "${#expected}" -eq 64 ] || fail "backup hash is invalid: $name"
  actual="$(sha256_file "$backup/$name")"
  [ "$actual" = "$expected" ] || fail "backup hash mismatch: $name"
}

verify_backup_target() {
  local backup=$1 label=$2 expected_target=$3 state archive
  [ "$(cat "$backup/$label.target")" = "$expected_target" ] ||
    fail "backup target does not match this HOME: $label"
  state="$(cat "$backup/$label.state")"
  archive="$backup/$label.tar"
  case "$state" in
    absent)
      [ ! -e "$archive" ] || fail "absent backup target unexpectedly has an archive: $label"
      if grep -Eq "^[0-9a-f]{64}  $label\.tar$" "$backup/manifest.sha256"; then
        fail "absent backup target unexpectedly has a hash: $label"
      fi
      ;;
    directory)
      [ -f "$archive" ] && [ ! -L "$archive" ] ||
        fail "backup archive is missing or unsafe: $archive"
      verify_manifest_file "$backup" "$label.tar"
      verify_archive_paths "$archive" "$label.tar"
      ;;
    symlink)
      [ -f "$archive" ] && [ ! -L "$archive" ] ||
        fail "backup archive is missing or unsafe: $archive"
      verify_manifest_file "$backup" "$label.tar"
      verify_archive_paths "$archive" "$label.tar"
      verify_symlink_archive "$archive" "$expected_target" "$label.tar"
      ;;
    *) fail "backup state is invalid: $label" ;;
  esac
}

verify_symlink_archive() {
  local archive=$1 target=$2 name=$3 expected
  expected="$(basename "$target")"
  if ! tar -tf "$archive" | awk -v expected="$expected" '
    { count++; entry = $0 }
    END { exit count == 1 && entry == expected ? 0 : 1 }
  '; then
    fail "symlink backup must contain exactly its root link: $name"
  fi
}

verify_archive_paths() {
  local archive=$1 name=$2
  if ! tar -tf "$archive" | awk '
    /^\// { unsafe = 1 }
    /(^|\/)\.\.($|\/)/ { unsafe = 1 }
    END { exit unsafe ? 1 : 0 }
  '; then
    fail "backup archive has an unsafe or unreadable path: $name"
  fi
}

verify_manifest_coverage() {
  local backup=$1 expected actual
  expected='format
codex-home.target
codex-home.state
agents-home.target
agents-home.state'
  [ "$(cat "$backup/codex-home.state")" = absent ] || expected="$expected
codex-home.tar"
  if [ "$(cat "$backup/agents-home.state")" != absent ]; then
    [ -z "$expected" ] || expected="$expected
"
    expected="${expected}agents-home.tar"
  fi
  actual="$(awk 'NF { print $2 }' "$backup/manifest.sha256" | LC_ALL=C sort)"
  expected="$(printf '%s\n' "$expected" | awk 'NF' | LC_ALL=C sort)"
  [ "$actual" = "$expected" ] || fail "backup hash manifest has unexpected coverage"
}

verify_backup() {
  local backup=$1 mode required
  [ -d "$backup" ] && [ ! -L "$backup" ] || fail "backup is not a directory: $backup"
  mode="$(directory_mode "$backup")"
  [ "$mode" = 700 ] || fail "backup directory must have mode 0700 (found $mode)"
  required='format
manifest.sha256
codex-home.target
codex-home.state
agents-home.target
agents-home.state'
  while IFS= read -r required_file; do
    [ -f "$backup/$required_file" ] && [ ! -L "$backup/$required_file" ] ||
      fail "backup metadata is missing or unsafe: $required_file"
  done <<EOF
$required
EOF
  while IFS= read -r required_file; do
    verify_manifest_file "$backup" "$required_file"
  done <<'EOF'
format
codex-home.target
codex-home.state
agents-home.target
agents-home.state
EOF
  verify_manifest_coverage "$backup"
  [ "$(cat "$backup/format")" = "$BACKUP_FORMAT" ] ||
    fail "unsupported or missing backup format"
  verify_backup_target "$backup" codex-home "$CODEX_HOME"
  verify_backup_target "$backup" agents-home "$AGENTS_HOME"
}

checkpoint() {
  [ "${OSO_PURGE_FAIL_AFTER:-}" != "$1" ] || fail "injected failure after $1"
}

remove_sources() {
  rm -rf "$CODEX_HOME"
  rm -rf "$AGENTS_HOME"
  [ ! -e "$CODEX_HOME" ] && [ ! -L "$CODEX_HOME" ] ||
    fail "Codex home was not removed: $CODEX_HOME"
  [ ! -e "$AGENTS_HOME" ] && [ ! -L "$AGENTS_HOME" ] ||
    fail "agents home was not removed: $AGENTS_HOME"
}

purge() {
  confirm_purge
  if [ ! -e "$CODEX_HOME" ] && [ ! -L "$CODEX_HOME" ] &&
     [ ! -e "$AGENTS_HOME" ] && [ ! -L "$AGENTS_HOME" ]; then
    info "Codex and agents homes are already absent; nothing to purge"
    return 0
  fi
  backup_state
  info "backup: $BACKUP_DIR"
  checkpoint after-backup
  remove_sources
  info "purged Codex and agents homes; no login or installation command was run"
  info "restore with: HOME=\"$HOME\" CODEX_HOME=\"$CODEX_HOME\" bash \"$0\" --restore \"$BACKUP_DIR\""
}

assert_restore_target_absent() {
  local target=$1 label=$2
  [ ! -e "$target" ] && [ ! -L "$target" ] ||
    fail "refusing to overwrite existing $label: $target"
}

extract_restore_stage() {
  local backup=$1 label=$2 target=$3 state stage_root stage_source
  state="$(cat "$backup/$label.state")"
  [ "$state" != absent ] || return 0
  stage_root="$(mktemp -d "$(dirname "$target")/.oso-restore.XXXXXX")"
  case "$state" in
    directory)
      stage_source="$stage_root/tree"
      mkdir "$stage_source"
      tar -xf "$backup/$label.tar" -C "$stage_source"
      ;;
    symlink)
      stage_source="$stage_root/$(basename "$target")"
      tar -xf "$backup/$label.tar" -C "$stage_root"
      [ -L "$stage_source" ] || fail "restored staging object is not a symlink: $label"
      ;;
  esac
  case "$label" in
    codex-home)
      CODEX_STAGE_ROOT=$stage_root
      CODEX_STAGE_SOURCE=$stage_source
      ;;
    agents-home)
      AGENTS_STAGE_ROOT=$stage_root
      AGENTS_STAGE_SOURCE=$stage_source
      ;;
  esac
}

cleanup_restore() {
  [ -z "${CODEX_STAGE_ROOT:-}" ] || rm -rf "$CODEX_STAGE_ROOT"
  [ -z "${AGENTS_STAGE_ROOT:-}" ] || rm -rf "$AGENTS_STAGE_ROOT"
  if [ "${RESTORE_ACTIVE:-false}" = true ]; then
    [ "${CODEX_RESTORED:-false}" = false ] || rm -rf "$CODEX_HOME"
    [ "${AGENTS_RESTORED:-false}" = false ] || rm -rf "$AGENTS_HOME"
  fi
}

restore_backup() {
  case "$RESTORE_BACKUP" in /*) ;; *) fail "backup path must be absolute" ;; esac
  verify_backup "$RESTORE_BACKUP"
  assert_restore_target_absent "$CODEX_HOME" "Codex home"
  assert_restore_target_absent "$AGENTS_HOME" "agents home"
  mkdir -p "$(dirname "$CODEX_HOME")" "$(dirname "$AGENTS_HOME")"

  CODEX_STAGE_ROOT=""
  CODEX_STAGE_SOURCE=""
  AGENTS_STAGE_ROOT=""
  AGENTS_STAGE_SOURCE=""
  CODEX_RESTORED=false
  AGENTS_RESTORED=false
  RESTORE_ACTIVE=true
  trap cleanup_restore EXIT
  extract_restore_stage "$RESTORE_BACKUP" codex-home "$CODEX_HOME"
  extract_restore_stage "$RESTORE_BACKUP" agents-home "$AGENTS_HOME"
  if [ -n "$CODEX_STAGE_SOURCE" ]; then
    mv "$CODEX_STAGE_SOURCE" "$CODEX_HOME"
    CODEX_RESTORED=true
    CODEX_STAGE_SOURCE=""
    checkpoint after-codex-restore
    rmdir "$CODEX_STAGE_ROOT"
    CODEX_STAGE_ROOT=""
  fi
  if [ -n "$AGENTS_STAGE_SOURCE" ]; then
    mv "$AGENTS_STAGE_SOURCE" "$AGENTS_HOME"
    AGENTS_RESTORED=true
    AGENTS_STAGE_SOURCE=""
    rmdir "$AGENTS_STAGE_ROOT"
    AGENTS_STAGE_ROOT=""
  fi
  RESTORE_ACTIVE=false
  trap - EXIT
  info "restored Codex and agents homes from verified backup: $RESTORE_BACKUP"
  info "no login or installation command was run"
}

main() {
  initialize_paths
  parse_args "$@"
  case "$MODE" in
    purge) purge ;;
    restore) restore_backup ;;
  esac
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
