#!/usr/bin/env bash
# Lints the rules `claude plugin validate --strict` has no opinion on: it does
# open hooks.json, skill frontmatter and the agents, and fails on a broken one
# (probed against client 2.1.220), but it never asks what they SAY.
# Thirty-two rules hold that ground: a `context: fork` skill declares
# `background`; the same skill declares an `end with exactly one of:` verdict
# block; every `oso-code:<name>` the plugin's own prose points at resolves; every
# call site of a skill OR AGENT that declares such a block carries EVERY token
# of an axis it engages, each paired on its own line with a recovery verb rather
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
# landed; the blueprint's own decision index names every file docs/decisions/
# holds; every decision id the plugin's prose cites resolves to one of those
# files, while no comment in an executable this repo ships cites one at all; the
# prose that says how many rules hold this ground says a number the functions
# below make true; both hook manifests plus every
# release-published hook hash exactly match their single source; the milestone
# reporting contract names every required fact of its five milestones plus a
# length bound, and every flow body that arms a slice or launches a delegation
# points at it; the Claude-card/Codex-no-card difference the contract defers
# to a host lives in exactly one platform file per host, never in the neutral
# body and never in both hosts' trees at once; the design-foundation slice
# paragraph names what `init` and `document` each produce and requires reading
# and recording the installed Impeccable version before the slice is cut; the
# Codex harness-discovered-correction amendment lane asserts all four of
# its conditions — an unstarted slice, a cited file and line, one operator
# confirmation, and a recorded amendment; the Wave 0 bullet and the
# Cut-one-worktree-per-slice paragraph never go back to contradicting each
# other over wave 1's own WAVE START; the shared rubric states the inline
# comment as a debt class with no exceptions, one the judgment contract cannot
# override, carrying no earned-WHY escape hatch; oso-applier's rubric mapping
# names all five of that rubric's sections, Debt markers included, so the writer
# is told the section it is graded on; oso-verifier's contract, on both hosts,
# fails a slice whose diff adds an inline comment, so the judge that runs before
# each slice commits can refuse one; both bodies that run a debt-sweep judge →
# fix loop state an exit bar for it — a severity band, a hard cap of three rounds
# and the operator's three routes at that cap — so the loop can never go back to
# running until clean, and no surface that states that loop's outcome reads
# `Debt Sweep: clean` as the whole of its pass; and that same loop carries its
# own memory across rounds — each body's re-invocation restating the prior
# findings' dispositions and nothing of the reasoning behind them, and the
# judge's own body naming a dispositioned finding as settled instead of raising
# it again — so no round can re-litigate what the last one closed; and the roadmap
# body's approval phase names every clause that bounds its one approval — the
# planning and the execution it covers, every child of the queue, the fresh
# approval a materially changed queue needs, each child's own plan document, and
# the platform file that owns a host's extra stop; and that body's autonomy-policy
# phase declares every clause its policy turns on — the three tiers it resolves a
# decision by, the delegated record whichever tier answers takes, the
# irreversibility bar and the four-item never-solo list that stop it deciding at
# all, and the inherited entry and the reconciliation that keep the global ledger
# answering a child's question without overruling the child's own evidence; and the
# two texts that hand a decision to the operator — the plan body's applier-blocked
# route and the output style's decision rule — keep that instruction absolute while
# naming the roadmap that conditions it and the queued outcome that bounds what the
# condition buys; and that body's chain phase declares what an unattended arming
# turns on — the porcelain bar it reads before handing one working tree to the
# next child, the worktree root it reads beside it, the refusal it takes when
# either fails, and the runtime key that makes the chain recoverable, armed and
# disarmed by the flow, read by the two hooks that drop it and report it, and
# gating nothing. Each rule
# states its own reason above it; `background` is the one whose cost is least
# visible: as of client v2.1.218 a fork returns immediately and its verdict
# arrives in a LATER turn, while every call site in plan/quick/debug reads that
# verdict in-turn.
#
# That reason is a rule's SPECIFICATION — the defect it caught, what keeps it
# decidable, the ceiling it does not reach past — and it sits above the function
# because a preceding block is the only place shell has to put a contract a name
# cannot carry. This header is where that shape is claimed as a file's contract,
# and it is claimed HERE rather than in anything the harness exports: the shared
# rubric's inline-comment class stays absolute for the code a change lands in a
# project, and a decision citation above a constant in a target project's source
# is exactly as indefensible as it was before this file said any of it. No reason
# below carries a decision id in any notation this repo writes one, which is the
# one thing the reasons and the exported bar agree on exactly, and which the last
# decision rule scans this file for alongside every other executable here.
#
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
# Six rules below reach outside the plugin tree — the pin scan, the routing
# files, the decision files, the citations that bind the plugin to them, the
# executables the citation ban scans, and the rule count's own prose surfaces —
# so the repo resolves the same way the default PLUGIN_ROOT does. A second
# argument exists only so tests/hooks-test.sh can run the whole linter against an
# isolated mutated copy; normal calls omit it and resolve from this file's own
# location.
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
ROUTE_WORDS_RE='resolve|invoke|launch|route|report|operator|offer|apply|fix|escalate|retry|loop|unlock|repeat|accept|reject|continue|resume|re-run|rerun'

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
# gave the wave loop's worktree cut the coordinate it was always missing.
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

# The wave loop's single base ref became three named coordinates precisely
# because a payload that just said BASE REF could not say WHICH one it needed —
# the wave loop cut every worktree from CHANGE BASE regardless of which wave was
# arming, and the sequential verifier's ref never moved off it between slices
# either. So every applier/verifier launch names SLICE START or WAVE START by
# that name.
# This is a POSITIVE requirement, not a ban on the retired spelling: a rule
# that only rejected the string BASE REF would pass a launch line naming NO
# coordinate at all just as clean, which is the identical ambiguity under a
# different shape — the gap a first cut of this rule left open. One kind is
# excluded on purpose: a debt-cleanup or judge-findings launch — the applier's
# other two kinds — is self-contained by its own agent contract and never carries
# a ref coordinate at all, so requiring one there would be a false positive on a
# launch that is correctly starved of it — `debt cleanup` and `judge findings`
# are this file's own stable vocabulary for those two kinds, so a line naming
# either is exempted rather than demanded a coordinate it structurally cannot
# have. Scoped to the `plan` skill alone — the only flow with waves and more than
# one coordinate to confuse: `debug`'s own applier/verifier launches legitimately
# say BASE REF for the single pending-tree ref that flow has ever had (its own
# body names it `HEAD`), and flagging those would be exactly the false positive
# this rule exists to avoid. LINE-scoped for the reason
# `check_verifier_launches_name_their_payload` already is: the payload is what
# the launched agent reads in one place, and a launch worded around the
# coordinate on a later line is invisible here the same way a launch worded
# around `oso-integrator` is invisible to the rule above.
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

