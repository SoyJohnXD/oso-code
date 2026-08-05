#!/usr/bin/env bash
# SessionStart: if state files from other sessions exist (crashed or resumed
# work), tell the model so an in-flight /plan change gets re-armed instead of
# silently running with every gate off.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

payload="$(cat)"
session_id="$(hook_session "$payload")"
[ -d "$OSO_STATE_DIR" ] || exit 0

# A state file is named after its repository, so the session that armed it is a
# key inside it — and a file this session armed is one it is resuming, not one
# it has to be told about.
stale=""
for state_file in "$OSO_STATE_DIR"/*.state; do
  [ -e "$state_file" ] || continue
  [ "$(state_value "$state_file" session)" != "$session_id" ] || continue
  stale="$stale $(basename "$state_file")"
done
[ -n "$stale" ] || exit 0

if [ -n "${OSO_AGENT:-}" ]; then
  plan_route='$oso-code:plan {change}'
else
  plan_route='/oso-code:plan {change}'
fi
clear_command="\"${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}\" --session \"$session_id\" clear"
context="oso-code: found runtime state another session left behind (${stale# }). State is keyed by repository, so the flags in it arm this session's gates too — if the user is resuming an oso-code plan change, run $plan_route so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale and $clear_command drops it."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json_escape "$context")"
exit 0
