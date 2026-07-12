#!/usr/bin/env bash
# SessionEnd: removes this session's runtime state file.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

session_id="$(sanitize_session "$(json_field "$(cat)" session_id)")"
if [ -n "$session_id" ]; then
  state_file="${HOME}/.local/state/oso-code/${session_id}.state"
  # Drop the state and any lock a crashed writer left behind.
  rm -f "$state_file"
  rm -rf "${state_file}.lock"
fi
exit 0
