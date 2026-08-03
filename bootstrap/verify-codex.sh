#!/usr/bin/env bash
# Post-install verification that leaves user configuration and repositories unchanged.

set -o pipefail

CONFIG_MARKER_START="# oso-code:start"
CONFIG_MARKER_END="# oso-code:end"
FEATURE_MARKER_START="# oso-code:features:start"
FEATURE_MARKER_END="# oso-code:features:end"
GLOBAL_MARKER_START="<!-- oso-code:start -->"
GLOBAL_MARKER_END="<!-- oso-code:end -->"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
. "$SCRIPT_DIR/lib/codex-managed-config.sh"
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

fold_lines() {
  tr '\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g; s/[[:space:]]*$//'
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

codex_version_status() {
  local output version
  if ! output="$(codex --version 2>&1)"; then
    printf '%s' "$(printf '%s' "$output" | fold_lines)"
    return
  fi
  version="${output##* }"
  printf '%s' "$version"
}

plugin_install_status() {
  local listing
  if ! command -v python3 >/dev/null 2>&1; then
    printf 'python3 unavailable'
    return
  fi
  if ! listing="$(codex plugin list --json 2>&1)"; then
    printf '%s' "$(printf '%s' "$listing" | fold_lines)"
    return
  fi
  if printf '%s' "$listing" | python3 -c '
import json, sys
installed = json.load(sys.stdin).get("installed", [])
raise SystemExit(0 if "oso-code" in json.dumps(installed) else 1)
' >/dev/null 2>&1; then
    printf installed
  else
    printf absent-or-invalid
  fi
}

installed_trust_status() {
  local expected relative installed actual escaped_runtime missing=""
  [ -f "$HASHES_FILE" ] || { printf 'missing hash manifest'; return; }
  escaped_runtime="${RUNTIME_ROOT//\\/\\\\}"
  escaped_runtime="${escaped_runtime//&/\\&}"
  escaped_runtime="${escaped_runtime//|/\\|}"
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in
      codex/hooks/hooks.json)
        installed="$HOOKS_FILE"
        if [ -f "$installed" ]; then
          actual="$(sed "s|$escaped_runtime/hooks|__OSO_HOOKS_DIR__|g" "$installed" | sha256_stream)"
        else
          actual=""
        fi
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
  if [ -f "$CODEX_HOME/engram-instructions.md" ] &&
     [ -f "$CODEX_HOME/engram-compact-prompt.md" ] &&
     grep -F 'model_instructions_file = ' "$CONFIG_FILE" >/dev/null 2>&1 &&
     grep -F 'experimental_compact_prompt_file = ' "$CONFIG_FILE" >/dev/null 2>&1 &&
     grep -Fqx '[mcp_servers.engram]' "$CONFIG_FILE" >/dev/null 2>&1; then
    printf wired
  else
    printf incomplete
  fi
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

remove_temporary_fixture() {
  local fixture_root=$1 fixture_parent=$2
  [ -n "$fixture_root" ] && [ "$fixture_root" != / ] || return 1
  [ "$(dirname "$fixture_root")" = "$fixture_parent" ] || return 1
  case "$(basename "$fixture_root")" in
    oso-codex-smoke.*|oso-state-probe.*|oso-git-hook-probe.*) rm -rf "$fixture_root" ;;
    *) return 1 ;;
  esac
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
  local probe_parent probe_root probe_repo probe_value
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$probe_parent" ] || { printf temporary-parent-unavailable; return; }
  if ! probe_root="$(mktemp -d "$probe_parent/oso-state-probe.XXXXXX" 2>&1)"; then
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
  remove_temporary_fixture "$probe_root" "$probe_parent" ||
    probe_value="${probe_value:-empty}:cleanup-failed"
  printf '%s' "$probe_value"
}

commit_hook_red_status() {
  local probe_parent probe_root probe_repo base_commit denied_output result
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$probe_parent" ] || { printf temporary-parent-unavailable; return; }
  if ! probe_root="$(mktemp -d "$probe_parent/oso-git-hook-probe.XXXXXX" 2>&1)"; then
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
  remove_temporary_fixture "$probe_root" "$probe_parent" || result="$result:cleanup-failed"
  printf '%s' "$result"
}

integrator_spawn_observed() {
  command -v python3 >/dev/null 2>&1 || return 1
  printf '%s\n' "$SMOKE_OUTPUT" | python3 -c '
import json, re, sys

def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())

for line in sys.stdin:
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    event_text = normalized(json.dumps(event, separators=(",", ":")))
    if ("collabagenttoolcall" in event_text and
            "spawnagent" in event_text and
            "osointegrator" in event_text):
        raise SystemExit(0)
raise SystemExit(1)
' >/dev/null 2>&1
}

create_integrator_fixture() {
  SMOKE_PARENT="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$SMOKE_PARENT" ] || { SMOKE_SETUP_RESULT=temporary-parent-unavailable; return 1; }
  if ! SMOKE_ROOT="$(mktemp -d "$SMOKE_PARENT/oso-codex-smoke.XXXXXX" 2>&1)"; then
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
  SMOKE_SETUP_RESULT=ready
}

cleanup_smoke_on_exit() {
  [ -z "${SMOKE_ROOT:-}" ] ||
    remove_temporary_fixture "$SMOKE_ROOT" "$SMOKE_PARENT"
}

run_integrator_fixture() {
  SMOKE_OUTPUT="$(codex exec --ephemeral --json --sandbox workspace-write --color never \
    -C "$SMOKE_MAIN" --add-dir "$SMOKE_ROOT" \
    "Delegate exactly one wave to the custom oso-integrator agent; never merge inline. Main checkout: $SMOKE_MAIN. BASE REF: $SMOKE_BASE_COMMIT. The complete wave has one slice, in this order: BRANCH oso-smoke-slice, WORKTREE PATH $SMOKE_WORKTREE. Return only the agent's completion status." 2>&1)" || return 1
  integrator_spawn_observed &&
    printf '%s' "$SMOKE_OUTPUT" | grep -F 'status: done' >/dev/null 2>&1 &&
    printf '%s' "$SMOKE_OUTPUT" | grep -F 'torn_down:' >/dev/null 2>&1 &&
    [ -f "$SMOKE_MAIN/integrated.txt" ] &&
    grep -Fqx 'integrated by oso-integrator' "$SMOKE_MAIN/integrated.txt" &&
    git -C "$SMOKE_MAIN" merge-base --is-ancestor "$SMOKE_SLICE_COMMIT" HEAD >/dev/null 2>&1 &&
    ! git -C "$SMOKE_MAIN" show-ref --verify --quiet refs/heads/oso-smoke-slice &&
    ! git -C "$SMOKE_MAIN" worktree list --porcelain |
      grep -F "$SMOKE_WORKTREE" >/dev/null 2>&1
}

run_local_checks() {
  printf 'local checks:\n'
  check "Codex CLI version" "$SUPPORTED_CODEX_VERSION" "$(codex_version_status)"
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
}

run_authenticated_smoke() {
  local login_output
  printf 'authenticated smoke:\n'
  if [ "${OSO_VERIFY_SKIP_SMOKE:-}" = 1 ]; then
    printf 'skip: authenticated Codex smoke — OSO_VERIFY_SKIP_SMOKE\n'
    return
  fi
  if ! login_output="$(codex login status 2>&1)"; then
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
