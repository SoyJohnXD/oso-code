# What every oso-code gate shares: reading its payload, resolving session state,
# writing its verdict, recording the event. Bash only — jq is used where the
# platform has it and never required.

# Sourced here rather than by the one gate that lexes, because json_command_line
# below measures its payload against the lexer's own bound: whoever reads lib.sh
# needs the lexer's constants too, and every consumer keeps one source line.
. "$(dirname "${BASH_SOURCE[0]}")/lexer.sh"

# jq is worth using and never worth requiring: `claude plugin install` from the
# marketplace never runs install.sh, and a GUI-launched macOS client has no
# /opt/homebrew/bin, so failing closed on a missing jq would deny every call of
# every session on those machines.
if command -v jq >/dev/null 2>&1; then
  JSON_READER=jq
else
  JSON_READER=pattern
fi

# The command line a gate judges, decoded — unless it is longer than the lexer
# reads at all, and then its escaping stands. json_unescape has the lexer's cost
# shape and runs ahead of the lexer's bound, so the payload no gate will read is
# the payload nothing decodes. Escaped bytes are never fewer than the bytes they
# decode to, so the measure needs no reader: an over-bound line comes back
# undecoded whether or not jq is installed, and the lexer turns it into the same
# residue as any other line past the bound.
json_command_line() {
  local json="$1" escaped
  json_take_escaped_field "$json" command
  if [ "${#escaped}" -gt "$LEX_MAX_INPUT_BYTES" ]; then
    printf '%s' "$escaped"
    return 0
  fi
  json_field "$json" command
}

# Extracts a string field from the hook's stdin JSON, decoded: callers get the
# text the client sent, not its escaping. Field names used here (session_id,
# command) are unique in hook input, so the search is by name.
json_field() {
  local json="$1" field="$2" escaped value
  if [ "$JSON_READER" = jq ]; then
    value="$(printf '%s' "$json" | jq -r --arg field "$field" \
      'first(.. | objects | .[$field]? | select(type == "string")) // empty' 2>/dev/null || true)"
  else
    json_take_escaped_field "$json" "$field"
    value="$(json_unescape "$escaped")"
  fi
  value="${value//$'\r\n'/$'\n'}"
  printf '%s' "${value%$'\r'}"
}

# The field as the client wrote it, escapes and all, into $escaped: sizing a
# payload has to cost about nothing and to answer the same on either reader.
json_take_escaped_field() {
  local json="$1" field="$2"
  local pattern="\"${field}\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  escaped=""
  if [[ "$json" =~ $pattern ]]; then
    escaped="${BASH_REMATCH[1]}"
  fi
}

# One left-to-right pass, because rewriting the escapes one kind at a time makes
# \\n (a backslash the client escaped, then an n) read as a newline. The cursor
# counts bytes: matching a pattern that is itself a long string costs bash
# quadratic time, and a UTF-8 locale makes every move walk characters instead.
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

# Codex names this hook field `permission_mode`, but 0.146 derives it from the
# approval policy rather than the native collaboration mode: an `on-request`
# Plan turn therefore arrives as `default`. The same payload carries the exact
# turn id and rollout path. Bind those two host values to the rollout's
# host-generated task_started event before falling back to the documented field.
#
# The rollout format is not a stable public hook interface, so this compatibility
# path is deliberately narrow: one regular non-symlinked transcript, its own
# session header, one exact task_started event for this turn, and one of the two
# collaboration modes Oso understands. User text cannot imitate the event line:
# quotes inside response content are JSON-escaped, while the fixed-string probes
# below require unescaped host object fields. When Codex starts reporting `plan`
# truthfully, the documented payload remains the fallback if its rollout shape
# changes or transcript persistence is disabled.
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
      # More than one event for one turn is ambiguous, not "latest wins".
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
      "$LEX_UNREAD_PAYLOAD_MARKER") if [ "$verdict" = clear ]; then verdict=residue; fi ;;
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

# Session ids become file names — strip anything that could traverse paths.
sanitize_session() {
  printf '%s' "$1" | tr -cd 'a-zA-Z0-9-'
}

# Codex exposes its hook session id only in the event payload, not to the model
# that runs oso-state. Its installer therefore publishes one fixed agent marker
# to both tool subprocesses and user hooks. Claude has no OSO_AGENT marker and
# keeps using its native payload session id.
hook_session() {
  local payload="$1" raw
  raw="${OSO_AGENT:-$(json_field "$payload" session_id)}"
  sanitize_session "$raw"
}

