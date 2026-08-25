#!/usr/bin/env bash

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

. "$REPO_ROOT/bootstrap/lib/verification-fixtures.sh"
. "$REPO_ROOT/bootstrap/lib/opencode-verification.sh"

SUPPORTED_OPENCODE_VERSION="$(sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' "$REPO_ROOT/bootstrap/install-opencode.sh" | head -1)"
OSO_CONTRACT_BAR_BOUND_SECONDS="${OSO_CONTRACT_BAR_BOUND_SECONDS:-30}"
OSO_CONTRACT_BAR_SERVER_BOUND_SECONDS="${OSO_CONTRACT_BAR_SERVER_BOUND_SECONDS:-120}"
SESSION_MODEL_PROVIDER=opencode
WAVE_TOOL_ID=oso_wave
PLAN_APPROVAL_TOOL_ID=oso_plan_approve
PLAN_CANCEL_TOOL_ID=oso_plan_cancel
FIX_APPLY_TOOL_ID=fallow_fix_apply
GRANT_BOUND_PERMISSION=ask
WORKSPACE_ADAPTER_TYPE=oso-code
PLAN_COMMAND=oso-plan
MUTATION_DEMO_AGENT=oso-applier
EXPECTED_CHECK_COUNT=58

pass=0
fail=0

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

resolve_contract_bar_binary() {
  resolve_pinned_opencode_binary "${OSO_CONTRACT_BAR_OPENCODE_BIN:-}" "$SUPPORTED_OPENCODE_VERSION"
}

FIXTURE_SOURCE_ROOT=""

contract_bar_teardown_fixture() {
  contract_bar_stop_server
  remove_opencode_fixture || return 1
  trap - EXIT
}

contract_bar_setup_fixture() {
  local source_root=${1:-$REPO_ROOT}
  FIXTURE_SOURCE_ROOT="$source_root"
  trap contract_bar_teardown_fixture EXIT
  if ! install_opencode_fixture "$source_root" oso-opencode-contract; then
    trap - EXIT
    return 1
  fi
  return 0
}

contract_bar_invoke() {
  local out=$1 err=$2
  shift 2
  run_within_bound "$OSO_CONTRACT_BAR_BOUND_SECONDS" \
    run_in_installed_fixture "$OPENCODE_BIN" "$@" \
    >"$out" 2>"$err"
}

contract_bar_source_agent_names() {
  local file
  for file in "$FIXTURE_SOURCE_ROOT"/opencode/agents/oso-*.md; do
    [ -f "$file" ] || continue
    basename "$file" .md
  done
}

contract_bar_source_agent_mode() {
  local name=$1 file mode
  file="$FIXTURE_SOURCE_ROOT/opencode/agents/$name.md"
  [ -f "$file" ] || { printf absent; return; }
  mode="$(sed -n 's/^mode:[[:space:]]*//p' "$file" | head -1)"
  printf '%s' "${mode:-unset}"
}

contract_bar_source_skill_names() {
  local dir
  for dir in "$FIXTURE_SOURCE_ROOT"/opencode/skills/oso-*; do
    [ -d "$dir" ] || continue
    basename "$dir"
  done
}

contract_bar_config_command_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

config_path, field = sys.argv[1], sys.argv[2]
with open(config_path, encoding="utf-8") as handle:
    data = json.load(handle)
for name, spec in (data.get("command") or {}).items():
    print(name + "\t" + str(spec.get(field) or ""))
PY
}

contract_bar_config_agent_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

config_path, field = sys.argv[1], sys.argv[2]
with open(config_path, encoding="utf-8") as handle:
    data = json.load(handle)
for name, spec in (data.get("agent") or {}).items():
    print(name + "\t" + str(spec.get(field) or ""))
PY
}

contract_bar_config_permission() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

config_path, key = sys.argv[1], sys.argv[2]
with open(config_path, encoding="utf-8") as handle:
    data = json.load(handle)
print((data.get("permission") or {}).get(key) or "absent")
PY
}

contract_bar_config_agent_permission() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

config_path, key = sys.argv[1], sys.argv[2]
with open(config_path, encoding="utf-8") as handle:
    data = json.load(handle)
for name, spec in (data.get("agent") or {}).items():
    rule = (spec.get("permission") or {}).get(key)
    if isinstance(rule, str):
        resolved = rule
    elif isinstance(rule, dict):
        resolved = "allowlist"
    else:
        resolved = "absent"
    print(name + "\t" + resolved)
PY
}