# The integrator is WAVE START's only producer, and a conflict or a blocked
# report yields no clean integration commit to hand the next wave. Prose making
# that claim is exactly the shape a rewrite can silently drop — nothing else in
# the harness re-derives `next_wave_start`, so its absence from the report shape
# is invisible until a later wave cuts a worktree from a stale ref. Two markers,
# on both the Claude agent file and the Codex role that mirrors it: the field
# name itself, proving the report shape carries it, and one line naming it beside
# BOTH `conflict` and `blocked`, proving the no-clean-integration case is stated
# rather than merely implied by the field's absence on those paths.
check_integrator_report_names_next_wave_start() {
  local file
  for file in "$PLUGIN_ROOT/agents/oso-integrator.md" "$REPO_ROOT/codex/agents/oso-integrator.toml"; do
    if [ ! -f "$file" ]; then
      flag "no $file to check for next_wave_start"
      continue
    fi
    grep -qF 'next_wave_start' "$file" \
      || flag "${file#"$REPO_ROOT"/} never names next_wave_start as WAVE START's producer"
    { grep -F 'next_wave_start' "$file" || true; } | { grep -i 'conflict' || true; } | grep -qi 'blocked' \
      || flag "${file#"$REPO_ROOT"/} never states that a conflict or a blocked report yields no next_wave_start"
  done
}

# Triage carried the same ambiguity — "the base ref" could have meant the wave's
# WAVE START or the change's own CHANGE BASE, and getting it wrong misattributes
# an earlier wave's landed work to the wave in flight. Naming WAVE START alone is
# not enough to prove the ambiguity is closed: a rewrite could drop CHANGE BASE
# back in unnamed and reintroduce the same question. So three markers, each on
# the file's own named anchor rather than scanned loose: the one question, the
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

