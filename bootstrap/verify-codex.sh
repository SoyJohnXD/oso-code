#!/usr/bin/env bash

set -o pipefail

CONFIG_MARKER_START="# oso-code:start"
CONFIG_MARKER_END="# oso-code:end"
FEATURE_MARKER_START="# oso-code:features:start"
FEATURE_MARKER_END="# oso-code:features:end"
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
. "$SCRIPT_DIR/lib/verification-fixtures.sh"
. "$SCRIPT_DIR/lib/codex-managed-config.sh"
. "$SCRIPT_DIR/lib/engram-codex-pointers.sh"
SUPPORTED_CODEX_VERSION="$(sed -n 's/^SUPPORTED_CODEX_VERSION=//p' "$SCRIPT_DIR/install-codex.sh")"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
RUNTIME_ROOT="$HOME/.local/share/oso-code/runtime"
MARKETPLACE_ROOT="$HOME/.local/share/oso-code/codex-marketplace"
IMPECCABLE_MOUNT="$HOME/.agents/skills/impeccable"
IMPECCABLE_OPT_OUT_MARKER="$HOME/.local/state/oso-code/impeccable-opt-out"
HASHES_FILE="$SCRIPT_DIR/hook-hashes.txt"
CONFIG_FILE="$CODEX_HOME/config.toml"
GLOBAL_FILE="$CODEX_HOME/AGENTS.md"
HOOKS_FILE="$CODEX_HOME/hooks.json"
AGENTS_DIR="$CODEX_HOME/agents"
SMOKE_FIXTURE_PREFIX=oso-codex-smoke
SMOKE_HANDOFF_SLICE=codex-integrator-smoke
SMOKE_HANDOFF_ATTEMPT=1
SMOKE_INTEGRATOR_AGENT_TYPE=oso-integrator

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

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{ print $1 }'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum 2>/dev/null | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 2>/dev/null | awk '{ print $1 }'
  fi
}

running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

shell_spelling_of() {
  if running_on_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

codex_version_status() {
  local output version
  if ! output="$(codex --version 2>&1)"; then
    printf '%s' "$(printf '%s' "$output" | fold_lines)"
    return
  fi
  version="${output##* }"
  printf '%s' "$version"
}

codex_binary_path() {
  local resolved
  resolved="$(command -v codex 2>/dev/null)" || return 1
  if command -v readlink >/dev/null 2>&1; then
    resolved="$(readlink -f "$resolved" 2>/dev/null || printf '%s' "$resolved")"
  fi
  printf '%s' "$resolved"
}

binary_contract_status() {
  local literal_a="$1" literal_b="$2" resolved installed_version
  resolved="$(codex_binary_path)" || { printf 'codex-not-on-path'; return; }
  installed_version="$(codex_version_status)"
  if [ "$installed_version" != "$SUPPORTED_CODEX_VERSION" ]; then
    printf 'unverified:%s' "$installed_version"
    return
  fi
  if grep -aq "$literal_a" "$resolved" 2>/dev/null &&
     grep -aq "$literal_b" "$resolved" 2>/dev/null; then
    printf conformant
  else
    printf nonconformant
  fi
}

host_contract_status() {
  binary_contract_status \
    'fork_context is not supported in MultiAgentV2; use fork_turns instead' \
    'fork_turns must be `none`, `all`, or a positive integer string'
}

permission_override_contract_status() {
  binary_contract_status \
    'default_permissions refers to undefined profile `' \
    '`permission_profile` and `default_permissions` overrides cannot both be set'
}

plugin_install_status() {
  local listing candidate_source_paths source_path
  if ! command -v python3 >/dev/null 2>&1; then
    printf 'python3 unavailable'
    return
  fi
  if ! listing="$(codex plugin list --json 2>&1)"; then
    printf '%s' "$(printf '%s' "$listing" | fold_lines)"
    return
  fi
  candidate_source_paths="$(printf '%s' "$listing" | python3 -c '
import json, sys

manifest_path = sys.argv[1]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)
expected_name = manifest.get("name")
expected_version = manifest.get("version")
expected_plugin_id = f"{expected_name}@{expected_name}"
installed = json.load(sys.stdin).get("installed", [])
for plugin in installed:
    if not isinstance(plugin, dict):
        continue
    if plugin.get("pluginId") != expected_plugin_id:
        continue
    if plugin.get("marketplaceName") != expected_name:
        continue
    if plugin.get("version") != expected_version:
        continue
    if plugin.get("installed") is not True or plugin.get("enabled") is not True:
        continue
    source = plugin.get("source")
    if not isinstance(source, dict) or source.get("source") != "local":
        continue
    path = source.get("path")
    if isinstance(path, str):
        print(path)
' "$REPO_ROOT/codex/.codex-plugin/plugin.json" 2>/dev/null)"
  while IFS= read -r source_path; do
    [ -n "$source_path" ] || continue
    [ "$(shell_spelling_of "$source_path")" = "$MARKETPLACE_ROOT/codex" ] || continue
    printf installed
    return
  done <<EOF
$candidate_source_paths
EOF
  printf absent-or-invalid
}

