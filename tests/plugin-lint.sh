#!/usr/bin/env bash
# Lints the rules `claude plugin validate --strict` has no opinion on: it does
# open hooks.json, skill frontmatter and the agents, and fails on a broken one
# (probed against client 2.1.220), but it never asks what they SAY. Thirteen rules
# hold that ground: a `context: fork` skill declares `background`; the same
# skill declares an `end with exactly one of:` verdict block; every
# `oso-code:<name>` the plugin's own prose points at resolves; every call site
# of a skill that declares such a block carries AT LEAST ONE of that skill's
# tokens verbatim AND names the skipped verdict of any axis whose other
# verdicts it reads; security-pass never acquires its diff from a remote-qualified
# ref; the Impeccable detect gate never carries a placeholder where its pin
# belongs; each host's always-loaded routing file names every mode the model cannot
# invoke on its own; every line that launches oso-verifier names the payload it
# hands it; every line that launches oso-integrator names the wave's worktrees,
# base ref and branch list; every decision under docs/decisions/ says where it
# landed; every decision a skill cites resolves to one of those files AND is
# named back by it; the prose that says how many rules hold this ground says a
# number the functions below make true; and both hook manifests plus every
# release-published hook hash exactly match their single source. Each rule states
# its own reason above
# it; `background` is the one whose cost is least visible: as of client v2.1.218
# a fork returns immediately and its verdict arrives in a LATER turn, while every
# call site in plan/quick/debug reads that verdict in-turn.
# Only decidable rules live here. Pure sed and grep, no jq: tests/hooks-test.sh
# runs this linter as one of its own cases, and CI runs that suite in the
# bash:3.2 container, which carries neither git nor jq. A rule that scans a TREE
# keeps grep's stderr inside the value it scans (`2>&1`), the way
# bootstrap/verify.sh's CR-byte check does: `|| true` alone reads an unreadable
# or missing scan path exactly like "no matches", and a rule that scanned nothing
# must never report clean. A scan path that vanished therefore surfaces as grep's
# own error text among that rule's violations — misnamed, but loud and nonzero,
# which is the point.
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/../plugin" && pwd)}"
# Five rules below reach outside the plugin tree — the pin scan, the routing
# files, the decision files, the citations that bind the plugin to them, and the
# rule count's own prose surfaces — so the repo resolves the same way the default
# PLUGIN_ROOT does. A second argument exists only so tests/hooks-test.sh can run
# the whole linter against an isolated mutated copy; normal calls omit it and
# resolve from this file's own location.
REPO_ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"

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