# The rule above proves every FILE says where it landed; it never proves the
# INDEX names every file — a decision file once carried a clean Reconciled line
# and still read as though it never happened, because nothing checked the index
# against the directory it is supposed to summarize. A decision dropped from the
# index is invisible to a reader who trusts the index and never lists
# docs/decisions/ directly, which is what the index exists to save them from
# doing.
check_blueprint_index_names_every_decision() {
  local decision base id found=0
  for decision in "$REPO_ROOT"/docs/decisions/*.md; do
    [ -f "$decision" ] || continue
    found=$((found + 1))
    base="$(basename "$decision")"
    id="${base%%-*}"
    grep -qF "[$id](decisions/$base)" "$REPO_ROOT/docs/blueprint.md" \
      || flag "docs/blueprint.md's decision index never names $id (docs/decisions/$base)"
  done
  [ "$found" -gt 0 ] || flag "docs/decisions/ holds no decision files to check against the blueprint index"
}

# What survives here is link integrity for DOCUMENTS, and only that. This rule
# used to read the relation from both ends — the citer names a decision, that
# decision names the citer back in `Implemented-in:` — and the back-reference half
# is gone with the lines that fed it: no decision file carries `Implemented-in:`
# any more, so the second half would now fail on every citation in the tree.
# What is left is a real defect class of its own. Thirty-six decision ids are
# named across twelve markdown files under skills/ and agents/, forty-three of
# those references in `bodies/plan.md` alone, and a decision renumbered or removed
# leaves every one of them pointing at nothing: a reader follows the id to a file
# that is not there, and no other check in this repo resolves one of these ids.
# Scoped to the plugin tree, because that is where they live and the blueprint's
# index names every id while implementing none. Every reference the scan now finds
# is markdown PROSE — a document pointing at the document that decided it, which
# is a cross-reference — because the rule below forbids the comment form outright,
# in the executables where an id names something a reader of the code cannot open.
check_cited_decisions_resolve_to_a_file() {
  local citation file id decision found
  for citation in $(decision_citations); do
    file="${citation%%:*}"
    id="${citation##*:}"
    found=""
    for decision in "$REPO_ROOT/docs/decisions/${id#ADR-}"-*.md; do
      [ -f "$decision" ] || continue
      found="$decision"
    done
    [ -n "$found" ] \
      || flag "${file#"$REPO_ROOT"/} cites $id, which resolves to no file under docs/decisions/"
  done
}

# grep prints the filename itself under -r, so the `path:id` pair needs no line
# number to name both ends of it — and dropping the line number is what collapses
# a decision cited twice in one file to the one pair that has to hold.
decision_citations() {
  { grep -rEo 'ADR-[0-9][0-9][0-9][0-9]' "$REPO_ROOT/plugin" 2>&1 || true; } | LC_ALL=C sort -u
}

# The inverse of the rule above, and the reason it can stay narrow. A decision id
# in a document is a cross-reference; the same id in a comment is provenance the
# code cannot show and the reader cannot open — and this repo taught the habit by
# example. Its own executables carried a hundred and fifty-six of them, in the
# files an applier reads to learn how this project writes a script; the notation
# arrives in a target project's source, where the ledger those tags name did not
# outlive the change that wrote it and never existed for that reader at all. The
# shared rubric bans it there. This bans it here, so the harness cannot go on
# exporting the convention by demonstration. Every shape it bans is spelled out in
# the pattern below and NOWHERE in this prose, because this file is one of the
# files scanned: a reason that reached for an example would be a violation of the
# rule it is explaining, which is the ban holding without an exception carved for
# the rule that states it.
#
# The file set opens with the six `bash -n` groups ci.yml runs, spelled the same
# way and in the same order, and does not close there: that gate reaches what bash
# can parse, while this ban is about what the repo ships to be RUN, so the Windows
# entry points and the awk program under bootstrap/lib follow them. The paths
# below are the whole of it — an executable written in a language none of them
# names goes unscanned until it joins them, which is this set's ceiling and not a
# claim it makes for itself. The scan keeps grep's stderr (`2>&1`, per the
# header), so a glob whose directory vanished surfaces as two misnamed violations
# instead of an empty read.
#
# COMMENT lines only, and the locator is the line rather than the syntax tree, so a
# `#`-leading line inside a heredoc reads as a comment here — which errs toward
# flagging, never toward missing one — while a string literal on a line that opens
# with none of the markers below reads as exempt whether or not it earns the
# exemption. Data is what the exemption is for: `tests/hooks-test.sh` greps flow
# bodies for prose that legitimately keeps its own parenthesized decision
# reference, and its linter fixtures name the decision file each mutation edits. A
# string that is provenance instead — a diagnostic citing a decision as the
# authority for what it asserts — is the same defect as a comment's, and it is held
# by review, the one part of this ban no check here reaches.
#
# Three markers, because the set writes a comment three ways: `#` for the shell,
# PowerShell and awk files, and batch's `REM` and `::` for the two `.bat` entry
# points. `REM` is matched case-folded, the way cmd reads it, and carrying the
# space every batch comment here follows it with — the bare word would pull the
# `rem`-leading lines in the shell files into the scan for their string literals.
# Every marker is asked of every file rather than of its own language, which errs
# toward flagging the way the heredoc case does: a shell line opening `::` is no
# comment, and one carrying a citation shape would be flagged anyway. Measured
# against this tree, no line outside the `.bat` files opens either batch marker
# at all.
#
# One shape a line locator cannot reach is PowerShell's `<# ... #>` block: its
# interior carries no marker the block itself puts there, so a citation on a line
# that does not happen to open with one is out of this rule's sight, and held by
# review beside the provenance-string half of the exemption above.
#
# Four alternations, because this repo writes the reference four ways: the `ADR-`
# prefix and a four-digit id, the `docs/decisions/` path and the same four digits,
# the id bare with nothing but the digits to mark it, and a change ledger's own
# letter-and-digits tag. The two qualified forms hold at any id number; the bare
# form has no qualifier, so it is bounded to the numbering actually issued — a
# leading zero, and a hundreds digit held to the two values every id filed here
# uses — which is that alternation's ceiling and not a claim it makes for itself: a
# numbering that reaches the next hundred has to widen it. That bound is numeric and
# nothing more, so every line the bare form flags that is not a citation carries a
# four-digit run inside the window: which of those runs the delimiters admit is the
# pattern's to say rather than this prose's, and what such a run actually numbers
# — an id, or anything else written four digits wide — is not a question a pattern
# can answer at all. So the rule does not try, and errs toward flagging the way a
# `#`-leading heredoc line does. The concession that stays true without an audit is
# the other side of that: these files are the ones the rule scans, so a run it would
# flag here already reads as this linter's own red, which is what keeps the
# concession from going stale without the bar going red first.
#
# The ledger tag's letter is held to the four this repo's conventions have issued,
# that alternation's own ceiling: a convention that mints a fifth has to join the
# set. Widening it to any capital was measured and rejected — it flags a comment
# naming a markdown heading level, and a two-character span inside a backticked
# character class, both shapes already standing in these files, so it would ban
# innocent prose rather than a citation, and prose is not what is wrong here.
check_executables_carry_no_decision_citations() {
  local citation
  for citation in $(executable_comment_citations); do
    flag "${citation#"$REPO_ROOT"/} cites a decision id in a comment"
  done
}

# `path:line` per hit and none of the line's text, the way the remote-ref rule
# above keeps its own scan down to a line number: the flag names where to look and
# the citation is readable there, while quoting the line would reprint the
# citation into this linter's own output, the one place the ban cannot reach.
executable_comment_citations() {
  { grep -nE '^[[:space:]]*(#|[Rr][Ee][Mm][[:space:]]|::).*(ADR-[0-9][0-9][0-9][0-9]|docs/decisions/[0-9][0-9][0-9][0-9]|[^[:alnum:]+]0[01][0-9][0-9]([^[:alnum:]]|$)|[^[:alnum:]][ABDS][0-9][0-9]*([^[:alnum:]]|$))' \
      "$REPO_ROOT"/bootstrap/*.sh "$REPO_ROOT"/bootstrap/lib/*.sh \
      "$REPO_ROOT"/tools/*.sh "$REPO_ROOT"/plugin/hooks/*.sh \
      "$REPO_ROOT/plugin/bin/oso-state" "$REPO_ROOT/plugin/git-hooks/pre-commit" \
      "$REPO_ROOT"/tests/*.sh "$REPO_ROOT"/tests/fixtures/*.sh \
      "$REPO_ROOT"/bootstrap/*.bat "$REPO_ROOT"/bootstrap/*.ps1 \
      "$REPO_ROOT"/bootstrap/lib/*.awk 2>&1 || true; } \
    | cut -d: -f1,2
}

# How many rules hold this ground is prose in three places — this file's header,
# README's linter row, and the changelog entry for the release still being cut —
# and true in exactly one: the functions above. Nothing tied them together, so a
# rule could land while every surface went on naming the old number, and a reader
# who checked would learn the count is decoration. The first two are read in full:
# they always describe THIS moment, so the table below turns the count into the
# word they spell it as and a count past its end flags instead of guessing. The
# changelog is different — every entry but the top one is a release already
# shipped, and a rule that read those would demand history be rewritten — so only
# its TOP entry is read, and only for the one line shaped like a rule-count claim;
# the moment a later release's own heading lands above it, that entry stops being
# the top one and this rule stops reaching it, freezing it the same way the entry
# itself will. The count includes this rule, which is the only way it can ever be
# right.
check_present_tense_prose_names_the_rule_count() {
  local declared spelled surface named changelog_top changelog_claim
  declared="$({ grep -c '^check_[a-z0-9_]*() {$' "$REPO_ROOT/tests/plugin-lint.sh" 2>&1 || true; })"
  case "$declared" in
    5) spelled=five ;; 6) spelled=six ;; 7) spelled=seven ;; 8) spelled=eight ;;
    9) spelled=nine ;; 10) spelled=ten ;; 11) spelled=eleven ;; 12) spelled=twelve ;;
    13) spelled=thirteen ;; 14) spelled=fourteen ;; 15) spelled=fifteen ;;
    16) spelled=sixteen ;; 17) spelled=seventeen ;; 18) spelled=eighteen ;;
    19) spelled=nineteen ;; 20) spelled=twenty ;; 21) spelled=twenty-one ;;
    22) spelled=twenty-two ;; 23) spelled=twenty-three ;; 24) spelled=twenty-four ;;
    25) spelled=twenty-five ;; 26) spelled=twenty-six ;; 27) spelled=twenty-seven ;;
    28) spelled=twenty-eight ;; 29) spelled=twenty-nine ;; 30) spelled=thirty ;;
    31) spelled=thirty-one ;; 32) spelled=thirty-two ;;
    *) flag "tests/plugin-lint.sh declares $declared rule functions, a count this rule has no word to look for"; return 0 ;;
  esac
  for surface in tests/plugin-lint.sh README.md; do
    named="$({ grep -ci "$spelled rules" "$REPO_ROOT/$surface" 2>&1 || true; })"
    case "$named" in
      ''|0|*[!0-9]*) flag "$surface does not name the $spelled rules this linter declares (grep answered ${named:-empty})" ;;
    esac
  done

  # Same fact, stated a third way in the changelog: a numeral, not the spelled
  # word above (`` `tests/plugin-lint.sh` grows from 13 rules to 20 ``). Scoped
  # to the TOP section alone — everything from the file's first `## ` heading up
  # to, never including, the second — which is exactly the sed idiom's job: hold
  # space remembers whether a `## ` line has already been seen, and quits before
  # printing the second one.
  changelog_top="$(sed -n '/^## /{x;/./{q};x;h};p' "$REPO_ROOT/CHANGELOG.md" 2>&1 || true)"
  changelog_claim="$(printf '%s\n' "$changelog_top" \
    | sed -n 's/.*plugin-lint\.sh.*rules to \([0-9][0-9]*\).*/\1/p')"
  if [ -n "$changelog_claim" ] && [ "$changelog_claim" != "$declared" ]; then
    flag "CHANGELOG.md's top entry says tests/plugin-lint.sh grows to $changelog_claim rules, but this linter declares $declared"
  fi
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
# single-line-bullet style.
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

# The Astro-landing incident traced to one paragraph that asserted Impeccable's
# `init`/`document` split from this file's own memory instead of the installed
# contract, and to nobody recording which version was actually read — the version
# the release's Impeccable pin must reconcile against. Both are now single,
# literal sentences a future rewrite could silently drop; this holds the
# paragraph to naming all five, so losing one fails instead of drifting back to
# the same guess. Same technique as `milestone_bullet_names_its_facts`: find the
# one paragraph by its own bold lead-in, then hold it to every marker.
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

# The amendment lane needs all four of its conditions asserted together, the
# citation especially — a lane that drops the citation is the harness rewriting
# an approved slice on its own word, exactly what the operator objected to
# losing. Same technique as the rule above: one paragraph found by its own bold
# lead-in, held to every marker.
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

# A contract hole once let a paragraph flatly claim "wave 1's WAVE START is the
# CHANGE BASE" without conditioning it on whether a wave 0 ran: a wave 0 that ran
# commits directly to the main checkout (its own per-slice commit, made by the
# orchestrator rather than through step 4's applier/verifier loop), which moves
# HEAD past CHANGE BASE before wave 1 ever cuts a worktree. Round 2 fixed this by
# anchoring on two paragraphs by their own bold lead-in — the Wave 0 bullet
# and the Cut-one-worktree-per-slice paragraph — and missed a third: the
# "Three coordinates" paragraph carried the identical flat claim under a
# lead-in neither anchor matched, so the guard reported clean over a live
# contradiction. A per-paragraph allowlist chases sites one at a time and
# stays exactly as blind to a fourth as it was to the third, so this rule
# instead scans every LINE naming "wave 1" — the one term this file uses
# nowhere except this contract — wherever it lives, and holds each one to
# naming both WAVE START (never the vague "the base ref" phrasing whose
# ambiguity is what opened this hole in the first place) and wave 0 (proving
# the CHANGE BASE claim is conditioned rather than stated flat again). A
# rewrite that drops either marker from any such line, present or future,
# reopens the hole silently, the same way dropping one of the design-foundation
# paragraph's five markers would.
check_wave_1_wave_start_accounts_for_wave_0() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  local sites entry linenum
  if [ ! -f "$body" ]; then
    flag "no plan body at skills/_shared/bodies/plan.md to check wave 1's WAVE START against wave 0"
    return 0
  fi
  sites="$({ grep -inF -- 'wave 1' "$body" || true; })"
  if [ -z "$sites" ]; then
    flag "skills/_shared/bodies/plan.md carries no line naming wave 1 to check its own WAVE START against wave 0"
    return 0
  fi
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    linenum="${entry%%:*}"
    printf '%s\n' "$entry" | grep -qF 'WAVE START' \
      || flag "skills/_shared/bodies/plan.md:$linenum names wave 1 without naming WAVE START — the vague \"the base ref\" phrasing is what let wave 1 branch before wave 0 landed"
    printf '%s\n' "$entry" | grep -qiF 'wave 0' \
      || flag "skills/_shared/bodies/plan.md:$linenum states wave 1's own WAVE START without conditioning it on wave 0"
  done <<< "$sites"
}