# The state of the work done in a directory, under the name of the REPOSITORY
# that work belongs to: the main checkout, a linked worktree and a subdirectory
# of either all answer one name, which is what lets the gate firing in a wave's
# worktree read the state the orchestrator armed in the main checkout.
# `--git-common-dir` alone does not say that — it answers a relative `.git` in
# the main checkout and an absolute path inside a linked worktree, one repository
# under two names — so the identity is the absolute spelling. Where git places
# nothing there is no commit for the rail to gate, and the directory the work
# happens in is identity enough.
#
# That path is DIGESTED, never sanitized into a name. A file name has a charset
# and a length a path has not, and forcing a path into either opens the gate:
# translating each byte outside `[a-zA-Z0-9-]` to a dash — a byte already inside
# it — gives `my_app`, `my-app`, `my app` and `my.app` one name, so a red
# repository reads its neighbour's `verify_green=true`, while a repository nested
# past NAME_MAX gets no writable name at all, so a red repository reads no state
# and the gate stays invisible. A digest is fixed-length hex, so it needs no
# sanitizing against traversal either; GNU coreutils and macOS spell it the two
# ways `seconds_since_modified` below spells one mtime, and a host that answers
# neither blocks rather than filing every repository under one name.
#
# The trailing carriage return json_field already drops is dropped here too,
# because this is the choke point where one costs most rather than a little:
# `git -C` cannot open a directory whose name ends in CR, so `identity` comes
# back empty and the fallback below digests the CR-bearing path itself — the
# same repository under a second name, which is the split the digest exists to
# prevent. Any future caller that resolves a directory some other way is covered
# by that alone.
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

# One key out of a state file. The key=value format is one thing to know, so
# `oso-state get` and the teardown that has no directory to resolve a file from
# read it in one place instead of each parsing the file its own way.
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

# The `oso-state` half of a deny's remedy, spelled once so the binary and
# the real session id are never retyped per gate — the shape deny_unusable_state
# already used before this slice. Composed straight into deny()'s own `reason`
# argument at the call site, never into `detail`: `detail` reaches the audit log's
# `command` field and nothing else, and the JSON permissionDecisionReason is the
# only thing either host ever shows past a deny, so a remedy living in `detail`
# would reach nobody. Not every remedy is one exact state write — "run the
# checks", "use one of these tools" are named flows or facts a gate already
# holds, composed as plain reason text instead — so this helper has no reach
# past the remedies that ARE a single `oso-state` call.
oso_state_remedy() {
  local session="$1" verb_and_args="$2"
  printf 'oso-state --session %s %s' "$session" "$verb_and_args"
}

# GNU and BSD stat spell mtime differently, and a file whose mtime neither can
# read gets no age at all rather than a guessed one: each caller decides what its
# own threshold makes of an unanswered age.
seconds_since_modified() {
  local path="$1" mtime now
  mtime="$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null)" || true
  [ -n "$mtime" ] || return 1
  now="$(date +%s)"
  printf '%s' "$((now - mtime))"
}

# A gate can only judge a session it can name, so an envelope it cannot parse
# passes — recorded, or the next payload-shape change goes unnoticed.
require_session() {
  local session="$1"
  if [ -n "$session" ]; then
    return 0
  fi
  log_event payload-unparseable "" || true
  exit 0
}

# No state file means no oso-code mode ever armed this session: the gates stay
# invisible for it, forever — no verdict, no event, no state directory, nothing
# on stderr. A path that exists but is not a readable regular file is an armed
# session the gate cannot read — it denies instead of guessing.
require_readable_state() {
  local state_file="$1" session="$2"
  [ -e "$state_file" ] || exit 0
  [ -f "$state_file" ] && [ -r "$state_file" ] || deny_unusable_state "$state_file" "$session"
}

# A gate reading its envelope by pattern is a degraded gate, and a fallback
# nobody can see in the log is a fallback nobody ever fixes. It is recorded only
# once the session is known to be armed: on a machine that merely has the plugin
# installed, one event per call would be the whole invisibility promise broken.
record_reader_fallback() {
  local session="$1"
  if [ "$JSON_READER" = pattern ]; then
    log_event jq-absent "$session" || true
  fi
}

# grep separates "no match" (1) from "could not read the file" (2); only the
# first answers a question about the session, so the second denies. SESSION
# names who to blame in that unreadable-state error by default; a caller that
# passes OWNER_KEY makes it do double duty as the identity the pattern must
# also belong to, by requiring that key's stored value to be this exact
# session — a stale or foreign fact the pattern alone cannot tell apart from
# this session's own.
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

