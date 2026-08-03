#!/usr/bin/env bash
# Codex catch-all gate: once oso-code state exists for the repository, deny each
# local tool call for which Codex emits PreToolUse unless its exposed name is in
# the release-rendered allowlist.
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

# The Stop hook arms this boundary before it asks the operator for the literal
# approval token. While it is pending, even a normally allowlisted local tool is
# an execution attempt: UserPromptSubmit is the only event allowed to open it.
# The pending flag is sufficient by itself, so a torn or manually corrupted
# state cannot open the gate merely by disagreeing about its mode.
if state_says "$state_file" '^plan_approval=pending$' "$session_id"; then
  deny \
    'oso-code: plan approval is pending. Switch to an execution permission mode and send exactly APPROVE OSO PLAN, or send exactly CANCEL OSO PLAN to abandon it, before using local tools.' \
    plan-approval-pending-denied "$session_id"
fi

# From here the repository is armed. A malformed payload, classifier failure or
# empty tool name blocks instead of turning the catch-all into a silent allow.
trap 'block_with_gate_error "the unknown-tool gate"' ERR
tool_name="$(json_field "$input" tool_name)"
case "$tool_name" in ''|*[!A-Za-z0-9_:.-]*) ;;
  *)
    case "|$allowlist|" in *"|$tool_name|"*) exit 0 ;; esac
    ;;
esac

deny "oso-code: tool '${tool_name:-<missing>}' is not in this release's Codex hook allowlist." \
  unknown-tool-denied "$session_id"
