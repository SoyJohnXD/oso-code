# What every oso-code gate shares: reading its payload, resolving session state,
# writing its verdict, recording the event. Bash only — jq is used where the
# platform has it and never required.

. "$(dirname "${BASH_SOURCE[0]}")/lexer.sh"

if command -v jq >/dev/null 2>&1; then
  JSON_READER=jq
else
  JSON_READER=pattern
fi

json_command_line() {
  local json="$1" escaped
  json_take_escaped_field "$json" command
  if [ "${#escaped}" -gt "$LEX_MAX_INPUT_BYTES" ]; then
    printf '%s' "$escaped"
    return 0
  fi
  json_field "$json" command
}

json_field() {
  local json="$1" field="$2" escaped value
  if [ "$JSON_READER" = jq ]; then
    value="$(printf '%s' "$json" | jq -r --arg field "$field" \
      'first(.. | objects | .[$field]? | select(type == "string")) // empty' 2>/dev/null || true)"
  else
    json_take_escaped_field "$json" "$field"
    value="$(json_unescape "$escaped")"
  fi
  while [ "$value" != "${value//$'\r\n'/$'\n'}" ]; do
    value="${value//$'\r\n'/$'\n'}"
  done
  printf '%s' "${value%$'\r'}"
}

json_take_escaped_field() {
  local json="$1" field="$2"
  local pattern="\"${field}\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  escaped=""
  if [[ "$json" =~ $pattern ]]; then
    escaped="${BASH_REMATCH[1]}"
  fi
}

json_unescape() {
  local rest="$1" decoded="" text escape
  local LC_ALL=C
  while [ -n "$rest" ]; do
    text="${rest%%\\*}"
    if [ "$text" = "$rest" ]; then
      printf '%s' "$decoded$rest"
      return 0
    fi
    decoded="$decoded$text"
    rest="${rest:$((${#text} + 1))}"
    escape="${rest:0:1}"
    rest="${rest:1}"
    case "$escape" in
      n) decoded="$decoded"$'\n' ;;
      t) decoded="$decoded"$'\t' ;;
      r) decoded="$decoded"$'\r' ;;
      b) decoded="$decoded"$'\b' ;;
      f) decoded="$decoded"$'\f' ;;
      *) decoded="$decoded$escape" ;;
    esac
  done
  printf '%s' "$decoded"
}

resolve_codex_turn_mode() {
  local payload="$1" permission_mode transcript_path turn_id raw_session_id
  local meta meta_session candidate candidate_turn mode
  local transcript_rejected=false

  CODEX_TURN_MODE=unknown
  CODEX_TURN_MODE_SOURCE=unavailable
  permission_mode="$(json_field "$payload" permission_mode)"
  transcript_path="$(json_field "$payload" transcript_path)"
  turn_id="$(json_field "$payload" turn_id)"
  raw_session_id="$(json_field "$payload" session_id)"

  if [ -n "$transcript_path" ] &&
     { [ ! -f "$transcript_path" ] || [ ! -r "$transcript_path" ] ||
       [ -L "$transcript_path" ]; }; then
    transcript_rejected=true
  elif [ -n "$transcript_path" ] && [ -n "$turn_id" ] &&
       [ -n "$raw_session_id" ]; then
    meta="$(head -n 1 "$transcript_path" 2>/dev/null || true)"
    meta_session="$(json_field "$meta" session_id)"
    if [ "$meta_session" = "$raw_session_id" ]; then
      case "$meta" in
        *'"type":"session_meta"'*) ;;
        *) meta_session="" ;;
      esac
    elif [ -n "$meta_session" ]; then
      transcript_rejected=true
    fi
    if [ "$transcript_rejected" = false ] && [ -n "$meta_session" ]; then
      candidate="$(
        grep -F '"type":"event_msg"' "$transcript_path" 2>/dev/null |
          grep -F '"type":"task_started"' |
          grep -F "\"turn_id\":\"${turn_id}\"" |
          grep -F '"collaboration_mode_kind":"' || true
      )"
      case "$candidate" in
        '') ;;
        *$'\n'*) transcript_rejected=true ;;
        *)
          candidate_turn="$(json_field "$candidate" turn_id)"
          mode="$(json_field "$candidate" collaboration_mode_kind)"
          if [ "$candidate_turn" = "$turn_id" ]; then
            case "$mode" in
              plan|default)
                CODEX_TURN_MODE="$mode"
                CODEX_TURN_MODE_SOURCE=transcript
                return 0
                ;;
              *) transcript_rejected=true ;;
            esac
          else
            transcript_rejected=true
          fi
          ;;
      esac
    fi
  fi

  [ "$transcript_rejected" = false ] || return 0

  case "$permission_mode" in
    plan)
      CODEX_TURN_MODE=plan
      CODEX_TURN_MODE_SOURCE=permission_mode
      ;;
    default|acceptEdits|dontAsk|bypassPermissions)
      CODEX_TURN_MODE=default
      CODEX_TURN_MODE_SOURCE=permission_mode
      ;;
  esac
}

