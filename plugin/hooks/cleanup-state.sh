#!/usr/bin/env bash
# SessionEnd: removes this session's runtime state file.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

session_id="$(sanitize_session "$(json_field "$(cat)" session_id)")"
if [ -n "$session_id" ]; then
  rm -f "${HOME}/.local/state/oso-code/${session_id}.state"
fi
exit 0
