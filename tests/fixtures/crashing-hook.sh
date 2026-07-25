#!/usr/bin/env bash
# Fixture for the harness guard in tests/hooks-test.sh: a hook that dies the way
# a broken one does — reads its payload, says nothing on stdout, complains on
# stderr, exits non-zero. Never wired into plugin/hooks/hooks.json.
set -euo pipefail

cat >/dev/null
echo "crashing-hook: simulated hook failure" >&2
exit 1
