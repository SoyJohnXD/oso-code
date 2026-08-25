# Which of the `install-backup-*` snapshots under ~/.local/state/oso-code came
# from install-codex.sh rather than install-opencode.sh, which writes its own
# into the same root under the same name shape. The mirror of
# opencode-install-backups.sh, and the reason restore-codex.sh can no longer
# replay an OpenCode snapshot over a Codex install: this release stamps a
# format marker, and snapshots written before it are recognized by
# `marketplace`, a manifest label only the Codex transaction records.
# Sourced, not executed: functions only.

CODEX_INSTALL_BACKUP_FORMAT=oso-code-codex-install-v1
CODEX_INSTALL_BACKUP_LABEL=marketplace

is_codex_install_backup() {
  install_backup_declares "$1" "$CODEX_INSTALL_BACKUP_FORMAT" "$CODEX_INSTALL_BACKUP_LABEL"
}

codex_install_backups_newest_first() {
  install_backups_declaring "$1" "$CODEX_INSTALL_BACKUP_FORMAT" "$CODEX_INSTALL_BACKUP_LABEL"
}
