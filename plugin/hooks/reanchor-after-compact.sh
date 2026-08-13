#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

run_is_unattended() {
  [ "$(state_value "$1" auto)" = running ]
}

slice_is_armed() {
  local state_file="$1" active_slice
  [ "$(state_value "$state_file" mode)" = plan ] || return 1
  active_slice="$(state_value "$state_file" active_slice)"
  [ -n "$active_slice" ] && [ "$active_slice" != none ]
}

re_anchor_context() {
  local journal_file="$1" unattended_run="$2" context
  context='oso-code: this session was compacted while a run was in flight — the window that held the position is gone, the run is not. Re-read the position before the next action, from what outlives a compaction:'
  context="$context
- the change position: mem_search oso/index, then mem_get_observation on the row it returns, and read its NEXT: line."
  context="$context
- the run flags: oso-state show (mode, active_slice, verify_green, auto)."
  if [ -n "$journal_file" ]; then
    context="$context
- the milestones already landed: the run journal at ${journal_file}."
  fi
  context="$context
Every milestone from here on is still appended with oso-state journal."
  if [ "$unattended_run" = true ]; then
    context="$context
This run is unattended and still in flight: continue it now rather than waiting, and park it per the rules of its own flow if a decision needs the operator."
  fi
  printf '%s' "$context"
}

payload="$(cat)"
[ "$(json_field "$payload" source)" = compact ] || exit 0

session_id="$(hook_session "$payload")"
[ -n "$session_id" ] || exit 0

project_dir="$(json_field "$payload" cwd)"
[ -d "$project_dir" ] || exit 0

state_file="$(state_file_for "$project_dir" 2>/dev/null)" || exit 0
[ -f "$state_file" ] && [ -r "$state_file" ] || exit 0
[ "$(state_value "$state_file" session)" = "$session_id" ] || exit 0

unattended_run=false
if run_is_unattended "$state_file"; then
  unattended_run=true
elif ! slice_is_armed "$state_file"; then
  exit 0
fi

journal_file="$(journal_file_for "$project_dir" 2>/dev/null || true)"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "$(json_escape "$(re_anchor_context "$journal_file" "$unattended_run")")"
exit 0
