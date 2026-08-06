#!/usr/bin/env bash
# SessionStart: if this repository's own runtime state names another session
# (crashed or resumed work), tell the model so an in-flight /plan change gets
# re-armed instead of silently running with every gate off.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

payload="$(cat)"
session_id="$(hook_session "$payload")"
[ -d "$OSO_STATE_DIR" ] || exit 0

# Every gate this session meets resolves state_file_for(cwd) — never the whole
# state directory — so a repository other than this one arms nothing here, and
# naming it would hand the operator a file no remedy run from this cwd could
# ever reach (D18). The one file worth a warning is this repository's own, and
# the session recorded inside it is the key: a file this session armed is one
# it is resuming, not one it has to be told about.
state_file="$(state_file_for "$(json_field "$payload" cwd)")"
[ -e "$state_file" ] || exit 0
[ "$(state_value "$state_file" session)" != "$session_id" ] || exit 0

if [ -n "${OSO_AGENT:-}" ]; then
  plan_route='$oso-code:plan {change}'
else
  plan_route='/oso-code:plan {change}'
fi
clear_command="\"${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}\" --session \"$session_id\" clear"
context="oso-code: this repository's own runtime state ($(basename "$state_file")) was left by another session, and its flags arm this session's gates too — if the user is resuming an oso-code plan change, run $plan_route so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale and $clear_command drops it."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json_escape "$context")"
exit 0
