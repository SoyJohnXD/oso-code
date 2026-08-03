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
# `oso-state` names its file after the repository it is RUN in, so the suite's own
# directory is what most of these cases write through — pinned here, or a run
# started from somewhere else arms one repository and asserts against another.
cd "$REPO_ROOT"
# Spelled here rather than sourced from lib.sh on purpose: asserting the name
# independently is what catches a wrong rule in the code under test. Where git
# cannot answer — the bash:3.2 container CI runs this in carries none — the
# directory is the identity, which is the fallback the code takes too.
state_key_of() {
  local directory="$1" identity digest
  identity="$(git -C "$directory" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || identity=""
  digest="$(printf '%s' "${identity:-$directory}" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || digest=""
  printf '%s' "${digest%% *}"
}
STATE_DIR="$HOME/.local/state/oso-code"
REPO_STATE="$STATE_DIR/$(state_key_of "$REPO_ROOT").state"

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
  if [ "$#" -gt 4 ]; then shift 4; else set --; fi
  if hook_stdout="$(printf '%s' "$input" | "$hook" "$@" 2>"$stderr_file")"; then
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

# The same judgment for a case that runs the hook bare and then reads what it
# left behind: without the guard a hook that crashes after doing the work still
# reports ok. The predicate is a command, so a case spells it `[ … ]`.
assert_after_hook() {
  local name="$1"
  shift
  if [ -n "$hook_problem" ]; then
    echo "FAIL: $name — $hook_problem"; fail=$((fail + 1))
  elif "$@"; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — $* is false"; fail=$((fail + 1))
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

assert_equals() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected '$expected', got '$actual'"; fail=$((fail + 1))
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
    "$SESSION" "$TRANSCRIPT" "${2:-$REPO_ROOT}" "$1"
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
gated_tools="$(sed -n 's/.*"matcher"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$hooks_manifest" | tr '|' '\n' | LC_ALL=C sort | tr '\n' ' ')"
expected_tools="$(printf '%s\n' Bash Edit MultiEdit NotebookEdit Write mcp__fallow__fix_apply | LC_ALL=C sort | tr '\n' ' ')"
assert_equals "PreToolUse matchers cover exactly the gated tools" "$expected_tools" "$gated_tools"

unrunnable=""
manifest_commands="$(sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' "$hooks_manifest")"
while IFS= read -r manifest_command; do
  hook_script="${manifest_command//\\\"/}"
  hook_script="${hook_script//\$\{CLAUDE_PLUGIN_ROOT\}/$PLUGIN}"
  [ -x "$hook_script" ] || unrunnable="$unrunnable $hook_script"
done <<< "$manifest_commands"
assert_equals "every hooks.json command is an executable script" "" "$unrunnable"

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

# The clean-tree call above proves only that today's Codex bodies happen to be
# clean. Before S4, skill_sources followed the Claude wrapper alone, so the same
# forbidden acquisition command went red under platform/claude and silently green
# under platform/codex. Run the WHOLE linter over an isolated copy with exactly
# that mutation: a failure for any other reason does not clear the case, because
# the report must name the mutated Codex file and the remote-qualified ref rule.
copy_lint_fixture() {
  local destination="$1" lint_path
  mkdir -p "$destination"
  for lint_path in plugin codex docs bootstrap tests tools; do
    cp -R "$REPO_ROOT/$lint_path" "$destination/$lint_path"
  done
  cp "$REPO_ROOT/README.md" "$REPO_ROOT/CHANGELOG.md" "$destination/"
}

LINT_FIXTURE="$TEST_HOME/lint-fixture"
copy_lint_fixture "$LINT_FIXTURE"
codex_security_fixture="$LINT_FIXTURE/plugin/skills/_shared/platform/codex/security-pass.md"
if [ ! -f "$codex_security_fixture" ]; then
  echo "FAIL: the Codex lint mutation has no security-pass body to change"; fail=$((fail + 1))
else
  printf '\nRun `git diff origin/main...HEAD` for the review.\n' >> "$codex_security_fixture"
  if mutated_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" "$LINT_FIXTURE/plugin" "$LINT_FIXTURE" 2>&1)"; then
    echo "FAIL: a remote-qualified ref in the Codex body passed plugin lint"; fail=$((fail + 1))
  else
    case "$mutated_lint_report" in
      *"skills/_shared/platform/codex/security-pass.md"*"remote-qualified ref"*)
        echo "ok: a forbidden acquisition in a Codex body fails the host-aware lint"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the Codex lint mutation failed for the wrong reason — $(printf '%s' "$mutated_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# Codex invokes a skill by its bare, backticked name, not Claude's
# `oso-code:<name>`. Add a new Codex-only debt-sweep call to a mode whose source
# carries none of that emitter's terminal tokens. If call-site discovery still
# keys only on the Claude prefix, the mutation is invisible and the linter lies
# clean; the exact diagnostic proves the bare invocation was what made it red.
LINT_CALL_FIXTURE="$TEST_HOME/lint-call-fixture"
copy_lint_fixture "$LINT_CALL_FIXTURE"
codex_quick_fixture="$LINT_CALL_FIXTURE/plugin/skills/_shared/platform/codex/quick.md"
if [ ! -f "$codex_quick_fixture" ]; then
  echo "FAIL: the Codex call-site mutation has no quick body to change"; fail=$((fail + 1))
else
  printf '\nInvoke `debt-sweep` now.\n' >> "$codex_quick_fixture"
  if mutated_call_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" "$LINT_CALL_FIXTURE/plugin" "$LINT_CALL_FIXTURE" 2>&1)"; then
    echo "FAIL: a bare Codex skill call with no verdict vocabulary passed plugin lint"; fail=$((fail + 1))
  else
    case "$mutated_call_lint_report" in
      *"skills/quick/SKILL.md invokes debt-sweep on codex"*"none of its verdict tokens"*)
        echo "ok: a bare Codex call missing its emitter vocabulary fails lint"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the Codex call-site mutation failed for the wrong reason — $(printf '%s' "$mutated_call_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# --- Declarations: generated hooks and published trust hashes -----------------
# Rule 13 keeps the committed tree green; these mutations prove each half can go
# red for the reason it claims. The default-deny prefix and the load-bearing
# fragment are both required, so a missing executable or an unrelated parser
# crash cannot masquerade as enforcement.
HOOK_RENDERER="$REPO_ROOT/tools/render-hooks-json.sh"
assert_renderer_rejects() {
  local name="$1" expected="$2"
  shift 2
  local report
  if report="$("$HOOK_RENDERER" "$@" 2>&1)"; then
    echo "FAIL: $name — renderer accepted the mutation"; fail=$((fail + 1))
  else
    case "$report" in
      *"deny:"*"$expected"*) echo "ok: $name"; pass=$((pass + 1)) ;;
      *) echo "FAIL: $name — rejected for the wrong reason: ${report:-<empty>}"; fail=$((fail + 1)) ;;
    esac
  fi
}

if [ ! -x "$HOOK_RENDERER" ]; then
  echo "FAIL: hook-render mutations have no executable renderer"; fail=$((fail + 1))
