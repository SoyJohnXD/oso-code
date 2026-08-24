#!/usr/bin/env bash

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

. "$SCRIPT_DIR/lib/verification-fixtures.sh"
. "$SCRIPT_DIR/lib/opencode-verification.sh"
. "$SCRIPT_DIR/lib/opencode-trust-bytes.sh"

SUPPORTED_OPENCODE_VERSION="$(sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' "$SCRIPT_DIR/install-opencode.sh" | head -1)"

SMOKE_MODEL=""
SMOKE_NOT_RUN_REASON=""
SMOKE_BOUND_SECONDS="${OSO_VERIFY_SMOKE_BOUND_SECONDS:-300}"
SMOKE_PREFLIGHT_BOUND_SECONDS="${OSO_VERIFY_SMOKE_PREFLIGHT_BOUND_SECONDS:-120}"

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

escape_sed_pattern() {
  local value=$1
  value="${value//\\/\\\\}"
  value="${value//./\\.}"
  value="${value//\*/\\*}"
  value="${value//\[/\\[}"
  value="${value//\]/\\]}"
  value="${value//^/\\^}"
  value="${value//\$/\\$}"
  value="${value//|/\\|}"
  printf '%s' "$value"
}

bounded_command_output() {
  local bound_seconds=$1 label=$2 out rc
  shift 2
  out="$(mktemp "${TMPDIR:-/tmp}/oso-bounded.XXXXXX")" || return 1
  run_within_bound "$bound_seconds" "$@" >"$out" 2>&1
  rc=$?
  if [ "$rc" -eq 124 ]; then
    printf 'SLOW: %s did not answer within %ss\n' "$label" "$bound_seconds"
  else
    cat "$out"
  fi
  rm -f "$out"
  return "$rc"
}

opencode_version_status() {
  if ! command -v opencode >/dev/null 2>&1; then
    printf '%s' opencode-not-on-path
    return
  fi
  printf '%s' "$(opencode_version_of opencode)"
}


OPERATOR_THEME=oso-verify-operator-theme
OPERATOR_MCP_SERVER=oso-verify-operator-server
OPERATOR_GLOBAL_PROSE="oso-verify operator prose the installer must not touch"
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"

LOCAL_FIXTURE_PREFIX=oso-opencode-verify
FIXTURE_PARENT=""
LOCAL_FIXTURE_ROOT=""
LOCAL_FIXTURE_HOME=""
LOCAL_FIXTURE_CONFIG_HOME=""
LOCAL_FIXTURE_RESULT=""

setup_local_fixture() {
  local shims
  FIXTURE_PARENT="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$FIXTURE_PARENT" ] || { LOCAL_FIXTURE_RESULT=temporary-parent-unavailable; return 1; }
  if ! LOCAL_FIXTURE_ROOT="$(mktemp -d "$FIXTURE_PARENT/$LOCAL_FIXTURE_PREFIX.XXXXXX" 2>&1)"; then
    LOCAL_FIXTURE_RESULT="$(printf '%s' "$LOCAL_FIXTURE_ROOT" | fold_lines)"
    return 1
  fi
  LOCAL_FIXTURE_HOME="$LOCAL_FIXTURE_ROOT/home"
  shims="$LOCAL_FIXTURE_ROOT/shims"
  if ! mkdir -p "$LOCAL_FIXTURE_HOME" "$shims"; then
    LOCAL_FIXTURE_RESULT=fixture-setup-failed
    remove_temporary_fixture "$LOCAL_FIXTURE_ROOT" "$FIXTURE_PARENT" "$LOCAL_FIXTURE_PREFIX"
    LOCAL_FIXTURE_ROOT=""
    return 1
  fi

  printf '%s\n' \
    '#!/bin/sh' \
    'case "$*" in' \
    "  --version) printf '$SUPPORTED_OPENCODE_VERSION\\n' ;;" \
    '  *) exit 64 ;;' \
    'esac' > "$shims/opencode"
  chmod +x "$shims/opencode"
  write_opencode_installer_shims "$shims"
  seed_operator_config "$(opencode_fixture_config_home "$LOCAL_FIXTURE_HOME")"
  seed_operator_global "$(opencode_fixture_config_home "$LOCAL_FIXTURE_HOME")"

  if ! run_in_opencode_fixture "$LOCAL_FIXTURE_HOME" "$shims:$PATH" \
      bash "$SCRIPT_DIR/install-opencode.sh" --yes --no-impeccable --no-git-hook \
      > "$LOCAL_FIXTURE_ROOT/install.log" 2>&1; then
    LOCAL_FIXTURE_RESULT="install-failed:$(cat "$LOCAL_FIXTURE_ROOT/install.log" 2>/dev/null | tail -1 | fold_lines)"
    remove_temporary_fixture "$LOCAL_FIXTURE_ROOT" "$FIXTURE_PARENT" "$LOCAL_FIXTURE_PREFIX"
    LOCAL_FIXTURE_ROOT=""
    return 1
  fi
  LOCAL_FIXTURE_CONFIG_HOME="$(opencode_fixture_config_home "$LOCAL_FIXTURE_HOME")"
  LOCAL_FIXTURE_RESULT=ready
  return 0
}

