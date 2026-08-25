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

LEX_SPECIAL_CHARS=$'\'"\\\\$`#;&|(){}<> \t\n'
LEX_QUOTED_SPECIAL_CHARS=$'"\\\\$`'
LEX_UNREAD_PAYLOAD_MARKER='!unread-payload'
LEX_MAX_PAYLOAD_DEPTH=3

LEX_MAX_INPUT_BYTES=3072

shell_commands() {
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
  if [ "$token_open" = 1 ] && [ "$redirect_target_pending" = 1 ]; then
    redirect_target_pending=0
  elif [ "$token_open" = 1 ]; then
    command_tokens+=("$token")
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

lex_strip_command_prefixes() {
  local prefix_word="" stdin_completes_the_words=0
  while [ "${#command_tokens[@]}" -gt 0 ]; do
    if ! is_command_prefix_word "${command_tokens[0]}"; then
      case "$prefix_word" in -*) lex_mark_unread ;; esac
      if [ "$stdin_completes_the_words" = 1 ]; then
        unread_stdin="$unread_stdin$LEX_UNREAD_PAYLOAD_MARKER"
      fi
      return 0
    fi
    prefix_word="${command_tokens[0]}"
    if completes_its_words_from_stdin "$prefix_word"; then
      stdin_completes_the_words=1
    fi
    command_tokens=("${command_tokens[@]:1}")
  done
}

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
  if [ -z "$nested" ]; then
    lex_mark_unread
  fi
}

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

lex_mark_unread() {
  nested="$nested$LEX_UNREAD_PAYLOAD_MARKER"$'\n'
}

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

lex_take_backtick() {
  local span="${rest%%\`*}"
  token="$token\$"
  rest="${rest:$((${#span} + 1))}"
  lex_defer_nested_commands "$span"
}

lex_drop_comment() {
  local comment="${rest%%$'\n'*}"
  rest="${rest:${#comment}}"
}

lex_take_redirect() {
  redirect_target_pending=1
  while :; do
    case "${rest:0:1}" in
      '>'|'&'|'|') rest="${rest:1}" ;;
      *) return 0 ;;
    esac
  done
}

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

lex_take_heredoc_bodies() {
  local delimiter strips_tabs
  if [ -z "$pending_heredocs" ]; then
    return 0
  fi
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

is_command_prefix_word() {
  case "$1" in
    [A-Za-z_]*=*|-*) return 0 ;;
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

completes_its_words_from_stdin() {
  case "${1##*/}" in
    xargs) return 0 ;;
  esac
  return 1
}

is_shell_interpreter() {
  case "${1##*/}" in
    bash|sh|dash|zsh|ksh) return 0 ;;
  esac
  return 1
}

is_sourcing_builtin() {
  case "$1" in
    source|.) return 0 ;;
  esac
  return 1
}
