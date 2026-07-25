#!/usr/bin/env bash
# SessionEnd: removes this session's runtime state file, then ages out the event
# log and the state files sessions that never reached SessionEnd left behind.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

events_log="${OSO_STATE_DIR}/events.jsonl"

drop_session_state() {
  local session_id="$1"
  [ -n "$session_id" ] || return 0
  local state_file="${OSO_STATE_DIR}/${session_id}.state"
  # Drop the state and any lock a crashed writer left behind.
  rm -f "$state_file"
  rm -rf "${state_file}.lock"
}

# Renaming is atomic, so an append racing this rotation lands whole in one file
# or the other. Filtering the log in place would instead drop every line written
# between the read and the swap, and a lost line is a deny nobody can audit.
rotate_aged_events_log() {
  local retention_days=30
  older_than_days "$events_log" "$retention_days" || return 0
  mv -f "$events_log" "${events_log}.1"
}

# A live session touches its state file only at slice boundaries, so a long
# slice or an overnight run looks abandoned. Deleting a live file disarms both
# gates for that session invisibly; keeping a dead one costs a line of startup
# noise — so every doubt (unknown session, held lock, unreadable age) keeps.
prune_abandoned_state() {
  local session_id="$1" abandoned_days=7 state_file
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    case "$state_file" in "$OSO_STATE_DIR/${session_id}.state") continue ;; esac
    # A lock means a writer is mid-write, whatever the mtime says.
    [ ! -e "${state_file}.lock" ] || continue
    older_than_days "$state_file" "$abandoned_days" || continue
    rm -f "$state_file"
  done
}

# An age nobody can read answers "not old enough", so the unreadable file is
# never the one that gets deleted.
older_than_days() {
  local path="$1" days="$2" age
  age="$(seconds_since_modified "$path")" || return 1
  [ "$age" -ge "$((days * 86400))" ]
}

session_id="$(sanitize_session "$(json_field "$(cat)" session_id)")"
drop_session_state "$session_id"
rotate_aged_events_log
prune_abandoned_state "$session_id"
exit 0
