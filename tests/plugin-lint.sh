#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/../plugin" && pwd)}"
REPO_ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"

. "$(cd "$(dirname "$0")/../plugin/hooks" && pwd)/lexer.sh"

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
  local skill="$1" host="${2:-all}" wrapper reference source
  if [ "$host" = all ]; then
    { skill_sources "$skill" claude; skill_sources "$skill" codex; skill_sources "$skill" opencode; } | LC_ALL=C sort -u
    return 0
  fi
  wrapper="$(host_wrapper "$skill" "$host")" \
    || { flag "skill_sources was asked for unknown host $host"; return 0; }
  [ -f "$wrapper" ] || return 0
  printf '%s\n' "$wrapper"
  for reference in $({ grep -ohE '_shared/(bodies|platform/(claude|codex|opencode))/[a-z-]+\.md' "$wrapper" || true; } \
      | LC_ALL=C sort -u); do
    source="$PLUGIN_ROOT/skills/$reference"
    if [ -f "$source" ]; then printf '%s\n' "$source"; fi
  done
}

host_wrapper() {
  local skill="$1" host="$2" name
  name="$(basename "$(dirname "$skill")")"
  case "$host" in
    claude) printf '%s\n' "$skill" ;;
    codex) printf '%s\n' "$REPO_ROOT/codex/skills/$name/SKILL.md" ;;
    opencode) printf '%s\n' "$REPO_ROOT/opencode/skills/oso-$name/SKILL.md" ;;
    *) return 1 ;;
  esac
}

check_forked_skills_declare_background() {
  local skill frontmatter_text
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    frontmatter_text="$(frontmatter "$skill")"
    grep -qE '^context:[[:space:]]*fork[[:space:]]*$' <<< "$frontmatter_text" || continue
    grep -qE '^background:[[:space:]]*(true|false)[[:space:]]*$' <<< "$frontmatter_text" \
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
    grep -qE '^context:[[:space:]]*fork[[:space:]]*$' <<< "$frontmatter_text" || continue
    for host in claude codex opencode; do
      sources="$(skill_sources "$skill" "$host" | tr '\n' ' ')"
      [ -n "$sources" ] && grep -qi 'end with exactly one of:' $sources \
        || flag "${skill#"$PLUGIN_ROOT"/} declares context: fork without an 'end with exactly one of:' verdict block on $host"
    done
  done
}

check_security_pass_acquires_without_a_remote() {
  local skill="$PLUGIN_ROOT/skills/security-pass/SKILL.md"
  local source line
  [ -f "$skill" ] \
    || { flag "no skills/security-pass/SKILL.md to check for a remote-qualified acquisition"; return 0; }
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
    for host in claude codex opencode; do
      for caller in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
        [ -f "$caller" ] || continue
        caller_sources="$(skill_sources "$caller" "$host" | tr '\n' ' ')"
        [ -n "$caller_sources" ] || continue
        case "$host" in
          claude) grep -qE "oso-code:$emitter([^A-Za-z0-9_-]|\$)" $caller_sources || continue ;;
          codex) grep -qF "\`oso-code:$emitter\`" $caller_sources || continue ;;
          opencode) grep -qF "\`oso-$emitter\`" $caller_sources || continue ;;
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
    for host in claude codex opencode; do
      for caller in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
        [ -f "$caller" ] || continue
        caller_sources="$(skill_sources "$caller" "$host" | tr '\n' ' ')"
        [ -n "$caller_sources" ] || continue
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
  local host routing_file skills_root workflow_count workflow_block mode invocation
  for host in claude codex opencode; do
    case "$host" in
      claude) routing_file="$REPO_ROOT/bootstrap/claude-global.md" ;;
      codex) routing_file="$REPO_ROOT/bootstrap/codex-global.md" ;;
      opencode) routing_file="$REPO_ROOT/bootstrap/opencode-global.md" ;;
    esac
    skills_root="$(host_skills_root "$host")"

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

    for mode in $(operator_only_modes "$host"); do
      case "$host" in
        claude) invocation="/oso-code:$mode" ;;
        codex) invocation="\$oso-code:$mode" ;;
        opencode) invocation="/oso-$mode" ;;
      esac
      grep -qF "\`$invocation\`" <<< "$workflow_block" \
        || flag "${routing_file#"$REPO_ROOT"/} omits $invocation from its Workflow routing"
    done
  done
}

host_skills_root() {
  case "$1" in
    claude) printf '%s\n' "$PLUGIN_ROOT/skills" ;;
    codex) printf '%s\n' "$REPO_ROOT/codex/skills" ;;
    opencode) printf '%s\n' "$REPO_ROOT/opencode/skills" ;;
  esac
}

