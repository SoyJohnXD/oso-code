#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/lib/install-backup.sh" ] || {
  printf '[oso-code] ERROR: install backup library is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/install-backup.sh"
[ -f "$SCRIPT_DIR/lib/codex-install-backups.sh" ] || {
  printf '[oso-code] ERROR: Codex backup identity library is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/codex-install-backups.sh"

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  BACKUPS_ROOT="$HOME/.local/state/oso-code"
  RESTORE_EXERCISED_MARKER="$BACKUPS_ROOT/.install-restore-verified-codex"
}

parse_args() {
  local arg
  ASSUME_YES=false
  LIST_ONLY=false
  BACKUP_NAME=""
  for arg in "$@"; do
    case "$arg" in
      --yes) ASSUME_YES=true ;;
      --list) LIST_ONLY=true ;;
      -*) usage_error "unknown flag: $arg" ;;
      *)
        [ -z "$BACKUP_NAME" ] || usage_error "only one backup name may be given"
        BACKUP_NAME="$arg"
        ;;
    esac
  done
}

list_backups() {
  local listing backup
  listing="$(mktemp "${TMPDIR:-/tmp}/oso-codex-restore-list.XXXXXX")"
  codex_install_backups_newest_first "$BACKUPS_ROOT" > "$listing"
  if [ ! -s "$listing" ]; then
    info "no install-codex.sh backups found under $BACKUPS_ROOT"
    rm -f "$listing"
    return 0
  fi
  while IFS= read -r backup; do
    printf '%s\t%s KiB\n' "${backup##*/}" "$(backup_size_kib "$backup")"
  done < "$listing"
  rm -f "$listing"
}

resolve_backup_dir() {
  local listing
  if [ -n "$BACKUP_NAME" ]; then
    case "$BACKUP_NAME" in
      */*|.|..) fail "backup name must be a bare directory name: $BACKUP_NAME" ;;
    esac
    RESTORE_TARGET="$BACKUPS_ROOT/$BACKUP_NAME"
    return 0
  fi
  listing="$(mktemp "${TMPDIR:-/tmp}/oso-codex-restore-latest.XXXXXX")"
  codex_install_backups_newest_first "$BACKUPS_ROOT" > "$listing"
  RESTORE_TARGET="$(awk 'NR == 1 { print; exit }' "$listing")"
  rm -f "$listing"
  [ -n "$RESTORE_TARGET" ] ||
    fail "no install-codex.sh backups found under $BACKUPS_ROOT"
}

validate_backup_dir() {
  local dir=$1 name
  [ -d "$dir" ] && [ ! -L "$dir" ] || fail "not a backup directory: $dir"
  name="${dir##*/}"
  is_install_backup_name "$name" || fail "not one of this installer's own backups: $dir"
  is_codex_install_backup "$dir" ||
    fail "not an install-codex.sh backup: $dir — restore-opencode.sh replays the OpenCode installer's own snapshots"
  [ -f "$dir/manifest" ] && [ ! -L "$dir/manifest" ] || fail "backup has no manifest: $dir"
  [ -d "$dir/items" ] && [ ! -L "$dir/items" ] || fail "backup has no items directory: $dir"
}

confirm_restore() {
  local answer
  [ "$ASSUME_YES" = true ] && return 0
  info "this overwrites the current Codex install state with the snapshot at $RESTORE_TARGET"
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) fail "aborted by user" ;; esac
}

record_restore_exercised() {
  mkdir -p "$BACKUPS_ROOT"
  printf 'restored %s from %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$RESTORE_TARGET" \
    > "$RESTORE_EXERCISED_MARKER"
}

main() {
  initialize_paths
  parse_args "$@"
  if [ "$LIST_ONLY" = true ]; then
    list_backups
    return 0
  fi
  resolve_backup_dir
  validate_backup_dir "$RESTORE_TARGET"
  confirm_restore
  info "restoring from $RESTORE_TARGET"
  if restore_backup_manifest "$RESTORE_TARGET/manifest" "$RESTORE_TARGET/items"; then
    record_restore_exercised
    info "restore complete"
    warn "core.hooksPath (the git commit-hook wiring) is not covered by this restore; re-run install-codex.sh if that also needs to change"
  else
    fail "restore incomplete: $RESTORE_FAILED_COUNT item(s) failed to restore ($RESTORE_FAILED_ITEMS)"
  fi
}

main "$@"