installed_trust_status() {
  local expected relative installed actual escaped_runtime missing=""
  [ -f "$HASHES_FILE" ] || { printf 'missing hash manifest'; return; }
  escaped_runtime="$(escape_sed_pattern "$RUNTIME_ROOT")"
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in opencode/*) continue ;; esac
    case "$relative" in
      codex/hooks/hooks.json)
        installed="$HOOKS_FILE"
        if [ -f "$installed" ]; then
          actual="$(sed "s|$escaped_runtime/dist|__OSO_HOOKS_DIR__|g" "$installed" | sha256_stream)"
        else
          actual=""
        fi
        ;;
      plugin/dist/*)
        installed="$RUNTIME_ROOT/dist/${relative#plugin/dist/}"
        actual="$(sha256_file "$installed")"
        ;;
      plugin/hooks/*)
        installed="$RUNTIME_ROOT/hooks/${relative#plugin/hooks/}"
        actual="$(sha256_file "$installed")"
        ;;
      plugin/git-hooks/*)
        installed="$RUNTIME_ROOT/git-hooks/${relative#plugin/git-hooks/}"
        actual="$(sha256_file "$installed")"
        ;;
      plugin/bin/*)
        installed="$RUNTIME_ROOT/bin/${relative#plugin/bin/}"
        actual="$(sha256_file "$installed")"
        ;;
      *)
        installed=""
        actual=""
        ;;
    esac
    [ -n "$installed" ] && [ "$actual" = "$expected" ] || missing="$missing $relative"
  done < "$HASHES_FILE"
  if [ -n "$missing" ]; then printf 'bad:%s' "$missing"; else printf verified; fi
}

runtime_executable_status() {
  local executable missing=""
  for executable in "$RUNTIME_ROOT"/hooks/*.sh "$RUNTIME_ROOT/bin/oso-state" \
    "$RUNTIME_ROOT/git-hooks/pre-commit"; do
    [ -f "$executable" ] && [ -x "$executable" ] || missing="$missing ${executable#$HOME/}"
  done
  if [ -n "$missing" ]; then printf 'not-executable:%s' "$missing"; else printf executable; fi
}

agent_payload_status() {
  local source installed divergent=""
  for source in "$REPO_ROOT"/codex/agents/*.toml; do
    installed="$AGENTS_DIR/$(basename "$source")"
    [ -f "$installed" ] && [ ! -L "$installed" ] && cmp -s "$source" "$installed" ||
      divergent="$divergent $(basename "$source")"
  done
  if [ -n "$divergent" ]; then printf 'divergent:%s' "$divergent"; else printf exact; fi
}

marketplace_payload_status() {
  local source installed divergent=""
  for source in \
    "$REPO_ROOT/.agents/plugins/marketplace.json" \
    "$REPO_ROOT/codex/.codex-plugin/plugin.json"; do
    case "$source" in
      */.agents/plugins/marketplace.json)
        installed="$MARKETPLACE_ROOT/.agents/plugins/marketplace.json"
        ;;
      *) installed="$MARKETPLACE_ROOT/codex/.codex-plugin/plugin.json" ;;
    esac
    [ -f "$installed" ] && cmp -s "$source" "$installed" || divergent="$divergent $(basename "$source")"
  done
  for source in "$REPO_ROOT"/codex/skills/*/SKILL.md; do
    installed="$MARKETPLACE_ROOT/codex/skills/$(basename "$(dirname "$source")")/SKILL.md"
    [ -f "$installed" ] && [ ! -L "$installed" ] && cmp -s "$source" "$installed" ||
      divergent="$divergent $(basename "$(dirname "$source")")"
  done
  [ -d "$MARKETPLACE_ROOT/codex/skills/_shared" ] &&
    diff -qr "$REPO_ROOT/plugin/skills/_shared" \
      "$MARKETPLACE_ROOT/codex/skills/_shared" >/dev/null 2>&1 || divergent="$divergent shared"
  if [ -n "$divergent" ]; then printf 'divergent:%s' "$divergent"; else printf exact; fi
}

config_region_status() {
  local installed expected feature_status=0
  [ -f "$CONFIG_FILE" ] || { printf missing; return; }
  if ! installed="$(awk -v action=extract -v require_region=1 \
      -v start_marker="$CONFIG_MARKER_START" \
      -v end_marker="$CONFIG_MARKER_END" -f "$SCRIPT_DIR/lib/toml-regions.awk" \
      "$CONFIG_FILE" 2>/dev/null)"; then
    printf malformed
    return
  fi
  expected="$(render_codex_managed_config "$HOME" "$RUNTIME_ROOT")"
  [ "$installed" = "$expected" ] || { printf divergent; return; }
  codex_managed_features_region_status "$CONFIG_FILE" \
    "$SCRIPT_DIR/lib/toml-regions.awk" \
    "$FEATURE_MARKER_START" "$FEATURE_MARKER_END" || feature_status=$?
  case "$feature_status" in
    0) printf valid ;;
    1) printf missing-features ;;
    2) printf malformed-features ;;
    3) printf divergent-features ;;
    *) printf feature-check-error-%s "$feature_status" ;;
  esac
}

global_guidance_status() {
  local installed expected
  [ -f "$GLOBAL_FILE" ] || { printf missing; return; }
  if ! installed="$(awk -v start="$GLOBAL_MARKER_START" -v end="$GLOBAL_MARKER_END" '
    $0 == start { starts++; inside = 1; next }
    $0 == end { ends++; inside = 0; next }
    inside { print }
    END { if (starts != 1 || ends != 1 || inside) exit 1 }
  ' "$GLOBAL_FILE" 2>/dev/null)"; then
    printf malformed
    return
  fi
  expected="$(cat "$SCRIPT_DIR/codex-global.md" 2>/dev/null)"
  if [ "$installed" = "$expected" ]; then printf exact; else printf divergent; fi
}

engram_status() {
  local instructions="$CODEX_HOME/engram-instructions.md"
  local compact="$CODEX_HOME/engram-compact-prompt.md" normalized status=0
  [ -f "$instructions" ] && [ -f "$compact" ] && [ -f "$CONFIG_FILE" ] &&
    grep -Fqx '[mcp_servers.engram]' "$CONFIG_FILE" >/dev/null 2>&1 || {
      printf incomplete
      return
    }
  normalized="$(mktemp "${TMPDIR:-/tmp}/oso-engram-config.XXXXXX")" || {
    printf temporary-file-unavailable
    return
  }
  normalize_engram_codex_pointers \
    "$CONFIG_FILE" "$normalized" \
    "$CONFIG_MARKER_START" "$CONFIG_MARKER_END" \
    model_instructions_file experimental_compact_prompt_file \
    "$instructions" "$compact" \
    "$SCRIPT_DIR/lib/toml-regions.awk" 1 || status=$?
  if [ "$status" -eq 0 ] && cmp -s "$CONFIG_FILE" "$normalized"; then
    printf wired
  else
    printf incomplete
  fi
  rm -f "$normalized"
}

MCP_DRIFT_BOUND_SECONDS="${OSO_MCP_DRIFT_BOUND_SECONDS:-10}"

CODEX_LOGIN_STATUS_BOUND_SECONDS="${OSO_CODEX_LOGIN_STATUS_BOUND_SECONDS:-20}"
CODEX_EXEC_SMOKE_BOUND_SECONDS="${OSO_CODEX_EXEC_SMOKE_BOUND_SECONDS:-180}"

bounded_command_output() {
  local bound_seconds=$1 label=$2 out pid waited=0 rc
  shift 2
  out="$(mktemp "${TMPDIR:-/tmp}/oso-bounded.XXXXXX")" || return 1
  ( set -m
    "$@" >"$out" 2>&1 &
    pid=$!
    set +m
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$bound_seconds" ]; then
        kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
        exit 124
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "$pid"
  )
  rc=$?
  if [ "$rc" -eq 124 ]; then
    printf 'SLOW: %s did not answer within %ss\n' "$label" "$bound_seconds"
  else
    cat "$out"
  fi
  rm -f "$out"
  return "$rc"
}

mcp_server_names() {
  awk '
    /^\[mcp_servers\.[^]]+\]/ {
      name = $0
      sub(/^\[mcp_servers\./, "", name)
      sub(/\].*/, "", name)
      gsub(/^"|"$/, "", name)
      print name
    }
  ' "$CONFIG_FILE" 2>/dev/null
}