operator_only_modes() {
  local host="$1" skills_root wrapper directory
  skills_root="$(host_skills_root "$host")"
  [ -d "$skills_root" ] || return 0
  for wrapper in "$skills_root"/*/SKILL.md; do
    [ -f "$wrapper" ] || continue
    printf '%s\n' "$(frontmatter "$wrapper")" \
      | grep -qE '^disable-model-invocation:[[:space:]]*true[[:space:]]*$' || continue
    directory="$(basename "$(dirname "$wrapper")")"
    case "$host" in
      opencode) printf '%s\n' "${directory#oso-}" ;;
      *) printf '%s\n' "$directory" ;;
    esac
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
          grep -qF "$marker" <<< "$launch" \
            || flag "${source#"$PLUGIN_ROOT"/}:$line launches oso-verifier without naming $marker in its payload"
        done
        grep -qE 'ledger|diagnosis' <<< "$launch" \
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
        grep -qF "$marker" <<< "$launch" \
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
      grep -qE 'debt cleanup|judge findings' <<< "$launch" && continue
      grep -qE 'SLICE START|WAVE START' <<< "$launch" \
        || flag "${source#"$PLUGIN_ROOT"/}:$line launches an applier or verifier naming neither SLICE START nor WAVE START"
    done
  done
  return 0
}

check_integrator_report_names_next_wave_start() {
  local file
  for file in "$PLUGIN_ROOT/agents/oso-integrator.md" "$REPO_ROOT/codex/agents/oso-integrator.toml" "$REPO_ROOT/opencode/agents/oso-integrator.md"; do
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
    grep -qF 'WAVE START' <<< "$question" \
      || flag "skills/_shared/bodies/triage.md's one question never names WAVE START"
  fi
  { grep -F 'WAVE START' "$file" || true; } | grep -qF 'CHANGE BASE' \
    || flag "skills/_shared/bodies/triage.md names WAVE START but never disambiguates it from CHANGE BASE on the same line"
  preexisting="$({ grep -F -- '`Triage: pre-existing`' "$file" || true; })"
  if [ -z "$preexisting" ]; then
    flag "skills/_shared/bodies/triage.md carries no Triage: pre-existing verdict line to check"
  else
    grep -qF 'WAVE START' <<< "$preexisting" \
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
  { grep -rEo 'ADR-[0-9][0-9][0-9][0-9]' \
      "$REPO_ROOT/plugin" "$REPO_ROOT/codex" "$REPO_ROOT/opencode/agents" \
      "$REPO_ROOT/opencode/commands" "$REPO_ROOT/opencode/skills" 2>&1 || true; } | LC_ALL=C sort -u
}

DECISION_ID_RE='ADR-[0-9][0-9][0-9][0-9]|docs/decisions/[0-9][0-9][0-9][0-9]|[^[:alnum:]+]0[01][0-9][0-9]([^[:alnum:]]|$)|[^[:alnum:]][ABDS][0-9][0-9]*([^[:alnum:]]|$)'

check_executables_carry_no_decision_citations() {
  local citation
  for citation in $(shell_comment_citations) $(typescript_comment_citations); do
    flag "${citation#"$REPO_ROOT"/} cites a decision id in a comment"
  done
}

shell_comment_citations() {
  { grep -nE "^[[:space:]]*(#|[Rr][Ee][Mm][[:space:]]|::).*($DECISION_ID_RE)" \
      "$REPO_ROOT"/bootstrap/*.sh "$REPO_ROOT"/bootstrap/lib/*.sh \
      "$REPO_ROOT"/tools/*.sh "$REPO_ROOT"/plugin/hooks/*.sh \
      "$REPO_ROOT/plugin/bin/oso-state" "$REPO_ROOT/plugin/git-hooks/pre-commit" \
      "$REPO_ROOT"/tests/*.sh "$REPO_ROOT"/tests/fixtures/*.sh \
      "$REPO_ROOT"/bootstrap/*.bat "$REPO_ROOT"/bootstrap/*.ps1 \
      "$REPO_ROOT"/bootstrap/lib/*.awk 2>&1 || true; } \
    | cut -d: -f1,2
}

typescript_comment_citations() {
  { grep -nE "(//|^[[:space:]]*\*).*($DECISION_ID_RE)" \
      "$REPO_ROOT"/opencode/plugin/*.ts "$REPO_ROOT"/opencode/plugin/oso/*.ts \
      "$REPO_ROOT"/opencode/hooks/*.ts 2>&1 || true; } \
    | cut -d: -f1,2
}

check_no_verification_script_invokes_opencode_directly() {
  local site
  collect_opencode_scan_sources
  if [ "${#OPENCODE_SCAN_SOURCES[@]}" -eq 0 ]; then
    flag "tests/plugin-lint.sh reached no readable shell source under tests/, bootstrap/ or tools/, so this rule reports zero opencode invocations having scanned nothing"
    return 0
  fi
  for site in $(direct_opencode_invocations); do
    flag "${site#"$REPO_ROOT"/} makes the opencode binary its own command word instead of an argument to a runner that pins HOME, TMPDIR and every XDG directory, so a machine exporting XDG_DATA_HOME has the operator's own OpenCode data reached by a verification run"
  done
}

OPENCODE_SCAN_SOURCES=()

collect_opencode_scan_sources() {
  local candidate
  OPENCODE_SCAN_SOURCES=()
  for candidate in "$REPO_ROOT"/tests/*.sh "$REPO_ROOT"/tests/fixtures/*.sh \
    "$REPO_ROOT"/bootstrap/lib/*.sh "$REPO_ROOT"/bootstrap/verify-*.sh \
    "$REPO_ROOT"/tools/*.sh; do
    if [ -r "$candidate" ]; then
      OPENCODE_SCAN_SOURCES+=("$candidate")
    fi
  done
}

direct_opencode_invocations() {
  local location body_lines logical line taken
  while IFS=$'\t' read -r location body_lines; do
    logical=""
    taken=0
    while [ "$taken" -lt "$body_lines" ] && IFS= read -r line; do
      logical="$logical$line"$'\n'
      taken=$((taken + 1))
    done
    printf '@%s\n' "$location"
    shell_commands "$logical"
  done < <(shell_lines_naming_opencode) | opencode_invocation_sites
}

HEREDOC_BODY_TRACKING_AWK='
    function outside_quotes(text,   kept, char, at, opened, delimits_a_heredoc) {
      kept = ""
      opened = ""
      for (at = 1; at <= length(text); at++) {
        char = substr(text, at, 1)
        if (opened != "") {
          if (delimits_a_heredoc) kept = kept char
          if (char == opened) opened = ""
          continue
        }
        if (char == quote || char == "\"") {
          opened = char
          delimits_a_heredoc = (kept ~ /<<-?[ \t]*$/)
          if (delimits_a_heredoc) kept = kept char
          continue
        }
        kept = kept char
      }
      return kept
    }
    function queue_heredoc_bodies(text,   opener, delimiter) {
      if (index(text, "<<") == 0) return
      text = outside_quotes(text)
      while (match(text, "<<-?[ \t]*([\"][^\"]*[\"]|" quote "[^" quote "]*" quote "|[A-Za-z_][A-Za-z0-9_]*)")) {
        opener = substr(text, RSTART, RLENGTH)
        if (RSTART > 1 && substr(text, RSTART - 1, 1) == "<") {
          text = substr(text, RSTART + 2)
          continue
        }
        text = substr(text, RSTART + RLENGTH)
        delimiter = opener
        sub("^<<-?[ \t]*", "", delimiter)
        gsub("[\"" quote "]", "", delimiter)
        queued++
        body_delimiter[queued] = delimiter
        body_strips_tabs[queued] = (substr(opener, 3, 1) == "-")
      }
    }
'

shell_lines_naming_opencode() {
  awk -v quote="'" -v unlexable_beyond="$LEX_MAX_INPUT_BYTES" "$HEREDOC_BODY_TRACKING_AWK"'
    function emit(   parts, count, nth) {
      if (tolower(logical) ~ /opencode/) {
        count = split(logical, parts, "\n")
        print origin ":" start "\t" count
        for (nth = 1; nth <= count; nth++) print parts[nth]
      }
      logical = ""; start = 0
    }
    FNR == 1 { if (start > 0) emit(); queued = 0; closed = 0 }
    queued > closed {
      if (length(logical) <= unlexable_beyond) logical = logical "\n" $0
      terminator = $0
      if (body_strips_tabs[closed + 1]) sub(/^\t+/, "", terminator)
      if (terminator == body_delimiter[closed + 1]) closed++
      if (queued == closed) emit()
      next
    }
    { if (start == 0) { start = FNR; origin = FILENAME } logical = logical $0 }
    /\\[[:space:]]*$/ { sub(/\\[[:space:]]*$/, "", logical); next }
    {
      queue_heredoc_bodies(logical)
      if (queued == closed) emit()
    }
    END { if (start > 0) emit() }
  ' "${OPENCODE_SCAN_SOURCES[@]}"
}

opencode_invocation_sites() {
  local record location="" invoked=no names_the_binary=no substituted=no word
  while IFS= read -r record; do
    case "$record" in
      '@'*)
        report_opencode_invocation "$location" "$invoked"
        location="${record#@}"
        invoked=no; names_the_binary=no; substituted=no
        ;;
      '>'*)
        word="${record#>}"
        names_the_binary=no
        if names_the_opencode_binary "$word"; then names_the_binary=yes; fi
        case "$word" in '$') substituted=yes ;; esac
        if [ "$names_the_binary" = yes ] && [ "$substituted" = yes ]; then invoked=yes; fi
        ;;
      '.'*)
        word="${record#.}"
        case "${word##*/}" in
          opencode) if [ "$substituted" = yes ]; then invoked=yes; fi ;;
        esac
        if [ "$names_the_binary" = yes ] && argument_beyond_a_redirect_descriptor "$word"; then
          invoked=yes
        fi
        ;;
      '<'*)
        if [ "$names_the_binary" = yes ]; then invoked=yes; fi
        ;;
    esac
  done
  report_opencode_invocation "$location" "$invoked"
}

