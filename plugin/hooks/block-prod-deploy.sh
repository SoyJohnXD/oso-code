#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

PRODUCTION_BOUNDARY_SUBJECTS='git deploy vercel netlify firebase'

judge_command() {
  if runs_a_production_deploy; then
    verdict=production
  elif [ "$verdict" != production ] && [ "$verdict" != unread ] &&
    pushes_off_the_run_branch; then
    verdict=push
  elif [ "$verdict" = clear ] && is_residue_call "$PRODUCTION_BOUNDARY_SUBJECTS"; then
    verdict=residue
  fi
}

runs_a_production_deploy() {
  local deploy_cli
  deploy_cli="$(deploy_command_name)" || return 1
  if arguments_arrived_unread; then
    return 0
  fi
  case "$deploy_cli" in
    vercel) vercel_targets_production ;;
    netlify) command_carries deploy && command_carries --prod ;;
    firebase) command_carries deploy ;;
    *) return 1 ;;
  esac
}

arguments_arrived_unread() {
  case "$command_stdin" in
    *"$LEX_UNREAD_PAYLOAD_MARKER"*) return 0 ;;
  esac
  return 1
}

deploy_command_name() {
  local index=0 word
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    word="$(package_spec_name "${command_tokens[$index]}")"
    case "$word" in
      vercel|netlify|firebase) printf '%s' "$word"; return 0 ;;
    esac
    if [ "$index" -eq 0 ] && ! is_package_runner "$word"; then
      return 1
    fi
    index=$((index + 1))
  done
  return 1
}

package_spec_name() {
  local token="${1##*/}"
  case "$token" in
    ?*@*) printf '%s' "${token%@*}" ;;
    *) printf '%s' "$token" ;;
  esac
}

is_package_runner() {
  case "$1" in
    npx|npm|pnpm|pnpx|yarn|bun|bunx|deno) return 0 ;;
  esac
  return 1
}

vercel_targets_production() {
  local index=0
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    case "${command_tokens[$index]}" in
      --prod|--target=production) return 0 ;;
      --target)
        case "${command_tokens[$((index + 1))]:-}" in
          production) return 0 ;;
        esac
        ;;
    esac
    index=$((index + 1))
  done
  return 1
}

command_carries() {
  local index=0
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    if [ "${command_tokens[$index]}" = "$1" ]; then
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

pushes_off_the_run_branch() {
  if ! is_git_call; then
    return 1
  fi
  if [ "$(git_verb)" != push ]; then
    return 1
  fi
  ! names_the_run_branch
}

RUN_BRANCH_REF='^oso-run/[a-z0-9-]+$'
RUN_BRANCH_REFSPEC='^[^:]+:(refs/heads/)?oso-run/[a-z0-9-]+$'

names_the_run_branch() {
  local index=1 token
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    token="${command_tokens[$index]}"
    if [[ "$token" =~ $RUN_BRANCH_REF ]] || [[ "$token" =~ $RUN_BRANCH_REFSPEC ]]; then
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

repository_denies_command() {
  local state_file="$1" command="$2" patterns_file pattern
  patterns_file="$(deploy_deny_patterns_file "$state_file")"
  if [ ! -f "$patterns_file" ] || [ ! -r "$patterns_file" ]; then
    return 1
  fi
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    if [ -n "$pattern" ] && printf '%s' "$command" | grep -Eq -- "$pattern" 2>/dev/null; then
      return 0
    fi
  done < "$patterns_file"
  return 1
}

deploy_deny_patterns_file() {
  local repository="${1##*/}"
  printf '%s/deploy-deny/%s.patterns' "$OSO_STATE_DIR" "${repository%.state}"
}

run_marker_of() {
  local state_file="$1" session="$2"
  if [ ! -e "$state_file" ]; then
    printf unmarked
    return 0
  fi
  if [ ! -f "$state_file" ] || [ ! -r "$state_file" ] || ! reads_as_state_records "$state_file"; then
    printf uncertain
    return 0
  fi
  if [ "$(unattended_run_marker "$state_file" "$session")" = running ]; then
    printf armed
    return 0
  fi
  printf unmarked
}

STATE_RECORD_LINE='^([A-Za-z0-9_]+=|[[:space:]]*$)'

reads_as_state_records() {
  local rc=0
  grep -Eqv "$STATE_RECORD_LINE" "$1" 2>/dev/null || rc=$?
  [ "$rc" -eq 1 ]
}

deny_production_boundary() {
  local reason="$1" detail="$2"
  if [ "$run_marker" = uncertain ]; then
    deny_unusable_state "$state_file" "$session_id"
  fi
  deny "$reason" prod-deploy-denied "$session_id" "$detail"
}

input="$(cat)"
session_id="$(hook_session "$input")"
require_session "$session_id"

state_file="$(state_file_for "$(json_field "$input" cwd)")"
run_marker="$(run_marker_of "$state_file" "$session_id")"
if [ "$run_marker" = unmarked ]; then
  exit 0
fi
record_reader_fallback "$session_id"

trap 'block_with_gate_error "the production boundary gate"' ERR

tool_name="$(json_field "$input" tool_name)"
case "$tool_name" in
  *deploy*)
    deny_production_boundary "oso-code: an unattended run is in flight, so an MCP deploy stays with the operator. Take the run back ($(oso_state_remedy "$session_id" 'set auto=done')) and run the deploy yourself." \
      "$tool_name" ;;
  Bash|bash) ;;
  *) exit 0 ;;
esac

command="$(json_command_line "$input")"
if repository_denies_command "$state_file" "$command"; then
  deny_production_boundary "oso-code: an unattended run is in flight, and this repository denies this command while one is. Take the run back ($(oso_state_remedy "$session_id" 'set auto=done')) and run it from your own terminal." \
    "$command"
fi

verdict="$(line_verdict "$command" judge_command)"
case "$verdict" in
  production)
    deny_production_boundary "oso-code: an unattended run is in flight, so a production deploy stays with the operator. Take the run back ($(oso_state_remedy "$session_id" 'set auto=done')) and deploy from your own terminal, or deploy after the run closes at its pull request." \
      "$command" ;;
  unread)
    deny_production_boundary "oso-code: an unattended run is in flight, and this command line is past what the production boundary can read, so it is treated as a production deploy. Take the run back ($(oso_state_remedy "$session_id" 'set auto=done')) and run it from your own terminal, or spell it in lines this boundary can read." \
      "$command" ;;
  push)
    if [ "$run_marker" = armed ]; then
      deny "oso-code: an unattended run is in flight, and it pushes its own oso-run/* branch and nothing else. Push that branch instead (git push origin oso-run/<name>), or take the run back ($(oso_state_remedy "$session_id" 'set auto=done')) and push from your own terminal." \
        run-branch-push-denied "$session_id" "$command"
    fi ;;
  residue)
    trap - ERR
    log_event residue-allowed "$session_id" "$command" || true ;;
esac
exit 0
