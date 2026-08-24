#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

input="$(cat)"
session_id="$(hook_session "$input")"
require_session "$session_id"

state_file="$(state_file_for "$(json_field "$input" cwd)")"
require_readable_state "$state_file" "$session_id"
record_reader_fallback "$session_id"

trap 'block_with_gate_error "the slice gate"' ERR

state_says "$state_file" '^mode=plan$' "$session_id" || exit 0

if state_says "$state_file" '^active_slice=.' "$session_id" &&
   ! state_says "$state_file" '^active_slice=none$' "$session_id"; then
  exit 0
fi

deny "oso-code: plan mode is active but no slice is active. Activate it first ($(oso_state_remedy "$session_id" "set active_slice=<n>")), then retry the edit." \
  edit-denied "$session_id" "$(json_field "$input" file_path)"
