#!/usr/bin/env bash
# Post-install E2E verification. Every check is measurable pass/fail;
# exits non-zero if any check fails. Run after bootstrap/install.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"

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

# 1. Plugin installed and enabled
plugin_listed="$(claude plugin list 2>/dev/null | grep -c 'oso-code' || true)"
check "oso-code plugin installed" "1" "$([ "$plugin_listed" -ge 1 ] && echo 1 || echo 0)"

# 2. MCP servers wired
mcps="$(claude mcp list 2>/dev/null || true)"
check "fallow MCP wired"   "1" "$(printf '%s' "$mcps" | grep -c 'fallow' || true)"
check "context7 MCP wired" "1" "$(printf '%s' "$mcps" | grep -c 'context7' || true)"

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

# 5. Global CLAUDE.md within the context budget (< 2000 bytes ≈ well under 2k tokens)
md_size="$(wc -c < "$CLAUDE_DIR/CLAUDE.md")"
check "CLAUDE.md under budget" "1" "$([ "$md_size" -lt 2000 ] && echo 1 || echo 0)"
echo "      CLAUDE.md size: ${md_size} bytes"

# 6. Installed hook binaries are executable and functional from the INSTALL path
#    (not the repo) — exercises the exact files new sessions will run.
install_root="$(claude plugin list 2>/dev/null | grep -A5 'oso-code' | grep -oE '/[^ ]*oso-code[^ ]*' | head -1 || true)"
if [ -z "$install_root" ]; then
  install_root="$(fd -t d -d 4 'oso-code' "$CLAUDE_DIR/plugins/cache" 2>/dev/null | head -1 || true)"
fi
if [ -n "$install_root" ]; then
  hook="$(fd 'block-commit-until-green.sh' "$install_root" 2>/dev/null | head -1 || true)"
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

# 7. Repo test suite still green
if "$REPO_ROOT/tests/hooks-test.sh" >/dev/null 2>&1; then
  check "hook regression suite" "pass" "pass"
else
  check "hook regression suite" "pass" "fail"
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