mcp_server_command() {
  local server="$1"
  awk -v target="[mcp_servers.$server]" '
    function unquote(v) { gsub(/^"|"$/, "", v); return v }
    /^\[/ { inside = ($0 == target) }
    inside && /^command[[:space:]]*=/ {
      value = $0
      sub(/^command[[:space:]]*=[[:space:]]*/, "", value)
      print unquote(value)
    }
    inside && /^args[[:space:]]*=/ {
      value = $0
      sub(/^args[[:space:]]*=[[:space:]]*\[/, "", value)
      sub(/\][[:space:]]*$/, "", value)
      n = split(value, parts, ",")
      for (i = 1; i <= n; i++) {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[i])
        if (parts[i] != "") print unquote(parts[i])
      }
    }
  ' "$CONFIG_FILE" 2>/dev/null
}

server_mandated_tools() {
  case "$1" in
    engram)
      printf '%s\n' mem_save mem_search mem_context mem_session_summary \
        mem_get_observation mem_save_prompt mem_current_project mem_judge
      ;;
  esac
}

mcp_server_tool_names() {
  local command="$1" out line pid waited
  shift
  out="$(mktemp "${TMPDIR:-/tmp}/oso-mcp-tools.XXXXXX")" || return 1
  ( set -m
    { printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"oso-verify-codex","version":"1"}}}'
      printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
      sleep "$MCP_DRIFT_BOUND_SECONDS"
    } | "$command" "$@" >"$out" 2>/dev/null &
    pid=$!
    waited=0
    while kill -0 "$pid" 2>/dev/null; do
      grep -q '"id":2,"result"' "$out" 2>/dev/null && break
      if [ "$waited" -ge "$MCP_DRIFT_BOUND_SECONDS" ]; then
        kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    kill -TERM "-$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  )
  line="$(grep -m1 '"id":2,"result"' "$out" 2>/dev/null)"
  if [ -n "$line" ] && command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$line" | jq -r '.result.tools[]?.name // empty' 2>/dev/null
  elif [ -n "$line" ]; then
    printf '%s\n' "$line" | grep -o '"name":"[^"]*"' | sed 's/^"name":"//; s/"$//'
  fi
  rm -f "$out"
}

table_codex_tools_for_server() {
  awk -v want="mcp__$1__" '
    $1 == "tool" && index($4, want) == 1 { print $4 }
  ' "$REPO_ROOT/tools/hook-gates.txt" | sort -u
}

table_has_codex_tool() {
  awk -v want="$1" '$1 == "tool" && $4 == want { found = 1 } END { exit !found }' \
    "$REPO_ROOT/tools/hook-gates.txt"
}

