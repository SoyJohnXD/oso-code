# Shared backup-manifest replay, inventory and retention bound for the
# `install-backup-*` snapshots both installers leave under ~/.local/state/oso-code.
#
# Three independent callers read this: install-codex.sh's in-run
# rollback_transaction (restores the CURRENT run's own backup the moment a
# step fails), the standalone bootstrap/restore-codex.sh (restores an
# OLDER backup, any time later, at the operator's request), and install.sh,
# which takes no manifest and reads only the inventory and the bound. The
# first two must read the same manifest the same way -- one format, one
# replay -- so a mid-run rollback and a later operator-invoked restore can
# never drift into two readings of the same backup; all three must bound
# disk the same way, or "300 MiB" means something different per installer.
#
# Each installer hands in a ROOT of its own and the glob below never
# recurses, so one library reads two snapshot sets without either side ever
# being offered the other's: only install-codex.sh's snapshots carry the
# manifest restore-codex.sh replays.
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

# The one place the retention budget is written down, for every installer that
# has one. 300 MiB (D14, ADR-0124): the measured problem was 1.9 GiB across 17
# snapshots and a single Codex snapshot already runs to ~110 MiB, so bounding
# "the last N" would leave size free to grow with whatever a future release's
# transaction happens to back up. Bounding size keeps roughly 2-3 recent Codex
# snapshots -- a real fallback depth, not just the last one -- while cutting
# that measured worst case by over 80%. The override is what lets a test hand
# in a budget nothing can fit.
install_backup_budget_kib() {
  printf '%s' "${OSO_INSTALL_BACKUP_BUDGET_KIB:-307200}"
}

# The backups under $1 that do not fit that budget, one absolute path per line
# in the same newest-first order: this decides WHICH snapshots are surplus, and
# the caller deletes them and reports the removal in its own voice, since the
# two installers say it differently and neither's wording belongs here.
# The newest is never named however small the budget is -- the run that just
# installed is never the one a tight budget empties.
install_backups_over_budget() {
  local root=$1 listing backup budget_kib running_kib=0 size_kib kept=0
  budget_kib="$(install_backup_budget_kib)"
  listing="$(mktemp "${TMPDIR:-/tmp}/oso-install-backups.XXXXXX")" || return 0
  install_backup_dirs_newest_first "$root" > "$listing"
  while IFS= read -r backup; do
    [ -n "$backup" ] || continue
    size_kib="$(backup_size_kib "$backup")"
    if [ "$kept" -eq 0 ] || [ "$((running_kib + size_kib))" -le "$budget_kib" ]; then
      running_kib=$((running_kib + size_kib))
      kept=$((kept + 1))
      continue
    fi
    printf '%s\n' "$backup"
  done < "$listing"
  rm -f "$listing"
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