seed_operator_config() {
  local config_home=$1
  mkdir -p "$config_home"
  cat > "$config_home/opencode.json" <<JSON
{
  "theme": "$OPERATOR_THEME",
  "permission": {
    "read": "allow"
  },
  "mcp": {
    "$OPERATOR_MCP_SERVER": {
      "type": "local",
      "command": ["operator-cli"],
      "enabled": true,
      "environment": {}
    }
  }
}
JSON
}

seed_operator_global() {
  local config_home=$1
  mkdir -p "$config_home"
  printf '%s\n' \
    '# Personal OpenCode rules' \
    '' \
    "$OPERATOR_GLOBAL_PROSE" > "$LOCAL_FIXTURE_ROOT/operator-global.seed"
  cp "$LOCAL_FIXTURE_ROOT/operator-global.seed" "$config_home/AGENTS.md"
}

opencode_operator_keys_status() {
  local config verdict
  config="$LOCAL_FIXTURE_CONFIG_HOME/opencode.json"
  [ -f "$config" ] || { printf missing; return; }
  verdict="$(OSO_OPERATOR_THEME="$OPERATOR_THEME" OSO_OPERATOR_SERVER="$OPERATOR_MCP_SERVER" \
    python3 - "$config" 2>/dev/null <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
assert data.get("theme") == os.environ["OSO_OPERATOR_THEME"], "the operator theme was dropped"
assert (data.get("permission") or {}).get("read") == "allow", "permission.read was dropped"
server = (data.get("mcp") or {}).get(os.environ["OSO_OPERATOR_SERVER"])
assert isinstance(server, dict), "the operator MCP server was dropped"
assert server.get("command") == ["operator-cli"], "the operator MCP server was rewritten"
print("preserved")
PY
)"
  printf '%s' "${verdict:-dropped}"
}

opencode_config_home_guard_status() {
  local decoy log rc entries
  decoy="$LOCAL_FIXTURE_ROOT/decoy-config"
  mkdir -p "$decoy/opencode"
  printf '{"theme":"decoy"}\n' > "$decoy/opencode/opencode.json"
  log="$LOCAL_FIXTURE_ROOT/config-home-guard.log"
  env HOME="$LOCAL_FIXTURE_HOME" \
    XDG_CONFIG_HOME="$decoy" \
    XDG_STATE_HOME="$LOCAL_FIXTURE_HOME/.local/state" \
    XDG_CACHE_HOME="$LOCAL_FIXTURE_HOME/.cache" \
    XDG_DATA_HOME="$LOCAL_FIXTURE_HOME/.local/share" \
    PATH="$LOCAL_FIXTURE_ROOT/shims:$PATH" \
    bash "$SCRIPT_DIR/install-opencode.sh" --yes --no-impeccable --no-git-hook \
    > "$log" 2>&1
  rc=$?
  [ "$rc" -eq 2 ] || { printf 'exit:%s' "$rc"; return; }
  [ "$(cat "$decoy/opencode/opencode.json" 2>/dev/null)" = '{"theme":"decoy"}' ] ||
    { printf overwrote-the-decoy-config; return; }
  entries="$(ls -A "$decoy/opencode" | wc -l | tr -d ' ')"
  [ "$entries" = 1 ] || { printf 'wrote-into-the-decoy:%s' "$entries"; return; }
  printf refused
}

