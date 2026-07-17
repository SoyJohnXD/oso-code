#!/usr/bin/env bash
# Post-install E2E verification. Every check is measurable pass/fail;
# exits non-zero if any check fails. Run after bootstrap/install.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"

# Context budget for the global CLAUDE.md: 8000 bytes ≈ 2k tokens.
# Keep this identical to CLAUDE_MD_BUDGET_BYTES in bootstrap/install.sh — the
# two scripts run standalone via curl and cannot source a shared file.
CLAUDE_MD_BUDGET_BYTES=8000

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok:   $name ($actual)"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected $expected, got $actual"; fail=$((fail + 1))
  fi
}

# The ACTIVE installed version dir (cache copy, not the repo) — a new session runs
# the installPath recorded in installed_plugins.json, so resolve THAT, never
# whatever readdir yields first across the cached versions (0.5.0…0.10.0). Checks
# that must exercise the exact files a session runs scope their targets under here.
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
# Fallback when the record or its installPath field is absent: highest version dir.
if [ -z "$install_root" ] || [ ! -d "$install_root" ]; then
  install_root="$(find "$plugin_cache" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
fi

# 1. Plugin installed and enabled
plugin_listed="$(claude plugin list 2>/dev/null | grep -c 'oso-code' || true)"
check "oso-code plugin installed" "1" "$([ "$plugin_listed" -ge 1 ] && echo 1 || echo 0)"

# 2. MCP servers wired and connected (engram + context7 ride plugins and render
#    as `plugin:<plugin>:<server>`; fallow is a user-scope entry). Assert each
#    server's line reports Connected, not merely that the name is present.
mcps="$(claude mcp list 2>/dev/null || true)"
mcp_connected() {
  if printf '%s\n' "$mcps" | grep -E "$1" | grep -q 'Connected'; then echo 1; else echo 0; fi
}
check "engram MCP connected"   "1" "$(mcp_connected 'engram')"
check "context7 MCP connected" "1" "$(mcp_connected 'context7')"
check "fallow MCP connected"   "1" "$(mcp_connected 'fallow')"

# 3. Legacy gentle-ai artifacts fully removed
legacy_left=0
while IFS= read -r rel; do
  case "$rel" in ''|'#'*) continue ;; esac
  if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
    legacy_left=$((legacy_left + 1))
    echo "      still present: $rel"
  fi
done < "$SCRIPT_DIR/gentle-manifest.txt"
check "legacy artifacts removed" "0" "$legacy_left"

# 4. No gentle hook references left in settings.json
gentle_hooks="$(grep -cE 'check-plan-contract|clean-code-gate|skill-registry-refresh|gentle-ai' "$CLAUDE_DIR/settings.json" 2>/dev/null || true)"
check "settings.json free of gentle hooks" "0" "$gentle_hooks"

# 5. Global CLAUDE.md within the context budget (< 8000 bytes ≈ 2k tokens)
md_size="$(wc -c < "$CLAUDE_DIR/CLAUDE.md")"
check "CLAUDE.md under budget" "1" "$([ "$md_size" -lt "$CLAUDE_MD_BUDGET_BYTES" ] && echo 1 || echo 0)"
echo "      CLAUDE.md size: ${md_size} bytes"

# 6. Installed hook binaries are executable and functional from the INSTALL path
#    (not the repo) — exercises the exact files new sessions will run.
if [ -n "$install_root" ]; then
  hook="$(find "$install_root" -name 'block-commit-until-green.sh' 2>/dev/null | head -1 || true)"
  if [ -n "$hook" ] && [ -x "$hook" ]; then
    tmp_home="$(mktemp -d)"
    mkdir -p "$tmp_home/.local/state/oso-code"
    printf 'mode=plan\nverify_green=false\n' > "$tmp_home/.local/state/oso-code/e2e.state"
    out="$(printf '{"session_id":"e2e","tool_input":{"command":"git commit -m x"}}' | HOME="$tmp_home" "$hook")"
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

# 7. oso-state reachable end-to-end through OSO_STATE_BIN from the INSTALL path —
#    the exact "${OSO_STATE_BIN:-oso-state}" form the skills use, not a PATH or
#    absolute-path shortcut. A silent no-op here means skills can't touch state.
if [ -n "$install_root" ]; then
  state_bin="$(find "$install_root" -path '*/bin/oso-state' 2>/dev/null | head -1 || true)"
  if [ -n "$state_bin" ] && [ -x "$state_bin" ]; then
    probe="$(
      export HOME="$(mktemp -d)" OSO_STATE_BIN="$state_bin"
      "${OSO_STATE_BIN:-oso-state}" --session verify-probe set mode=probe >/dev/null 2>&1
      "${OSO_STATE_BIN:-oso-state}" --session verify-probe get mode
      "${OSO_STATE_BIN:-oso-state}" --session verify-probe clear >/dev/null 2>&1
    )"
    check "OSO_STATE_BIN round-trips oso-state (e2e)" "probe" "$probe"
  else
    check "installed oso-state executable" "1" "0"
  fi
else
  check "plugin install path found (oso-state)" "1" "0"
fi

# 8. Repo test suite still green
if "$REPO_ROOT/tests/hooks-test.sh" >/dev/null 2>&1; then
  check "hook regression suite" "pass" "pass"
else
  check "hook regression suite" "pass" "fail"
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
