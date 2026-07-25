# Tells the CODE a Bash command line runs from the TEXT that only mentions it.
# A gate has to ask whether a word is the command word of some command this line
# runs, never whether the text appears somewhere in the line: quoted mentions,
# comments and heredoc bodies are data, while payloads, substitutions and
# herestrings are more commands. shell_commands prints the commands the line
# runs, one record per line: ">" on a command word, "." on its arguments, "<" on
# stdin text the command was handed and nobody read as commands. The words in
# front of the command word are already stripped.
#
# Every cursor move counts bytes instead of matching what it passed over, for the
# reason lib.sh's json_unescape does — and shell metacharacters are bytes, so
# reading them as anything else would only cost the walk.

# Doubled backslash: a bracket expression reads a single one as an escape.
LEX_SPECIAL_CHARS=$'\'"\\\\$`#;&|(){}<> \t\n'
LEX_QUOTED_SPECIAL_CHARS=$'"\\\\$`'
LEX_UNREAD_PAYLOAD_MARKER='!unread-payload'
LEX_MAX_PAYLOAD_DEPTH=3

# A line costs more than its length, because every move still carries the bytes
# ahead of it: measured here, the worst shapes this lexer has (a line of short
# words, a heredoc a shell reads, three nested substitutions) run 126-140 ms at
# 3 KiB, 151-214 ms at 4 KiB and over 400 ms at 8 KiB, while what a session really
# sends — `npm test`, a release line — runs in 14-25 ms. A hook runs before every
# call, so past the bound the line is not lexed at all: it comes out as the unread
# marker, the same as any other line this lexer cannot decide.
LEX_MAX_INPUT_BYTES=3072

shell_commands() {
  # Every command and every heredoc terminator ends at a newline, so the line
  # the caller left unterminated gets one here instead of a special case.
  local rest="$1"$'\n' depth="${2:-0}"
  local token="" token_open=0 redirect_target_pending=0 herestring_pending=0
  local pending_heredocs="" nested="" unread_stdin="" lex_span="" chunk char
  local LC_ALL=C
  local -a command_tokens=()
  if [ "${#rest}" -gt "$LEX_MAX_INPUT_BYTES" ]; then
    printf '%s\n' "$LEX_UNREAD_PAYLOAD_MARKER"
    return 0
  fi
  while [ -n "$rest" ]; do
    chunk="${rest%%[$LEX_SPECIAL_CHARS]*}"
    if [ -n "$chunk" ]; then
      token="$token$chunk"
      token_open=1
      rest="${rest:${#chunk}}"
      continue
    fi
    char="${rest:0:1}"
    rest="${rest:1}"
    case "$char" in
      "'") token_open=1; lex_take_single_quoted ;;
      '"') token_open=1; lex_take_double_quoted ;;
      '\') lex_take_escape ;;
      '$') token_open=1; lex_take_expansion ;;
      '`') token_open=1; lex_take_backtick ;;
      '#') if [ "$token_open" = 1 ]; then token="$token#"; else lex_drop_comment; fi ;;
      ' '|$'\t') lex_end_token ;;
      '>') lex_end_token; lex_take_redirect ;;
      '<') lex_take_input_redirect ;;
      '&') if [ "${rest:0:1}" = '>' ]; then lex_end_token; lex_take_redirect; else lex_end_command; fi ;;
      ';'|'|'|'('|')'|'{'|'}') lex_end_command ;;
      $'\n') lex_end_token; lex_take_heredoc_bodies; lex_end_command ;;
    esac
  done
  lex_end_token
  lex_take_heredoc_bodies
  lex_end_command
}

lex_end_token() {
  # A redirect's target is a file or a descriptor, so it is no word of the command.
  if [ "$token_open" = 1 ] && [ "$redirect_target_pending" = 1 ]; then
    redirect_target_pending=0
  elif [ "$token_open" = 1 ]; then
    command_tokens+=("$token")
    # A herestring word is the command line the reader gets on its stdin.
    if [ "$herestring_pending" = 1 ]; then
      herestring_pending=0
      lex_defer_nested_commands "$token"
    fi
  fi
  token=""
  token_open=0
}

lex_end_command() {
  lex_end_token
  lex_strip_command_prefixes
  lex_defer_payload_commands
  lex_print_command
  command_tokens=()
  nested=""
  unread_stdin=""
  redirect_target_pending=0
}