names_the_opencode_binary() {
  local word="${1##*/}" name
  case "$word" in
    opencode) return 0 ;;
    *'$'*) ;;
    *) return 1 ;;
  esac
  name="${word##*\$}"
  name="${name#\{}"
  name="${name%\}}"
  name="${name%%[#%:]*}"
  while true; do
    case "$name" in
      *[Oo][Pp][Ee][Nn][Cc][Oo][Dd][Ee]) return 0 ;;
      *_[Bb][Ii][Nn]|*_[Bb][Ii][Nn][Aa][Rr][Yy]|*_[Ee][Xx][Ee]|*_[Pp][Aa][Tt][Hh]|*_[Cc][Mm][Dd]|*_[Cc][Ll][Ii])
        name="${name%_*}" ;;
      *) return 1 ;;
    esac
  done
}

argument_beyond_a_redirect_descriptor() {
  case "$1" in
    ''|*[!0-9]*) return 0 ;;
  esac
  return 1
}

report_opencode_invocation() {
  local location=$1 invoked=$2
  if [ -n "$location" ] && [ "$invoked" = yes ]; then
    printf '%s\n' "$location"
  fi
}

FIRST_SPELLED_RULE_COUNT=5
LAST_SPELLED_RULE_COUNT=51

declared_rule_count() {
  { grep -c '^check_[a-z0-9_]*() {$' "$REPO_ROOT/tests/plugin-lint.sh" 2>&1 || true; }
}

spelled_rule_count() {
  case "$1" in
    5) printf five ;; 6) printf six ;; 7) printf seven ;; 8) printf eight ;;
    9) printf nine ;; 10) printf ten ;; 11) printf eleven ;; 12) printf twelve ;;
    13) printf thirteen ;; 14) printf fourteen ;; 15) printf fifteen ;;
    16) printf sixteen ;; 17) printf seventeen ;; 18) printf eighteen ;;
    19) printf nineteen ;; 20) printf twenty ;; 21) printf twenty-one ;;
    22) printf twenty-two ;; 23) printf twenty-three ;; 24) printf twenty-four ;;
    25) printf twenty-five ;; 26) printf twenty-six ;; 27) printf twenty-seven ;;
    28) printf twenty-eight ;; 29) printf twenty-nine ;; 30) printf thirty ;;
    31) printf thirty-one ;; 32) printf thirty-two ;;
    33) printf thirty-three ;; 34) printf thirty-four ;;
    35) printf thirty-five ;; 36) printf thirty-six ;;
    37) printf thirty-seven ;; 38) printf thirty-eight ;;
    39) printf thirty-nine ;; 40) printf forty ;;
    41) printf forty-one ;;
    42) printf forty-two ;;
    43) printf forty-three ;;
    44) printf forty-four ;;
    45) printf forty-five ;;
    46) printf forty-six ;;
    47) printf forty-seven ;;
    48) printf forty-eight ;;
    49) printf forty-nine ;;
    50) printf fifty ;;
    51) printf fifty-one ;;
  esac
}

changelog_top_entry() {
  sed -n '/^## /{x;/./{q};x;h};p' "$REPO_ROOT/CHANGELOG.md" 2>&1 || true
}

spelled_count_mentions_in() {
  local text="$1" word="$2"
  { grep -ciE -- "(^|[^-[:alnum:]])$word( [a-z]+)? rules" <<< "$text" 2>&1 || true; }
}

stale_count_spelling_in() {
  local text="$1" count="$2" spelled
  spelled="$(spelled_rule_count "$count")"
  if [ -n "$spelled" ] && [ "$(spelled_count_mentions_in "$text" "$spelled")" != 0 ]; then
    printf '%s' "$spelled"
    return 0
  fi
  if [ "$(spelled_count_mentions_in "$text" "$count")" != 0 ]; then
    printf '%s' "$count"
    return 0
  fi
  return 1
}

check_present_tense_prose_names_the_rule_count() {
  local declared spelled surface named changelog_claim
  declared="$(declared_rule_count)"
  spelled="$(spelled_rule_count "$declared")"
  if [ -z "$spelled" ]; then
    flag "tests/plugin-lint.sh declares $declared rule functions, a count this rule has no word to look for"
    return 0
  fi
  for surface in tests/plugin-lint.sh README.md; do
    named="$({ grep -ci "$spelled rules" "$REPO_ROOT/$surface" 2>&1 || true; })"
    case "$named" in
      ''|0|*[!0-9]*) flag "$surface does not name the $spelled rules this linter declares (grep answered ${named:-empty})" ;;
    esac
  done

  changelog_claim="$(changelog_top_entry \
    | sed -n 's/.*plugin-lint\.sh.*rules to \([0-9][0-9]*\).*/\1/p')"
  if [ -n "$changelog_claim" ] && [ "$changelog_claim" != "$declared" ]; then
    flag "CHANGELOG.md's top entry says tests/plugin-lint.sh grows to $changelog_claim rules, but this linter declares $declared"
  fi
}

check_changelog_top_entry_names_the_count_that_superseded_its_own() {
  local declared spelled top named count stale
  declared="$(declared_rule_count)"
  spelled="$(spelled_rule_count "$declared")"
  [ -n "$spelled" ] || return 0
  top="$(changelog_top_entry)"
  named="$(spelled_count_mentions_in "$top" "$spelled")"
  case "$named" in
    ''|*[!0-9]*)
      flag "CHANGELOG.md's top entry could not be read for the $spelled rules this linter declares (grep answered ${named:-empty})"
      return 0 ;;
  esac
  [ "$named" -eq 0 ] || return 0
  count="$FIRST_SPELLED_RULE_COUNT"
  while [ "$count" -le "$LAST_SPELLED_RULE_COUNT" ]; do
    if [ "$count" != "$declared" ] && stale="$(stale_count_spelling_in "$top" "$count")"; then
      flag "CHANGELOG.md's top entry says the linter has $stale rules and names the $spelled rules tests/plugin-lint.sh declares nowhere, so a reader of the newest entry acts on a count the tree has left behind"
      return 0
    fi
    count=$((count + 1))
  done
}