# The rubric's own escape hatch cost more than any rule it holds: an `Earned WHY`
# example blessed "an external constraint the code cannot show", and a comment
# citing a frozen ledger decision wears exactly that costume — the decision IS
# external to the code and the code genuinely cannot show it — so 234 of them
# survived one review. The judgment contract compounds it: a rule stated as a
# preference is waved away by "no concrete readability win", so the ban has to
# carry the same carve-out the Hard blockers heading does, in the bullet itself.
# Held to the three strings that make it a class rule rather than a preference,
# never to the paragraph around them, which any rewording would break; and the
# retired label is kept from growing back the way the pin placeholder above is.
check_rubric_bans_inline_comments_without_an_escape_hatch() {
  local rubric="$PLUGIN_ROOT/skills/_shared/rubric.md"
  local bullet marker hit
  if [ ! -f "$rubric" ]; then
    flag "no shared rubric at skills/_shared/rubric.md to check the inline-comment ban"
    return 0
  fi
  bullet="$({ grep -F -- '- Over-documentation.' "$rubric" || true; })"
  if [ -z "$bullet" ]; then
    flag "skills/_shared/rubric.md carries no Over-documentation bullet to state the inline-comment ban"
    return 0
  fi
  for marker in 'debt CLASS' 'no exceptions' 'the judgment contract cannot override this'; do
    printf '%s\n' "$bullet" | grep -qF -- "$marker" \
      || flag "skills/_shared/rubric.md's Over-documentation bullet never states the inline comment as a class: $marker"
  done
  for hit in $({ grep -nF 'Earned WHY' "$rubric" || true; } | cut -d: -f1); do
    flag "skills/_shared/rubric.md:$hit carries the retired Earned WHY escape hatch again"
  done
}