else
  RENDER_FIXTURE="$TEST_HOME/render-fixture"
  copy_lint_fixture "$RENDER_FIXTURE"
  if [ ! -f "$RENDER_FIXTURE/plugin/hooks/hooks.json" ]; then
    echo "FAIL: manifest-divergence mutation has no Claude manifest"; fail=$((fail + 1))
  else
    printf '\n' >> "$RENDER_FIXTURE/plugin/hooks/hooks.json"
    assert_renderer_rejects "a committed manifest diverging by one byte fails the render check" \
      "rendered hooks diverge for claude at" \
      --repo-root "$RENDER_FIXTURE" --table "$RENDER_FIXTURE/tools/hook-gates.txt" --check
  fi

  INCOMPLETE_TABLE="$TEST_HOME/incomplete-hook-gates.txt"
  cp "$REPO_ROOT/tools/hook-gates.txt" "$INCOMPLETE_TABLE"
  # One tool spelling and no answer for the second host: this was the quiet-allow
  # shape D11 forbids. `none` would be an explicit answer; an absent cell is not.
  printf '\ntool  edits  FutureWriter\n' >> "$INCOMPLETE_TABLE"
  assert_renderer_rejects "an unknown writer with an incomplete host mapping is denied at render" \
    "tool for gate \`edits\` has no mapping for codex" \
    --repo-root "$REPO_ROOT" --table "$INCOMPLETE_TABLE" --check

  assert_equals "a Codex tool absent from the table is default-denied" deny \
    "$("$HOOK_RENDERER" --table "$REPO_ROOT/tools/hook-gates.txt" \
      --classify codex edits mystery_writer)"
  assert_equals "the none sentinel is never classified as a real Codex tool" deny \
    "$("$HOOK_RENDERER" --table "$REPO_ROOT/tools/hook-gates.txt" \
      --classify codex unknown none)"
  for collaboration_tool in send_input resume_agent close_agent; do
    assert_equals "$collaboration_tool is release-known to the Codex catch-all classifier" wired \
      "$("$HOOK_RENDERER" --table "$REPO_ROOT/tools/hook-gates.txt" \
        --classify codex unknown "$collaboration_tool")"
  done

  DISABLED_GATE_TABLE="$TEST_HOME/disabled-unknown-gate.txt"
  sed 's/^gate  unknown\(.*\)none   wired$/gate  unknown\1none   none/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$DISABLED_GATE_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$DISABLED_GATE_TABLE"; then
    echo "FAIL: disabled-gate mutation changed no table row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a disabled gate carrying tool mappings fails closed" \
      "disabled gate \`unknown\` has tool mappings for codex" \
      --repo-root "$REPO_ROOT" --table "$DISABLED_GATE_TABLE" --check
  fi

  NO_MATCHER_TABLE="$TEST_HOME/pretool-without-matcher.txt"
  sed '/^tool  commit/d' "$REPO_ROOT/tools/hook-gates.txt" > "$NO_MATCHER_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$NO_MATCHER_TABLE"; then
    echo "FAIL: matcherless-PreToolUse mutation removed no tool row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a wired PreToolUse gate with no matcher fails closed" \
      "wired PreToolUse gate \`commit\` has no matcher for claude" \
      --repo-root "$REPO_ROOT" --table "$NO_MATCHER_TABLE" --check
  fi

  INCOMPLETE_CATCHALL_TABLE="$TEST_HOME/catchall-without-bash.txt"
  sed '/^tool  unknown  none  Bash$/d' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$INCOMPLETE_CATCHALL_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$INCOMPLETE_CATCHALL_TABLE"; then
    echo "FAIL: incomplete-catchall mutation removed no Bash row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a specific gate cannot name a tool absent from the catch-all" \
      "tool \`Bash\` wired by gate \`commit\` is absent from unknown allowlist for codex" \
      --repo-root "$REPO_ROOT" --table "$INCOMPLETE_CATCHALL_TABLE" --check
  fi

  TRAVERSAL_TABLE="$TEST_HOME/traversal-hook-manifest.txt"
  sed 's|^\(host[[:space:]]*codex[[:space:]]*\)[^[:space:]]*|\1../escape.json|' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$TRAVERSAL_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$TRAVERSAL_TABLE"; then
    echo "FAIL: manifest-traversal mutation changed no host row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a host manifest path cannot traverse out of the repo" \
      "unsafe host manifest \`../escape.json\`" \
      --repo-root "$RENDER_FIXTURE" --table "$TRAVERSAL_TABLE" --write
  fi

  UNKNOWN_EVENT_TABLE="$TEST_HOME/unknown-hook-event.txt"
  sed 's/^gate  stale     SessionStart/gate  stale     FutureEvent/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$UNKNOWN_EVENT_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$UNKNOWN_EVENT_TABLE"; then
    echo "FAIL: unknown-event mutation changed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a gate cannot name an unsupported hook event" \
      "unknown event \`FutureEvent\` for gate \`stale\`" \
      --repo-root "$REPO_ROOT" --table "$UNKNOWN_EVENT_TABLE" --check
  fi

  MUTATED_HASHES="$TEST_HOME/hook-hashes-mismatch.txt"
  if [ ! -f "$REPO_ROOT/bootstrap/hook-hashes.txt" ]; then
    echo "FAIL: published-hash mutation has no release ledger"; fail=$((fail + 1))
  else
    hash_row_changed=0
    while IFS= read -r hash_line || [ -n "$hash_line" ]; do
      case "$hash_line" in
        ''|'#'*) printf '%s\n' "$hash_line" ;;
        *)
          if [ "$hash_row_changed" -eq 0 ]; then
            printf '%064d  %s\n' 0 "${hash_line#*  }"
            hash_row_changed=1
          else
            printf '%s\n' "$hash_line"
          fi
          ;;
      esac
    done < "$REPO_ROOT/bootstrap/hook-hashes.txt" > "$MUTATED_HASHES"
    if [ "$hash_row_changed" -eq 0 ]; then
      echo "FAIL: published-hash mutation read no hash row"; fail=$((fail + 1))
    else
      assert_renderer_rejects "a published hash changed by one digest fails closed" \
        "published hook hash mismatch: codex/hooks/hooks.json" \
        --repo-root "$REPO_ROOT" --table "$REPO_ROOT/tools/hook-gates.txt" \
        --hash-file "$MUTATED_HASHES" --check-hashes
    fi

    ONE_SPACE_HASHES="$TEST_HOME/hook-hashes-one-space.txt"
    hash_separator_changed=0
    while IFS= read -r hash_line || [ -n "$hash_line" ]; do
      case "$hash_line" in
        ''|'#'*) printf '%s\n' "$hash_line" ;;
        *)
          if [ "$hash_separator_changed" -eq 0 ]; then
            printf '%s %s\n' "${hash_line%%  *}" "${hash_line#*  }"
            hash_separator_changed=1
          else
            printf '%s\n' "$hash_line"
          fi
          ;;
      esac
    done < "$REPO_ROOT/bootstrap/hook-hashes.txt" > "$ONE_SPACE_HASHES"
    if [ "$hash_separator_changed" -eq 0 ]; then
      echo "FAIL: hash-separator mutation read no hash row"; fail=$((fail + 1))
    else
      assert_renderer_rejects "a published hash row with one separator space fails closed" \
        "published hash row must use exactly two spaces after the digest" \
        --repo-root "$REPO_ROOT" --table "$REPO_ROOT/tools/hook-gates.txt" \
        --hash-file "$ONE_SPACE_HASHES" --check-hashes
    fi
  fi
fi

# --- Runtime dispatch: Codex catch-all defaults unknown tools to deny ----------
# The table's classifier is a build-time contract; this is the runtime half. Its
# `.*` reaches every local tool call for which Codex emits PreToolUse; the hook
# becomes active only where oso-code state exists. That preserves ordinary Codex
# sessions while an armed harness run gets a closed allowlist rather than a future
# observable tool silently bypassing every named matcher.
UNKNOWN_TOOL_HOOK="$PLUGIN/hooks/block-unknown-tool.sh"
UNKNOWN_TOOL_ALLOWLIST='Bash|apply_patch|send_input|resume_agent|close_agent'
codex_tool_input() {
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{}}' \
    "$SESSION" "$REPO_ROOT" "$1"
}

hook_returned_deny() {
  case "$hook_stdout" in *'"permissionDecision":"deny"'*) return 0 ;; *) return 1 ;; esac
}

oso-state --session "$SESSION" clear
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "an unknown Codex tool stays untouched outside an oso-code run" \
  [ -z "$hook_stdout" ]

oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "a release-known Codex tool passes the armed catch-all" \
  [ -z "$hook_stdout" ]

for collaboration_tool in send_input resume_agent close_agent; do
  run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input "$collaboration_tool")" 0 '' \
    --allow "$UNKNOWN_TOOL_ALLOWLIST"
  assert_after_hook "$collaboration_tool passes the armed runtime catch-all" \
    [ -z "$hook_stdout" ]
done

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "an unknown Codex tool is denied while oso-code state is armed" \
  hook_returned_deny
oso-state --session "$SESSION" clear

# --- Declarations: the Codex floor the installer's pin has to read ------------
# The Codex port was designed against a CLI six versions behind what npm
# published, so every flag and schema it rests on was re-read and the version
# they were read from is DECLARED. Nothing else in the repo carries that number:
# the installer pins it, and a pin with no floor written down is `@latest` under
# another name. The decision file is therefore the surface, and lint rule 10 only
# asks whether it says where it landed — the number itself has no gate but this
# one, so the case reads it back and reports which half is missing.
codex_floor_declaration() {
  local decision baseline="" floor
  for decision in "$REPO_ROOT"/docs/decisions/0094-*.md; do
    [ -f "$decision" ] || continue
    baseline="$decision"
  done
  [ -n "$baseline" ] || { printf 'no decision file'; return; }
  floor="$(sed -n 's/^Minimum supported Codex: \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' "$baseline" | head -n 1)"
  [ -n "$floor" ] || { printf 'no semver marker'; return; }
  printf 'declared'
}
assert_equals "the Codex baseline decision declares its minimum version as a bare semver" \
  declared "$(codex_floor_declaration)"

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

# --- Both PreToolUse gates arm on the session their payload names -------------
# A PreToolUse hook has no agent environment to read — the client puts no
# CLAUDE_CODE_* variable in one, which is why every gate-written line in the
# event log carries an empty `client` field (ADR-0095) — so the session the
# payload names is the marker, and a payload naming none is nobody's call. That
# name used to pick the state file too; now the state file is the repository's
# and exists whether or not an agent is running, which leaves the marker as the
# only thing between either gate and a call it has no business judging.
unmarked_bash_input="$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' "$REPO_ROOT")"
unmarked_edit_input="$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.ts","old_string":"a","new_string":"b"}}' "$REPO_ROOT")"
oso-state --session "$SESSION" set mode=plan active_slice=none verify_green=false
assert_denies "the commit gate denies a marked call on the repo's red state" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_allows "the commit gate stays off a call naming no session, armed repo or not" \
  block-commit-until-green.sh "$unmarked_bash_input"
assert_denies "the edit gate denies a marked call while no slice is active" \
  block-edits-without-slice.sh "$edit_input"
assert_allows "the edit gate stays off a call naming no session, armed repo or not" \
  block-edits-without-slice.sh "$unmarked_edit_input"
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
# `sha256sum` and `shasum` are one tool spelled two ways, GNU and macOS, so this
# machine gets whichever of the pair it carries and skips the other — hiding both
# would hide the state file's name rather than jq. A required tool that went
# missing is no silent skip either: the gate would write the stderr this case
# reads as a trace.
for hook_tool in env bash cat dirname tr grep date mkdir sha256sum shasum; do
  hook_tool_path="$(type -P "$hook_tool")" || hook_tool_path=""
  [ -n "$hook_tool_path" ] || continue
  ln -s "$hook_tool_path" "$NOJQ_PATH/$hook_tool"
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
# Read out of the NEUTRAL bodies, which is where the keys are written: the binary
# and the flag that names the session are host spellings and live in each mode's
# platform file, so the span a mode instructs reads `oso-state set …` and the
# triple is the whole of what is left to check here.
partial_state_writes=""
skills_with_no_write=""
for state_writer in plan quick debug; do
  writes_read=0
  while IFS= read -r instructed_command; do
    case "$instructed_command" in
      *oso-state" set "*) writes_read=$((writes_read + 1)) ;;
      *) continue ;;
    esac
    case "$instructed_command" in
      *"set mode="*" active_slice="*" verify_green="*) ;;
      *) partial_state_writes="$partial_state_writes ${state_writer}:'${instructed_command}'" ;;
    esac
  done <<< "$(tr '`' '\n' < "$PLUGIN/skills/_shared/bodies/$state_writer.md")"
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

# --- Integration: the wrappers and the shared bodies they bind ---------------
# Each skill ships as a platform-neutral body plus a thin wrapper per host, and
# nothing else in this repo reads that relation: `claude plugin validate` reads
# frontmatter, and tests/plugin-lint.sh follows a reference without ever asking
# whether it points anywhere. Two ways that goes wrong and both are silent — a
# body nobody binds is a rule that ships and never loads, and two wrappers bound
# to DIFFERENT bodies are the duplication the split exists to end, one host's
# flow drifting from the other's while every file still validates.
CODEX_SKILLS="$REPO_ROOT/codex/skills"

