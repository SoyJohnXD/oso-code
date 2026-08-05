#!/usr/bin/env bash
# Stop: bind the exact plan document Codex just presented to a pending approval.
# The marker is emitted only by oso-code's plan rail, so ordinary Stop events
# remain completely invisible even though this user-level hook sees them too.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

PLAN_MARKER='<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'

finish_hook() {
  printf '{}\n'
  exit 0
}

stop_block() {
  local reason="$1" event="$2" session="$3" detail="${4:-}"
  if [ "${stop_hook_active:-false}" = true ]; then
    printf '{"continue":false,"stopReason":"%s","systemMessage":"%s"}\n' \
      "$(json_escape "$reason")" "$(json_escape "$reason")"
  else
    printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$reason")"
  fi
  log_event "$event" "$session" "$detail" || true
  exit 0
}

sha256_text() {
  local value="$1" digest
  digest="$(printf '%s' "$value" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || digest=""
  digest="${digest%% *}"
  [ -n "$digest" ] || return 1
  printf '%s' "$digest"
}

payload="$(cat)"
json_take_escaped_field "$payload" last_assistant_message
raw_message="$escaped"
message="$(json_field "$payload" last_assistant_message)"
last_line="${message##*$'\n'}"

# A normal Codex response has no private oso-code marker. Do not inspect the
# repository or session before this return: invisibility includes no event,
# state directory, stderr, or incidental git lookup. Only the reserved prefix
# on the final decoded line identifies a harness presentation; prose that merely
# mentions the protocol earlier is still an ordinary response.
case "$last_line" in
  '<!-- oso-plan-approval:'*) ;;
  *) finish_hook ;;
esac

# A blocked Stop is invoked once more with this boolean set. Blocking it again
# would create an infinite correction loop, so the second failure uses Codex's
# common stop output and ends cleanly with the same reason.
stop_hook_active=false
stop_active_pattern='"stop_hook_active"[[:space:]]*:[[:space:]]*(true|false)'
if [[ "$payload" =~ $stop_active_pattern ]]; then
  stop_hook_active="${BASH_REMATCH[1]}"
fi

raw_session_id="$(json_field "$payload" session_id)"
session_id="$(sanitize_session "$raw_session_id")"
cwd="$(json_field "$payload" cwd)"
resolve_codex_turn_mode "$payload"
native_mode="$CODEX_TURN_MODE"

[ -n "$session_id" ] ||
  stop_block 'oso-code: the plan approval marker arrived without a usable session id.' \
    plan-approval-capture-blocked ""
[ -n "$raw_session_id" ] && [ "$session_id" = "$raw_session_id" ] ||
  stop_block 'oso-code: the plan approval marker arrived with an invalid session id.' \
    plan-approval-capture-blocked "$session_id"
[ -d "$cwd" ] ||
  stop_block 'oso-code: the plan approval marker arrived without a readable working directory.' \
    plan-approval-capture-blocked "$session_id"
[ "$native_mode" = plan ] ||
  stop_block 'oso-code: the approval document must be presented while Codex is still in Plan Mode.' \
    plan-approval-capture-blocked "$session_id"

marker_lines="$(printf '%s\n' "$message" | grep -c '^<!-- oso-plan-approval:' || true)"
exact_lines="$(printf '%s\n' "$message" | grep -cxF "$PLAN_MARKER" || true)"
# Codex may serialize one host-owned terminal LF after the assistant's final
# logical line. Accept that one transport suffix without normalizing the bytes:
# the digest below still binds the exact raw field that Stop delivered.
raw_marker_is_terminal=false
case "$raw_message" in
  *"$PLAN_MARKER"|*"$PLAN_MARKER\\n") raw_marker_is_terminal=true ;;
esac
if [ "$raw_marker_is_terminal" != true ] || [ "$marker_lines" -ne 1 ] ||
   [ "$exact_lines" -ne 1 ]; then
  stop_block \
    'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
    plan-approval-capture-blocked "$session_id"
fi

turn_id="$(json_field "$payload" turn_id)"
digest_input="$raw_message"
if [ "$message" = "$PLAN_MARKER" ]; then
  transcript_path="$(json_field "$payload" transcript_path)"
  [ "$CODEX_TURN_MODE_SOURCE" = transcript ] && [ -n "$turn_id" ] &&
    [ -n "$transcript_path" ] ||
    stop_block \
      'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
      plan-approval-capture-blocked "$session_id"
  plan_item="$(
    grep -F '"type":"event_msg"' "$transcript_path" 2>/dev/null |
      grep -F '"type":"item_completed"' |
      grep -F "\"turn_id\":\"${turn_id}\"" |
      grep -F '"item":{"type":"Plan"' || true
  )"
  case "$plan_item" in
    ''|*$'\n'*)
      stop_block \
        'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
        plan-approval-capture-blocked "$session_id" ;;
  esac
  [ "$(json_field "$plan_item" turn_id)" = "$turn_id" ] &&
    [ "$(json_field "$plan_item" thread_id)" = "$raw_session_id" ] ||
    stop_block \
      'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
      plan-approval-capture-blocked "$session_id"
  json_take_escaped_field "$plan_item" text
  raw_plan_document="$escaped"
  plan_document="$(json_unescape "$raw_plan_document")"
  [ -n "$plan_document" ] ||
    stop_block \
      'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
      plan-approval-capture-blocked "$session_id"
  plan_marker_lines="$(printf '%s\n' "$plan_document" | grep -c '^<!-- oso-plan-approval:' || true)"
  [ "$plan_marker_lines" -eq 0 ] ||
    stop_block \
      'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
      plan-approval-capture-blocked "$session_id"
  digest_input="${raw_plan_document}\\n${raw_message}"
else
  plan_document="${message%$'\n'$PLAN_MARKER}"
fi

digest="$(sha256_text "$digest_input")" ||
  stop_block 'oso-code: no SHA-256 implementation is available to bind this approval document.' \
    plan-approval-capture-blocked "$session_id"
state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
# The operator reads the same generic sentence whatever went wrong, so a
# discarded stderr is a cause nobody can recover afterwards; the audit line is
# where it survives without reaching the transcript or this hook's own stderr.
if ! capture_error="$(printf '%s' "$plan_document" |
  (cd "$cwd" && "$state_bin" --session "$session_id" capture-plan "$digest") 2>&1 >/dev/null)"; then
  stop_block 'oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.' \
    plan-approval-capture-blocked "$session_id" "$capture_error"
fi
log_event plan-approval-pending "$session_id" || true
finish_hook
