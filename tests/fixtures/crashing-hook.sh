#!/usr/bin/env bash
set -euo pipefail

cat >/dev/null
echo "crashing-hook: simulated hook failure" >&2
exit 1