sorted_words() {
  printf '%s\n' $1 | { grep -v '^$' || true; } | LC_ALL=C sort | tr '\n' ' '
}

# The reference is the only place the relation is written down, so it is what
# gets read — never the filename, which would make the check agree with itself.
bodies_bound_by() {
  sed -n 's|.*_shared/bodies/\([a-z][a-z-]*\)\.md.*|\1|p' "$@" | LC_ALL=C sort -u | tr '\n' ' '
}

harness_skills=""
paired_skills=""
divergent_pairs=""
wrapper_files=""
for wrapper in "$PLUGIN"/skills/*/SKILL.md "$CODEX_SKILLS"/*/SKILL.md; do
  [ -f "$wrapper" ] || continue
  wrapper_files="$wrapper_files $wrapper"
done
all_bound=" $(bodies_bound_by /dev/null $wrapper_files)"

for wrapper in "$PLUGIN"/skills/*/SKILL.md; do
  [ -f "$wrapper" ] || continue
  wrapped_skill="$(basename "$(dirname "$wrapper")")"
  harness_skills="$harness_skills $wrapped_skill"
  codex_wrapper="$CODEX_SKILLS/$wrapped_skill/SKILL.md"
  [ -f "$codex_wrapper" ] || continue
  paired_skills="$paired_skills $wrapped_skill"
  claude_binds="$(bodies_bound_by "$wrapper")"
  codex_binds="$(bodies_bound_by "$codex_wrapper")"
  [ "$claude_binds" = "$codex_binds" ] \
    || divergent_pairs="$divergent_pairs ${wrapped_skill}(claude:${claude_binds:-none}codex:${codex_binds:-none})"
done

# Every body on disk, tagged with whether a wrapper binds it, plus every body a
# wrapper binds that is not on disk — so an orphan, a dangling reference and a
# body named after no skill each read as their own word against the skill list.
body_ledger=""
for shared_body in "$PLUGIN"/skills/_shared/bodies/*.md; do
  [ -f "$shared_body" ] || continue
  body_name="$(basename "$shared_body" .md)"
  case "$all_bound" in
    *" $body_name "*) body_ledger="$body_ledger $body_name" ;;
    *) body_ledger="$body_ledger $body_name(unbound)" ;;
  esac
done
for body_name in $all_bound; do
  [ -f "$PLUGIN/skills/_shared/bodies/$body_name.md" ] \
    || body_ledger="$body_ledger $body_name(missing)"
done

assert_equals "every skill's neutral body exists and a wrapper binds it" \
  "$(sorted_words "$harness_skills")" "$(sorted_words "$body_ledger")"
assert_equals "the two wrappers of a skill bind the same neutral body" \
  "" "$divergent_pairs"
assert_equals "every skill ships a wrapper on both hosts" \
  "$(sorted_words "$harness_skills")" "$(sorted_words "$paired_skills")"

# --- Integration: what /plan has to SAY for a wave to be runnable at all ------
# The slicing phase is prose, so a rule the shipped file does not carry is one
# the orchestrator improvises per run: a threshold nobody spelled, a field
# nobody declared, a base ref nobody ruled out. Each table line below is one
# phrase its section has to carry, and the section is cut out of the file first
# — a rule that drifted into a neighbouring phase fails here instead of passing
# on a file-wide scan. The file is the NEUTRAL body: plan/SKILL.md is a wrapper
# that binds it, and every phase these tables read lives on the far side of that
# reference.
PLAN_BODY="$PLUGIN/skills/_shared/bodies/plan.md"
plan_section() {
  sed -n "/^## $1\. /,/^## [0-9]/p" "$PLAN_BODY"
}

# The anti-vacuity half, from both sides: a table that read empty proved nothing,
# and a section heading that moved would hand every line an empty haystack — the
# first is its own FAIL, the second surfaces as every phrase going unsaid.
assert_says_every() {
  local name="$1" section="$2" phrase unsaid="" phrases_read=0
  while IFS= read -r phrase; do
    [ -n "$phrase" ] || continue
    phrases_read=$((phrases_read + 1))
    case "$section" in *"$phrase"*) ;; *) unsaid="$unsaid \"$phrase\"" ;; esac
  done
  if [ "$phrases_read" -eq 0 ]; then
    echo "FAIL: $name — the table read empty, so the scan proved nothing"; fail=$((fail + 1))
  elif [ -z "$unsaid" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — never said:$unsaid"; fail=$((fail + 1))
  fi
}

assert_says_every "the slicing phase ships its graph, its waves and its mode choice" \
  "$(plan_section 4)" <<'SLICING_TABLE'
**Depends-on**
never by the target execution mode
a CONTRACT and its consumers
SHARED STATE
a DATA FLOW
VERIFICATION-BAR COUPLING
Wave 0 is the design-foundation slice, alone
Recommend parallel when the widest wave is 3 or more
concurrency cap defaults to 4
SLICING_TABLE

assert_says_every "the Verification row rules parallel out of a change with no base ref" \
  "$(plan_section 3)" <<'VERIFICATION_ROW_TABLE'
makes PARALLEL execution unavailable
answers it at the first wave
VERIFICATION_ROW_TABLE

# The same row is the only place a project can turn the per-slice commit off,
# and no store, no file and no hook records that choice — so the row's own prose
# is the whole mechanism. Both halves are load-bearing in opposite directions: a
# default nobody wrote down is a question asked once per slice, and an opt-out
# nobody wrote down is a project with no way to decline commits it cannot take.
assert_says_every "the Verification row settles per-slice commits, on by default" \
  "$(plan_section 3)" <<'PER_SLICE_COMMIT_PREFERENCE_TABLE'
per-slice commits are ON
turns them off HERE, the only place it is settled
PER_SLICE_COMMIT_PREFERENCE_TABLE

# The sequential path lands its commit in one specific window — the green step 4
# writes, which the next slice's step 1 takes back — and nothing outside this
# prose says so: the hooks read one flag and would let that commit go anywhere
# inside it, so a step that names no command lands no commit at all and a step
# that names the wrong boundary lands one the rail denies. The second line is the
# other half of the change's whole point: what step 4 does is a commit, and the
# push is not its business.
assert_says_every "the sequential path commits each slice it takes green" \
  "$(plan_section 6)" <<'SEQUENTIAL_COMMIT_TABLE'
git -C <main checkout> commit
a COMMIT and never a push
SEQUENTIAL_COMMIT_TABLE

# The wave loop is prose too, and the steps nobody wrote down are the ones an
# orchestrator improvises: a state write missing the key a teardown reads, a
# commit with no window to pass the rail, a merge nobody launched, an
# integration gate nobody ran. Split from the routing table below because the
# two answer different questions — how a wave RUNS, and what happens when it
# does not.
assert_says_every "the execution phase runs a wave from activation to integration" \
  "$(plan_section 6)" <<'WAVE_LOOP_TABLE'
active_slice=wave-<n> verify_green=false repo_path=
git -C <main checkout> worktree add -b oso/<change>/<slice>
event worktree-created
in ONE message
that the slice runs in PARALLEL
the GREEN WINDOW
active_slice=wave-<n> verify_green=true
which re-arms the wave
the rail is open SESSION-WIDE
accidental-bypass window the harness accepts deliberately
A wave integrates only when EVERY slice in it is green
launch the `oso-integrator` agent
INTEGRATION verdict shape
does the wave close
WAVE_LOOP_TABLE

# The other half: every way a wave fails has one route and only one, and the
# two that reach outside a single wave — the concurrency question §3 could only
# record, and the offer that walks the change back to sequential.
assert_says_every "the execution phase routes every way a wave fails" \
  "$(plan_section 6)" <<'WAVE_FAILURE_TABLE'
**A red slice**
THE ORCHESTRATOR NEVER RESOLVES IT
event merge-conflict
the whole wave returns AS A UNIT
sending that slice back is sending the victim
event integration-red
as a NEW SLICE through the normal apply → verify loop
Write the answer into the ledger's §3 Verification row
the VERIFICATIONS serialize
finish the remaining slices SEQUENTIALLY
unrelated to the entire WAVE
WAVE_FAILURE_TABLE

# Which of those routes a red wave takes turns on attribution, and the linter
# cannot reach that: rule 6 only sees a call site once one exists, so a wave loop
# that never invokes the triage judge reads clean there and goes back to deciding
# blame by eye. Each line below is one thing lint cannot check — that the judge is
# invoked at all, and that each of its three verdicts leaves by a different door:
# the wave's own failure routing, the operator's stop-the-line offer, and the
# answer that is neither, which may never be quietly filed as one of them.
assert_says_every "the execution phase triages a red wave before routing it" \
  "$(plan_section 6)" <<'WAVE_TRIAGE_TABLE'
INVOKE the triage judge
it takes the failure routing above unchanged
the stop-the-line paragraph above runs with triage's evidence in hand
never read as either answer
WAVE_TRIAGE_TABLE

# A worktree the close leaves standing is a registration the next run's
# `git worktree add` dies on, and the branch behind it is that same failure under
# a second name. The integrator disposes of both only on a wave that merged
# clean, so the waves this paragraph exists for — conflict-stopped, exited back
# to sequential, never integrated — reach the close with both halves standing,
# and no hook covers either: the teardown removes trees and prunes
# registrations, and a change that closes while the session goes on never
# reaches it. Branch deletion is therefore the close's own, and it is gated from
# both sides: an unmerged branch holds the only copy of a slice's committed work,
# so neither deleting it nor leaving it may happen behind the operator.
assert_says_every "the close clears the trees and branches parallel execution left behind" \
  "$(plan_section 7)" <<'CLOSE_CLEANUP_TABLE'
still standing is removed through git
worktree prune
git worktree add
branch -d oso/<change>/<slice>
after the trees and never before
never `-D`
the only copy of that slice's committed work
left standing without the operator hearing
CLOSE_CLEANUP_TABLE

# Where the boundary sits is prose in the close and nowhere else: the commit rail
# gates a commit on the green, never on an ask, so the only thing that can say
# which operations wait for the operator is this step. Both lines are needed and
# neither implies the other — a close that says only the first commits and then
# pushes unasked, one that says only the second is the boundary this change
# retired, asking for a commit the flow already landed once per slice.
assert_says_every "the close asks for a push and a PR, never for a commit" \
  "$(plan_section 7)" <<'COMMIT_BOUNDARY_TABLE'
A COMMIT is part of the flow and is never asked for
PUSH and PR are the two that still require the operator to ask
COMMIT_BOUNDARY_TABLE

# The same trees from the other end: the close clears the ones the operator
# reached, and the resume is where they hear about the ones nobody did. No hook
# covers that either — warn-stale-state.sh reports state FILES and is right not
# to grow a second remit — and the session that could have looked them up in its
# own state is the one that ended, so the entry point reads git's registry or
# nothing does. A resume that stays silent hands the operator a change whose
# next `worktree add -b` dies on a branch name nobody mentioned.
assert_says_every "the resume check reports the worktrees a previous session left standing" \
  "$(plan_section 0)" <<'RESUME_WORKTREES_TABLE'
git -C <main checkout> worktree list
report every worktree of this change still standing
oso/<change>/<slice>
RESUME_WORKTREES_TABLE

# The integrator's own teardown answers to git, not to taste: git refuses to
# delete a branch a standing worktree still has checked out, and no force
# overrides that refusal, so an agent told to delete branches first stops at its
# first step on every wave it merged clean. Its prose is the whole specification
# — no hook and no schema sees the order — so the order and the reason it is
# that way are pinned here. Scanned whole-file rather than by section:
# `plan_section` cuts on the plan body's numbered phase headings, and this
# file's headings are named.
assert_says_every "the integrator removes worktrees before deleting the branches they hold" \
  "$(cat "$PLUGIN/agents/oso-integrator.md")" <<'TEARDOWN_ORDER_TABLE'
remove the wave's worktrees first, then delete its branches
git refuses to delete a branch a standing worktree still has checked out
TEARDOWN_ORDER_TABLE

# The Codex bodies are also read directly for one host claim outside the
# linter's thirteen decidable rules. Rules 3, 4, 6 and 8 now follow both hosts,
# but none asks whether a platform body falsely claims another host's installation
# policy as its own. What that would let through is the absence policy in
# `_shared/front-surface.md` is Claude-spelled end to end — its remedy is a
# `/plugin marketplace add` and a `/plugin install` this host has no command for
# — so a Codex body saying the policy is taken here, or reading that two-step
# install back to the operator, ships a route nobody on this host can follow.
# Each probe below is a SHAPE and not a sentence, so a reworded return fails it
# too, and the scan reads the whole tree rather than the three files carrying the
# disclaimer today.
CODEX_PLATFORM="$PLUGIN/skills/_shared/platform/codex"
report_when_unclaimed() {
  local verdict="$1" claim_shape="$2"
  grep -Eiq "$claim_shape" "$CODEX_PLATFORM"/*.md || printf '%s\n' "$verdict"
}

# Same anti-vacuity as the tables above, from the tree's side: a platform
# directory that moved would answer every probe clean, so it answers none.
codex_absence_policy_report() {
  local body bodies_read=0
  local verbs='take[ns]?|taking|follow(s|ed)?|appl(y|ies|ied)|keeps?|kept|inherit(s|ed)?|unchanged|as[- ]is'
  for body in "$CODEX_PLATFORM"/*.md; do
    if [ -f "$body" ]; then bodies_read=$((bodies_read + 1)); fi
  done
  if [ "$bodies_read" -eq 0 ]; then
    printf 'the Codex platform tree read empty\n'
    return
  fi
  report_when_unclaimed "no Codex body takes the absence policy as its own" \
    "(${verbs})[^.]{0,40}absence policy|absence policy[^.]{0,60}(${verbs}|the same)"
  report_when_unclaimed "no Codex body reads the two-step Claude install back" \
    'plugin marketplace add|pbakaus/impeccable|impeccable@impeccable|plugin install impeccable'
}

assert_says_every "no Codex body claims the Claude-spelled absence policy is taken" \
  "$(codex_absence_policy_report)" <<'ABSENCE_POLICY_TABLE'
no Codex body takes the absence policy as its own
no Codex body reads the two-step Claude install back
ABSENCE_POLICY_TABLE

# --- Integration: the env var the skills instruct is the one hooks look up ---
export CLAUDE_CODE_SESSION_ID="$SESSION"
bash -c 'oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false'
assert_denies "skill-documented env var arms the gate" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" clear

# --- Identity: one repository, one state file --------------------------------
# The whole point of keying by the repository: an applier commits inside a wave's
# worktree and the gate firing there has to read the state the orchestrator armed
# in the main checkout. `--git-common-dir` alone does not answer that — it is a
# relative `.git` in the main checkout and an absolute path in a linked worktree
# — so the case reads the name back from three trees of one repo and fails on any
# spelling that splits them. Needs git twice over: for the identity and for a
# worktree to ask it from.
KEY_REPO="$TEST_HOME/identity-repo"
KEY_WORKTREE="$TEST_HOME/identity-worktree"

state_key_written_from() {
  local directory="$1"
  rm -f "$STATE_DIR"/*.state
  ( cd "$directory" && oso-state --session "$SESSION" set mode=plan >/dev/null )
  basename "$(ls "$STATE_DIR"/*.state)" .state
}

if ! command -v git >/dev/null 2>&1; then
  echo "skip: git is absent here, so one repository has no second tree to answer from"
  skipped=$((skipped + 1))
else
  mkdir -p "$KEY_REPO"
  git -C "$KEY_REPO" init -q
  git -C "$KEY_REPO" config user.email tests@oso-code.invalid
  git -C "$KEY_REPO" config user.name "oso-code tests"
  git -C "$KEY_REPO" config commit.gpgsign false
  printf 'base\n' > "$KEY_REPO/base.txt"
  git -C "$KEY_REPO" add base.txt
  git -C "$KEY_REPO" commit -qm base
  git -C "$KEY_REPO" worktree add -q -b oso/identity "$KEY_WORKTREE"
  mkdir -p "$KEY_REPO/nested" "$KEY_WORKTREE/nested/deeper"

  expected_key="$(state_key_of "$KEY_REPO")"
  keys_written=""
  for tree in "$KEY_REPO" "$KEY_REPO/nested" "$KEY_WORKTREE" "$KEY_WORKTREE/nested/deeper"; do
    keys_written="$keys_written $(state_key_written_from "$tree")"
  done
  assert_equals "one repository names one state file from every tree of it" \
    "$expected_key $expected_key $expected_key $expected_key" "${keys_written# }"

  # And the other half: a DIFFERENT repository is a different file, or the key is
  # a constant that happens to agree with itself everywhere.
  assert_equals "a second repository names a second state file" "different" \
    "$([ "$(state_key_written_from "$REPO_ROOT")" != "$expected_key" ] && echo different || echo collided)"

  git -C "$KEY_REPO" worktree remove --force "$KEY_WORKTREE"
  git -C "$KEY_REPO" worktree prune
  rm -rf "$KEY_REPO"
fi
rm -f "$STATE_DIR"/*.state

# A path is a far richer input than a session id, and the name it becomes is what
# has to be checked, because no sanitizer keeps two repositories apart: dropping
# every byte outside `[a-zA-Z0-9-]` maps `/home/a/b` onto `/homeab`, translating
# each of them to a dash maps `my_app`, `my-app`, `my app` and `my.app` onto one
# another — a dash is inside that charset too — and a name has a length besides.
# One name for two repositories is the red one's commit gate reading the green
# one's flag, so every way a name can collapse is probed, not one shape of one.
state_file_of() { ( . "$PLUGIN/hooks/lib.sh"; state_file_for "$1" ); }
traversal_state="$(state_file_of '/tmp/../../../etc/passwd')"
# What is left of the name once the state dir is stripped off it — the whole of
# it, if the name never was under that dir. bash 3.2 ends a `$( )` at the first
# unbalanced `)`, and a case pattern's own is one, so the verdict is reached here
# rather than inside the assert's argument.
traversal_name="${traversal_state#"$STATE_DIR/"}"
case "$traversal_name" in
  */*|*..*|*[!a-zA-Z0-9.-]*) traversal_verdict=escaped ;;
  *) traversal_verdict=inside ;;
