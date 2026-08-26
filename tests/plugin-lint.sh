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

check_impeccable_pin_is_never_a_placeholder() {
  local hit
  for hit in $({ grep -rnF 'impeccable@X' \
      "$REPO_ROOT/plugin" "$REPO_ROOT/docs" "$REPO_ROOT/CHANGELOG.md" 2>&1 || true; } | cut -d: -f1,2); do
    flag "${hit#"$REPO_ROOT"/} carries the unresolvable pin placeholder impeccable@X"
  done
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

repo_root_is_a_git_work_tree() {
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
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

files_under_repo_root_a_root_gitignore_prune_reaches() {
  local -a prune_expression=(-name .git)
  local ignored
  while IFS= read -r ignored; do
    [ -n "$ignored" ] || continue
    prune_expression+=(-o -name "$ignored")
  done <<< "$(directories_the_repository_ignores)"
  find "$REPO_ROOT" -type d \( "${prune_expression[@]}" \) -prune -o -type f -print
}

files_under_repo_root_git_does_not_ignore() {
  local candidates ignored status
  if ! candidates="$(find "$REPO_ROOT" -type d -name .git -prune -o -type f -print)"; then
    return 1
  fi
  [ -n "$candidates" ] || return 0
  ignored="$(git -C "$REPO_ROOT" check-ignore --stdin <<< "$candidates" 2>/dev/null)" && status=0 || status=$?
  if [ "$status" -eq 0 ]; then
    grep -vxFf <(printf '%s\n' "$ignored") <<< "$candidates" || true
    return 0
  fi
  if [ "$status" -ne 1 ]; then
    return 1
  fi
  printf '%s\n' "$candidates"
}

candidates_naming_this_machines_home() {
  local candidates="$1" candidate
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    grep -lF -- "$HOME" "$candidate" || true
  done <<< "$candidates"
}

files_naming_this_machines_home() {
  local candidates
  if repo_root_is_a_git_work_tree; then
    if ! candidates="$(files_under_repo_root_git_does_not_ignore)"; then
      return 1
    fi
  elif ! candidates="$(files_under_repo_root_a_root_gitignore_prune_reaches)"; then
    return 1
  fi
  [ -n "$candidates" ] || return 1
  candidates_naming_this_machines_home "$candidates"
}

check_no_shipped_file_carries_the_home_path_of_whoever_runs_this() {
  local carrier carriers
  case "${HOME:-}" in
    ''|/)
      flag "this run has no home directory to look for, so the rule that keeps one out of the published tree read nothing"
      return 0 ;;
  esac
  if ! carriers="$(files_naming_this_machines_home)"; then
    flag "the scan for files naming this machine's home directory read nothing under $REPO_ROOT, so this rule reports none having searched nothing"
    return 0
  fi
  while IFS= read -r carrier; do
    [ -n "$carrier" ] || continue
    flag "${carrier#"$REPO_ROOT"/} carries the absolute home directory of whoever runs this check, so a publish would ship one machine's layout and whatever its path names about its owner"
  done <<< "$carriers"
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

directory_is_ignored() {
  local directory="$1" name="${1##*/}"
  if repo_root_is_a_git_work_tree; then
    git -C "$REPO_ROOT" check-ignore -q -- "$directory" 2>/dev/null
  else
    printf '%s\n' "$(directories_the_repository_ignores)" | grep -qxF "$name"
  fi
}

check_every_dot_directory_is_repo_owned_or_ignored() {
  local directory name
  while IFS= read -r directory; do
    [ -n "$directory" ] || continue
    name="${directory##*/}"
    case "$REPO_OWNED_DOT_DIRECTORIES" in
      *" $name "*) continue ;;
    esac
    if ! directory_is_ignored "$directory"; then
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

check_own_references_resolve
check_impeccable_pin_is_never_a_placeholder
check_executables_carry_no_decision_citations
check_shell_sources_carry_no_comment_below_their_contract_header
check_no_shipped_file_carries_the_home_path_of_whoever_runs_this
check_every_dot_directory_is_repo_owned_or_ignored
check_hook_renders_and_published_hashes_match
check_parity_docs_agree_on_harness_version
check_platform_section_inventory_is_matched_or_declared
check_every_host_wraps_every_skill
check_the_verdict_grammar_has_one_implementation
check_no_verification_script_invokes_opencode_directly

if [ "$violations" -gt 0 ]; then
  echo "lint: $violations violation(s) in $PLUGIN_ROOT"
  exit 1
fi
echo "lint: clean — twelve rules"
