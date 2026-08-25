#!/usr/bin/env bash

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

. "$REPO_ROOT/bootstrap/lib/verification-fixtures.sh"
. "$REPO_ROOT/bootstrap/lib/opencode-verification.sh"
. "$REPO_ROOT/plugin/hooks/lib.sh"

SUPPORTED_OPENCODE_VERSION="$(sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' "$REPO_ROOT/bootstrap/install-opencode.sh" | head -1)"
SESSION_BOUND_SECONDS="${OSO_BEHAVIOR_BAR_SESSION_BOUND_SECONDS:-180}"
LOAD_BOUND_SECONDS="${OSO_BEHAVIOR_BAR_LOAD_BOUND_SECONDS:-60}"
GATED_COMMAND_VERB='git commit'
GATED_COMMAND="$GATED_COMMAND_VERB --allow-empty -m probe"
COMMIT_GATE_DENY_MARKER='the session verify is not green'
DEPLOY_CLI_NAME='vercel'
DEPLOY_PRODUCTION_FLAG='--prod'
DEPLOY_COMMAND="$DEPLOY_CLI_NAME $DEPLOY_PRODUCTION_FLAG"
PRODUCTION_BOUNDARY_DENY_MARKER='a production deploy stays with the operator'
HOST_PLUGIN_LOAD_ERROR='failed to load plugin'
PLAN_APPROVAL_TOOL_ID=oso_plan_approve
PLAN_APPROVAL_DOCUMENT='# Repaso de cambios -- one slice, verified by the behavior bar.'
EXPECTED_CHECK_COUNT=11
KEEP_FIXTURE_HINT='re-run with OSO_KEEP_FIXTURE=1 to keep the session streams, the install log and the deploy-CLI marker for inspection'

pass=0
fail=0
not_run_reason=""
SESSION_MODEL=""
PROBE_REPO=""
PLUGIN_ENTRY=""
DEPLOY_CLI_MARKER=""

