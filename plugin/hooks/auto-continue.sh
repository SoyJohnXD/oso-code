#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

PUSHES_WITHOUT_PROGRESS_CAP=3
DELEGATION_WAIT_CEILING_MINUTES=45
DELEGATION_WAIT_CEILING_SECONDS=$((DELEGATION_WAIT_CEILING_MINUTES * 60))
DELEGATION_LABEL_PATTERN='^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'
CONTINUATION_ORDER="oso-code: this run is unattended and still in flight, and this turn ended without parking or closing it. Continue it: re-read the position from the change's oso/index NEXT: line and from active_slice in oso-state, append every milestone to the run journal with oso-state journal, and park the run per the flow's own rules if a decision needs the operator. If a delegation is still in flight, do NOT relaunch it — its completion notification is what resumes the run, so wait for that instead."
EXPIRED_DELEGATION_ORDER="${CONTINUATION_ORDER} A delegation is marked in flight and that mark is older than ${DELEGATION_WAIT_CEILING_MINUTES} minutes, so treat it as lost unless its completion notification still arrives."
CAP_MILESTONE="auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes without progress — allowing the stop"
EXPIRED_DELEGATION_CAP_MILESTONE="auto-continue: cap reached after ${PUSHES_WITHOUT_PROGRESS_CAP} pushes with a delegation marked in flight past ${DELEGATION_WAIT_CEILING_MINUTES} minutes — allowing the stop"

allow_stop() {
  printf '{}\n'
  exit 0
}

allow_stop_degraded() {
  local session="$1" cause="$2"
  log_event auto-continue-degraded "$session" "$cause" "${0##*/}" Stop || true
  allow_stop
}

hold_for_delegation() {
  local session="$1" label="$2"
  log_event auto-continue-held "$session" "$label" "${0##*/}" Stop || true
  allow_stop
}

push_continuation() {
  local session="$1" order="$2"
  printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$order")"
  log_event auto-continued "$session" "" "${0##*/}" Stop || true
  exit 0
}

announce_cap() {
  local session="$1" project_dir="$2" milestone="$3" state_bin journal_error
  state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
  if ! journal_error="$(cd "$project_dir" && "$state_bin" journal "$milestone" 2>&1 >/dev/null)"; then
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

is_delegation_label() {
  local label="$1"
  case "$label" in none) return 1 ;; esac
  [[ "$label" =~ $DELEGATION_LABEL_PATTERN ]]
}

this_run_already_sighted() {
  local wait_file="$1" label="$2" session="$3"
  [ "$(state_value "$wait_file" label)" = "$label" ] &&
    [ "$(state_value "$wait_file" session)" = "$session" ]
}

write_private_or_allow_stop() {
  local file="$1" content="$2" session="$3" write_error
  write_error="$( {
    umask 077
    mkdir -p "${file%/*}" && printf '%s' "$content" > "$file"
  } 2>&1 )" || allow_stop_degraded "$session" "$write_error"
}

remember_sighting_or_allow_stop() {
  local wait_file="$1" label="$2" session="$3" sighting
  printf -v sighting 'label=%s\nsession=%s\n' "$label" "$session"
  write_private_or_allow_stop "$wait_file" "$sighting" "$session"
}

forget_sighting_and_allow_stop() {
  local project_dir="$1" journal_file
  if journal_file="$(journal_file_for "$project_dir" 2>/dev/null)"; then
    rm -f "${journal_file%.log}.waiting" 2>/dev/null || true
  fi
  allow_stop
}

remember_push_or_allow_stop() {
  local tally_file="$1" pushes="$2" journal_bytes="$3" session="$4" tally
  printf -v tally 'pushes=%s\njournal_bytes=%s\n' "$pushes" "$journal_bytes"
  write_private_or_allow_stop "$tally_file" "$tally" "$session"
}

payload="$(cat)"
session_id="$(hook_session "$payload")"
[ -n "$session_id" ] || allow_stop

project_dir="$(json_field "$payload" cwd)"
[ -d "$project_dir" ] || allow_stop

state_file="$(state_file_for "$project_dir" 2>/dev/null)" || allow_stop
run_marker="$(unattended_run_marker "$state_file" "$session_id")" || allow_stop
[ "$run_marker" = running ] || forget_sighting_and_allow_stop "$project_dir"

journal_file="$(journal_file_for "$project_dir" 2>/dev/null)" ||
  allow_stop_degraded "$session_id" "the run journal path is unresolvable"
push_tally_file="${journal_file%.log}.pushes"
wait_file="${journal_file%.log}.waiting"
journal_bytes="$(journal_bytes_in "$journal_file")"

continuation_order="$CONTINUATION_ORDER"
cap_milestone="$CAP_MILESTONE"
delegation_label="$(state_value "$state_file" auto_wait)"
if is_delegation_label "$delegation_label"; then
  if ! this_run_already_sighted "$wait_file" "$delegation_label" "$session_id"; then
    remember_sighting_or_allow_stop "$wait_file" "$delegation_label" "$session_id"
    hold_for_delegation "$session_id" "$delegation_label"
  fi
  if ! seconds_waited="$(seconds_since_modified "$wait_file")" || ! is_count "$seconds_waited"; then
    log_event auto-continue-degraded "$session_id" \
      "the delegation mark has no readable age: $delegation_label" "${0##*/}" Stop || true
    hold_for_delegation "$session_id" "$delegation_label"
  fi
  [ "$seconds_waited" -ge "$DELEGATION_WAIT_CEILING_SECONDS" ] ||
    hold_for_delegation "$session_id" "$delegation_label"
  continuation_order="$EXPIRED_DELEGATION_ORDER"
  cap_milestone="$EXPIRED_DELEGATION_CAP_MILESTONE"
else
  rm -f "$wait_file" 2>/dev/null || true
fi

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
    announce_cap "$session_id" "$project_dir" "$cap_milestone"
  fi
  remember_push_or_allow_stop "$push_tally_file" "$pushes_without_progress" \
    "$(journal_bytes_in "$journal_file")" "$session_id"
  allow_stop
fi

remember_push_or_allow_stop "$push_tally_file" "$pushes_without_progress" "$journal_bytes" "$session_id"
push_continuation "$session_id" "$continuation_order"