# A skill's instructions are no longer one file: each host's SKILL.md binds a
# platform-neutral body under skills/_shared/bodies/ and, when the skill has host
# facts, one under skills/_shared/platform/<host>/. Four of the rules below read
# what a skill SAYS rather than what its frontmatter declares, and each of them
# reads both wrappers plus every body either wrapper binds — scoped to the Claude
# wrapper alone they would report clean over a forbidden acquisition command or a
# starved launch payload written into the Codex body. The shared files physically
# live under the plugin tree until the installer copies them beside the Codex
# wrappers, so references from either wrapper resolve there for lint. A reference
# that resolves to no file is dropped rather than scanned, which would leave a
# rule reading nothing — tests/hooks-test.sh is where the wrapper-to-body relation
# is asserted, so a body that went missing fails there, loudly, before any rule
# here can go quiet over it.
skill_sources() {
  local skill="$1" host="${2:-all}" name wrapper reference source
  if [ "$host" = all ]; then
    { skill_sources "$skill" claude; skill_sources "$skill" codex; } | LC_ALL=C sort -u
    return 0
  fi
  name="$(basename "$(dirname "$skill")")"
  case "$host" in
    claude) wrapper="$skill" ;;
    codex) wrapper="$REPO_ROOT/codex/skills/$name/SKILL.md" ;;
    *) flag "skill_sources was asked for unknown host $host"; return 0 ;;
  esac
  [ -f "$wrapper" ] || return 0
  printf '%s\n' "$wrapper"
  for reference in $({ grep -ohE '_shared/(bodies|platform/(claude|codex))/[a-z-]+\.md' "$wrapper" || true; } \
      | LC_ALL=C sort -u); do
    source="$PLUGIN_ROOT/skills/$reference"
    if [ -f "$source" ]; then printf '%s\n' "$source"; fi
  done
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
  local skill frontmatter_text host sources
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    frontmatter_text="$(frontmatter "$skill")"
    printf '%s\n' "$frontmatter_text" | grep -qE '^context:[[:space:]]*fork[[:space:]]*$' || continue
    for host in claude codex; do
      sources="$(skill_sources "$skill" "$host" | tr '\n' ' ')"
      [ -n "$sources" ] && grep -qi 'end with exactly one of:' $sources \
        || flag "${skill#"$PLUGIN_ROOT"/} declares context: fork without an 'end with exactly one of:' verdict block on $host"
    done
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
  local source line
  [ -f "$skill" ] || return 0
  for source in $(skill_sources "$skill"); do
    for line in $({ grep -n 'git ' "$source" || true; } | { grep 'origin/' || true; } | cut -d: -f1); do
      flag "${source#"$PLUGIN_ROOT"/}:$line runs git against a remote-qualified ref"
    done
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
# over an axis that never ran. The FLOOR is at least one token verbatim, never
# the full set: demanding all of them would fail /debug forever, which passes no
# ledger and has no reason to name the two conformance verdicts it can never
# reach, while carrying one is how a site proves it speaks the emitter's
# vocabulary. One token is not optional above that floor — the skipped verdict of
# an axis whose OTHER verdicts the site already names. Naming `Conformance:
# clean` is what turns the skip into a hole: a site that acts on an axis and
# never carries the answer "it did not run" reads that answer as neither verdict
# and opens its green write over an axis that never ran, which is exactly what
# deleting the skip from /plan would leave clean under the floor alone. A site
# that names only the skip — /debug, whose sweep has no ledger to judge against —
# reads no verdict of that axis and is asked for nothing. `skipped` is the whole
# did-not-run vocabulary the emitters have; a second spelling would be a second
# vocabulary. Decidable both ways: the emitter declares its tokens, and a call
# site either carries one verbatim or does not.
check_call_sites_speak_their_emitters_verdict_vocabulary() {
  local skill emitter host tokens skipped_verdicts caller caller_sources skip axis verdicts_that_ran
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    emitter="$(basename "$(dirname "$skill")")"
    for host in claude codex; do
      tokens="$(emitter_verdict_tokens "$skill" "$host")"
      [ -n "$tokens" ] || continue
      skipped_verdicts="$(printf '%s\n' "$tokens" | { grep -F ': skipped' || true; })"
      for caller in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
        [ -f "$caller" ] || continue
        caller_sources="$(skill_sources "$caller" "$host" | tr '\n' ' ')"
        case "$host" in
          # Bounded on the right so an emitter named `plan` does not collect
          # `oso-code:plan2`; Codex exposes plugin skills under that same
          # namespaced identity, written as a backticked table cell here, which
          # distinguishes it from path references in every wrapper.
          claude) grep -qE "oso-code:$emitter([^A-Za-z0-9_-]|\$)" $caller_sources || continue ;;
          codex) grep -qF "\`oso-code:$emitter\`" $caller_sources || continue ;;
        esac
        printf '%s\n' "$tokens" | grep -qFf - $caller_sources \
          || flag "${caller#"$PLUGIN_ROOT"/} invokes $emitter on $host but carries none of its verdict tokens"
        [ -n "$skipped_verdicts" ] || continue
        while IFS= read -r skip; do
          axis="${skip%%:*}"
          verdicts_that_ran="$(printf '%s\n' "$tokens" \
            | { grep -F "$axis:" || true; } | { grep -vxF "$skip" || true; })"
          [ -n "$verdicts_that_ran" ] || continue
          printf '%s\n' "$verdicts_that_ran" | grep -qFf - $caller_sources || continue
          grep -qF "$skip" $caller_sources \
            || flag "${caller#"$PLUGIN_ROOT"/} reads $axis verdicts of $emitter on $host but never names \`$skip\`"
        done <<< "$skipped_verdicts"
      done
    done
  done
}

