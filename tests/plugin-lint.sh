#!/usr/bin/env bash
# Thirty-six rules over what the plugin's declarations, prose and delegation
# payloads SAY, which `claude plugin validate --strict` never reads.
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/../plugin" && pwd)}"
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

check_impeccable_pin_is_never_a_placeholder() {
  local hit
  for hit in $({ grep -rnF 'impeccable@X' \
      "$REPO_ROOT/plugin" "$REPO_ROOT/docs" "$REPO_ROOT/CHANGELOG.md" 2>&1 || true; } | cut -d: -f1,2); do
    flag "${hit#"$REPO_ROOT"/} carries the unresolvable pin placeholder impeccable@X"
  done
}

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
          claude) grep -qE "oso-code:$emitter([^A-Za-z0-9_-]|\$)" $caller_sources || continue ;;
          codex) grep -qF "\`oso-code:$emitter\`" $caller_sources || continue ;;
        esac
        axis_coverage_is_routed "${caller#"$PLUGIN_ROOT"/} invokes $emitter on $host" \
          "$(verdict_axes_from_sources $(skill_sources "$skill" "$host"))" $caller_sources
      done
    done
  done

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
        continue
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

token_is_routed() {
  local token="$1"; shift
  [ "$#" -gt 0 ] || return 1
  { grep -Fh -- "$token" "$@" || true; } | grep -qEi "$ROUTE_WORDS_RE"
}

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

decision_citations() {
  { grep -rEo 'ADR-[0-9][0-9][0-9][0-9]' "$REPO_ROOT/plugin" 2>&1 || true; } | LC_ALL=C sort -u
}

check_executables_carry_no_decision_citations() {
  local citation
  for citation in $(executable_comment_citations); do
    flag "${citation#"$REPO_ROOT"/} cites a decision id in a comment"
  done
}

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
    33) spelled=thirty-three ;; 34) spelled=thirty-four ;;
    35) spelled=thirty-five ;; 36) spelled=thirty-six ;;
    *) flag "tests/plugin-lint.sh declares $declared rule functions, a count this rule has no word to look for"; return 0 ;;
  esac
  for surface in tests/plugin-lint.sh README.md; do
    named="$({ grep -ci "$spelled rules" "$REPO_ROOT/$surface" 2>&1 || true; })"
    case "$named" in
      ''|0|*[!0-9]*) flag "$surface does not name the $spelled rules this linter declares (grep answered ${named:-empty})" ;;
    esac
  done

  changelog_top="$(sed -n '/^## /{x;/./{q};x;h};p' "$REPO_ROOT/CHANGELOG.md" 2>&1 || true)"
  changelog_claim="$(printf '%s\n' "$changelog_top" \
    | sed -n 's/.*plugin-lint\.sh.*rules to \([0-9][0-9]*\).*/\1/p')"
  if [ -n "$changelog_claim" ] && [ "$changelog_claim" != "$declared" ]; then
    flag "CHANGELOG.md's top entry says tests/plugin-lint.sh grows to $changelog_claim rules, but this linter declares $declared"
  fi
}

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
  milestone_bullet_names_its_facts "$contract" "A child's disposition" \
    "closed" "set aside" "next" "session stream"

  grep -qE '[Aa]t most [0-9]+ lines?' "$contract" \
    || flag "skills/_shared/reporting.md names no length bound on a milestone report"
  grep -qF -- "A roadmap's final report" "$contract" \
    || flag "skills/_shared/reporting.md states no exception to that bound for a roadmap's final report, so a whole unwatched run reaches its operator in three lines"

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

check_roadmap_umbrella_approval_names_its_bounds() {
  roadmap_phase_names_its_clauses Approval 'Approval phase' \
    'a clause that bounds its one approval' \
    'planning every child' 'executing every child' 'every child' 'fresh approval' \
    'plan document' 'platform file'
}

