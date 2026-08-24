#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

[ "${1:-}" = --allow ] && [ "$#" -eq 2 ] ||
  block_with_gate_error 'the unknown-tool gate configuration (missing allowlist)'
allowlist="$2"
allowed_tools=()
IFS='|' read -r -a allowed_tools <<< "$allowlist"
[ "${#allowed_tools[@]}" -gt 0 ] ||
  block_with_gate_error 'the unknown-tool gate configuration (empty allowlist)'
for allowed_tool in "${allowed_tools[@]}"; do
  case "$allowed_tool" in ''|*[!A-Za-z0-9_:.-]*)
    block_with_gate_error 'the unknown-tool gate configuration (invalid allowlist)' ;;
  esac
done

input="$(cat)"
session_id="$(sanitize_session "$(json_field "$input" session_id)")"
require_session "$session_id"
state_file="$(state_file_for "$(json_field "$input" cwd)")"
require_readable_state "$state_file" "$session_id"

if state_says "$state_file" '^plan_approval=pending$' "$session_id" plan_approval_session; then
  deny \
    'oso-code: plan approval is pending. Use Codex native "Implement the plan." approval, or send exactly CANCEL OSO PLAN to abandon it, before using local tools.' \
    plan-approval-pending-denied "$session_id"
fi

trap 'block_with_gate_error "the unknown-tool gate"' ERR
tool_name="$(json_field "$input" tool_name)"
case "$tool_name" in ''|*[!A-Za-z0-9_:.-]*) ;;
  *)
    case "|$allowlist|" in *"|$tool_name|"*) exit 0 ;; esac
    ;;
esac

if [ "${OSO_HOST:-}" = opencode ]; then
  allowlist_host=OpenCode
else
  allowlist_host=Codex
fi

deny "oso-code: tool '${tool_name:-<missing>}' is not in this release's $allowlist_host hook allowlist. Use one of the allowed local tools instead: ${allowlist//|/, }." \
  unknown-tool-denied "$session_id" "$tool_name"
