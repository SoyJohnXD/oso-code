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
  local json="$1" field="$2" escaped
  if [ "$JSON_READER" = jq ]; then
    printf '%s' "$json" | jq -r --arg field "$field" \
      'first(.. | objects | .[$field]? | select(type == "string")) // empty' 2>/dev/null || true
    return 0
  fi
  json_take_escaped_field "$json" "$field"
  json_unescape "$escaped"
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
# under two names — so the identity is the absolute spelling (ADR-0095). Where
# git places nothing there is no commit for the rail to gate, and the directory
# the work happens in is identity enough.
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
state_file_for() {
  local directory="$1" identity digest
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
# first answers a question about the session, so the second denies.
state_says() {
  local state_file="$1" pattern="$2" session="$3"
  local rc=0
  grep -q "$pattern" "$state_file" 2>/dev/null || rc=$?
  [ "$rc" -le 1 ] || deny_unusable_state "$state_file" "$session"
  return "$rc"
}

deny_unusable_state() {
  local state_file="$1" session="$2"
  deny "oso-code: this session is armed but its state file (${state_file}) cannot be read, so the gate cannot tell whether this call is safe. Remove or repair it (oso-state --session ${session} clear), then retry." \
    state-unreadable "$session"
}

# Both commit layers reach this verdict: the PreToolUse matcher on the command line
# and the git pre-commit hook at the commit itself. They differ only in the channel
# deny writes to, so the reason the operator reads and the event the audit records
# live here rather than in each.
deny_until_green() {
  local session="$1"
  deny "oso-code: the session verify is not green. Run the verify loop (plan mode) or the quality pass (quick mode) to zero warnings — it sets verify_green=true — then commit." \
    commit-denied "$session"
}

# The client only reads a hook's JSON when the hook exits 0, so the verdict goes
# out before anything that can fail, and telemetry can never retract it.
deny() {
  local reason="$1" event="$2" session="$3"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' \
    "$(json_escape "$reason")"
  trap - ERR
  log_event "$event" "$session" || true
  exit 0
}

# The client ignores a hook's JSON when it exits 2, so this channel replaces a
# verdict and must never follow one: gates arm it only where they have already
# decided the call is theirs, and drop it the moment a verdict is out.
block_with_gate_error() {
  printf 'oso-code: %s failed unexpectedly and blocked this call instead of opening the gate.\n' "$1" >&2
  exit 2
}

# One JSONL line per gate event so the team can audit whether gates ever fire.
# An event can carry command text, which carries whatever a command line carries,
# so the log is created as private as the state files: owner-only, the mode
# mktemp gives oso-state's writes. A log that cannot be written falls back to
# stderr: telemetry cannot record a storage failure into the storage that failed.
log_event() {
  local event="$1" session="$2" command="${3:-}"
  # The native install runs from a directory named after the client version —
  # the only free handle on the platform drift that breaks gates silently.
  local client="${CLAUDE_CODE_EXECPATH:-}"
  client="${client##*/}"
  local line
  line="$(printf '{"ts":"%s","event":"%s","command":"%s","session":"%s","client":"%s"}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_escape "$event")" \
    "$(json_escape "$(command_head "$command")")" \
    "$(json_escape "$session")" "$(json_escape "$client")")"
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