DOC_LINE_CITATION='`[A-Za-z0-9_][A-Za-z0-9_./-]*\.[a-z][a-z]*:[0-9][0-9]*(-[0-9][0-9]*)?`'

check_living_records_cite_lines_that_still_carry_something() {
  local record citation cited_path cited_line body citations_read=0
  for record in "$REPO_ROOT"/docs/*.md; do
    [ -r "$record" ] || continue
    while IFS= read -r citation; do
      [ -n "$citation" ] || continue
      citations_read=$((citations_read + 1))
      cited_path="${citation%%:*}"
      cited_line="${citation#*:}"
      cited_line="${cited_line%%-*}"
      if [ ! -f "$REPO_ROOT/$cited_path" ]; then
        flag "${record#"$REPO_ROOT"/} cites $citation and no file stands at that path"
        continue
      fi
      body="$(sed -n "${cited_line}p" "$REPO_ROOT/$cited_path" 2>/dev/null)"
      case "$body" in
        *[![:space:]]*) ;;
        *) flag "${record#"$REPO_ROOT"/} cites $citation, which is past that file's end or a blank line, so the record points at nothing the reader can check" ;;
      esac
    done <<< "$(grep -oE -- "$DOC_LINE_CITATION" "$record" 2>/dev/null | sed 's/`//g')"
  done
  [ "$citations_read" -gt 0 ] ||
    flag "tests/plugin-lint.sh found no file:line citation under docs/, so this rule reported them sound having read nothing"
}

SHELL_SOURCES=()

collect_shell_sources() {
  local candidate
  SHELL_SOURCES=()
  for candidate in "$REPO_ROOT"/bootstrap/*.sh "$REPO_ROOT"/bootstrap/lib/*.sh \
    "$REPO_ROOT"/plugin/hooks/*.sh "$REPO_ROOT/plugin/bin/oso-state" \
    "$REPO_ROOT/plugin/git-hooks/pre-commit" "$REPO_ROOT"/tests/*.sh \
    "$REPO_ROOT"/tests/fixtures/*.sh "$REPO_ROOT"/tools/*.sh; do
    if [ -r "$candidate" ]; then
      SHELL_SOURCES+=("$candidate")
    fi
  done
}

comment_sites_below_a_contract_header() {
  awk -v quote="'" "$HEREDOC_BODY_TRACKING_AWK"'
    FNR == 1 { queued = 0; closed = 0; header_open = ($0 !~ /^#!/) }
    queued > closed {
      terminator = $0
      if (body_strips_tabs[closed + 1]) sub(/^\t+/, "", terminator)
      if (terminator == body_delimiter[closed + 1]) closed++
      next
    }
    /^[ \t]*#/ {
      if (FNR > 1 && !header_open) print FILENAME ":" FNR
      next
    }
    { header_open = 0; queue_heredoc_bodies($0) }
  ' "${SHELL_SOURCES[@]}" 2>&1
}

check_shell_sources_carry_no_comment_below_their_contract_header() {
  local site
  collect_shell_sources
  if [ "${#SHELL_SOURCES[@]}" -eq 0 ]; then
    flag "tests/plugin-lint.sh reached no readable shell source under bootstrap/, plugin/, tests/ or tools/, so this rule reports no comments having read nothing"
    return 0
  fi
  while IFS= read -r site; do
    [ -n "$site" ] || continue
    flag "${site#"$REPO_ROOT"/} is a comment below its file's first line of code, and a shell file states its contract in one block above that line or nowhere"
  done <<< "$(comment_sites_below_a_contract_header)"
}

directories_the_repository_ignores() {
  local line
  [ -r "$REPO_ROOT/.gitignore" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      */) printf '%s\n' "${line%/}" ;;
    esac
  done < "$REPO_ROOT/.gitignore"
}

files_naming_this_machines_home() {
  local -a excluded=(--exclude-dir=.git)
  local ignored
  while IFS= read -r ignored; do
    [ -n "$ignored" ] || continue
    excluded+=("--exclude-dir=$ignored")
  done <<< "$(directories_the_repository_ignores)"
  { grep -rlF "${excluded[@]}" -e "$HOME" "$REPO_ROOT" 2>&1 || true; }
}

check_no_shipped_file_carries_the_home_path_of_whoever_runs_this() {
  local carrier
  case "${HOME:-}" in
    ''|/)
      flag "this run has no home directory to look for, so the rule that keeps one out of the published tree read nothing"
      return 0 ;;
  esac
  while IFS= read -r carrier; do
    [ -n "$carrier" ] || continue
    flag "${carrier#"$REPO_ROOT"/} carries the absolute home directory of whoever runs this check, so a publish would ship one machine's layout and whatever its path names about its owner"
  done <<< "$(files_naming_this_machines_home)"
}

REPO_OWNED_DOT_DIRECTORIES=" .git .github .claude-plugin .codex-plugin .agents "

dot_directories_at_the_repository_root() {
  local entry
  for entry in "$REPO_ROOT"/.*/; do
    case "$entry" in
      */./|*/../|*'/.*/') continue ;;
    esac
    printf '%s\n' "${entry%/}"
  done
}

check_every_dot_directory_is_repo_owned_or_ignored() {
  local directory name
  while IFS= read -r directory; do
    [ -n "$directory" ] || continue
    name="${directory##*/}"
    case "$REPO_OWNED_DOT_DIRECTORIES" in
      *" $name "*) continue ;;
    esac
    if ! printf '%s\n' "$(directories_the_repository_ignores)" | grep -qxF "$name"; then
      flag "$name/ is neither one of this repository's own directories nor a line in .gitignore, so whatever the tool that wrote it leaves there is one commit away from being published"
    fi
  done <<< "$(dot_directories_at_the_repository_root)"
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
  local final_report_exception marker
  final_report_exception="$({ grep -F -- 'final report**' "$contract" || true; })"
  if [ -z "$final_report_exception" ]; then
    flag "skills/_shared/reporting.md states no exception to that bound for the final report of a run the operator was absent for, so a whole unwatched run reaches its operator in three lines"
  else
    for marker in "ROADMAP mode's §5" 'under its own AUTO' 'bodies/plan.md'; do
      grep -qiF -- "$marker" <<< "$final_report_exception" \
        || flag "skills/_shared/reporting.md's final-report exception stops covering both runs an operator can be absent for: $marker"
    done
  fi

  local mode mode_body
  for mode in $({ operator_only_modes claude; operator_only_modes codex; operator_only_modes opencode; } \
      | LC_ALL=C sort -u); do
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
    grep -qi -- "$marker" <<< "$bullet" \
      || flag "skills/_shared/reporting.md's '$name' milestone never names its required fact: $marker"
  done
}

