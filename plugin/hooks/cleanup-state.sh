#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

events_log="${OSO_STATE_DIR}/events.jsonl"

state_armed_by() {
  local session_id="$1" state_file
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$(state_value "$state_file" session)" = "$session_id" ] || continue
    printf '%s' "$state_file"
    return 0
  done
}

remove_worktrees_of() {
  local session_id="$1" state_file="$2" repo_path worktree teardown_event
  [ -n "$session_id" ] || return 0
  local session_worktrees="${OSO_STATE_DIR}/worktrees/${session_id}"
  [ -d "$session_worktrees" ] || return 0
  [ -n "$state_file" ] || return 0
  repo_path="$(state_value "$state_file" repo_path)"
  [ -n "$repo_path" ] || return 0
  for worktree in "$session_worktrees"/*; do
    [ -d "$worktree" ] || continue
    teardown_event=worktree-removed
    git -C "$repo_path" worktree remove "$worktree" 2>/dev/null ||
      teardown_event=worktree-teardown-failed
    log_event "$teardown_event" "$session_id" "$worktree" || true
  done
  if ! git -C "$repo_path" worktree prune 2>/dev/null; then
    log_event worktree-prune-failed "$session_id" "$repo_path" || true
  fi
  rmdir "$session_worktrees" 2>/dev/null || true
}

drop_state_file() {
  local state_file="$1"
  [ -n "$state_file" ] || return 0
  rm -f "$state_file"
  rm -rf "${state_file}.lock"
}

clear_orphaned_pending_of() {
  local real_session_id="$1" state_file owner_session
  [ -n "$real_session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$(state_value "$state_file" plan_approval_session)" = "$real_session_id" ] || continue
    owner_session="$(sanitize_session "$(state_value "$state_file" session)")"
    remove_worktrees_of "$owner_session" "$state_file"
    drop_state_file "$state_file"
  done
}

clear_roadmap_in_flight_of() {
  local session_id="$1" state_file roadmap
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$(state_value "$state_file" session)" = "$session_id" ] || continue
    roadmap="$(state_value "$state_file" roadmap)"
    [ -n "$roadmap" ] && [ "$roadmap" != none ] || continue
    remove_worktrees_of "$session_id" "$state_file"
    drop_state_file "$state_file"
  done
}

rotate_aged_events_log() {
  local retention_days=30
  older_than_days "$events_log" "$retention_days" || return 0
  mv -f "$events_log" "${events_log}.1"
}

prune_abandoned_state() {
  local session_id="$1" own_state="$2" abandoned_days=7 state_file abandoned_id
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$state_file" != "$own_state" ] || continue
    [ ! -e "${state_file}.lock" ] || continue
    older_than_days "$state_file" "$abandoned_days" || continue
    abandoned_id="$(sanitize_session "$(state_value "$state_file" session)")"
    remove_worktrees_of "$abandoned_id" "$state_file"
    rm -f "$state_file"
  done
}

older_than_days() {
  local path="$1" days="$2" age
  age="$(seconds_since_modified "$path")" || return 1
  [ "$age" -ge "$((days * 86400))" ]
}

payload="$(cat)"
session_id="$(hook_session "$payload")"
own_state="$(state_armed_by "$session_id")"
remove_worktrees_of "$session_id" "$own_state"
drop_state_file "$own_state"
clear_orphaned_pending_of "$(sanitize_session "$(json_field "$payload" session_id)")"
clear_roadmap_in_flight_of "$session_id"
rotate_aged_events_log
prune_abandoned_state "$session_id" "$own_state"
exit 0
