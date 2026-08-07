#!/usr/bin/env bash
# SessionStart: persist OSO_STATE_BIN so skills reach oso-state by an explicit
# path. bootstrap/install.sh publishes that same path into the `env` block of
# ~/.claude/settings.json, which the client hands to every session it starts and
# which needs no injection at all; this hook covers the sessions that write
# never reached — a plugin installed straight from the marketplace, a machine the
# installer has not run on since. Writing the path into $CLAUDE_ENV_FILE makes
# every later Bash command in the session see it. When CLAUDE_ENV_FILE is unset
# (older clients, non-Bash contexts) we exit clean: settings.json is the durable
# route, and the skills' "${OSO_STATE_BIN:-oso-state}" fallback is what is left
# where neither arrived.
set -euo pipefail

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_BIN="$(dirname "$HOOK_DIR")/bin/oso-state"
# `pwd` under Git Bash spells this /c/Users/…, the one form a native process
# cannot resolve — and this value overrides settings.json's for every Bash command
# in the session, so a session that has both must not end up with the worse of the
# two. cygpath -m is the drive-letter-with-forward-slashes spelling install.sh
# stores, readable by this shell and by a native consumer alike.
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    STATE_BIN="$(cygpath -m "$STATE_BIN" 2>/dev/null || printf '%s' "$STATE_BIN")"
    ;;
esac
printf 'export OSO_STATE_BIN=%s\n' "$STATE_BIN" >> "$CLAUDE_ENV_FILE"
exit 0