line_verdict() {
  local command_line="$1" judge="$2"
  local record verdict=clear command_stdin=""
  local -a command_tokens=()
  while IFS= read -r record; do
    case "$record" in
      "$LEX_UNREAD_PAYLOAD_MARKER") if [ "$verdict" = clear ]; then verdict=unread; fi ;;
      '>'*) "$judge"; command_tokens=("${record#>}"); command_stdin="" ;;
      '.'*) command_tokens+=("${record#.}") ;;
      '<'*) command_stdin="$command_stdin${record#<}" ;;
    esac
  done <<< "$(shell_commands "$command_line")"
  "$judge"
  printf '%s' "$verdict"
}

GIT_VERB_UNRESOLVED='?'

is_git_call() {
  if [ "${#command_tokens[@]}" -eq 0 ]; then
    return 1
  fi
  case "${command_tokens[0]##*/}" in
    git|git.exe) return 0 ;;
  esac
  return 1
}

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

git_option_takes_a_value() {
  case "$1" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source) return 0 ;;
  esac
  return 1
}

git_option_prints_and_exits() {
  case "$1" in
    -h|--help|-v|--version) return 0 ;;
    --exec-path|--html-path|--man-path|--info-path) return 0 ;;
  esac
  return 1
}

git_option_stands_alone() {
  case "$1" in
    -p|-P|--paginate|--no-pager|--bare) return 0 ;;
    --no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice) return 0 ;;
    --literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs) return 0 ;;
  esac
  return 1
}

is_residue_call() {
  local subjects="$1"
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
  is_interpreter_handed_a_subject "$subjects"
}

is_interpreter_handed_a_subject() {
  local subjects="$1" interpreter="${command_tokens[0]##*/}" index=1
  case "${interpreter%%[0-9]*}" in
    python|node|perl|ruby|php) ;;
    *) return 1 ;;
  esac
  while [ "$index" -lt "${#command_tokens[@]}" ]; do
    if mentions_a_subject "${command_tokens[$index]}" "$subjects"; then
      return 0
    fi
    index=$((index + 1))
  done
  mentions_a_subject "$command_stdin" "$subjects"
}

mentions_a_subject() {
  local text="$1" subjects="$2" subject
  for subject in $subjects; do
    case "$text" in
      *"$subject"*) return 0 ;;
    esac
  done
  return 1
}

OSO_STATE_DIR="${HOME}/.local/state/oso-code"

sanitize_session() {
  printf '%s' "$1" | tr -cd 'a-zA-Z0-9-'
}

hook_session() {
  local payload="$1" raw
  raw="${OSO_AGENT:-$(json_field "$payload" session_id)}"
  sanitize_session "$raw"
}

state_file_for() {
  local directory="${1%$'\r'}" identity digest
  identity="$(git -C "$directory" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || identity=""
  digest="$(printf '%s' "${identity:-$directory}" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || digest=""
  digest="${digest%% *}"
  [ -n "$digest" ] ||
    block_with_gate_error "naming this repository's state (no sha256sum, no shasum)"
  printf '%s/%s.state' "$OSO_STATE_DIR" "$digest"
}

state_value() {
  local state_file="$1" key="$2"
  grep "^${key}=" "$state_file" 2>/dev/null | cut -d= -f2- || true
}

journal_file_for() {
  local directory="$1" state_file repository auto_change change=run
  state_file="$(state_file_for "$directory")"
  repository="${state_file##*/}"
  repository="${repository%.state}"
  auto_change="$(state_value "$state_file" auto_change)"
  if [[ "$auto_change" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]]; then
    change="$auto_change"
  fi
  printf '%s/runs/%s/%s.log' "$OSO_STATE_DIR" "$repository" "$change"
}

unattended_run_marker() {
  local state_file="$1" session="$2"
  [ -f "$state_file" ] && [ -r "$state_file" ] || return 1
  [ "$(state_value "$state_file" session)" = "$session" ] || return 1
  state_value "$state_file" auto
}

oso_state_remedy() {
  local session="$1" verb_and_args="$2"
  printf 'oso-state --session %s %s' "$session" "$verb_and_args"
}

seconds_since_modified() {
  local path="$1" mtime now
  mtime="$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null)" || true
  [ -n "$mtime" ] || return 1
  now="$(date +%s)"
  printf '%s' "$((now - mtime))"
}

require_session() {
  local session="$1"
  if [ -n "$session" ]; then
    return 0
  fi
  log_event payload-unparseable "" || true
  exit 0
}

