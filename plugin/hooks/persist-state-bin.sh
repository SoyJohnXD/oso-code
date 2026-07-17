#!/usr/bin/env bash
# SessionStart: persist OSO_STATE_BIN so skills reach oso-state by an explicit
# path. Claude Code injects <plugin>/bin into the Bash tool PATH undocumented —
# that injection already failed on Windows. Writing the path into
# $CLAUDE_ENV_FILE makes every later Bash command in the session see it. When
# CLAUDE_ENV_FILE is unset (older clients, non-Bash contexts) we exit clean; the
# skills' "${OSO_STATE_BIN:-oso-state}" fallback then preserves prior behavior.
set -euo pipefail

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf 'export OSO_STATE_BIN=%s\n' "$(dirname "$HOOK_DIR")/bin/oso-state" >> "$CLAUDE_ENV_FILE"
exit 0
