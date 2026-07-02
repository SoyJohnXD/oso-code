#!/usr/bin/env bash
# PreToolUse[Bash]: denies git commit while the session verify is not green.
# Reads only state flags — never inspects model output.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

input="$(cat)"
command="$(json_field "$input" command)"
session_id="$(sanitize_session "$(json_field "$input" session_id)")"

# Match git commit at a command position (start, after ;|&( or a JSON-escaped
# newline), tolerating flags with or without values (-C /repo, -c k=v, --opt=x).
# Quoted mentions like `echo "git commit"` or `rg "git commit"` do not match.
commit_pattern='(^|[;&|(]|\\n)[[:space:]]*(command[[:space:]]+)?git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]&;|)\\]|$)'
[[ "$command" =~ $commit_pattern ]] || exit 0

state_file="${HOME}/.local/state/oso-code/${session_id}.state"
# No state file means no oso-code mode is active in this session.
[ -f "$state_file" ] || exit 0

if grep -q '^verify_green=true$' "$state_file"; then
  exit 0
fi

log_event commit-denied "$session_id"
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"oso-code: the session verify is not green. Run the verify loop (plan mode) or the quality pass (quick mode) to zero warnings — it sets verify_green=true — then commit."}}
JSON
exit 0
