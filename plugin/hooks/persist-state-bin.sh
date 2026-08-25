#!/usr/bin/env bash
set -euo pipefail

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_BIN="$(dirname "$HOOK_DIR")/bin/oso-state"
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    STATE_BIN="$(cygpath -m "$STATE_BIN" 2>/dev/null || printf '%s' "$STATE_BIN")"
    ;;
esac
printf 'export OSO_STATE_BIN=%s\n' "$STATE_BIN" >> "$CLAUDE_ENV_FILE"
exit 0
