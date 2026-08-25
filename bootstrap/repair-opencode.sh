#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/lib/install-backup.sh" ] || {
  printf '[oso-code] ERROR: install backup library is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/install-backup.sh"
[ -f "$SCRIPT_DIR/lib/opencode-install-backups.sh" ] || {
  printf '[oso-code] ERROR: OpenCode backup identity library is missing\n' >&2
  exit 1
}
. "$SCRIPT_DIR/lib/opencode-install-backups.sh"

info() { printf '[oso-code] %s\n' "$1"; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  [ -z "${XDG_CONFIG_HOME:-}" ] || [ "$XDG_CONFIG_HOME" = "$HOME/.config" ] ||
    usage_error "XDG_CONFIG_HOME ($XDG_CONFIG_HOME) is not the default for HOME ($HOME/.config), so this repair would write outside the home it was pointed at; unset it or point both at the same account"
  BACKUPS_ROOT="$HOME/.local/state/oso-code"
  CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
  command -v python3 >/dev/null 2>&1 ||
    fail "python3 is required to read and merge the OpenCode config"
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

snapshots_holding_a_config() {
  local backup
  opencode_install_backups_newest_first "$BACKUPS_ROOT" | while IFS= read -r backup; do
    [ -f "$backup/items/config" ] || continue
    printf '%s\n' "$backup"
  done
}

list_backups() {
  local listing backup
  listing="$(mktemp "${TMPDIR:-/tmp}/oso-opencode-repair-list.XXXXXX")"
  snapshots_holding_a_config > "$listing"
  if [ ! -s "$listing" ]; then
    info "no install-opencode.sh backup under $BACKUPS_ROOT holds a config to repair from"
    rm -f "$listing"
    return 0
  fi
  while IFS= read -r backup; do
    printf '%s\t%s KiB\n' "${backup##*/}" "$(backup_size_kib "$backup")"
  done < "$listing"
  rm -f "$listing"
}

resolve_snapshot() {
  if [ -n "$BACKUP_NAME" ]; then
    named_snapshot
  else
    newest_snapshot
  fi
  python3 -m json.tool "$SNAPSHOT/items/config" >/dev/null 2>&1 ||
    fail "the config recorded in $SNAPSHOT is not valid JSON, so nothing can be read back from it"
}

named_snapshot() {
  case "$BACKUP_NAME" in
    */*|.|..) fail "backup name must be a bare directory name: $BACKUP_NAME" ;;
  esac
  SNAPSHOT="$BACKUPS_ROOT/$BACKUP_NAME"
  is_opencode_install_backup "$SNAPSHOT" ||
    fail "not an install-opencode.sh backup: $SNAPSHOT"
  [ -f "$SNAPSHOT/items/config" ] ||
    fail "that backup holds no opencode.json to repair from: $SNAPSHOT"
}

newest_snapshot() {
  local listing
  listing="$(mktemp "${TMPDIR:-/tmp}/oso-opencode-repair-latest.XXXXXX")"
  snapshots_holding_a_config > "$listing"
  SNAPSHOT="$(awk 'NR == 1 { print; exit }' "$listing")"
  rm -f "$listing"
  [ -n "$SNAPSHOT" ] ||
    fail "no install-opencode.sh backup under $BACKUPS_ROOT holds a config to repair from"
}

missing_operator_keys() {
  python3 - "$SNAPSHOT/items/config" "$CONFIG_FILE" <<'PY'
import json
import sys

snapshot_path, live_path = sys.argv[1:3]

NESTED_PATHS = (("permission",), ("permission", "skill"), ("permission", "task"), ("mcp",))


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def at(document, path):
    for name in path:
        document = document.get(name)
        if not isinstance(document, dict):
            return {}
    return document


snapshot = load(snapshot_path)
live = load(live_path)
if not isinstance(snapshot, dict) or not isinstance(live, dict):
    raise SystemExit("both the snapshot and the live opencode.json must be JSON objects")

for path in ((),) + NESTED_PATHS:
    recorded = at(snapshot, path) if path else snapshot
    present = at(live, path) if path else live
    for name, value in recorded.items():
        if name in present:
            continue
        if any(path + (name,) == nested for nested in NESTED_PATHS):
            continue
        print("\t".join([".".join(path + (name,)), json.dumps(value)]))
PY
}

restore_missing_keys() {
  local missing=$1 repaired
  repaired="$(mktemp "$(dirname "$CONFIG_FILE")/.config.repaired.XXXXXX")"
  python3 - "$CONFIG_FILE" "$missing" "$repaired" <<'PY'
import json
import sys

live_path, missing_path, repaired_path = sys.argv[1:4]

with open(live_path, encoding="utf-8") as handle:
    live = json.load(handle)

with open(missing_path, encoding="utf-8") as handle:
    for line in handle:
        line = line.rstrip("\n")
        if not line:
            continue
        key_path, encoded = line.split("\t", 1)
        names = key_path.split(".")
        target = live
        for name in names[:-1]:
            target = target.setdefault(name, {})
        target[names[-1]] = json.loads(encoded)

with open(repaired_path, "w", encoding="utf-8") as handle:
    json.dump(live, handle, indent=2)
    handle.write("\n")
PY
  python3 -m json.tool "$repaired" >/dev/null ||
    fail "the repaired OpenCode config is not valid JSON; $CONFIG_FILE is unchanged"
  chmod 600 "$repaired"
  mv "$repaired" "$CONFIG_FILE"
}

confirm_repair() {
  local answer
  [ "$ASSUME_YES" = true ] && return 0
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) fail "aborted by user" ;; esac
}

main() {
  local missing key value
  initialize_paths
  parse_args "$@"
  if [ "$LIST_ONLY" = true ]; then
    list_backups
    return 0
  fi
  [ -f "$CONFIG_FILE" ] || fail "there is no OpenCode config to repair at $CONFIG_FILE"
  python3 -m json.tool "$CONFIG_FILE" >/dev/null 2>&1 ||
    fail "the live OpenCode config is not valid JSON: $CONFIG_FILE"
  resolve_snapshot
  missing="$(mktemp "${TMPDIR:-/tmp}/oso-opencode-repair-keys.XXXXXX")"
  missing_operator_keys > "$missing"
  if [ ! -s "$missing" ]; then
    info "nothing to repair: $CONFIG_FILE already holds every key ${SNAPSHOT##*/} recorded"
    rm -f "$missing"
    return 0
  fi
  info "these keys are in ${SNAPSHOT##*/} and missing from $CONFIG_FILE:"
  while IFS=$'\t' read -r key value; do
    printf '  %s = %s\n' "$key" "$value"
  done < "$missing"
  confirm_repair
  restore_missing_keys "$missing"
  info "returned $(wc -l < "$missing" | tr -d ' ') key(s) to $CONFIG_FILE"
  rm -f "$missing"
  info "restart OpenCode to load the repaired config"
}

main "$@"
