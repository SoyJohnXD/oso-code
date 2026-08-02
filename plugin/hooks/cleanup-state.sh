#!/usr/bin/env bash
# SessionEnd: removes this session's runtime state file and the worktrees its
# parallel waves left behind, then ages out the event log and the state files
# sessions that never reached SessionEnd left behind.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

events_log="${OSO_STATE_DIR}/events.jsonl"
# The state file's key=value format is oso-state's to know, so the repo a
# teardown prunes in is read through it rather than re-parsed here. The client
# injects <plugin>/bin into the Bash tool's PATH and never into a hook's own
# environment (see persist-state-bin.sh), so the reader is reached where it
# ships: beside the hooks.
oso_state="$(dirname "$HOOK_DIR")/bin/oso-state"

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
  local session_id="$1" repo_path worktree teardown_event
  [ -n "$session_id" ] || return 0
  local session_worktrees="${OSO_STATE_DIR}/worktrees/${session_id}"
  [ -d "$session_worktrees" ] || return 0
  # The repo to prune in is in the state file, so this runs before it is dropped.
  # `get` exits 0 for a session that named no repo and answers empty, so a
  # non-zero exit is only ever the reader itself being unrunnable — a partial
  # install rather than a session with nothing to prune. The two owe the operator
  # different answers, and bash writes its own about the first to a stderr no
  # audit reads.
  if ! repo_path="$("$oso_state" --session "$session_id" get repo_path 2>/dev/null)"; then
    log_event oso-state-unreachable "$session_id" "$oso_state" || true
    return 0
  fi
  # A session that never armed a wave names no repo: with nowhere to prune, the
  # directory stays rather than becoming a registration nobody can clear.
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
  local session_id="$1" abandoned_days=7 state_file abandoned_id
  [ -n "$session_id" ] || return 0
  for state_file in "$OSO_STATE_DIR"/*.state; do
    [ -f "$state_file" ] || continue
    case "$state_file" in "$OSO_STATE_DIR/${session_id}.state") continue ;; esac
    # A lock means a writer is mid-write, whatever the mtime says.
    [ ! -e "${state_file}.lock" ] || continue
    older_than_days "$state_file" "$abandoned_days" || continue
    abandoned_id="$(sanitize_session "$(basename "$state_file" .state)")"
    remove_worktrees_of "$abandoned_id"
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
remove_worktrees_of "$session_id"
drop_session_state "$session_id"
rotate_aged_events_log
prune_abandoned_state "$session_id"
exit 0