opencode_trust_bytes_status() {
  local report
  report="$LOCAL_FIXTURE_ROOT/trust.report"
  opencode_trust_divergence "$SCRIPT_DIR/hook-hashes.txt" installed \
    "$LOCAL_FIXTURE_CONFIG_HOME" > "$report"
  if [ -s "$report" ]; then
    printf 'bad:%s' "$(fold_lines < "$report")"
    return
  fi
  [ "$OPENCODE_TRUST_FILES_READ" -eq "$OPENCODE_TRUST_FILE_COUNT" ] ||
    { printf 'covers:%s' "$OPENCODE_TRUST_FILES_READ"; return; }
  printf verified
}

remove_local_fixture() {
  [ -n "${LOCAL_FIXTURE_ROOT:-}" ] || return 0
  remove_temporary_fixture "$LOCAL_FIXTURE_ROOT" "$FIXTURE_PARENT" "$LOCAL_FIXTURE_PREFIX"
  LOCAL_FIXTURE_ROOT=""
}

opencode_config_status() {
  local config verdict
  config="$LOCAL_FIXTURE_CONFIG_HOME/opencode.json"
  [ -f "$config" ] || { printf missing; return; }
  verdict="$(python3 - "$config" 2>/dev/null <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
assert isinstance(data.get("plugin"), list), "plugin is not an array"
for name, server in (data.get("mcp") or {}).items():
    assert isinstance(server, dict), "malformed MCP server " + name
    assert "env" not in server, "MCP server uses env instead of environment: " + name
for mode in ("oso-plan", "oso-quick", "oso-debug", "oso-roadmap"):
    assert (data.get("permission") or {}).get("skill", {}).get(mode) == "deny", \
        "permission.skill does not deny " + mode
for grant_bound_tool in ("oso_plan_approve", "oso_plan_cancel"):
    assert (data.get("permission") or {}).get(grant_bound_tool) == "ask", \
        "permission." + grant_bound_tool + " is not ask"
print("valid")
PY
)"
  printf '%s' "${verdict:-malformed}"
}

opencode_skill_status() {
  local wrapper count=0 divergent="" rel
  for wrapper in "$REPO_ROOT"/opencode/skills/oso-*/SKILL.md; do
    [ -f "$wrapper" ] || continue
    count=$((count + 1))
    rel="${wrapper#$REPO_ROOT/opencode/skills/}"
    cmp -s "$wrapper" "$LOCAL_FIXTURE_CONFIG_HOME/skill/$rel" \
      || divergent="$divergent ${rel%/SKILL.md}"
  done
  [ "$count" -eq 9 ] || { printf 'wrapper-count:%s' "$count"; return; }
  [ -z "$divergent" ] || { printf 'divergent:%s' "$divergent"; return; }
  [ -d "$LOCAL_FIXTURE_CONFIG_HOME/skill/_shared/bodies" ] || { printf missing-shared-bodies; return; }
  [ -d "$LOCAL_FIXTURE_CONFIG_HOME/skill/_shared/platform/opencode" ] || { printf missing-platform; return; }
  diff -qr "$REPO_ROOT/plugin/skills/_shared" \
    "$LOCAL_FIXTURE_CONFIG_HOME/skill/_shared" >/dev/null 2>&1 \
    || { printf shared-differs; return; }
  printf exact
}