esac
assert_equals "a traversal-shaped repo path names a file inside the state dir" \
  "inside" "$traversal_verdict"
sibling_keys=""
for sibling in my_app my-app 'my app' my.app app.web app-web; do
  sibling_keys="${sibling_keys}$(state_file_of "$TEST_HOME/siblings/$sibling")"$'\n'
done
distinct_sibling_keys="$(printf '%s' "$sibling_keys" | sort -u | wc -l)"
assert_equals "sibling repositories differing only by a dashable byte keep six names" \
  6 "$((distinct_sibling_keys))"
assert_equals "a path and that path with its separators gone keep two names" "distinct" \
  "$([ "$(state_file_of /home/a/b)" != "$(state_file_of /homeab)" ] && echo distinct || echo collided)"
# The length half of the same class: `NAME_MAX` does not truncate, it refuses, so
# a repository nested deep enough got no state file written and the gate then
# read no state at all — an allow. A digest is fixed-length, so depth is not
# something the name can run out of.
DEEP_REPO="$TEST_HOME/deep"
while [ "${#DEEP_REPO}" -lt 300 ]; do DEEP_REPO="$DEEP_REPO/nested-directory-name"; done
mkdir -p "$DEEP_REPO"
# A name too long to write is `oso-state` spinning on a lock it can never make,
# so the arming is allowed to fail here and the gate below is what reports it —
# an aborted run would take the rest of the suite with it.
( cd "$DEEP_REPO" && oso-state --session "$SESSION" set mode=plan verify_green=false ) >/dev/null 2>&1 || true
assert_denies "a repository nested past NAME_MAX still arms its commit gate" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x' "$DEEP_REPO")"
( cd "$DEEP_REPO" && oso-state --session "$SESSION" clear ) >/dev/null 2>&1 || true
rm -rf "$TEST_HOME/deep"
# And where no digest can be computed at all, a name every repository would share
# is the one answer that must not come back.
no_digest_rc=0
( . "$PLUGIN/hooks/lib.sh"; PATH="$TEST_HOME/no-tools"; state_file_for /repo ) >/dev/null 2>&1 ||
  no_digest_rc=$?
