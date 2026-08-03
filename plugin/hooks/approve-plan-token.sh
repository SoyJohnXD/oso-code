#!/usr/bin/env bash
# UserPromptSubmit: exchange one exact human control token for the pending plan
# bound by capture-plan-approval.sh. An ordinary Plan Mode reply invalidates a
# same-session pending document; every other ordinary prompt stays invisible.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

APPROVAL_TOKEN='APPROVE OSO PLAN'
CANCEL_TOKEN='CANCEL OSO PLAN'

finish_hook() {
  printf '{}\n'
  exit 0
}

token_block() {
  local reason="$1"
  printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$reason")"
  exit 0
}

payload="$(cat)"
json_take_escaped_field "$payload" prompt
raw_prompt="$escaped"

# Only either exact, whole, case-sensitive token invokes the rail. Similar text,
# quoted examples, leading/trailing whitespace, JSON-escaped whitespace and
# every ordinary prompt are conversation, not approval or cancellation.
# Comparing the escaped field is deliberate: both tokens are ASCII, so each one
# has one valid wire spelling and one valid decoded spelling.
case "$raw_prompt" in
  "$APPROVAL_TOKEN") token_action=approve ;;
  "$CANCEL_TOKEN") token_action=cancel ;;
  *) token_action=ordinary ;;
esac

raw_session_id="$(json_field "$payload" session_id)"
session_id="$(sanitize_session "$raw_session_id")"
cwd="$(json_field "$payload" cwd)"
permission_mode="$(json_field "$payload" permission_mode)"

# Returning to Plan Mode with an ordinary message is a request to change or
# discuss the plan. If this exact session has a pending document, invalidate it
# atomically before the new turn so read tools and request_user_input are not
# trapped behind the old execution gate. Everywhere else ordinary text remains
# globally invisible.
if [ "$token_action" = ordinary ]; then
  [ "$permission_mode" = plan ] || finish_hook
  [ -n "$session_id" ] && [ "$session_id" = "$raw_session_id" ] && [ -d "$cwd" ] ||
    finish_hook
  state_file="$(state_file_for "$cwd" 2>/dev/null)" || finish_hook
  [ -f "$state_file" ] && [ -r "$state_file" ] && [ ! -L "$state_file" ] || finish_hook
  state_session="$(state_value "$state_file" session)"
  state_approval="$(state_value "$state_file" plan_approval)"
  state_digest="$(state_value "$state_file" plan_approval_digest)"
  [ "$state_session" = "$session_id" ] && [ "$state_approval" = pending ] &&
    [[ "$state_digest" =~ ^[0-9a-f]{64}$ ]] || finish_hook
  state_bin="${OSO_STATE_BIN:-oso-state}"
  if ! (cd "$cwd" && "$state_bin" --session "$session_id" \
    cancel-plan "$state_digest" >/dev/null 2>&1); then
    token_block \
      'oso-code: the pending document changed while returning to Plan Mode; retry the planning message.'
  fi
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: this Plan Mode turn invalidated the previously pending document. Replan as requested, then present the complete updated plan with a fresh internal approval marker before asking for approval again."}}'
  exit 0
fi

[ -n "$session_id" ] && [ "$session_id" = "$raw_session_id" ] ||
  token_block 'oso-code: the plan-control token has no valid session identity.'
[ -d "$cwd" ] ||
  token_block 'oso-code: the plan-control token has no readable repository context.'
if [ "$token_action" = approve ]; then
  case "$permission_mode" in
    default|acceptEdits|dontAsk|bypassPermissions) ;;
    plan)
      token_block \
        'oso-code: switch Codex out of Plan Mode before sending APPROVE OSO PLAN.' ;;
    *)
      token_block \
        'oso-code: the approval token arrived in an unknown permission mode; execution remains blocked.' ;;
  esac
else
  case "$permission_mode" in
    plan|default|acceptEdits|dontAsk|bypassPermissions) ;;
    *)
      token_block \
        'oso-code: the cancellation token arrived in an unknown permission mode; the pending gate remains armed.' ;;
  esac
fi

state_file="$(state_file_for "$cwd" 2>/dev/null)" ||
  token_block 'oso-code: the approval state could not be resolved for this repository.'
[ -f "$state_file" ] && [ -r "$state_file" ] && [ ! -L "$state_file" ] ||
  token_block \
    'oso-code: no pending plan approval exists for this repository; present the complete plan again.'

state_session="$(state_value "$state_file" session)"
state_approval="$(state_value "$state_file" plan_approval)"
state_digest="$(state_value "$state_file" plan_approval_digest)"
[ "$state_session" = "$session_id" ] ||
  token_block \
    'oso-code: this plan-control token does not belong to the session that presented the pending plan.'
[ "$state_approval" = pending ] ||
  token_block \
    'oso-code: no pending plan approval exists; present the complete plan again before approving or cancelling it.'
if [[ ! "$state_digest" =~ ^[0-9a-f]{64}$ ]]; then
  token_block \
    'oso-code: the pending plan has no valid document digest; present it again before approving.'
fi

state_bin="${OSO_STATE_BIN:-oso-state}"
if ! (cd "$cwd" && "$state_bin" --session "$session_id" \
  "${token_action}-plan" "$state_digest" >/dev/null 2>&1); then
  token_block "oso-code: the ${token_action} token lost its pending compare-and-set; the gate did not change."
fi

if [ "$token_action" = approve ]; then
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: APPROVE OSO PLAN accepted for the exact pending document. The technical approval gate is open; continue with the saved plan rail."}}'
else
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: CANCEL OSO PLAN accepted for the exact pending document. Its runtime state was cleared; do not execute that plan."}}'
fi
exit 0