check_reporting_host_difference_is_single_sourced() {
  local host marker label hosts neutral_leak cross_leak count other
  local claude_marker='native subagent card'
  local codex_marker='draws no card'
  local opencode_marker='native agent files'
  local claude_label='native-card'
  local codex_label='no-card'
  local opencode_label='no-card'

  for host in claude codex opencode; do
    case "$host" in
      claude) marker="$claude_marker"; label="$claude_label" ;;
      codex) marker="$codex_marker"; label="$codex_label" ;;
      opencode) marker="$opencode_marker"; label="$opencode_label" ;;
    esac
    hosts="$({ grep -rlF "$marker" "$PLUGIN_ROOT/skills/_shared/platform/$host" 2>&1 || true; })"
    count="$(printf '%s\n' "$hosts" | grep -c . || true)"
    case "$count" in
      1) ;;
      0) flag "no file under skills/_shared/platform/$host states the $label difference the milestone contract needs" ;;
      *) flag "the $label difference is stated in $count platform/$host files instead of exactly one: $(printf '%s' "$hosts" | tr '\n' ' ')" ;;
    esac
  done

  neutral_leak="$({ grep -rlE "$claude_marker|$codex_marker|$opencode_marker" \
    "$PLUGIN_ROOT/skills/_shared/bodies" "$PLUGIN_ROOT/skills/_shared/reporting.md" 2>&1 || true; })"
  [ -z "$neutral_leak" ] || flag "the host-specific card difference leaked into the neutral body or contract: $(printf '%s' "$neutral_leak" | tr '\n' ' ')"

  cross_leak=""
  for host in claude codex opencode; do
    case "$host" in
      claude) marker="$claude_marker"; others='codex opencode' ;;
      codex) marker="$codex_marker"; others='claude opencode' ;;
      opencode) marker="$opencode_marker"; others='claude codex' ;;
    esac
    for other in $others; do
      cross_leak="$cross_leak$({ grep -rlF "$marker" "$PLUGIN_ROOT/skills/_shared/platform/$other" 2>&1 || true; })"
    done
  done
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
    grep -qF -- "$marker" <<< "$paragraph" \
      || flag "skills/_shared/bodies/plan.md's Design-foundation slice paragraph never states: $marker"
  done
}

check_third_amendment_lane_names_its_conditions() {
  local host file paragraph marker
  for host in codex opencode; do
    file="$PLUGIN_ROOT/skills/_shared/platform/$host/plan.md"
    if [ ! -f "$file" ]; then
      flag "no $host plan platform file to check the third amendment lane"
      continue
    fi
    paragraph="$({ grep -F -- 'harness-discovered correction' "$file" || true; })"
    if [ -z "$paragraph" ]; then
      flag "skills/_shared/platform/$host/plan.md carries no harness-discovered-correction amendment lane"
      continue
    fi
    for marker in 'NOT STARTED' 'CITES' 'CONFIRMS' 'amend-plan'; do
      grep -qF -- "$marker" <<< "$paragraph" \
        || flag "skills/_shared/platform/$host/plan.md's harness-discovered-correction lane never asserts: $marker"
    done
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
    grep -qF 'WAVE START' <<< "$entry" \
      || flag "skills/_shared/bodies/plan.md:$linenum names wave 1 without naming WAVE START — the vague \"the base ref\" phrasing is what let wave 1 branch before wave 0 landed"
    grep -qiF 'wave 0' <<< "$entry" \
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
    grep -qF -- "$marker" <<< "$bullet" \
      || flag "skills/_shared/rubric.md's Over-documentation bullet never states the inline comment as a class: $marker"
  done
  for hit in $({ grep -nF 'Earned WHY' "$rubric" || true; } | cut -d: -f1); do
    flag "skills/_shared/rubric.md:$hit carries the retired Earned WHY escape hatch again"
  done
}

check_applier_rubric_mapping_names_every_section() {
  local agent mapping section
  for agent in "$PLUGIN_ROOT/agents/oso-applier.md" "$REPO_ROOT/codex/agents/oso-applier.toml" "$REPO_ROOT/opencode/agents/oso-applier.md"; do
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
      grep -qF -- "$section" <<< "$mapping" \
        || flag "${agent#"$REPO_ROOT"/}'s rubric mapping never names the rubric's $section section"
    done
  done
}

check_verifier_gate_fails_an_added_inline_comment() {
  local agent mandate marker
  for agent in "$PLUGIN_ROOT/agents/oso-verifier.md" "$REPO_ROOT/codex/agents/oso-verifier.toml" "$REPO_ROOT/opencode/agents/oso-verifier.md"; do
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
      grep -qiF -- "$marker" <<< "$mandate" \
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
      grep -qF -- "$marker" <<< "$bar" \
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
      grep -qF -- '`Debt Sweep: findings`' <<< "$hit" \
        || flag "${surface#"$REPO_ROOT"/}:${hit%%:*} reads \`Debt Sweep: clean\` as the whole of the debt axis's pass, the exit the band retired"
    done <<< "$({ grep -nF -- '`Debt Sweep: clean`' "$surface" || true; })"
  done
}

check_sweep_loop_remembers_its_dispositioned_findings() {
  local body reinvocation marker
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
      grep -qiF -- "$marker" <<< "$reinvocation" \
        || flag "${body#"$PLUGIN_ROOT"/}'s sweep re-invocation drops the clause that keeps the next round from re-litigating: $marker"
    done
  done

  section_names_its_clauses "$PLUGIN_ROOT/skills/_shared/bodies/debt-sweep.md" \
    'Prior rounds$' 'Prior rounds section' 'the clause that makes a disposition binding' any-case \
    '`fixed`' '`operator-dismissed`' '`accepted-residual`' 'never raise' 'as settled' 'never why'
}

check_roadmap_umbrella_approval_names_its_bounds() {
  roadmap_phase_names_its_clauses Approval 'Approval phase' \
    'a clause that bounds its one approval' \
    'planning every child' 'executing every child' 'every child' 'fresh approval' \
    'plan document' 'platform file'
}

roadmap_phase_names_its_clauses() {
  local heading="$1" flagged_as="$2" dropped="$3"
  shift 3
  section_names_its_clauses "$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md" \
    "[0-9][0-9]*\. $heading" "$flagged_as" "$dropped" any-case "$@"
}

