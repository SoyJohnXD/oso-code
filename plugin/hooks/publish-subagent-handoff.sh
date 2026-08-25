#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

finish_hook() {
  printf '{}\n'
  exit 0
}

publish_failed() {
  local reason="$1" session="$2" agent_type="$3"
  printf 'oso-code: SubagentStop could not publish its handoff: %s\n' "$reason" >&2
  log_event handoff-publish-failed "$session" "$agent_type" || true
  finish_hook
}

payload="$(cat)"
message="$(json_field "$payload" last_assistant_message)"
marker_count="$(printf '%s\n' "$message" | grep -c '^oso-handoff:' || true)"

[ "$marker_count" -gt 0 ] || finish_hook

session_id="$(hook_session "$payload")"
cwd="$(json_field "$payload" cwd)"
agent_id="$(json_field "$payload" agent_id)"
agent_type="$(json_field "$payload" agent_type)"

[ -n "$session_id" ] || publish_failed "missing session_id" "" "$agent_type"
[ -d "$cwd" ] || publish_failed "missing or unreadable cwd" "$session_id" "$agent_type"
[ -n "$agent_id" ] || publish_failed "missing agent_id" "$session_id" "$agent_type"
[ -n "$agent_type" ] || publish_failed "missing agent_type" "$session_id" ""
[ -n "$message" ] || publish_failed "missing last_assistant_message" "$session_id" "$agent_type"

marker="${message%%$'\n'*}"
if [ "$marker_count" -ne 1 ] ||
   [[ ! "$marker" =~ ^oso-handoff:[[:space:]]v=1[[:space:]]slice=([A-Za-z0-9][A-Za-z0-9_-]*)[[:space:]]attempt=([1-9][0-9]*)$ ]]; then
  publish_failed "the final message must begin with one exact oso-handoff marker" "$session_id" "$agent_type"
fi
slice_id="${BASH_REMATCH[1]}"
attempt="${BASH_REMATCH[2]}"
state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"

if ! (cd "$cwd" && printf '%s' "$message" |
  "$state_bin" handoff publish \
    --slice "$slice_id" --attempt "$attempt" \
    --agent-id "$agent_id" --agent-type "$agent_type" \
    --hook-session "$session_id" >/dev/null); then
  publish_failed "oso-state rejected the receipt" "$session_id" "$agent_type"
fi

log_event handoff-published "$session_id" "$agent_type:$slice_id:$attempt" || true
finish_hook
