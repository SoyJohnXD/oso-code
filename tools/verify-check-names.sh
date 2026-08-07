#!/usr/bin/env bash
# The set of checks a bootstrap/verify.sh report reached a verdict on: one name
# per line, sorted, `ok:` and `FAIL:` alike. A `note:` line is not a check and
# never appears here — that is the shape verify.sh gives an optional piece or a
# machine-shaped fact, and it moves neither half of the tally.
#
# It exists because a failure COUNT cannot stand alone as CI's assertion. Every
# check a fixture HOME reaches fails there by construction — no authenticated CLI,
# no MCPs, no ~/.claude — so `failed: 9` reads identical whether a check was
# dropped, renamed, or quietly stopped running, and it has already hidden exactly
# that: one check left the report and another took its place at the same total.
# Pinned as a SET, a check joining or leaving is a one-line diff in the commit
# that causes it. Three callers read it: both verify.sh steps in
# .github/workflows/ci.yml, and the regression case in tests/hooks-test.sh that
# holds those pins to what verify.sh actually prints.
set -euo pipefail

report="${1:?usage: verify-check-names.sh <verify.sh report file>}"

# An `ok:` line ends in its value inside parentheses and a `FAIL:` line in its
# expected/got pair, so a name is what sits between the fixed prefix and either
# tail. Greedy on the ok side, because a name can carry parentheses of its own
# ("(e2e)") while the value is always the last pair; bounded by the em dash on the
# FAIL side, which no check name holds and every remediation sits behind. LC_ALL=C
# throughout, so that dash is three bytes to match rather than a character whose
# class depends on the runner's locale.
LC_ALL=C sed -n \
  -e 's/^ok:   \(.*\) (.*)$/\1/p' \
  -e 's/^FAIL: \([^—]*\) — expected .*/\1/p' \
  "$report" |
  LC_ALL=C sed 's/[[:space:]]*$//' |
  LC_ALL=C sort