section_names_its_clauses() {
  local file="$1" heading="$2" flagged_as="$3" dropped="$4" matching="$5"
  local section marker match_flags
  shift 5
  case "$matching" in
    any-case) match_flags=-qiF ;;
    exact-case) match_flags=-qF ;;
    *) flag "section_names_its_clauses was asked for unknown matching $matching"; return 0 ;;
  esac
  if [ ! -f "$file" ]; then
    flag "no ${file#"$PLUGIN_ROOT"/} to check the clauses its $flagged_as names"
    return 0
  fi
  section="$({ sed -n "/^## $heading/,/^## /p" "$file" 2>&1 || true; })"
  if [ -z "$section" ]; then
    flag "${file#"$PLUGIN_ROOT"/} carries no $flagged_as, so nothing there carries the clauses it turns on"
    return 0
  fi
  for marker in "$@"; do
    grep "$match_flags" -- "$marker" <<< "$section" \
      || flag "${file#"$PLUGIN_ROOT"/}'s $flagged_as drops $dropped: $marker"
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
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" \
    'If it returns `blocked`:' 'applier-blocked route' \
    "never answer on the user's behalf" 'roadmap' 'queued'
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/output-styles/oso.md" \
    'When a real decision exists' 'decision rule' \
    'the human decides' 'roadmap' 'queued'
}

anchored_absolute_stays_bounded_in() {
  local file="$1" anchor="$2" flagged_as="$3" text marker
  shift 3
  if [ ! -f "$file" ]; then
    flag "no ${file#"$PLUGIN_ROOT"/} to check what bounds its $flagged_as"
    return 0
  fi
  text="$({ grep -F -- "$anchor" "$file" 2>&1 || true; })"
  if [ -z "$text" ]; then
    flag "${file#"$PLUGIN_ROOT"/} states no $flagged_as, so nothing there carries the clauses that bound it"
    return 0
  fi
  for marker in "$@"; do
    grep -qiF -- "$marker" <<< "$text" \
      || flag "${file#"$PLUGIN_ROOT"/}'s $flagged_as drops a clause it turns on: $marker"
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
  anchored_absolute_stays_bounded_in "$plan" 'On `fail`: relaunch the applier' \
    'sequential fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away' 'ESCALATE' 'doubt-pass reconciliation' 'travel BARE'
  anchored_absolute_stays_bounded_in "$plan" '**A red slice**' 'red-slice fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away'
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/debug.md" \
    'Verifier `fail` → relaunch the applier' 'verifier fail route' \
    'findings VERBATIM' 'never your summary of them' 'yours to overrule' \
    'instruct any judge away'
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/front-surface.md" \
    '**Fix route**' 'design-audit fix route' \
    'findings VERBATIM' 'never your summary of them'
}

check_verifier_payload_is_closed_and_its_comment_gate_scans() {
  local agent payload gate marker
  for agent in "$PLUGIN_ROOT/agents/oso-verifier.md" "$REPO_ROOT/codex/agents/oso-verifier.toml" "$REPO_ROOT/opencode/agents/oso-verifier.md"; do
    if [ ! -f "$agent" ]; then
      flag "no oso-verifier contract at ${agent#"$REPO_ROOT"/} to check its payload list and its comment-gate scan"
      continue
    fi
    payload="$({ grep -iF -- 'CLOSED list' "$agent" || true; })"
    if [ -z "$payload" ]; then
      flag "${agent#"$REPO_ROOT"/} leaves its payload fields an open list, the shape a standing ruling arrives through"
    else
      for marker in 'standing ruling' 'softens a gate' 'blocked' 'APPLIER input' 'the rubric alone'; do
        grep -qiF -- "$marker" <<< "$payload" \
          || flag "${agent#"$REPO_ROOT"/}'s payload list names itself closed and then leaves the door it closes open: $marker"
      done
    fi
    gate="$({ grep -iF -- 'inline comment' "$agent" || true; })"
    if [ -z "$gate" ]; then
      flag "${agent#"$REPO_ROOT"/} names no inline-comment gate for a scan of the diff to feed"
      continue
    fi
    for marker in 'RUN a scan' 'command and output' 'evidence' 'never scanned'; do
      grep -qiF -- "$marker" <<< "$gate" \
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
        grep -qF -- "$marker" <<< "$precedence" \
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
      grep -qF -- "$marker" <<< "$audit" \
        || flag "skills/_shared/bodies/plan.md's no-exception audit stops short of routing the conflict to the operator: $marker"
    done
  fi

  anchored_absolute_stays_bounded_in "$plan" 'It leaves exactly two routes' 'ESCALATE route' \
    'canonical case' 'legacy-convention conflict' 'the banned thing everywhere' 'only they may take'
}

check_auto_disposition_is_a_ledger_toggle_that_parks_on_a_question() {
  local plan="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  anchored_absolute_stays_bounded_in "$plan" "A ROADMAP's child never waits for the operator" \
    'unattended ground rule' \
    "child of the ROADMAP mode's chain" 'a change executing under AUTO' \
    'explicit operator instruction' 'disarmed the same way' 'recorded DATED' \
    'disarms nothing' 'consumed as operator input' 'explicit resume instruction' \
    'autonomy policy' "THIS change's scale" 'frozen ledger answering first' \
    '`mode=plan` throughout' 'beside that triple and never over it' 'TWO substitutions'
  anchored_absolute_stays_bounded_in "$plan" 'What that policy will not answer costs this change' \
    'set-aside ground rule' \
    'its OWN final report' 'this run PARKS' 'reports BLOCKED' \
    'oso-state set mode=plan active_slice=none verify_green=false' \
    'expects resumption' 'END OF THE TURN'
  anchored_absolute_stays_bounded_in "$plan" '**The execution disposition' \
    'execution-disposition question' \
    "round's second question" 'NORMAL is the default' 'under AUTO' 'PARKING' \
    'never re-ask what the ledger already answers'
}

check_unattended_run_carves_out_the_delivery_contract() {
  local roadmap="$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md" retired
  section_names_its_clauses "$PLUGIN_ROOT/skills/_shared/platform/claude/reporting.md" \
    'The unattended run' 'unattended-run carve-out' 'a clause it turns on' exact-case \
    'auto=running' 'does NOT end the turn' 'oso-state journal' \
    'END THE TURN' 'auto=done' 'auto-continue.sh' \
    'the run THE OPERATOR ARMED' '`bodies/roadmap.md` §5' \
    "roadmap CHILD's own close is NEITHER of the two"

  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/platform/claude/roadmap.md" \
    'Every milestone report the chain' 'chain milestone exception' \
    'the chain and its children'

  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" \
    "A ROADMAP's child never waits for the operator" 'unattended marker flips' \
    'auto=running' 'auto=parked' 'auto=done' 'oso-state journal'

  if [ ! -f "$roadmap" ]; then
    flag "no roadmap body at skills/_shared/bodies/roadmap.md to check what a compaction costs a chain in flight"
    return 0
  fi
  for retired in $({ grep -nF 'a compaction costs it nothing' "$roadmap" || true; } | cut -d: -f1); do
    flag "skills/_shared/bodies/roadmap.md:$retired still says a compaction costs the chain nothing, a claim resting on a client window the harness can ask for and never guarantee"
  done
  anchored_absolute_stays_bounded_in "$roadmap" '**What survives the session' \
    'compaction economy' 'best-effort' 're-anchor' 'run journal'
}

