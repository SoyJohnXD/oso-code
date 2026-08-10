#!/usr/bin/env bash
# SessionEnd: removes this session's runtime state file and the worktrees its
# parallel waves left behind, then ages out the event log and the state files
# sessions that never reached SessionEnd left behind.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

events_log="${OSO_STATE_DIR}/events.jsonl"

# The state file a session armed, wherever its repository put it. Nothing here
# can compute that name — the file is the repository's and this hook runs in no
# working directory to resolve one from — so the session it recorded is the way
# back to it, found by the sweep the orphan prune below already walks.
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

# A worktree is normally destroyed when its wave integrates, so what reaches here
# is a survivor. Removing the directory is only half a teardown: deleted behind
# git's back it stays registered in .git/worktrees, and the next `git worktree
# add` for that slice fails on a name only git still believes in. The removal is
# never forced, here or in the close that clears the same trees (`/plan` §7):
# what git refuses to remove is uncommitted work in a wave that never
# integrated, and forcing it is the one failure the operator cannot undo — so
# the tree is left standing with that work in it, and because SessionEnd is the
# teardown with nobody left to name it to, the event below is all that says one
# is still owed. Fail-open like the rest of this hook — an absent git, a repo
# that moved, a removal git refuses: none of them may cost the session the state
# cleanup below.
remove_worktrees_of() {
  local session_id="$1" state_file="$2" repo_path worktree teardown_event
  [ -n "$session_id" ] || return 0
  local session_worktrees="${OSO_STATE_DIR}/worktrees/${session_id}"
  [ -d "$session_worktrees" ] || return 0
  # The repo to prune in is in the state file, so this runs before it is dropped.
  # A session that never armed a wave names no repo — and one whose state file
  # the sweep above never found names nothing at all: with nowhere to prune, the
  # directory stays rather than becoming a registration nobody can clear.
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
  # The prune is the half `worktree remove` cannot do: it clears the registration
  # of a worktree whose directory a killed run already took with it. When it is
  # the prune that could not run, the rmdir below still clears the last trace on
  # disk that anything is owed — so the line is all the operator gets.
  if ! git -C "$repo_path" worktree prune 2>/dev/null; then
    log_event worktree-prune-failed "$session_id" "$repo_path" || true
  fi
  # rmdir, never rm -rf: it only succeeds once every worktree under it is gone.
  rmdir "$session_worktrees" 2>/dev/null || true
}

drop_state_file() {
  local state_file="$1"
  [ -n "$state_file" ] || return 0
  # Drop the state and any lock a crashed writer left behind.
  rm -f "$state_file"
  rm -rf "${state_file}.lock"
}

# The sweep above matches `session`, the ownership marker a model-issued write
# under Codex's fixed OSO_AGENT identity can leave pointing at a session other
# than the one that actually presented a still-pending plan — so a pending left
# that way never matches and outlives the session it belongs to. This session's
# REAL payload id is the one identity that write never touches, because only
# capture-plan ever writes plan_approval_session, so a match on that key alone
# says the orphan is this session's own. `oso-state` can set a key but never
# delete one, so a pending is cleared the same way `cancel-plan` already clears
# one: the whole file, not a single line inside it.
#
# That file may be the ownership sweep's own miss, not its catch: `state_armed_by`
# above stops at the first file whose `session` matches, so a repository this
# session also armed under that same shared marker can sit unvisited while this
# loop is the only thing that ever reaches it. Its worktree directory is named
# by `session`, not by the id this function was called with, and repo_path to
# prune it in lives nowhere but the file about to disappear — so the teardown
# has to run on what the file itself still says, right before drop_state_file
# takes the last handle on it with it.
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
  local session_id="$1" own_state="$2" abandoned_days=7 state_file abandoned_id
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    [ "$state_file" != "$own_state" ] || continue
    # A lock means a writer is mid-write, whatever the mtime says.
    [ ! -e "${state_file}.lock" ] || continue
    older_than_days "$state_file" "$abandoned_days" || continue
    abandoned_id="$(sanitize_session "$(state_value "$state_file" session)")"
    remove_worktrees_of "$abandoned_id" "$state_file"
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
