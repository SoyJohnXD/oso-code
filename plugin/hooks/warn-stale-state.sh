#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

payload="$(cat)"
session_id="$(hook_session "$payload")"
[ -d "$OSO_STATE_DIR" ] || exit 0

state_file="$(state_file_for "$(json_field "$payload" cwd)")"
[ -e "$state_file" ] || exit 0
[ "$(state_value "$state_file" session)" != "$session_id" ] || exit 0

if [ "${OSO_HOST:-}" = opencode ]; then
  skill_prefix='/oso-'
elif [ -n "${OSO_AGENT:-}" ]; then
  skill_prefix='$oso-code:'
else
  skill_prefix='/oso-code:'
fi
state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
clear_command="\"$state_bin\" --session \"$session_id\" clear"
left_by_another="oso-code: this repository's own runtime state ($(basename "$state_file")) was left by another session, and its flags arm this session's gates too"

roadmap_in_flight="$(state_value "$state_file" roadmap)"
[ "$roadmap_in_flight" != none ] || roadmap_in_flight=""
if [ -n "$roadmap_in_flight" ]; then
  route_slug='{roadmap}'
  if [[ "$roadmap_in_flight" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]]; then
    route_slug="$roadmap_in_flight"
  fi
  disarm_command="\"$state_bin\" --session \"$session_id\" set roadmap=none"
  context="${left_by_another}, and it names a roadmap in flight — if the user is resuming that roadmap, run ${skill_prefix}roadmap ${route_slug} so its chain re-reads its own record and arms the child that record leaves un-run; if that roadmap is over or abandoned, $disarm_command drops the claim it makes on this repository and $clear_command drops the whole file."
else
  context="${left_by_another} — if the user is resuming an oso-code plan change, run ${skill_prefix}plan {change} so step 0 restores the position and re-arms the runtime state; if they are not, that state is stale and $clear_command drops it."
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json_escape "$context")"
exit 0