assert_equals "a host that can spell no digest blocks instead of naming every repo alike" \
  2 "$no_digest_rc"

# --- Concurrency: parallel writers must not lose keys ---
( for i in $(seq 1 25); do oso-state --session "$SESSION" set "a=$i" >/dev/null; done ) &
( for i in $(seq 1 25); do oso-state --session "$SESSION" set "b=$i" >/dev/null; done ) &
wait
assert_equals "concurrent writers preserve all keys" "a=25 b=25" \
  "a=$(oso-state --session "$SESSION" get a) b=$(oso-state --session "$SESSION" get b)"
oso-state --session "$SESSION" clear

# --- Stale lock: a crashed writer's lock is reclaimed, not fatal ---
stale_lock="$REPO_STATE.lock"
mkdir -p "$stale_lock"
touch -t 200001010000 "$stale_lock"
oso-state --session "$SESSION" set stale_ok=yes >/dev/null 2>&1 || true
assert_equals "stale lock is reclaimed" yes "$(oso-state --session "$SESSION" get stale_ok)"
oso-state --session "$SESSION" clear

# --- A fourth key beside the triple: the repo the session works in ------------
# `set` takes whatever key it is handed, so nothing had to be written for the
# session to carry the repo path a worktree teardown runs `git worktree prune`
# in. That is exactly why it is a case: the gates read the triple by name, and a
# key appended after it may not cost any of the three.
oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false repo_path="$REPO_ROOT"
assert_equals "a key beside the triple is stored and read back" \
  "$REPO_ROOT" "$(oso-state --session "$SESSION" get repo_path)"
state_shown="$(oso-state --session "$SESSION" show)"
keys_lost_to_the_fourth=""
for triple_key in mode active_slice verify_green; do
  case "$state_shown" in
    *"$triple_key="*) ;;
    *) keys_lost_to_the_fourth="$keys_lost_to_the_fourth $triple_key" ;;
  esac
done
assert_equals "the whole triple survives a fourth key beside it" "" "$keys_lost_to_the_fourth"

# The one key no caller writes: the file is the REPOSITORY's, and SessionEnd runs
# in no directory that could name one, so which session armed the state is the
# only way back to the file it left. Written by `set` from the flag it already
# takes, beside whatever the caller asked for.
assert_equals "a write records the session that armed the state" \
  "$SESSION" "$(oso-state --session "$SESSION" get session)"
oso-state --session "$SESSION" clear

# --- Telemetry: denies are recorded ---
# Every oso-state set logs an event, so a non-empty log proves nothing; the
# audit is only worth having if a gate that fired left its own line behind.
events_log="$STATE_DIR/events.jsonl"

# A marker is a pattern unless the case passes -F, which the markers whose text
# carries backslashes need: read as a pattern, an escape matches the byte it
# escapes and the case passes on a log line nobody escaped.
assert_logged() {
  local name="$1" match=-e marker unlogged=""
  shift
  case "$1" in -F) match=-F; shift ;; esac
  for marker in "$@"; do
    grep -q "$match" "$marker" "$events_log" 2>/dev/null || unlogged="$unlogged $marker"
  done
  if [ -z "$unlogged" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — never logged:$unlogged — log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"; fail=$((fail + 1))
  fi
}

# The other half of the audit, where the absence of a line is the case. A home
# passed here is one the run may not have written a thing under.
assert_not_logged() {
  local name="$1" untouched_home="${2:-}" trace=""
  [ ! -e "$events_log" ] || trace="$trace log: $(tr '\n' ' ' < "$events_log" 2>/dev/null)"
  if [ -n "$untouched_home" ] && [ -e "$untouched_home/.local" ]; then
    trace="$trace wrote: $(find "$untouched_home" 2>/dev/null | tr '\n' ' ')"
  fi
  if [ -z "$trace" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name —$trace"; fail=$((fail + 1))
  fi
}

assert_logged "both gates log their denies" '"event":"commit-denied"' '"event":"edit-denied"'

# --- Telemetry: the branches no gate and no state write can record ------------
# A worktree created, a merge conflict, a red integration — none of them is a
# tool call or a state write, so without a verb of its own each is an event the
# audit never gets. The verb writes through the same log_event the gates do, and
# the line shape is what says so: one line, the type where a gate's event stands
# and the detail where its command text stands.
rm -f "$events_log"
oso-state --session "$SESSION" event worktree-created "git worktree add ../oso-wt-3"
assert_logged "the event verb records its type and its detail" \
  '"event":"worktree-created","command":"git worktree add ../oso-wt-3","session":"'
assert_equals "one event is one line, appended and nothing else" \
  1 "$(grep -c '' "$events_log")"
oso-state --session "$SESSION" event integration-red
assert_logged "an event with no detail is a well-formed line too" \
  '"event":"integration-red","command":"","session":"'

# --- Session-end cleanup + path traversal safety ---
oso-state --session "$SESSION" set mode=plan verify_green=true
mkdir -p "$REPO_STATE.lock"
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
assert_after_hook "session end removes state"         [ ! -f "$REPO_STATE" ]
assert_after_hook "session end removes leftover lock" [ ! -d "$REPO_STATE.lock" ]
touch "$HOME/canary"
run_hook cleanup-state.sh '{"session_id":"../../canary"}'
assert_after_hook "traversal session id cannot delete outside state dir" [ -f "$HOME/canary" ]

# The hook runs in no working directory of its own, so it can no more compute the
# name a repository gives its state file than it can guess the repo path it prunes
# in: it sweeps for the session the file recorded. Armed from another directory
# entirely, dropped by a run standing in this one.
ELSEWHERE="$TEST_HOME/state-armed-elsewhere"
mkdir -p "$ELSEWHERE"
( cd "$ELSEWHERE" && oso-state --session sessionend-probe set mode=plan verify_green=true >/dev/null )
elsewhere_state="$STATE_DIR/$(state_key_of "$ELSEWHERE").state"
# The arming is asserted before the teardown, or a name nothing ever wrote would
# read as a name the teardown swept.
assert_equals "a write names its own directory, not the one the suite stands in" \
  "written" "$([ -f "$elsewhere_state" ] && echo written || echo missing)"
run_hook cleanup-state.sh '{"session_id":"sessionend-probe"}'
assert_after_hook "session end drops the state of a directory it is not standing in" \
  [ ! -f "$elsewhere_state" ]

# --- SessionStart: OSO_STATE_BIN reaches the real oso-state binary ---
# The skills invoke "${OSO_STATE_BIN:-oso-state}"; this hook is what makes that
# env var land in the session, so assert it resolves to a runnable binary.
env_file="$(mktemp)"
export CLAUDE_ENV_FILE="$env_file"
run_hook persist-state-bin.sh ''
persisted="$(. "$env_file"; printf '%s' "${OSO_STATE_BIN:-}")"
assert_after_hook "SessionStart persists OSO_STATE_BIN to an executable" [ -x "$persisted" ]
rm -f "$env_file"

# No CLAUDE_ENV_FILE must degrade to a silent no-op (Windows-safe old behavior).
unset CLAUDE_ENV_FILE
run_hook persist-state-bin.sh ''
assert_after_hook "SessionStart no-ops when CLAUDE_ENV_FILE is unset" [ -z "$hook_stdout" ]

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
mkdir -p "$REPO_STATE"
assert_denies "commit gate denies a state path that is not a readable file" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_denies "edit gate denies a state path that is not a readable file"   block-edits-without-slice.sh "$edit_input"
# A line the lexer calls clear is the one shape that could have left the gate open
# while it crashed: the verdict is read after the state check, under the armed ERR
# trap, so an armed session the gate cannot read denies whatever the line says.
assert_denies "commit gate denies an unreadable state even for a line that looks clear" \
  block-commit-until-green.sh "$(bash_input 'npm test')"
rmdir "$REPO_STATE"
assert_logged "an unreadable state file is recorded" '"event":"state-unreadable"'

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
assert_logged "quotes and backslashes are escaped in the event log" -F '"event":"set:weird=a\"b\\c"'
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
assert_logged "events carry the client build" '"client":"'

# --- Drift: a payload the gate cannot parse passes, but never silently ---
assert_allows "an unparseable payload does not gate the call" block-commit-until-green.sh '{"tool_name":"Bash"}'
assert_logged "an unparseable payload is recorded" '"event":"payload-unparseable"'
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
assert_pruned "the ending session's own state is still removed"       "$REPO_STATE"
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

# --- Worktree teardown: the survivor of a parallel wave, at SessionEnd --------
# Removing the directory is only half a teardown, so every case here reads git's
# own registry too: a worktree deleted behind git's back stays in .git/worktrees,
# and the next `git worktree add` for that slice fails on a name nothing on disk
# shows. The directory being gone is exactly the half a plain `rm -rf` gets right.
WORKTREES_DIR="$STATE_DIR/worktrees"
WORKTREE_REPO="$TEST_HOME/worktree-repo"
VANISHED_REPO="$TEST_HOME/vanished-repo"

# A session that never armed a wave carries no repo_path, so nothing says where
# to prune — and removing the directory anyway is that corruption rather than a
# cleanup. Needs no git, which is the one thing this whole section can assume.
# The state file's NAME is arbitrary from here down: the teardown finds a file by
# the `session=` key inside it, and one file per session is what lets these cases
# hold a lock and an mtime apart that a single repository's file could not.
mkdir -p "$WORKTREES_DIR/wt-no-repo/1"
printf 'mode=plan\nsession=wt-no-repo\n' > "$STATE_DIR/wt-no-repo.state"
run_hook cleanup-state.sh '{"session_id":"wt-no-repo"}'
assert_pruned "a state file naming no repo is still removed"            "$STATE_DIR/wt-no-repo.state"
assert_kept   "a worktree with no repo to prune in is left where it is" "$WORKTREES_DIR/wt-no-repo/1"
rm -rf "$WORKTREES_DIR/wt-no-repo"

# The contrast to the case above: a session whose state file the sweep never
# found names nothing at all, and leaving the worktree standing is the right
# answer to that too — a directory removed with nowhere to prune in is a
# registration nobody can clear. Needs no git for the same reason: nothing asks
# git before that branch.
mkdir -p "$WORKTREES_DIR/wt-unfound/1"
run_hook cleanup-state.sh '{"session_id":"wt-unfound"}'
assert_kept "the worktree of a session with no state file at all is left standing" \
  "$WORKTREES_DIR/wt-unfound/1"
rm -rf "$WORKTREES_DIR/wt-unfound"

# What git still believes about one session's worktrees — the half no `[ -d ]`
# can answer, since a removed-by-hand worktree stays listed until the prune runs.
worktrees_registered_for() {
  git -C "$WORKTREE_REPO" worktree list --porcelain 2>/dev/null | grep -c "/worktrees/$1/" || true
}

arm_repo_at() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email tests@oso-code.invalid
  git -C "$repo" config user.name "oso-code tests"
  git -C "$repo" config commit.gpgsign false
  printf 'base\n' > "$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -qm base
}

