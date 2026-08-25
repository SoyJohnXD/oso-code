#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

judge_command() {
  if is_gated_git_call; then
    verdict=gated
  elif [ "$verdict" = clear ] && is_residue_call git; then
    verdict=residue
  fi
}

is_gated_git_call() {
  if ! is_git_call; then
    return 1
  fi
  local verb
  verb="$(git_verb)"
  if [ -z "$verb" ] || ! is_gated_git_verb "$verb"; then
    return 1
  fi
  if git_call_only_reports "$verb"; then
    return 1
  fi
  return 0
}

is_gated_git_verb() {
  case "$1" in
    commit|commit-tree|update-ref|filter-branch|replace|fast-import) return 0 ;;
  esac
  return 1
}

git_call_only_reports() {
  local verb="$1" index=1 token value_position=0
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    token="${command_tokens[$index]}"
    index=$((index + 1))
    if [ "$token" = -- ]; then
      return 1
    fi
    if [ "$value_position" = 0 ] && is_read_only_git_option "$verb" "$token"; then
      return 0
    fi
    case "$token" in
      --*=*) value_position=0 ;;
      -*) value_position=1 ;;
      *) value_position=0 ;;
    esac
  done
  return 1
}

is_read_only_git_option() {
  case "$1:$2" in
    commit:--dry-run|commit:-h|commit:--help|replace:-l) return 0 ;;
  esac
  return 1
}

input="$(cat)"
command="$(json_command_line "$input")"
session_id="$(hook_session "$input")"
require_session "$session_id"

state_file="$(state_file_for "$(json_field "$input" cwd)")"
require_readable_state "$state_file" "$session_id"

trap 'block_with_gate_error "the commit gate"' ERR

verdict="$(line_verdict "$command" judge_command)"
if [ "$verdict" = clear ]; then
  exit 0
fi

record_reader_fallback "$session_id"

if state_says "$state_file" '^verify_green=true$' "$session_id"; then
  exit 0
fi

case "$verdict" in
  residue|unread)
    trap - ERR
    log_event residue-allowed "$session_id" "$command" || true
    exit 0 ;;
esac

deny_until_green "$session_id" "$state_file" "$command"
