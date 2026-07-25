#!/usr/bin/env bash
# Lints the rules `claude plugin validate --strict` has no opinion on: it does
# open hooks.json, skill frontmatter and the agents, and fails on a broken one
# (probed against client 2.1.220), but it never asks what they SAY. Six rules
# hold that ground: a `context: fork` skill declares `background`; the same
# skill declares an `end with exactly one of:` verdict block; every
# `oso-code:<name>` the plugin's own prose points at resolves; every call site
# of a skill that declares such a block carries AT LEAST ONE of that skill's
# tokens verbatim; security-pass never acquires its diff from a remote-qualified
# ref; and the Impeccable detect gate never carries a placeholder where its pin
# belongs. Each rule states its own reason above it; `background` is the one
# whose cost is least visible: as of client v2.1.218 a fork returns immediately
# and its verdict arrives in a LATER turn, while every call site in
# plan/quick/debug reads that verdict in-turn.
# Only decidable rules live here. Pure sed and grep, no jq: the Windows CI job
# runs the suite before jq exists. A rule that scans a TREE keeps grep's stderr
# inside the value it scans (`2>&1`), the way bootstrap/verify.sh's CR-byte
# check does: `|| true` alone reads an unreadable or missing scan path exactly
# like "no matches", and a rule that scanned nothing must never report clean. A
# scan path that vanished therefore surfaces as grep's own error text among that
# rule's violations — misnamed, but loud and nonzero, which is the point.
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/../plugin" && pwd)}"
# The pin rule below is the one rule that reaches outside the plugin tree, so it
# resolves the repo the same way the default PLUGIN_ROOT does — from this file's
# own location, never from the argument.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

violations=0

flag() {
  echo "lint: $1"
  violations=$((violations + 1))
}

frontmatter() {
  local file="$1"
  [ "$(sed -n 1p "$file")" = "---" ] || return 0
  sed -n '2,/^---$/p' "$file"
}

# A fork whose execution mode is left to the client is a verdict the orchestrator
# may never see; `background` is the only lever, since the Skill tool takes no
# per-call override.
check_forked_skills_declare_background() {
  local skill frontmatter_text
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    frontmatter_text="$(frontmatter "$skill")"
    printf '%s\n' "$frontmatter_text" | grep -qE '^context:[[:space:]]*fork[[:space:]]*$' || continue
    printf '%s\n' "$frontmatter_text" | grep -qE '^background:[[:space:]]*(true|false)[[:space:]]*$' \
      || flag "${skill#"$PLUGIN_ROOT"/} declares context: fork without background"
  done
}

# Scoped to `oso-code:`-prefixed names because the plugin's prose also names
# skills this tree does not own — `impeccable:impeccable`, `engram`, `vercel:*`
# and illustrative examples — which resolve to no file here and never should.
check_own_references_resolve() {
  local name
  for name in $(own_references); do
    [ -f "$PLUGIN_ROOT/skills/$name/SKILL.md" ] || [ -f "$PLUGIN_ROOT/agents/$name.md" ] \
      || flag "oso-code:$name is referenced but no skill or agent file carries that name"
  done
}

own_references() {
  { grep -rhoE 'oso-code:[A-Za-z0-9_-]+' "$PLUGIN_ROOT" 2>&1 || true; } \
    | sed 's/^oso-code://' | LC_ALL=C sort -u
}

# A forked judge is re-invoked in a loop its call sites terminate on a token, so
# a verdict left as prose is a loop with no exit. The validator reads
# frontmatter, never the report contract in the body. Case-insensitively,
# because debt-sweep writes the phrase inline and lowercase while doubt-pass
# capitalizes it — both are compliant.
check_forked_skills_declare_a_verdict_token() {
  local skill frontmatter_text
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    frontmatter_text="$(frontmatter "$skill")"
    printf '%s\n' "$frontmatter_text" | grep -qE '^context:[[:space:]]*fork[[:space:]]*$' || continue
    grep -qi 'end with exactly one of:' "$skill" \
      || flag "${skill#"$PLUGIN_ROOT"/} declares context: fork without an 'end with exactly one of:' verdict block"
  done
}