table_codex_tool_is_mandated() {
  awk -v want="$1" '$1 == "tool" && $4 == want && $NF == "yes" { found = 1 } END { exit !found }' \
    "$REPO_ROOT/tools/hook-gates.txt"
}

KNOWN_MCP_SERVERS="engram context7 fallow"

table_mandated_agreement_status() {
  local server name row bare mismatch=""
  for server in $KNOWN_MCP_SERVERS; do
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      table_codex_tool_is_mandated "mcp__${server}__${name}" ||
        mismatch="${mismatch:+$mismatch,}mcp__${server}__${name}(hardcoded-not-a-yes-row)"
    done <<EOF
$(server_mandated_tools "$server")
EOF
  done
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    for server in $KNOWN_MCP_SERVERS; do
      case "$row" in
        "mcp__${server}__"*)
          bare="${row#mcp__${server}__}"
          printf '%s\n' "$(server_mandated_tools "$server")" | grep -qxF "$bare" ||
            mismatch="${mismatch:+$mismatch,}$row(yes-row-not-hardcoded)"
          break
          ;;
      esac
    done
  done <<EOF
$(awk '$1 == "tool" && $NF == "yes" && $4 ~ /^mcp__/ { print $4 }' "$REPO_ROOT/tools/hook-gates.txt" | sort -u)
EOF
  printf '%s' "${mismatch:-agree}"
}

mcp_missing_mandated_tools() {
  local server="$1" exposed="$2" name row missing=""
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '%s\n' "$exposed" | grep -qxF "$name" || continue
    row="mcp__${server}__${name}"
    table_has_codex_tool "$row" || missing="${missing:+$missing,}$row"
  done <<EOF
$(server_mandated_tools "$server")
EOF
  printf '%s' "${missing:-none}"
}

mcp_stale_table_rows() {
  local server="$1" exposed="$2" row bare stale=""
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    bare="${row#mcp__${server}__}"
    printf '%s\n' "$exposed" | grep -qxF "$bare" || stale="${stale:+$stale,}$row"
  done <<EOF
$(table_codex_tools_for_server "$server")
EOF
  printf '%s' "${stale:-none}"
}

run_mcp_tool_drift_checks() {
  local server command_line argv_token argv exposed
  printf 'MCP tool table drift:\n'
  check "the hardcoded mandated tool list agrees with tools/hook-gates.txt in both directions" \
    agree "$(table_mandated_agreement_status)"
  while IFS= read -r server; do
    [ -n "$server" ] || continue
    command_line="$(mcp_server_command "$server")"
    if [ -z "$command_line" ]; then
      printf 'skip: %s MCP tool drift — no local command in %s (a remote/URL-based server has no process this check spawns)\n' \
        "$server" "$CONFIG_FILE"
      continue
    fi
    argv=()
    while IFS= read -r argv_token; do
      [ -n "$argv_token" ] && argv+=("$argv_token")
    done <<EOF
$command_line
EOF
    if ! command -v "${argv[0]}" >/dev/null 2>&1 && [ ! -x "${argv[0]}" ]; then
      printf 'skip: %s MCP tool drift — %s is not executable, so the live tool list could not be read\n' \
        "$server" "${argv[0]}"
      continue
    fi
    exposed="$(mcp_server_tool_names "${argv[@]}")"
    if [ -z "$exposed" ]; then
      printf 'skip: %s MCP tool drift — tools/list did not answer within %ss, so drift could not be checked\n' \
        "$server" "$MCP_DRIFT_BOUND_SECONDS"
      continue
    fi
    check "$server MCP protocol-mandated tools present in tools/hook-gates.txt" \
      none "$(mcp_missing_mandated_tools "$server" "$exposed")"
    check "$server MCP table rows all match a live tool" \
      none "$(mcp_stale_table_rows "$server" "$exposed")"
  done <<EOF
$(mcp_server_names)
EOF
}

impeccable_status() {
  if [ -f "$IMPECCABLE_OPT_OUT_MARKER" ]; then
    printf opted-out
  elif [ -f "$IMPECCABLE_MOUNT/SKILL.md" ] && [ ! -L "$IMPECCABLE_MOUNT" ]; then
    printf mounted
  else
    printf missing
  fi
}

git_hook_status() {
  local configured
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  if [ "$configured" = "$RUNTIME_ROOT/git-hooks" ] &&
     [ -x "$RUNTIME_ROOT/git-hooks/pre-commit" ]; then
    printf wired
  else
    printf optional-unwired
  fi
}

codex_config_runtime_status() {
  local output expected
  expected="1
$RUNTIME_ROOT/bin/oso-state"
  if output="$(codex sandbox -P oso -- /bin/sh -c \
      'printf "%s\n%s\n" "${OSO_AGENT:-}" "${OSO_STATE_BIN:-}"' 2>&1)" &&
     [ "$output" = "$expected" ]; then
    printf accepted
  else
    printf '%s' "$(printf '%s' "${output:-rejected-without-output}" | fold_lines)"
  fi
}

