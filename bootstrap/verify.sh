#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"


CLAUDE_MD_BUDGET_BYTES=8000

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3" fix="${4:-}"
  if [ "$expected" = "$actual" ]; then
    echo "ok:   $name ($actual)"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected $expected, got $actual${fix:+ — fix: $fix}"; fail=$((fail + 1))
  fi
}


installed_plugins="$CLAUDE_DIR/plugins/installed_plugins.json"
plugin_cache="$CLAUDE_DIR/plugins/cache/oso-code/oso-code"
install_root=""
if [ -f "$installed_plugins" ]; then
  if command -v jq >/dev/null 2>&1; then
    install_root="$(jq -r '.plugins["oso-code@oso-code"][0].installPath // empty' "$installed_plugins" 2>/dev/null || true)"
  else
    echo "note: jq unavailable — deriving install path from the version-sorted cache"
  fi
fi
if [ -z "$install_root" ] || [ ! -d "$install_root" ]; then
  install_root="$(find "$plugin_cache" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
fi

plugin_listed="$(claude plugin list 2>/dev/null | grep -c 'oso-code' || true)"
check "oso-code plugin installed" "1" "$([ "$plugin_listed" -ge 1 ] && echo 1 || echo 0)"

mcps="$(claude mcp list 2>/dev/null || true)"
mcp_connected() {
  if printf '%s\n' "$mcps" | grep -E "^(plugin:[^:]+:)?$1:" | grep -q 'Connected'; then
    echo 1
  else
    echo 0
  fi
}
check "engram MCP connected"   "1" "$(mcp_connected 'engram')" \
  "bash bootstrap/install.sh installs the engram plugin AND the pinned engram binary its .mcp.json spawns by name; where that binary is installed but the client still cannot start it, either the directory holding it is not on the PATH Claude Code reads or the copy there does not run at all — that run's wiring summary says which and names the command for it (check 13 below discriminates the two on Windows), and Claude Code has to be restarted after"
check "context7 MCP connected" "1" "$(mcp_connected 'context7')" \
  "claude plugin install oso-code@oso-code registers it (it ships in the plugin's .mcp.json, so there is no mcp add to run), and it starts through npx — so install Node.js if npx is missing, then restart Claude Code"
check "fallow MCP connected" "1" "$(mcp_connected 'fallow')" \
  "bash bootstrap/install.sh installs the pinned fallow package from npm and wires a missing entry; an existing one it never touches, so repoint that with claude mcp remove fallow -s user && claude mcp add --scope user fallow -- the command that run names"

if legacy_manifest="$(cat "$SCRIPT_DIR/gentle-manifest.txt" 2>&1)"; then
  legacy_left=0
  while IFS= read -r rel; do
    rel="${rel%$'\r'}"
    case "$rel" in ''|'#'*) continue ;; esac
    if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
      legacy_left=$((legacy_left + 1))
      echo "      still present: $rel"
    fi
  done <<< "$legacy_manifest"
  check "legacy artifacts removed" "0" "$legacy_left"
else
  legacy_manifest="${legacy_manifest//$'\n'/ }"
  check "legacy artifacts removed" "0" "${legacy_manifest:-empty}"
fi

gentle_hooks="$(grep -cE 'check-plan-contract|clean-code-gate|skill-registry-refresh|gentle-ai' "$CLAUDE_DIR/settings.json" 2>&1 || true)"
gentle_hooks="${gentle_hooks//$'\n'/ }"
check "settings.json free of gentle hooks" "0" "${gentle_hooks:-empty}"

claude_md="$CLAUDE_DIR/CLAUDE.md"
if md_size="$(wc -c < "$claude_md")"; then
  check "CLAUDE.md under budget" "1" "$([ "$md_size" -lt "$CLAUDE_MD_BUDGET_BYTES" ] && echo 1 || echo 0)"
  echo "      CLAUDE.md size: ${md_size} bytes"
else
  check "CLAUDE.md under budget" "1" "unreadable $claude_md"
fi

if [ -n "$install_root" ]; then
  hook="$(find "$install_root" -name 'block-commit-until-green.sh' 2>/dev/null | head -1 || true)"
  if [ -n "$hook" ] && [ -x "$hook" ]; then
    out="$(
      {
        hook_home="$(mktemp -d)" \
          && state_key="$(printf '%s' "$hook_home" |
            { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" \
          && state_key="${state_key%% *}" \
          && mkdir -p "$hook_home/.local/state/oso-code" \
          && printf 'mode=plan\nverify_green=false\n' > "$hook_home/.local/state/oso-code/$state_key.state" \
          && printf '{"session_id":"e2e","cwd":"%s","tool_input":{"command":"git commit -m x"}}' "$hook_home" \
            | HOME="$hook_home" OSO_AGENT=1 "$hook"
      } 2>&1 || true
    )"
    out="${out//$'\n'/ }"
    case "$out" in
      *'"permissionDecision":"deny"'*) check "installed hook denies red commit (e2e)" "1" "1" ;;
      *) check "installed hook denies red commit (e2e)" "deny" "${out:-empty}" ;;
    esac
  else
    check "installed hook executable" "1" "0"
  fi
