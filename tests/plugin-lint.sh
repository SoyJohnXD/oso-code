#!/usr/bin/env bash
# Lints the rules `claude plugin validate --strict` has no opinion on: it does
# open hooks.json, skill frontmatter and the agents, and fails on a broken one
# (probed against client 2.1.220), but it never asks what they SAY. Twenty rules
# hold that ground: a `context: fork` skill declares `background`; the same
# skill declares an `end with exactly one of:` verdict block; every
# `oso-code:<name>` the plugin's own prose points at resolves; every call site
# of a skill OR AGENT that declares such a block carries EVERY token of an
# axis it engages, each paired on its own line with a recovery verb rather
# than merely named, and the skipped verdict of any axis whose other verdicts
# it reads; security-pass never acquires its diff from a remote-qualified
# ref; the Impeccable detect gate never carries a placeholder where its pin
# belongs; each host's always-loaded routing file names every mode the model cannot
# invoke on its own; every line that launches oso-verifier names the payload it
# hands it; every line that launches oso-integrator names the wave's worktrees,
# WAVE START and branch list; every plan-skill line that launches an applier or
# verifier names SLICE START or WAVE START by name, a debt-cleanup or
# judge-findings launch exempted since neither ever carries one; oso-integrator's
# report, on both hosts, names next_wave_start as WAVE START's only producer and
# states that a conflict or a blocked report yields none; triage's one question,
# its comparison-coordinate bullet and its pre-existing verdict all name WAVE
# START, the bullet disambiguating it from CHANGE BASE on the same line; every
# decision under docs/decisions/ says where it
# landed; every decision a skill cites resolves to one of those files AND is
# named back by it; the prose that says how many rules hold this ground says a
# number the functions below make true; both hook manifests plus every
# release-published hook hash exactly match their single source; the milestone
# reporting contract names every required fact of its five milestones plus a
# length bound, and every flow body that arms a slice or launches a delegation
# points at it; the Claude-card/Codex-no-card difference the contract defers
# to a host lives in exactly one platform file per host, never in the neutral
# body and never in both hosts' trees at once; the design-foundation slice
# paragraph names what `init` and `document` each produce and requires reading
# and recording the installed Impeccable version before the slice is cut; and
# the Codex harness-discovered-correction amendment lane asserts all four of
# its conditions — an unstarted slice, a cited file and line, one operator
# confirmation, and a recorded amendment. Each rule states its own reason
# above
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
# whether the call sites SPEAK AND ROUTE them — for every skill AND agent
# carrying a terminal-token block, not just the forked skills: quality-pass
# runs inline and still ends on `Quality Pass: passed`, oso-integrator carries
# no SKILL.md at all and still ends on `status: blocked`, and a gate worded
# around a verdict its emitter never says is equally broken either way.
#
# Tokens are read per AXIS — one `end with exactly one of:` block — because an
# emitter can hold several that never resolve together: debt-sweep's debt
# findings and ledger conformance both run on every invocation, and a
# whole-report `blocked` axis of one token pre-empts either running at all.
# Flattening every axis into one bag, the way this rule used to, is what let a
# caller satisfy the whole emitter by naming one token from whichever axis was
# easiest — never proving it could handle the axis a `blocked` drift actually
# lands on. Within an axis, the token containing `: skipped` is the one
# legitimate partial read: a caller that names ONLY it — /debug's Conformance
# axis, whose sweep never carries a ledger to judge — is asked for nothing
# else, because `skipped` is the whole did-not-run vocabulary that axis has.
# Naming any OTHER token of the axis makes every other one mandatory, skip
# included: a site that acts on an axis and never carries the answer "it did
# not run" reads that answer as neither verdict and opens its green write over
# an axis that never ran.
#
# Mention is not the bar the doubt pass asked for: "callers gain mechanical
# token lists that satisfy the lint while handling nothing." A token is
# ROUTED only when some LINE carrying it also carries one of this repo's own
# recovery verbs below — never a bare backtick list pasted to satisfy a lint.
# That pairing is a heuristic, not a proof: it cannot tell a verb that truly
# answers THIS token from one describing an unrelated clause sharing its long
# paragraph-line, and it cannot read a route spread across several lines the
# way `check_verifier_launches_name_their_payload` above deliberately reads a
# launch as one line. Both are this rule's stated ceiling, not a silent gap:
# within it, the check is exact — an axis's coverage is one of a small,
# enumerable set of shapes below, and anything outside that set is flagged
# with the token that made it so.
#
# Agents are reachable here too, but only as far as an agent file volunteers a
# vocabulary: `status: done|conflict|blocked` bare-word verdicts collide with
# ordinary prose too often to grep safely on their own, so an agent counts as
# an emitter only once its file carries the SAME `end with exactly one of:`
# block a skill body already uses. oso-integrator is the one agent that does;
# oso-applier and oso-verifier's differently-shaped `status:`/`verdict:` lines
# stay outside this rule's reach exactly like a skill with no verdict block
# stays outside the rule above it — an honest boundary, not an oversight.
ROUTE_WORDS_RE='resolve|relaunch|re-invoke|reinvoke|invoke|launch|route|report|operator|offer|apply|fix|escalate|retry|loop|unlock|repeat|accept|reject|continue|resume|re-run|rerun'

