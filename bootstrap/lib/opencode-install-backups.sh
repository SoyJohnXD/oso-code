# Which of the `install-backup-*` snapshots under ~/.local/state/oso-code came
# from install-opencode.sh rather than install-codex.sh, which writes its own
# into the same root under the same name shape. This release stamps a format
# marker; snapshots written before it are recognized by a manifest label only
# the OpenCode transaction records, which is what keeps an operator's older
# snapshots reachable. Sourced, not executed: functions only.

OPENCODE_INSTALL_BACKUP_FORMAT=oso-code-opencode-install-v1
OPENCODE_INSTALL_BACKUP_LABEL=commands

is_opencode_install_backup() {
  install_backup_declares "$1" "$OPENCODE_INSTALL_BACKUP_FORMAT" "$OPENCODE_INSTALL_BACKUP_LABEL"
}

opencode_install_backups_newest_first() {
  install_backups_declaring "$1" "$OPENCODE_INSTALL_BACKUP_FORMAT" "$OPENCODE_INSTALL_BACKUP_LABEL"
}