state_round_trip_status() {
  local probe_prefix=oso-state-probe probe_parent probe_root probe_repo probe_value
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$probe_parent" ] || { printf temporary-parent-unavailable; return; }
  if ! probe_root="$(mktemp -d "$probe_parent/$probe_prefix.XXXXXX" 2>&1)"; then
    printf '%s' "$(printf '%s' "$probe_root" | fold_lines)"
    return
  fi
  probe_repo="$probe_root/repo"
  mkdir -p "$probe_repo"
  git -C "$probe_repo" init -q >/dev/null 2>&1 || probe_value=git-init-failed
  if [ -z "${probe_value:-}" ]; then
    probe_value="$(
      cd "$probe_repo" || exit 1
      HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" \
        --session 1 set mode=probe >/dev/null 2>&1 &&
        HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" --session 1 get mode 2>&1 &&
        HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" --session 1 clear >/dev/null 2>&1
    )" ||
      probe_value="round-trip-failed:${probe_value:-empty}"
  fi
  remove_temporary_fixture "$probe_root" "$probe_parent" "$probe_prefix" ||
    probe_value="${probe_value:-empty}:cleanup-failed"
  printf '%s' "$probe_value"
}

plan_artifact_round_trip_status() {
  local probe_prefix=oso-plan-probe probe_parent probe_root probe_repo probe_value="" digest
  local state_output snapshot current
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$probe_parent" ] || { printf temporary-parent-unavailable; return; }
  if ! probe_root="$(mktemp -d "$probe_parent/$probe_prefix.XXXXXX" 2>&1)"; then
    printf '%s' "$(printf '%s' "$probe_root" | fold_lines)"
    return
  fi
  probe_repo="$probe_root/repo"
  mkdir -p "$probe_repo"
  digest="$(printf '%064d' 1)"
  git -C "$probe_repo" init -q >/dev/null 2>&1 || probe_value=git-init-failed
  if [ -z "$probe_value" ]; then
    state_output="$({
      cd "$probe_repo" || exit 1
      printf '# Verified plan' | HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" \
        --session 1 capture-plan "$digest" >/dev/null 2>&1 &&
        HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" --session 1 \
          approve-plan "$digest" >/dev/null 2>&1 &&
        printf '### Slice probe' | HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" \
          --session 1 amend-plan probe-slice >/dev/null 2>&1 &&
        HOME="$probe_root" "$RUNTIME_ROOT/bin/oso-state" --session 1 show
    } 2>&1)" || probe_value="artifact-round-trip-failed:${state_output:-empty}"
  fi
  if [ -z "$probe_value" ]; then
    snapshot="$(printf '%s\n' "$state_output" | sed -n 's/^plan_snapshot_file=//p')"
    current="$(printf '%s\n' "$state_output" | sed -n 's/^plan_current_file=//p')"
    if [ "$(printf '%s\n' "$state_output" | sed -n 's/^plan_approval=//p')" = approved ] &&
       [ "$(printf '%s\n' "$state_output" | sed -n 's/^plan_revision=//p')" = 1 ] &&
       [ -f "$snapshot" ] && [ ! -L "$snapshot" ] &&
       [ "$(cat "$snapshot")" = '# Verified plan' ] &&
       [ -f "$current" ] && [ ! -L "$current" ] &&
       grep -qF '## Execution amendment — probe-slice' "$current"; then
      probe_value=artifacts
    else
      probe_value=artifact-contract-mismatch
    fi
  fi
  remove_temporary_fixture "$probe_root" "$probe_parent" "$probe_prefix" ||
    probe_value="${probe_value:-empty}:cleanup-failed"
  printf '%s' "$probe_value"
}

commit_hook_red_status() {
  local probe_prefix=oso-git-hook-probe probe_parent probe_root probe_repo base_commit denied_output result
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$probe_parent" ] || { printf temporary-parent-unavailable; return; }
  if ! probe_root="$(mktemp -d "$probe_parent/$probe_prefix.XXXXXX" 2>&1)"; then
    printf '%s' "$(printf '%s' "$probe_root" | fold_lines)"
    return
  fi
  probe_repo="$probe_root/repo"
  mkdir -p "$probe_repo"
  printf 'baseline\n' > "$probe_repo/baseline.txt"
  result=setup-failed
  if git -C "$probe_repo" init -q >/dev/null 2>&1 &&
     git -C "$probe_repo" add baseline.txt >/dev/null 2>&1 &&
     git -C "$probe_repo" -c core.hooksPath=/dev/null \
       -c user.name=oso-code -c user.email=probe@oso-code.invalid \
       commit -qm 'test: baseline' >/dev/null 2>&1; then
    base_commit="$(git -C "$probe_repo" rev-parse HEAD 2>/dev/null)"
    printf 'pending\n' > "$probe_repo/pending.txt"
    if (cd "$probe_repo" && HOME="$probe_root" \
        "$RUNTIME_ROOT/bin/oso-state" --session 1 \
        set mode=quick active_slice=none verify_green=false >/dev/null 2>&1) &&
       git -C "$probe_repo" config core.hooksPath "$RUNTIME_ROOT/git-hooks" &&
       git -C "$probe_repo" add pending.txt >/dev/null 2>&1; then
      if denied_output="$(HOME="$probe_root" OSO_AGENT=1 \
          git -C "$probe_repo" -c user.name=oso-code -c user.email=probe@oso-code.invalid \
          commit -m 'test: must be denied' 2>&1)"; then
        result=commit-was-allowed
      elif [ "$(git -C "$probe_repo" rev-parse HEAD 2>/dev/null)" = "$base_commit" ] &&
           printf '%s' "$denied_output" | grep -F 'session verify is not green' >/dev/null 2>&1; then
        result=denied
      else
        result="$(printf '%s' "$denied_output" | fold_lines)"
      fi
    fi
  fi
  remove_temporary_fixture "$probe_root" "$probe_parent" "$probe_prefix" || result="$result:cleanup-failed"
  printf '%s' "$result"
}

