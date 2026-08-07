#!/usr/bin/env bash
# Codex catch-all gate: once oso-code state exists for the repository, deny each
# local tool call for which Codex emits PreToolUse unless its exposed name is in
# the release-rendered allowlist.
#
# Recovery: this gate denies for two distinct causes and gives each its own way
# out — a pending plan names Codex's native approval controls; an
# unlisted tool names the exact allowlist this release actually admits.
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

# The Stop hook arms this boundary before Codex offers its native plan approval.
# While it is pending, even a normally allowlisted local tool is an execution
# attempt: UserPromptSubmit is the only event allowed to open it.
# The pending flag is sufficient by itself, so a torn or manually corrupted
# state cannot open the gate merely by disagreeing about its mode.
#
# Scoped to plan_approval_session, THIS payload's own session id read above —
# never the repository-wide fact alone. Denying every local tool, Bash
# included, for the session that actually has a plan pending is the intended
# contract (platform/codex/plan.md): its native and CANCEL OSO PLAN escapes
# both run through UserPromptSubmit, never PreToolUse, so that session loses
# nothing it needs. What must never happen is a pending left by another
# session — or one that is gone — reaching a session with nothing pending at
# all; that was the scope bug, not the order, so the check still runs before
# the allowlist below rather than after it.
if state_says "$state_file" '^plan_approval=pending$' "$session_id" plan_approval_session; then
  deny \
    'oso-code: plan approval is pending. Use Codex native "Implement the plan." approval, or send exactly CANCEL OSO PLAN to abandon it, before using local tools.' \
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

deny "oso-code: tool '${tool_name:-<missing>}' is not in this release's Codex hook allowlist. Use one of the allowed local tools instead: ${allowlist//|/, }." \
  unknown-tool-denied "$session_id" "$tool_name"