check() {
  local name=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    printf 'ok:   %s (%s)\n' "$name" "$actual"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s — expected %s, got %s\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

record_not_run() {
  not_run_reason=$1
}

resolve_behavior_bar_binary() {
  resolve_pinned_opencode_binary "${OSO_BEHAVIOR_BAR_OPENCODE_BIN:-}" "$SUPPORTED_OPENCODE_VERSION"
}

behavior_bar_teardown_fixture() {
  remove_opencode_fixture || return 1
  trap - EXIT
}

behavior_bar_setup_fixture() {
  local source_root=$1
  trap behavior_bar_teardown_fixture EXIT
  if ! install_opencode_fixture "$source_root" oso-opencode-behavior; then
    trap - EXIT
    return 1
  fi
  PLUGIN_ENTRY="$OPENCODE_FIXTURE_CONFIG_HOME/plugin/oso-code.ts"
  cp "$PLUGIN_ENTRY" "$OPENCODE_FIXTURE_ROOT/installed-entry.ts"
  install_deploy_cli_shim
}

install_deploy_cli_shim() {
  DEPLOY_CLI_MARKER="$OPENCODE_FIXTURE_ROOT/deploy-cli-ran"
  cat > "$OPENCODE_FIXTURE_ROOT/shims/$DEPLOY_CLI_NAME" <<SH || return 1
#!/bin/sh
printf '%s\n' "\$*" >> "$DEPLOY_CLI_MARKER"
SH
  chmod +x "$OPENCODE_FIXTURE_ROOT/shims/$DEPLOY_CLI_NAME"
}

deploy_cli_reached() {
  if grep -qF -- "$DEPLOY_PRODUCTION_FLAG" "$DEPLOY_CLI_MARKER" 2>/dev/null; then
    printf reached
  else
    printf untouched
  fi
}

restore_installed_plugin_entry() {
  cp "$OPENCODE_FIXTURE_ROOT/installed-entry.ts" "$PLUGIN_ENTRY"
}

write_plugin_entry_that_registers_nothing() {
  cat > "$PLUGIN_ENTRY" <<'TS'
export const osoCode = async () => ({
  hooks: {
    "tool.execute.before": async () => {
      throw new Error("a hook map under a hooks key is never reached by this host");
    },
  },
});
TS
}

write_plugin_entry_without_a_function_export() {
  cat > "$PLUGIN_ENTRY" <<'TS'
export const osoCodeHooks = {
  "tool.execute.before": async () => {},
};
TS
}

arm_probe_repository() {
  PROBE_REPO="$OPENCODE_FIXTURE_ROOT/repo"
  mkdir -p "$PROBE_REPO" || return 1
  printf 'baseline\n' > "$PROBE_REPO/baseline.txt" || return 1
  git -C "$PROBE_REPO" init -q >/dev/null 2>&1 || return 1
  git -C "$PROBE_REPO" config user.name oso-code >/dev/null 2>&1 || return 1
  git -C "$PROBE_REPO" config user.email behavior-bar@oso-code.invalid >/dev/null 2>&1 || return 1
  git -C "$PROBE_REPO" add baseline.txt >/dev/null 2>&1 || return 1
  git -C "$PROBE_REPO" -c core.hooksPath=/dev/null \
    commit -qm 'test: behavior bar baseline' >/dev/null 2>&1 || return 1
  arm_probe_state
}

arm_probe_state() {
  ( cd "$PROBE_REPO" &&
    run_in_installed_fixture "$OPENCODE_FIXTURE_CONFIG_HOME/bin/oso-state" \
      --session "$(probe_root_session_id)" set mode=plan auto=running ) >/dev/null 2>&1
}

probe_root_session_id() {
  local digest
  digest="$(printf '%s' "$PROBE_REPO/.git" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || return 1
  digest="${digest%% *}"
  [ -n "$digest" ] || return 1
  printf '%s' "${digest:0:16}"
}

probe_repository_commit_count() {
  git -C "$PROBE_REPO" rev-list --count HEAD 2>/dev/null || printf unreadable
}

choose_session_model() {
  local catalog="$OPENCODE_FIXTURE_ROOT/models.out"
  if [ -n "${OSO_BEHAVIOR_BAR_MODEL:-}" ]; then
    SESSION_MODEL="$OSO_BEHAVIOR_BAR_MODEL"
    return 0
  fi
  if ! run_within_bound "$LOAD_BOUND_SECONDS" \
      run_in_installed_fixture "$OPENCODE_BIN" models \
      > "$catalog" 2> "$OPENCODE_FIXTURE_ROOT/models.err"; then
    return 1
  fi
  SESSION_MODEL="$(first_free_model_in "$catalog")"
  [ -n "$SESSION_MODEL" ]
}

run_session_with_prompt() {
  local label=$1 prompt=$2
  run_within_bound "$SESSION_BOUND_SECONDS" \
    run_in_installed_fixture "$OPENCODE_BIN" \
    run --dir "$PROBE_REPO" -m "$SESSION_MODEL" --format json "$prompt" \
    > "$OPENCODE_FIXTURE_ROOT/$label.json" 2> "$OPENCODE_FIXTURE_ROOT/$label.err"
}

run_probe_session() {
  local label=$1 command=$2
  run_session_with_prompt "$label" \
    "Use the bash tool to run exactly this command: $command    Then reply with status: done"
}

gated_call_report() {
  local label=$1 deny_marker=$2 gated_verb=$3
  local session_events status command_line error_text outcome reach_form
  local lexed_outcome="" residue_outcome="" mentioned=0
  {
    IFS= read -r -d '' session_events || session_events=0
    while IFS= read -r -d '' status &&
        IFS= read -r -d '' command_line &&
        IFS= read -r -d '' error_text; do
      reach_form="$(gated_verb_reach_form "$command_line" "$gated_verb")"
      if [ "$reach_form" = none ]; then
        case "$command_line" in *"$gated_verb"*) mentioned=1 ;; esac
        continue
      fi
      outcome="$(call_outcome "$status" "$error_text" "$deny_marker")"
      if [ "$reach_form" = lexed ]; then
        lexed_outcome="$(stronger_outcome "$lexed_outcome" "$outcome")"
      else
        residue_outcome="$(stronger_outcome "$residue_outcome" "$outcome")"
      fi
    done
  } < <(stream_bash_calls "$label")
  if [ "$session_events" -eq 0 ]; then
    printf 'none no-session'
  elif [ -n "$lexed_outcome" ]; then
    printf 'lexed %s' "$lexed_outcome"
  elif [ -n "$residue_outcome" ]; then
    printf 'residue %s' "$residue_outcome"
  elif [ "$mentioned" = 1 ]; then
    printf 'none mentioned-only'
  else
    printf 'none not-attempted'
  fi
}

stronger_outcome() {
  local held=$1 candidate=$2
  if [ "$(outcome_strength "${candidate%%:*}")" -gt "$(outcome_strength "${held%%:*}")" ]; then
    printf '%s' "$candidate"
  else
    printf '%s' "$held"
  fi
}

