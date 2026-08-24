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
# install-codex.sh and install-opencode.sh share ONE root, so the name shape
# alone never tells their snapshots apart. install_backup_declares is what
# does: a snapshot carries the format marker its own installer wrote, or --
# for snapshots older than that marker -- a manifest label only that installer
# records. Every caller that restores, lists or PRUNES filters through it
# first, because a retention pass that enumerated the shared root would delete
# the other host's snapshots on a budget it never spent.
#
# Sourced, not executed: functions only, no side effects at source time.

is_install_backup_name() {
  case "$1" in
    install-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) return 0 ;;
    *) return 1 ;;
  esac
}

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

backup_size_kib() {
  du -sk "$1" 2>/dev/null | awk '{ print $1 + 0 }'
}

install_backup_budget_kib() {
  printf '%s' "${OSO_INSTALL_BACKUP_BUDGET_KIB:-307200}"
}

install_backup_declares() {
  local backup=$1 format=$2 label_only_this_installer_records=$3
  [ -d "$backup" ] && [ ! -L "$backup" ] || return 1
  if [ "$(head -1 "$backup/format" 2>/dev/null)" = "$format" ]; then
    return 0
  fi
  [ -f "$backup/manifest" ] || return 1
  awk -F'\t' -v label="$label_only_this_installer_records" \
    '$2 == label { found = 1 } END { exit !found }' "$backup/manifest"
}

install_backups_declaring() {
  local root=$1 format=$2 label_only_this_installer_records=$3 backup
  install_backup_dirs_newest_first "$root" | while IFS= read -r backup; do
    install_backup_declares "$backup" "$format" "$label_only_this_installer_records" || continue
    printf '%s\n' "$backup"
  done
}

install_backups_over_budget() {
  local backup budget_kib running_kib=0 size_kib kept=0
  budget_kib="$(install_backup_budget_kib)"
  while IFS= read -r backup; do
    [ -n "$backup" ] || continue
    size_kib="$(backup_size_kib "$backup")"
    if [ "$kept" -eq 0 ] || [ "$((running_kib + size_kib))" -le "$budget_kib" ]; then
      running_kib=$((running_kib + size_kib))
      kept=$((kept + 1))
      continue
    fi
    printf '%s\n' "$backup"
  done
}

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