# Both commit layers reach this verdict: the PreToolUse matcher on the command line
# and the git pre-commit hook at the commit itself. They differ only in the channel
# deny writes to, so the reason the operator reads and the event the audit records
# live here rather than in each. The command line is the one thing only the
# PreToolUse layer has to give the audit — the git layer's own deny_until_green
# call has no command to name, so its event keeps the empty detail it always had.
#
# The remedy is the active mode's own step, read off `mode` in the same
# state file both layers already resolved — never a two- or three-way menu the
# operator has to translate, and never the write (`verify_green=true`) that
# would flip the flag itself: that write belongs to the checks actually running
# clean, not to a shortcut this text could be copied into. A mode this gate
# cannot read (missing, or a future one the case below has not met yet) falls
# back to naming every route rather than guessing one.
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

# The client only reads a hook's JSON when the hook exits 0, so the verdict goes
# out before anything that can fail, and telemetry can never retract it.
#
# Every caller of this function is a PreToolUse matcher — Codex's catch-all, the
# slice gate, the commit gate — so hookEventName is one literal, not a guess per
# caller, and the audit line below reuses the exact value the client already read.
deny() {
  local reason="$1" event="$2" session="$3" detail="${4:-}"
  local hook_event=PreToolUse
  printf '{"hookSpecificOutput":{"hookEventName":"%s","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
    "$hook_event" "$(json_escape "$reason")"
  trap - ERR
  log_event "$event" "$session" "$detail" "${0##*/}" "$hook_event" || true
  exit 0
}

# The client ignores a hook's JSON when it exits 2, so this channel replaces a
# verdict and must never follow one: gates arm it only where they have already
# decided the call is theirs, and drop it the moment a verdict is out.
#
# No remedy rides here, and the text says so rather than implying one:
# every caller is a crash mid-gate or a malformed installer config (a missing
# sha256sum, an empty or invalid Codex allowlist argument) — one class of
# failure with no single operator-actionable fix, unlike a deny's own reason.
block_with_gate_error() {
  printf 'oso-code: %s failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.\n' "$1" >&2
  exit 2
}

# Bumped only when a field is added or its meaning changes. events.jsonl rotates
# on a 30-day mtime, not on release, so a schema-2 line and every schema-1 line
# written before this slice sit in the same file for as long as that window —
# a consumer reads this field rather than guessing a shape from which keys
# happen to be present.
EVENTS_SCHEMA_VERSION=2

# One JSONL line per gate event so the team can audit whether gates ever fire.
# An event can carry command text, which carries whatever a command line carries,
# so the log is created as private as the state files: owner-only, the mode
# mktemp gives oso-state's writes. A log that cannot be written falls back to
# stderr: telemetry cannot record a storage failure into the storage that failed.
#
# `gate` and `hook_event` are optional and additive, never inserted between the
# schema-1 fields: state-mutation events (oso-state's own `set`/`event` verbs,
# the residue-allowed count) pass neither and keep the exact line shape schema 1
# had, which is what keeps the event-log size budget (tests/hooks-test.sh) from
# growing for the highest-volume, longest-command lines. Only a `deny` — the
# record this slice exists to make diagnosable without the UI — pays for the
# two extra fields.
log_event() {
  local event="$1" session="$2" command="${3:-}" gate="${4:-}" hook_event="${5:-}"
  # The native install runs from a directory named after the client version —
  # the only free handle on the platform drift that breaks gates silently.
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

# All an event records of a command line: the head tells one residue shape from
# another, and a command line carries whatever secrets its author typed. The cut
# counts bytes, so a UTF-8 character can straddle it, and a half-written character
# is a line a strict JSONL parser rejects — so a cut that lands on a continuation
# byte (0x80-0xBF) drops back to the byte that starts the character (0xC0 and up).
LOG_COMMAND_HEAD_BYTES=120

command_head() {
  local LC_ALL=C
  local head="${1:0:$LOG_COMMAND_HEAD_BYTES}"
  case "${1:$LOG_COMMAND_HEAD_BYTES:1}" in
    [$'\x80'-$'\xbf']) head="${head%[$'\xc0'-$'\xff']*}" ;;
  esac
  printf '%s' "$head"
}

# A raw backslash, quote, or control byte in a value breaks this line and every
# line a parser reads after it: JSON forbids U+0000-U+001F unescaped, and
# json_unescape hands a gate exactly those bytes back for the escapes it decodes,
# so a tab in a command line reaches the log without a hostile author.
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

# JSON names an escape for five control bytes and spells every other one \u00XX,
# one at a time. Every logged event pays for this, so the walk runs only for a
# value the five named escapes left a control byte in — every other line pays one
# pattern test. A bash string cannot hold U+0000, so the range starts at U+0001.
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