check_auto_ceiling_holds_the_finish_and_the_evidence() {
  roadmap_phase_names_its_clauses 'The autonomy policy' 'autonomy-policy phase' \
    'a clause that bounds how far an unattended run reaches and what its answers rest on' \
    'a SHARED branch' 'PR MERGE' 'a release' 'a production deploy' \
    'CHANGE BRANCH' 'opens the PR' 'cites' 'unsourced'
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/plan.md" \
    'PUSH and PR are the two that still require the operator to ask' \
    "close step 8's finish" \
    'unattended' 'push -u origin' 'gh pr create' 'per-project record' \
    'PARKED as a named pending' 'never a retry loop' 'production deploy'
  anchored_absolute_stays_bounded_in "$PLUGIN_ROOT/skills/_shared/bodies/roadmap.md" \
    'The chain is BLOCKED' "blocked exit's marker write" \
    'oso-state set auto=parked' 'INTENDED'
}

check_the_project_record_is_honest_about_its_scope() {
  local plan="$PLUGIN_ROOT/skills/_shared/bodies/plan.md"
  local retired
  anchored_absolute_stays_bounded_in "$plan" "Read this project's operator record" \
    'per-project record read' \
    'ONE record PER PROJECT' 'filters by it unconditionally' 'unreachable from this one' \
    'asked once'
  anchored_absolute_stays_bounded_in "$plan" 'Self-heal before applying' \
    'record self-heal' \
    'now-retired field' 'under `scope: personal` migrates' 'every value it holds is kept' \
    'never a reason to ask them again'
  anchored_absolute_stays_bounded_in "$plan" '**Behavior — asked at the FIRST PLAN' \
    'first-plan behavior ask' \
    'ONE round of two questions'
  anchored_absolute_stays_bounded_in "$plan" '**Ceiling — asked at the FIRST AUTO' \
    'first-arming ceiling ask' \
    'STAGING ROUTE' 'PRODUCTION ROUTE' 'PR BASE BRANCH' \
    'never asked for its production route'
  anchored_absolute_stays_bounded_in "$plan" "AUTO's CEILING" 'ceiling arming ask' \
    'FIRST ARMING IN THIS PROJECT' 'mem_update' 'deploy-deny' 'ONE ERE PER LINE' \
    'mkdir -p' 'never skipped in silence' 'arms no AUTO at all'
  for retired in $({ grep -nF 'per-machine ($HOME)' "$plan" || true; } | cut -d: -f1); do
    flag "skills/_shared/bodies/plan.md:$retired claims the per-project record reaches this whole machine again, a reach mem_search never had"
  done
}

check_launch_wait_contract_states_the_mechanism_this_host_has() {
  local retired ceiling_clause renewals_clause
  ceiling_clause="$({ sed -n 's/^DELEGATION_WAIT_CEILING_MINUTES=\([0-9][0-9]*\)$/\1 minutes/p' \
    "$PLUGIN_ROOT/hooks/auto-continue.sh" 2>/dev/null || true; })"
  case "$ceiling_clause" in
    [0-9]*' minutes') ;;
    *)
      flag "hooks/auto-continue.sh states no single delegation-wait ceiling for the Claude binding to name"
      ceiling_clause='the ceiling auto-continue.sh no longer states' ;;
  esac
  renewals_clause="$({ sed -n 's/^DELEGATION_WAIT_RENEWALS_CAP=\([0-9][0-9]*\)$/at most \1 times/p' \
    "$PLUGIN_ROOT/hooks/auto-continue.sh" 2>/dev/null || true; })"
  case "$renewals_clause" in
    'at most '[0-9]*' times') ;;
    *)
      flag "hooks/auto-continue.sh states no single renewal bound for the Claude binding to name"
      renewals_clause='the renewal bound auto-continue.sh no longer states' ;;
  esac
  section_names_its_clauses "$PLUGIN_ROOT/skills/_shared/platform/claude/delegation-wait.md" \
    'Making a launch wait' 'launch-wait contract' 'a clause the launch it governs turns on' exact-case \
    'always launches in the BACKGROUND' 'completion notification' 'IS the resume' \
    'Nothing may act on a report it has not read' \
    'auto_wait=<label>' 'auto_wait=none' 'never relaunch a delegation' \
    'ONE label under ONE session' \
    "$ceiling_clause" "$renewals_clause"
  for retired in $({ grep -rlF 'run_in_background' "$PLUGIN_ROOT/skills" || true; }); do
    flag "${retired#"$PLUGIN_ROOT"/} tells a launch to pass a foreground flag the Agent tool's schema does not accept"
  done
}

check_parity_docs_agree_on_harness_version() {
  local host pin pattern doc named count
  for host in codex opencode; do
    case "$host" in
      codex)
        pin="$({ sed -n 's/^SUPPORTED_CODEX_VERSION=//p' "$REPO_ROOT/bootstrap/install-codex.sh" 2>/dev/null || true; })"
        pattern='Codex ([0-9]+\.[0-9]+\.[0-9]+)'
        ;;
      opencode)
        pin="$({ sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' "$REPO_ROOT/bootstrap/install-opencode.sh" 2>/dev/null || true; })"
        pattern='OpenCode ([0-9]+\.[0-9]+\.[0-9]+)'
        ;;
    esac
    doc="$REPO_ROOT/docs/parity-$host.md"
    if [ ! -f "$doc" ]; then
      flag "docs/parity-$host.md is missing, so no parity ledger states what this repo supports on $host"
      continue
    fi
    if [ -z "$pin" ]; then
      flag "no $host harness version pin in bootstrap/install-$host.sh for docs/parity-$host.md to agree with"
      continue
    fi
    named="$({ grep -oE "$pattern" "$doc" || true; } | LC_ALL=C sort -u)"
    case "$(printf '%s\n' "$named" | grep -c . || true)" in
      0) flag "docs/parity-$host.md names no harness version to compare against the installer pin $pin" ;;
      1)
        named="${named##* }"
        [ "$named" = "$pin" ] || flag "docs/parity-$host.md names $named, which disagrees with the $pin pin bootstrap/install-$host.sh states"
        ;;
      *) flag "docs/parity-$host.md names more than one harness version, so it cannot agree on one" ;;
    esac
  done
}