# `env X=1 sudo -n timeout 60 git commit` runs git: whatever stands in front of
# the command word goes, word by word. Stripping one word too many only ever
# finds the real command deeper, which is the direction a gate wants. Behind an
# option there is no such direction: `sudo -u x bash` leaves `x bash`, and only
# a per-wrapper option-arity table could say whether `x` is the user or the
# program. So the word behind an option is an unresolved command word, and the
# command it stands for comes out unread — counted like any other call the lexer
# cannot decide, never clean.
lex_strip_command_prefixes() {
  local prefix_word=""
  while [ "${#command_tokens[@]}" -gt 0 ]; do
    if ! is_command_prefix_word "${command_tokens[0]}"; then
      case "$prefix_word" in -*) lex_mark_unread ;; esac
      return 0
    fi
    prefix_word="${command_tokens[0]}"
    command_tokens=("${command_tokens[@]:1}")
  done
}

# `bash -lc …`, `sh -ec …`, `bash --login -c …` and `eval` all hand their
# arguments back to a shell. eval builds one command line out of all of them; an
# interpreter runs one of them. `source f` and `. f` hand a shell a file instead,
# and no lexer can read what is in it.
lex_defer_payload_commands() {
  if [ "${#command_tokens[@]}" -eq 0 ]; then
    return 0
  fi
  if is_sourcing_builtin "${command_tokens[0]}"; then
    lex_mark_unread
    return 0
  fi
  if [ "${command_tokens[0]##*/}" = eval ]; then
    lex_defer_nested_commands "${command_tokens[*]:1}"
    return 0
  fi
  if is_shell_interpreter "${command_tokens[0]}"; then
    lex_defer_interpreter_payload
  fi
}

# An interpreter runs exactly one argument: the first word after its -c flag that
# is not itself an option. The words behind that one become $0, $1 … of the
# payload and never run, so reading them as code would deny a line no shell ever
# runs. A long option's value is not the payload either — only a short cluster
# carries -c.
#
# Behind any other option that word may be the option's value, and then the real
# payload is one further in: on bash 5.3 `bash -c -O extglob "…"` and
# `bash -c -o pipefail "…"` both run the payload behind the value, while
# `bash -c -x "…"` runs the word itself. A cluster answers the same way and hides
# the question inside one word: `bash -cO extglob "…"`, `bash -co pipefail "…"`
# and `bash -Oc extglob "…"` all run the payload behind `extglob`, whichever of
# the cluster's letters took it. Which options take a value is per shell and per
# version, so the position answers instead of a table: a payload standing where a
# value stands is still read as commands, because there it may be the payload, and
# the call is counted unread, because there it may hide one. Only `-c` alone
# leaves no letter that could have eaten the next word.
lex_defer_interpreter_payload() {
  local index=1 command_flag_seen=0 value_position=0 argument
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    argument="${command_tokens[$index]}"
    index=$((index + 1))
    case "$argument" in
      --*) value_position=1; continue ;;
      -c) command_flag_seen=1; value_position=0; continue ;;
      -*c*) command_flag_seen=1; value_position=1; continue ;;
      -*) value_position=1; continue ;;
    esac
    if [ "$command_flag_seen" = 0 ]; then
      continue
    fi
    if [ "$value_position" = 1 ]; then
      lex_mark_unread
    fi
    lex_defer_nested_commands "$argument"
    return 0
  done
  # No -c payload on the line at all: this shell reads its commands from its stdin
  # or from a script file — `echo git commit | bash`, `cat s | sh -s`,
  # `bash deploy.sh` — and neither text is here. Whatever the line did hand it, a
  # herestring or a heredoc body, is already in `nested`, so an empty one is the
  # case where nothing about this call was read.
  if [ -z "$nested" ]; then
    lex_mark_unread
  fi
}

# A payload is a command line of its own, so the whole scan runs again on it.
# Past the depth bound the marker stands in for the commands nobody read: a line
# the lexer gave up on must never come out looking like a clean one.
lex_defer_nested_commands() {
  local payload="$1" found
  if [ -z "$payload" ]; then
    return 0
  fi
  if [ "$depth" -ge "$LEX_MAX_PAYLOAD_DEPTH" ]; then
    lex_mark_unread
    return 0
  fi
  found="$(shell_commands "$payload" "$((depth + 1))")"
  if [ -n "$found" ]; then
    nested="$nested$found"$'\n'
  fi
}

# A command this lexer read far enough to know it could not read it. The marker
# goes out with the command it belongs to, so nothing downstream mistakes what
# was left unread for a line that came out clean.
lex_mark_unread() {
  nested="$nested$LEX_UNREAD_PAYLOAD_MARKER"$'\n'
}

# The commands a substitution or payload hides run as part of this command, so
# they print with it rather than ahead of the next one. A record is one line, so
# a newline a quoted token carries prints as a space: what recursed into that
# token was the token itself, and no caller reads a token for its whitespace.
lex_print_command() {
  local index=0 marker='>'
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    printf '%s%s\n' "$marker" "${command_tokens[$index]//$'\n'/ }"
    marker='.'
    index=$((index + 1))
  done
  if [ -n "$unread_stdin" ]; then
    printf '<%s\n' "${unread_stdin//$'\n'/ }"
  fi
  if [ -n "$nested" ]; then
    printf '%s' "$nested"
  fi
}

