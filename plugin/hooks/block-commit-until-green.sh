#!/usr/bin/env bash
# PreToolUse[Bash]: denies git commit while the session verify is not green.
# Reads only state flags — never inspects model output.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

# One verdict for a whole command line: every command the line runs is judged,
# and a payload past the recursion bound is as undecidable as one written in
# another language — never clear, never a deny. gated denies, residue passes and
# is counted, clear was never this gate's.
line_verdict() {
  local record verdict=clear command_stdin=""
  local -a command_tokens=()
  while IFS= read -r record; do
    case "$record" in
      "$LEX_UNREAD_PAYLOAD_MARKER") if [ "$verdict" = clear ]; then verdict=residue; fi ;;
      '>'*) judge_command; command_tokens=("${record#>}"); command_stdin="" ;;
      '.'*) command_tokens+=("${record#.}") ;;
      '<'*) command_stdin="$command_stdin${record#<}" ;;
    esac
  done <<< "$(shell_commands "$1")"
  judge_command
  printf '%s' "$verdict"
}

# A gated call settles the line; a residue only stands while nothing gated has.
judge_command() {
  if is_gated_git_call; then
    verdict=gated
  elif [ "$verdict" = clear ] && is_residue_call; then
    verdict=residue
  fi
}

is_gated_git_call() {
  if ! is_git_call; then
    return 1
  fi
  local verb
  verb="$(git_verb)"
  if [ -z "$verb" ] || ! is_gated_git_verb "$verb"; then
    return 1
  fi
  if git_call_only_reports "$verb"; then
    return 1
  fi
  return 0
}

is_git_call() {
  if [ "${#command_tokens[@]}" -eq 0 ]; then
    return 1
  fi
  case "${command_tokens[0]##*/}" in
    git|git.exe) return 0 ;;
  esac
  return 1
}

# An option in neither table below leaves the verb unresolved: the word after
# `git --super-prefix p/` is that option's value on one git and the verb on
# another, and either guess would call some commit clear. No git verb is spelled
# like this, so nothing valid collides with it.
GIT_VERB_UNRESOLVED='?'

# The verb is the first argument that is neither an option nor an option's value.
# Behind an option git answers by itself there is no verb at all.
git_verb() {
  local index=1 argument
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    argument="${command_tokens[$index]}"
    case "$argument" in
      --*=*) ;;
      -*)
        if git_option_prints_and_exits "$argument"; then
          return 0
        elif git_option_takes_a_value "$argument"; then
          index=$((index + 1))
        elif ! git_option_stands_alone "$argument"; then
          printf '%s' "$GIT_VERB_UNRESOLVED"
          return 0
        fi
        ;;
      *) printf '%s' "$argument"; return 0 ;;
    esac
    index=$((index + 1))
  done
}

# git's own options that take a separate value, so `git -C repo commit` reads
# `repo` as that value and not as the verb. Confirmed against git 2.54.0: for
# exactly these, `git <option> <value> version` still reaches the verb. An
# `--option=value` word needs no table — it can never eat the word behind it.
git_option_takes_a_value() {
  case "$1" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source) return 0 ;;
  esac
  return 1
}

# git answers these itself — a version, a path on stdout, a usage screen — and
# exits before any verb runs, so `git --exec-path commit` prints a path and
# commits nothing: the word behind one of them is no verb. Confirmed against git
# 2.54.0, where `git --version status` and `git -v status` print the version and
# never run status. Only the bare form ends the call; `--exec-path=/path` sets the
# path and runs the verb.
git_option_prints_and_exits() {
  case "$1" in
    -h|--help|-v|--version) return 0 ;;
    --exec-path|--html-path|--man-path|--info-path) return 0 ;;
  esac
  return 1
}

# git's own options that stand alone, so the next word is still the verb.
# Confirmed against git 2.54.0: `git <option> version` reaches the verb for every
# one of them, and `--bare` reaches it in a bare repo.
git_option_stands_alone() {
  case "$1" in
    -p|-P|--paginate|--no-pager|--bare) return 0 ;;
    --no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice) return 0 ;;
    --literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs) return 0 ;;
  esac
  return 1
}