contract_bar_config_agent_shell_globs() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for name, spec in (data.get("agent") or {}).items():
    allowlist = (spec.get("permission") or {}).get("bash")
    if not isinstance(allowlist, dict):
        continue
    for form in allowlist:
        if form != "*" and "*" in form:
            print(name + ":" + form)
PY
}

contract_bar_config_plugin_origins() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for origin in data.get("plugin_origins") or []:
    print(origin)
PY
}

contract_bar_skill_locations() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
for entry in data:
    print(entry.get("name", "") + "\t" + entry.get("location", ""))
PY
}

contract_bar_field_of() {
  local table=$1 name=$2
  printf '%s\n' "$table" | awk -F'\t' -v n="$name" '$1==n{print $2; found=1} END{if(!found) print "absent"}'
}

contract_bar_check_agent_roster() {
  local out="$OPENCODE_FIXTURE_ROOT/agent-list.out" err="$OPENCODE_FIXTURE_ROOT/agent-list.err"
  local rc roster name missing=""
  contract_bar_invoke "$out" "$err" agent list
  rc=$?
  if [ "$rc" -ne 0 ]; then
    check "agent list reads the fixture install" ok "exit:$rc $(fold_lines < "$err")"
    return
  fi
  roster="$(grep -oE '^[^[:space:]]+ \((primary|subagent|all)\)$' "$out" | awk '{print $1}')"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '%s\n' "$roster" | grep -Fxq "$name" || missing="$missing $name"
  done < <(contract_bar_source_agent_names)
  if [ -n "$missing" ]; then
    check "agent list enumerates every installed oso-* agent" complete "missing:${missing# }"
  else
    check "agent list enumerates every installed oso-* agent" complete complete
  fi
}

contract_bar_check_agent_modes() {
  local config_out=$1 name expected actual modes
  modes="$(contract_bar_config_agent_field "$config_out" mode)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    expected="$(contract_bar_source_agent_mode "$name")"
    actual="$(contract_bar_field_of "$modes" "$name")"
    check "the real binary resolves $name's mode from the fixture install" \
      "$expected" "${actual:-unset}"
  done < <(contract_bar_source_agent_names)
}

contract_bar_check_agents_inherit_the_session_model() {
  local config_out=$1 name model models pinned=""
  models="$(contract_bar_config_agent_field "$config_out" model)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    model="$(contract_bar_field_of "$models" "$name")"
    case "$model" in
      ''|absent) ;;
      *) pinned="$pinned $name($model)" ;;
    esac
  done < <(contract_bar_source_agent_names)
  if [ -n "$pinned" ]; then
    check "the real binary resolves no oso-* agent to a model of its own" \
      session-model "pinned:${pinned# }"
  else
    check "the real binary resolves no oso-* agent to a model of its own" \
      session-model session-model
  fi
}

contract_bar_check_no_roster_agent_asks_the_operator() {
  local config_out=$1 name rules
  rules="$(contract_bar_config_agent_permission "$config_out" question)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    check "the real binary resolves $name's question rule from the fixture install" \
      deny "$(contract_bar_field_of "$rules" "$name")"
  done < <(contract_bar_source_agent_names)
}

contract_bar_expected_shell_rule() {
  case "$1" in
    oso-doubt-pass) printf deny ;;
    *) printf absent ;;
  esac
}

contract_bar_check_no_agent_block_grants_a_whole_tool() {
  local config_out=$1 name reads shells
  reads="$(contract_bar_config_agent_permission "$config_out" read)"
  shells="$(contract_bar_config_agent_permission "$config_out" bash)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    check "the real binary resolves $name's read and bash rules from the fixture install" \
      "absent $(contract_bar_expected_shell_rule "$name")" \
      "$(contract_bar_field_of "$reads" "$name") $(contract_bar_field_of "$shells" "$name")"
  done < <(contract_bar_source_agent_names)
}

contract_bar_check_the_fix_tool_reaches_the_applier_alone() {
  local config_out=$1 name expected rules
  rules="$(contract_bar_config_agent_permission "$config_out" "$FIX_APPLY_TOOL_ID")"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$name" in
      oso-applier) expected=absent ;;
      *) expected=deny ;;
    esac
    check "the real binary resolves $name's $FIX_APPLY_TOOL_ID rule from the fixture install" \
      "$expected" "$(contract_bar_field_of "$rules" "$name")"
  done < <(contract_bar_source_agent_names)
}