lex_take_escape() {
  if [ "${rest:0:1}" = $'\n' ]; then
    rest="${rest:1}"
    return 0
  fi
  token="$token${rest:0:1}"
  token_open=1
  rest="${rest:1}"
}

lex_take_single_quoted() {
  local span="${rest%%\'*}"
  token="$token$span"
  rest="${rest:$((${#span} + 1))}"
}

lex_take_double_quoted() {
  local chunk char
  while [ -n "$rest" ]; do
    chunk="${rest%%[$LEX_QUOTED_SPECIAL_CHARS]*}"
    if [ -n "$chunk" ]; then
      token="$token$chunk"
      rest="${rest:${#chunk}}"
      continue
    fi
    char="${rest:0:1}"
    rest="${rest:1}"
    case "$char" in
      '"') return 0 ;;
      '\') token="$token${rest:0:1}"; rest="${rest:1}" ;;
      '$') lex_take_expansion ;;
      '`') lex_take_backtick ;;
    esac
  done
}

# $( … ) is a command list; ${ … } is only the value of a name, and it keeps its
# braces so the closing one is never read as the end of a block. Either way the
# "$" stays in the word: a command word only the shell can resolve — `$g commit`
# and `$(echo git) commit` alike — has to reach the gate looking unresolved.
lex_take_expansion() {
  case "$rest" in
    '('*)
      token="$token\$"
      rest="${rest:1}"
      lex_take_substitution_body
      lex_defer_nested_commands "$lex_span"
      ;;
    '{'*)
      local span="${rest%%\}*}"
      token="$token\$$span}"
      rest="${rest:$((${#span} + 1))}"
      ;;
    *) token="$token\$" ;;
  esac
}

# Nesting is counted, so $(git log $(date)) hands over its whole body.
lex_take_substitution_body() {
  local nesting=1 chunk char
  lex_span=""
  while [ -n "$rest" ]; do
    chunk="${rest%%[()]*}"
    lex_span="$lex_span$chunk"
    rest="${rest:${#chunk}}"
    char="${rest:0:1}"
    rest="${rest:1}"
    if [ "$char" = '(' ]; then
      nesting=$((nesting + 1))
      lex_span="$lex_span("
    elif [ "$char" = ')' ]; then
      nesting=$((nesting - 1))
      if [ "$nesting" -eq 0 ]; then
        return 0
      fi
      lex_span="$lex_span)"
    fi
  done
}

# A backtick is $( … ) in the older spelling, so it leaves the word the same mark:
# `` `echo git` commit `` is as unresolved as `$(echo git) commit`, and a word the
# mark never reached came out looking like a literal command word.
lex_take_backtick() {
  local span="${rest%%\`*}"
  token="$token\$"
  rest="${rest:$((${#span} + 1))}"
  lex_defer_nested_commands "$span"
}

# A "#" that starts a word comments out the rest of the line, including a commit
# somebody left in a note. The newline stays for the command handling.
lex_drop_comment() {
  local comment="${rest%%$'\n'*}"
  rest="${rest:${#comment}}"
}

# `2>&1`, `&>log`, `>>out`, `>|out` and `<in` are one redirect each: the operator
# is not a new command, and the word behind it is a file or a descriptor, never a
# verb. In front of the command word that word would BECOME the command word —
# `>out.txt git commit` would read as a call to `out.txt`, and every predicate
# downstream would answer about the file — so the target is dropped instead of
# walked into the command's words. The descriptor a redirect starts with is a word
# of its own and stays: `2` is stripped as a count, the way a wrapper's words are.
lex_take_redirect() {
  redirect_target_pending=1
  while :; do
    case "${rest:0:1}" in
      '>'|'&'|'|') rest="${rest:1}" ;;
      *) return 0 ;;
    esac
  done
}

# `<<EOF` queues a body, `<<<` feeds a word, and a plain `<` — `<in`, `<>rw`,
# `<&3` — names what the command reads: the body belongs to whichever program
# reads it, the word is a command line waiting to run, and the file name is no
# word of the command.
lex_take_input_redirect() {
  local strip_marker=""
  case "$rest" in
    '<<'*)
      rest="${rest:2}"
      lex_end_token
      herestring_pending=1
      ;;
    '<'*)
      rest="${rest:1}"
      case "$rest" in '-'*) strip_marker='-'; rest="${rest:1}" ;; esac
      lex_take_heredoc_delimiter
      pending_heredocs="$pending_heredocs$strip_marker$lex_span"$'\n'
      ;;
    *) lex_end_token; lex_take_redirect ;;
  esac
}