integrator_handoff_consumed() {
  command -v python3 >/dev/null 2>&1 || return 1
  printf '%s\n' "$SMOKE_OUTPUT" | python3 -c '
import json, sys
import shlex

expected_slice, expected_attempt, expected_agent_type = sys.argv[1:4]
receipt_keys = {"version", "hook_session", "slice", "attempt", "agent_id", "agent_type"}
handoff_option_keys = {"--slice", "--attempt", "--agent-id", "--agent-type"}

def completed_successfully(item):
    if item.get("status") != "completed":
        return False
    exit_code = item.get("exit_code")
    return exit_code in (None, 0)

def candidate_command_tokens(command):
    if not isinstance(command, str):
        return
    try:
        outer_tokens = shlex.split(command, comments=True)
    except ValueError:
        outer_tokens = []
    groups = []
    if outer_tokens:
        groups.append(outer_tokens)
    for index, token in enumerate(outer_tokens[:-1]):
        if token in ("-c", "-lc"):
            try:
                groups.append(shlex.split(outer_tokens[index + 1], comments=True))
            except ValueError:
                pass
    for tokens in groups:
        for index, token in enumerate(tokens):
            if token.split("/")[-1] == "oso-state":
                yield tokens[index:]

def handoff_command_agent_id(command):
    for tokens in candidate_command_tokens(command):
        if len(tokens) < 3 or tokens[0].split("/")[-1] != "oso-state" or tokens[1] != "handoff":
            continue
        verb = tokens[2]
        if verb not in ("wait", "consume"):
            continue
        option_tokens = tokens[3:]
        if len(option_tokens) % 2 != 0:
            continue
        allowed = handoff_option_keys | ({"--timeout"} if verb == "wait" else set())
        parsed = {}
        for index in range(0, len(option_tokens), 2):
            key, value = option_tokens[index], option_tokens[index + 1]
            if key not in allowed or key in parsed:
                break
            parsed[key] = value
        else:
            if verb == "wait" and "--timeout" not in parsed:
                continue
            if parsed.get("--slice") == expected_slice and \
                    parsed.get("--attempt") == expected_attempt and \
                    parsed.get("--agent-type") == expected_agent_type and \
                    parsed.get("--agent-id"):
                return verb, parsed["--agent-id"]
    return None, None

def command_stdout(item):
    for key in ("stdout", "output", "aggregated_output"):
        value = item.get(key)
        if isinstance(value, str):
            return value
    return ""

def receipt_from(output):
    lines = output.splitlines()
    if len(lines) != 6:
        return None
    receipt = {}
    for line in lines:
        if "=" not in line:
            return None
        key, value = line.split("=", 1)
        if key not in receipt_keys or key in receipt or value == "":
            return None
        receipt[key] = value
    if set(receipt) != receipt_keys or receipt["version"] != "1":
        return None
    return receipt

def receipt_matches(item, agent_id):
    receipt = receipt_from(command_stdout(item))
    return bool(receipt) and \
        receipt["slice"] == expected_slice and \
        receipt["attempt"] == expected_attempt and \
        receipt["agent_id"] == agent_id and \
        receipt["agent_type"] == expected_agent_type

spawned_agent_ids = set()
waited_agent_ids = set()
consumed_agent_ids = set()

for line in sys.stdin:
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    if event.get("type") != "item.completed":
        continue
    item = event.get("item", {})
    if not isinstance(item, dict):
        continue
    if item.get("type") == "collab_tool_call":
        if item.get("tool") == "spawn_agent" and item.get("status") == "completed":
            for agent_id in item.get("receiver_thread_ids") or []:
                if isinstance(agent_id, str) and agent_id:
                    spawned_agent_ids.add(agent_id)
        continue
    if item.get("type") != "command_execution" or not completed_successfully(item):
        continue
    verb, agent_id = handoff_command_agent_id(item.get("command"))
    if not agent_id or not receipt_matches(item, agent_id):
        continue
    (waited_agent_ids if verb == "wait" else consumed_agent_ids).add(agent_id)

correlated = spawned_agent_ids & waited_agent_ids & consumed_agent_ids
raise SystemExit(0 if correlated else 1)
' "$SMOKE_HANDOFF_SLICE" "$SMOKE_HANDOFF_ATTEMPT" "$SMOKE_INTEGRATOR_AGENT_TYPE" >/dev/null 2>&1
}