roadmap_phase_names_its_clauses() {
  local heading="$1" flagged_as="$2" dropped="$3"
  local body="$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md" phase marker
  shift 3
  if [ ! -f "$body" ]; then
    flag "no roadmap body at skills/_shared/bodies/roadmap.md to check its $flagged_as"
    return 0
  fi
  phase="$({ sed -n "/^## [0-9][0-9]*\. $heading/,/^## /p" "$body" 2>&1 || true; })"
  if [ -z "$phase" ]; then
    flag "skills/_shared/bodies/roadmap.md carries no numbered $flagged_as"
    return 0
  fi
  for marker in "$@"; do
    printf '%s\n' "$phase" | grep -qiF -- "$marker" \
      || flag "skills/_shared/bodies/roadmap.md's $flagged_as drops $dropped: $marker"
  done
}

check_roadmap_autonomy_policy_declares_its_ladder_and_its_bar() {
  roadmap_phase_names_its_clauses 'The autonomy policy' 'autonomy-policy phase' \
    'a clause its policy turns on' \
    "the flow's own recommendation" 'standard practice' 'simplest for the operator' \
    'recorded as delegated' 'irreversibility bar' 'never-solo' 'never a push' \
    'ledger amendment' 'security residual' 'forced deletion' 'inherited' 'reconciliation'
}

check_roadmap_condition_never_loosens_the_operator_rule() {
  roadmap_exception_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" \
    'If it returns `blocked`:' 'applier-blocked route' \
    "never answer on the user's behalf" 'roadmap' 'queued'
  roadmap_exception_stays_bounded_in "$PLUGIN_ROOT/output-styles/oso.md" \
    'When a real decision exists' 'decision rule' \
    'the human decides' 'roadmap' 'queued'
}

roadmap_exception_stays_bounded_in() {
  local file="$1" anchor="$2" flagged_as="$3" text marker
  shift 3
  if [ ! -f "$file" ]; then
    flag "no ${file#"$PLUGIN_ROOT"/} to check what its $flagged_as grants a roadmap"
    return 0
  fi
  text="$({ grep -F -- "$anchor" "$file" 2>&1 || true; })"
  if [ -z "$text" ]; then
    flag "${file#"$PLUGIN_ROOT"/} states no $flagged_as, the one text whose absolute a roadmap may never loosen"
    return 0
  fi
  for marker in "$@"; do
    printf '%s\n' "$text" | grep -qiF -- "$marker" \
      || flag "${file#"$PLUGIN_ROOT"/}'s $flagged_as drops the clause that keeps a roadmap a bounded exception: $marker"
  done
}

check_roadmap_chain_declares_its_tree_bar_and_its_state_key() {
  local hook
  roadmap_phase_names_its_clauses 'The chain' 'chain phase' \
    'a clause its unattended arming turns on' \
    'status --porcelain' 'a SECOND place: the WORKTREE ROOT' \
    'arms nothing further' 'arms no gate' 'roadmap={roadmap}' 'roadmap=none'
  for hook in plugin/hooks/warn-stale-state.sh plugin/hooks/cleanup-state.sh; do
    if [ ! -f "$REPO_ROOT/$hook" ]; then
      flag "no $hook to check that it reads the roadmap key that body's chain phase arms"
    elif ! grep -qF -- 'state_value "$state_file" roadmap)' "$REPO_ROOT/$hook"; then
      flag "$hook never reads the roadmap key the roadmap body's chain phase arms and disarms"
    fi
  done
}

check_roadmap_presence_phase_declares_its_order_and_its_three_pushes() {
  roadmap_phase_names_its_clauses 'The presence phase' 'presence phase' \
    "a clause the operator's one return turns on" \
    'non-code pendings' 'standing worktree' \
    'as ONE item with the decision that set it aside' \
    'Prioritized means ORDERED' 'break every tie by' \
    'decided for them' 'deferred, and why' 'awaited their hand' \
    'roadmap is COMPLETE' 'queue is READY' 'chain is BLOCKED' \
    'A per-child CLOSE is none of the three' 'That is what ends a roadmap'
}

check_fail_routes_forward_findings_verbatim_and_never_overrule_them() {
  local plan="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  roadmap_exception_stays_bounded_in "$plan" 'On `fail`: relaunch the applier' \
    'sequential fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away' 'ESCALATE' 'doubt-pass reconciliation' 'travel BARE'
  roadmap_exception_stays_bounded_in "$plan" '**A red slice**' 'red-slice fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away'
  roadmap_exception_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/debug.md" \
    'Verifier `fail` → relaunch the applier' 'verifier fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away'
  roadmap_exception_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/front-surface.md" \
    '**Fix route**' 'design-audit fix route' \
    'findings VERBATIM' 'never your summary of them'
}