# Every token the skill declares, gathered across the files it binds — the verdict
# block sits in the neutral body, since the vocabulary is what BOTH hosts answer
# in and duplicating it per wrapper is the one thing the split exists to prevent.
emitter_verdict_tokens() {
  local skill="$1" host="${2:-all}" source
  for source in $(skill_sources "$skill" "$host"); do
    verdict_tokens "$source"
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

# `disable-model-invocation: true` is what makes a mode a mode: the model can
# never reach one on its own, so an operator who was never told the command has
# no way in. Each host's global file is the source installed into the one
# always-loaded instruction block for that host, which leaves its Workflow block
# the only place that can tell them — and 0.13.0 shipped `/debug` while the Claude
# block still listed two modes, so every bug on every installed machine has since
# been routed to `/plan` or `/quick`. The set is read independently from each
# host's frontmatter rather than listed here, so a fourth mode is either routed in
# that host's exact public spelling or flagged. The public spelling is one whole
# backticked code span, which closes both token boundaries instead of accepting a
# prefixed command such as `x$plan`. Exactly one Workflow heading is required: no
# heading must fail loudly, and two partial blocks may not combine into one
# apparently complete route.
check_global_routing_names_every_operator_only_mode() {
  local host routing_file skills_root workflow_count workflow_block
  local skill frontmatter_text mode invocation
  for host in claude codex; do
    case "$host" in
      claude)
        routing_file="$REPO_ROOT/bootstrap/claude-global.md"
        skills_root="$PLUGIN_ROOT/skills"
        ;;
      codex)
        routing_file="$REPO_ROOT/bootstrap/codex-global.md"
        skills_root="$REPO_ROOT/codex/skills"
        ;;
    esac

    if [ ! -d "$skills_root" ]; then
      flag "${skills_root#"$REPO_ROOT"/} is missing; cannot derive $host operator-only modes"
      continue
    fi

    workflow_count="$({ grep -c '^# Workflow$' "$routing_file" 2>&1 || true; })"
    case "$workflow_count" in
      1) ;;
      ''|*[!0-9]*) flag "${routing_file#"$REPO_ROOT"/} has no readable Workflow routing (${workflow_count:-empty})" ;;
      *) flag "${routing_file#"$REPO_ROOT"/} must carry exactly one Workflow routing (found $workflow_count)" ;;
    esac
    workflow_block="$({ sed -n '/^# Workflow$/,/^# /p' "$routing_file" 2>&1 || true; })"

    for skill in "$skills_root"/*/SKILL.md; do
      [ -f "$skill" ] || continue
      frontmatter_text="$(frontmatter "$skill")"
      printf '%s\n' "$frontmatter_text" \
        | grep -qE '^disable-model-invocation:[[:space:]]*true[[:space:]]*$' || continue
      mode="$(basename "$(dirname "$skill")")"
      case "$host" in
        claude)
          invocation="/oso-code:$mode"
          ;;
        codex)
          invocation="\$oso-code:$mode"
          ;;
      esac
      printf '%s\n' "$workflow_block" | grep -qF "\`$invocation\`" \
        || flag "${routing_file#"$REPO_ROOT"/} omits $invocation from its Workflow routing"
    done
  done
}

# The verifier reruns the bar itself, so a launch that never names the
# zero-warnings commands answers `blocked` instead of a verdict; one that never
# names the rubric path cannot reach the Hard blockers it fails a slice on; one
# that never names the decisions it judges against fails a new abstraction for
# the absence of a decision nobody handed it. That last marker is a disjunction
# because the payload is mode-specific — plan passes ledger decisions, debug a
# frozen diagnosis, and neither is the other. LINE-scoped, never file-scoped:
# skills/debug/SKILL.md names the rubric path at its APPLIER launch, so a
# file-scoped rule reads clean on the very file whose verifier launch is
# starved. A launch spread over several lines therefore fails too — the payload
# is what the launched agent reads in one place, and both launches are single
# lines today.
check_verifier_launches_name_their_payload() {
  local skill source line launch marker
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    for source in $(skill_sources "$skill"); do
      for line in $({ grep -n 'oso-verifier' "$source" || true; } \
          | { grep -i 'launch' || true; } | cut -d: -f1); do
        launch="$(sed -n "${line}p" "$source")"
        for marker in 'criteria' 'zero-warnings' 'rubric.md'; do
          printf '%s\n' "$launch" | grep -qF "$marker" \
            || flag "${source#"$PLUGIN_ROOT"/}:$line launches oso-verifier without naming $marker in its payload"
        done
        printf '%s\n' "$launch" | grep -qE 'ledger|diagnosis' \
          || flag "${source#"$PLUGIN_ROOT"/}:$line launches oso-verifier without naming the ledger or diagnosis it judges against"
      done
    done
  done
}

# The integrator merges a wave it cannot re-derive: WHICH branches belong to the
# wave, the WORKTREES they ran in, and the BASE REF they land on are decided by
# the orchestrator and written down nowhere else, so a launch that leaves any of
# the three implicit sends an agent to produce the one artifact nobody may
# reproduce out of inputs it guessed. Those three and not a fourth: the rubric is
# deliberately absent, because the integrator writes no code and judges nothing —
# the bar belongs to the integration gate that follows, a separate oso-verifier
# launch the rule above already holds to naming `rubric.md`. Demanding it here
# would buy nothing and cost the reading: a launch line that hands the merger a
# rubric reads as though the merger judged the merged tree, which is the exact
# confusion a merge-only agent exists to prevent. LINE-scoped for the reason the
# rule above is: the payload is what the launched agent reads in one place. This
# rule SEES a line only when it carries BOTH `oso-integrator` and `launch` (the
# second matched case-insensitively) — a launch worded around only the first
# (`hand oso-integrator the wave...`) is invisible here and this linter goes on
# reporting clean over it, so the launch site carries both tokens. The wave
# loop's merge line in `skills/plan/SKILL.md` is the one launch site today, and
# it arrived carrying all three because this rule stood before it did, rather
# than being retrofitted after a wave merged onto a base ref nobody recorded.
# A launch site that does not exist is not a violation; a scan path that does not
# exist is, so the tree scan keeps grep's stderr (`2>&1`, per the header) and
# turns an unreadable path into a flag instead of a quiet zero. The integrator's
# own contract is the one file dropped: it is what a launch is read against,
# never a launch itself.
check_integrator_launches_name_their_payload() {
  local file line launch marker
  for file in $({ grep -rl 'oso-integrator' "$PLUGIN_ROOT" 2>&1 || true; }); do
    [ "$file" != "$PLUGIN_ROOT/agents/oso-integrator.md" ] || continue
    [ -f "$file" ] || { flag "the oso-integrator launch scan reached an unreadable path: $file"; continue; }
    for line in $({ grep -n 'oso-integrator' "$file" || true; } \
        | { grep -i 'launch' || true; } | cut -d: -f1); do
      launch="$(sed -n "${line}p" "$file")"
      for marker in 'worktree' 'base ref' 'branch'; do
        printf '%s\n' "$launch" | grep -qF "$marker" \
          || flag "${file#"$PLUGIN_ROOT"/}:$line launches oso-integrator without naming $marker in its payload"
      done
    done
  done
}

# docs/blueprint.md forbids editing its frozen body silently, so every correction
# lands as a decision file instead — and a decision whose correction never reached
# that body leaves the design entry point README points at reading as current
# while it is not. Where each one landed is written down exactly once, in its own
# `Reconciled:` line, so a decision filed without one costs the next reader a
# re-derivation against the whole body. Four words, because the honest answers are
# four: the body reads as the decision decided, a later decision retired it and the
# body deliberately reads otherwise, it landed outside the body, or it changed no
# file at all. The word alone will not do — a marker naming no location answers
# nothing — so the line must carry text after it.
check_every_decision_records_where_it_landed() {
  local decision found=0
  for decision in "$REPO_ROOT"/docs/decisions/*.md; do
    [ -f "$decision" ] || continue
    found=$((found + 1))
    grep -qE '^Reconciled: (applied|superseded|elsewhere|nowhere) .' "$decision" \
      || flag "${decision#"$REPO_ROOT"/} carries no Reconciled: applied/superseded/elsewhere/nowhere line saying where the decision landed"
  done
  [ "$found" -gt 0 ] || flag "docs/decisions/ holds no decision files to check"
}

# Checking only that a cited id EXISTS cannot catch a citation retargeted to the
# wrong decision, and five of the twelve citations were disambiguated by reading
# what the citing prose describes — a judgment nothing else in the repo records.
# So the relation is written from both ends and read from both: the skill names a
# decision id, that decision names the skill back in `Implemented-in:`, and a
# retarget breaks the second half even when the first still resolves. Scoped to
# the plugin tree, because that is where citations live and the blueprint's index
# names every id while implementing none.
check_decision_citations_resolve_and_name_their_citer() {
  local citation file id decision found
  for citation in $(decision_citations); do
    file="${citation%%:*}"
    id="${citation##*:}"
    found=""
    for decision in "$REPO_ROOT/docs/decisions/${id#ADR-}"-*.md; do
      [ -f "$decision" ] || continue
      found="$decision"
    done
    if [ -z "$found" ]; then
      flag "${file#"$REPO_ROOT"/} cites $id, which resolves to no file under docs/decisions/"
      continue
    fi
    { grep -F 'Implemented-in:' "$found" || true; } | grep -qF "${file#"$REPO_ROOT"/}" \
      || flag "${found#"$REPO_ROOT"/} is cited by ${file#"$REPO_ROOT"/} but does not name it in Implemented-in:"
  done
}

# grep prints the filename itself under -r, so `path:ADR-0046` needs no line
# number to name both ends of the pair — and dropping the line number is what
# collapses a decision cited twice in one file to the one pair that has to hold.
decision_citations() {
  { grep -rEo 'ADR-[0-9][0-9][0-9][0-9]' "$REPO_ROOT/plugin" 2>&1 || true; } | LC_ALL=C sort -u
}

# How many rules hold this ground is prose in two places — this file's header and
# README's linter row — and true in exactly one: the functions above. Nothing tied
# the three together, so a rule could land while both surfaces went on naming the
# old number, and a reader who checked would learn the count is decoration. Only
# PRESENT-tense surfaces are read: the changelog and the blueprint say what a
# release shipped, and a rule that read those would demand history be rewritten.
# Both surfaces spell the number out, so the table below turns the count into the
# word they use and a count past its end flags instead of guessing. The count
# includes this rule, which is the only way it can ever be right.
check_present_tense_prose_names_the_rule_count() {
  local declared spelled surface named
  declared="$({ grep -c '^check_[a-z_]*() {$' "$REPO_ROOT/tests/plugin-lint.sh" 2>&1 || true; })"
  case "$declared" in
    5) spelled=five ;; 6) spelled=six ;; 7) spelled=seven ;; 8) spelled=eight ;;
    9) spelled=nine ;; 10) spelled=ten ;; 11) spelled=eleven ;; 12) spelled=twelve ;;
    13) spelled=thirteen ;;
    *) flag "tests/plugin-lint.sh declares $declared rule functions, a count this rule has no word to look for"; return 0 ;;
  esac
  for surface in tests/plugin-lint.sh README.md; do
    named="$({ grep -ci "$spelled rules" "$REPO_ROOT/$surface" 2>&1 || true; })"
    case "$named" in
      ''|0|*[!0-9]*) flag "$surface does not name the $spelled rules this linter declares (grep answered ${named:-empty})" ;;
    esac
  done
}

# A generated artifact that is merely valid can still be the wrong artifact:
# Claude and Codex hooks.json may each parse while one matcher or command drifted
# from the table, and a digest calculated during installation would bless whatever
# bytes happened to arrive. The renderer owns both deterministic comparisons: its
# manifest check renders both hosts and compares their committed bytes, while its
# hash check requires exact, ordered coverage and compares current bytes only to
# the release-published ledger. Keeping this as one linter rule gives every suite
# invocation the same release boundary without teaching the linter either format.
check_hook_renders_and_published_hashes_match() {
  local renderer="$REPO_ROOT/tools/render-hooks-json.sh" report
  if [ ! -x "$renderer" ]; then
    flag "tools/render-hooks-json.sh is missing or not executable"
    return 0
  fi
  if ! report="$("$renderer" --repo-root "$REPO_ROOT" --check 2>&1)"; then
    flag "hook manifests diverge from their table: $(printf '%s' "$report" | tr '\n' ' ')"
  fi
  if ! report="$("$renderer" --repo-root "$REPO_ROOT" --check-hashes 2>&1)"; then
    flag "published hook hashes do not match their exact source set: $(printf '%s' "$report" | tr '\n' ' ')"
  fi
}

[ -d "$PLUGIN_ROOT/skills" ] || { echo "lint: no skills directory under $PLUGIN_ROOT"; exit 1; }

check_forked_skills_declare_background
check_own_references_resolve
check_forked_skills_declare_a_verdict_token
check_security_pass_acquires_without_a_remote
check_impeccable_pin_is_never_a_placeholder
check_call_sites_speak_their_emitters_verdict_vocabulary
check_global_routing_names_every_operator_only_mode
check_verifier_launches_name_their_payload
check_integrator_launches_name_their_payload
check_every_decision_records_where_it_landed
check_decision_citations_resolve_and_name_their_citer
check_present_tense_prose_names_the_rule_count
check_hook_renders_and_published_hashes_match

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean"