# The rule above holds the rubric; this one holds the agent that has to have read
# it. oso-applier writes every line of code this harness produces, and its
# rubric-reading bullet enumerated the Judgment contract, Hard blockers, File
# level and System level — four of the five sections, dropping the one that bans
# the inline comment, while both judges that grade the result name all five. A
# writer told four sections and graded on five is how 1,441 comments were typed
# before any judge saw one. Both hosts run that writer, so both contracts are
# held to the five section names on the mapping bullet itself, the same way the
# milestone bullets are held to their facts — the bullet is located by the
# opening `Read the whole` both hosts already share, so that opening is pinned,
# the rest of the sentence is each host's own register, and no rewording of it
# may drop a section from the map.
check_applier_rubric_mapping_names_every_section() {
  local agent mapping section
  for agent in "$PLUGIN_ROOT/agents/oso-applier.md" "$REPO_ROOT/codex/agents/oso-applier.toml"; do
    if [ ! -f "$agent" ]; then
      flag "no oso-applier contract at ${agent#"$REPO_ROOT"/} to check its rubric mapping"
      continue
    fi
    mapping="$({ grep -F -- 'Read the whole' "$agent" || true; })"
    if [ -z "$mapping" ]; then
      flag "${agent#"$REPO_ROOT"/} carries no rubric-reading bullet to map the rubric's sections"
      continue
    fi
    for section in 'Judgment contract' 'Hard blockers' 'File level' 'System level' 'Debt markers'; do
      printf '%s\n' "$mapping" | grep -qF -- "$section" \
        || flag "${agent#"$REPO_ROOT"/}'s rubric mapping never names the rubric's $section section"
    done
  done
}

# The two rules above bind the rubric and the writer; this one binds the judge
# that stands between them, and it is the one that ran and saw nothing. oso-verifier
# is the judge each slice passes before its work is committed, and its whole
# rubric mandate was the Hard blockers — a section the inline comment does not
# live in — so a change cut into N slices cleared N gates that structurally could
# not fail one for a comment, and 1,441 of them survived exactly that. Both hosts
# run the verifier, so both contracts carry the mandate and both are held here.
# Located by the class's own name, `inline comment` — the words the rubric's
# Debt markers bullet and both applier contracts already use — over the lines
# naming it taken together, one line in each contract today. Held to the two
# clauses that make it a gate rather than a preference: it FAILS, and it judges
# what the diff ADDED, never a comment the slice inherited. A rewording that drops
# the phrase fails at the locator instead of slipping past it. Markers match
# case-insensitively because the Claude contract capitalizes for emphasis where
# the terser Codex one does not, and the claim is the same in either case.
check_verifier_gate_fails_an_added_inline_comment() {
  local agent mandate marker
  for agent in "$PLUGIN_ROOT/agents/oso-verifier.md" "$REPO_ROOT/codex/agents/oso-verifier.toml"; do
    if [ ! -f "$agent" ]; then
      flag "no oso-verifier contract at ${agent#"$REPO_ROOT"/} to check its inline-comment gate"
      continue
    fi
    mandate="$({ grep -F -- 'inline comment' "$agent" || true; })"
    if [ -z "$mandate" ]; then
      flag "${agent#"$REPO_ROOT"/} never names the inline comment its per-slice gate has to fail"
      continue
    fi
    for marker in 'Fail the slice' 'diff adds'; do
      printf '%s\n' "$mandate" | grep -qiF -- "$marker" \
        || flag "${agent#"$REPO_ROOT"/}'s inline-comment mandate is no gate over what the slice added: $marker"
    done
  done
}

# The rules above bind what a judge may find; this one binds when its LOOP is
# allowed to stop. The debt sweep's judge → fix loop said "until clean" and
# nothing more, so one real close ran seven rounds over three hours in which the
# last three found only the damage the fifth round's own applier had left: an
# uncapped loop with a fallible fixer inside it does not converge, it grinds.
# The two bodies that run that loop — plan.md's §7 close and debug.md's additive
# sweep at §5 — now state a bar, and both are held to it here. quick.md runs no
# sweep and the judge's own body declares verdicts rather than a caller's exit,
# so neither is on this list; a body that grows a sweep loop later has to join
# it, which is this rule's ceiling and not a claim it makes for itself.
# Located by `**Exit bar**`, the bolded label that opens each of them — a
# paragraph in plan, a bullet in debug — one line in each body and no other line
# of either. The literal carries the closing `**`, so the same label worn with a
# qualifier (front-surface's `**Exit bar, read as an ADAPTER**`, a different
# judge's loop) is a different string and the shared vocabulary collides with
# nothing. That one line is the whole bar, this repo's dense single-line style,
# so every marker below is asked of it alone. The markers are the clauses the
# bar collapses without: the BAND that replaced "until clean" — `blocker` and
# `structural` are what must be closed, `nit` is what may stay — the NAMED
# RESIDUAL that keeps a surviving nit from ending with the loop, and the CAP
# with the operator's escape: its number, the closure of the route set, and each
# of the three routes, whose third is spelled per body (§6 as a slice in plan,
# §4 as an apply/verify pass in debug) and is held by the phrase the two
# spellings share. Deleting the paragraph fails at the locator; thinning it
# fails at the marker that went.
#
# The bar's own line is half the ground. The defect is a STATEMENT of the retired
# exit condition, and one outlived the bodies' move in `_shared/front-surface.md`,
# whose PLAN cell gated the design audit on the sweep RETURNING `Debt Sweep:
# clean` — a precondition the band can never produce, so a close ending in a nit
# residual would have skipped that audit in silence. The second half therefore
# reads, line by line, the surfaces that state this loop's outcome: the two
# bodies, that matrix, and `docs/blueprint.md`'s narrative of the same close.
# Under the band `Debt Sweep: clean` is one of TWO outcomes that clear the debt
# axis, so a line naming it with no `Debt Sweep: findings` beside it is naming
# the old bar; that co-occurrence is the whole locator and it is a heuristic, not
# a proof — a restatement worded around the tokens ("once the sweep comes back
# clean") still passes, and the judge's own body, whose verdict list defines one
# token per line, stays off this list for the reason it is off the one above.
# Every line of the four surfaces naming the token today carries `findings`
# beside it, so the rule starts at zero and any hit is new.
check_sweep_exit_bar_is_banded_and_capped() {
  local body bar marker surface hit
  for body in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" "$PLUGIN_ROOT/skills/_shared/bodies/debug.md"; do
    if [ ! -f "$body" ]; then
      flag "no ${body#"$PLUGIN_ROOT"/} to check the debt sweep's exit bar"
      continue
    fi
    bar="$({ grep -F -- '**Exit bar**' "$body" || true; })"
    if [ -z "$bar" ]; then
      flag "${body#"$PLUGIN_ROOT"/} states no **Exit bar** for its debt-sweep judge → fix loop"
      continue
    fi
    for marker in '`blocker`' '`structural`' '`nit`' 'NAMED RESIDUAL' 'HARD CAP three' \
      'exactly three routes' 'accept the residual' 'grant a stated number of further rounds' \
      'the remainder back to §'; do
      printf '%s\n' "$bar" | grep -qF -- "$marker" \
        || flag "${body#"$PLUGIN_ROOT"/}'s exit bar drops the clause that makes it one: $marker"
    done
  done

  for surface in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" "$PLUGIN_ROOT/skills/_shared/bodies/debug.md" \
    "$PLUGIN_ROOT/skills/_shared/front-surface.md" "$REPO_ROOT/docs/blueprint.md"; do
    if [ ! -f "$surface" ]; then
      flag "no ${surface#"$REPO_ROOT"/} to check for a restatement of the retired sweep exit"
      continue
    fi
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      printf '%s\n' "$hit" | grep -qF -- '`Debt Sweep: findings`' \
        || flag "${surface#"$REPO_ROOT"/}:${hit%%:*} reads \`Debt Sweep: clean\` as the whole of the debt axis's pass, the exit the band retired"
    done <<< "$({ grep -nF -- '`Debt Sweep: clean`' "$surface" || true; })"
  done
}