# A remote named origin is not guaranteed — a repo that was never cloned, a fork
# whose remote is upstream — and a diff against a ref that resolves nowhere dies
# with `fatal: ambiguous argument` (rc 128), leaving the reviewer to improvise
# its own acquisition at the one gate that must not improvise. Scoped to lines
# carrying BOTH substrings, which is what keeps it decidable and leaves the
# argument-hint's example ref legal. The validator never reads which commands the
# prose tells the fork to run.
check_security_pass_acquires_without_a_remote() {
  local skill="$PLUGIN_ROOT/skills/security-pass/SKILL.md"
  local line
  [ -f "$skill" ] || return 0
  for line in $({ grep -n 'git ' "$skill" || true; } | { grep 'origin/' || true; } | cut -d: -f1); do
    flag "skills/security-pass/SKILL.md:$line runs git against a remote-qualified ref"
  done
}

# `npx impeccable@X detect` is not a runnable command: X was never a numeral, and
# the only version an agent can read is the PLUGIN's, whose release line is
# independent of the npm CLI's — so the placeholder resolves to a version npm does
# not carry, and the detect gate fails INTO the Verify-exception it exists to
# close. The pin recipe in skills/_shared/front-surface.md resolves it from the npm
# channel instead; this rule keeps the placeholder from growing back, in the docs
# that teach the recipe as much as in the skills that run it. Matched as a literal
# token, which is what leaves `impeccable@impeccable` — the plugin@marketplace id
# install.sh passes — legal.
check_impeccable_pin_is_never_a_placeholder() {
  local hit
  for hit in $({ grep -rnF 'impeccable@X' \
      "$REPO_ROOT/plugin" "$REPO_ROOT/docs" "$REPO_ROOT/CHANGELOG.md" 2>&1 || true; } | cut -d: -f1,2); do
    flag "${hit#"$REPO_ROOT"/} carries the unresolvable pin placeholder impeccable@X"
  done
}

# The rule above asks whether a fork DECLARES its verdict tokens; this one asks
# whether the call sites SPEAK them — for EVERY skill carrying a terminal-token
# block, not just the forked ones: quality-pass runs inline and still ends on
# `Quality Pass: passed`, and a gate worded around a verdict its emitter never
# says is equally broken either way. A caller that loops until a bare `clean`
# never terminates on `Conformance: skipped — no ledger provided` — it reads a
# verdict outside its vocabulary as a pass, and the gate the loop guards opens
# over an axis that never ran. The contract is AT LEAST ONE token verbatim,
# never the full set: carrying one is how a site proves it speaks the emitter's
# vocabulary, while demanding all of them would push verdicts a site never acts
# on into its prose. Decidable: the emitter declares its tokens, and a call site
# either carries one verbatim or does not.
check_call_sites_name_a_verdict_token() {
  local skill emitter tokens caller
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    emitter="$(basename "$(dirname "$skill")")"
    tokens="$(verdict_tokens "$skill")"
    [ -n "$tokens" ] || continue
    # Bounded on the right so an emitter named `plan` would not collect `oso-code:plan2`.
    for caller in $({ grep -lE "oso-code:$emitter([^A-Za-z0-9_-]|\$)" \
        "$PLUGIN_ROOT"/skills/*/SKILL.md || true; }); do
      printf '%s\n' "$tokens" | grep -qFf - "$caller" \
        || flag "${caller#"$PLUGIN_ROOT"/} invokes oso-code:$emitter but carries none of its verdict tokens"
    done
  done
}

# The backticked list items under an `end with exactly one of:` header — blank
# lines skipped, the run ending at the first line that is neither. Matched
# case-insensitively for the same reason the declaration rule is.
verdict_tokens() {
  local skill="$1" header line token
  for header in $({ grep -in 'end with exactly one of:' "$skill" || true; } | cut -d: -f1); do
    while IFS= read -r line; do
      case "$line" in
        '') continue ;;
        '- `'*) token="${line#- \`}"; printf '%s\n' "${token%%\`*}" ;;
        *) break ;;
      esac
    done <<< "$(sed -n "$((header + 1)),\$p" "$skill")"
  done
}

[ -d "$PLUGIN_ROOT/skills" ] || { echo "lint: no skills directory under $PLUGIN_ROOT"; exit 1; }

check_forked_skills_declare_background
check_own_references_resolve
check_forked_skills_declare_a_verdict_token
check_security_pass_acquires_without_a_remote
check_impeccable_pin_is_never_a_placeholder
check_call_sites_name_a_verdict_token

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean"
