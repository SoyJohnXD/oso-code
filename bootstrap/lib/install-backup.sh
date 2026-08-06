# Shared backup-manifest replay and inventory for install-codex.sh's own
# `install-backup-*` snapshots under ~/.local/state/oso-code.
#
# Two independent callers read this: install-codex.sh's in-run
# rollback_transaction (restores the CURRENT run's own backup the moment a
# step fails) and the standalone bootstrap/restore-codex.sh (restores an
# OLDER backup, any time later, at the operator's request). Both must read
# the same manifest the same way -- one format, one replay -- so a mid-run
# rollback and a later operator-invoked restore can never drift into two
# readings of the same backup.
#
# Sourced, not executed: functions only, no side effects at source time.

# The exact naming shape begin_transaction stamps on every backup it creates
# (`install-backup-<date>-<time>-<pid>`). Both the pruning side
# (install-codex.sh) and the restore side (restore-codex.sh) check a
# candidate against this once, so neither can drift from what the other
# treats as a real snapshot.
is_install_backup_name() {
  case "$1" in
    install-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) return 0 ;;
    *) return 1 ;;
  esac
}

# One absolute backup path per line, newest first. The timestamp prefix is
# fixed-width, so a plain lexicographic reverse sort is already chronological
# order; nothing here is a backup unless it is a real directory (never a
# symlink) whose name is the exact stamp above.
install_backup_dirs_newest_first() {
  local root=$1 entry name
  [ -d "$root" ] || return 0
  for entry in "$root"/install-backup-*; do
    [ -e "$entry" ] || continue
    [ -d "$entry" ] && [ ! -L "$entry" ] || continue
    name="${entry##*/}"
    is_install_backup_name "$name" || continue
    printf '%s\n' "$entry"
  done | LC_ALL=C sort -r
}

# Portable apparent-size read, in KiB: -k is the one du flag GNU and BSD du
# agree on, unlike -b (GNU-only) or --apparent-size.
backup_size_kib() {
  du -sk "$1" 2>/dev/null | awk '{ print $1 + 0 }'
}

# Replays one backup manifest: for every recorded target, remove whatever is
# there now and, if the entry was `present` at backup time, copy the backed
# up snapshot back over it. Every item is attempted even after an earlier one
# fails, so one bad item never hides the rest. Sets RESTORE_FAILED_COUNT and
# RESTORE_FAILED_ITEMS for the caller to report; returns success only when
# every item restored cleanly.
restore_backup_manifest() {
  local manifest=$1 items_dir=$2
  local status label target item_failed
  RESTORE_FAILED_COUNT=0
  RESTORE_FAILED_ITEMS=""
  while IFS=$'\t' read -r status label target; do
    [ -n "$target" ] || continue
    item_failed=false
    rm -rf "$target" || item_failed=true
    if [ "$status" = present ]; then
      mkdir -p "$(dirname "$target")" || item_failed=true
      cp -a "$items_dir/$label" "$target" || item_failed=true
    fi
    if [ "$item_failed" = true ]; then
      RESTORE_FAILED_COUNT=$((RESTORE_FAILED_COUNT + 1))
      RESTORE_FAILED_ITEMS="${RESTORE_FAILED_ITEMS}${RESTORE_FAILED_ITEMS:+, }${target}"
    fi
  done < "$manifest"
  [ "$RESTORE_FAILED_COUNT" -eq 0 ]
}