# The rule above binds when the sweep loop STOPS; this one binds what it
# remembers while it runs. The judge is a fresh fork every round, and the
# re-invocation restated two arguments — the base ref and the ledger — and
# nothing at all about the rounds already run, while no rule anywhere forbade
# raising a finding a previous round had settled. One real close paid for that
# twice over: the orchestrator hand-carried a growing "do NOT re-raise" list, 2
# items by round 3 and 14 by round 7, and one dismissed clone group was examined
# three times anyway. The exit bar above made this defect QUIETER rather than
# louder — a blind judge no longer grinds visibly for seven rounds, it spends the
# cap re-arguing what the operator already settled and then hands them the
# choice — and nothing else in the harness reads this contract at all, which is
# why it is the clause held here rather than the cleanup applier's own boundary:
# a cleanup that overreaches writes damage the next round FINDS, expensively but
# visibly.
#
# The contract has two ends, and a rule holding one would pass over a half-landed
# edit: a sender restating dispositions to a judge whose body never mentions them
# is a payload nobody reads, and a judge refusing to re-raise what no sender ever
# hands it is a rule about nothing. So both ends are read, the way the pair of
# decision rules above read a decision file and the index that has to name it. On
# the SENDER side that is the two bodies that run the loop — plan.md's §7 close
# and debug.md's additive sweep, the same pair as the rule above and for the same
# reason, so a third body growing a sweep loop later has to join this list too.
# Each is located by `re-invoke the debt-sweep judge`, the phrase both
# restatements open with: one line in each body today and no other line of
# either, so both markers are asked of that one value — a second re-invocation
# line would join it and the markers could then be met by the pair rather than by
# each, which is this shape's ceiling and not a claim it makes for itself. Two
# markers, one per clause the decision has: that a disposition travels at all,
# and that it travels with no reasoning attached — a rewrite that helpfully
# explains WHY each finding was dismissed hands the fresh eyes the author's case
# and gets an anchored judge back, which is the same trade the bare-ledger rule
# already refuses on the conformance axis.
#
# The RECEIVER is the judge's own body, read as a section rather than a line
# because the input contract is a section there — from its `## Prior rounds`
# heading to the next `## `, so a heading that goes takes the whole rule's
# locator with it and flags. Its markers are the parts a thinning would drop
# first: the three tag values, held here where they are CONSUMED rather than at
# all three ends, since a value the judge does not recognize is a hole wherever
# the senders spell it; the ban and its substitute, which is what makes a tag
# binding rather than advisory — never RAISE it again, name it AS SETTLED
# instead; and the same bare-tags clause the senders carry, stated at the end
# that has to refuse the reasoning if it arrives anyway. Every marker matches
# case-insensitively: plan.md capitalizes DISPOSITION for emphasis where debug.md
# does not, and the claim is identical either way.
check_sweep_loop_remembers_its_dispositioned_findings() {
  local body reinvocation marker judge settled
  for body in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" "$PLUGIN_ROOT/skills/_shared/bodies/debug.md"; do
    if [ ! -f "$body" ]; then
      flag "no ${body#"$PLUGIN_ROOT"/} to check what its sweep re-invocation carries"
      continue
    fi
    reinvocation="$({ grep -iF -- 're-invoke the debt-sweep judge' "$body" || true; })"
    if [ -z "$reinvocation" ]; then
      flag "${body#"$PLUGIN_ROOT"/} re-invokes no debt-sweep judge, so nothing in it can carry the prior rounds' dispositions"
      continue
    fi
    for marker in 'disposition' 'never why'; do
      printf '%s\n' "$reinvocation" | grep -qiF -- "$marker" \
        || flag "${body#"$PLUGIN_ROOT"/}'s sweep re-invocation drops the clause that keeps the next round from re-litigating: $marker"
    done
  done

  judge="$PLUGIN_ROOT/skills/_shared/bodies/debt-sweep.md"
  if [ ! -f "$judge" ]; then
    flag "no skills/_shared/bodies/debt-sweep.md to check what the judge does with a dispositioned finding"
    return 0
  fi
  settled="$({ sed -n '/^## Prior rounds$/,/^## /p' "$judge" 2>&1 || true; })"
  if [ -z "$settled" ]; then
    flag "skills/_shared/bodies/debt-sweep.md states no Prior rounds section, so the dispositions the loop restates reach a judge with no rule for them"
    return 0
  fi
  for marker in '`fixed`' '`operator-dismissed`' '`accepted-residual`' 'never raise' 'as settled' 'never why'; do
    printf '%s\n' "$settled" | grep -qiF -- "$marker" \
      || flag "skills/_shared/bodies/debt-sweep.md's Prior rounds section drops the clause that makes a disposition binding: $marker"
  done
}

