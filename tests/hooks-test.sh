#!/usr/bin/env bash
# Regression tests for the oso-code state-gate hooks and oso-state helper.
# Runs against an isolated HOME so it never touches real session state.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$REPO_ROOT/plugin"
TEST_HOME="$(mktemp -d)"
trap 'rm -rf "$TEST_HOME"' EXIT
export HOME="$TEST_HOME"
export PATH="$PLUGIN/bin:$PATH"
SESSION="test-session"
# Spelled here rather than sourced from lib.sh on purpose: asserting the path
# independently is what catches a wrong constant in the code under test.
STATE_DIR="$HOME/.local/state/oso-code"
SESSION_STATE="$STATE_DIR/$SESSION.state"

pass=0
fail=0
skipped=0

# Runs a hook and judges the run itself. A hook that exits non-zero or writes to
# stderr must surface as one named FAIL — under set -euo pipefail a bare
# assignment from a crashing hook kills the suite, losing every later case and
# the footer. A case that wants a crash declares it via expected_rc/stderr.
# A bare hook name resolves under plugin/hooks; a path is used as given.
run_hook() {
  local hook="$1" input="$2" expected_rc="${3:-0}" expected_stderr="${4:-}"
  local stderr_file="$TEST_HOME/hook-stderr"
  case "$hook" in */*) ;; *) hook="$PLUGIN/hooks/$hook" ;; esac
  if hook_stdout="$(printf '%s' "$input" | "$hook" 2>"$stderr_file")"; then
    hook_rc=0
  else
    hook_rc=$?
  fi
  hook_stderr="$(cat "$stderr_file")"
  hook_problem=""
  if [ "$hook_rc" != "$expected_rc" ]; then
    hook_problem="hook exited $hook_rc, expected $expected_rc (stderr: ${hook_stderr:-<empty>})"
  elif [ -n "$expected_stderr" ]; then
    case "$hook_stderr" in
      *"$expected_stderr"*) ;;
      *) hook_problem="stderr lacks '$expected_stderr', got: ${hook_stderr:-<empty>}" ;;
    esac
  elif [ -n "$hook_stderr" ]; then
    hook_problem="hook wrote to stderr: $hook_stderr"
  fi
}

assert_allows() {
  local name="$1" hook="$2" input="$3"
  run_hook "$hook" "$input" "${4:-0}" "${5:-}"
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  elif [ -z "$hook_stdout" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected allow, got: $hook_stdout"; fail=$((fail + 1))
  fi
}

assert_denies() {
  local name="$1" hook="$2" input="$3"
  run_hook "$hook" "$input" "${4:-0}" "${5:-}"
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  else
    case "$hook_stdout" in
      *'"permissionDecision":"deny"'*) echo "ok: $name"; pass=$((pass + 1)) ;;
      *) echo "FAIL: $name — expected deny, got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
    esac
  fi
}

# Payload shape recovered from recorded PreToolUse tool_use entries under
# ~/.claude/projects/-home-tribalcode-Documents-personal-oso-code/ — Bash carries
# command+description, Edit carries file_path/old_string/new_string/replace_all;
# envelope fields per code.claude.com/docs/en/hooks. The client serializes inner
# double quotes as \", so a case spells its command exactly the way the
# transcript records it and json_field decodes it before any gate sees it.
TRANSCRIPT="$HOME/.claude/projects/oso-code/$SESSION.jsonl"
bash_input() {
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"%s","description":"regression case"}}' \
    "$SESSION" "$TRANSCRIPT" "$REPO_ROOT" "$1"
}
edit_input="$(printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.ts","old_string":"const slice = 1;","new_string":"const slice = 2;","replace_all":false}}' \
  "$SESSION" "$TRANSCRIPT" "$REPO_ROOT")"

# --- Harness guard: a crashing hook is one named FAIL, never an aborted run ---
# The FAIL this case wants is the assertion, not a failure of the suite, so the
# helper runs in a command substitution on purpose: the subshell's `fail` increment
# dies with the subshell and the expected FAIL never enters the tally. Split into
# two statements it would read the same and add one phantom failure to every run.
CRASH_HOOK="$REPO_ROOT/tests/fixtures/crashing-hook.sh"
crash_report="$(assert_allows "crashing hook" "$CRASH_HOOK" "$(bash_input 'npm test')")"
case "$crash_report" in
  "FAIL: crashing hook"*) echo "ok: a crashing hook is reported as a named FAIL"; pass=$((pass + 1)) ;;
  *) echo "FAIL: crashing hook went unreported — got: ${crash_report:-<empty>}"; fail=$((fail + 1)) ;;
esac
assert_allows "a declared hook crash is not a case failure" "$CRASH_HOOK" "$(bash_input 'npm test')" 1 'simulated hook failure'

# --- Dispatch: hooks.json gates the tools the gates claim to cover ---
# A matcher without metacharacters is a list of EXACT tool names, so a writer the
# list does not name is a writer no gate ever sees: `Edit` never covered
# `MultiEdit`, and the MCP writers are allowlisted one name at a time rather than
# by a wildcard — see block-edits-without-slice.sh for why the wildcard is
# refused and what the named list costs.
hooks_manifest="$PLUGIN/hooks/hooks.json"
gated_tools="$(sed -n 's/.*"matcher"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$hooks_manifest" | tr '|' '\n' | LC_ALL=C sort)"
expected_tools="$(printf '%s\n' Bash Edit MultiEdit NotebookEdit Write mcp__fallow__fix_apply | LC_ALL=C sort)"
if [ "$gated_tools" = "$expected_tools" ]; then
  echo "ok: PreToolUse matchers cover exactly the gated tools"; pass=$((pass + 1))
else
  echo "FAIL: matcher set drifted — got: $(printf '%s' "$gated_tools" | tr '\n' ' ')"; fail=$((fail + 1))
fi

unrunnable=""
manifest_commands="$(sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' "$hooks_manifest")"
while IFS= read -r manifest_command; do
  hook_script="${manifest_command//\\\"/}"
  hook_script="${hook_script//\$\{CLAUDE_PLUGIN_ROOT\}/$PLUGIN}"
  [ -x "$hook_script" ] || unrunnable="$unrunnable $hook_script"
done <<< "$manifest_commands"
if [ -z "$unrunnable" ]; then
  echo "ok: every hooks.json command is an executable script"; pass=$((pass + 1))
else
  echo "FAIL: hooks.json commands are not executable —$unrunnable"; fail=$((fail + 1))
fi

# --- Declarations: what `claude plugin validate --strict` has no opinion on ---
# The validator does open skill frontmatter, but never for `background` on a fork
# and never to resolve the plugin's own cross-references, so those two have no
# gate but this one — see tests/plugin-lint.sh for what it asserts and why each
# rule is decidable.
if lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" 2>&1)"; then
  echo "ok: plugin frontmatter and cross-references lint clean"; pass=$((pass + 1))
else
  echo "FAIL: plugin lint — $(printf '%s' "$lint_report" | tr '\n' ' ')"; fail=$((fail + 1))
fi

# --- Commit gate: state transitions (starts from no state at all) ---
oso-state --session "$SESSION" clear
assert_allows "commit with no state file"  block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
assert_denies "commit while verify is red" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set verify_green=true
assert_allows "commit when verify is green" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set mode=debug verify_green=false
assert_denies "debug-mode commit while verify is red" block-commit-until-green.sh "$(bash_input 'git commit -m x')"

# --- Commit gate: matcher hardening (plan mode, verify red) ---
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false
assert_denies "bypass: git -C <repo> commit"    block-commit-until-green.sh "$(bash_input 'git -C /repo commit -m x')"
assert_denies "bypass: git -c k=v commit"       block-commit-until-green.sh "$(bash_input 'git -c user.email=a@b commit')"
assert_denies "bypass: chained after &&"        block-commit-until-green.sh "$(bash_input 'cd /repo && git commit -m x')"
assert_denies "bypass: double space"            block-commit-until-green.sh "$(bash_input 'git  commit -m x')"
assert_allows "no false positive: echo"         block-commit-until-green.sh "$(bash_input 'echo git commit is blocked')"
assert_allows "no false positive: quoted rg"    block-commit-until-green.sh "$(bash_input 'rg \"git commit\" docs/')"
assert_allows "no false positive: git checkout" block-commit-until-green.sh "$(bash_input 'git checkout -b commit')"
assert_allows "non-commit bash is ignored"      block-commit-until-green.sh "$(bash_input 'npm test')"

# Command text copied byte for byte out of the recorded v0.10.0 release payload
# (session 04ec4b8e-a8a7-40a8-a1e1-af81ae53daf6): the real thing, escaping included.
assert_denies "recorded release commit is denied" block-commit-until-green.sh "$(bash_input 'git add -A && git commit -m \"feat(harness): one-step Windows installer, hybrid MCP wiring, identity voice, didactic walkthrough (v0.10.0)\" && git log --oneline -1 && git status --porcelain | wc -l')"

# --- Commit gate: execution-wrapper bypasses (plan mode, verify red) ---
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false
assert_denies "bypass: bash -c wraps commit" block-commit-until-green.sh "$(bash_input 'bash -c '\''git commit -m x'\''')"
assert_denies "bypass: sh -c wraps commit"   block-commit-until-green.sh "$(bash_input 'sh -c '\''git commit -m x'\''')"
assert_denies "bypass: eval wraps commit"    block-commit-until-green.sh "$(bash_input 'eval '\''git commit -m x'\''')"
assert_denies "bypass: piped into xargs git commit" block-commit-until-green.sh "$(bash_input 'git diff --name-only | xargs git commit -m x')"
assert_allows "no false positive: bash -c git status" block-commit-until-green.sh "$(bash_input 'bash -c '\''git status'\''')"
assert_allows "no false positive: quoted echo"        block-commit-until-green.sh "$(bash_input 'echo \"git commit\"')"

# Double-quoted wrappers reach the hook JSON-escaped (\"…\") the way the harness
# sends them, so these cases prove the reader decodes what the lexer then reads
# as real quotes.
assert_denies "bypass: bash -c wraps commit (double-quoted)" block-commit-until-green.sh "$(bash_input 'bash -c \"git commit -m x\"')"
assert_denies "bypass: sh -c wraps commit (double-quoted)"   block-commit-until-green.sh "$(bash_input 'sh -c \"git commit -m x\"')"
assert_denies "bypass: eval wraps commit (double-quoted)"    block-commit-until-green.sh "$(bash_input 'eval \"git commit -m x\"')"
assert_allows "no false positive: bash -c git status (double-quoted)" block-commit-until-green.sh "$(bash_input 'bash -c \"git status\"')"

# --- Slice gate ---
oso-state --session "$SESSION" clear
assert_allows "edit with no state file" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set mode=plan verify_green=false
assert_denies "plan-mode edit without active slice" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set active_slice=2
assert_allows "plan-mode edit with active slice" block-edits-without-slice.sh "$edit_input"

# The gate has to fire once per slice, not once per session. `oso-state` can set a
# key but never delete one, so the skills close a slice by writing the sentinel and
# arm the next one by name — this is that sequence, and the edit in the middle is
# the one a partial write used to let through for the rest of the session.
oso-state --session "$SESSION" set mode=plan active_slice=3 verify_green=false
assert_allows "an armed slice number opens the gate" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set mode=plan active_slice=none verify_green=true
assert_denies "the closed-slice sentinel disarms the gate again" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set mode=plan active_slice=4 verify_green=false
assert_allows "the next slice re-arms the gate the sentinel closed" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=quick verify_green=false
assert_allows "quick-mode edit is unrestricted" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=debug verify_green=false
assert_allows "debug-mode edit is unrestricted" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" clear

# --- Invisibility: a session no mode ever armed must not know a gate ran -------
# A marketplace install runs no bootstrap and a GUI-launched client has no
# /opt/homebrew/bin, so the interesting machine is the one without jq: every
# signal a gate records there — an event, the state directory it needs, a line of
# stderr when the log cannot be written — belongs to someone who never ran
# oso-code. PATH is rebuilt from the tools the hooks actually run, which is the
# only way to hide one binary without hiding the rest; `type -P` asks for the
# executable, so a shell that wraps one of these names in a function cannot turn
# a link into a link to itself.
NOJQ_PATH="$TEST_HOME/nojq"
mkdir -p "$NOJQ_PATH"
for hook_tool in env bash cat dirname tr grep date mkdir; do
  ln -s "$(type -P "$hook_tool")" "$NOJQ_PATH/$hook_tool"
done

assert_leaves_no_trace() {
  local name="$1" hook="$2" input="$3" trace="" out
  local home="$TEST_HOME/unarmed" stderr_file="$TEST_HOME/unarmed-stderr"
  rm -rf "$home"
  mkdir -p "$home"
  out="$(printf '%s' "$input" | env -i HOME="$home" PATH="$NOJQ_PATH" \
    "$PLUGIN/hooks/$hook" 2>"$stderr_file")" || trace="$trace exit: $?"
  [ -z "$out" ] || trace="$trace stdout: $out"
  [ ! -s "$stderr_file" ] || trace="$trace stderr: $(cat "$stderr_file")"
  [ ! -e "$home/.local" ] || trace="$trace wrote: $(find "$home/.local" | tr '\n' ' ')"
  if [ -z "$trace" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name —$trace"; fail=$((fail + 1))
  fi
}

assert_leaves_no_trace "an unarmed session leaves the commit gate silent without jq" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_leaves_no_trace "an unarmed session leaves the slice gate silent without jq" \
  block-edits-without-slice.sh "$edit_input"

# --- Integration: every state write the skills instruct carries the full triple -
# The three mode skills are the only writers, and a write that names fewer than
# three keys leaves the other two standing: that is how a slice-pass write left
# the previous slice armed and a phase boundary left both gates open. Backticks
# delimit every command these documents instruct, so each span that invokes the
# state binary with `set` has to spell mode, active_slice and verify_green.
partial_state_writes=""
skills_with_no_write=""
for state_writer in plan quick debug; do
  writes_read=0
  while IFS= read -r instructed_command; do
    case "$instructed_command" in
      *OSO_STATE_BIN*" set "*) writes_read=$((writes_read + 1)) ;;
      *) continue ;;
    esac
    case "$instructed_command" in
      *"set mode="*" active_slice="*" verify_green="*) ;;
      *) partial_state_writes="$partial_state_writes ${state_writer}:'${instructed_command}'" ;;
    esac
  done <<< "$(tr '`' '\n' < "$PLUGIN/skills/$state_writer/SKILL.md")"
  # A skill whose writes this scan cannot find would pass the check by reading
  # nothing at all.
  [ "$writes_read" -gt 0 ] || skills_with_no_write="$skills_with_no_write $state_writer"
done
if [ -n "$skills_with_no_write" ]; then
  echo "FAIL: no state write left to check in —$skills_with_no_write"; fail=$((fail + 1))
elif [ -z "$partial_state_writes" ]; then
  echo "ok: every state write the mode skills instruct carries the full triple"; pass=$((pass + 1))
else
  echo "FAIL: a mode skill instructs a partial state write —$partial_state_writes"; fail=$((fail + 1))
fi

# --- Integration: the env var the skills instruct is the one hooks look up ---
export CLAUDE_CODE_SESSION_ID="$SESSION"
bash -c 'oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false'
assert_denies "skill-documented env var arms the gate" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" clear

# --- Concurrency: parallel writers must not lose keys ---
( for i in $(seq 1 25); do oso-state --session "$SESSION" set "a=$i" >/dev/null; done ) &
( for i in $(seq 1 25); do oso-state --session "$SESSION" set "b=$i" >/dev/null; done ) &
wait
if [ "$(oso-state --session "$SESSION" get a)" = "25" ] && [ "$(oso-state --session "$SESSION" get b)" = "25" ]; then
  echo "ok: concurrent writers preserve all keys"; pass=$((pass + 1))
else
  echo "FAIL: concurrent writers lost keys — state: $(oso-state --session "$SESSION" show)"; fail=$((fail + 1))
fi
oso-state --session "$SESSION" clear

# --- Stale lock: a crashed writer's lock is reclaimed, not fatal ---
stale_lock="$SESSION_STATE.lock"
mkdir -p "$stale_lock"
touch -t 200001010000 "$stale_lock"
oso-state --session "$SESSION" set stale_ok=yes >/dev/null 2>&1 || true
if [ "$(oso-state --session "$SESSION" get stale_ok)" = "yes" ]; then
  echo "ok: stale lock is reclaimed"; pass=$((pass + 1))
else
  echo "FAIL: stale lock blocked a write"; fail=$((fail + 1))
fi
oso-state --session "$SESSION" clear

# --- Telemetry: denies are recorded ---
# Every oso-state set logs an event, so a non-empty log proves nothing; the
# audit is only worth having if a gate that fired left its own line behind.
events_log="$STATE_DIR/events.jsonl"
if grep -q '"event":"commit-denied"' "$events_log" && grep -q '"event":"edit-denied"' "$events_log"; then
  echo "ok: both gates log their denies"; pass=$((pass + 1))
else
  echo "FAIL: deny events missing from telemetry — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# --- Session-end cleanup + path traversal safety ---
oso-state --session "$SESSION" set mode=plan verify_green=true
mkdir -p "$SESSION_STATE.lock"
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
if [ -z "$hook_problem" ] && [ ! -f "$SESSION_STATE" ]; then
  echo "ok: session end removes state"; pass=$((pass + 1))
else
  echo "FAIL: state file survived cleanup${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi
if [ ! -d "$SESSION_STATE.lock" ]; then
  echo "ok: session end removes leftover lock"; pass=$((pass + 1))
else
  echo "FAIL: lock dir survived cleanup"; fail=$((fail + 1))
fi
touch "$HOME/canary"
run_hook cleanup-state.sh '{"session_id":"../../canary"}'
if [ -z "$hook_problem" ] && [ -f "$HOME/canary" ]; then
  echo "ok: traversal session id cannot delete outside state dir"; pass=$((pass + 1))
else
  echo "FAIL: path traversal deleted a file outside the state dir${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi

# --- SessionStart: OSO_STATE_BIN reaches the real oso-state binary ---
# The skills invoke "${OSO_STATE_BIN:-oso-state}"; this hook is what makes that
# env var land in the session, so assert it resolves to a runnable binary.
env_file="$(mktemp)"
export CLAUDE_ENV_FILE="$env_file"
run_hook persist-state-bin.sh ''
persisted="$(. "$env_file"; printf '%s' "${OSO_STATE_BIN:-}")"
if [ -z "$hook_problem" ] && [ -n "$persisted" ] && [ -x "$persisted" ]; then
  echo "ok: SessionStart persists OSO_STATE_BIN to an executable"; pass=$((pass + 1))
else
  echo "FAIL: OSO_STATE_BIN not persisted or not executable — got: ${persisted:-<empty>}${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi
rm -f "$env_file"

# No CLAUDE_ENV_FILE must degrade to a silent no-op (Windows-safe old behavior).
unset CLAUDE_ENV_FILE
run_hook persist-state-bin.sh ''
if [ -z "$hook_problem" ] && [ -z "$hook_stdout" ]; then
  echo "ok: SessionStart no-ops when CLAUDE_ENV_FILE is unset"; pass=$((pass + 1))
else
  echo "FAIL: persist hook emitted output with no env file — got: ${hook_stdout:-<empty>}${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi

# --- Fail closed: a broken environment must not cost the operator a verdict ---
# The client only reads a hook's JSON on exit 0, so a hook that dies while
# logging opens the gate it was about to close. The log path is made a directory
# because that is unwritable for root too, unlike a chmod.
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false
rm -f "$events_log"
mkdir -p "$events_log"
assert_denies "commit deny survives an unwritable log" block-commit-until-green.sh "$(bash_input 'git commit -m x')" 0 '"event":"commit-denied"'
assert_denies "edit deny survives an unwritable log"   block-edits-without-slice.sh "$edit_input" 0 '"event":"edit-denied"'
rmdir "$events_log"

# --- Polarity: an armed session the gate cannot read denies, never opens ---
oso-state --session "$SESSION" clear
mkdir -p "$SESSION_STATE"
assert_denies "commit gate denies a state path that is not a readable file" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_denies "edit gate denies a state path that is not a readable file"   block-edits-without-slice.sh "$edit_input"
# A line the lexer calls clear is the one shape that could have left the gate open
# while it crashed: the verdict is read after the state check, under the armed ERR
# trap, so an armed session the gate cannot read denies whatever the line says.
assert_denies "commit gate denies an unreadable state even for a line that looks clear" \
  block-commit-until-green.sh "$(bash_input 'npm test')"
rmdir "$SESSION_STATE"
if grep -q '"event":"state-unreadable"' "$events_log"; then
  echo "ok: an unreadable state file is recorded"; pass=$((pass + 1))
else
  echo "FAIL: state-unreadable missing from telemetry"; fail=$((fail + 1))
fi

# --- The state directory is no edit exemption ---
# The old exemption matched an unnormalized prefix, so a path spelled through
# the state dir — including straight back out of it — bypassed the gate.
oso-state --session "$SESSION" set mode=plan verify_green=false
traversal_edit="$(printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/../../../../tmp/x.ts","old_string":"const slice = 1;","new_string":"const slice = 2;","replace_all":false}}' \
  "$SESSION" "$TRANSCRIPT" "$REPO_ROOT" "$STATE_DIR")"
assert_denies "edit through a state-dir traversal path is denied" block-edits-without-slice.sh "$traversal_edit"

# --- Audit trail: one bad value must not make the log unparseable ---
# State keys carry user-supplied text; an unescaped quote or backslash breaks
# this line and every line a reader parses after it.
oso-state --session "$SESSION" set 'weird=a"b\c' >/dev/null
if grep -qF '"event":"set:weird=a\"b\\c"' "$events_log"; then
  echo "ok: quotes and backslashes are escaped in the event log"; pass=$((pass + 1))
else
  echo "FAIL: unescaped value in the event log — last line: $(tail -n 1 "$events_log")"; fail=$((fail + 1))
fi
# The gate's own decoder is the other way in: json_unescape turns \t, \r, \b and
# \f back into the raw bytes JSON forbids in a string, and the residue event logs
# that text — so a tab-indented heredoc breaks the line without a hostile author.
# jq is the strict reader here because it is what a streaming consumer runs, and
# it stops at the first unescaped control byte, losing every line after it.
control_byte_pair="$(printf 'weird=a\tb\rc\033d')"
oso-state --session "$SESSION" set "$control_byte_pair" >/dev/null
if ! command -v jq >/dev/null 2>&1; then
  echo "skip: jq is absent here, so no strict parser can read the line back"
  skipped=$((skipped + 1))
elif [ "$(tail -n 1 "$events_log" | jq -r '.event')" = "set:$control_byte_pair" ]; then
  echo "ok: control bytes in a value keep the event log strictly parseable"; pass=$((pass + 1))
else
  echo "FAIL: a control byte broke the event log — $(tail -n 1 "$events_log" | jq . 2>&1 | head -n 1)"; fail=$((fail + 1))
fi
if grep -q '"client":"' "$events_log"; then
  echo "ok: events carry the client build"; pass=$((pass + 1))
else
  echo "FAIL: events lack the client field — last line: $(tail -n 1 "$events_log")"; fail=$((fail + 1))
fi

# --- Drift: a payload the gate cannot parse passes, but never silently ---
assert_allows "an unparseable payload does not gate the call" block-commit-until-green.sh '{"tool_name":"Bash"}'
if grep -q '"event":"payload-unparseable"' "$events_log"; then
  echo "ok: an unparseable payload is recorded"; pass=$((pass + 1))
else
  echo "FAIL: payload-unparseable missing from telemetry"; fail=$((fail + 1))
fi
oso-state --session "$SESSION" clear

# --- Retention: abandoned state ages out, everything doubtful survives ---
# One sweep, several files, one named expectation per file: which file the sweep
# spared is the whole point, so a failure has to name the file it got wrong.
assert_kept() {
  local name="$1" path="$2"
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  elif [ -e "$path" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — the sweep deleted $path"; fail=$((fail + 1))
  fi
}

assert_pruned() {
  local name="$1" path="$2"
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  elif [ ! -e "$path" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — the sweep left $path behind"; fail=$((fail + 1))
  fi
}

abandoned_state="$STATE_DIR/abandoned-session.state"
recent_state="$STATE_DIR/recent-session.state"
locked_state="$STATE_DIR/locked-session.state"
printf 'mode=plan\n' > "$abandoned_state"
printf 'mode=plan\n' > "$recent_state"
printf 'mode=plan\n' > "$locked_state"
# A live session's mtime only advances at slice boundaries, so age alone cannot
# tell a dead session from one that has been on the same slice since morning.
touch -t 200001010000 "$abandoned_state" "$locked_state"
mkdir -p "${locked_state}.lock"
oso-state --session "$SESSION" set mode=plan verify_green=true >/dev/null
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
assert_pruned "state left by a session that ended weeks ago is swept" "$abandoned_state"
assert_kept   "state written within the week survives the sweep"      "$recent_state"
assert_kept   "state held by a live lock survives whatever its age"   "$locked_state"
assert_pruned "the ending session's own state is still removed"       "$SESSION_STATE"
rm -rf "${locked_state}.lock" "$locked_state" "$recent_state"

# --- Retention: an aged event log rotates, a current one is left alone ---
# Rotation must move the log aside rather than rewrite it: the next append
# recreates it, and no deny line can fall into the gap.
rm -f "$events_log" "${events_log}.1"
printf '{"event":"aged"}\n' > "$events_log"
touch -t 200001010000 "$events_log"
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
oso-state --session "$SESSION" set rotated=yes >/dev/null
if [ -z "$hook_problem" ] && grep -q '"event":"aged"' "${events_log}.1" 2>/dev/null &&
   ! grep -q '"event":"aged"' "$events_log" 2>/dev/null; then
  echo "ok: an aged event log rotates to .1 and the next append starts a fresh one"; pass=$((pass + 1))
else
  echo "FAIL: aged event log was not rotated${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi

rm -f "$events_log" "${events_log}.1"
printf '{"event":"current"}\n' > "$events_log"
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
if [ -z "$hook_problem" ] && [ ! -e "${events_log}.1" ] && grep -q '"event":"current"' "$events_log"; then
  echo "ok: an event log inside the retention window is left alone"; pass=$((pass + 1))
else
  echo "FAIL: a current event log was rotated${hook_problem:+ — $hook_problem}"; fail=$((fail + 1))
fi
oso-state --session "$SESSION" clear

# --- Commit gate: one table per question the matcher has to answer -----------
# A table line is a whole case, and the command is its name: the point of these
# is coverage of shapes, and a hand-written label per line would only repeat the
# command less precisely.
assert_every() {
  local assertion="$1" table="$2" case_command
  while IFS= read -r case_command; do
    [ -n "$case_command" ] || continue
    "$assertion" "$table: $case_command" block-commit-until-green.sh "$(bash_input "$case_command")"
  done
}

oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false

# Every line here ALLOWED a commit on red state before the lexer: the matcher
# asked whether a commit-shaped substring followed a boundary character instead
# of whether git is the command word of some command in the line.
assert_every assert_denies adversarial <<'ADVERSARIAL_TABLE'
if true; then git commit; fi
for i in 1; do git commit; done
while :; do git commit; break; done
f(){ git commit; }; f
{ git commit; }
env X=1 git commit
VAR=v git commit
sudo git commit
time git commit
nohup git commit
timeout 60 git commit
stdbuf -oL git commit
sudo env X=1 git commit
command command git commit
/usr/bin/git commit
./git commit
bash -lc \"git commit\"
sh -ec \"git commit\"
bash --login -c \"git commit\"
zsh -c \"git commit\"
dash -c \"git commit\"
env bash -c \"git commit\"
bash -c \"git commit\" && bash -c \"git status\"
bash -c \"git commit -m 'fix retrieval bug'\"
bash -c \"git commit -m 'medieval coeval primeval'\"
newgrp <<< \"git commit\"
bash <<EOF\ngit commit\nEOF
sh <<'EOF'\ngit commit\nEOF
git commit-tree abc123
git update-ref refs/heads/main abc123
git update-ref -d refs/heads/main
git filter-branch --tree-filter true HEAD
git replace abc123 def456
git fast-import < dump
ADVERSARIAL_TABLE

# Every line here DENIED before the lexer, including a read-only probe an
# auditor ran against this very gate. A heredoc body is data for whatever reads
# it, a quoted mention is text, the read-only forms of a gated verb report
# instead of writing, and an option git answers by itself prints a version, a
# path or a usage screen and exits, so the word behind it never becomes a verb.
assert_every assert_allows friction <<'FRICTION_TABLE'
cat > f <<EOF\ngit commit -m x\nEOF
cat > f <<-'EOF'\n\tgit commit -m x\n\tEOF
grep -n \"; git commit\" README.md
rg \"(git commit)\" docs/
rg \"&& git commit\" .
printf \"%s\\n\" \"a | git commit -F -\"
echo \"run: (git commit)\"
echo \"step 1; git commit -m x\"
git log --grep=\"; git commit\"
git commit --dry-run
git commit -h
git commit --help
git help commit
git replace -l
git --help commit
git -h commit
git --version commit
git -v commit
git --man-path
git --exec-path commit
git --html-path commit
git --man-path commit
git --info-path commit
docker run -i bash <<EOF\ngit commit\nEOF
grep -l bash *.sh <<EOF\ngit commit\nEOF
echo bash > f <<EOF\ngit commit\nEOF
bash -c \"echo hi\" \"git commit\"
bash -c \"echo $0\" git commit
FRICTION_TABLE

assert_every assert_denies regression <<'REGRESSION_TABLE'
git commit
git   commit -m x
cd x && git commit
(git commit)
git -C /path commit
git -C path commit
command git commit
$(git commit)
echo a | git commit -F -
git commit --amend --no-edit
git commit -a
git -c user.name=x -c user.email=y commit -m z
bash -c 'git commit -m x'
bash -c 'bash -c \"git commit\"'
git commit -m x &
true; git commit
git commit 2>&1
xargs -I{} bash -c \"git commit\"
echo start\ngit commit -m x
xargs -n1 git commit
xargs -0 git commit -m x
sudo bash <<EOF\ngit commit\nEOF
env bash <<EOF\ngit commit\nEOF
bash --rcfile /dev/null -c \"git commit\"
bash -c -- \"git commit\"
bash -c \"git commit\" positional-arg
REGRESSION_TABLE

# git's own options are not a matter of taste: real git accepts a separate value
# for the first table below and then runs the verb behind it, so a gate that
# skips the wrong number of words reads the value as the verb and lets a commit
# through. Confirmed against git 2.54.0 with `git <option> <value> version`.
assert_every assert_denies "git option shape" <<'GIT_OPTION_TABLE'
git --attr-source HEAD commit -m x
git --namespace ns commit -m x
git --git-dir /repo --work-tree /repo commit -m x
git --config-env user.email=EMAIL commit
git -c a.b=c --attr-source HEAD commit -m x
git --exec-path=/usr/lib/git-core commit
git -p commit
git --no-pager commit
git --bare commit
git --literal-pathspecs commit -m x
git --no-optional-locks commit -m x
GIT_OPTION_TABLE

# The same arity question one word further in: a read-only marker standing where
# an option's value stands is that option's value. Every line here writes a real
# commit on git 2.54.0, with the marker for a subject, and every one of them came
# out clear before this table existed.
assert_every assert_denies "marker in a value position" <<'VALUE_POSITION_TABLE'
git commit -m --dry-run
git commit -m -h
git commit -m \"--dry-run\"
git commit -am --dry-run
git commit -m x -m --dry-run
git -C /repo commit -m --dry-run
VALUE_POSITION_TABLE

# Which of a verb's options take a separate value is per verb and per git version,
# so a marker the gate cannot place is gated rather than guessed: these are
# read-only calls this gate refuses on purpose, and writing the marker in front of
# the other options is what lets them through. Behind `--` every word is a
# pathspec, so a marker there is no marker at all.
assert_every assert_denies "marker the gate will not place" <<'UNPLACEABLE_MARKER_TABLE'
git commit --amend --dry-run
git commit -a --dry-run
git commit -- --dry-run
git commit -- seed --dry-run
UNPLACEABLE_MARKER_TABLE

assert_every assert_allows "no friction" <<'NO_FRICTION_TABLE'
git diff
git log --grep=commit
git status
git checkout -b commit
echo git commit
rg \"git commit\" docs/
git tag -m \"git commit\" v1
# git commit -m x
git commitzzz
npm test
man git-commit
NO_FRICTION_TABLE

# Pinned so nobody reads the gated verb set as "everything that writes": these
# rewrite history or publish it and this gate lets every one of them through.
assert_every assert_allows "not gated" <<'NOT_GATED_TABLE'
git revert HEAD
git merge feature
git rebase main
git cherry-pick abc123
git am patch.eml
git push origin main
git stash
NOT_GATED_TABLE

# A redirect's target is a file or a descriptor, and in front of the command word
# it stands exactly where the command word stands: the target landed at
# command_tokens[0], so the git test, the residue test and the verdict all
# answered about the file. `>/dev/null git commit -m x` came out clear — allowed,
# and not even counted — while bash ran the commit, and that is ordinary POSIX
# syntax rather than an evasion shape, so a benign line trips it. The trailing
# half is the control: dropping the target may not cost the command it belongs
# to, and the descriptor a redirect starts with is a word of its own.
assert_every assert_denies "redirect target" <<'REDIRECT_TABLE'
>/dev/null git commit -m x
>out.txt git commit -m x
> out.txt git commit -m x
>>a.log git commit -m x
2>err.log git commit -m x
1>out.log git commit -m x
&>all.log git commit -m x
>&all.log git commit -m x
>|clobber.txt git commit -m x
>| clobber.txt git commit -m x
<in.txt git commit -m x
3<in.txt git commit -m x
<>rw.txt git commit -m x
<&3 git commit -m x
>\"my file\" git commit -m x
>$(echo f) git commit -m x
env >log git commit -m x
sudo >log git commit -m x
timeout 60 >log git commit -m x
exec >log; git commit -m x
cd /repo && >log git commit -m x
true; >log git commit
echo x | >log git commit -m x
bash -c \">log git commit\"
git commit -m x >/dev/null
git commit -m x 2>&1
git commit -m x &>log
git commit -m x >>log 2>&1
git commit -m x >out.txt 2>err.log
git fast-import < dump
REDIRECT_TABLE

# The reader a heredoc or a herestring feeds is this command's command word, so a
# target standing in front of it took that place: `>out.txt bash <<EOF` was a
# heredoc whose body nobody read as commands, and it came out clear. The shapes
# with the redirect behind the reader are the control on the other side, where the
# shell was never hidden and the drop may not lose it.
assert_every assert_denies "redirect in front of a shell's stdin" <<'REDIRECT_STDIN_TABLE'
>out.txt bash <<EOF\ngit commit\nEOF
bash >out.txt <<EOF\ngit commit\nEOF
>out.txt bash <<< \"git commit\"
2>err.log bash -s <<EOF\ngit commit\nEOF
REDIRECT_STDIN_TABLE

# The friction side of the same drop: a dropped target may not take a real command
# word with it, and a redirect on a line with no commit in it is no verdict at all.
# The friction table above already pins the heredoc shapes (`cat > f <<EOF`,
# `echo bash > f <<EOF`) whose bodies carry one.
assert_every assert_allows "redirect with no commit to find" <<'REDIRECT_NO_FRICTION_TABLE'
npm test > out.log
npm test 2>&1 | tee out.log
>out.log npm test
git diff > /tmp/d.patch
git status 2>/dev/null
git tag -m x v1 >log
cat < notes.md
echo \"a > b\" && npm test
echo a \\> b
REDIRECT_NO_FRICTION_TABLE

# --- Residue: what the lexer cannot decide passes, and is counted ------------
# A non-shell interpreter's payload and a command word only the shell can
# resolve are out of a discipline rail's charter, so they pass — but the rate
# has to be visible, or nobody can tell a rail from a sieve.
rm -f "$events_log"
assert_allows "residue: a python payload that mentions git passes" \
  block-commit-until-green.sh "$(bash_input 'python3 -c \"import os; os.system('\''git commit'\'')\"')"
assert_allows "residue: a command word only the shell resolves passes" \
  block-commit-until-green.sh "$(bash_input 'g=git; $g commit')"
if grep -q '"event":"residue-allowed","command":"python3' "$events_log"; then
  echo "ok: a residue allow carries the command it let through"; pass=$((pass + 1))
else
  echo "FAIL: residue-allowed missing from telemetry — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# A wrapper chain deeper than the lexer reads is the same undecidable: the payload
# nobody read is residue, so a chain with no git in it is never refused for a red
# verify. The cost is taken on purpose — four wrappers deep hides a commit, the
# way a python payload already does — so it is pinned as a decision, not left to
# be found later and read as a hole.
assert_allows "residue: a wrapper chain past the recursion bound passes" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c ok\\\"\"'\''')"
assert_allows "residue: a chain past the bound hides a commit — allowed on purpose" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c git commit\\\"\"'\''')"
if grep -q '"event":"residue-allowed","command":"bash -c .*bash -c ok' "$events_log" &&
   grep -q '"event":"residue-allowed","command":"bash -c .*bash -c git commit' "$events_log"; then
  echo "ok: both chains past the bound are logged with the chain they let through"; pass=$((pass + 1))
else
  echo "FAIL: residue-allowed missing for a chain past the bound — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi
assert_denies "a chain past the bound never downgrades a commit the gate did read" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x && bash -c '\''bash -c \"bash -c \\\"bash -c ok\\\"\"'\''')"

# Three more classes the gate reads far enough to know it cannot decide: an
# interpreter's script arrives on stdin instead of in an argument, a command word
# is whatever a substitution prints, and a git option shape belongs to no table
# here — the word behind `--super-prefix` is a value on one git and the verb on
# another. Every one of them passes, and every one of them is counted.
assert_allows "residue: a python heredoc that mentions git passes" \
  block-commit-until-green.sh "$(bash_input 'python3 - <<EOF\nos.system(\"git commit\")\nEOF')"
assert_allows "residue: a command word a substitution produces passes" \
  block-commit-until-green.sh "$(bash_input '$(echo git) commit')"
assert_allows "residue: a git option shape no table answers passes" \
  block-commit-until-green.sh "$(bash_input 'git --super-prefix p/ commit -m x')"
if grep -q '"event":"residue-allowed","command":"python3 - <<' "$events_log" &&
   grep -qF '"event":"residue-allowed","command":"$(echo git) commit"' "$events_log" &&
   grep -q '"event":"residue-allowed","command":"git --super-prefix' "$events_log"; then
  echo "ok: stdin scripts, produced command words and unknown git options are all counted"; pass=$((pass + 1))
else
  echo "FAIL: a residue class is not counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# An unresolved option shape is undecidable in front of the command word too: `x`
# is the user sudo runs as or the program it runs, and answering that needs an
# option-arity table for every wrapper there is. So the same rule the git options
# already follow holds here — unresolved is residue, allowed and counted, never
# clean. `stdbuf -oL git commit` above stays a deny: a commit the gate did read
# outranks a prefix it did not.
assert_allows "residue: a wrapper option whose value could be the command word passes" \
  block-commit-until-green.sh "$(bash_input 'sudo -u x bash <<EOF\ngit commit\nEOF')"
assert_allows "residue: a wrapper option in front of git passes" \
  block-commit-until-green.sh "$(bash_input 'sudo -u x git commit')"
if grep -q '"event":"residue-allowed","command":"sudo -u x bash <<EOF' "$events_log" &&
   grep -qF '"event":"residue-allowed","command":"sudo -u x git commit"' "$events_log"; then
  echo "ok: an unresolved command prefix is counted, not read as clean"; pass=$((pass + 1))
else
  echo "FAIL: an unresolved command prefix is not counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# The same arity question one word into an interpreter's arguments: on bash 5.3
# `bash -c -O extglob \"…\"` and `bash -c -o pipefail \"…\"` run the payload behind
# the option's value, so the word deferred as the payload is the value and the real
# payload goes unread — both lines came out clear before these cases existed. `-O`
# takes a value and `-x` does not, and no table says which does across shells and
# versions, so a payload standing in a value position is read as commands and the
# call is counted unread. The controls behind the pair: an option that takes no
# value leaves a real payload there, and options in front of -c leave the payload
# where the flag put it.
assert_allows "residue: an interpreter payload standing in a value position passes" \
  block-commit-until-green.sh "$(bash_input 'bash -c -O extglob \"git commit -m x\"')"
assert_allows "residue: the same shape with a set -o option passes" \
  block-commit-until-green.sh "$(bash_input 'bash -c -o pipefail \"git commit -m x\"')"
if grep -q '"event":"residue-allowed","command":"bash -c -O extglob' "$events_log" &&
   grep -q '"event":"residue-allowed","command":"bash -c -o pipefail' "$events_log"; then
  echo "ok: a payload an option shape hides is counted, not read as clean"; pass=$((pass + 1))
else
  echo "FAIL: a payload in a value position is not counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi
assert_denies "a payload in a value position is still read as commands" \
  block-commit-until-green.sh "$(bash_input 'bash -c -x \"git commit -m x\"')"
assert_denies "options in front of -c leave the payload where the flag put it" \
  block-commit-until-green.sh "$(bash_input 'bash -O extglob -c \"git commit -m x\"')"

# The same question hidden inside one word, where an allow proves nothing on its
# own: a clustered option that comes out clear is a payload nobody read and nobody
# counted, so the allow only passes here if the call was recorded.
assert_allows_counted() {
  local name="$1" hook="$2" input="$3"
  rm -f "$events_log"
  run_hook "$hook" "$input"
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  elif [ -n "$hook_stdout" ]; then
    echo "FAIL: $name — expected allow, got: $hook_stdout"; fail=$((fail + 1))
  elif ! grep -q '"event":"residue-allowed"' "$events_log" 2>/dev/null; then
    echo "FAIL: $name — allowed with nothing counted"; fail=$((fail + 1))
  else
    echo "ok: $name"; pass=$((pass + 1))
  fi
}

# A cluster carries -c together with letters whose arity no table here answers, and
# on bash 5.3 every line below runs the payload behind extglob/pipefail/nocaseglob
# — including `-Oc`, where -c is the last letter of the cluster. Reading the word
# the flag stands in front of as the payload therefore lexed the option's value and
# left the real payload unread and unrecorded, which is the one verdict this gate
# may never reach. So the word behind a cluster stands in a value position, the way
# it already does behind a separate `-c -O`.
assert_every assert_allows_counted "payload behind a clustered option" <<'CLUSTERED_OPTION_TABLE'
bash -cO extglob \"git commit -m x\"
bash -co pipefail \"git commit -m x\"
bash -Oc extglob \"git commit -m x\"
bash -lcO extglob \"git commit -m x\"
sh -cO extglob \"git commit -m x\"
bash -cO extglob 'git commit -m x'
bash -cO nocaseglob \"git commit --amend\"
CLUSTERED_OPTION_TABLE

# What that costs, pinned rather than discovered later: no cluster's next word is
# read as clean, so an ordinary login-shell wrapper is counted too. It still
# passes, and a commit behind one still denies — `bash -lc \"git commit\"` above.
assert_allows_counted "a login-shell cluster is counted even with no git in it" \
  block-commit-until-green.sh "$(bash_input 'bash -lc \"npm test\"')"

# Wrappers that hand the rest of their line to another program, stripped the way
# nice and timeout already are: `unbuffer git commit` is the commit it runs, and a
# numeric argument is a priority, not a program.
assert_every assert_denies "scheduling wrapper" <<'WRAPPER_NAME_TABLE'
ionice -c2 git commit -m x
chrt -f 10 git commit -m x
taskset -c 0 git commit -m x
unbuffer git commit -m x
WRAPPER_NAME_TABLE

# Behind a wrapper's option the word is that option's value or the program, and
# nothing here can say which — the same undecidable as `sudo -u x git commit`.
assert_allows_counted "residue: a lock file behind flock's option passes" \
  block-commit-until-green.sh "$(bash_input 'flock -x /tmp/l git commit -m x')"

# An interpreter installs under a versioned name — python3.13 is the shape a system
# python has — and the version says nothing about what the script asks git to do.
assert_allows_counted "residue: a versioned interpreter that mentions git passes" \
  block-commit-until-green.sh "$(bash_input 'python3.13 -c \"import os; os.system('\''git commit'\'')\"')"

# The residue half of the redirect drop: behind a target the gate reads as a word,
# an interpreter is `/dev/null` — clear, silent, and the script it was handed never
# counted. Dropping the target is what puts the call back in the class it belongs
# to, so the shape is pinned here as counted rather than merely allowed.
assert_allows_counted "residue: an interpreter behind a redirect is counted, not read as a file" \
  block-commit-until-green.sh "$(bash_input '>/dev/null python3 -c \"import os; os.system('\''git commit'\'')\"')"

# The mark an unresolved expansion has to leave on the word the gate reads — the
# command word, or git's own verb. `$(echo git) commit` above is counted because
# its `$` stands at position 0; the same expansion one byte in, and the backtick
# spelling, which left no mark on the word at all, both came out clear. Which
# spelling an expansion wears decides nothing about what the shell resolves it to.
assert_every assert_allows_counted "word an expansion leaves unresolved" <<'UNRESOLVED_WORD_TABLE'
g${x}it commit --no-verify -m x
`echo git` commit
git `echo commit` -m x
ev${a}l \"git commit\"
UNRESOLVED_WORD_TABLE

# What that predicate may not reach: a gated call the gate DID resolve outranks an
# expansion in the word, the way it already outranks an unresolved prefix. Whatever
# `${tools}` holds, the last segment of the command word is git and the verb behind
# it is commit.
assert_denies "an expansion inside a resolved git path is still a deny" \
  block-commit-until-green.sh "$(bash_input '/opt/${tools}/git commit -m x')"

# A shell whose commands the line does not carry: a pipe is not attached to its
# reader syntactically, a script file is a name and not its contents, and a sourced
# file is not on the line at all. All three are the same undecidable as a python
# script this lexer cannot open, and all three are ordinary shapes a session runs —
# `cat script.sh | bash`, `bash deploy.sh`, `source deploy.sh` — so denying them
# would be friction on real work. They pass, and every case below is here for the
# other half: counted, never clear-and-silent, or the rate is invisible.
assert_every assert_allows_counted "a shell fed from a pipe or a script file — counted, not denied, on purpose" <<'UNREAD_SHELL_INPUT_TABLE'
echo git commit | bash
echo git commit | sh
printf 'git commit' | bash -s
cat script.sh | bash
echo 'git commit --no-verify' | bash
bash deploy.sh
UNREAD_SHELL_INPUT_TABLE

assert_every assert_allows_counted "a sourced script — counted, not denied, on purpose" <<'SOURCED_SCRIPT_TABLE'
source deploy.sh
. deploy.sh
SOURCED_SCRIPT_TABLE

# The control the pipe cases are the mirror of: the same `-s` shell, handed the
# same commit where the line can carry it, is read and denied.
assert_denies "the same shell denies the commit a heredoc spells on the line" \
  block-commit-until-green.sh "$(bash_input 'bash -s <<EOF\ngit commit\nEOF')"

# And the control on the other side: a mention with no shell to read it is decided,
# not undecidable, so it stays the verdict the vast majority of calls reach —
# allowed AND silent. Counting these would drown the rate the cases above measure.
rm -f "$events_log"
assert_allows "a git mention with no shell to read it stays clear" \
  block-commit-until-green.sh "$(bash_input 'echo git commit')"
assert_allows "a pipe into a program that is no shell stays clear" \
  block-commit-until-green.sh "$(bash_input 'cat notes.md | grep commit')"
if [ ! -e "$events_log" ]; then
  echo "ok: neither clear line is counted as residue"; pass=$((pass + 1))
else
  echo "FAIL: a clear line was counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# D19: past the input bound the lexer does not lex, because a line's cost grows
# faster than its length and a hook runs before every call. So a long line is
# undecidable by construction — allowed and counted, never denied for a verb
# nobody read — and the pair pins the bound from both sides.
commit_line_of_length() {
  local length="$1" chunk="$2" line='git commit -m x && echo '
  while [ "${#line}" -lt "$length" ]; do
    line="$line$chunk"
  done
  printf '%s' "$line"
}
assert_allows "residue: a line past the input bound is not lexed, so it passes counted" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3100 'aaaaaaaaaaaaaaaa')")"
assert_denies "a line just under the input bound is still read" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3000 'aaaaaaaaaaaaaaaa')")"
if grep -q '"event":"residue-allowed","command":"git commit -m x && echo aaa' "$events_log"; then
  echo "ok: a line past the input bound is logged with the head of the line"; pass=$((pass + 1))
else
  echo "FAIL: a line past the input bound is not counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# D20: decoding a payload costs what lexing it costs — the same escapes×bytes
# shape — and it runs before the lexer's bound can apply, so 4000 escapes cost
# seconds on the machines that have no jq. The bound is therefore measured on the
# escaped payload the client sent, which is never smaller than what it decodes to
# and needs no reader to size: past it nothing decodes and nothing lexes. Same
# threshold, same marker, so this pair pins it from both sides the D19 pair does.
assert_allows "residue: a payload whose escapes run past the bound is not decoded, so it passes counted" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3100 '\"aaaa')")"
assert_denies "a payload whose escapes fit the bound is decoded and read" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3000 '\"aaaa')")"
if grep -qF '"event":"residue-allowed","command":"git commit -m x && echo \\\"aaaa' "$events_log"; then
  echo "ok: a payload past the decoder bound is logged with the head the client sent"; pass=$((pass + 1))
else
  echo "FAIL: a payload past the decoder bound is not counted — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi

# --- Event log privacy: it carries command text, so it carries secrets ---------
# 300 is a budget, not a round number: one command head, which lib.sh caps at
# LOG_COMMAND_HEAD_BYTES=120, plus one envelope — the ts, event, session and client
# fields run about 105 bytes with this suite's session name and longer in a real
# session, where the id is a uuid — plus room for the escapes a head can add. Over
# it, something wrote more than a head, which is how a whole 3 KB command line
# would land in the log. Nor is any of it safe to leave world-readable while the
# state files are not.
longest_event=0
while IFS= read -r event_line; do
  if [ "${#event_line}" -gt "$longest_event" ]; then
    longest_event="${#event_line}"
  fi
done < "$events_log"
if [ "$longest_event" -le 300 ]; then
  echo "ok: a logged command is truncated to a head, not written whole"; pass=$((pass + 1))
else
  echo "FAIL: an event line ran to $longest_event characters"; fail=$((fail + 1))
fi
case "$(ls -l "$events_log" | cut -c1-10)" in
  -rw-------) echo "ok: the event log is owner-only, like the state files"; pass=$((pass + 1)) ;;
  *) echo "FAIL: the event log is $(ls -l "$events_log" | cut -c1-10), and it carries command text"; fail=$((fail + 1)) ;;
esac

# --- Reader parity: jq and the fallback hand the gate the same text ----------
# A fixture table only proves the platform it ran on unless both readers hand the
# gate the same line: jq returns the real string, the fallback has to unescape by
# hand, and no gate may be able to tell which one read it.
read_by() {
  ( . "$PLUGIN/hooks/lib.sh"; JSON_READER="$1"; json_command_line "$2" )
}
parity_input="$(bash_input 'git commit -m \"a\nb\" a\\b')"
parity_expected=$'git commit -m "a\nb" a\\b'
if [ "$(read_by pattern "$parity_input")" = "$parity_expected" ]; then
  echo "ok: the pattern reader decodes escapes the way the client wrote them"; pass=$((pass + 1))
else
  echo "FAIL: pattern reader decoded '$(read_by pattern "$parity_input")'"; fail=$((fail + 1))
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "skip: jq is absent here, so there is no second reader to compare against"
  skipped=$((skipped + 1))
elif [ "$(read_by jq "$parity_input")" = "$parity_expected" ]; then
  echo "ok: jq and the pattern reader decode a payload identically"; pass=$((pass + 1))
else
  echo "FAIL: jq decoded '$(read_by jq "$parity_input")'"; fail=$((fail + 1))
fi

# The bound is a property of the gate, not of the machine's jq: a decoder bound
# only the fallback applied would deny on one install what it allows on the next.
# Over it either reader hands back the payload the client sent, escapes and all.
over_bound_line="$(commit_line_of_length 3100 '\"aaaa')"
over_bound_input="$(bash_input "$over_bound_line")"
if [ "$(read_by pattern "$over_bound_input")" = "$over_bound_line" ]; then
  echo "ok: the pattern reader leaves an over-bound payload undecoded"; pass=$((pass + 1))
else
  echo "FAIL: the pattern reader decoded an over-bound payload"; fail=$((fail + 1))
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "skip: jq is absent here, so the bound has only one reader to hold for"
  skipped=$((skipped + 1))
elif [ "$(read_by jq "$over_bound_input")" = "$over_bound_line" ]; then
  echo "ok: jq leaves the same over-bound payload unread as the fallback"; pass=$((pass + 1))
else
  echo "FAIL: jq decoded an over-bound payload the fallback left alone"; fail=$((fail + 1))
fi

# A gate reading its envelope by pattern is a degraded gate; the log is the only
# place that difference can show up, and an armed session is the only place it may
# be written — see the invisibility cases above.
rm -f "$events_log"
( . "$PLUGIN/hooks/lib.sh"; JSON_READER=pattern; record_reader_fallback "$SESSION" )
if grep -q '"event":"jq-absent"' "$events_log"; then
  echo "ok: a gate that fell back to the pattern reader records it"; pass=$((pass + 1))
else
  echo "FAIL: jq-absent missing from telemetry — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
fi
oso-state --session "$SESSION" clear

# --- The commit's own boundary: the shipped git pre-commit hook ---------------
# A git hook parses no command line, so it sees what a matcher structurally cannot:
# a wrapper whose option arity no table can answer, an alias that never spells the
# verb, a remote or containerized shell. Every commit here happens in a throwaway
# repo under $TEST_HOME, which the EXIT trap removes.
GIT_HOOKS_DIR="$PLUGIN/git-hooks"
COMMIT_REPO="$TEST_HOME/commit-repo"
HUMAN_HOME="$TEST_HOME/human-terminal"
commit_attempts=0

arm_commit_repo() {
  mkdir -p "$COMMIT_REPO" "$HUMAN_HOME"
  git -C "$COMMIT_REPO" init -q
  git -C "$COMMIT_REPO" config core.hooksPath "$GIT_HOOKS_DIR"
  git -C "$COMMIT_REPO" config user.email tests@oso-code.invalid
  git -C "$COMMIT_REPO" config user.name "oso-code tests"
  git -C "$COMMIT_REPO" config commit.gpgsign false
  # `ci = commit` is the shape a real ~/.gitconfig carries, and the verb it hides
  # reaches none of the matcher's tables.
  git -C "$COMMIT_REPO" config alias.ci commit
}

# One attempt per case, with something staged so the commit has work to do. The
# shape runs as written — an agent's Bash line, env prefix and all — inside the
# repo, so git inherits the session variable the way it does in a real session.
attempt_commit() {
  local shape="$1" change
  commit_attempts=$((commit_attempts + 1))
  change="change-$commit_attempts.txt"
  printf '%s\n' "$change" > "$COMMIT_REPO/$change"
  git -C "$COMMIT_REPO" add "$change"
  if commit_output="$(cd "$COMMIT_REPO" && eval "$shape" 2>&1)"; then
    commit_rc=0
  else
    commit_rc=$?
  fi
}

# A commit that dies for another reason is not this gate firing, so the reason the
# operator would read has to be in the abort.
assert_commit_aborted() {
  local name="$1" shape="$2" reason="${3:-verify is not green}"
  attempt_commit "$shape"
  if [ "$commit_rc" = 0 ]; then
    echo "FAIL: $name — the commit landed"; fail=$((fail + 1))
    return 0
  fi
  case "$commit_output" in
    *"$reason"*) echo "ok: $name"; pass=$((pass + 1)) ;;
    *) echo "FAIL: $name — aborted without the gate's reason: ${commit_output:-<empty>}"; fail=$((fail + 1)) ;;
  esac
}

assert_commit_lands() {
  local name="$1" shape="$2"
  attempt_commit "$shape"
  if [ "$commit_rc" = 0 ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — the commit was aborted: ${commit_output:-<empty>}"; fail=$((fail + 1))
  fi
}

if ! command -v git >/dev/null 2>&1; then
  echo "skip: git is absent here, so the commit's own boundary has nothing to run"
  skipped=$((skipped + 1))
else
  arm_commit_repo

  # Invisibility, on the two shapes that own the operator's commits: a session the
  # plugin never armed, and a terminal with no session variable at all — a human's.
  oso-state --session "$SESSION" clear
  rm -f "$events_log"
  assert_commit_lands "a session with no state file commits untouched" 'git commit -m x'
  assert_commit_lands "a terminal with no session variable commits untouched" \
    "env -u CLAUDE_CODE_SESSION_ID HOME=$HUMAN_HOME git commit -m x"
  if [ ! -e "$events_log" ] && [ ! -e "$HUMAN_HOME/.local" ]; then
    echo "ok: neither allowed commit left a trace"; pass=$((pass + 1))
  else
    echo "FAIL: an allowed commit was recorded — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null), wrote: $(find "$HUMAN_HOME" 2>/dev/null | tr '\n' ' ')"; fail=$((fail + 1))
  fi

  oso-state --session "$SESSION" set mode=plan verify_green=false
  assert_commit_aborted "the git layer denies a commit while verify is red" 'git commit -m x'
  oso-state --session "$SESSION" set verify_green=true
  assert_commit_lands "the git layer lets a commit through once verify is green" 'git commit -m x'
  if grep -q '"event":"commit-denied"' "$events_log"; then
    echo "ok: the git layer records its deny as the matcher's event"; pass=$((pass + 1))
  else
    echo "FAIL: the git layer denied without telemetry — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
  fi

  # Both layers on one shape, which is the whole reason this one exists: the matcher
  # reads flock's lock-file argument as the program flock runs, and an alias hides
  # the verb from every table it has. Both come out clear, both reach the commit.
  oso-state --session "$SESSION" set verify_green=false
  alias_shape='git ci -m x'
  assert_allows "the matcher cannot see the verb behind a git alias" \
    block-commit-until-green.sh "$(bash_input "$alias_shape")"
  assert_commit_aborted "the commit's own boundary stops the alias" "$alias_shape"
  if command -v flock >/dev/null 2>&1; then
    flock_shape="flock $TEST_HOME/commit.lock git commit -m x"
    assert_allows "the matcher reads flock's lock file as the program it runs" \
      block-commit-until-green.sh "$(bash_input "$flock_shape")"
    assert_commit_aborted "the commit's own boundary stops what flock hid" "$flock_shape"
  else
    echo "skip: flock is absent here, so that wrapper shape has nothing to run"
    skipped=$((skipped + 1))
  fi

  # --no-verify is git's documented switch for skipping this hook and no hook can
  # refuse it. That is the division of labour rather than a hole: what the commit's
  # own boundary cannot see, the matcher does.
  assert_denies "the matcher is the layer that sees --no-verify" \
    block-commit-until-green.sh "$(bash_input 'git commit --no-verify -m x')"
  assert_commit_lands "--no-verify skips the git layer, as git documents" \
    'git commit --no-verify -m x'

  # Same polarity as the matcher: an armed session whose state cannot be read denies
  # rather than guessing.
  rm -f "$SESSION_STATE"
  mkdir -p "$SESSION_STATE"
  assert_commit_aborted "the git layer denies a state path it cannot read" \
    'git commit -m x' 'cannot be read'
  rmdir "$SESSION_STATE"
  oso-state --session "$SESSION" clear
fi

echo "----"
echo "passed: $pass, failed: $fail, skipped: $skipped"
[ "$fail" -eq 0 ]