check_verifier_payload_is_closed_and_its_comment_gate_scans() {
  local agent payload gate marker
  for agent in "$PLUGIN_ROOT/agents/oso-verifier.md" "$REPO_ROOT/codex/agents/oso-verifier.toml"; do
    if [ ! -f "$agent" ]; then
      flag "no oso-verifier contract at ${agent#"$REPO_ROOT"/} to check its payload list and its comment-gate scan"
      continue
    fi
    payload="$({ grep -iF -- 'CLOSED list' "$agent" || true; })"
    if [ -z "$payload" ]; then
      flag "${agent#"$REPO_ROOT"/} leaves its payload fields an open list, the shape a standing ruling arrives through"
    else
      for marker in 'standing ruling' 'softens a gate' 'blocked' 'APPLIER input' 'the rubric alone'; do
        printf '%s\n' "$payload" | grep -qiF -- "$marker" \
          || flag "${agent#"$REPO_ROOT"/}'s payload list names itself closed and then leaves the door it closes open: $marker"
      done
    fi
    gate="$({ grep -iF -- 'inline comment' "$agent" || true; })"
    if [ -z "$gate" ]; then
      flag "${agent#"$REPO_ROOT"/} names no inline-comment gate for a scan of the diff to feed"
      continue
    fi
    for marker in 'RUN a scan' 'command and output' 'evidence' 'never scanned'; do
      printf '%s\n' "$gate" | grep -qiF -- "$marker" \
        || flag "${agent#"$REPO_ROOT"/}'s inline-comment gate rests on judgment with no scan of the diff behind it: $marker"
    done
  done
}

check_no_exception_rules_outrank_repo_convention() {
  local rubric="$PLUGIN_ROOT/skills/_shared/rubric.md"
  local plan="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  local precedence audit marker
  if [ ! -f "$rubric" ]; then
    flag "no shared rubric at skills/_shared/rubric.md to check what its no-exception rules outrank"
  else
    precedence="$({ grep -F -- 'outrank the conventions of the repo under judgment' "$rubric" || true; })"
    if [ -z "$precedence" ]; then
      flag "skills/_shared/rubric.md ranks its no-exception rules against nothing, so a target repo's convention is free to outrank them"
    else
      for marker in 'three Hard blockers' 'inline-comment debt class' 'does not soften it' 'QUESTION for the operator'; do
        printf '%s\n' "$precedence" | grep -qF -- "$marker" \
          || flag "skills/_shared/rubric.md's precedence rule leaves a conflicting convention somewhere to win: $marker"
      done
    fi
  fi

  if [ ! -f "$plan" ]; then
    flag "no plan body at skills/_shared/bodies/plan.md to check its surface map against the no-exception rules"
    return 0
  fi
  audit="$({ grep -F -- 'Audit the map a second time' "$plan" || true; })"
  if [ -z "$audit" ]; then
    flag "skills/_shared/bodies/plan.md never reads its surface map against those four rules, so a conflicting convention reaches execution unasked"
  else
    for marker in 'battery QUESTION' 'Decision rounds' 'recorded in the ledger' 'project convention'; do
      printf '%s\n' "$audit" | grep -qF -- "$marker" \
        || flag "skills/_shared/bodies/plan.md's no-exception audit stops short of routing the conflict to the operator: $marker"
    done
  fi

  roadmap_exception_stays_bounded_in "$plan" 'It leaves exactly two routes' 'ESCALATE route' \
    'canonical case' 'legacy-convention conflict' 'the banned thing everywhere' 'only they may take'
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
check_roadmap_presence_phase_declares_its_order_and_its_three_pushes
check_fail_routes_forward_findings_verbatim_and_never_overrule_them
check_verifier_payload_is_closed_and_its_comment_gate_scans
check_no_exception_rules_outrank_repo_convention

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean"