# The roadmap mode's whole trade is ONE approval over a queue, and every way that
# trade can be lost is a rewrite of one phase. Drop the planning half and the
# approval authorizes execution only — the chain then stalls at the first child
# that arrived with an intent and no plan of its own, which is the case a queue
# exists to serve. Drop the bound and it covers a queue nobody presented: a child
# added or an intent redrawn after the gate would ride an approval given over
# different work. Drop the per-child scope and it is a per-child gate again, which
# is the mode's opposite. And the clause a host's own rail leans on is the easiest
# of them to lose, because nothing in the neutral flow needs it: a child planned
# unattended still BUILDS and delivers its own plan document, and where a host
# stops at each child that document is what the operator releases — a body implying
# children skip it turns a recorded per-host degradation into a false claim.
#
# So the phase is held to naming all of it: both halves of what the approval
# covers, the whole-queue scope, the re-presentation that bounds it, each child's
# own plan document, and the deferral that leaves a host's extra stop to the
# platform file instead of answering it twice. Located by the phase's own heading,
# read to the next `## ` — a renumbering keeps the anchor and a deleted phase fails
# at it. Two markers are the PLAN mode's existing vocabulary for the same facts,
# which is what keeps this body from growing a second spelling for either. The
# neutral body alone is scanned, and that is this rule's ceiling: where a host's
# rail asks for more than the one approval is the platform file's own answer, so
# holding those files to these markers would flag the very file that states the
# degradation. Within the body it is a marker check like the design-foundation
# paragraph's — a rewording that keeps the claim in other words fails too, which
# errs toward flagging rather than toward missing one.
check_roadmap_umbrella_approval_names_its_bounds() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md"
  local phase marker
  if [ ! -f "$body" ]; then
    flag "no roadmap body at skills/_shared/bodies/roadmap.md to check what its one approval covers"
    return 0
  fi
  phase="$({ sed -n '/^## [0-9][0-9]*\. Approval/,/^## /p' "$body" 2>&1 || true; })"
  if [ -z "$phase" ]; then
    flag "skills/_shared/bodies/roadmap.md carries no numbered Approval phase to check what its one approval covers"
    return 0
  fi
  for marker in 'planning every child' 'executing every child' 'every child' 'fresh approval' 'plan document' 'platform file'; do
    printf '%s\n' "$phase" | grep -qiF -- "$marker" \
      || flag "skills/_shared/bodies/roadmap.md's Approval phase drops a clause that bounds its one approval: $marker"
  done
}

# The same body's autonomy policy is the operator's absence priced: every question
# a child would have asked them arrives with nobody there, and what that phase
# declares is the whole of what may answer one. Each clause fails its own way when
# it goes missing, which is why they are held one at a time rather than by the
# phase merely existing. Lose a tier and the ladder still reads like a ladder while
# the case that tier covered resolves by whatever an agent finds most plausible —
# the improvisation a declared policy exists to forbid. Lose the delegated record
# and the decision is taken with no trace, so the child's own freeze has nothing to
# reconcile it against and the one approval covers an answer nobody can find. Lose
# the bar and the confidence that picks a library name picks a destructive
# migration, where being wrong costs a restore instead of an edit. Lose one item of
# the never-solo list — the deletion item first, since it reads like plumbing
# rather than a decision — and a policy naming three of the four reads like the
# closed list it has stopped being. Lose the inherited entry or the reconciliation
# and the global ledger either stops answering a child's question or starts
# answering it over the child's own contrary evidence, which is the outcome the
# queue exists to prevent.
#
# Located by the phase's own heading and read to the next `## `, the approval rule's
# own locator and for its reason. Three markers are vocabulary the flows already
# carry — the delegated mark, the inherited entry, the reconciliation — which is
# what keeps this body from growing a second spelling for any of them. The neutral
# body alone is scanned, this rule's ceiling as much as the approval rule's: what a
# host adds around the same policy is its platform file's, so holding those files
# to these markers would flag the file that records the difference.
check_roadmap_autonomy_policy_declares_its_ladder_and_its_bar() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md"
  local phase marker
  if [ ! -f "$body" ]; then
    flag "no roadmap body at skills/_shared/bodies/roadmap.md to check what its autonomy policy may decide"
    return 0
  fi
  phase="$({ sed -n '/^## [0-9][0-9]*\. The autonomy policy/,/^## /p' "$body" 2>&1 || true; })"
  if [ -z "$phase" ]; then
    flag "skills/_shared/bodies/roadmap.md carries no numbered autonomy-policy phase to check what its policy may decide"
    return 0
  fi
  for marker in "the flow's own recommendation" 'standard practice' 'simplest for the operator' \
      'recorded as delegated' 'irreversibility bar' 'never-solo' 'never a push' \
      'ledger amendment' 'security residual' 'forced deletion' 'inherited' 'reconciliation'; do
    printf '%s\n' "$phase" | grep -qiF -- "$marker" \
      || flag "skills/_shared/bodies/roadmap.md's autonomy-policy phase drops a clause its policy turns on: $marker"
  done
}

