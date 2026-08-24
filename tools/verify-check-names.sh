#!/usr/bin/env bash
set -euo pipefail

report="${1:?usage: verify-check-names.sh <verify.sh report file>}"

LC_ALL=C sed -n \
  -e 's/^ok:   \(.*\) (.*)$/\1/p' \
  -e 's/^FAIL: \([^—]*\) — expected .*/\1/p' \
  "$report" |
  LC_ALL=C sed 's/[[:space:]]*$//' |
  LC_ALL=C sort