# One armed wave: a linked worktree where the orchestrator puts it, the state key
# that says which repo the teardown has to prune in, and the session that names
# the file as its own.
arm_wave_for() {
  local session_id="$1" repo="$2"
  mkdir -p "$WORKTREES_DIR/$session_id"
  git -C "$repo" worktree add -q -b "oso/parallel/$session_id" "$WORKTREES_DIR/$session_id/1"
  printf 'mode=plan\nrepo_path=%s\nsession=%s\n' "$repo" "$session_id" > "$STATE_DIR/$session_id.state"
}

if ! command -v git >/dev/null 2>&1; then
  echo "skip: git is absent here, so a worktree teardown has no registry to read"
  skipped=$((skipped + 1))
else
  arm_repo_at "$WORKTREE_REPO"
  rm -f "$events_log"

  # The survivor of a wave that never integrated is the ending session's own.
  arm_wave_for "$SESSION" "$WORKTREE_REPO"
  registered_before="$(worktrees_registered_for "$SESSION")"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_pruned "session end removes the session's worktree tree" "$WORKTREES_DIR/$SESSION"
  assert_equals "session end leaves nothing of it registered in the repo" "1 -> 0" \
    "$registered_before -> $(worktrees_registered_for "$SESSION")"
  assert_logged "a teardown leaves an audit line no gate could have written" \
    '"event":"worktree-removed"'

  # The 7-day sweep owes the same teardown to a session that never reached
  # SessionEnd, read from that session's own state file.
  arm_wave_for wt-abandoned "$WORKTREE_REPO"
  touch -t 200001010000 "$STATE_DIR/wt-abandoned.state"
  abandoned_before="$(worktrees_registered_for wt-abandoned)"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_pruned "the 7-day sweep removes an abandoned session's worktree tree" \
    "$WORKTREES_DIR/wt-abandoned"
  assert_equals "the 7-day sweep leaves nothing of it registered either" "1 -> 0" \
    "$abandoned_before -> $(worktrees_registered_for wt-abandoned)"

  # The sweep's live-lock guard covers the worktree too: a held lock is exactly
  # what a wave still running looks like, whatever the state file's age says.
  arm_wave_for wt-locked "$WORKTREE_REPO"
  touch -t 200001010000 "$STATE_DIR/wt-locked.state"
  mkdir -p "$STATE_DIR/wt-locked.state.lock"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_kept "a worktree whose session holds a live lock survives the sweep" \
    "$WORKTREES_DIR/wt-locked/1"
  rm -rf "$STATE_DIR/wt-locked.state.lock" "$STATE_DIR/wt-locked.state"
  git -C "$WORKTREE_REPO" worktree remove --force "$WORKTREES_DIR/wt-locked/1"
  rmdir "$WORKTREES_DIR/wt-locked"

  # A run killed mid-wave leaves the directory gone and the registration behind,
  # and only the prune clears it — the case a delete-without-prune cannot pass.
  arm_wave_for wt-crashed "$WORKTREE_REPO"
  rm -rf "$WORKTREES_DIR/wt-crashed/1"
  crashed_before="$(worktrees_registered_for wt-crashed)"
  run_hook cleanup-state.sh '{"session_id":"wt-crashed"}'
  assert_pruned "the emptied tree of a killed run is removed" "$WORKTREES_DIR/wt-crashed"
  assert_equals "a worktree the run already deleted is deregistered by the prune" "1 -> 0" \
    "$crashed_before -> $(worktrees_registered_for wt-crashed)"

  # Fail-open: the repo can be gone by the time the session ends, and a teardown
  # that cannot run may not take the state cleanup down with it.
  arm_repo_at "$VANISHED_REPO"
  arm_wave_for wt-lost-repo "$VANISHED_REPO"
  rm -rf "$VANISHED_REPO"
  run_hook cleanup-state.sh '{"session_id":"wt-lost-repo"}'
  assert_pruned "a session whose repo is gone still loses its state file" \
    "$STATE_DIR/wt-lost-repo.state"
  assert_kept "the worktree git can no longer be asked about stays put" \
    "$WORKTREES_DIR/wt-lost-repo/1"
  assert_logged "a teardown git could not run is recorded rather than swallowed" \
    '"event":"worktree-teardown-failed"'
  rm -rf "$WORKTREES_DIR/wt-lost-repo"

  # The same unreachable repo one step further along: a killed run already took
  # the worktree directory, so no removal runs and the prune that would clear the
  # registration cannot run either. The rmdir then takes the last trace on disk,
  # which leaves the line as the only thing saying a prune is still owed. The log
  # starts empty because the case above logged the same event on its way past.
  arm_repo_at "$VANISHED_REPO"
  arm_wave_for wt-no-prune "$VANISHED_REPO"
  rm -rf "$VANISHED_REPO" "$WORKTREES_DIR/wt-no-prune/1"
  rm -f "$events_log"
  run_hook cleanup-state.sh '{"session_id":"wt-no-prune"}'
  assert_pruned "a session whose prune could not run still loses its state file" \
    "$STATE_DIR/wt-no-prune.state"
  assert_logged "a prune that could not run is recorded rather than swallowed" \
    '"event":"worktree-prune-failed"'

  # The one removal git is right to refuse: a survivor still holding uncommitted
  # work. SessionEnd is the last thing that runs, so forcing it is the operator's
  # only copy of that work gone with nobody left to tell — the close states the
  # same policy for the same operation, and this is where an added `--force`
  # would diverge from it silently. What the refusal costs is a tree that stands
  # until someone deals with it: the prune leaves it registered, because its
  # directory is still there, so `git worktree list` goes on naming it.
  arm_wave_for wt-dirty "$WORKTREE_REPO"
  printf 'uncommitted\n' > "$WORKTREES_DIR/wt-dirty/1/base.txt"
  dirty_before="$(worktrees_registered_for wt-dirty)"
  rm -f "$events_log"
  run_hook cleanup-state.sh '{"session_id":"wt-dirty"}'
  assert_kept "a worktree holding uncommitted work survives session end" \
    "$WORKTREES_DIR/wt-dirty/1"
  assert_equals "the uncommitted work is left where the operator can still recover it" \
    uncommitted "$(cat "$WORKTREES_DIR/wt-dirty/1/base.txt" 2>/dev/null)"
  assert_equals "the worktree git refused to remove stays registered" "1 -> 1" \
    "$dirty_before -> $(worktrees_registered_for wt-dirty)"
  assert_logged "a removal refused over uncommitted work is recorded rather than forced" \
    '"event":"worktree-teardown-failed"'
  assert_pruned "the session whose worktree outlived it still loses its state file" \
    "$STATE_DIR/wt-dirty.state"
fi

# --- SessionStart: the state another session left is what the model must hear --
# The hook that tells a resumed session its gates are off decides that from the
# state dir alone, so what it names is the whole behaviour: another session's
# state file, never its own, and never an entry in the dir that is no state file
# at all — the worktrees a parallel wave puts there among them. Its own is the
# one recording its session id, since a resumed session keeps that id and the
# file it left is the repository's, waiting for it under a name nothing here
# reads.

printf 'mode=plan\nsession=other-session\n' > "$STATE_DIR/other-session.state"
printf 'mode=plan\nsession=%s\n' "$SESSION" > "$REPO_STATE"
mkdir -p "$WORKTREES_DIR/wt-parallel/1"
run_hook warn-stale-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
# Which of the dir's entries reached the SessionStart context. The report is
# prose the model reads, so the case asks which names it carries rather than how
# the sentence around them is worded.
named_as_stale=""
for dir_entry in "$(basename "$REPO_STATE")" other-session.state worktrees; do
  case "$hook_stdout" in *"$dir_entry"*) named_as_stale="$named_as_stale $dir_entry" ;; esac
done
named_as_stale="${named_as_stale# }"
assert_after_hook "SessionStart names another session's state, never its own and never a worktree" \
  [ "$named_as_stale" = other-session.state ]

rm -f "$STATE_DIR/other-session.state"
assert_allows "SessionStart says nothing when the only state is this session's" \
  warn-stale-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"

# Fail-open on a machine that has never armed a session: no state dir at all.
# HOME is what the state path hangs off, so the case moves it rather than
# deleting the directory every later case reads.
HOME="$TEST_HOME/never-armed"
assert_allows "SessionStart says nothing where there is no state dir" \
  warn-stale-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
HOME="$TEST_HOME"
rm -rf "$WORKTREES_DIR/wt-parallel" "$REPO_STATE"

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
assert_logged "a residue allow carries the command it let through" \
  '"event":"residue-allowed","command":"python3'