# Two texts in this harness tell the flow to hand a decision to the operator and
# to do nothing else with it, and a roadmap is the one execution where nobody is
# there to take one — so both carry a condition naming that case, and how tightly
# that condition is written is the difference between the mode being safe and
# being a licence. Written tight it reaches only a queue the operator approved a
# policy over before leaving. Lose the absolute half and every change in every
# repository has its decisions taken for it, which is the behaviour this harness
# exists to refuse; keep the absolute half but lose the BOUND and the exception
# reads as a policy answering everything, the destructive migration and the four
# things that policy may never take at all included. Neither loss shows up as a
# broken flow: both read as fluent prose and change only what an agent does with a
# decision it should never have taken.
#
# So each text is held to three clauses on its own line — the absolute instruction
# in its own words, the roadmap that conditions it, and the QUEUED outcome that
# bounds what the condition buys. One line each carries the locator and no other
# line of either file does, so all three markers are asked of that one value. The
# two marker sets differ because the two texts state the absolute differently —
# the flow body forbids answering for the user, the output style says the human
# decides — and holding each to its own words is what stops a rewrite satisfying
# this rule by quoting the other file. Its ceiling: each host's always-loaded
# routing file carries the same instruction as one of the OPERATOR's own global
# rules rather than as a step of this flow, so neither is on this list, and a
# rewording that keeps a clause in other words ("queues" for "queued") fails here
# too, which errs toward flagging rather than toward missing one.
check_roadmap_condition_never_loosens_the_operator_rule() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  local style="$PLUGIN_ROOT/output-styles/oso.md"
  local route persona marker
  if [ ! -f "$body" ]; then
    flag "no plan body at skills/_shared/bodies/plan.md to check what its applier-blocked route grants a roadmap"
  else
    route="$({ grep -F -- 'If it returns `blocked`:' "$body" 2>&1 || true; })"
    if [ -z "$route" ]; then
      flag "skills/_shared/bodies/plan.md states no applier-blocked route, the one text where a roadmap's policy answers a slice's own question"
    else
      for marker in "never answer on the user's behalf" 'roadmap' 'queued'; do
        printf '%s\n' "$route" | grep -qiF -- "$marker" \
          || flag "skills/_shared/bodies/plan.md's applier-blocked route drops the clause that keeps a roadmap a bounded exception: $marker"
      done
    fi
  fi
  if [ ! -f "$style" ]; then
    flag "no output-styles/oso.md to check what its decision rule grants a roadmap"
    return 0
  fi
  persona="$({ grep -F -- 'When a real decision exists' "$style" 2>&1 || true; })"
  if [ -z "$persona" ]; then
    flag "output-styles/oso.md states no decision rule, the one text that tells every reply who decides"
    return 0
  fi
  for marker in 'the human decides' 'roadmap' 'queued'; do
    printf '%s\n' "$persona" | grep -qiF -- "$marker" \
      || flag "output-styles/oso.md's decision rule drops the clause that keeps a roadmap a bounded exception: $marker"
  done
}

# The same body's chain phase is the only section written for an execution nobody
# watches, and four of its clauses are the whole of why an unwatched one can be
# trusted. The first two are the bar it reads before it arms a child: ONE tree
# crosses to the next child, and a child set aside mid-slice leaves uncommitted
# edits in it while one set aside on a merge conflict leaves markers — arm over
# either and the next child commits work it never wrote and is judged on it, an
# attribution nothing downstream can tell from a real one. One set aside mid-WAVE
# dirties that tree nowhere, so its worktrees are what the WORKTREE ROOT is read
# as a SECOND place for, and what the next child's first cut collides with. Lose
# either probe and an arming carries one; lose the refusal and the bar is advice.
#
# The third is the key that makes a chain recoverable at all, and the fourth is
# that no gate reads it: the flow arms the key, a SessionEnd sweep drops it, and a
# SessionStart signal turns it into the resume command a dead run's next session
# gets — durable state whose orphan may deny nothing, which is the one property
# that lets it be durable. That contract is spelled in three files and nothing but
# this rule holds the spelling together: rename the key in the body and every test
# still passes while recovery never fires again, since each side stays internally
# consistent. So the body is held to the write, to the `none` that disarms it and
# to the gate it arms nowhere, and both hooks to reading that exact key through the
# shared state reader — the closing paren is part of the marker, or a hook renaming
# the key to `roadmap_slug` would satisfy a check looking for a prefix of its own
# new name. The spelling is this rule's ceiling: whether the hooks then behave is
# tests/hooks-test.sh's, where the sweep's reach and the signal's silence are
# proved case by case.
check_roadmap_chain_declares_its_tree_bar_and_its_state_key() {
  local body="$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md"
  local phase hook marker
  if [ ! -f "$body" ]; then
    flag "no roadmap body at skills/_shared/bodies/roadmap.md to check what its chain hands the next child"
    return 0
  fi
  phase="$({ sed -n '/^## [0-9][0-9]*\. The chain/,/^## /p' "$body" 2>&1 || true; })"
  if [ -z "$phase" ]; then
    flag "skills/_shared/bodies/roadmap.md carries no numbered chain phase to check what it hands the next child"
    return 0
  fi
  for marker in 'status --porcelain' 'a SECOND place: the WORKTREE ROOT' \
      'arms nothing further' 'arms no gate' 'roadmap={roadmap}' 'roadmap=none'; do
    printf '%s\n' "$phase" | grep -qiF -- "$marker" \
      || flag "skills/_shared/bodies/roadmap.md's chain phase drops a clause its unattended arming turns on: $marker"
  done
  for hook in plugin/hooks/warn-stale-state.sh plugin/hooks/cleanup-state.sh; do
    if [ ! -f "$REPO_ROOT/$hook" ]; then
      flag "no $hook to check that it reads the roadmap key that body's chain phase arms"
    elif ! grep -qF -- 'state_value "$state_file" roadmap)' "$REPO_ROOT/$hook"; then
      flag "$hook never reads the roadmap key the roadmap body's chain phase arms and disarms"
    fi
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
check_blueprint_index_names_every_decision
check_cited_decisions_resolve_to_a_file
check_executables_carry_no_decision_citations
check_present_tense_prose_names_the_rule_count
check_hook_renders_and_published_hashes_match
check_milestone_reporting_contract_is_complete
check_reporting_host_difference_is_single_sourced
check_design_foundation_slice_reads_the_installed_contract
check_third_amendment_lane_names_its_conditions
check_wave_1_wave_start_accounts_for_wave_0
check_rubric_bans_inline_comments_without_an_escape_hatch
check_applier_rubric_mapping_names_every_section
check_verifier_gate_fails_an_added_inline_comment
check_sweep_exit_bar_is_banded_and_capped
check_sweep_loop_remembers_its_dispositioned_findings
check_roadmap_umbrella_approval_names_its_bounds
check_roadmap_autonomy_policy_declares_its_ladder_and_its_bar
check_roadmap_condition_never_loosens_the_operator_rule
check_roadmap_chain_declares_its_tree_bar_and_its_state_key

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean"