contract_bar_check_no_roster_agent_reaches_the_grant_bound_tools() {
  local config_out=$1 name approvals cancels
  approvals="$(contract_bar_config_agent_permission "$config_out" "$PLAN_APPROVAL_TOOL_ID")"
  cancels="$(contract_bar_config_agent_permission "$config_out" "$PLAN_CANCEL_TOOL_ID")"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    check "the real binary resolves $name's grant-bound tool rules from the fixture install" \
      "deny deny" \
      "$(contract_bar_field_of "$approvals" "$name") $(contract_bar_field_of "$cancels" "$name")"
  done < <(contract_bar_source_agent_names)
}

contract_bar_execution_powers_denied() {
  python3 - "$1" <<'PY'
import fnmatch
import json
import sys

EXECUTION_PHASE_POWERS = (
    ("the state command", "bash", "oso-state set active_slice=1"),
    ("the slice commit", "bash", "git commit -m slice"),
    ("the slice's own edits", "edit", "src/slice.ts"),
)


def resolved_action(rules, permission, target):
    action = "unruled"
    for rule in rules:
        if rule.get("permission") not in (permission, "*"):
            continue
        if fnmatch.fnmatchcase(target, rule.get("pattern") or "*"):
            action = rule.get("action")
    return action


with open(sys.argv[1], encoding="utf-8") as handle:
    rules = json.load(handle).get("permission") or []
print(", ".join(
    power for power, permission, target in EXECUTION_PHASE_POWERS
    if resolved_action(rules, permission, target) != "allow"
))
PY
}

contract_bar_check_the_plan_route_admits_the_execution_phase() {
  local config_out=$1 route out err rc denied
  local claim="the real binary routes /$PLAN_COMMAND to an agent whose ruleset admits the execution phase"
  route="$(contract_bar_field_of "$(contract_bar_config_command_field "$config_out" agent)" "$PLAN_COMMAND")"
  out="$OPENCODE_FIXTURE_ROOT/debug-agent.out"
  err="$OPENCODE_FIXTURE_ROOT/debug-agent.err"
  contract_bar_invoke "$out" "$err" debug agent "$route"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    check "$claim" admits "$route resolves to no agent: $(fold_lines < "$err")"
    return
  fi
  denied="$(contract_bar_execution_powers_denied "$out")"
  if [ -n "$denied" ]; then
    check "$claim" admits "$route denies $denied"
  else
    check "$claim" admits admits
  fi
}

contract_bar_check_shell_allowlists_carry_exact_forms() {
  local config_out=$1 globs
  globs="$(contract_bar_config_agent_shell_globs "$config_out" | fold_lines)"
  check "the real binary resolves every agent shell allowlist to exact forms" \
    exact "${globs:-exact}"
}

contract_bar_check_plugin_listed_for_load() {
  local config_out=$1 origins expected
  origins="$(contract_bar_config_plugin_origins "$config_out")"
  expected="$OPENCODE_FIXTURE_CONFIG_HOME/plugin/oso-code.ts"
  if printf '%s\n' "$origins" | grep -Fq "$expected"; then
    check "the installed plugin entry is on the real binary discovery list" present present
  else
    check "the installed plugin entry is on the real binary discovery list" present absent
  fi
}

contract_bar_check_skill_registry() {
  local out="$OPENCODE_FIXTURE_ROOT/debug-skill.out" err="$OPENCODE_FIXTURE_ROOT/debug-skill.err"
  local rc name expected_location actual_location locations
  contract_bar_invoke "$out" "$err" debug skill
  rc=$?
  if [ "$rc" -ne 0 ]; then
    check "debug skill reads the fixture install" ok "exit:$rc $(fold_lines < "$err")"
    return
  fi
  locations="$(contract_bar_skill_locations "$out")"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    expected_location="$OPENCODE_FIXTURE_CONFIG_HOME/skill/$name/SKILL.md"
    actual_location="$(contract_bar_field_of "$locations" "$name")"
    check "debug skill registers $name at its installed location" \
      "$expected_location" "$actual_location"
  done < <(contract_bar_source_skill_names)
}

