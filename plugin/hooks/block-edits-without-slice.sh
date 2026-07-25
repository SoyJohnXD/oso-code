#!/usr/bin/env bash
# PreToolUse[Edit|MultiEdit|Write|NotebookEdit + a named allowlist of MCP writer
# tools]: in plan mode, denies file edits when no slice is active. Reads only
# state flags — never inspects model output.
#
# The MCP half of that matcher is a list of tool names because a matcher holding
# a metacharacter takes the regex path: `mcp__.*` would route EVERY MCP call
# into this gate and deny mem_search, context7 and read-only fallow through all
# the /plan phases where no slice is armed yet. A named list ages — an MCP tool
# that edits source files goes unjudged until someone adds it to hooks.json by
# name — and that is the accepted cost of not gating the reads.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

input="$(cat)"
session_id="$(sanitize_session "$(json_field "$input" session_id)")"
require_session "$session_id"

state_file="${OSO_STATE_DIR}/${session_id}.state"
require_readable_state "$state_file" "$session_id"
record_reader_fallback "$session_id"

# The session is armed from here, so an unexpected failure blocks instead of
# opening the gate. Armed any earlier it would deny every edit on every machine
# that has the plugin installed, armed session or not.
trap 'block_with_gate_error "the slice gate"' ERR

# Quick mode iterates freely; only plan mode requires an active slice.
state_says "$state_file" '^mode=plan$' "$session_id" || exit 0

# `oso-state` sets keys and never deletes one, so a slice is closed by writing
# the sentinel the skills write rather than by removing the key: only a value
# that names a slice arms the gate, and the next slice re-arms it. Reading
# "armed" off any non-empty value would rest the whole gate on this pattern
# needing one character.
if state_says "$state_file" '^active_slice=.' "$session_id" &&
   ! state_says "$state_file" '^active_slice=none$' "$session_id"; then
  exit 0
fi

deny "oso-code: plan mode is active but no slice is active. Activate the slice first (oso-state set active_slice=<n>) before editing files." \
  edit-denied "$session_id"