stream_bash_calls() {
  python3 - "$OPENCODE_FIXTURE_ROOT/$1.json" <<'PY'
import json
import sys

events = 0
calls = []
with open(sys.argv[1], encoding="utf-8", errors="replace") as handle:
    for raw in handle:
        raw = raw.strip()
        if not raw:
            continue
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        events += 1
        part = event.get("part") or {}
        if part.get("type") != "tool" or part.get("tool") != "bash":
            continue
        state = part.get("state") or {}
        calls.append((
            str(state.get("status")),
            (state.get("input") or {}).get("command") or "",
            " ".join(str(state.get("error") or "").split()),
        ))

sys.stdout.write("%d\0" % events)
for status, command, error in calls:
    sys.stdout.write("%s\0%s\0%s\0" % (status, command, error))
PY
}

gated_verb_reach_form() {
  local command_line=$1 gated_verb=$2
  case "$(line_verdict "$command_line" judge_gated_verb_call)" in
    called) printf lexed ;;
    residue|unread) printf residue ;;
    *) printf none ;;
  esac
}

judge_gated_verb_call() {
  if command_calls_the_gated_verb; then
    verdict=called
  elif [ "$verdict" = clear ] && is_residue_call "$gated_verb"; then
    verdict=residue
  fi
}

command_calls_the_gated_verb() {
  local verb_word
  for verb_word in $gated_verb; do
    if ! command_carries_the_word "$verb_word"; then
      return 1
    fi
  done
  return 0
}

command_carries_the_word() {
  local index=0
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    if [ "${command_tokens[$index]##*/}" = "$1" ]; then
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

residue_reach_reason() {
  local gated_verb=$1 gate=$2 session_exit=$3 outcome=$4
  printf 'the session reached %s only in a form no shell lexer can decide, which %s allows and logs as a residue by design, so this run measured that known limitation rather than the boundary (exit %s, %s)' \
    "$gated_verb" "$gate" "$session_exit" "$outcome"
}

call_outcome() {
  local status=$1 error_text=$2 deny_marker=$3
  case "$status" in
    completed) printf executed ;;
    error)
      case "$error_text" in
        *"$deny_marker"*) printf refused ;;
        *) printf 'errored:%s' "${error_text:0:120}" ;;
      esac ;;
    *) printf 'unfinished:%s' "$status" ;;
  esac
}

outcome_strength() {
  case "$1" in
    executed) printf 4 ;;
    refused) printf 3 ;;
    errored) printf 2 ;;
    unfinished) printf 1 ;;
    *) printf 0 ;;
  esac
}

approval_prompt_outcome() {
  local label=$1
  if grep -q "permission requested: $PLAN_APPROVAL_TOOL_ID" \
      "$OPENCODE_FIXTURE_ROOT/$label.json" "$OPENCODE_FIXTURE_ROOT/$label.err" 2>/dev/null; then
    printf asked
  else
    printf not-asked
  fi
}

approval_tool_attempt() {
  python3 - "$OPENCODE_FIXTURE_ROOT/$1.json" "$PLAN_APPROVAL_TOOL_ID" <<'PY'
import json
import sys

stream_path, tool_id = sys.argv[1], sys.argv[2]
attempt = "not-attempted"
with open(stream_path, encoding="utf-8", errors="replace") as handle:
    for raw in handle:
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        part = event.get("part") or {}
        if part.get("type") == "tool" and part.get("tool") == tool_id:
            attempt = "attempted"
            break
print(attempt)
PY
}

approved_plan_artifacts() {
  local found
  found="$(find "$OPENCODE_FIXTURE_HOME/.local/state/oso-code/plans" \
    -name 'approved-*.md' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${found:-0}" -eq 0 ]; then
    printf none
  else
    printf 'present:%s' "$found"
  fi
}

run_approval_session() {
  local label=$1
  run_session_with_prompt "$label" \
    "Call the $PLAN_APPROVAL_TOOL_ID tool exactly once with plan set to: $PLAN_APPROVAL_DOCUMENT    Then reply with status: done"
}

check_the_approval_binds_to_the_operators_grant() {
  local session_exit
  run_approval_session approval
  session_exit=$?
  if [ "$(approval_tool_attempt approval)" != attempted ]; then
    record_not_run "the session drove no $PLAN_APPROVAL_TOOL_ID call with $SESSION_MODEL (exit $session_exit)"
    return 1
  fi
  check "the host asks the operator to authorize $PLAN_APPROVAL_TOOL_ID in a real session" \
    asked "$(approval_prompt_outcome approval)"
  check "a refused authorization leaves no approved plan behind" none "$(approved_plan_artifacts)"
  return 0
}