opencode_agent_status() {
  local agent rel source_count=0 installed_count=0 divergent=""
  for agent in "$REPO_ROOT"/opencode/agents/oso-*.md; do
    [ -f "$agent" ] || continue
    source_count=$((source_count + 1))
    rel="$(basename "$agent")"
    cmp -s "$agent" "$LOCAL_FIXTURE_CONFIG_HOME/agent/$rel" || divergent="$divergent $rel"
  done
  for agent in "$LOCAL_FIXTURE_CONFIG_HOME"/agent/oso-*.md; do
    [ -f "$agent" ] && installed_count=$((installed_count + 1))
  done
  [ "$source_count" -eq "$installed_count" ] || { printf 'count:%s!=%s' "$source_count" "$installed_count"; return; }
  [ -z "$divergent" ] || { printf 'divergent:%s' "$divergent"; return; }
  printf exact
}

opencode_command_status() {
  local command rel route count=0 divergent=""
  for command in "$REPO_ROOT"/opencode/commands/oso-*.md; do
    [ -f "$command" ] || continue
    count=$((count + 1))
    rel="$(basename "$command")"
    cmp -s "$command" "$LOCAL_FIXTURE_CONFIG_HOME/command/$rel" || divergent="$divergent $rel"
  done
  [ "$count" -eq 4 ] || { printf 'count:%s' "$count"; return; }
  [ -z "$divergent" ] || { printf 'divergent:%s' "$divergent"; return; }
  for rel in oso-plan:oso-plan oso-quick:build oso-debug:build oso-roadmap:build; do
    route="$(sed -n 's/^agent:[[:space:]]*//p' "$LOCAL_FIXTURE_CONFIG_HOME/command/${rel%%:*}.md" | head -1)"
    [ "$route" = "${rel#*:}" ] || { printf 'route:%s=%s' "${rel%%:*}" "${route:-empty}"; return; }
  done
  printf exact
}

