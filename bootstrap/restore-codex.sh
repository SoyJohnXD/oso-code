#!/usr/bin/env bash
# Restore a Codex installation from one of install-codex.sh's own backups.
#
# Usage: restore-codex.sh [--yes] [--list] [<backup-name>]
#   --list        List available backups, newest first, and exit. Nothing is
#                 touched.
#   --yes         Skip the confirmation prompt.
#   <backup-name> One of the directory names --list prints. Defaults to the
#                 most recent backup when omitted.
#
# Every target this restores is read from that backup's OWN manifest -- the
# exact set install-codex.sh's begin_transaction backed up at install time --
# never guessed from what this version of install-codex.sh currently writes,
# so a backup made by an older or newer install-codex.sh still restores.
#
# core.hooksPath (the git commit-hook wiring) is the one thing install-codex.sh's
# in-run rollback can revert that this cannot: that value is only ever held in
# memory for the run that captured it, never written to the backup itself, so
# a restore run afterwards has nothing on disk to read it back from. Re-run
# install-codex.sh, or wire the git hook by hand, if that also needs to change.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/lib/install-backup.sh" ] || {
  printf '[oso-code] ERROR: install backup library is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/install-backup.sh"

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  BACKUPS_ROOT="$HOME/.local/state/oso-code"
  RESTORE_EXERCISED_MARKER="$BACKUPS_ROOT/.install-restore-verified"
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
  install_backup_dirs_newest_first "$BACKUPS_ROOT" > "$listing"
  if [ ! -s "$listing" ]; then
    info "no install backups found under $BACKUPS_ROOT"
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
  install_backup_dirs_newest_first "$BACKUPS_ROOT" > "$listing"
  RESTORE_TARGET="$(awk 'NR == 1 { print; exit }' "$listing")"
  rm -f "$listing"
  [ -n "$RESTORE_TARGET" ] || fail "no install backups found under $BACKUPS_ROOT"
}

validate_backup_dir() {
  local dir=$1 name
  [ -d "$dir" ] && [ ! -L "$dir" ] || fail "not a backup directory: $dir"
  name="${dir##*/}"
  is_install_backup_name "$name" || fail "not one of install-codex.sh's own backups: $dir"
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

# The retention policy in install-codex.sh's prune_install_backups refuses to
# delete anything until this file exists: a purge that ran on its first
# installation would delete the very artifacts an operator reaches for if
# that installation goes wrong, so pruning stays off until a restore has
# actually been proven to work on this machine at least once.
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