run_same_turn_delivery_session() {
  local label=$1
  run_session_with_prompt "$label" \
    "Reply in ONE turn with two things in this order. First write exactly this line as plain text: milestone: the delivery probe is under way    Then, in that same turn, use the bash tool to run exactly this command: echo the delivery probe reached the shell    Then reply with status: done"
}

same_turn_delivery_order() {
  python3 - "$OPENCODE_FIXTURE_ROOT/$1.json" <<'PY'
import json
import sys


def delivery_order(stream_path):
    parts = list(stream_parts(stream_path))
    if not parts:
        return "no-session"
    tool_parts = parts_of_type(parts, "tool")
    if not tool_parts:
        return "no-tool-call"
    text_starts = earliest_start_per_message(parts_of_type(parts, "text"))
    if any_text_started_first(tool_parts, text_starts):
        return "text-then-tool"
    return "tool-first"


def stream_parts(stream_path):
    with open(stream_path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            yield event.get("part") or {}


def parts_of_type(parts, part_type):
    return [part for part in parts if part.get("type") == part_type]


def earliest_start_per_message(parts):
    earliest = {}
    for part in parts:
        started = emission_start(part)
        if started is None:
            continue
        message = part.get("messageID")
        earliest[message] = min(started, earliest.get(message, started))
    return earliest


def any_text_started_first(tool_parts, text_starts):
    for tool in tool_parts:
        tool_started = emission_start(tool)
        text_started = text_starts.get(tool.get("messageID"))
        if tool_started is None or text_started is None:
            continue
        if text_started < tool_started:
            return True
    return False


def emission_start(part):
    timing = part.get("time") or (part.get("state") or {}).get("time") or {}
    return timing.get("start")


print(delivery_order(sys.argv[1]))
PY
}

check_text_before_a_same_turn_tool_call_survives() {
  local session_exit order
  run_same_turn_delivery_session delivery
  session_exit=$?
  order="$(same_turn_delivery_order delivery)"
  case "$order" in
    no-session|no-tool-call)
      record_not_run "the same-turn delivery session drove no tool call after its text with $SESSION_MODEL (exit $session_exit, $order)"
      return 1 ;;
  esac
  check "text emitted before a same-turn tool call survives the host transcript" \
    text-then-tool "$order"
  return 0
}

count_host_plugin_load_errors() {
  local label=$1 log rc=0 count
  log="$OPENCODE_FIXTURE_ROOT/$label.err"
  run_within_bound "$LOAD_BOUND_SECONDS" \
    run_in_installed_fixture "$OPENCODE_BIN" agent list --print-logs \
    > "$OPENCODE_FIXTURE_ROOT/$label.out" 2> "$log"
  count="$(grep -c "$HOST_PLUGIN_LOAD_ERROR" "$log" 2>/dev/null)" || rc=$?
  [ "$rc" -le 1 ] || { printf unreadable; return; }
  printf '%s' "${count:-0}"
}

check_the_host_names_a_missing_function_export() {
  local named
  write_plugin_entry_without_a_function_export
  named="$(count_host_plugin_load_errors missing-export)"
  restore_installed_plugin_entry
  case "$named" in
    0|unreadable) check "a plugin entry with no function export is named in the host log" named "$named" ;;
    *) check "a plugin entry with no function export is named in the host log" named named ;;
  esac
}

check_the_gate_refuses_a_real_tool_call() {
  local session_exit reach_form outcome
  run_probe_session armed "$GATED_COMMAND"
  session_exit=$?
  read -r reach_form outcome \
    <<< "$(gated_call_report armed "$COMMIT_GATE_DENY_MARKER" "$GATED_COMMAND_VERB")"
  case "$outcome" in
    no-session|not-attempted|mentioned-only)
      record_not_run "the armed session drove no gated tool call with $SESSION_MODEL (exit $session_exit, $outcome)"
      return 1 ;;
  esac
  if [ "$reach_form" = residue ]; then
    record_not_run "$(residue_reach_reason "$GATED_COMMAND_VERB" "the commit gate" "$session_exit" "$outcome")"
    return 1
  fi
  check "the commit gate refuses the gated tool call in a real session" refused "$outcome"
  check "the refused commit never reached the probe repository" 1 "$(probe_repository_commit_count)"
  return 0
}