opencode_plugin_status() {
  local module rel source_count=0 installed_count=0 test_count=0 divergent=""
  cmp -s "$REPO_ROOT/opencode/plugin/oso-code.ts" "$LOCAL_FIXTURE_CONFIG_HOME/plugin/oso-code.ts" \
    || { printf entry-divergent; return; }
  for module in "$REPO_ROOT"/opencode/plugin/oso/*.ts; do
    case "$(basename "$module")" in *.test.ts) continue ;; esac
    source_count=$((source_count + 1))
    rel="$(basename "$module")"
    cmp -s "$module" "$LOCAL_FIXTURE_CONFIG_HOME/plugin/oso/$rel" || divergent="$divergent $rel"
  done
  for module in "$LOCAL_FIXTURE_CONFIG_HOME"/plugin/oso/*.ts; do
    [ -f "$module" ] || continue
    case "$(basename "$module")" in
      *.test.ts) test_count=$((test_count + 1)) ;;
      *) installed_count=$((installed_count + 1)) ;;
    esac
  done
  [ "$source_count" -eq "$installed_count" ] || { printf 'count:%s!=%s' "$source_count" "$installed_count"; return; }
  [ "$test_count" -eq 0 ] || { printf 'tests-installed:%s' "$test_count"; return; }
  [ -z "$divergent" ] || { printf 'divergent:%s' "$divergent"; return; }
  cmp -s "$REPO_ROOT/opencode/hooks/routes.ts" "$LOCAL_FIXTURE_CONFIG_HOME/hooks/routes.ts" \
    || { printf routes-divergent; return; }
  printf exact
}

opencode_engram_status() {
  [ -f "$LOCAL_FIXTURE_CONFIG_HOME/plugins/engram.ts" ] \
    && printf present || printf missing
}

opencode_global_status() {
  local installed expected
  [ -f "$LOCAL_FIXTURE_CONFIG_HOME/AGENTS.md" ] || { printf missing; return; }
  if ! installed="$(awk -v start="$GLOBAL_MARKER_START" -v end="$GLOBAL_MARKER_END" '
    $0 == start { starts++; inside = 1; next }
    $0 == end { ends++; inside = 0; next }
    inside { print }
    END { if (starts != 1 || ends != 1 || inside) exit 1 }
  ' "$LOCAL_FIXTURE_CONFIG_HOME/AGENTS.md" 2>/dev/null)"; then
    printf malformed
    return
  fi
  expected="$(cat "$SCRIPT_DIR/opencode-global.md")"
  if [ "$installed" = "$expected" ]; then printf exact; else printf divergent; fi
}

opencode_operator_global_status() {
  local global="$LOCAL_FIXTURE_CONFIG_HOME/AGENTS.md" seed
  seed="$LOCAL_FIXTURE_ROOT/operator-global.seed"
  [ -f "$global" ] || { printf missing; return; }
  head -n "$(wc -l < "$seed" | tr -d ' ')" "$global" | cmp -s - "$seed" \
    && printf preserved || printf rewritten
}

opencode_registry_status() {
  local registry="$LOCAL_FIXTURE_HOME/.local/state/oso-code/opencode-install-registry"
  local target missing="" escaped
  [ -f "$registry" ] || { printf missing; return; }
  for target in \
    "$LOCAL_FIXTURE_CONFIG_HOME/opencode.json" \
    "$LOCAL_FIXTURE_CONFIG_HOME/AGENTS.md" \
    "$LOCAL_FIXTURE_CONFIG_HOME/skill" \
    "$LOCAL_FIXTURE_CONFIG_HOME/agent" \
    "$LOCAL_FIXTURE_CONFIG_HOME/command" \
    "$LOCAL_FIXTURE_CONFIG_HOME/plugin" \
    "$LOCAL_FIXTURE_CONFIG_HOME/hooks/routes.ts" \
    "$LOCAL_FIXTURE_CONFIG_HOME/bin/oso-state" \
    "$LOCAL_FIXTURE_CONFIG_HOME/git-hooks/pre-commit" \
    "$LOCAL_FIXTURE_CONFIG_HOME"/hooks/*.sh; do
    [ -e "$target" ] || continue
    escaped="$(escape_sed_pattern "$target")"
    grep -Eq "^installer[[:space:]]+$escaped$" "$registry" \
      || missing="$missing ${target#$LOCAL_FIXTURE_HOME/}"
  done
  if [ -n "$missing" ]; then printf 'missing:%s' "$missing"; else printf installer-owned; fi
}

run_ts_bar() {
  if [ -f "$REPO_ROOT/opencode/package.json" ] && command -v npx >/dev/null 2>&1; then
    if (cd "$REPO_ROOT/opencode" && npx tsc --noEmit >/dev/null 2>&1); then
      check "OpenCode plugin typecheck" clean clean
    else
      check "OpenCode plugin typecheck" clean fail
    fi
  else
    printf 'skip: OpenCode plugin typecheck — npx or opencode/package.json is not available\n'
  fi
  if command -v node >/dev/null 2>&1; then
    if (cd "$REPO_ROOT/opencode" && node --test >/dev/null 2>&1); then
      check "OpenCode plugin test suite" pass pass
    else
      check "OpenCode plugin test suite" pass fail
    fi
  else
    printf 'skip: OpenCode plugin test suite — node is not available\n'
  fi
}

run_shell_syntax() {
  local file bad=""
  for file in \
    "$REPO_ROOT"/bootstrap/*.sh \
    "$REPO_ROOT"/bootstrap/lib/*.sh \
    "$REPO_ROOT"/tools/*.sh \
    "$REPO_ROOT"/plugin/hooks/*.sh \
    "$REPO_ROOT"/tests/*.sh \
    "$REPO_ROOT"/tests/fixtures/*.sh \
    "$REPO_ROOT/plugin/bin/oso-state" \
    "$REPO_ROOT/plugin/git-hooks/pre-commit"; do
    [ -f "$file" ] || continue
    bash -n "$file" >/dev/null 2>&1 || bad="$bad $(basename "$file")"
  done
  if [ -n "$bad" ]; then check "repository shell syntax" clean "bad:$bad"; else check "repository shell syntax" clean clean; fi
}

run_local_checks() {
  local version
  printf 'local checks:\n'
  version="$(opencode_version_status)"
  case "$version" in
    opencode-not-on-path)
      printf 'skip: OpenCode CLI version — opencode is not on PATH, so the installed pin could not be probed\n'
      ;;
    *) check "OpenCode CLI version" "$SUPPORTED_OPENCODE_VERSION" "$version" ;;
  esac

  if ! setup_local_fixture; then
    check "isolated fixture install" ready "$LOCAL_FIXTURE_RESULT"
    printf 'skip: the fixture-based artifact checks — the isolated install could not complete\n'
    remove_local_fixture
    run_ts_bar
    run_shell_syntax
    return 0
  fi
  check "isolated fixture install" ready ready
  check "OpenCode config contract" valid "$(opencode_config_status)"
  check "operator config keys survive an install" preserved "$(opencode_operator_keys_status)"
  check "nine skill wrappers and shared bodies installed" exact "$(opencode_skill_status)"
  check "agent contracts installed" exact "$(opencode_agent_status)"
  check "mode commands installed and routed" exact "$(opencode_command_status)"
  check "plugin entry, modules and routes installed" exact "$(opencode_plugin_status)"
  check "Engram plugin file installed" present "$(opencode_engram_status)"
  check "global guidance installed" exact "$(opencode_global_status)"
  check "operator global prose survives an install" preserved "$(opencode_operator_global_status)"
  check "installer-owned targets recorded" installer-owned "$(opencode_registry_status)"
  check "published gate bytes as installed" verified "$(opencode_trust_bytes_status)"
  check "an install outside the named home is refused" refused "$(opencode_config_home_guard_status)"
  run_ts_bar
  run_shell_syntax
  remove_local_fixture
}


SMOKE_PARENT=""
SMOKE_ROOT=""
SMOKE_HOME=""
SMOKE_MAIN=""
SMOKE_SETUP_RESULT=""
SMOKE_BREACHED=""
SMOKE_INCOMPLETE=""
WAVE_VERDICT_READER="$REPO_ROOT/tools/read-session-verdict.mjs"
SMOKE_FIXTURE_PREFIX=oso-opencode-smoke

create_wave_fixture() {
  local base_commit
  SMOKE_PARENT="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$SMOKE_PARENT" ] || { SMOKE_SETUP_RESULT=temporary-parent-unavailable; return 1; }
  if ! SMOKE_ROOT="$(mktemp -d "$SMOKE_PARENT/$SMOKE_FIXTURE_PREFIX.XXXXXX" 2>&1)"; then
    SMOKE_SETUP_RESULT="$(printf '%s' "$SMOKE_ROOT" | fold_lines)"
    return 1
  fi
  SMOKE_HOME="$SMOKE_ROOT/home"
  SMOKE_MAIN="$SMOKE_ROOT/main"
  if ! mkdir -p "$SMOKE_HOME/.config/opencode" "$SMOKE_MAIN"; then
    SMOKE_SETUP_RESULT=fixture-setup-failed
    return 1
  fi
  cat > "$SMOKE_HOME/.config/opencode/opencode.json" <<'JSON'
{
  "permission": {
    "question": "allow",
    "plan_enter": "allow",
    "plan_exit": "allow",
    "bash": {
      "*": "allow"
    }
  }
}
JSON
  printf 'baseline\n' > "$SMOKE_MAIN/baseline.txt"
  if ! git -C "$SMOKE_MAIN" init -q >/dev/null 2>&1 ||
     ! git -C "$SMOKE_MAIN" add baseline.txt >/dev/null 2>&1 ||
     ! git -C "$SMOKE_MAIN" -c core.hooksPath=/dev/null \
       -c user.name=oso-code -c user.email=smoke@oso-code.invalid \
       commit -qm 'test: wave smoke baseline' >/dev/null 2>&1; then
    SMOKE_SETUP_RESULT=baseline-setup-failed
    return 1
  fi
  base_commit="$(git -C "$SMOKE_MAIN" rev-parse HEAD 2>/dev/null)"
  if ! git -C "$SMOKE_MAIN" worktree add -qb oso/wt1 \
        "$SMOKE_ROOT/wt1" "$base_commit" >/dev/null 2>&1 ||
     ! git -C "$SMOKE_MAIN" worktree add -qb oso/wt2 \
        "$SMOKE_ROOT/wt2" "$base_commit" >/dev/null 2>&1; then
    SMOKE_SETUP_RESULT=worktree-setup-failed
    return 1
  fi
  SMOKE_SETUP_RESULT=ready
  return 0
}

cleanup_smoke_on_exit() {
  [ -n "${SMOKE_ROOT:-}" ] || return 0
  remove_temporary_fixture "$SMOKE_ROOT" "$SMOKE_PARENT" "$SMOKE_FIXTURE_PREFIX"
}

run_in_smoke_home() {
  local lane=$1
  shift
  env HOME="$SMOKE_HOME" \
    XDG_CONFIG_HOME="$SMOKE_HOME/.config" \
    XDG_STATE_HOME="$SMOKE_ROOT/state-$lane" \
    XDG_CACHE_HOME="$SMOKE_ROOT/cache-$lane" \
    XDG_DATA_HOME="$SMOKE_ROOT/data-$lane" \
    "$@"
}

choose_smoke_model() {
  local catalog="$SMOKE_ROOT/models.out"
  if [ -n "${OSO_VERIFY_SMOKE_MODEL:-}" ]; then
    SMOKE_MODEL="$OSO_VERIFY_SMOKE_MODEL"
    return 0
  fi
  run_within_bound "$SMOKE_PREFLIGHT_BOUND_SECONDS" \
    run_in_smoke_home catalog opencode models > "$catalog" 2>&1 || return 1
  SMOKE_MODEL="$(first_free_model_in "$catalog")"
  [ -n "$SMOKE_MODEL" ] || return 1
  printf 'model: %s (first free entry in this host catalog)\n' "$SMOKE_MODEL"
}

run_wave_child() {
  local name=$1 worktree=$2
  bounded_command_output "$SMOKE_BOUND_SECONDS" "wave child $name" \
    run_in_smoke_home "$name" \
      opencode run --dir "$worktree" -m "$SMOKE_MODEL" --format json \
      "Create a file named ${name}-proof.txt inside the current working directory containing the text 'proof-${name}'. Then end your reply with exactly two lines: first 'status: done', then 'verdict: pass'." \
    > "$SMOKE_ROOT/$name.json" 2>&1
}

smoke_verdict_of() {
  local reader_error="$SMOKE_ROOT/$1.verdict.err"
  node "$WAVE_VERDICT_READER" "$SMOKE_ROOT/$1.json" 2> "$reader_error" \
    || printf 'unreadable:%s' "$(fold_lines < "$reader_error")"
}

run_wave_children() {
  local verdict_wt1 verdict_wt2 breached="" incomplete=""
  run_wave_child wt1 "$SMOKE_ROOT/wt1" &
  run_wave_child wt2 "$SMOKE_ROOT/wt2" &
  wait
  verdict_wt1="$(smoke_verdict_of wt1)"
  verdict_wt2="$(smoke_verdict_of wt2)"
  [ "$verdict_wt1" = "status:done verdict:pass" ] || incomplete="$incomplete wt1-verdict(${verdict_wt1:-none})"
  [ "$verdict_wt2" = "status:done verdict:pass" ] || incomplete="$incomplete wt2-verdict(${verdict_wt2:-none})"
  [ "$(cat "$SMOKE_ROOT/wt1/wt1-proof.txt" 2>/dev/null)" = "proof-wt1" ] || incomplete="$incomplete wt1-proof"
  [ "$(cat "$SMOKE_ROOT/wt2/wt2-proof.txt" 2>/dev/null)" = "proof-wt2" ] || incomplete="$incomplete wt2-proof"
  [ -e "$SMOKE_ROOT/wt1/wt2-proof.txt" ] && breached="$breached wt1-has-wt2-proof"
  [ -e "$SMOKE_ROOT/wt2/wt1-proof.txt" ] && breached="$breached wt2-has-wt1-proof"
  [ -e "$SMOKE_MAIN/wt1-proof.txt" ] && breached="$breached root-has-wt1-proof"
  [ -e "$SMOKE_MAIN/wt2-proof.txt" ] && breached="$breached root-has-wt2-proof"
  SMOKE_BREACHED="${breached# }"
  SMOKE_INCOMPLETE="${incomplete# }"
}

worktree_permission_auto_rejected() {
  local child
  for child in wt1 wt2; do
    if grep -E 'permission requested: external_directory.*auto-rejecting' \
      "$SMOKE_ROOT/$child.json" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

wave_smoke_outcome() {
  if [ -n "$SMOKE_BREACHED" ]; then
    printf 'breached'
  elif [ -z "$SMOKE_INCOMPLETE" ]; then
    printf 'isolated'
  elif worktree_permission_auto_rejected; then
    printf 'host-refused-the-worktree'
  else
    printf 'incomplete'
  fi
}

record_smoke_not_run() {
  SMOKE_NOT_RUN_REASON=$1
  printf 'not run: wave-runner smoke — %s\n' "$1"
}

run_wave_smoke() {
  local preflight_output
  printf 'wave-runner smoke:\n'
  if [ "${OSO_VERIFY_SKIP_SMOKE:-}" = 1 ]; then
    record_smoke_not_run "OSO_VERIFY_SKIP_SMOKE asked for the skip"
    return
  fi
  if ! command -v opencode >/dev/null 2>&1; then
    record_smoke_not_run "opencode is not on PATH"
    return
  fi
  if ! command -v node >/dev/null 2>&1; then
    record_smoke_not_run "node is not on PATH, and the child verdicts are read through the plugin's own parser"
    return
  fi
  SMOKE_ROOT=""
  SMOKE_BREACHED=""
  SMOKE_INCOMPLETE=""
  trap cleanup_smoke_on_exit EXIT
  if ! create_wave_fixture; then
    check "wave-runner smoke isolates worktrees" isolated "$SMOKE_SETUP_RESULT"
  elif ! choose_smoke_model; then
    record_smoke_not_run "the host catalog offered no free model to drive the two children with"
  elif ! bounded_command_output "$SMOKE_PREFLIGHT_BOUND_SECONDS" "opencode smoke preflight" \
      run_in_smoke_home preflight \
        opencode run --dir "$SMOKE_MAIN" -m "$SMOKE_MODEL" --format json \
        'Reply with exactly: ready' \
      > "$SMOKE_ROOT/preflight.log" 2>&1; then
    preflight_output="$(cat "$SMOKE_ROOT/preflight.log" 2>/dev/null | fold_lines)"
    record_smoke_not_run "$(printf 'a headless session could not start with %s (%s)' \
      "$SMOKE_MODEL" "${preflight_output:-unavailable}")"
  else
    run_wave_children
    case "$(wave_smoke_outcome)" in
      isolated)
        check "wave-runner smoke isolates worktrees" isolated isolated ;;
      host-refused-the-worktree)
        record_smoke_not_run "the host auto-rejected an external_directory permission for the very worktree each child was pinned to, so no child could write inside the tree the isolation assertions read" ;;
      breached)
        check "wave-runner smoke isolates worktrees" isolated "$SMOKE_BREACHED" ;;
      *)
        check "wave-runner smoke isolates worktrees" isolated "$SMOKE_INCOMPLETE" ;;
    esac
  fi
  if cleanup_smoke_on_exit; then
    SMOKE_ROOT=""
    trap - EXIT
  else
    check "wave-runner smoke fixture cleanup" removed failed
  fi
}

main() {
  if [ "$#" -gt 0 ]; then
    check "verifier arguments" none "$(printf '%s ' "$@" | fold_lines)"
  fi
  run_local_checks
  run_wave_smoke
  printf '%s\n' '----'
  printf 'passed: %s, failed: %s\n' "$pass" "$fail"
  if [ -n "$SMOKE_NOT_RUN_REASON" ]; then
    printf 'wave-runner smoke not run: %s\n' "$SMOKE_NOT_RUN_REASON"
  fi
  [ "$fail" -eq 0 ] || return 1
  [ -z "$SMOKE_NOT_RUN_REASON" ] || return 3
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