# A wrapper chain deeper than the lexer reads is the same undecidable: the payload
# nobody read is residue, so a chain with no git in it is never refused for a red
# verify. The cost is taken on purpose — four wrappers deep hides a commit, the
# way a python payload already does — so it is pinned as a decision, not left to
# be found later and read as a hole.
assert_allows "residue: a wrapper chain past the recursion bound passes" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c ok\\\"\"'\''')"
assert_allows "residue: a chain past the bound hides a commit — allowed on purpose" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c git commit\\\"\"'\''')"
assert_logged "both chains past the bound are logged with the chain they let through" \
  '"event":"residue-allowed","command":"bash -c .*bash -c ok' \
  '"event":"residue-allowed","command":"bash -c .*bash -c git commit'
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
assert_logged "stdin scripts, produced command words and unknown git options are all counted" -F \
  '"event":"residue-allowed","command":"python3 - <<' \
  '"event":"residue-allowed","command":"$(echo git) commit"' \
  '"event":"residue-allowed","command":"git --super-prefix'

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
assert_logged "an unresolved command prefix is counted, not read as clean" -F \
  '"event":"residue-allowed","command":"sudo -u x bash <<EOF' \
  '"event":"residue-allowed","command":"sudo -u x git commit"'

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
assert_logged "a payload an option shape hides is counted, not read as clean" \
  '"event":"residue-allowed","command":"bash -c -O extglob' \
  '"event":"residue-allowed","command":"bash -c -o pipefail'
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
assert_not_logged "neither clear line is counted as residue"

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
assert_logged "a line past the input bound is logged with the head of the line" \
  '"event":"residue-allowed","command":"git commit -m x && echo aaa'

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
assert_logged "a payload past the decoder bound is logged with the head the client sent" -F \
  '"event":"residue-allowed","command":"git commit -m x && echo \\\"aaaa'

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

# A case only the second reader can judge is skipped where that reader is absent,
# and the skip line stands for it in the tally. The value is what the reader
# returns, so it is a command this runs rather than a string the call site
# expands: expanded there, the missing reader would run anyway.
assert_equals_or_skip() {
  local name="$1" tool="$2" skip_reason="$3" expected="$4"
  shift 4
  if command -v "$tool" >/dev/null 2>&1; then
    assert_equals "$name" "$expected" "$("$@")"
  else
    echo "skip: $skip_reason"; skipped=$((skipped + 1))
  fi
}

parity_input="$(bash_input 'git commit -m \"a\nb\" a\\b')"
parity_expected=$'git commit -m "a\nb" a\\b'
assert_equals "the pattern reader decodes escapes the way the client wrote them" \
  "$parity_expected" "$(read_by pattern "$parity_input")"
assert_equals_or_skip "jq and the pattern reader decode a payload identically" \
  jq "jq is absent here, so there is no second reader to compare against" \
  "$parity_expected" read_by jq "$parity_input"

# The bound is a property of the gate, not of the machine's jq: a decoder bound
# only the fallback applied would deny on one install what it allows on the next.
# Over it either reader hands back the payload the client sent, escapes and all.
over_bound_line="$(commit_line_of_length 3100 '\"aaaa')"
over_bound_input="$(bash_input "$over_bound_line")"
assert_equals "the pattern reader leaves an over-bound payload undecoded" \
  "$over_bound_line" "$(read_by pattern "$over_bound_input")"
assert_equals_or_skip "jq leaves the same over-bound payload unread as the fallback" \
  jq "jq is absent here, so the bound has only one reader to hold for" \
  "$over_bound_line" read_by jq "$over_bound_input"

# A gate reading its envelope by pattern is a degraded gate; the log is the only
# place that difference can show up, and an armed session is the only place it may
# be written — see the invisibility cases above.
rm -f "$events_log"
( . "$PLUGIN/hooks/lib.sh"; JSON_READER=pattern; record_reader_fallback "$SESSION" )
assert_logged "a gate that fell back to the pattern reader records it" '"event":"jq-absent"'
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
  # The state this hook reads is the COMMIT REPO's, so it is armed from inside it:
  # armed from the suite's own directory it would name this repository instead and
  # the hook would judge against a file nobody wrote.
  COMMIT_REPO_STATE="$STATE_DIR/$(state_key_of "$COMMIT_REPO").state"
  commit_repo_state() { ( cd "$COMMIT_REPO" && oso-state --session "$SESSION" "$@" ); }

  # Invisibility, on the two shapes that own the operator's commits: a repo the
  # plugin never armed, and a terminal with no agent marker at all — a human's.
  commit_repo_state clear
  rm -f "$events_log"
  assert_commit_lands "a repo with no state file commits untouched" 'git commit -m x'
  assert_commit_lands "a terminal with no session variable commits untouched" \
    "env -u CLAUDE_CODE_SESSION_ID HOME=$HUMAN_HOME git commit -m x"
  assert_not_logged "neither allowed commit left a trace" "$HUMAN_HOME"

  # The same terminal against an ARMED repo, which is the whole of what keying by
  # repository changed: the state file now exists for the repo the operator commits
  # in, so the marker is all that stands between this gate and their own commit.
  # Both spellings are stripped — a host that publishes no session id arms on
  # OSO_AGENT — and the operator's own HOME is used, so the audit this leaves no
  # trace in is the same log every case above reads.
  commit_repo_state set mode=plan verify_green=false
  rm -f "$events_log"
  assert_commit_lands "an unmarked terminal commits untouched though the repo is armed and red" \
    'env -u CLAUDE_CODE_SESSION_ID -u OSO_AGENT git commit -m x'
  assert_not_logged "the operator's own commit left no trace in the audit"

  assert_commit_aborted "the git layer denies a commit while verify is red" 'git commit -m x'
  assert_commit_aborted "the marker a host with no session id sets arms the same gate" \
    'env -u CLAUDE_CODE_SESSION_ID OSO_AGENT=codex-probe git commit -m x'
  commit_repo_state set verify_green=true
  assert_commit_lands "the git layer lets a commit through once verify is green" 'git commit -m x'
  assert_logged "the git layer records its deny as the matcher's event" '"event":"commit-denied"'

  # Both layers on one shape, which is the whole reason this one exists: the matcher
  # reads flock's lock-file argument as the program flock runs, and an alias hides
  # the verb from every table it has. Both come out clear, both reach the commit.
  # Two repos are armed for these: the matcher judges the payload's cwd, which is
  # this repository, and the commit happens in the other.
  commit_repo_state set verify_green=false
  oso-state --session "$SESSION" set mode=plan verify_green=false
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

  # Same polarity as the matcher: armed state the gate cannot read denies rather
  # than guessing. The unreadable path is the COMMIT REPO's, because that is the
  # file this hook resolves — made unreadable in the suite's own repository the
  # hook would still read a perfectly legible red state and deny for the other
  # reason, which is a case above and would prove nothing about this one.
  rm -f "$COMMIT_REPO_STATE"
  mkdir -p "$COMMIT_REPO_STATE"
  assert_commit_aborted "the git layer denies a state path it cannot read" \
    'git commit -m x' 'cannot be read'
  rmdir "$COMMIT_REPO_STATE"
  oso-state --session "$SESSION" clear
fi

# --- The installer's trust boundary: what may become a plugin source ----------
# Nothing runs bootstrap/install.sh — CI only parses it — so the two decisions
# that can permanently repoint the plugin marketplace are read here instead. A
# `directory` source is a dead end the update path never repairs: `marketplace
# update` git-pulls a github or git source and nothing else.
INSTALL_SH="$REPO_ROOT/bootstrap/install.sh"
CLAUDE_SHIM_DIR="$TEST_HOME/installer-shim"
CLIENT_CALLS="$TEST_HOME/client-calls"
CLIENT_REFUSAL="$TEST_HOME/client-refusal"
INSTALLER_STDERR="$TEST_HOME/installer-stderr"
mkdir -p "$CLAUDE_SHIM_DIR"
# The client the installer sees: it records every call it is handed, and a case
# that needs the client to say no arms one by writing the message the real client
# would print. Armed, the call is still recorded — a refusal the installer reports
# without ever reaching the client would prove nothing about either.
printf '#!/bin/sh\necho "$*" >> "%s"\n[ -f "%s" ] || exit 0\ncat "%s" >&2\nexit 1\n' \
  "$CLIENT_CALLS" "$CLIENT_REFUSAL" "$CLIENT_REFUSAL" > "$CLAUDE_SHIM_DIR/claude"
chmod +x "$CLAUDE_SHIM_DIR/claude"

# The installer's own functions, run in a subshell the way read_by runs the hook
# library's: sourcing install.sh brings its `set -e` and its globals along, and
# neither may reach the rest of the suite. The call is saved before the subshell
# clears $@, which a sourced file inherits from its caller and reads as flags.
in_installer() {
  local call=("$@")
  ( set --; PATH="$CLAUDE_SHIM_DIR:$PATH"; . "$INSTALL_SH"; "${call[@]}" )
}

# Every fixture below is a verbatim failure of `claude plugin marketplace add`,
# measured against client 2.1.220 — prose is the only signal the client gives.
assert_classified() {
  local name="$1" expected="$2" output="$3"
  assert_equals "$name" "$expected" "$(in_installer classify_marketplace_add_failure "$output")"
}

assert_classified "an unreachable host is what the local fallback exists for" unreachable \
  "Adding marketplace…✘ Failed to add marketplace: Failed to clone marketplace repository: Cloning into '/home/o/.claude/plugins/marketplaces/temp_1785021233855'...
fatal: unable to access 'https://127.0.0.1:1/nope.git/': Failed to connect to 127.0.0.1 port 1 after 0 ms: Could not connect to server"
assert_classified "a clone that cannot authenticate is the same fallback case" unreachable \
  "Adding marketplace…✘ Failed to add marketplace: Failed to clone marketplace repository: SSH authentication failed. Please ensure your SSH keys are configured for GitHub, or use an HTTPS URL instead.

Original error: Cloning into '/home/o/.claude/plugins/marketplaces/SoyJohnXD-oso-code'...
git@github.com: Permission denied (publickey)."
assert_classified "an enterprise policy block never repoints at a working tree" policy-blocked \
  "Adding marketplace…✘ Failed to add marketplace: Marketplace source 'SoyJohnXD/oso-code' is blocked by enterprise policy."
assert_classified "a marketplace outside the allowed list is the same refusal" policy-blocked \
  "Adding marketplace…✘ Failed to add marketplace: Marketplace 'oso-code' is not in the allowed marketplace list"