concern_named_before_its_host_qualifier() {
  sed 's/ — .*//' | tr -d '`' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s/[[:punct:]]*$//' \
    | tr '[:upper:]' '[:lower:]'
}

overlay_section_concerns() {
  local overlay="$1"
  [ -f "$overlay" ] || return 0
  { sed -n 's/^## //p' "$overlay" || true; } | concern_named_before_its_host_qualifier
}

declared_opencode_section_divergences() {
  local doc="$REPO_ROOT/docs/parity-opencode.md" rows row overlay concern
  [ -f "$doc" ] || return 0
  rows="$({ sed -n '/^## Section inventory divergences$/,/^## /p' "$doc" \
    | grep '^| ' | grep -vE '^\|[[:space:]]*(Overlay|-)' || true; })"
  while IFS= read -r row; do
    overlay="$(cut -d'|' -f2 <<< "$row" | tr -d '` ')"
    concern="$(cut -d'|' -f3 <<< "$row" | concern_named_before_its_host_qualifier)"
    [ -n "$overlay" ] && [ -n "$concern" ] || continue
    printf '%s\t%s\n' "$overlay" "$concern"
  done <<< "$rows"
}

concern_is_declared() {
  local declared="$1" overlay="$2" concern="$3"
  grep -qxF "$(printf '%s\t%s' "$overlay" "$concern")" <<< "$declared"
}

check_platform_section_inventory_is_matched_or_declared() {
  local overlays="$PLUGIN_ROOT/skills/_shared/platform"
  local absent_overlay='no counterpart file'
  local declared reference file overlay concern carried reference_concerns

  declared="$(declared_opencode_section_divergences)"

  for reference in claude codex; do
    for file in "$overlays/$reference"/*.md; do
      [ -f "$file" ] || continue
      overlay="$(basename "$file")"
      if [ ! -f "$overlays/opencode/$overlay" ]; then
        concern_is_declared "$declared" "$overlay" "$absent_overlay" \
          || flag "skills/_shared/platform/opencode carries no $overlay, which platform/$reference does, and docs/parity-opencode.md declares no host-justified divergence for it"
        continue
      fi
      carried="$(overlay_section_concerns "$overlays/opencode/$overlay")"
      while IFS= read -r concern; do
        [ -n "$concern" ] || continue
        if ! grep -qxF "$concern" <<< "$carried" \
          && ! concern_is_declared "$declared" "$overlay" "$concern"; then
          flag "skills/_shared/platform/opencode/$overlay drops the '$concern' section platform/$reference/$overlay carries, and docs/parity-opencode.md declares no host-justified divergence for it"
        fi
      done <<< "$(overlay_section_concerns "$file")"
    done
  done

  while IFS=$'\t' read -r overlay concern; do
    [ -n "$overlay" ] || continue
    if [ "$concern" = "$absent_overlay" ]; then
      [ ! -f "$overlays/opencode/$overlay" ] \
        || flag "docs/parity-opencode.md declares $overlay absent from platform/opencode, which carries it"
      continue
    fi
    if grep -qxF "$concern" <<< "$(overlay_section_concerns "$overlays/opencode/$overlay")"; then
      flag "docs/parity-opencode.md declares '$concern' a divergence in $overlay, a section platform/opencode carries — a divergence is declared for what this host answers elsewhere, never for what it answers in place"
      continue
    fi
    reference_concerns="$({ overlay_section_concerns "$overlays/claude/$overlay"; overlay_section_concerns "$overlays/codex/$overlay"; })"
    grep -qxF "$concern" <<< "$reference_concerns" \
      || flag "docs/parity-opencode.md declares '$concern' a divergence in $overlay, a section neither platform/claude nor platform/codex carries"
  done <<< "$declared"
}

check_every_host_wraps_every_skill() {
  local skill host wrapper
  for skill in "$PLUGIN_ROOT"/skills/*/SKILL.md; do
    [ -f "$skill" ] || continue
    for host in claude codex opencode; do
      wrapper="$(host_wrapper "$skill" "$host")"
      [ -f "$wrapper" ] \
        || flag "${wrapper#"$REPO_ROOT"/} is missing, so every rule that reads ${skill#"$PLUGIN_ROOT"/}'s $host sources reads nothing at all"
    done
  done
}

VERDICT_GRAMMAR_OWNER=opencode/plugin/oso/verdict.ts

check_the_verdict_grammar_has_one_implementation() {
  local owner="$REPO_ROOT/$VERDICT_GRAMMAR_OWNER" root alternation duplicates
  local searched=()
  if [ ! -f "$owner" ]; then
    flag "$VERDICT_GRAMMAR_OWNER is missing, so no file owns the verdict grammar a delegated report is read with"
    return 0
  fi
  for root in plugin codex bootstrap tests tools opencode/plugin opencode/hooks; do
    if [ -d "$REPO_ROOT/$root" ]; then searched+=("$REPO_ROOT/$root"); fi
  done
  if [ "${#searched[@]}" -eq 0 ]; then
    flag "no executable tree stands beside $VERDICT_GRAMMAR_OWNER, so a second parser of it could not be looked for"
    return 0
  fi
  while IFS= read -r alternation; do
    [ -n "$alternation" ] || continue
    duplicates="$({ grep -rlF "$alternation" "${searched[@]}" 2>&1 || true; } | { grep -vxF "$owner" || true; })"
    [ -z "$duplicates" ] || flag "the verdict vocabulary $alternation is spelled outside $VERDICT_GRAMMAR_OWNER, so a delegated report is read by two parsers that can drift apart: $(printf '%s' "$duplicates" | tr '\n' ' ')"
  done <<< "$(sed -n 's/.*\(([a-z][a-z]*|[a-z][a-z]*)\).*/\1/p' "$owner" | LC_ALL=C sort -u)"
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
check_shell_sources_carry_no_comment_below_their_contract_header
check_no_shipped_file_carries_the_home_path_of_whoever_runs_this
check_every_dot_directory_is_repo_owned_or_ignored
check_present_tense_prose_names_the_rule_count
check_changelog_top_entry_names_the_count_that_superseded_its_own
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
check_auto_disposition_is_a_ledger_toggle_that_parks_on_a_question
check_unattended_run_carves_out_the_delivery_contract
check_auto_ceiling_holds_the_finish_and_the_evidence
check_the_project_record_is_honest_about_its_scope
check_launch_wait_contract_states_the_mechanism_this_host_has
check_parity_docs_agree_on_harness_version
check_platform_section_inventory_is_matched_or_declared
check_every_host_wraps_every_skill
check_the_verdict_grammar_has_one_implementation
check_no_verification_script_invokes_opencode_directly
check_living_records_cite_lines_that_still_carry_something

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean — fifty-one rules"