check_call_sites_speak_their_emitters_verdict_vocabulary() {
  local skill emitter host caller caller_sources agent agent_name
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    emitter="$(basename "$(dirname "$skill")")"
    for host in claude codex; do
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
        axis_coverage_is_routed "${caller#"$PLUGIN_ROOT"/} invokes $emitter on $host" \
          "$(verdict_axes_from_sources $(skill_sources "$skill" "$host"))" $caller_sources
      done
    done
  done

  # A custom-role agent is named identically on every host — the same bare
  # backtick identity (`oso-integrator`) and the same `status:` values launch
  # it whether the caller runs on Claude or Codex — so unlike a skill's
  # `oso-code:` prefix, no host split is needed to recognize a caller here.
  for agent in "$PLUGIN_ROOT"/agents/*.md; do
    [ -f "$agent" ] || continue
    grep -qi 'end with exactly one of:' "$agent" || continue
    agent_name="$(basename "$agent" .md)"
    for host in claude codex; do
      for caller in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
        [ -f "$caller" ] || continue
        caller_sources="$(skill_sources "$caller" "$host" | tr '\n' ' ')"
        grep -qF "\`$agent_name\`" $caller_sources || continue
        axis_coverage_is_routed "${caller#"$PLUGIN_ROOT"/} invokes $agent_name on $host" \
          "$(verdict_axes_from_sources "$agent")" $caller_sources
      done
    done
  done
}

# One line per axis, its tokens tab-joined — gathered across every bound
# source an emitter carries, since the verdict block always lives in exactly
# one of them but a multi-file skill hands its sources to callers uniformly
# elsewhere in this linter, and a future split across files should not go
# unseen here either.
verdict_axes_from_sources() {
  local source header
  for source in "$@"; do
    [ -f "$source" ] || continue
    for header in $({ grep -in 'end with exactly one of:' "$source" || true; } | cut -d: -f1); do
      tokens_after_header "$source" "$header" | tr '\n' '\t'
      echo
    done
  done
}

# The backticked list items under one `end with exactly one of:` header — blank
# lines skipped, the run ending at the first line that is neither.
tokens_after_header() {
  local source="$1" header="$2" line token
  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      '- `'*) token="${line#- \`}"; printf '%s\n' "${token%%\`*}" ;;
      *) break ;;
    esac
  done <<< "$(sed -n "$((header + 1)),\$p" "$source")"
}

# One axis's tab-joined tokens against one caller's bound sources (the
# trailing arguments). `label` opens every flag this axis can raise, so a
# report reads as one sentence continued rather than three different voices
# depending on which of the shapes below a caller's coverage turned out to be.
axis_coverage_is_routed() {
  local label="$1" axes="$2"; shift 2
  local axis_line axis_name first_token skip others token
  local total=0 named=0 missing unrouted
  [ -n "$axes" ] || return 0
  while IFS= read -r axis_line; do
    [ -n "$axis_line" ] || continue
    first_token="$(printf '%s\n' "$axis_line" | tr '\t' '\n' | head -1)"
    axis_name="${first_token%%:*}"
    skip="$(printf '%s\n' "$axis_line" | tr '\t' '\n' | { grep -F ': skipped' || true; })"
    others="$(printf '%s\n' "$axis_line" | tr '\t' '\n' | { grep -vF ': skipped' || true; } | { grep -v '^$' || true; })"
    [ -n "$others" ] || continue
    total=0; named=0; missing=""
    while IFS= read -r token; do
      [ -n "$token" ] || continue
      total=$((total + 1))
      if grep -qF -- "$token" "$@"; then
        named=$((named + 1))
      else
        missing="$missing\`$token\`, "
      fi
    done <<< "$others"
    if [ "$named" -eq 0 ]; then
      if [ -n "$skip" ] && grep -qF -- "$skip" "$@"; then
        continue # the sanctioned partial read: skip named, nothing else is
      fi
      flag "$label but carries none of its $axis_name tokens"
      continue
    fi
    if [ "$named" -lt "$total" ]; then
      flag "$label and names some of its $axis_name tokens but not all — missing ${missing%, }"
      continue
    fi
    if [ -n "$skip" ] && ! grep -qF -- "$skip" "$@"; then
      flag "$label and reads $axis_name verdicts but never names \`$skip\`"
      continue
    fi
    unrouted=""
    while IFS= read -r token; do
      [ -n "$token" ] || continue
      token_is_routed "$token" "$@" || unrouted="$unrouted\`$token\`, "
    done <<< "$others"
    if [ -n "$skip" ] && ! token_is_routed "$skip" "$@"; then
      unrouted="$unrouted\`$skip\`, "
    fi
    [ -z "$unrouted" ] || \
      flag "$label and names every $axis_name token but leaves some with no route beside the token — bare: ${unrouted%, }"
  done <<< "$axes"
}

# True once some LINE across the given files carries the token verbatim AND
# one of the route words above — a bare list item never does, since the words
# alone would satisfy the file-scoped presence check this function replaces.
# `-h` drops grep's own filename prefix from the piped line: a fixture path
# ending in `-fixture` carries `fix` as a plain substring, and without `-h`
# that path text, never the prose, is what would satisfy the second grep.
token_is_routed() {
  local token="$1"; shift
  [ "$#" -gt 0 ] || return 1
  { grep -Fh -- "$token" "$@" || true; } | grep -qEi "$ROUTE_WORDS_RE"
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
# wave, the WORKTREES they ran in, and WAVE START — the commit they land on —
# are decided by the orchestrator and written down nowhere else, so a launch
# that leaves any of the three implicit sends an agent to produce the one
# artifact nobody may reproduce out of inputs it guessed. Those three and not a
# fourth: the rubric is
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
# than being retrofitted after a wave merged onto a ref nobody recorded — and
# it moved from a bare `base ref` to the named `WAVE START` the same slice that
# gave the wave loop's worktree cut the coordinate it was always missing
# (docs/decisions/0118).
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
      for marker in 'worktree' 'WAVE START' 'branch'; do
        printf '%s\n' "$launch" | grep -qF "$marker" \
          || flag "${file#"$PLUGIN_ROOT"/}:$line launches oso-integrator without naming $marker in its payload"
      done
    done
  done
}

# docs/decisions/0118 replaced the wave loop's single base ref with three named
# coordinates precisely because a payload that just said BASE REF could not say
# WHICH one it needed — the wave loop cut every worktree from CHANGE BASE
# regardless of which wave was arming, and the sequential verifier's ref never
# moved off it between slices either. Its verify criterion (d) is that every
# applier/verifier launch now names SLICE START or WAVE START by that name.
# This is a POSITIVE requirement, not a ban on the retired spelling: a rule
# that only rejected the string BASE REF would pass a launch line naming NO
# coordinate at all just as clean, which is the identical ambiguity under a
# different shape — the gap a first cut of this rule left open. One kind is
# excluded on purpose: a debt-cleanup or judge-findings launch (ADR-0063's
# other two applier kinds) is self-contained by its own agent contract and
# never carries a ref coordinate at all, so requiring one there would be a
# false positive on a launch that is correctly starved of it — `debt cleanup`
# and `judge findings` are this file's own stable vocabulary for those two
# kinds, so a line naming either is exempted rather than demanded a
# coordinate it structurally cannot have. Scoped to the `plan` skill alone —
# the only flow with waves and more than one coordinate to confuse: `debug`'s
# own applier/verifier launches legitimately say BASE REF for the single
# pending-tree ref that flow has ever had (its own body names it `HEAD`), and
# flagging those would be exactly the false positive this rule exists to
# avoid. LINE-scoped for the reason `check_verifier_launches_name_their_payload`
# already is: the payload is what the launched agent reads in one place, and a
# launch worded around the coordinate on a later line is invisible here the
# same way a launch worded around `oso-integrator` is invisible to the rule
# above.
check_plan_delegation_payloads_name_a_specific_coordinate() {
  local skill="$PLUGIN_ROOT/skills/plan/SKILL.md"
  local source line launch
  [ -f "$skill" ] || { flag "no skills/plan/SKILL.md to check delegation payload coordinates"; return 0; }
  for source in $(skill_sources "$skill"); do
    for line in $({ grep -nE 'oso-applier|oso-verifier' "$source" || true; } \
        | { grep -i 'launch' || true; } | cut -d: -f1); do
      launch="$(sed -n "${line}p" "$source")"
      printf '%s\n' "$launch" | grep -qE 'debt cleanup|judge findings' && continue
      printf '%s\n' "$launch" | grep -qE 'SLICE START|WAVE START' \
        || flag "${source#"$PLUGIN_ROOT"/}:$line launches an applier or verifier naming neither SLICE START nor WAVE START"
    done
  done
  return 0
}

# docs/decisions/0118 names the integrator as WAVE START's only producer and
# says a conflict or a blocked report yields no clean integration commit to
# hand the next wave. Prose making that claim is exactly the shape a rewrite
# can silently drop — nothing else in the harness re-derives `next_wave_start`,
# so its absence from the report shape is invisible until a later wave cuts a
# worktree from a stale ref. Two markers, on both the Claude agent file and
# the Codex role that mirrors it: the field name itself, proving the report
# shape carries it, and one line naming it beside BOTH `conflict` and
# `blocked`, proving the no-clean-integration case is stated rather than
# merely implied by the field's absence on those paths.
check_integrator_report_names_next_wave_start() {
  local file marker
  for file in "$PLUGIN_ROOT/agents/oso-integrator.md" "$REPO_ROOT/codex/agents/oso-integrator.toml"; do
    if [ ! -f "$file" ]; then
      flag "no $file to check for next_wave_start"
      continue
    fi
    grep -qF 'next_wave_start' "$file" \
      || flag "${file#"$REPO_ROOT"/} never names next_wave_start as WAVE START's producer"
    { grep -F 'next_wave_start' "$file" || true; } | grep -qi 'conflict' \
      && { grep -F 'next_wave_start' "$file" || true; } | grep -qi 'blocked' \
      || flag "${file#"$REPO_ROOT"/} never states that a conflict or a blocked report yields no next_wave_start"
  done
}

# docs/decisions/0118 fixed triage's own ambiguity — "the base ref" could have
# meant the wave's WAVE START or the change's own CHANGE BASE, and getting it
# wrong misattributes an earlier wave's landed work to the wave in flight.
# Naming WAVE START alone is not enough to prove the ambiguity is closed: a
# rewrite could drop CHANGE BASE back in unnamed and reintroduce the same
# question this decision closed. So three markers, each on the file's own
# named anchor rather than scanned loose: the one question itself, the
# comparison-coordinate bullet naming WAVE START beside CHANGE BASE on the
# same line (the actual disambiguation), and the pre-existing verdict that
# reads the answer back.
check_triage_names_wave_start_unambiguously() {
  local file="$PLUGIN_ROOT/skills/_shared/bodies/triage.md"
  local question preexisting
  if [ ! -f "$file" ]; then
    flag "no triage body at skills/_shared/bodies/triage.md to check its comparison coordinate"
    return 0
  fi
  question="$({ grep -F -- '**Is this breakage attributable' "$file" || true; })"
  if [ -z "$question" ]; then
    flag "skills/_shared/bodies/triage.md carries no 'Is this breakage attributable' question to check"
  else
    printf '%s\n' "$question" | grep -qF 'WAVE START' \
      || flag "skills/_shared/bodies/triage.md's one question never names WAVE START"
  fi
  { grep -F 'WAVE START' "$file" || true; } | grep -qF 'CHANGE BASE' \
    || flag "skills/_shared/bodies/triage.md names WAVE START but never disambiguates it from CHANGE BASE on the same line"
  preexisting="$({ grep -F -- '`Triage: pre-existing`' "$file" || true; })"
  if [ -z "$preexisting" ]; then
    flag "skills/_shared/bodies/triage.md carries no Triage: pre-existing verdict line to check"
  else
    printf '%s\n' "$preexisting" | grep -qF 'WAVE START' \
      || flag "skills/_shared/bodies/triage.md's Triage: pre-existing verdict never names WAVE START"
  fi
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
    13) spelled=thirteen ;; 14) spelled=fourteen ;; 15) spelled=fifteen ;;
    16) spelled=sixteen ;; 17) spelled=seventeen ;; 18) spelled=eighteen ;;
    19) spelled=nineteen ;; 20) spelled=twenty ;;
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

# An operator running unattended sees a tool call and its output and nothing
# else unless something in the harness SAYS what it means — "report the
# result" already existed before this rule and already produced the
# complaint, so mention of the contract is not the bar: each of its five
# milestone bullets must carry the facts that make it more than that sentence,
# a length bound must exist so the fix does not trade silence for narration,
# and every flow body that arms a slice or launches a delegation must point at
# it — checked per body, never as one file's existence standing in for three.
# The required-fact markers below are this rule's own choice, not a text
# copied out of the contract file — chosen because the contract's own prose
# already carries them for the readability win they name, so a milestone
# stripped to "report the result" loses the marker along with the meaning.
check_milestone_reporting_contract_is_complete() {
  local contract="$PLUGIN_ROOT/skills/_shared/reporting.md"
  if [ ! -f "$contract" ]; then
    flag "no milestone reporting contract at skills/_shared/reporting.md"
    return 0
  fi

  milestone_bullet_names_its_facts "$contract" "Arming" "slice" "Goal"
  milestone_bullet_names_its_facts "$contract" "Launching" "role" "assignment" "tree"
  milestone_bullet_names_its_facts "$contract" "Reading a verdict" "pass" "fail" "blocked" "fact"
  milestone_bullet_names_its_facts "$contract" "A judge's outcome" "verdict" "count"
  milestone_bullet_names_its_facts "$contract" "Closing" "commit" "next"

  grep -qE '[Aa]t most [0-9]+ lines?' "$contract" \
    || flag "skills/_shared/reporting.md names no length bound on a milestone report"

  # Discovered the same way rule 7 discovers an operator-only mode — from
  # `disable-model-invocation: true` frontmatter — rather than a hardcoded
  # plan/quick/debug list, so a fourth mode is caught the same way a fourth
  # routing gap already is.
  local mode_skill mode mode_body
  for mode_skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$mode_skill" ] || continue
    printf '%s\n' "$(frontmatter "$mode_skill")" \
      | grep -qE '^disable-model-invocation:[[:space:]]*true[[:space:]]*$' || continue
    mode="$(basename "$(dirname "$mode_skill")")"
    mode_body="$PLUGIN_ROOT/skills/_shared/bodies/$mode.md"
    if [ ! -f "$mode_body" ]; then
      flag "$mode is an operator-only mode with no skills/_shared/bodies/$mode.md to carry the milestone contract"
      continue
    fi
    grep -qF 'reporting.md' "$mode_body" \
      || flag "skills/_shared/bodies/$mode.md arms or launches without referencing the milestone contract at _shared/reporting.md"
  done
}

# A bullet that names its own header but not the facts underneath is exactly
# the "report the result" shape the operator's complaint already produced, so
# mention of the milestone alone must not satisfy this — every marker is
# required on the SAME line as the header, this repo's own dense
# single-line-bullet style (ADR-0114 notes call sites are written this way).
milestone_bullet_names_its_facts() {
  local contract="$1" name="$2" bullet marker
  shift 2
  bullet="$({ grep -F -- "**$name**" "$contract" || true; })"
  if [ -z "$bullet" ]; then
    flag "skills/_shared/reporting.md names no '$name' milestone"
    return 0
  fi
  for marker in "$@"; do
    printf '%s\n' "$bullet" | grep -qi -- "$marker" \
      || flag "skills/_shared/reporting.md's '$name' milestone never names its required fact: $marker"
  done
}

# The TUI-card difference is real (Claude draws one over a launch, Codex draws
# none) and is exactly the kind of fact this change's own goal forbids writing
# twice: it must live in ONE platform file per host, never inside the neutral
# contract and never repeated across a host's own three mode wrappers. The two
# marker phrases are this rule's fixture for that fact, matched against the
# exact prose the reporting files carry — a drift that copies the sentence
# into a second file, or lets it leak into skills/_shared/bodies or the other
# host's tree, is what this counts rather than merely asking whether the file
# exists.
check_reporting_host_difference_is_single_sourced() {
  local claude_marker='native subagent card'
  local codex_marker='draws no card'
  local claude_hosts codex_hosts neutral_leak cross_leak count

  claude_hosts="$({ grep -rlF "$claude_marker" "$PLUGIN_ROOT/skills/_shared/platform/claude" 2>&1 || true; })"
  count="$(printf '%s\n' "$claude_hosts" | grep -c . || true)"
  case "$count" in
    1) ;;
    0) flag "no file under skills/_shared/platform/claude states the native-card difference the milestone contract needs" ;;
    *) flag "the native-card difference is stated in $count platform/claude files instead of exactly one: $(printf '%s' "$claude_hosts" | tr '\n' ' ')" ;;
  esac

  codex_hosts="$({ grep -rlF "$codex_marker" "$PLUGIN_ROOT/skills/_shared/platform/codex" 2>&1 || true; })"
  count="$(printf '%s\n' "$codex_hosts" | grep -c . || true)"
  case "$count" in
    1) ;;
    0) flag "no file under skills/_shared/platform/codex states the no-card difference the milestone contract needs" ;;
    *) flag "the no-card difference is stated in $count platform/codex files instead of exactly one: $(printf '%s' "$codex_hosts" | tr '\n' ' ')" ;;
  esac

  neutral_leak="$({ grep -rlE "$claude_marker|$codex_marker" \
    "$PLUGIN_ROOT/skills/_shared/bodies" "$PLUGIN_ROOT/skills/_shared/reporting.md" 2>&1 || true; })"
  [ -z "$neutral_leak" ] || flag "the host-specific card difference leaked into the neutral body or contract: $(printf '%s' "$neutral_leak" | tr '\n' ' ')"

  cross_leak="$({ grep -rlF "$codex_marker" "$PLUGIN_ROOT/skills/_shared/platform/claude" 2>&1 || true
    grep -rlF "$claude_marker" "$PLUGIN_ROOT/skills/_shared/platform/codex" 2>&1 || true; })"
  [ -z "$cross_leak" ] || flag "a host-specific card difference crossed into the other host's platform tree: $(printf '%s' "$cross_leak" | tr '\n' ' ')"
}

# The Astro-landing incident (docs/decisions/0116) traced to one paragraph that
# asserted Impeccable's `init`/`document` split from this file's own memory
# instead of the installed contract, and to nobody recording which version was
# actually read — the version slice B14's pin must reconcile against. Both are
# now single, literal sentences a future rewrite could silently drop; this
# holds the paragraph to naming all five, so losing one fails instead of
# drifting back to the same guess. Same technique as
# `milestone_bullet_names_its_facts`: find the one paragraph by its own bold
# lead-in, then hold it to every marker.
check_design_foundation_slice_reads_the_installed_contract() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  local paragraph marker
  if [ ! -f "$body" ]; then
    flag "no plan body at skills/_shared/bodies/plan.md to check the design-foundation slice paragraph"
    return 0
  fi
  paragraph="$({ grep -F -- '**Design-foundation slice' "$body" || true; })"
  if [ -z "$paragraph" ]; then
    flag "skills/_shared/bodies/plan.md carries no Design-foundation slice paragraph"
    return 0
  fi
  for marker in 'SKILL.md' 'version' 'ledger' '`init` writes `PRODUCT.md`' '`document` writes `DESIGN.md`'; do
    printf '%s\n' "$paragraph" | grep -qF -- "$marker" \
      || flag "skills/_shared/bodies/plan.md's Design-foundation slice paragraph never states: $marker"
  done
}

# Verify criterion (d) for docs/decisions/0117 asks for all four conditions
# asserted together, the citation especially — a lane that drops the citation
# is the harness rewriting an approved slice on its own word, exactly what the
# operator objected to losing. Same technique as the rule above: one paragraph
# found by its own bold lead-in, held to every marker.
check_third_amendment_lane_names_its_conditions() {
  local file="$PLUGIN_ROOT/skills/_shared/platform/codex/plan.md"
  local paragraph marker
  if [ ! -f "$file" ]; then
    flag "no Codex plan platform file to check the third amendment lane"
    return 0
  fi
  paragraph="$({ grep -F -- 'harness-discovered correction' "$file" || true; })"
  if [ -z "$paragraph" ]; then
    flag "skills/_shared/platform/codex/plan.md carries no harness-discovered-correction amendment lane"
    return 0
  fi
  for marker in 'NOT STARTED' 'CITES' 'CONFIRMS' 'amend-plan'; do
    printf '%s\n' "$paragraph" | grep -qF -- "$marker" \
      || flag "skills/_shared/platform/codex/plan.md's harness-discovered-correction lane never asserts: $marker"
  done
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
check_plan_delegation_payloads_name_a_specific_coordinate
check_integrator_report_names_next_wave_start
check_triage_names_wave_start_unambiguously
check_every_decision_records_where_it_landed
check_decision_citations_resolve_and_name_their_citer
check_present_tense_prose_names_the_rule_count
check_hook_renders_and_published_hashes_match
check_milestone_reporting_contract_is_complete
check_reporting_host_difference_is_single_sourced
check_design_foundation_slice_reads_the_installed_contract
check_third_amendment_lane_names_its_conditions

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean"