else
  check "plugin install path found" "1" "0"
fi

client_env_value() {
  jq -r --arg key "$1" '.env[$key] // empty' "$CLAUDE_DIR/settings.json" 2>/dev/null || true
}

stored_state_bin="$(client_env_value OSO_STATE_BIN)"
STATE_BIN_FIX="bash bootstrap/install.sh publishes the installed plugin's absolute bin/oso-state there, then restart Claude Code"
if [ -n "$stored_state_bin" ]; then
  probe="$(
    {
      probe_home="$(mktemp -d)" \
        && export HOME="$probe_home" OSO_STATE_BIN="$stored_state_bin" \
        && "${OSO_STATE_BIN:-oso-state}" --session verify-probe set mode=probe >/dev/null \
        && "${OSO_STATE_BIN:-oso-state}" --session verify-probe get mode \
        && "${OSO_STATE_BIN:-oso-state}" --session verify-probe clear >/dev/null
    } 2>&1 || true
  )"
  probe="${probe//$'\n'/ }"
  check "OSO_STATE_BIN round-trips oso-state (e2e)" "probe" "${probe:-empty}" "$STATE_BIN_FIX"
  echo "      OSO_STATE_BIN: $stored_state_bin"
else
  check "OSO_STATE_BIN round-trips oso-state (e2e)" "probe" \
    "no OSO_STATE_BIN in $CLAUDE_DIR/settings.json" "$STATE_BIN_FIX"
fi

if [ "${OSO_VERIFY_SKIP_SLOW:-}" = 1 ]; then
  echo "skip: hook regression suite — OSO_VERIFY_SKIP_SLOW (CI runs the suite as its own step)"
elif "$REPO_ROOT/tests/hooks-test.sh" >/dev/null 2>&1; then
  check "hook regression suite" "pass" "pass"
else
  check "hook regression suite" "pass" "fail"
fi

IMPECCABLE_OPT_OUT_MARKER="${HOME}/.local/state/oso-code/impeccable-opt-out"
if [ -f "$IMPECCABLE_OPT_OUT_MARKER" ]; then
  echo "note: impeccable plugin skipped — install.sh ran with --no-impeccable, so the design bar has no plugin half here; re-run install.sh without the flag to wire it"
else
  impeccable_listed="$(claude plugin list 2>/dev/null | grep -c 'impeccable' || true)"
  check "impeccable plugin installed" "1" "$([ "$impeccable_listed" -ge 1 ] && echo 1 || echo 0)"
fi

NPX_PROBE_BOUND_SECONDS=20

impeccable_cli_runnable() {
  set -m
  npx impeccable --version </dev/null >/dev/null 2>&1 &
  local probe=$! waited=0
  set +m
  while kill -0 "$probe" 2>/dev/null; do
    if [ "$waited" -ge "$NPX_PROBE_BOUND_SECONDS" ]; then
      kill -TERM "-$probe" 2>/dev/null || kill -TERM "$probe" 2>/dev/null || true
      wait "$probe" 2>/dev/null || true
      echo "no answer within ${NPX_PROBE_BOUND_SECONDS}s"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if wait "$probe"; then echo 1; else echo 0; fi
}

if [ "${OSO_VERIFY_SKIP_SLOW:-}" = 1 ]; then
  echo "skip: impeccable CLI runnable via npx — OSO_VERIFY_SKIP_SLOW (the probe would fetch the package from npm)"
else
  check "impeccable CLI runnable via npx" "1" "$(impeccable_cli_runnable)"
fi

normalized_path() {
  local path="${1//\\//}"
  case "$path" in
    /[A-Za-z]/*|/[A-Za-z])
      path="${path#/}"
      path="${path%%/*}:${path#?}"
      ;;
  esac
  case "$path" in
    [a-z]:*) path="$(printf '%s' "${path%%:*}" | tr 'a-z' 'A-Z'):${path#*:}" ;;
  esac
  case "$path" in ?*/) path="${path%/}" ;; esac
  printf '%s' "$path"
}

git_hook="$REPO_ROOT/plugin/git-hooks/pre-commit"
wired_hooks_path="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
if [ "$(normalized_path "$wired_hooks_path")" = "$(normalized_path "$(dirname "$git_hook")")" ]; then
  check "git commit hook executable at the wired core.hooksPath" "1" \
    "$([ -x "$git_hook" ] && echo 1 || echo 0)"
else
  echo "note: core.hooksPath is ${wired_hooks_path:-unset} in $REPO_ROOT — the git commit layer is not wired here, so only the PreToolUse gate applies"
fi

cr_shipped="$(cd "$REPO_ROOT" && LC_ALL=C grep -rlF -e $'\r' plugin/hooks plugin/bin plugin/git-hooks bootstrap/*.sh bootstrap/*.ps1 bootstrap/*.bat 2>&1 | tr '\n' ' ' || true)"
check "shipped executables carry no CR bytes" "none" "${cr_shipped:-none}"

