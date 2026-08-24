#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

APPROVAL_PROMPT='Implement the plan.'
CANCEL_TOKEN='CANCEL OSO PLAN'
PLAN_INVOCATION='$oso-code:plan'
FEEDBACK_AMENDMENT_LABEL='plan-mode-feedback'

finish_hook() {
  printf '{}\n'
  exit 0
}

control_block() {
  local reason="$1"
  printf '{"decision":"block","reason":"%s"}\n' "$(json_escape "$reason")"
  exit 0
}

payload="$(cat)"
json_take_escaped_field "$payload" prompt
raw_prompt="$escaped"
raw_session_id="$(json_field "$payload" session_id)"
session_id="$(sanitize_session "$raw_session_id")"
cwd="$(json_field "$payload" cwd)"
resolve_codex_turn_mode "$payload"
native_mode="$CODEX_TURN_MODE"

case "$raw_prompt" in
  "$PLAN_INVOCATION"|"$PLAN_INVOCATION "*)
    [ "$native_mode" = plan ] || control_block \
      'oso-code: $oso-code:plan requires Codex native Plan Mode. Enter /plan (or use Shift+Tab), then invoke $oso-code:plan again.'
    ;;
esac

case "$raw_prompt" in
  "$APPROVAL_PROMPT") control_action=approve ;;
  "$CANCEL_TOKEN") control_action=cancel ;;
  *) control_action=ordinary ;;
esac

if [ "$control_action" = ordinary ]; then
  [ "$native_mode" = plan ] || finish_hook
  [ -n "$session_id" ] && [ "$session_id" = "$raw_session_id" ] && [ -d "$cwd" ] ||
    finish_hook
  state_file="$(state_file_for "$cwd" 2>/dev/null)" || finish_hook
  [ -f "$state_file" ] && [ -r "$state_file" ] && [ ! -L "$state_file" ] || finish_hook
  state_session="$(state_value "$state_file" plan_approval_session)"
  state_approval="$(state_value "$state_file" plan_approval)"
  state_digest="$(state_value "$state_file" plan_approval_digest)"
  [ "$state_session" = "$session_id" ] && [ "$state_approval" = pending ] &&
    [[ "$state_digest" =~ ^[0-9a-f]{64}$ ]] || finish_hook
  state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
  prompt_text="$(json_field "$payload" prompt)"
  if ! amend_error="$(printf '%s' "$prompt_text" |
    (cd "$cwd" && "$state_bin" --session "$session_id" \
      amend-plan "$FEEDBACK_AMENDMENT_LABEL") 2>&1 >/dev/null)"; then
    log_event plan-approval-amend-blocked "$session_id" "$amend_error" || true
    control_block \
      'oso-code: the pending document could not be amended; retry the planning message.'
  fi
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: this Plan Mode turn amended the pending document instead of discarding it. Present the amendment — what changed and why — not the complete plan, then re-emit the internal approval marker so a fresh capture binds the complete updated document before approval can succeed."}}'
  exit 0
fi

if [ "$control_action" = approve ]; then
  [ -n "$session_id" ] && [ "$session_id" = "$raw_session_id" ] && [ -d "$cwd" ] ||
    finish_hook
  state_file="$(state_file_for "$cwd" 2>/dev/null)" || finish_hook
  [ -e "$state_file" ] || finish_hook
  [ -f "$state_file" ] && [ -r "$state_file" ] && [ ! -L "$state_file" ] ||
    control_block 'oso-code: the pending plan state is unreadable; native approval cannot open the execution gate.'
  [ "$(state_value "$state_file" plan_approval)" = pending ] || finish_hook
else
  [ -n "$session_id" ] && [ "$session_id" = "$raw_session_id" ] ||
    control_block 'oso-code: the plan-control prompt has no valid session identity.'
  [ -d "$cwd" ] ||
    control_block 'oso-code: the plan-control prompt has no readable repository context.'
  state_file="$(state_file_for "$cwd" 2>/dev/null)" ||
    control_block 'oso-code: the approval state could not be resolved for this repository.'
fi

if [ "$control_action" = approve ]; then
  case "$native_mode" in
    default) ;;
    plan)
      control_block \
        'oso-code: native plan approval arrived while Codex still reports Plan Mode; use the native approval control again after the mode transition completes.' ;;
    *)
      control_block \
        'oso-code: native plan approval arrived without an attested collaboration mode; execution remains blocked.' ;;
  esac
else
  case "$native_mode" in
    plan|default) ;;
    *)
      control_block \
        'oso-code: the cancellation token arrived without an attested collaboration mode; the pending gate remains armed.' ;;
  esac
fi

[ -f "$state_file" ] && [ -r "$state_file" ] && [ ! -L "$state_file" ] ||
  control_block \
    'oso-code: no pending plan approval exists for this repository; present the complete plan again.'

state_session="$(state_value "$state_file" plan_approval_session)"
state_approval="$(state_value "$state_file" plan_approval)"
state_digest="$(state_value "$state_file" plan_approval_digest)"
[ "$state_session" = "$session_id" ] ||
  control_block \
    'oso-code: this plan-control prompt does not belong to the session that presented the pending plan.'
[ "$state_approval" = pending ] ||
  control_block \
    'oso-code: no pending plan approval exists; present the complete plan again before approving or cancelling it.'
if [[ ! "$state_digest" =~ ^[0-9a-f]{64}$ ]]; then
  control_block \
    'oso-code: the pending plan has no valid document digest; present it again before approving.'
fi

state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"
if ! control_error="$( (cd "$cwd" && "$state_bin" --session "$session_id" \
  "${control_action}-plan" "$state_digest") 2>&1 >/dev/null )"; then
  log_event "plan-approval-${control_action}-blocked" "$session_id" "$control_error" || true
  control_block "oso-code: the ${control_action} request lost its pending compare-and-set; the gate did not change."
fi

if [ "$control_action" = approve ]; then
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: Codex native plan approval matched the exact pending document. The technical approval gate is open; continue with the saved operational plan."}}'
else
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"oso-code: CANCEL OSO PLAN accepted for the exact pending document. Its runtime state was cleared; do not execute that plan."}}'
fi
exit 0