assert_classified "a seed-managed name is the admin's to change, not this script's" seed-managed \
  "Adding marketplace…✘ Failed to add marketplace: Marketplace 'oso-code' is seed-managed (/opt/claude/seed). To use a different source, ask your admin to update the seed, or use a different marketplace name."
assert_classified "a malformed source is a typo, not an outage" invalid-source \
  "✘ Invalid marketplace source format. Try: owner/repo, https://..., or ./path"
assert_classified "an unparseable manifest is the marketplace's own fault" invalid-manifest \
  "Adding marketplace…✘ Failed to add marketplace: Failed to parse marketplace file at /r/.claude-plugin/marketplace.json: Invalid JSON in /r/.claude-plugin/marketplace.json: JSON Parse error: Expected '}'"
assert_classified "a manifest that parses but does not fit the schema is the same" invalid-manifest \
  "Adding marketplace…✘ Failed to add marketplace: Failed to parse marketplace file at /r/.claude-plugin/marketplace.json: Invalid schema: name: Invalid input: expected string, received undefined"
assert_classified "a missing manifest is the same again" invalid-manifest \
  "Adding marketplace…✘ Failed to add marketplace: Marketplace file not found at /r/.claude-plugin/marketplace.json"
# The fail-safe half: the client can reword any of the messages above in any
# release, and the cost of that has to be a lost fallback, never a silent repoint.
assert_classified "a message this script has never seen takes no fallback" unknown \
  "Adding marketplace…✘ Failed to add marketplace: something the client learned to say after this was written"

# Registering a working tree as a plugin source: install.sh derives $REPO_ROOT
# from $BASH_SOURCE, which `curl | bash` leaves unset — on bash 3.2 that lands
# $REPO_ROOT on `/`, elsewhere on the parent of the operator's cwd. A refusal that
# still calls the client refuses nothing, so what the client was asked to register
# is half of every case here.
clone_registration_of() {
  local verdict=registered
  : > "$CLIENT_CALLS"
  in_installer register_clone_marketplace "$1" 2>"$INSTALLER_STDERR" || verdict=refused
  printf '%s:%s' "$verdict" "$(cat "$CLIENT_CALLS")"
}

assert_equals "a path carrying no marketplace manifest never reaches the client" \
  "refused:" "$(clone_registration_of "$TEST_HOME/parent-of-a-random-cwd")"
assert_equals "the root of a real clone is what the offline fallback may register" \
  "registered:plugin marketplace add $REPO_ROOT" "$(clone_registration_of "$REPO_ROOT")"

# Repointing at a working tree is a permanent change to where the plugin loads
# from, and the operator only learns of it here. Spelled out rather than read from
# install.sh on purpose, the way the state path above is.
names_tree=no names_revert=no
case "$(cat "$INSTALLER_STDERR")" in *"$REPO_ROOT"*) names_tree=yes ;; esac
case "$(cat "$INSTALLER_STDERR")" in *"claude plugin marketplace add SoyJohnXD/oso-code"*) names_revert=yes ;; esac
assert_equals "the fallback names the tree it repointed to and how to revert" \
  "tree=yes revert=yes" "tree=$names_tree revert=$names_revert"

# The other end of that path: the fallback runs where the remote is already gone,
# so a refusal it swallows leaves the operator with no source and no reason. The
# first add classifies its failure; this one has to say as much.
printf 'Adding marketplace…✘ Failed to add marketplace: Marketplace file not found at %s/.claude-plugin/marketplace.json\n' \
  "$REPO_ROOT" > "$CLIENT_REFUSAL"
refused_fallback="$(clone_registration_of "$REPO_ROOT")"
refusal_reason=unnamed
case "$(cat "$INSTALLER_STDERR")" in *invalid-manifest*) refusal_reason=invalid-manifest ;; esac
assert_equals "a fallback the client refuses too names the reason, never a silent return" \
  "refused:plugin marketplace add $REPO_ROOT / invalid-manifest" \
  "$refused_fallback / $refusal_reason"
rm -f "$CLIENT_REFUSAL"

# The wiring summary is built in an array, and an array with no elements is an
# "unbound variable" abort under `set -u` on bash < 4.4 — macOS's bash. Every
# wiring path appends something today, so nothing else can reach the shape that
# aborts: this case is the only thing standing between it and an installer that
# dies on its last line, after everything it did.
empty_summary="$(in_installer print_wiring_summary 2>&1)" || empty_summary="aborted: $empty_summary"
assert_equals "a wiring summary with nothing in it prints instead of aborting under set -u" \
  "[oso-code] wiring summary:" "$empty_summary"

# --- The opt-out marker: the only thing verify.sh can read the choice from -----
# The two bootstrap scripts run standalone via curl and share no file, so the
# opt-out is DATA at a path each spells for itself — spelled a third time here,
# which is what catches a wrong constant in either. Both halves are cases because
# the CLEAR is the one that is easy to forget: a marker left behind by an earlier
# opt-out would report a genuinely failed impeccable install as the operator's own
# choice forever.
IMPECCABLE_MARKER="$STATE_DIR/impeccable-opt-out"
marker_state() { [ -f "$IMPECCABLE_MARKER" ] && echo recorded || echo cleared; }

rm -f "$IMPECCABLE_MARKER"
in_installer skip_impeccable >/dev/null
assert_equals "--no-impeccable records the opt-out where verify.sh reads it" \
  "recorded" "$(marker_state)"
in_installer wire_impeccable >/dev/null
assert_equals "an install without the flag clears the marker an earlier one left" \
  "cleared" "$(marker_state)"

# --- The verifier's report: an opt-out and an optional MCP are notes ----------
# Read against this suite's isolated HOME with the client shimmed, so the install
# checks fail legitimately and instantly and what the cases read is the SHAPE of
# the report — which line an operator is handed, and whether the tally counts it.
# OSO_VERIFY_SKIP_SLOW keeps verify.sh from re-running this very suite and from
# fetching impeccable from npm.
verify_report() {
  ( PATH="$CLAUDE_SHIM_DIR:$PATH"; OSO_VERIFY_SKIP_SLOW=1 bash "$REPO_ROOT/bootstrap/verify.sh" 2>&1 || true )
}

# What the report SAYS about one check, which is the whole difference between a
# gap an operator has to fix and one they chose.
report_line_kind() {
  local report="$1" name="$2"
  case "$report" in
    *"FAIL: $name"*) printf 'fail' ;;
    *"ok:   $name"*) printf 'ok' ;;
    *"note: $name"*) printf 'note' ;;
    *) printf 'absent' ;;
  esac
}

report_without_marker="$(verify_report)"
in_installer skip_impeccable >/dev/null
report_with_marker="$(verify_report)"
rm -f "$IMPECCABLE_MARKER"

assert_equals "an opt-out turns the impeccable plugin check into a note" \
  "note" "$(report_line_kind "$report_with_marker" 'impeccable plugin')"
assert_equals "a cleared marker puts the hard impeccable check back — red in this fixture HOME" \
  "fail" "$(report_line_kind "$report_without_marker" 'impeccable plugin')"
assert_equals "an absent fallow is reported as a note the tally never counts" \
  "note" "$(report_line_kind "$report_without_marker" 'fallow MCP')"
assert_equals "the report still reaches its summary" "reached" \
  "$(printf '%s\n' "$report_without_marker" | grep -q '^passed:' && echo reached || echo missing)"

# --- The npx probe's bound: a hang may not take the whole report with it -------
# verify.sh runs standalone via curl and defines its own helpers, so the bound is
# READ OUT of the shipped file rather than reimplemented here — a rename or a move
# leaves this block with nothing to run and says so. The bound value is the one
# thing the cases override: 20 seconds is what an operator waits, not a suite.
bounded_probe="$(sed -n '/^impeccable_cli_runnable()/,/^}/p' "$REPO_ROOT/bootstrap/verify.sh")"
NPX_SHIM_DIR="$TEST_HOME/npx-shim"
NPX_ORPHAN_MARKER="$TEST_HOME/npx-orphan"
mkdir -p "$NPX_SHIM_DIR"

# One call, two facts: what the check would report, and whether the operator waited
# out the bound for it. A bound that never fires and an answer that waits for one
# are the same hang.
probe_with_npx() {
  local bound="$1" shim="$2" started verdict
  printf '%s\n' "$shim" > "$NPX_SHIM_DIR/npx"
  chmod +x "$NPX_SHIM_DIR/npx"
  started="$(date +%s)"
  verdict="$(
    eval "$bounded_probe"
    PATH="$NPX_SHIM_DIR:$PATH"
    NPX_PROBE_BOUND_SECONDS="$bound"
    impeccable_cli_runnable
  )"
  if [ "$(( $(date +%s) - started ))" -ge "$bound" ]; then
    printf '%s (waited out the bound)' "$verdict"
  else
    printf '%s (prompt)' "$verdict"
  fi
}

if [ -z "$bounded_probe" ]; then
  echo "FAIL: bootstrap/verify.sh defines no impeccable_cli_runnable, so its bound has nothing to test"
  fail=$((fail + 1))
else
  assert_equals "an npx that answers leaves the check green without waiting out the bound" \
    "1 (prompt)" "$(probe_with_npx 5 '#!/bin/sh
exit 0')"
  assert_equals "an npx that fails on its own is a red check, not a timeout" \
    "0 (prompt)" "$(probe_with_npx 5 '#!/bin/sh
echo "npm ERR! 404 Not Found" >&2
exit 1')"
  # npx runs the package in node children of its own, so a bound that kills only
  # its direct child leaves the fetch running after the report has moved on.
  rm -f "$NPX_ORPHAN_MARKER"
  assert_equals "an npx that hangs is killed at the bound, with the reason in the value" \
    "no answer within 1s (waited out the bound)" "$(probe_with_npx 1 "#!/bin/sh
( sleep 2; touch $NPX_ORPHAN_MARKER ) &
sleep 60")"
  sleep 3
  assert_equals "the kill at the bound takes the probe's own children with it" \
    "no orphan" "$([ -f "$NPX_ORPHAN_MARKER" ] && echo "orphan survived" || echo "no orphan")"
fi

echo "----"
echo "passed: $pass, failed: $fail, skipped: $skipped"
[ "$fail" -eq 0 ]