# Verbs that write history or refs. Everything else git can do is none of this
# gate's business: `git revert`, `merge`, `rebase`, `cherry-pick`, `am`, `push`
# and `stash` are not covered here, and a verb in neither table passes.
is_gated_git_verb() {
  case "$1" in
    commit|commit-tree|update-ref|filter-branch|replace|fast-import) return 0 ;;
  esac
  return 1
}

# A read-only marker is only a marker where an option can stand: behind an option
# it is that option's value, and behind `--` it is a pathspec. Confirmed against
# git 2.54.0 — `git commit -m --dry-run`, `-m -h` and `-am --dry-run` all commit,
# with the marker for a subject. Which of a verb's options take a separate value
# is per verb and per git version, and that is the arity guess this gate has
# already paid for twice, so the position answers instead of a table:
# `git commit --amend --dry-run` is gated rather than guessed.
git_call_only_reports() {
  local verb="$1" index=1 token value_position=0
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    token="${command_tokens[$index]}"
    index=$((index + 1))
    if [ "$token" = -- ]; then
      return 1
    fi
    if [ "$value_position" = 0 ] && is_read_only_git_option "$verb" "$token"; then
      return 0
    fi
    case "$token" in
      --*=*) value_position=0 ;;
      -*) value_position=1 ;;
      *) value_position=0 ;;
    esac
  done
  return 1
}

# `git commit --dry-run` and the help forms report instead of writing. There is
# no blanket flag rule behind this — `git update-ref -d` deletes a ref.
is_read_only_git_option() {
  case "$1:$2" in
    commit:--dry-run|commit:-h|commit:--help|replace:-l) return 0 ;;
  esac
  return 1
}

# A command word only the shell can resolve, a git call whose option shape this
# gate cannot resolve, and what a python or node payload does with git are all
# undecidable here: the call passes, counted rather than silent.
is_residue_call() {
  if [ "${#command_tokens[@]}" -eq 0 ]; then
    return 1
  fi
  case "${command_tokens[0]}" in
    *'$'*) return 0 ;;
  esac
  if is_git_call; then
    case "$(git_verb)" in
      "$GIT_VERB_UNRESOLVED"|*'$'*) return 0 ;;
    esac
    return 1
  fi
  is_interpreter_handed_git
}

# An interpreter reads its script from an argument or from its stdin, and either
# way what the script asks git to do is out of a shell lexer's reach. The mention
# is all this gate can see, and seeing it is the whole difference between a rail
# and a sieve. Interpreters install under versioned names — python3.13, php8.2 —
# and no version changes what a script may do, so the version goes before the
# name is read rather than being enumerated here.
is_interpreter_handed_git() {
  local interpreter="${command_tokens[0]##*/}"
  case "${interpreter%%[0-9]*}" in
    python|node|perl|ruby|php) ;;
    *) return 1 ;;
  esac
  local index=1
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    case "${command_tokens[$index]}" in
      *git*) return 0 ;;
    esac
    index=$((index + 1))
  done
  case "$command_stdin" in
    *git*) return 0 ;;
  esac
  return 1
}

input="$(cat)"
command="$(json_command_line "$input")"
session_id="$(hook_session "$input")"
require_session "$session_id"

# The state belongs to the repository the call is made in, and the payload is
# what says where that is: a hook's own working directory is the client's to
# choose, and this one is handed the session's.
state_file="$(state_file_for "$(json_field "$input" cwd)")"
require_readable_state "$state_file" "$session_id"

# Every call in an armed session is this gate's to decide from here, so an
# unexpected failure — the lexer's, the verdict's — blocks instead of opening the
# gate. Hence the verdict below and not above: armed after it, a crash while
# reading the line would open the gate with nothing recorded. Armed before the
# state check it would deny every Bash call on every machine that has the plugin
# installed, armed session or not.
trap 'block_with_gate_error "the commit gate"' ERR

verdict="$(line_verdict "$command")"
if [ "$verdict" = clear ]; then
  exit 0
fi

record_reader_fallback "$session_id"

if state_says "$state_file" '^verify_green=true$' "$session_id"; then
  exit 0
fi

# A residue reaches the same jurisdiction as a commit and then passes, so the log
# measures what slipped past an armed gate rather than every mention of git.
if [ "$verdict" = residue ]; then
  trap - ERR
  log_event residue-allowed "$session_id" "$command" || true
  exit 0
fi

deny_until_green "$session_id"