populate_smoke_codex_home() {
  SMOKE_CODEX_HOME="$SMOKE_ROOT/codex-home"
  mkdir -p "$SMOKE_CODEX_HOME" && chmod 700 "$SMOKE_CODEX_HOME" || {
    SMOKE_SETUP_RESULT=codex-home-setup-failed
    return 1
  }
  [ -f "$CODEX_HOME/auth.json" ] || {
    SMOKE_SETUP_RESULT=codex-auth-missing
    return 1
  }
  cp "$CODEX_HOME/auth.json" "$SMOKE_CODEX_HOME/auth.json" &&
    chmod 600 "$SMOKE_CODEX_HOME/auth.json" || {
    SMOKE_SETUP_RESULT=codex-auth-copy-failed
    return 1
  }
  [ -d "$AGENTS_DIR" ] && [ -f "$HOOKS_FILE" ] || {
    SMOKE_SETUP_RESULT=codex-install-incomplete
    return 1
  }
  cp -R "$AGENTS_DIR" "$SMOKE_CODEX_HOME/agents" &&
    cp "$HOOKS_FILE" "$SMOKE_CODEX_HOME/hooks.json" || {
    SMOKE_SETUP_RESULT=codex-payload-copy-failed
    return 1
  }
  { render_codex_managed_config "$SMOKE_CODEX_HOME" "$RUNTIME_ROOT" &&
    printf '\n[features]\n' &&
    render_codex_managed_features; } > "$SMOKE_CODEX_HOME/config.toml" &&
    chmod 600 "$SMOKE_CODEX_HOME/config.toml" || {
    SMOKE_SETUP_RESULT=codex-config-render-failed
    return 1
  }
}

create_integrator_fixture() {
  SMOKE_PARENT="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$SMOKE_PARENT" ] || { SMOKE_SETUP_RESULT=temporary-parent-unavailable; return 1; }
  if ! SMOKE_ROOT="$(mktemp -d "$SMOKE_PARENT/$SMOKE_FIXTURE_PREFIX.XXXXXX" 2>&1)"; then
    SMOKE_SETUP_RESULT="$(printf '%s' "$SMOKE_ROOT" | fold_lines)"
    return 1
  fi
  SMOKE_MAIN="$SMOKE_ROOT/main"
  SMOKE_WORKTREE="$SMOKE_ROOT/slice"
  mkdir -p "$SMOKE_MAIN"
  printf 'baseline\n' > "$SMOKE_MAIN/baseline.txt"
  if ! git -C "$SMOKE_MAIN" init -q >/dev/null 2>&1 ||
     ! git -C "$SMOKE_MAIN" add baseline.txt >/dev/null 2>&1 ||
     ! git -C "$SMOKE_MAIN" -c core.hooksPath=/dev/null \
       -c user.name=oso-code -c user.email=smoke@oso-code.invalid \
       commit -qm 'test: create smoke baseline' >/dev/null 2>&1; then
    SMOKE_SETUP_RESULT=baseline-setup-failed
    return 1
  fi
  SMOKE_BASE_COMMIT="$(git -C "$SMOKE_MAIN" rev-parse HEAD 2>/dev/null)"
  if ! git -C "$SMOKE_MAIN" worktree add -qb oso-smoke-slice \
      "$SMOKE_WORKTREE" >/dev/null 2>&1; then
    SMOKE_SETUP_RESULT=worktree-setup-failed
    return 1
  fi
  printf 'integrated by oso-integrator\n' > "$SMOKE_WORKTREE/integrated.txt"
  if ! git -C "$SMOKE_WORKTREE" add integrated.txt >/dev/null 2>&1 ||
     ! git -C "$SMOKE_WORKTREE" -c core.hooksPath=/dev/null \
       -c user.name=oso-code -c user.email=smoke@oso-code.invalid \
       commit -qm 'test: add integrator payload' >/dev/null 2>&1; then
    SMOKE_SETUP_RESULT=slice-setup-failed
    return 1
  fi
  SMOKE_SLICE_COMMIT="$(git -C "$SMOKE_WORKTREE" rev-parse HEAD 2>/dev/null)"
  populate_smoke_codex_home || return 1
  SMOKE_SETUP_RESULT=ready
}

cleanup_smoke_on_exit() {
  [ -n "${SMOKE_ROOT:-}" ] || return 0
  remove_temporary_fixture "$SMOKE_ROOT" "$SMOKE_PARENT" "$SMOKE_FIXTURE_PREFIX"
}

run_integrator_fixture() {
  local smoke_worktrees

  SMOKE_OUTPUT="$(CODEX_HOME="$SMOKE_CODEX_HOME" \
    bounded_command_output "$CODEX_EXEC_SMOKE_BOUND_SECONDS" "codex exec smoke" \
    codex exec --ephemeral --json --sandbox danger-full-access --color never \
    --dangerously-bypass-hook-trust \
    -C "$SMOKE_MAIN" --add-dir "$SMOKE_ROOT" \
    "Delegate exactly one wave to the custom oso-integrator agent; never merge inline. Select agent_type oso-integrator explicitly and launch it with fresh context by setting fork_turns=\"none\" in the v2 spawn arguments beside a task_name; never use a full-history fork. Main checkout: $SMOKE_MAIN. BASE REF: $SMOKE_BASE_COMMIT. HANDOFF SLICE: $SMOKE_HANDOFF_SLICE. HANDOFF ATTEMPT: $SMOKE_HANDOFF_ATTEMPT. The complete wave has one slice, in this order: BRANCH oso-smoke-slice, WORKTREE PATH $SMOKE_WORKTREE. Require the integrator to begin its final message with exactly: oso-handoff: v=1 slice=$SMOKE_HANDOFF_SLICE attempt=$SMOKE_HANDOFF_ATTEMPT. Retain the spawned agent id, wait for the report, then run exactly oso-state handoff wait --slice $SMOKE_HANDOFF_SLICE --attempt $SMOKE_HANDOFF_ATTEMPT --agent-id <agent-id> --agent-type $SMOKE_INTEGRATOR_AGENT_TYPE --timeout 10 and exactly once oso-state handoff consume --slice $SMOKE_HANDOFF_SLICE --attempt $SMOKE_HANDOFF_ATTEMPT --agent-id <agent-id> --agent-type $SMOKE_INTEGRATOR_AGENT_TYPE from the main checkout. Do not quote or summarize the child report in your final response.")" || return 1
  integrator_handoff_consumed &&
    [ -f "$SMOKE_MAIN/integrated.txt" ] &&
    grep -Fqx 'integrated by oso-integrator' "$SMOKE_MAIN/integrated.txt" &&
    git -C "$SMOKE_MAIN" merge-base --is-ancestor "$SMOKE_SLICE_COMMIT" HEAD >/dev/null 2>&1 &&
    ! git -C "$SMOKE_MAIN" show-ref --verify --quiet refs/heads/oso-smoke-slice &&
    smoke_worktrees="$(git -C "$SMOKE_MAIN" worktree list --porcelain)" &&
    ! printf '%s\n' "$smoke_worktrees" | grep -F "$SMOKE_WORKTREE" >/dev/null 2>&1
}

