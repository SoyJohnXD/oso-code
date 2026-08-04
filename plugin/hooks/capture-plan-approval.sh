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
  local reason="$1" event="$2" session="$3"
  if [ "${stop_hook_active:-false}" = true ]; then
    printf '{"continue":false,"stopReason":"%s","systemMessage":"%s"}\n' \
      "$(json_escape "$reason")" "$(json_escape "$reason")"
  else
    printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$reason")"
  fi
  log_event "$event" "$session" || true
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
permission_mode="$(json_field "$payload" permission_mode)"

[ -n "$session_id" ] ||
  stop_block 'oso-code: the plan approval marker arrived without a usable session id.' \
    plan-approval-capture-blocked ""
[ -n "$raw_session_id" ] && [ "$session_id" = "$raw_session_id" ] ||
  stop_block 'oso-code: the plan approval marker arrived with an invalid session id.' \
    plan-approval-capture-blocked "$session_id"
[ -d "$cwd" ] ||
  stop_block 'oso-code: the plan approval marker arrived without a readable working directory.' \
    plan-approval-capture-blocked "$session_id"
[ "$permission_mode" = plan ] ||
  stop_block 'oso-code: the approval document must be presented while Codex is still in Plan Mode.' \
    plan-approval-capture-blocked "$session_id"

marker_lines="$(printf '%s\n' "$message" | grep -c '^<!-- oso-plan-approval:' || true)"
exact_lines="$(printf '%s\n' "$message" | grep -cxF "$PLAN_MARKER" || true)"
raw_marker_is_final=false
case "$raw_message" in *"$PLAN_MARKER") raw_marker_is_final=true ;; esac
if [ "$raw_marker_is_final" != true ] || [ "$marker_lines" -ne 1 ] ||
   [ "$exact_lines" -ne 1 ] || [ "$message" = "$PLAN_MARKER" ]; then
  stop_block \
    'oso-code: malformed plan approval marker; emit it exactly once as the final line of a non-empty plan document.' \
    plan-approval-capture-blocked "$session_id"
fi

digest="$(sha256_text "$raw_message")" ||
  stop_block 'oso-code: no SHA-256 implementation is available to bind this approval document.' \
    plan-approval-capture-blocked "$session_id"
state_bin="${OSO_STATE_BIN:-oso-state}"
plan_document="${message%$'\n'$PLAN_MARKER}"
if ! printf '%s' "$plan_document" | (cd "$cwd" && "$state_bin" --session "$session_id" \
  capture-plan "$digest" >/dev/null 2>&1); then
  stop_block 'oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.' \
    plan-approval-capture-blocked "$session_id"
fi

log_event plan-approval-pending "$session_id" || true
finish_hook
