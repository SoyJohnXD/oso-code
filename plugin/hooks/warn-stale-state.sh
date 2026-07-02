#!/usr/bin/env bash
# SessionStart: if state files from other sessions exist (crashed or resumed
# work), tell the model so an in-flight /plan change gets re-armed instead of
# silently running with every gate off.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

session_id="$(sanitize_session "$(json_field "$(cat)" session_id)")"
state_dir="${HOME}/.local/state/oso-code"
[ -d "$state_dir" ] || exit 0

stale=""
for f in "$state_dir"/*.state; do
  [ -e "$f" ] || continue
  case "$f" in "$state_dir/${session_id}.state") continue ;; esac
  stale="$stale $(basename "$f")"
done
[ -n "$stale" ] || exit 0

cat <<JSON
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"oso-code: found runtime state from previous sessions (${stale# }). Gates only arm per session — if the user is resuming an oso-code /plan change, run /oso-code:plan {change} so step 0 restores the position and re-arms the runtime state."}}
JSON
exit 0