# `<<EOF`, `<<-EOF` and `<<'EOF'` all name the same delimiter: quoting it only
# decides whether the body expands, never whether the body is data.
lex_take_heredoc_delimiter() {
  local chunk
  lex_span=""
  while [ -n "$rest" ]; do
    case "$rest" in
      ' '*|$'\t'*)
        if [ -n "$lex_span" ]; then
          return 0
        fi
        rest="${rest:1}"
        continue
        ;;
    esac
    chunk="${rest%%[$LEX_SPECIAL_CHARS]*}"
    if [ -n "$chunk" ]; then
      lex_span="$lex_span$chunk"
      rest="${rest:${#chunk}}"
      continue
    fi
    case "$rest" in
      \'*|\"*|'\'*) rest="${rest:1}" ;;
      *) return 0 ;;
    esac
  done
}

# The body is data for the program that reads stdin — unless that program is a
# shell, and then every line of it is a command this line runs. Data nobody read
# as commands still goes out with the command that was handed it: what a python
# heredoc does with git is undecidable, and the text is all a gate can see.
lex_take_heredoc_bodies() {
  local delimiter strips_tabs
  if [ -z "$pending_heredocs" ]; then
    return 0
  fi
  # `sudo bash <<EOF` feeds a shell; `grep -l bash *.sh <<EOF` only names one. So
  # the reader is this command's command word, never any word on the line.
  lex_strip_command_prefixes
  while [ -n "$pending_heredocs" ]; do
    delimiter="${pending_heredocs%%$'\n'*}"
    pending_heredocs="${pending_heredocs#*$'\n'}"
    strips_tabs=0
    case "$delimiter" in '-'*) strips_tabs=1; delimiter="${delimiter#-}" ;; esac
    if [ "$strips_tabs" = 1 ] || ! lex_take_body_to_terminator "$delimiter"; then
      lex_take_body_by_lines "$delimiter" "$strips_tabs"
    fi
    if is_shell_interpreter "${command_tokens[0]:-}"; then
      lex_defer_nested_commands "$lex_span"
    else
      unread_stdin="$unread_stdin$lex_span"
    fi
  done
}

# One heredoc can carry a whole file, so the terminator line is worth finding in
# a single match: a hook runs before every call. An empty body has no line ahead
# of its terminator and `<<-` lets that line wear tabs, so both land below.
lex_take_body_to_terminator() {
  local delimiter="$1"
  lex_span="${rest%%$'\n'"$delimiter"$'\n'*}"
  if [ "$lex_span" = "$rest" ]; then
    return 1
  fi
  rest="${rest:$((${#lex_span} + ${#delimiter} + 2))}"
}

lex_take_body_by_lines() {
  local delimiter="$1" strips_tabs="$2" line probe
  lex_span=""
  while [ -n "$rest" ]; do
    line="${rest%%$'\n'*}"
    rest="${rest:$((${#line} + 1))}"
    probe="$line"
    if [ "$strips_tabs" = 1 ]; then
      while [ "${probe:0:1}" = $'\t' ]; do
        probe="${probe:1}"
      done
    fi
    if [ "$probe" = "$delimiter" ]; then
      return 0
    fi
    lex_span="$lex_span$line"$'\n'
  done
}

# The words a line puts in front of the command it runs: assignments, flags and
# counts by shape, wrappers and block keywords by name.
is_command_prefix_word() {
  case "$1" in
    [A-Za-z_]*=*|-*) return 0 ;;
    # Not all digits, so not a count — the empty arm stops ?* from claiming it.
    *[!0-9]*) ;;
    ?*) return 0 ;;
  esac
  case "${1##*/}" in
    env|command|builtin|exec|nice|nohup|time|timeout|stdbuf|sudo|doas|setsid|xargs) return 0 ;;
    flock|ionice|chrt|taskset|unbuffer) return 0 ;;
    'then'|'else'|'elif'|'do'|'done'|'fi'|'in'|'until'|'while'|'if'|'for') return 0 ;;
    'case'|'esac'|'select'|'function'|'!') return 0 ;;
  esac
  return 1
}

# A shell reads its -c payload, its herestring and its heredoc body as commands.
is_shell_interpreter() {
  case "${1##*/}" in
    bash|sh|dash|zsh|ksh) return 0 ;;
  esac
  return 1
}

# `source f` and `. f` run the file's commands in this very shell. A builtin is
# never spelled with a path, so the word answers as written.
is_sourcing_builtin() {
  case "$1" in
    source|.) return 0 ;;
  esac
  return 1
}