require_readable_state() {
  local state_file="$1" session="$2"
  [ -e "$state_file" ] || exit 0
  [ -f "$state_file" ] && [ -r "$state_file" ] || deny_unusable_state "$state_file" "$session"
}

record_reader_fallback() {
  local session="$1"
  if [ "$JSON_READER" = pattern ]; then
    log_event jq-absent "$session" || true
  fi
}

state_says() {
  local state_file="$1" pattern="$2" session="$3" owner_key="${4:-}"
  local rc=0
  grep -q "$pattern" "$state_file" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || deny_unusable_state "$state_file" "$session"
  if [ "$rc" -eq 0 ] && [ -n "$owner_key" ]; then
    [ "$(state_value "$state_file" "$owner_key")" = "$session" ] || rc=1
  fi
  return "$rc"
}

deny_unusable_state() {
  local state_file="$1" session="$2"
  deny "oso-code: this session is armed but its state file (${state_file}) cannot be read, so the gate cannot tell whether this call is safe. Remove or repair it ($(oso_state_remedy "$session" clear)), then retry." \
    state-unreadable "$session"
}

deny_until_green() {
  local session="$1" state_file="$2" command="${3:-}"
  local mode remedy
  mode="$(state_value "$state_file" mode)"
  case "$mode" in
    plan) remedy="Resume plan mode's apply → verify loop until the verifier returns pass" ;;
    quick) remedy="Finish quick mode's close step — run the project's checks to zero warnings" ;;
    debug) remedy="Finish debug mode's close step — run the quality-pass judge to zero warnings" ;;
    *) remedy="Finish the active mode's checks to zero warnings — plan mode's apply → verify loop, or quick/debug mode's close step" ;;
  esac
  deny "oso-code: the session verify is not green. ${remedy}, then retry the commit." \
    commit-denied "$session" "$command"
}

deny() {
  local reason="$1" event="$2" session="$3" detail="${4:-}"
  local hook_event=PreToolUse
  printf '{"hookSpecificOutput":{"hookEventName":"%s","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
    "$hook_event" "$(json_escape "$reason")"
  trap - ERR
  log_event "$event" "$session" "$detail" "${0##*/}" "$hook_event" || true
  exit 0
}

block_with_gate_error() {
  printf 'oso-code: %s failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.\n' "$1" >&2
  exit 2
}

EVENTS_SCHEMA_VERSION=2

log_event() {
  local event="$1" session="$2" command="${3:-}" gate="${4:-}" hook_event="${5:-}"
  local client="${CLAUDE_CODE_EXECPATH:-}"
  client="${client##*/}"
  local line
  line="$(printf '{"ts":"%s","event":"%s","command":"%s","session":"%s","client":"%s","schema":%s' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_escape "$event")" \
    "$(json_escape "$(command_head "$command")")" \
    "$(json_escape "$session")" "$(json_escape "$client")" "$EVENTS_SCHEMA_VERSION")"
  [ -z "$gate" ] || line="${line},\"gate\":\"$(json_escape "$gate")\""
  [ -z "$hook_event" ] || line="${line},\"hook_event\":\"$(json_escape "$hook_event")\""
  line="${line}}"
  mkdir -p "$OSO_STATE_DIR" 2>/dev/null || true
  ( umask 077; printf '%s\n' "$line" 2>/dev/null >> "$OSO_STATE_DIR/events.jsonl" ) ||
    printf '%s\n' "$line" >&2
}

LOG_COMMAND_HEAD_BYTES=120

command_head() {
  local LC_ALL=C
  local head="${1:0:$LOG_COMMAND_HEAD_BYTES}"
  case "${1:$LOG_COMMAND_HEAD_BYTES:1}" in
    [$'\x80'-$'\xbf']) head="${head%[$'\xc0'-$'\xff']*}" ;;
  esac
  printf '%s' "$head"
}

json_escape() {
  local value="$1"
  local LC_ALL=C
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  case "$value" in
    *[$'\x01'-$'\x1f']*) escape_unnamed_control_bytes "$value" ;;
    *) printf '%s' "$value" ;;
  esac
}

escape_unnamed_control_bytes() {
  local rest="$1" escaped="" text point
  local LC_ALL=C
  while [ -n "$rest" ]; do
    text="${rest%%[$'\x01'-$'\x1f']*}"
    if [ "$text" = "$rest" ]; then
      printf '%s' "$escaped$rest"
      return 0
    fi
    escaped="$escaped$text"
    rest="${rest:${#text}}"
    printf -v point '\\u%04x' "'${rest:0:1}"
    escaped="$escaped$point"
    rest="${rest:1}"
  done
  printf '%s' "$escaped"
}