report_binary_contract_status() {
  local short_label="$1" full_check_name="$2" result="$3"
  case "$result" in
    codex-not-on-path)
      printf 'skip: %s — codex is not on PATH, so the host contract could not be asserted\n' "$short_label"
      ;;
    unverified:*)
      printf 'unverified: %s — claims were verified against Codex %s only; installed %s falls outside that window, so pass/fail is not asserted here\n' \
        "$short_label" "$SUPPORTED_CODEX_VERSION" "${result#unverified:}"
      ;;
    conformant)
      check "$full_check_name" conformant conformant
      ;;
    *)
      check "$full_check_name" conformant "$result"
      ;;
  esac
}

run_local_checks() {
  printf 'local checks:\n'
  check "Codex CLI version" "$SUPPORTED_CODEX_VERSION" "$(codex_version_status)"
  report_binary_contract_status "Codex host contract" \
    "Codex binary matches the fork_turns host contract" "$(host_contract_status)"
  report_binary_contract_status "Codex permission-override contract" \
    "Codex binary matches the default_permissions override contract" \
    "$(permission_override_contract_status)"
  check "oso-code plugin installed" installed "$(plugin_install_status)"
  check "published runtime bytes" verified "$(installed_trust_status)"
  check "runtime entrypoints executable" executable "$(runtime_executable_status)"
  check "seven Codex agents copied exactly" exact "$(agent_payload_status)"
  check "staged marketplace payload" exact "$(marketplace_payload_status)"
  check "managed Codex config" valid "$(config_region_status)"
  check "Codex accepts the oso permissions profile" accepted "$(codex_config_runtime_status)"
  check "global Codex guidance" exact "$(global_guidance_status)"
  check "Engram Codex integration" wired "$(engram_status)"
  check "installed oso-state round-trip" probe "$(state_round_trip_status)"
  check "installed Codex plan artifact round-trip" artifacts "$(plan_artifact_round_trip_status)"
  check "installed git hook denies a red agent commit" denied "$(commit_hook_red_status)"
  case "$(impeccable_status)" in
    mounted) check "Impeccable Codex mount" mounted mounted ;;
    opted-out) printf 'skip: Impeccable mount — install-codex.sh recorded --no-impeccable\n' ;;
    *) check "Impeccable Codex mount" mounted missing ;;
  esac
  case "$(git_hook_status)" in
    wired) check "git commit gate" wired wired ;;
    *) printf 'note: git commit gate is not wired for this checkout; the installer may have run with --no-git-hook\n' ;;
  esac
  run_mcp_tool_drift_checks
}

run_authenticated_smoke() {
  local login_output
  printf 'authenticated smoke:\n'
  if [ "${OSO_VERIFY_SKIP_SMOKE:-}" = 1 ]; then
    printf 'skip: authenticated Codex smoke — OSO_VERIFY_SKIP_SMOKE\n'
    return
  fi
  if ! login_output="$(bounded_command_output "$CODEX_LOGIN_STATUS_BOUND_SECONDS" "codex login status" codex login status)"; then
    login_output="$(printf '%s' "$login_output" | fold_lines)"
    check "Codex authentication" logged-in "${login_output:-unavailable}"
    printf 'skip: codex exec smoke — authentication is unavailable\n'
    return
  fi
  check "Codex authentication" logged-in logged-in

  SMOKE_ROOT=""
  SMOKE_OUTPUT=""
  trap cleanup_smoke_on_exit EXIT
  if ! create_integrator_fixture; then
    check "authenticated integrator smoke" integrated "$SMOKE_SETUP_RESULT"
  elif run_integrator_fixture; then
    check "authenticated integrator smoke" integrated integrated
  else
    SMOKE_OUTPUT="$(printf '%s' "$SMOKE_OUTPUT" | fold_lines)"
    check "authenticated integrator smoke" integrated "${SMOKE_OUTPUT:-observable-integration-failed}"
  fi
  if cleanup_smoke_on_exit; then
    SMOKE_ROOT=""
    trap - EXIT
  else
    check "integrator smoke fixture cleanup" removed failed
  fi
}

main() {
  if [ "$#" -gt 0 ]; then
    check "verifier arguments" none "$(printf '%s ' "$@" | fold_lines)"
  fi
  run_local_checks
  run_authenticated_smoke
  printf '%s\n' '----'
  printf 'passed: %s, failed: %s\n' "$pass" "$fail"
  [ "$fail" -eq 0 ]
}

main "$@"