check_the_production_boundary_refuses_a_real_deploy() {
  local session_exit reach_form outcome
  if ! arm_probe_state; then
    record_not_run "the probe repository could not be re-armed for the production-boundary session"
    return 1
  fi
  run_probe_session deploy "$DEPLOY_COMMAND"
  session_exit=$?
  read -r reach_form outcome \
    <<< "$(gated_call_report deploy "$PRODUCTION_BOUNDARY_DENY_MARKER" "$DEPLOY_COMMAND")"
  case "$outcome" in
    no-session|not-attempted|mentioned-only)
      record_not_run "the armed session drove no $DEPLOY_COMMAND tool call with $SESSION_MODEL (exit $session_exit, $outcome)"
      return 1 ;;
  esac
  if [ "$reach_form" = residue ]; then
    record_not_run "$(residue_reach_reason "$DEPLOY_CLI_NAME" "the production boundary" "$session_exit" "$outcome")"
    return 1
  fi
  check "the production boundary refuses the deploy tool call in a real session" refused "$outcome"
  check "the refused deploy never reached the deploy CLI" untouched "$(deploy_cli_reached)"
  return 0
}

check_a_plugin_that_registers_nothing_is_caught() {
  local session_exit outcome
  write_plugin_entry_that_registers_nothing
  check "a plugin that loads and registers nothing leaves the host log silent" \
    0 "$(count_host_plugin_load_errors registers-nothing)"
  run_probe_session inert "$GATED_COMMAND"
  session_exit=$?
  read -r _ outcome \
    <<< "$(gated_call_report inert "$COMMIT_GATE_DENY_MARKER" "$GATED_COMMAND_VERB")"
  restore_installed_plugin_entry
  case "$outcome" in
    no-session|not-attempted|mentioned-only)
      record_not_run "the inert-plugin session drove no gated tool call with $SESSION_MODEL (exit $session_exit, $outcome)"
      return 1 ;;
  esac
  check "the observable effect catches a plugin that loads and registers nothing" executed "$outcome"
  check "the unguarded commit reached the probe repository" 2 "$(probe_repository_commit_count)"
}

behavior_bar_battery() {
  local source_root=$1
  if ! resolve_behavior_bar_binary; then
    record_not_run "no pinned OpenCode $SUPPORTED_OPENCODE_VERSION binary to drive a session with ($OPENCODE_BIN_STATUS)"
    return
  fi
  if ! behavior_bar_setup_fixture "$source_root"; then
    record_not_run "the isolated fixture install could not complete ($OPENCODE_FIXTURE_RESULT)"
    return
  fi
  check_the_host_names_a_missing_function_export
  if ! arm_probe_repository; then
    record_not_run "the probe repository could not be created and armed under $OPENCODE_FIXTURE_ROOT"
    behavior_bar_teardown_fixture
    return
  fi
  if ! choose_session_model; then
    record_not_run "the host catalog offered no free model to drive a session with"
    behavior_bar_teardown_fixture
    return
  fi
  if check_the_gate_refuses_a_real_tool_call &&
     check_the_production_boundary_refuses_a_real_deploy &&
     check_the_approval_binds_to_the_operators_grant &&
     check_text_before_a_same_turn_tool_call_survives; then
    check_a_plugin_that_registers_nothing_is_caught
  fi
  behavior_bar_teardown_fixture
}

behavior_bar_run() {
  printf 'behavior bar: driving a real OpenCode session against a fixture install\n'
  behavior_bar_battery "${1:-$REPO_ROOT}"
  if [ -z "$not_run_reason" ]; then
    check "behavior battery ran its pinned check count" "$EXPECTED_CHECK_COUNT" "$((pass + fail))"
  fi
  printf '%s\n' '----'
  printf 'passed: %s, failed: %s\n' "$pass" "$fail"
  if [ -n "$not_run_reason" ]; then
    printf 'behavior bar not run: %s\n' "$not_run_reason"
  fi
  if [ "$fail" -ne 0 ] || [ -n "$not_run_reason" ]; then
    printf '%s\n' "$KEEP_FIXTURE_HINT"
  fi
  if [ "$fail" -ne 0 ]; then
    return 1
  fi
  if [ -n "$not_run_reason" ]; then
    return 3
  fi
  printf 'behavior bar ran: OpenCode %s, model %s, %s checks green\n' \
    "$SUPPORTED_OPENCODE_VERSION" "$SESSION_MODEL" "$pass"
  return 0
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  behavior_bar_run "${1:-$REPO_ROOT}"
fi
