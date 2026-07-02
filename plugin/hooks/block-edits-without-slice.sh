#!/usr/bin/env bash
# PreToolUse[Edit|Write|NotebookEdit]: in plan mode, denies file edits when no
# slice is active. Reads only state flags — never inspects model output.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

input="$(cat)"
session_id="$(sanitize_session "$(json_field "$input" session_id)")"
file_path="$(json_field "$input" file_path)"

state_file="${HOME}/.local/state/oso-code/${session_id}.state"
# No state file means no oso-code mode is active in this session.
[ -f "$state_file" ] || exit 0

# Quick mode iterates freely; only plan mode requires an active slice.
grep -q '^mode=plan$' "$state_file" || exit 0

# The state directory itself is always writable.
case "$file_path" in
  "${HOME}/.local/state/oso-code/"*) exit 0 ;;
esac

if grep -q '^active_slice=.' "$state_file"; then
  exit 0
fi

log_event edit-denied "$session_id"
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"oso-code: plan mode is active but no slice is active. Activate the slice first (oso-state set active_slice=<n>) before editing files."}}
JSON
exit 0
