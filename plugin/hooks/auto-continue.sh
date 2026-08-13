#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

PUSHES_WITHOUT_PROGRESS_CAP=3
CONTINUATION_ORDER="oso-code: this run is unattended and still in flight, and this turn ended without parking or closing it. Continue it: re-read the position from the change's oso/index NEXT: line and from active_slice in oso-state, append every milestone to the run journal with oso-state journal, and park the run per the flow's own rules if a decision needs the operator."
CAP_MILESTONE="auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress — allowing the stop"

allow_stop() {
  printf '{}\n'
  exit 0
}

allow_stop_degraded() {
  local session="$1" cause="$2"
  log_event auto-continue-degraded "$session" "$cause" "${0##*/}" Stop || true
  allow_stop
}

push_continuation() {
  local session="$1"
  printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$CONTINUATION_ORDER")"
  log_event auto-continued "$session" "" "${0##*/}" Stop || true
  exit 0
}

announce_cap() {
  local session="$1" project_dir="$2" state_bin journal_error
  state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
  if ! journal_error="$(cd "$project_dir" && "$state_bin" journal "$CAP_MILESTONE" 2>&1 >/dev/null)"; then
    log_event auto-continue-unjournaled "$session" "$journal_error" "${0##*/}" Stop || true
  fi
}

is_count() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
}

journal_bytes_in() {
  local journal_file="$1" size
  [ -f "$journal_file" ] || { printf 0; return 0; }
  size="$(wc -c 2>/dev/null < "$journal_file" | tr -dc '0-9')"
  is_count "$size" || size=0
  printf '%s' "$size"
}

remember_push_or_allow_stop() {
  local tally_file="$1" pushes="$2" journal_bytes="$3" session="$4" write_error
  write_error="$( {
    umask 077
    mkdir -p "${tally_file%/*}" &&
      printf 'pushes=%s\njournal_bytes=%s\n' "$pushes" "$journal_bytes" > "$tally_file"
  } 2>&1 )" || allow_stop_degraded "$session" "$write_error"
}

payload="$(cat)"
session_id="$(hook_session "$payload")"
[ -n "$session_id" ] || allow_stop

project_dir="$(json_field "$payload" cwd)"
[ -d "$project_dir" ] || allow_stop

state_file="$(state_file_for "$project_dir" 2>/dev/null)" || allow_stop
[ "$(unattended_run_marker "$state_file" "$session_id")" = running ] || allow_stop

journal_file="$(journal_file_for "$project_dir" 2>/dev/null)" ||
  allow_stop_degraded "$session_id" "the run journal path is unresolvable"
push_tally_file="${journal_file%.log}.pushes"
journal_bytes="$(journal_bytes_in "$journal_file")"

turn_already_continued=false
already_continued_pattern='"stop_hook_active"[[:space:]]*:[[:space:]]*true'
if [[ "$payload" =~ $already_continued_pattern ]]; then
  turn_already_continued=true
fi

pushes_without_progress=0
if [ "$turn_already_continued" = true ]; then
  pushes_without_progress=1
fi
if [ -e "$push_tally_file" ]; then
  [ -f "$push_tally_file" ] && [ -r "$push_tally_file" ] ||
    allow_stop_degraded "$session_id" "the push tally is not a readable file"
  remembered_pushes="$(state_value "$push_tally_file" pushes)"
  journal_bytes_at_last_push="$(state_value "$push_tally_file" journal_bytes)"
  is_count "$remembered_pushes" ||
    allow_stop_degraded "$session_id" "the push tally holds no count of pushes: $remembered_pushes"
  is_count "$journal_bytes_at_last_push" ||
    allow_stop_degraded "$session_id" "the push tally holds no count of journal bytes: $journal_bytes_at_last_push"
  if [ "$journal_bytes" -gt "$journal_bytes_at_last_push" ]; then
    pushes_without_progress=0
  else
    pushes_without_progress="$remembered_pushes"
  fi
fi
pushes_without_progress=$((pushes_without_progress + 1))

if [ "$pushes_without_progress" -gt "$PUSHES_WITHOUT_PROGRESS_CAP" ]; then
  if [ "$pushes_without_progress" -eq "$((PUSHES_WITHOUT_PROGRESS_CAP + 1))" ]; then
    announce_cap "$session_id" "$project_dir"
  fi
  remember_push_or_allow_stop "$push_tally_file" "$pushes_without_progress" \
    "$(journal_bytes_in "$journal_file")" "$session_id"
  allow_stop
fi

remember_push_or_allow_stop "$push_tally_file" "$pushes_without_progress" "$journal_bytes" "$session_id"
push_continuation "$session_id"