contract_bar_catalog_status() {
  local catalog=$1 entry
  [ -s "$catalog" ] || { printf empty; return; }
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      */*) ;;
      *) printf 'unqualified:%s' "$entry"; return ;;
    esac
  done < "$catalog"
  if grep -q "^$SESSION_MODEL_PROVIDER/" "$catalog"; then
    printf offered
  else
    printf 'providers:%s' "$(cut -d/ -f1 < "$catalog" | sort -u | fold_lines)"
  fi
}

contract_bar_free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

contract_bar_probe_repository() {
  local repo="$OPENCODE_FIXTURE_ROOT/tool-probe-repo"
  mkdir -p "$repo" || return 1
  printf 'probe\n' > "$repo/probe.txt" || return 1
  git -C "$repo" init -q >/dev/null 2>&1 || return 1
  git -C "$repo" config user.name oso-code >/dev/null 2>&1 || return 1
  git -C "$repo" config user.email contract-bar@oso-code.invalid >/dev/null 2>&1 || return 1
  git -C "$repo" add probe.txt >/dev/null 2>&1 || return 1
  git -C "$repo" -c core.hooksPath=/dev/null commit -qm 'test: contract bar probe' >/dev/null 2>&1 || return 1
  printf '%s' "$repo"
}

contract_bar_await_server() {
  local log=$1 waited=0
  while [ "$waited" -lt "$OSO_CONTRACT_BAR_SERVER_BOUND_SECONDS" ]; do
    grep -q 'server listening on' "$log" 2>/dev/null && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

contract_bar_read_registered_ids() {
  python3 - "$1" "$OSO_CONTRACT_BAR_SERVER_BOUND_SECONDS" <<'PY'
import json
import sys
import urllib.request

url, bound = sys.argv[1], float(sys.argv[2])


def identifier(entry):
    return entry if isinstance(entry, str) else entry.get("type", "")


try:
    with urllib.request.urlopen(url, timeout=bound) as response:
        for entry in json.load(response):
            print(identifier(entry))
except Exception as failure:
    print("unreachable: " + " ".join(str(failure).split()), file=sys.stderr)
    raise SystemExit(1)
PY
}

CONTRACT_BAR_SERVER_PID=""
CONTRACT_BAR_TOOL_STATUS=""
CONTRACT_BAR_APPROVAL_TOOL_STATUS=""
CONTRACT_BAR_CANCEL_TOOL_STATUS=""
CONTRACT_BAR_ADAPTER_STATUS=""

contract_bar_start_server() {
  local port=$1 repo=$2
  set -m
  ( cd "$repo" && run_in_installed_fixture "$OPENCODE_BIN" serve --port "$port" --hostname 127.0.0.1 ) \
    > "$OPENCODE_FIXTURE_ROOT/serve.out" 2> "$OPENCODE_FIXTURE_ROOT/serve.err" < /dev/null &
  CONTRACT_BAR_SERVER_PID=$!
  set +m
}

contract_bar_stop_server() {
  [ -n "$CONTRACT_BAR_SERVER_PID" ] || return 0
  kill -TERM "-$CONTRACT_BAR_SERVER_PID" 2>/dev/null || kill -TERM "$CONTRACT_BAR_SERVER_PID" 2>/dev/null
  wait "$CONTRACT_BAR_SERVER_PID" 2>/dev/null
  CONTRACT_BAR_SERVER_PID=""
}

contract_bar_record_probe_failure() {
  CONTRACT_BAR_TOOL_STATUS=$1
  CONTRACT_BAR_APPROVAL_TOOL_STATUS=$1
  CONTRACT_BAR_CANCEL_TOOL_STATUS=$1
  CONTRACT_BAR_ADAPTER_STATUS=$1
}

contract_bar_listed_status() {
  local roster=$1 wanted=$2 out err
  shift 2
  out="$OPENCODE_FIXTURE_ROOT/$roster.out"
  err="$OPENCODE_FIXTURE_ROOT/$roster.err"
  "$@" > "$out" 2> "$err"
  if [ ! -s "$out" ]; then
    printf 'no-%s:%s' "$roster" "$(fold_lines < "$err")"
    return
  fi
  if grep -Fxq "$wanted" "$out"; then
    printf registered
  else
    printf 'absent-from:%s' "$(fold_lines < "$out")"
  fi
}

contract_bar_probe_registrations() {
  local repo port
  repo="$(contract_bar_probe_repository)" || { contract_bar_record_probe_failure no-probe-repository; return; }
  port="$(contract_bar_free_port)" || { contract_bar_record_probe_failure no-free-port; return; }
  contract_bar_start_server "$port" "$repo"
  if ! contract_bar_await_server "$OPENCODE_FIXTURE_ROOT/serve.out"; then
    contract_bar_stop_server
    contract_bar_record_probe_failure "server-never-listened:$(fold_lines < "$OPENCODE_FIXTURE_ROOT/serve.err")"
    return
  fi
  CONTRACT_BAR_TOOL_STATUS="$(contract_bar_listed_status tool-ids "$WAVE_TOOL_ID" \
    contract_bar_read_registered_ids "http://127.0.0.1:$port/experimental/tool/ids?directory=$repo")"
  CONTRACT_BAR_APPROVAL_TOOL_STATUS="$(contract_bar_listed_status approval-tool-ids "$PLAN_APPROVAL_TOOL_ID" \
    contract_bar_read_registered_ids "http://127.0.0.1:$port/experimental/tool/ids?directory=$repo")"
  CONTRACT_BAR_CANCEL_TOOL_STATUS="$(contract_bar_listed_status cancel-tool-ids "$PLAN_CANCEL_TOOL_ID" \
    contract_bar_read_registered_ids "http://127.0.0.1:$port/experimental/tool/ids?directory=$repo")"
  CONTRACT_BAR_ADAPTER_STATUS="$(contract_bar_listed_status adapter-types "$WORKSPACE_ADAPTER_TYPE" \
    contract_bar_read_registered_ids "http://127.0.0.1:$port/experimental/workspace/adapter?directory=$repo")"
  contract_bar_stop_server
}

contract_bar_check_plugin_registrations() {
  contract_bar_probe_registrations
  check "the real binary registers the installed plugin's $WAVE_TOOL_ID tool" \
    registered "$CONTRACT_BAR_TOOL_STATUS"
  check "the real binary registers the installed plugin's $PLAN_APPROVAL_TOOL_ID tool" \
    registered "$CONTRACT_BAR_APPROVAL_TOOL_STATUS"
  check "the real binary registers the installed plugin's $PLAN_CANCEL_TOOL_ID tool" \
    registered "$CONTRACT_BAR_CANCEL_TOOL_STATUS"
  check "the real binary lists the installed plugin's $WORKSPACE_ADAPTER_TYPE workspace adapter" \
    registered "$CONTRACT_BAR_ADAPTER_STATUS"
}

contract_bar_check_model_catalog() {
  local out="$OPENCODE_FIXTURE_ROOT/models.out" err="$OPENCODE_FIXTURE_ROOT/models.err" rc status
  contract_bar_invoke "$out" "$err" models
  rc=$?
  if [ "$rc" -ne 0 ]; then
    check "the model catalog reads the fixture install" ok "exit:$rc $(fold_lines < "$err")"
    return
  fi
  status="$(contract_bar_catalog_status "$out")"
  check "the host catalog offers the $SESSION_MODEL_PROVIDER provider the session model comes from" \
    offered "$status"
  [ "$status" = offered ] || printf \
    'note: this catalog belongs to the host, not to this repository — its free roster rotates between invocations, so a red here means the host stopped offering %s models, never that the repository changed\n' \
    "$SESSION_MODEL_PROVIDER"
}

contract_bar_battery() {
  local source_root=$1 config_out config_err rc
  resolve_contract_bar_binary
  check "the OpenCode binary this bar introspects is the pinned one" \
    "$SUPPORTED_OPENCODE_VERSION" "$OPENCODE_BIN_STATUS"
  [ -n "$OPENCODE_BIN" ] || return
  if ! contract_bar_setup_fixture "$source_root"; then
    check "contract fixture install" ready "$OPENCODE_FIXTURE_RESULT"
    return
  fi
  check "contract fixture install" ready ready
  contract_bar_check_agent_roster
  config_out="$OPENCODE_FIXTURE_ROOT/debug-config.out"
  config_err="$OPENCODE_FIXTURE_ROOT/debug-config.err"
  contract_bar_invoke "$config_out" "$config_err" debug config
  rc=$?
  if [ "$rc" -eq 0 ]; then
    contract_bar_check_agent_modes "$config_out"
    contract_bar_check_agents_inherit_the_session_model "$config_out"
    contract_bar_check_no_roster_agent_asks_the_operator "$config_out"
    contract_bar_check_no_agent_block_grants_a_whole_tool "$config_out"
    contract_bar_check_the_fix_tool_reaches_the_applier_alone "$config_out"
    contract_bar_check_no_roster_agent_reaches_the_grant_bound_tools "$config_out"
    contract_bar_check_shell_allowlists_carry_exact_forms "$config_out"
    contract_bar_check_the_plan_route_admits_the_execution_phase "$config_out"
    check "the real binary resolves the $PLAN_APPROVAL_TOOL_ID permission from the fixture install" \
      "$GRANT_BOUND_PERMISSION" "$(contract_bar_config_permission "$config_out" "$PLAN_APPROVAL_TOOL_ID")"
    check "the real binary resolves the $PLAN_CANCEL_TOOL_ID permission from the fixture install" \
      "$GRANT_BOUND_PERMISSION" "$(contract_bar_config_permission "$config_out" "$PLAN_CANCEL_TOOL_ID")"
    contract_bar_check_plugin_listed_for_load "$config_out"
  else
    check "debug config reads the fixture install" ok "exit:$rc $(fold_lines < "$config_err")"
  fi
  contract_bar_check_skill_registry
  contract_bar_check_plugin_registrations
  contract_bar_check_model_catalog
  contract_bar_teardown_fixture
}

contract_bar_run() {
  printf 'contract bar: introspecting the real OpenCode binary against a fixture install\n'
  contract_bar_battery "${1:-$REPO_ROOT}"
  check "contract battery ran its pinned check count" "$EXPECTED_CHECK_COUNT" "$((pass + fail))"
  printf '%s\n' '----'
  printf 'passed: %s, failed: %s\n' "$pass" "$fail"
  [ "$fail" -eq 0 ]
}

contract_bar_demo_agent_mode_mutation() {
  local target=${1:-$MUTATION_DEMO_AGENT} agent_file source_mode mutated_mode
  local before_out before_err after_out after_err restored_out restored_err
  local before_fail after_fail restored_fail
  printf 'contract bar demonstration: a mutated agent mode must turn red and name the agent\n'
  if ! resolve_contract_bar_binary; then
    printf 'FAIL: the demonstration needs the pinned OpenCode binary — expected %s, got %s\n' \
      "$SUPPORTED_OPENCODE_VERSION" "$OPENCODE_BIN_STATUS"
    return 1
  fi
  if ! contract_bar_setup_fixture "$REPO_ROOT"; then
    printf 'FAIL: demonstration fixture install (%s)\n' "$OPENCODE_FIXTURE_RESULT"
    return 1
  fi
  agent_file="$OPENCODE_FIXTURE_CONFIG_HOME/agent/$target.md"
  source_mode="$(contract_bar_source_agent_mode "$target")"
  case "$source_mode" in
    subagent) mutated_mode=primary ;;
    *) mutated_mode=subagent ;;
  esac

  printf -- '--- before mutation (expect green) ---\n'
  before_out="$OPENCODE_FIXTURE_ROOT/debug-config-before.out"
  before_err="$OPENCODE_FIXTURE_ROOT/debug-config-before.err"
  contract_bar_invoke "$before_out" "$before_err" debug config
  contract_bar_check_agent_modes "$before_out"
  before_fail=$fail

  cp "$agent_file" "$agent_file.orig"
  sed -i "s/^mode: $source_mode\$/mode: $mutated_mode/" "$agent_file"

  printf -- '--- after mutation: %s mode %s -> %s (expect red naming %s) ---\n' \
    "$target" "$source_mode" "$mutated_mode" "$target"
  after_out="$OPENCODE_FIXTURE_ROOT/debug-config-after.out"
  after_err="$OPENCODE_FIXTURE_ROOT/debug-config-after.err"
  contract_bar_invoke "$after_out" "$after_err" debug config
  contract_bar_check_agent_modes "$after_out"
  after_fail=$fail

  cp "$agent_file.orig" "$agent_file"
  rm -f "$agent_file.orig"

  printf -- '--- after restore (expect green again) ---\n'
  restored_out="$OPENCODE_FIXTURE_ROOT/debug-config-restored.out"
  restored_err="$OPENCODE_FIXTURE_ROOT/debug-config-restored.err"
  contract_bar_invoke "$restored_out" "$restored_err" debug config
  contract_bar_check_agent_modes "$restored_out"
  restored_fail=$fail

  contract_bar_teardown_fixture

  if [ "$after_fail" -gt "$before_fail" ] && [ "$restored_fail" -eq "$after_fail" ]; then
    printf 'demonstration: PASS — the mutation turned red naming %s, and restoring turned it green again\n' "$target"
    return 0
  fi
  printf 'demonstration: FAIL — the mutation did not behave the way the mechanism requires\n'
  return 1
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  case "${1:-}" in
    --demo-agent-mode-mutation)
      shift
      contract_bar_demo_agent_mode_mutation "${1:-$MUTATION_DEMO_AGENT}"
      ;;
    *)
      contract_bar_run "${1:-$REPO_ROOT}"
      ;;
  esac
fi