if [ -n "${USERPROFILE:-}" ]; then
  client_home="$USERPROFILE"
  git_bash_home="$HOME"
  if [ "$(normalized_path "$client_home")" = "$(normalized_path "$git_bash_home")" ]; then
    client_home="$git_bash_home"
  fi
  check "home dir the Windows client reads" "$client_home" "$git_bash_home" \
    "re-run from PowerShell (bootstrap/install.ps1 sets HOME to %USERPROFILE% for you), or export HOME=\"\$USERPROFILE\" in Git Bash and re-run bootstrap/install.sh"
else
  echo "note: home dir the Windows client reads — %USERPROFILE% is unset, so no Windows-native client reads a home dir here and \$HOME ($HOME) is the only tree in play"
fi

running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

engram_binary_name() {
  if running_on_windows; then printf 'engram.exe'; else printf 'engram'; fi
}

client_path_entries() {
  if ! running_on_windows; then
    printf '%s\n' "${PATH//:/$'\n'}"
    return 0
  fi
  powershell -NoProfile -NonInteractive -Command \
    '@("Machine","User") | ForEach-Object { [Environment]::GetEnvironmentVariable("Path", $_) } | Where-Object { $_ } | ForEach-Object { $_ -split ";" }' \
    2>/dev/null || true
}

engram_client_binary() {
  local entry candidate name
  name="$(engram_binary_name)"
  while IFS= read -r entry; do
    entry="${entry%$'\r'}"
    entry="${entry//\\//}"
    entry="${entry%/}"
    [ -n "$entry" ] || continue
    candidate="$entry/$name"
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done <<< "$(client_path_entries)"
  return 0
}

engram_binary_runs() {
  "$1" version >/dev/null 2>&1
}

if running_on_windows; then
  engram_binary="$(engram_client_binary)"
  if [ -z "$engram_binary" ]; then
    engram_binary_state="no $(engram_binary_name) on the persisted machine or user PATH"
  elif engram_binary_runs "$engram_binary"; then
    engram_binary_state=1
  else
    engram_binary_state="$engram_binary does not run"
  fi
  check "engram binary the client resolves and runs" "1" "$engram_binary_state" \
    "bash bootstrap/install.sh downloads the pinned engram release into ~/.local/bin and reports it only once it answers; where one is already installed elsewhere, the verdict above says which half is missing — a directory not on the persisted PATH, which that run's wiring summary names the command to add (a new terminal plus a Claude Code restart is what picks it up), or a copy that does not run, which an antivirus may have quarantined and which that run tells you how to replace"
  [ -z "$engram_binary" ] || echo "      engram binary: $engram_binary"
else
  echo "note: engram binary the client resolves and runs — this is not Git Bash on Windows, so the client resolves a bare \`engram\` against this same PATH and starting the server exercises both, which check 2 already does"
fi

shell_spelling_of() {
  if running_on_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

git_bash_resolves() {
  [ -n "$1" ] && [ -f "$(shell_spelling_of "$1")" ]
}

stored_git_bash="$(client_env_value CLAUDE_CODE_GIT_BASH_PATH)"
if [ -z "$stored_git_bash" ]; then
  echo "note: Git Bash path the client spawns hooks with — settings.json publishes no CLAUDE_CODE_GIT_BASH_PATH, so Claude Code locates Git Bash itself; bootstrap/install.ps1 is what discovers a path and hands it to install.sh to publish"
else
  if git_bash_resolves "$stored_git_bash"; then
    git_bash_state=1
  else
    git_bash_state="$stored_git_bash is not there any more"
  fi
  check "Git Bash path the client spawns hooks with" "1" "$git_bash_state" \
    "point CLAUDE_CODE_GIT_BASH_PATH at the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe) — bootstrap\\install.ps1 finds it and hands it to install.sh, which repairs the stored value; then restart Claude Code"
  [ "$git_bash_state" != 1 ] || echo "      Git Bash: $stored_git_bash"
fi

claude_desktop_locations() {
  printf '%s\n' \
    "/Applications/Claude.app" \
    "$HOME/Library/Application Support/Claude" \
    "${LOCALAPPDATA:-$HOME/AppData/Local}/AnthropicClaude" \
    "${APPDATA:-$HOME/AppData/Roaming}/Claude" \
    "$HOME/.config/Claude"
}

claude_desktop_install() {
  local candidate
  while IFS= read -r candidate; do
    if [ -e "$(shell_spelling_of "$candidate")" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done <<< "$(claude_desktop_locations)"
  return 0
}

desktop_install="$(claude_desktop_install)"
if [ -z "$desktop_install" ]; then
  echo "note: Claude Desktop — none of $(claude_desktop_locations | tr '\n' ' ')is here, so this machine runs the CLI alone and the checks above are the whole install; Desktop is an application to download from claude.ai/download, not something this bootstrap installs, and it would need nothing installed here that is not already"
else
  echo "note: Claude Desktop — $desktop_install; its Code tab runs the CLI's engine and shares this ~/.claude — CLAUDE.md, MCP servers, hooks, skills and settings — so every check above answers for it too; what no shell can see is whether a running Desktop has loaded them, and the chat tab is a separate surface nothing here writes"
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
