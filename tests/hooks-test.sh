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
unset GIT_CONFIG_GLOBAL OSO_AGENT OSO_STATE_BIN XDG_CONFIG_HOME
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
REPO_KEY="$(state_key_of "$REPO_ROOT")"
REPO_STATE="$STATE_DIR/${REPO_KEY}.state"
REPO_PLAN_DIR="$STATE_DIR/plans/$REPO_KEY"

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

codex_hooks_manifest="$REPO_ROOT/codex/hooks/hooks.json"
codex_event_group() {
  awk -v heading="    \"$1\": [" '
    $0 == heading { inside = 1 }
    inside { print }
    inside && /^    ](,)?$/ { exit }
  ' "$codex_hooks_manifest"
}
for matcherless_event in Stop UserPromptSubmit; do
  matcherless_group="$(codex_event_group "$matcherless_event")"
  case "$matcherless_group" in
    *"\"${matcherless_event}\""*)
      echo "ok: the Codex manifest contains the ${matcherless_event} approval group"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: the Codex manifest has no ${matcherless_event} approval group"; fail=$((fail + 1)) ;;
  esac
  case "$matcherless_group" in
    *'"matcher"'*)
      echo "FAIL: ${matcherless_event} carries a matcher Codex ignores"; fail=$((fail + 1)) ;;
    *)
      echo "ok: ${matcherless_event} remains matcherless in the Codex manifest"; pass=$((pass + 1)) ;;
  esac
done

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

# A release has two version authorities because it ships two plugin manifests.
# The marketplace catalogs point at those payloads and intentionally carry no
# duplicate version of their own. Pin all three edges: a partial bump otherwise
# lets one host install the previous contract under the current release notes.
claude_release_version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$REPO_ROOT/plugin/.claude-plugin/plugin.json")"
codex_release_version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$REPO_ROOT/codex/.codex-plugin/plugin.json")"
changelog_release_version="$(awk '
  /^## [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$/ {
    sub(/^## /, "")
    print
    exit
  }
' "$REPO_ROOT/CHANGELOG.md")"
assert_equals "Claude and Codex plugin manifests publish one release version" \
  "$claude_release_version" "$codex_release_version"
assert_equals "the changelog opens on the plugin manifests' release version" \
  "$claude_release_version" "$changelog_release_version"
marketplace_version_fields="$({ grep -hEc '^[[:space:]]*"version"[[:space:]]*:' \
  "$REPO_ROOT/.claude-plugin/marketplace.json" \
  "$REPO_ROOT/.agents/plugins/marketplace.json" || true; } | awk '{ total += $1 } END { print total + 0 }')"
assert_equals "marketplace catalogs do not duplicate the plugin release version" \
  "0" "$marketplace_version_fields"

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
  printf '\nInvoke `oso-code:debt-sweep` now.\n' >> "$codex_quick_fixture"
  if mutated_call_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" "$LINT_CALL_FIXTURE/plugin" "$LINT_CALL_FIXTURE" 2>&1)"; then
    echo "FAIL: a bare Codex skill call with no verdict vocabulary passed plugin lint"; fail=$((fail + 1))
  else
    case "$mutated_call_lint_report" in
      *"skills/quick/SKILL.md invokes debt-sweep on codex"*"carries none of its"*)
        echo "ok: a bare Codex call missing its emitter vocabulary fails lint"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the Codex call-site mutation failed for the wrong reason — $(printf '%s' "$mutated_call_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B4/B5 (D9): rule 6 now demands EVERY token of an axis a caller engages, not
# just one of the emitter's whole flattened vocabulary — the delta a `blocked`
# drift exploited, since a caller could satisfy the old floor by naming any
# OTHER token of the same emitter and never carry the one that actually went
# missing. Remove only the sentence that routes debt-sweep's whole-report
# `blocked` token from a real, otherwise-complete caller (debug's close still
# names `Debt Sweep: clean`, `findings`, and `Conformance: skipped` — every
# token the OLD "at least one" floor ever required). The old rule would have
# read this caller clean; the new one must not.
LINT_MISSING_TOKEN_FIXTURE="$TEST_HOME/lint-missing-token"
copy_lint_fixture "$LINT_MISSING_TOKEN_FIXTURE"
missing_token_body="$LINT_MISSING_TOKEN_FIXTURE/plugin/skills/_shared/bodies/debug.md"
if ! grep -q 'A third, whole-report token can arrive instead: `Debt Sweep: blocked`' "$missing_token_body"; then
  echo "FAIL: the missing-token mutation found no Debt Sweep: blocked route to remove from debug.md"; fail=$((fail + 1))
else
  sed 's/ A third, whole-report token can arrive instead:.*//' "$missing_token_body" > "$missing_token_body.tmp"
  mv "$missing_token_body.tmp" "$missing_token_body"
  if grep -q 'Debt Sweep: blocked' "$missing_token_body"; then
    echo "FAIL: the missing-token mutation left Debt Sweep: blocked standing in debug.md"; fail=$((fail + 1))
  elif missing_token_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_MISSING_TOKEN_FIXTURE/plugin" "$LINT_MISSING_TOKEN_FIXTURE" 2>&1)"; then
    echo "FAIL: a caller missing one axis's whole-report token passed plugin lint"; fail=$((fail + 1))
  else
    case "$missing_token_report" in
      *"skills/debug/SKILL.md invokes debt-sweep on claude but carries none of its Debt Sweep tokens"*)
        echo "ok: rule 6 rejects a caller missing debt-sweep's blocked token even though its other tokens are complete"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the missing-token mutation failed for the wrong reason — $(printf '%s' "$missing_token_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B5 (D9): the harder half — a token named with no action beside it is the
# boilerplate the doubt pass predicted this rule would produce if it graded
# mention alone. Inject a caller that never invoked debt-sweep before, naming
# EVERY one of its six tokens across all three axes verbatim, with zero
# recovery verb anywhere near them. The floor (every token present) is fully
# satisfied; only the routing half can still fail this, and it must.
LINT_BARE_LIST_FIXTURE="$TEST_HOME/lint-bare-list"
copy_lint_fixture "$LINT_BARE_LIST_FIXTURE"
bare_list_target="$LINT_BARE_LIST_FIXTURE/plugin/skills/_shared/platform/claude/quick.md"
if [ ! -f "$bare_list_target" ]; then
  echo "FAIL: the bare-list mutation has no quick platform file to change"; fail=$((fail + 1))
else
  printf '\n| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool |\nTerminal tokens: `Debt Sweep: blocked`, `Debt Sweep: clean`, `Debt Sweep: findings`, `Conformance: clean`, `Conformance: findings`, `Conformance: skipped — no ledger provided`.\n' \
    >> "$bare_list_target"
  if bare_list_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_BARE_LIST_FIXTURE/plugin" "$LINT_BARE_LIST_FIXTURE" 2>&1)"; then
    echo "FAIL: a caller naming every token of an emitter but routing none of them passed plugin lint"; fail=$((fail + 1))
  else
    case "$bare_list_report" in
      *"skills/quick/SKILL.md invokes debt-sweep on claude"*"names every Debt Sweep token but leaves some with no route beside the token"*"bare: \`Debt Sweep: blocked\`"* | \
      *"skills/quick/SKILL.md invokes debt-sweep on claude"*"names every Debt Sweep token but leaves some with no route beside the token"*"bare: \`Debt Sweep: clean\`, \`Debt Sweep: findings\`"*)
        echo "ok: rule 6 rejects a caller that names every token of an emitter but routes none of them"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the bare-list mutation failed for the wrong reason — $(printf '%s' "$bare_list_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B5 (D9): agents join skills as emitters — the drift this rule exists to
# close (oso-integrator's `status: blocked`) came from agents sitting outside
# its reach entirely. Remove the one sentence that routes it from the real,
# already-fixed body and confirm the mechanism itself — not just the fixed
# prose — is what proves the route exists: a rule that only ever reads clean
# never proves it would have caught the drift it was built for.
LINT_AGENT_FIXTURE="$TEST_HOME/lint-agent-token"
copy_lint_fixture "$LINT_AGENT_FIXTURE"
agent_route_body="$LINT_AGENT_FIXTURE/plugin/skills/_shared/bodies/plan.md"
if ! grep -q '^\*\*When the integrator returns `status: blocked` instead (ADR-0114)\*\*' "$agent_route_body"; then
  echo "FAIL: the agent-token mutation found no integrator blocked route to remove from plan.md"; fail=$((fail + 1))
else
  sed '/^\*\*When the integrator returns `status: blocked` instead (ADR-0114)\*\*/d' "$agent_route_body" > "$agent_route_body.tmp"
  mv "$agent_route_body.tmp" "$agent_route_body"
  if grep -q 'status: blocked' "$agent_route_body"; then
    echo "FAIL: the agent-token mutation left status: blocked standing in plan.md"; fail=$((fail + 1))
  elif agent_route_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_AGENT_FIXTURE/plugin" "$LINT_AGENT_FIXTURE" 2>&1)"; then
    echo "FAIL: a caller of an agent emitter missing one of its status tokens passed plugin lint"; fail=$((fail + 1))
  else
    case "$agent_route_report" in
      *"skills/plan/SKILL.md invokes oso-integrator on claude and names some of its status tokens but not all — missing \`status: blocked\`"*)
        echo "ok: rule 6 reaches oso-integrator as an agent emitter and rejects a caller with no route for its blocked token"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the agent-token mutation failed for the wrong reason — $(printf '%s' "$agent_route_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B4 (D9/D18): the defect this change closes — `bodies/plan.md`'s security-pass
# re-run loop terminates only on `clean` or an explicit operator acceptance,
# and a Codex-only `blocked` was neither. Assert the reachable exit is written
# into all three callers directly, rather than only through the vocabulary
# rule above: this is the concrete symptom named in the slice, so it earns its
# own assertion beside the mechanism that now enforces it structurally.
for security_pass_caller in plan quick debug; do
  security_pass_source="$REPO_ROOT/plugin/skills/_shared/bodies/$security_pass_caller.md"
  security_pass_route="$({ grep -F 'Security Pass: blocked' "$security_pass_source" || true; })"
  case "$security_pass_route" in
    *'Security Pass: blocked'*'resolve'*'invoke'*)
      echo "ok: bodies/$security_pass_caller.md routes Security Pass: blocked to a resolve-and-reinvoke exit"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: bodies/$security_pass_caller.md carries no reachable route for Security Pass: blocked"; fail=$((fail + 1)) ;;
  esac
done

# Rule 7 is host-specific: Claude's always-loaded source routes the three
# operator-only modes through `/oso-code:<mode>`, while Codex's routes the same
# independently-declared wrappers through `$oso-code:<mode>`. A clean-tree lint cannot
# prove either scan is real — all six names also occur elsewhere in the fixture.
# Remove each real Workflow route in turn, leave a longer lookalike INSIDE that
# block, and leave the exact spelling OUTSIDE it.  Only a section-bounded,
# token-bounded scan of the right host source can reject this mutation for the
# named omission; a repository-wide grep or substring match reads it as green.
mutate_global_workflow_route() {
  local routing_file="$1" invocation="$2" temporary="$1.tmp"
  awk -v invocation="$invocation" '
    $0 == "# Workflow" {
      print
      print "- Deliberate routing lookalike: `" invocation "-extra`."
      print "- Deliberate prefixed lookalike: `x" invocation "`."
      in_workflow = 1
      next
    }
    in_workflow && /^# / { in_workflow = 0 }
    in_workflow && index($0, invocation) { next }
    { print }
    END {
      print ""
      print "# Deliberate non-routing appendix"
      print "The exact spelling `" invocation "` is present here, outside Workflow."
    }
  ' "$routing_file" > "$temporary"
  mv "$temporary" "$routing_file"
}

for routing_host in claude codex; do
  case "$routing_host" in
    claude) routing_source=bootstrap/claude-global.md; routing_prefix=/oso-code: ;;
    codex) routing_source=bootstrap/codex-global.md; routing_prefix='$oso-code:' ;;
  esac
  for routing_mode in plan quick debug; do
    LINT_ROUTING_FIXTURE="$TEST_HOME/lint-routing-$routing_host-$routing_mode"
    copy_lint_fixture "$LINT_ROUTING_FIXTURE"
    routing_fixture="$LINT_ROUTING_FIXTURE/$routing_source"
    routing_invocation="$routing_prefix$routing_mode"
    if [ ! -f "$routing_fixture" ]; then
      echo "FAIL: the $routing_host routing mutation has no $routing_source source"; fail=$((fail + 1))
      continue
    fi
    mutate_global_workflow_route "$routing_fixture" "$routing_invocation"
    if mutated_routing_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
        "$LINT_ROUTING_FIXTURE/plugin" "$LINT_ROUTING_FIXTURE" 2>&1)"; then
      echo "FAIL: $routing_source passed lint without its $routing_invocation Workflow route"; fail=$((fail + 1))
    else
      case "$mutated_routing_report" in
        *"$routing_source"*"omits"*"$routing_invocation"*"Workflow routing"*)
          echo "ok: rule 7 rejects $routing_host's missing $routing_invocation route despite bounded decoys"; pass=$((pass + 1)) ;;
        *)
          echo "FAIL: the $routing_host $routing_invocation mutation failed for the wrong reason — $(printf '%s' "$mutated_routing_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
      esac
    fi
  done
done

# The three mutations above could still pass against a linter that hardcodes
# today's three names.  Add a fourth operator-only mode to each host tree without
# adding a route: the diagnostic must be derived from that wrapper's frontmatter.
for routing_host in claude codex; do
  LINT_DISCOVERY_FIXTURE="$TEST_HOME/lint-routing-discovery-$routing_host"
  copy_lint_fixture "$LINT_DISCOVERY_FIXTURE"
  case "$routing_host" in
    claude)
      discovery_skills_root="$LINT_DISCOVERY_FIXTURE/plugin/skills"
      discovery_invocation=/oso-code:incident
      ;;
    codex)
      discovery_skills_root="$LINT_DISCOVERY_FIXTURE/codex/skills"
      discovery_invocation='$oso-code:incident'
      ;;
  esac
  mkdir -p "$discovery_skills_root/incident"
  printf '%s\n' \
    '---' \
    'name: incident' \
    'description: Mutation-only operator mode.' \
    'disable-model-invocation: true' \
    '---' \
    > "$discovery_skills_root/incident/SKILL.md"
  if discovery_routing_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_DISCOVERY_FIXTURE/plugin" "$LINT_DISCOVERY_FIXTURE" 2>&1)"; then
    echo "FAIL: rule 7 ignored a new $routing_host operator-only mode"; fail=$((fail + 1))
  else
    case "$discovery_routing_report" in
      *"bootstrap/$routing_host-global.md"*"omits"*"$discovery_invocation"*"Workflow routing"*)
        echo "ok: rule 7 discovers a new $routing_host operator-only mode from frontmatter"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the new $routing_host mode failed lint for the wrong reason — $(printf '%s' "$discovery_routing_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
done

# A glob over an absent Codex tree iterates once over its own literal text and
# can make a dynamic rule vacuously green.  Move the whole tree out of the path
# the linter owns and require rule 7's explicit anti-vacuity diagnostic; a
# nonzero caused only by the other host-aware rules does not clear this case.
LINT_CODEX_TREE_FIXTURE="$TEST_HOME/lint-routing-missing-codex-tree"
copy_lint_fixture "$LINT_CODEX_TREE_FIXTURE"
if [ ! -d "$LINT_CODEX_TREE_FIXTURE/codex/skills" ]; then
  echo "FAIL: the Codex tree mutation has no codex/skills directory to move"; fail=$((fail + 1))
else
  mv "$LINT_CODEX_TREE_FIXTURE/codex/skills" \
    "$LINT_CODEX_TREE_FIXTURE/codex/skills.deliberately-absent"
  if missing_codex_tree_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_CODEX_TREE_FIXTURE/plugin" "$LINT_CODEX_TREE_FIXTURE" 2>&1)"; then
    echo "FAIL: rule 7 passed with no codex/skills tree to derive modes from"; fail=$((fail + 1))
  else
    case "$missing_codex_tree_report" in
      *"lint: codex/skills is missing; cannot derive codex operator-only modes"*)
        echo "ok: rule 7 fails loudly when the Codex mode source tree is absent"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the absent Codex mode tree failed lint without rule 7's diagnostic — $(printf '%s' "$missing_codex_tree_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# S14 closes on linter rules 10–12 rather than a clean-tree run alone. Each
# mutation removes exactly the relation that rule owns and requires that rule's
# own diagnostic, so another incidental red cannot masquerade as coverage.
LINT_RECONCILIATION_FIXTURE="$TEST_HOME/lint-decision-reconciliation"
copy_lint_fixture "$LINT_RECONCILIATION_FIXTURE"
reconciliation_decision="$LINT_RECONCILIATION_FIXTURE/docs/decisions/0094-codex-baseline-and-minimum-version.md"
if [ ! -f "$reconciliation_decision" ]; then
  echo "FAIL: rule 10 mutation has no ADR-0094 fixture"; fail=$((fail + 1))
else
  sed '/^Reconciled:/d' "$reconciliation_decision" > "$reconciliation_decision.tmp"
  mv "$reconciliation_decision.tmp" "$reconciliation_decision"
  if reconciliation_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_RECONCILIATION_FIXTURE/plugin" "$LINT_RECONCILIATION_FIXTURE" 2>&1)"; then
    echo "FAIL: rule 10 accepted a decision with no reconciliation record"; fail=$((fail + 1))
  else
    case "$reconciliation_lint_report" in
      *"docs/decisions/0094-codex-baseline-and-minimum-version.md"*"carries no Reconciled:"*)
        echo "ok: rule 10 rejects a decision with no reconciliation record"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: rule 10 mutation failed for the wrong reason — $(printf '%s' "$reconciliation_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_CITATION_FIXTURE="$TEST_HOME/lint-decision-citation"
copy_lint_fixture "$LINT_CITATION_FIXTURE"
citation_decision="$LINT_CITATION_FIXTURE/docs/decisions/0095-runtime-state-keyed-by-repository.md"
if [ ! -f "$citation_decision" ]; then
  echo "FAIL: rule 11 mutation has no ADR-0095 fixture"; fail=$((fail + 1))
else
  sed 's/plugin\/hooks\/lib\.sh, //' "$citation_decision" > "$citation_decision.tmp"
  mv "$citation_decision.tmp" "$citation_decision"
  if grep -F 'Implemented-in:' "$citation_decision" | grep -qF 'plugin/hooks/lib.sh'; then
    echo "FAIL: rule 11 mutation did not remove its cited implementation"; fail=$((fail + 1))
  elif citation_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_CITATION_FIXTURE/plugin" "$LINT_CITATION_FIXTURE" 2>&1)"; then
    echo "FAIL: rule 11 accepted a decision that does not name its citer"; fail=$((fail + 1))
  else
    case "$citation_lint_report" in
      *"docs/decisions/0095-runtime-state-keyed-by-repository.md"*"cited by plugin/hooks/lib.sh"*"does not name it in Implemented-in:"*)
        echo "ok: rule 11 rejects a decision that does not name its citer"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: rule 11 mutation failed for the wrong reason — $(printf '%s' "$citation_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_RULE_COUNT_FIXTURE="$TEST_HOME/lint-rule-count"
copy_lint_fixture "$LINT_RULE_COUNT_FIXTURE"
sed 's/twenty rules/nineteen rules/' "$LINT_RULE_COUNT_FIXTURE/README.md" \
  > "$LINT_RULE_COUNT_FIXTURE/README.md.tmp"
mv "$LINT_RULE_COUNT_FIXTURE/README.md.tmp" "$LINT_RULE_COUNT_FIXTURE/README.md"
if rule_count_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_RULE_COUNT_FIXTURE/plugin" "$LINT_RULE_COUNT_FIXTURE" 2>&1)"; then
  echo "FAIL: rule 12 accepted stale present-tense rule-count prose"; fail=$((fail + 1))
else
  case "$rule_count_lint_report" in
    *"README.md does not name the twenty rules this linter declares"*)
      echo "ok: rule 12 rejects stale present-tense rule-count prose"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: rule 12 mutation failed for the wrong reason — $(printf '%s' "$rule_count_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
  esac
fi

# B7 (D3): rule 14 must reject a flow body that stopped pointing at the
# milestone contract, and name THAT body — never pass on the strength of the
# other two still carrying the reference. Strip only debug.md's sentence.
LINT_MILESTONE_BODY_FIXTURE="$TEST_HOME/lint-milestone-body"
copy_lint_fixture "$LINT_MILESTONE_BODY_FIXTURE"
milestone_body_target="$LINT_MILESTONE_BODY_FIXTURE/plugin/skills/_shared/bodies/debug.md"
if ! grep -qF 'reports under the milestone contract at `_shared/reporting.md`' "$milestone_body_target"; then
  echo "FAIL: the milestone-body mutation found no reporting.md reference to remove from debug.md"; fail=$((fail + 1))
else
  sed '/reports under the milestone contract at `_shared\/reporting\.md`/d' "$milestone_body_target" \
    > "$milestone_body_target.tmp"
  mv "$milestone_body_target.tmp" "$milestone_body_target"
  if grep -qF 'reporting.md' "$milestone_body_target"; then
    echo "FAIL: the milestone-body mutation left a reporting.md reference standing in debug.md"; fail=$((fail + 1))
  elif milestone_body_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_MILESTONE_BODY_FIXTURE/plugin" "$LINT_MILESTONE_BODY_FIXTURE" 2>&1)"; then
    echo "FAIL: a flow body missing the milestone contract reference passed plugin lint"; fail=$((fail + 1))
  else
    case "$milestone_body_report" in
      *"skills/_shared/bodies/debug.md arms or launches without referencing the milestone contract"*)
        echo "ok: rule 14 rejects debug.md by name when it stops pointing at the milestone contract"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the milestone-body mutation failed for the wrong reason — $(printf '%s' "$milestone_body_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B7 (D3): rule 14's second half — a milestone reduced to "report the result"
# is the exact defect this contract exists to close, so mention of the
# "Closing" header alone must not satisfy it once its required facts (commit,
# next) are gone.
LINT_MILESTONE_FACTS_FIXTURE="$TEST_HOME/lint-milestone-facts"
copy_lint_fixture "$LINT_MILESTONE_FACTS_FIXTURE"
milestone_facts_target="$LINT_MILESTONE_FACTS_FIXTURE/plugin/skills/_shared/reporting.md"
if ! grep -qF -- '- **Closing** —' "$milestone_facts_target"; then
  echo "FAIL: the milestone-facts mutation found no Closing bullet to reduce"; fail=$((fail + 1))
else
  sed 's/^- \*\*Closing\*\* —.*/- **Closing** — report the result./' "$milestone_facts_target" \
    > "$milestone_facts_target.tmp"
  mv "$milestone_facts_target.tmp" "$milestone_facts_target"
  if milestone_facts_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_MILESTONE_FACTS_FIXTURE/plugin" "$LINT_MILESTONE_FACTS_FIXTURE" 2>&1)"; then
    echo "FAIL: a 'Closing' milestone reduced to report-the-result passed plugin lint"; fail=$((fail + 1))
  else
    case "$milestone_facts_report" in
      *"'Closing' milestone never names its required fact: commit"*)
        echo "ok: rule 14 rejects a milestone reduced to report-the-result for missing its required facts"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the milestone-facts mutation failed for the wrong reason — $(printf '%s' "$milestone_facts_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B7 (D3): rule 14's length bound — the operator asked for visibility, not
# narration, so the contract must state a bound in prose the linter can find;
# remove it and confirm the rule notices rather than reading a milestone list
# with no ceiling as complete.
LINT_MILESTONE_BOUND_FIXTURE="$TEST_HOME/lint-milestone-bound"
copy_lint_fixture "$LINT_MILESTONE_BOUND_FIXTURE"
milestone_bound_target="$LINT_MILESTONE_BOUND_FIXTURE/plugin/skills/_shared/reporting.md"
if ! grep -qE '^At most [0-9]+ lines' "$milestone_bound_target"; then
  echo "FAIL: the milestone-bound mutation found no length-bound sentence to remove"; fail=$((fail + 1))
else
  sed '/^At most [0-9][0-9]* lines/d' "$milestone_bound_target" > "$milestone_bound_target.tmp"
  mv "$milestone_bound_target.tmp" "$milestone_bound_target"
  if milestone_bound_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_MILESTONE_BOUND_FIXTURE/plugin" "$LINT_MILESTONE_BOUND_FIXTURE" 2>&1)"; then
    echo "FAIL: a milestone contract with no length bound passed plugin lint"; fail=$((fail + 1))
  else
    case "$milestone_bound_report" in
      *"skills/_shared/reporting.md names no length bound on a milestone report"*)
        echo "ok: rule 14 rejects a milestone contract with no stated length bound"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the milestone-bound mutation failed for the wrong reason — $(printf '%s' "$milestone_bound_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B7 (D3): rule 15 — the Claude-card fact belongs to exactly one platform/claude
# file. Copy its sentence into a SECOND one (quick.md) and confirm the rule
# counts files rather than merely checking the fact is stated somewhere.
LINT_MILESTONE_HOST_FIXTURE="$TEST_HOME/lint-milestone-host"
copy_lint_fixture "$LINT_MILESTONE_HOST_FIXTURE"
milestone_host_source="$LINT_MILESTONE_HOST_FIXTURE/plugin/skills/_shared/platform/claude/reporting.md"
milestone_host_target="$LINT_MILESTONE_HOST_FIXTURE/plugin/skills/_shared/platform/claude/quick.md"
if [ ! -f "$milestone_host_source" ] || [ ! -f "$milestone_host_target" ]; then
  echo "FAIL: the milestone-host mutation is missing its source or target file"; fail=$((fail + 1))
else
  { grep -F 'native subagent card' "$milestone_host_source" || true; } >> "$milestone_host_target"
  if ! grep -qF 'native subagent card' "$milestone_host_target"; then
    echo "FAIL: the milestone-host mutation did not duplicate the native-card sentence"; fail=$((fail + 1))
  elif milestone_host_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_MILESTONE_HOST_FIXTURE/plugin" "$LINT_MILESTONE_HOST_FIXTURE" 2>&1)"; then
    echo "FAIL: the native-card fact duplicated across two platform/claude files passed plugin lint"; fail=$((fail + 1))
  else
    case "$milestone_host_report" in
      *"the native-card difference is stated in 2 platform/claude files instead of exactly one"*)
        echo "ok: rule 15 rejects the native-card fact duplicated across two platform/claude files"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the milestone-host mutation failed for the wrong reason — $(printf '%s' "$milestone_host_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B8 (D4/ADR-0116): rule 16 must reject a design-foundation slice paragraph that
# regressed to the undifferentiated `init`/`document` phrasing the Astro-landing
# incident traced to — strip only the `init` attribution and confirm the
# paragraph-scoped check names it specifically, not the read-before-cut markers
# still standing beside it.
LINT_DESIGN_FOUNDATION_FIXTURE="$TEST_HOME/lint-design-foundation"
copy_lint_fixture "$LINT_DESIGN_FOUNDATION_FIXTURE"
design_foundation_target="$LINT_DESIGN_FOUNDATION_FIXTURE/plugin/skills/_shared/bodies/plan.md"
if ! grep -qF '`init` writes `PRODUCT.md`' "$design_foundation_target"; then
  echo "FAIL: rule 16 mutation found no init/PRODUCT.md attribution to remove from plan.md"; fail=$((fail + 1))
else
  sed 's/`init` writes `PRODUCT\.md`/`init` writes a document/' "$design_foundation_target" \
    > "$design_foundation_target.tmp"
  mv "$design_foundation_target.tmp" "$design_foundation_target"
  if grep -qF '`init` writes `PRODUCT.md`' "$design_foundation_target"; then
    echo "FAIL: rule 16 mutation left the init/PRODUCT.md attribution standing in plan.md"; fail=$((fail + 1))
  elif design_foundation_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_DESIGN_FOUNDATION_FIXTURE/plugin" "$LINT_DESIGN_FOUNDATION_FIXTURE" 2>&1)"; then
    echo "FAIL: a Design-foundation slice paragraph missing its init/PRODUCT.md attribution passed plugin lint"; fail=$((fail + 1))
  else
    case "$design_foundation_report" in
      *"skills/_shared/bodies/plan.md's Design-foundation slice paragraph never states: \`init\` writes \`PRODUCT.md\`"*)
        echo "ok: rule 16 rejects a design-foundation slice paragraph that drops what init produces"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: rule 16 mutation failed for the wrong reason — $(printf '%s' "$design_foundation_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

# B9 (D4/ADR-0117): rule 17 must reject the third amendment lane if it loses
# its citation requirement specifically — the condition the ledger names as the
# one that must never silently drop, since an uncited correction is the harness
# rewriting an approved slice on its own word.
LINT_THIRD_LANE_FIXTURE="$TEST_HOME/lint-third-amendment-lane"
copy_lint_fixture "$LINT_THIRD_LANE_FIXTURE"
third_lane_target="$LINT_THIRD_LANE_FIXTURE/plugin/skills/_shared/platform/codex/plan.md"
if ! grep -qF 'CITES the evidence' "$third_lane_target"; then
  echo "FAIL: rule 17 mutation found no CITES condition to remove from the Codex plan platform file"; fail=$((fail + 1))
else
  sed 's/CITES the evidence/names the evidence/' "$third_lane_target" \
    > "$third_lane_target.tmp"
  mv "$third_lane_target.tmp" "$third_lane_target"
  if grep -qF 'CITES the evidence' "$third_lane_target"; then
    echo "FAIL: rule 17 mutation left the CITES condition standing in the Codex plan platform file"; fail=$((fail + 1))
  elif third_lane_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_THIRD_LANE_FIXTURE/plugin" "$LINT_THIRD_LANE_FIXTURE" 2>&1)"; then
    echo "FAIL: a third amendment lane missing its citation condition passed plugin lint"; fail=$((fail + 1))
  else
    case "$third_lane_report" in
      *"skills/_shared/platform/codex/plan.md's harness-discovered-correction lane never asserts: CITES"*)
        echo "ok: rule 17 rejects a third amendment lane that drops its citation condition"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: rule 17 mutation failed for the wrong reason — $(printf '%s' "$third_lane_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
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

  # B1 (D18): a PreToolUse gate script that declares no recovery route must not
  # land — a handler added (or edited down to) with no `# Recovery:` header line
  # fails the same table check a missing matcher or a missing script already do.
  RECOVERY_FIXTURE="$TEST_HOME/recovery-fixture"
  copy_lint_fixture "$RECOVERY_FIXTURE"
  RECOVERY_LESS_SCRIPT="$RECOVERY_FIXTURE/plugin/hooks/block-edits-without-slice.sh"
  sed '/^# Recovery:/,+1d' "$RECOVERY_LESS_SCRIPT" > "$RECOVERY_LESS_SCRIPT.tmp"
  mv "$RECOVERY_LESS_SCRIPT.tmp" "$RECOVERY_LESS_SCRIPT"
  if grep -q '^# Recovery:' "$RECOVERY_LESS_SCRIPT"; then
    echo "FAIL: the recovery-route mutation left the header line standing"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a PreToolUse gate script with no declared recovery route fails the table check" \
      "gate \`edits\` script \`block-edits-without-slice.sh\` declares no recovery route" \
      --repo-root "$RECOVERY_FIXTURE" --table "$RECOVERY_FIXTURE/tools/hook-gates.txt" --check
  fi

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
  for collaboration_tool in \
    collaborationspawn_agent \
    collaborationsend_message \
    collaborationfollowup_task \
    collaborationwait_agent \
    collaborationinterrupt_agent \
    collaborationlist_agents; do
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

  NO_HANDOFF_MATCHERS_TABLE="$TEST_HOME/subagentstop-without-matchers.txt"
  sed '/^tool  handoff/d' "$REPO_ROOT/tools/hook-gates.txt" > "$NO_HANDOFF_MATCHERS_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$NO_HANDOFF_MATCHERS_TABLE"; then
    echo "FAIL: matcherless-SubagentStop mutation removed no tool row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a wired SubagentStop publisher with no agent matchers fails closed" \
      'wired SubagentStop gate `handoff` has no matcher for codex' \
      --repo-root "$REPO_ROOT" --table "$NO_HANDOFF_MATCHERS_TABLE" --check
  fi

  for approval_gate in planstop planprompt; do
    MISSING_APPROVAL_GATE_TABLE="$TEST_HOME/missing-${approval_gate}-gate.txt"
    sed "/^gate  ${approval_gate}[[:space:]]/d" \
      "$REPO_ROOT/tools/hook-gates.txt" > "$MISSING_APPROVAL_GATE_TABLE"
    if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$MISSING_APPROVAL_GATE_TABLE"; then
      echo "FAIL: missing-${approval_gate} mutation removed no gate row"; fail=$((fail + 1))
    else
      assert_renderer_rejects "the hard approval rail cannot omit ${approval_gate}" \
        "table must declare exactly the nine known gates" \
        --repo-root "$REPO_ROOT" --table "$MISSING_APPROVAL_GATE_TABLE" --check
    fi
  done

  # Codex explicitly ignores matcher on Stop and UserPromptSubmit. Letting the
  # source table add one would render a filter that looks protective and never
  # runs, so these global events must remain matcherless by construction.
  for matcherless_gate in planstop planprompt; do
    IGNORED_MATCHER_TABLE="$TEST_HOME/${matcherless_gate}-ignored-matcher.txt"
    cp "$REPO_ROOT/tools/hook-gates.txt" "$IGNORED_MATCHER_TABLE"
    printf '\ntool  %s  none  ignored  read  no\n' "$matcherless_gate" >> "$IGNORED_MATCHER_TABLE"
    case "$matcherless_gate" in
      planstop) matcherless_event=Stop ;;
      planprompt) matcherless_event=UserPromptSubmit ;;
    esac
    assert_renderer_rejects "${matcherless_gate} cannot carry a matcher Codex ignores" \
      "matcherless ${matcherless_event} gate \`${matcherless_gate}\` has matcher mappings for codex" \
      --repo-root "$REPO_ROOT" --table "$IGNORED_MATCHER_TABLE" --check
  done

  INCOMPLETE_CATCHALL_TABLE="$TEST_HOME/catchall-without-bash.txt"
  sed '/^tool  unknown  none  Bash[[:space:]]/d' \
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

  state_binary_hash="$(
    { sha256sum "$PLUGIN/bin/oso-state" 2>/dev/null || shasum -a 256 "$PLUGIN/bin/oso-state" 2>/dev/null; } |
      awk '{ print $1 }'
  )"
  published_state_hash="$(sed -n 's/^\([0-9a-f][0-9a-f]*\)  plugin\/bin\/oso-state$/\1/p' \
    "$REPO_ROOT/bootstrap/hook-hashes.txt")"
  assert_equals "the SubagentStop publisher's state binary is inside the published trust boundary" \
    "$state_binary_hash" "$published_state_hash"

  unpublished_approval_hooks=""
  approval_handlers_read=0
  for approval_handler in \
    plugin/hooks/capture-plan-approval.sh \
    plugin/hooks/approve-plan-token.sh; do
    approval_handlers_read=$((approval_handlers_read + 1))
    approval_handler_hash="$({
      sha256sum "$REPO_ROOT/$approval_handler" 2>/dev/null ||
        shasum -a 256 "$REPO_ROOT/$approval_handler" 2>/dev/null
    } | awk '{ print $1 }')"
    published_handler_hash="$(sed -n \
      "s/^\\([0-9a-f][0-9a-f]*\\)  ${approval_handler//\//\\/}$/\\1/p" \
      "$REPO_ROOT/bootstrap/hook-hashes.txt")"
    [ -n "$approval_handler_hash" ] && [ "$approval_handler_hash" = "$published_handler_hash" ] ||
      unpublished_approval_hooks="$unpublished_approval_hooks $approval_handler"
  done
  assert_equals "both approval handlers were actually read for trust-boundary coverage" \
    2 "$approval_handlers_read"
  assert_equals "both approval handlers are inside the published trust boundary" \
    "" "$unpublished_approval_hooks"
fi

# --- Runtime dispatch: Codex catch-all defaults unknown tools to deny ----------
# The table's classifier is a build-time contract; this is the runtime half. Its
# `.*` reaches every local tool call for which Codex emits PreToolUse; the hook
# becomes active only where oso-code state exists. That preserves ordinary Codex
# sessions while an armed harness run gets a closed allowlist rather than a future
# observable tool silently bypassing every named matcher.
UNKNOWN_TOOL_HOOK="$PLUGIN/hooks/block-unknown-tool.sh"
UNKNOWN_TOOL_ALLOWLIST='Bash|apply_patch|send_input|resume_agent|close_agent|collaborationspawn_agent|collaborationsend_message|collaborationfollowup_task|collaborationwait_agent|collaborationinterrupt_agent|collaborationlist_agents'
codex_tool_input() {
  local tool_name="$1" session_id="${2:-$SESSION}"
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{}}' \
    "$session_id" "$REPO_ROOT" "$tool_name"
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
for collaboration_tool in \
  collaborationspawn_agent \
  collaborationsend_message \
  collaborationfollowup_task \
  collaborationwait_agent \
  collaborationinterrupt_agent \
  collaborationlist_agents; do
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

# --- Runtime: the catch-all's pending check is scoped to plan_approval_session,
# never the repository at large (ADR-0107) -------------------------------------
# A stale or foreign pending must never deny a session with nothing pending —
# Bash included, since that was the trap: denied before the allowlist, with no
# local escape. The session that actually owns the pending plan still loses
# every local tool until native approval or CANCEL OSO PLAN; that denial, not
# its scope, is the documented contract.
PENDING_OWNER_SESSION="pending-owner-session"
PENDING_FOREIGN_SESSION="pending-foreign-session"
oso-state --session "$PENDING_OWNER_SESSION" set mode=plan active_slice=none verify_green=false \
  plan_approval=pending "plan_approval_session=$PENDING_OWNER_SESSION"

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash "$PENDING_FOREIGN_SESSION")" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "a pending belonging to another session does not deny this session's Bash" \
  [ -z "$hook_stdout" ]
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter "$PENDING_FOREIGN_SESSION")" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "a foreign pending still leaves the ordinary allowlist in force" \
  hook_returned_deny

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash "$PENDING_OWNER_SESSION")" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "the pending session's own Bash call is still denied while its plan is pending" \
  hook_returned_deny
case "$hook_stdout" in
  *'plan approval is pending. Use Codex native'*'approval, or send exactly CANCEL OSO PLAN to abandon it, before using local tools.'*)
    echo "ok: the scoped pending denial keeps the existing pending message"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the scoped pending denial lost the pending message — got: $hook_stdout"; fail=$((fail + 1)) ;;
esac
oso-state --session "$PENDING_OWNER_SESSION" clear

# --- Runtime: the catch-all's allowlist covers every spelling Codex has actually
# denied in the field, not just the shape a maintainer guessed it would use -------
# Eight live operator denials trace to two causes: the Engram Memory Protocol needs
# five tools the table never carried (mem_context, mem_session_summary,
# mem_current_project, mem_save_prompt, and mem_judge — the last a documented
# deadlock, since mem_save's own judgment_required=true response mandates it), and
# Codex renders two tool names differently than they're configured for
# (image_gen__imagegen loses its `__`, and the hyphen in
# mcp__context7__resolve-library-id becomes an underscore). A suspected third
# shape, plugin-scoped MCP naming (e.g. `mcp__plugin_engram_engram__mem_save`),
# is deliberately untested and absent from the table: Codex's own embedded model
# instructions state plugin-provided MCP tools keep the standard `mcp__server__tool`
# identifier regardless of provenance, confirmed live against this machine's
# installed Engram MCP server (`tools/list` under the configured `--tools=agent`
# profile returns bare `mcp__engram__*` names, never a plugin-scoped one). Read the
# allowlist live off the renderer rather than duplicating it here as a second copy,
# so a table regression is what turns this case red, not a stale copy of it.
RENDERED_UNKNOWN_ALLOWLIST="$("$HOOK_RENDERER" --host codex --table "$REPO_ROOT/tools/hook-gates.txt" |
  sed -n 's/.*--allow \\"\(.*\)\\""$/\1/p')"

oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
for observed_denial_name in \
  mcp__engram__mem_current_project \
  mcp__engram__mem_context \
  mcp__engram__mem_session_summary \
  mcp__engram__mem_judge \
  mcp__engram__mem_save_prompt \
  image_genimagegen \
  mcp__context7__resolve_library_id; do
  run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input "$observed_denial_name")" 0 '' \
    --allow "$RENDERED_UNKNOWN_ALLOWLIST"
  assert_after_hook "$observed_denial_name (live operator denial) now passes the catch-all" \
    [ -z "$hook_stdout" ]
done

# A real tool on the same Engram MCP server that the table never named still
# denies: the fix widens the table's known names, it does not turn the gate into
# a prefix-only check for anything spelled mcp__engram__*.
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input mcp__engram__mem_stats)" 0 '' \
  --allow "$RENDERED_UNKNOWN_ALLOWLIST"
assert_after_hook "an unnamed Engram tool (mem_stats) is still denied by the catch-all" \
  hook_returned_deny
oso-state --session "$SESSION" clear

# --- Runtime: Codex's plan approval is a three-hook hard gate ---------------
# Stop observes exactly the repaso-first document Codex is about to finish with,
# UserPromptSubmit composes Codex's native approval prompt with the pending
# digest, and the PreToolUse catch-all keeps even release-known local tools
# closed in between. The state also names an immutable snapshot plus one mutable
# operational plan outside the repository.
PLAN_STOP_HOOK="$PLUGIN/hooks/capture-plan-approval.sh"
PLAN_PROMPT_HOOK="$PLUGIN/hooks/approve-plan-token.sh"

codex_stop_input() {
  local permission_mode="$1" session_id="$2" escaped_message="$3"
  local stop_hook_active="${4:-false}"
  local transcript_path="${5:-}" transcript_json=null
  [ -z "$transcript_path" ] || transcript_json="\"${transcript_path}\""
  printf '{"session_id":"%s","transcript_path":%s,"cwd":"%s","permission_mode":"%s","hook_event_name":"Stop","turn_id":"turn-plan-stop","stop_hook_active":%s,"last_assistant_message":"%s"}' \
    "$session_id" "$transcript_json" "$REPO_ROOT" "$permission_mode" \
    "$stop_hook_active" "$escaped_message"
}

codex_prompt_input() {
  local permission_mode="$1" session_id="$2" escaped_prompt="$3"
  local transcript_path="${4:-}" transcript_json=null
  [ -z "$transcript_path" ] || transcript_json="\"${transcript_path}\""
  printf '{"session_id":"%s","transcript_path":%s,"cwd":"%s","permission_mode":"%s","hook_event_name":"UserPromptSubmit","turn_id":"turn-plan-prompt","prompt":"%s"}' \
    "$session_id" "$transcript_json" "$REPO_ROOT" "$permission_mode" "$escaped_prompt"
}

write_codex_transcript() {
  local path="$1" session_id="$2" turn_id="$3" collaboration_mode="$4"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' \
    "{\"timestamp\":\"2026-08-04T16:36:12.000Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"${session_id}\"}}" \
    "{\"timestamp\":\"2026-08-04T16:36:12.013Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"${turn_id}\",\"collaboration_mode_kind\":\"${collaboration_mode}\"}}" \
    > "$path"
}

append_codex_plan_item() {
  local path="$1" session_id="$2" turn_id="$3" escaped_text="$4"
  printf '%s\n' \
    "{\"timestamp\":\"2026-08-04T16:36:12.021Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"item_completed\",\"thread_id\":\"${session_id}\",\"turn_id\":\"${turn_id}\",\"item\":{\"type\":\"Plan\",\"id\":\"${turn_id}-plan\",\"text\":\"${escaped_text}\"}}}" \
    >> "$path"
}

PLAN_MARKER='<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
CODEX_TRANSCRIPT_DIR="$TEST_HOME/.codex/sessions/2026/08/04"
CODEX_PROMPT_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/prompt-plan.jsonl"
CODEX_PROMPT_DEFAULT_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/prompt-default.jsonl"
CODEX_PROMPT_FOREIGN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/prompt-foreign.jsonl"
CODEX_STOP_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-plan.jsonl"
CODEX_STOP_DEFAULT_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-default.jsonl"
CODEX_STOP_MARKER_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-marker-plan.jsonl"
CODEX_STOP_NO_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-no-plan.jsonl"
CODEX_STOP_FOREIGN_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-foreign-plan.jsonl"
CODEX_STOP_DUPLICATE_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-duplicate-plan.jsonl"
CODEX_STOP_EMPTY_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-empty-plan.jsonl"
CODEX_STOP_WRONG_THREAD_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-wrong-thread-plan.jsonl"
CODEX_STOP_SELF_MARKER_PLAN_TRANSCRIPT="$CODEX_TRANSCRIPT_DIR/stop-self-marker-plan.jsonl"
write_codex_transcript \
  "$CODEX_PROMPT_PLAN_TRANSCRIPT" "$SESSION" turn-plan-prompt plan
write_codex_transcript \
  "$CODEX_PROMPT_DEFAULT_TRANSCRIPT" "$SESSION" turn-plan-prompt default
write_codex_transcript \
  "$CODEX_PROMPT_FOREIGN_TRANSCRIPT" other-session turn-plan-prompt plan
write_codex_transcript \
  "$CODEX_STOP_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_DEFAULT_TRANSCRIPT" "$SESSION" turn-plan-stop default
write_codex_transcript \
  "$CODEX_STOP_MARKER_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_NO_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_FOREIGN_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_DUPLICATE_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_EMPTY_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_WRONG_THREAD_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
write_codex_transcript \
  "$CODEX_STOP_SELF_MARKER_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop plan
append_codex_plan_item \
  "$CODEX_STOP_MARKER_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop \
  'Transcript plan heading\nTranscript plan body'
append_codex_plan_item \
  "$CODEX_STOP_FOREIGN_PLAN_TRANSCRIPT" "$SESSION" foreign-plan-turn \
  'Foreign turn plan'
append_codex_plan_item \
  "$CODEX_STOP_DUPLICATE_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop \
  'First duplicate plan'
append_codex_plan_item \
  "$CODEX_STOP_DUPLICATE_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop \
  'Second duplicate plan'
append_codex_plan_item \
  "$CODEX_STOP_EMPTY_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop ''
append_codex_plan_item \
  "$CODEX_STOP_WRONG_THREAD_PLAN_TRANSCRIPT" other-thread-session turn-plan-stop \
  'Plan item recorded under a different thread'
append_codex_plan_item \
  "$CODEX_STOP_SELF_MARKER_PLAN_TRANSCRIPT" "$SESSION" turn-plan-stop \
  'Plan text\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'

resolved_codex_mode_by() {
  (
    . "$PLUGIN/hooks/lib.sh"
    JSON_READER="$1"
    resolve_codex_turn_mode "$2"
    printf '%s:%s' "$CODEX_TURN_MODE" "$CODEX_TURN_MODE_SOURCE"
  )
}

real_codex_plan_prompt="$(
  codex_prompt_input default "$SESSION" '$oso-code:plan repair approval' \
    "$CODEX_PROMPT_PLAN_TRANSCRIPT"
)"
assert_equals "the pure-Bash reader attests Codex 0.146 Plan Mode from its turn" \
  plan:transcript "$(resolved_codex_mode_by pattern "$real_codex_plan_prompt")"

sha256_text() {
  local digest
  digest="$(printf '%s' "$1" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || digest=""
  printf '%s' "${digest%% *}"
}

hook_returned_block() {
  case "$hook_stdout" in *'"decision":"block"'*) return 0 ;; *) return 1 ;; esac
}

hook_returned_prompt_context() {
  case "$hook_stdout" in
    *'"hookEventName":"UserPromptSubmit"'*'"additionalContext":'*) return 0 ;;
    *) return 1 ;;
  esac
}

hook_returned_continue_false() {
  case "$hook_stdout" in *'"continue":false'*) return 0 ;; *) return 1 ;; esac
}

approval_state_snapshot() {
  if [ -f "$REPO_STATE" ]; then
    cat "$REPO_STATE"
  else
    printf '<no-state>'
  fi
}

oso-state --session "$SESSION" clear
events_before_ordinary_stop="$(wc -c < "$STATE_DIR/events.jsonl" 2>/dev/null || printf 0)"
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input plan "$SESSION" 'ordinary plan-mode answer with no harness marker')"
assert_after_hook "a markerless Stop is valid empty JSON, not plain text" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a markerless Stop creates no oso-code state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"
assert_equals "a markerless Stop records no harness event" \
  "$events_before_ordinary_stop" "$(wc -c < "$STATE_DIR/events.jsonl" 2>/dev/null || printf 0)"

# A reserved marker in the final decoded line is harness traffic, so ambiguity
# cannot silently publish a different plan. An exact marker earlier in ordinary
# prose is not a rail attempt and stays invisible.
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input plan "$SESSION" 'Repaso\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\ntrailing text')"
assert_after_hook "an exact marker outside the final line stays globally invisible" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a non-final marker writes no approval state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

for malformed_stop_case in \
  'Repaso\n<!-- oso-plan-approval: v=2 action=WRONG_ACTION -->' \
  'Repaso\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\n\n' \
  '<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->' \
  'Repaso\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'; do
  run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$malformed_stop_case")"
  assert_after_hook "a malformed, double-LF, marker-only or duplicate rail blocks Stop" \
    hook_returned_block
  assert_equals "a rejected Stop marker writes no approval state" \
    absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"
done

marker_only_plan='Transcript plan heading\nTranscript plan body'
marker_only_plan_document="$(printf 'Transcript plan heading\nTranscript plan body')"
marker_only_digest="$(sha256_text "${marker_only_plan}\\n${PLAN_MARKER}")"
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$CODEX_STOP_MARKER_PLAN_TRANSCRIPT")"
assert_after_hook "marker-only Stop reconstructs the exact-turn native Plan item and records pending approval" \
  [ "$hook_stdout" = '{}' ]
assert_equals "marker-only Stop records pending approval" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "marker-only Stop binds digest to the Plan item plus marker" \
  "$marker_only_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
assert_equals "marker-only Stop records the presenting session" \
  "$SESSION" "$(oso-state --session "$SESSION" get session)"
marker_only_presented_file="$REPO_PLAN_DIR/presented-${marker_only_digest}.md"
marker_only_current_file="$REPO_PLAN_DIR/current.md"
assert_equals "marker-only Stop snapshots the exact native Plan item" \
  "$marker_only_plan_document" "$(cat "$marker_only_presented_file" 2>/dev/null || true)"
assert_equals "marker-only Stop publishes the Plan item as current.md" \
  "$marker_only_plan_document" "$(cat "$marker_only_current_file" 2>/dev/null || true)"
oso-state --session "$SESSION" clear

for marker_only_bad_transcript in \
  "$CODEX_STOP_NO_PLAN_TRANSCRIPT" \
  "$CODEX_STOP_FOREIGN_PLAN_TRANSCRIPT" \
  "$CODEX_STOP_DUPLICATE_PLAN_TRANSCRIPT" \
  "$CODEX_STOP_EMPTY_PLAN_TRANSCRIPT"; do
  run_hook "$PLAN_STOP_HOOK" \
    "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$marker_only_bad_transcript")"
  assert_after_hook "marker-only Stop rejects missing, foreign, duplicate or empty native Plan items" \
    hook_returned_block
  assert_equals "a rejected marker-only Plan item writes no approval state" \
    absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"
done

# --- A6: the six structurally distinct marker failures read as six distinct
# causes, not one collapsed sentence — a future re-merge back into the pre-A6
# catch-all sentence is exactly what this turns red. -------------------------
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input plan "$SESSION" 'Repaso\n<!-- oso-plan-approval: v=2 action=WRONG_ACTION -->')"
assert_after_hook "the marker position-and-count cause blocks Stop" hook_returned_block
marker_reason_position_count="$hook_stdout"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input plan "$SESSION" "$PLAN_MARKER")"
assert_after_hook "the marker-only-without-attestation cause blocks Stop" hook_returned_block
marker_reason_no_attestation="$hook_stdout"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$CODEX_STOP_NO_PLAN_TRANSCRIPT")"
assert_after_hook "the zero-or-many Plan items cause blocks Stop" hook_returned_block
marker_reason_item_count="$hook_stdout"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$CODEX_STOP_WRONG_THREAD_PLAN_TRANSCRIPT")"
assert_after_hook "the turn/thread mismatch cause blocks Stop" hook_returned_block
marker_reason_turn_thread="$hook_stdout"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$CODEX_STOP_EMPTY_PLAN_TRANSCRIPT")"
assert_after_hook "the empty Plan text cause blocks Stop" hook_returned_block
marker_reason_empty_text="$hook_stdout"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$PLAN_MARKER" false "$CODEX_STOP_SELF_MARKER_PLAN_TRANSCRIPT")"
assert_after_hook "the Plan-item-carries-its-own-marker cause blocks Stop" hook_returned_block
marker_reason_self_marker="$hook_stdout"

marker_reason_distinct_count="$(printf '%s\n' \
  "$marker_reason_position_count" "$marker_reason_no_attestation" "$marker_reason_item_count" \
  "$marker_reason_turn_thread" "$marker_reason_empty_text" "$marker_reason_self_marker" |
  LC_ALL=C sort -u | grep -c '')"
assert_equals "the six marker failures read as six distinct operator-facing causes" \
  6 "$marker_reason_distinct_count"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" 'Repaso\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->' false "$CODEX_STOP_DEFAULT_TRANSCRIPT")"
assert_after_hook "a valid plan marker outside Plan Mode blocks Stop" \
  hook_returned_block
assert_equals "a wrong-mode Stop writes no approval state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" 'Repaso\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->' true)"
assert_after_hook "a repeated active Stop rail ends instead of continuing forever" \
  hook_returned_continue_false
assert_equals "an active Stop retry writes no approval state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" 'Repaso corrected\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->' true "$CODEX_STOP_PLAN_TRANSCRIPT")"
assert_after_hook "a real Codex 0.146 Plan Stop can capture a corrected valid plan" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a corrected active Stop retry publishes pending state" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
oso-state --session "$SESSION" clear

# Skill entry requires native Plan Mode before phase 0. The native approval
# phrase is common Codex vocabulary, so it remains globally invisible when no
# Oso document is pending.
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'ordinary question outside oso-code')"
assert_after_hook "an ordinary prompt outside the harness stays invisible" \
  [ "$hook_stdout" = '{}' ]
assert_equals "an ordinary prompt outside the harness writes no state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" '$oso-code:plan repair approval' "$CODEX_PROMPT_DEFAULT_TRANSCRIPT")"
assert_after_hook "a Codex plan skill invocation outside native Plan Mode is rejected early" \
  hook_returned_block
assert_equals "a rejected Default-mode plan invocation writes no state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" '$oso-code:plan repair approval' "$CODEX_PROMPT_PLAN_TRANSCRIPT")"
assert_after_hook "the real Codex 0.146 payload allows a native Plan Mode invocation" \
  [ "$hook_stdout" = '{}' ]

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input plan "$SESSION" '$oso-code:plan repair approval' "$CODEX_PROMPT_FOREIGN_TRANSCRIPT")"
assert_after_hook "a foreign transcript cannot fall through to permission_mode=plan" \
  hook_returned_block

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
assert_after_hook "the native approval phrase with no pending Oso plan stays invisible" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a no-pending native approval writes no state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.' "$CODEX_PROMPT_PLAN_TRANSCRIPT")"
assert_after_hook "the native phrase with no pending plan is also invisible in Plan Mode" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a no-pending Plan Mode phrase writes no state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

# Real Codex Stop transport appends one LF after the assistant's final logical
# line. Preserve that escaped byte in the fixture so the digest assertion below
# proves that acceptance does not normalize the wire representation.
first_plan='Repaso de cambios\nFull slice plan: alpha\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\n'
first_plan_digest="$(sha256_text "$first_plan")"
first_plan_without_host_lf='Repaso de cambios\nFull slice plan: alpha\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
first_plan_without_host_lf_digest="$(sha256_text "$first_plan_without_host_lf")"
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$first_plan" false "$CODEX_STOP_PLAN_TRANSCRIPT")"
assert_after_hook "one host terminal LF preserves a real Codex Plan Mode document" \
  [ "$hook_stdout" = '{}' ]
assert_equals "Stop records a pending approval" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "Stop binds approval to the complete observed message digest" \
  "$first_plan_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
case "$first_plan_digest" in
  "$first_plan_without_host_lf_digest")
    echo "FAIL: the terminal-LF fixture was normalized before hashing"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the terminal-LF fixture keeps its distinct wire digest"; pass=$((pass + 1)) ;;
esac
captured_plan_digest="$(oso-state --session "$SESSION" get plan_approval_digest)"
case "$captured_plan_digest" in
  ''|*[!0-9a-f]*) digest_shape=invalid ;;
  *) [ "${#captured_plan_digest}" -eq 64 ] && digest_shape=valid || digest_shape=invalid ;;
esac
assert_equals "the captured plan digest is exactly 64 lowercase hex" valid "$digest_shape"
assert_equals "Stop records the sanitized session that presented the plan" \
  "$SESSION" "$(oso-state --session "$SESSION" get session)"
first_presented_file="$REPO_PLAN_DIR/presented-${first_plan_digest}.md"
first_approved_file="$REPO_PLAN_DIR/approved-${first_plan_digest}.md"
first_current_file="$REPO_PLAN_DIR/current.md"
first_plan_document="$(printf 'Repaso de cambios\nFull slice plan: alpha')"
assert_equals "Stop names the pending immutable snapshot in state" \
  "$first_presented_file" "$(oso-state --session "$SESSION" get plan_snapshot_file)"
assert_equals "Stop names the operational plan in state" \
  "$first_current_file" "$(oso-state --session "$SESSION" get plan_current_file)"
assert_equals "a newly captured operational plan starts at revision zero" \
  0 "$(oso-state --session "$SESSION" get plan_revision)"
assert_equals "the pending snapshot contains the human plan without the internal marker" \
  "$first_plan_document" "$(cat "$first_presented_file" 2>/dev/null || true)"
assert_equals "the operational plan starts from the same human document" \
  "$first_plan_document" "$(cat "$first_current_file" 2>/dev/null || true)"
assert_equals "the repository plan directory is owner-only" 0700 \
  "$([ -d "$REPO_PLAN_DIR" ] && find "$REPO_PLAN_DIR" -maxdepth 0 -type d -perm 0700 -print | grep -q . && printf 0700 || printf wrong)"
assert_equals "pending plan artifacts are owner-only" 0600 \
  "$([ -f "$first_presented_file" ] && [ -f "$first_current_file" ] && \
      find "$first_presented_file" "$first_current_file" -maxdepth 0 -type f -perm 0600 -print | \
        wc -l | tr -d ' ' | grep -qx 2 && printf 0600 || printf wrong)"
assert_equals "the hidden marker is absent from both persisted plan artifacts" \
  0 "$(grep -l 'oso-plan-approval:' "$first_presented_file" "$first_current_file" 2>/dev/null | wc -l | tr -d ' ')"
pending_current_before_amendment="$(cat "$first_current_file")"

# D18's second half: a pending plan is amendable in place, directly through
# oso-state, rather than only after approval. Neither the presented snapshot
# nor its digest moves for a pending amendment.
if printf '%s' '### Direct feedback' | oso-state --session "$SESSION" amend-plan direct-feedback >/dev/null 2>&1; then
  echo "ok: amend-plan accepts a direct amendment while a plan is pending"; pass=$((pass + 1))
else
  echo "FAIL: amend-plan rejected a pending amendment"; fail=$((fail + 1))
fi
assert_equals "a direct pending amendment leaves approval pending" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "a direct pending amendment increments the operational plan revision" \
  1 "$(oso-state --session "$SESSION" get plan_revision)"
case "$(cat "$first_current_file")" in
  *'## Plan Mode feedback — direct-feedback'*'Requested-by: operator'*'### Direct feedback'*)
    echo "ok: the operational plan records the pending amendment"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the operational plan does not contain the pending amendment"; fail=$((fail + 1)) ;;
esac
assert_equals "a pending amendment never mutates the immutable presented snapshot" \
  "$first_plan_document" "$(cat "$first_presented_file" 2>/dev/null || true)"

# Case (c), made strict: the digest never moved, but the document it named has,
# so approving the OLD digest must fail — the proof that fluidity did not cost
# the property that approval binds the exact document the operator read.
if oso-state --session "$SESSION" approve-plan "$first_plan_digest" >/dev/null 2>&1; then
  echo "FAIL: approve-plan approved a document amended since it was presented"; fail=$((fail + 1))
else
  echo "ok: approve-plan rejects the presented digest once the pending document is amended"; pass=$((pass + 1))
fi
assert_equals "a rejected stale approval leaves approval pending" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "a rejected stale approval does not touch the immutable presented snapshot" \
  "$first_plan_document" "$(cat "$first_presented_file" 2>/dev/null || true)"

# A normal non-plan reply does not silently approve or cancel. A Plan Mode
# reply from the same pending session means the operator requested a change,
# and the hook now routes that through amend-plan instead of cancel-plan.
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'please explain one risk first' "$CODEX_PROMPT_DEFAULT_TRANSCRIPT")"
assert_after_hook "ordinary non-plan feedback remains ordinary JSON success" \
  [ "$hook_stdout" = '{}' ]
assert_equals "ordinary non-plan feedback leaves approval pending" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"

session_before_ordinary_amendment="$(oso-state --session "$SESSION" get plan_approval_session)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'revise the second slice' "$CODEX_PROMPT_PLAN_TRANSCRIPT")"
assert_after_hook "real Codex 0.146 Plan Mode feedback amends the pending document" \
  hook_returned_prompt_context
case "$hook_stdout" in
  *'Present the amendment'*) echo "ok: Case (e) — the guidance asks for the amendment"; pass=$((pass + 1)) ;;
  *) echo "FAIL: Case (e) — the guidance does not name the amendment — got: $hook_stdout"; fail=$((fail + 1)) ;;
esac
case "$hook_stdout" in
  *'not the complete plan'*) echo "ok: Case (e) — the guidance excuses the complete document"; pass=$((pass + 1)) ;;
  *) echo "FAIL: Case (e) — the guidance does not excuse the complete document"; fail=$((fail + 1)) ;;
esac
case "$hook_stdout" in
  *'invalidated'*) echo "FAIL: the guidance still speaks of invalidating the pending document"; fail=$((fail + 1)) ;;
  *) echo "ok: the guidance no longer speaks of invalidating the pending document"; pass=$((pass + 1)) ;;
esac
assert_equals "Case (a) — an ordinary Plan Mode turn leaves plan_approval=pending standing" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "Case (a) — an ordinary Plan Mode turn increments plan_revision" \
  2 "$(oso-state --session "$SESSION" get plan_revision)"
assert_equals "Case (b) — plan_approval_session survives the amendment unchanged" \
  "$session_before_ordinary_amendment" "$(oso-state --session "$SESSION" get plan_approval_session)"
assert_equals "an ordinary Plan Mode turn does not clear the pending state" \
  present "$([ -e "$REPO_STATE" ] && printf present || printf absent)"
assert_equals "an ordinary Plan Mode turn preserves the unapproved presented snapshot" \
  present "$([ -e "$first_presented_file" ] && printf present || printf absent)"
assert_equals "an ordinary Plan Mode turn preserves the operational copy" \
  present "$([ -e "$first_current_file" ] && printf present || printf absent)"
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "a still-pending amendment keeps local tools gated exactly as a fresh pending would" \
  hook_returned_deny

# Case (d): explicit cancellation stays exactly as it was — an abandonment
# rail, not a second approval prompt. It works before or after the UI mode
# toggle, but only for the pending session.
run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$first_plan")"
assert_after_hook "the plan can be re-presented after an amendment" \
  [ "$hook_stdout" = '{}' ]
cancel_pending_snapshot="$(approval_state_snapshot)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default other-session 'CANCEL OSO PLAN')"
assert_after_hook "a different session cannot cancel the pending document" \
  hook_returned_block
assert_equals "a wrong-session cancellation does not erase pending state" \
  "$cancel_pending_snapshot" "$(approval_state_snapshot)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'CANCEL OSO PLAN' "$CODEX_PROMPT_PLAN_TRANSCRIPT")"
assert_after_hook "the exact same-session cancellation works in Plan Mode" \
  hook_returned_prompt_context
assert_equals "Plan Mode cancellation removes pending state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'CANCEL OSO PLAN')"
assert_after_hook "cancellation with no pending document is blocked" \
  hook_returned_block
assert_equals "a no-pending cancellation does not manufacture state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$first_plan")"
assert_after_hook "the plan can be re-presented for non-plan cancellation" \
  [ "$hook_stdout" = '{}' ]
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'CANCEL OSO PLAN')"
assert_after_hook "the exact same-session cancellation works after mode toggle" \
  hook_returned_prompt_context
assert_equals "non-plan cancellation removes pending state" \
  absent "$([ ! -e "$REPO_STATE" ] && printf absent || printf present)"

run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$first_plan")"
assert_after_hook "the plan can be presented again after explicit cancellation" \
  [ "$hook_stdout" = '{}' ]

# The digest is a compare-and-swap precondition, not descriptive metadata. A
# stale caller cannot approve or cancel the current document, and an internally
# inconsistent pending state cannot open tools or be approved by the prompt.
pending_snapshot="$(approval_state_snapshot)"
stale_digest="$(printf '%064d' 0)"
if oso-state --session "$SESSION" approve-plan "$stale_digest" >/dev/null 2>&1; then
  echo "FAIL: approve-plan accepted a stale document digest"; fail=$((fail + 1))
else
  echo "ok: approve-plan rejects a stale document digest"; pass=$((pass + 1))
fi
assert_equals "a stale approval CAS leaves pending state byte-identical" \
  "$pending_snapshot" "$(approval_state_snapshot)"
if oso-state --session "$SESSION" cancel-plan "$stale_digest" >/dev/null 2>&1; then
  echo "FAIL: cancel-plan accepted a stale document digest"; fail=$((fail + 1))
else
  echo "ok: cancel-plan rejects a stale document digest"; pass=$((pass + 1))
fi
assert_equals "a stale cancellation CAS leaves pending state byte-identical" \
  "$pending_snapshot" "$(approval_state_snapshot)"

oso-state --session "$SESSION" set mode=debug >/dev/null
inconsistent_pending_snapshot="$(approval_state_snapshot)"
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "an inconsistent pending mode still denies allowlisted tools" \
  hook_returned_deny
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
assert_after_hook "an inconsistent pending mode cannot be approved" \
  hook_returned_block
assert_equals "a rejected inconsistent approval does not mutate state" \
  "$inconsistent_pending_snapshot" "$(approval_state_snapshot)"

run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$first_plan")"
assert_after_hook "re-presenting repairs an inconsistent pending state" \
  [ "$hook_stdout" = '{}' ]
pending_snapshot="$(approval_state_snapshot)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input futureMode "$SESSION" 'Implement the plan.')"
assert_after_hook "an unknown permission mode cannot approve" \
  hook_returned_block
assert_equals "an unknown permission mode does not mutate pending state" \
  "$pending_snapshot" "$(approval_state_snapshot)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.' "$CODEX_PROMPT_PLAN_TRANSCRIPT")"
assert_after_hook "a real Codex 0.146 Plan turn still rejects the native phrase" \
  hook_returned_block
assert_equals "a blocked Plan Mode phrase does not mutate pending state" \
  "$pending_snapshot" "$(approval_state_snapshot)"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default other-session 'Implement the plan.')"
assert_after_hook "a different session cannot approve the pending document" \
  hook_returned_block
assert_equals "a wrong-session approval prompt does not mutate pending state" \
  "$pending_snapshot" "$(approval_state_snapshot)"

for inexact_prompt in \
  'Implement the plan' \
  'Implement the plan.!' \
  ' Implement the plan.' \
  'Implement the plan. ' \
  'Implement the plan.\n'; do
  run_hook "$PLAN_PROMPT_HOOK" \
    "$(codex_prompt_input default "$SESSION" "$inexact_prompt")"
  assert_equals "punctuation, whitespace or an escaped LF does not approve" pending \
    "$(oso-state --session "$SESSION" get plan_approval)"
done

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "pending approval denies even an allowlisted local tool" \
  hook_returned_deny

chmod 0644 "$first_presented_file"
unsafe_artifact_snapshot="$(approval_state_snapshot)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
assert_after_hook "native approval rejects a non-private pending snapshot" \
  hook_returned_block
assert_equals "an unsafe artifact cannot mutate pending state" \
  "$unsafe_artifact_snapshot" "$(approval_state_snapshot)"
chmod 0600 "$first_presented_file"

run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.' "$CODEX_PROMPT_DEFAULT_TRANSCRIPT")"
assert_after_hook "the exact Default-mode native phrase approves its same-session plan" \
  hook_returned_prompt_context
assert_equals "the accepted native phrase changes only the approval status" approved \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "approval retains the digest of the presented document" \
  "$first_plan_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
assert_equals "native approval renames the immutable snapshot from presented to approved" \
  "$first_approved_file" "$(oso-state --session "$SESSION" get plan_snapshot_file)"
assert_equals "native approval removes the pending snapshot spelling" \
  absent "$([ ! -e "$first_presented_file" ] && printf absent || printf present)"
assert_equals "native approval preserves the immutable approved document" \
  "$first_plan_document" "$(cat "$first_approved_file" 2>/dev/null || true)"

approved_snapshot_before_amendment="$(cat "$first_approved_file")"
hot_slice='### Slice 3 — approval regression\n\n- Goal: cover native approval.\n- Files: tests/hooks-test.sh\n- Verify: bash tests/hooks-test.sh\n- Depends-on: Slice 2'
if printf '%b' "$hot_slice" | oso-state --session "$SESSION" amend-plan slice-3 >/dev/null 2>&1; then
  echo "ok: an approved plan accepts one explicit in-scope hot slice"; pass=$((pass + 1))
else
  echo "FAIL: an approved plan rejected a valid hot slice"; fail=$((fail + 1))
fi
assert_equals "a hot slice increments the operational plan revision" \
  1 "$(oso-state --session "$SESSION" get plan_revision)"
assert_equals "a hot slice reopens the overall verification flag" \
  false "$(oso-state --session "$SESSION" get verify_green)"
case "$(cat "$first_current_file")" in
  *'## Execution amendment — slice-3'*'Requested-by: operator'*'### Slice 3 — approval regression'*)
    echo "ok: the operational plan records the dated in-scope amendment"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the operational plan does not contain the hot slice amendment"; fail=$((fail + 1)) ;;
esac
assert_equals "a hot slice never mutates the immutable approved snapshot" \
  "$approved_snapshot_before_amendment" "$(cat "$first_approved_file")"
if printf '%s' 'invalid slice' | oso-state --session "$SESSION" amend-plan '../escape' >/dev/null 2>&1; then
  echo "FAIL: amend-plan accepted an unsafe slice id"; fail=$((fail + 1))
else
  echo "ok: amend-plan rejects an unsafe slice id"; pass=$((pass + 1))
fi
if printf '%s' '### Wrong session' | oso-state --session other-session amend-plan slice-4 >/dev/null 2>&1; then
  echo "FAIL: amend-plan accepted a different session"; fail=$((fail + 1))
else
  echo "ok: amend-plan rejects a different session"; pass=$((pass + 1))
fi
approved_state_after_amendment="$(approval_state_snapshot)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
assert_after_hook "the native phrase becomes ordinary again after approval" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a repeated native phrase cannot mutate approved state" \
  "$approved_state_after_amendment" "$(approval_state_snapshot)"

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "approved state restores the release allowlist" \
  [ -z "$hook_stdout" ]
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "approval does not open a tool absent from the release allowlist" \
  hook_returned_deny

# Any changed byte before the marker is a new document. Stop must replace the
# approved state with a fresh pending digest, which immediately closes tools.
second_plan='Repaso de cambios\nFull slice plan: beta\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
second_plan_digest="$(sha256_text "$second_plan")"
run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$second_plan")"
assert_after_hook "a materially changed plan is captured again" \
  [ "$hook_stdout" = '{}' ]
assert_equals "a materially changed plan invalidates approved state" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "a materially changed plan receives its own digest" \
  "$second_plan_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
case "$second_plan_digest" in
  "$first_plan_digest")
    echo "FAIL: the digest fixture did not change when its plan byte changed"; fail=$((fail + 1)) ;;
  *)
    echo "ok: a changed plan byte changes the approval digest"; pass=$((pass + 1)) ;;
esac
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "recapturing a changed plan closes allowlisted tools again" \
  hook_returned_deny
oso-state --session "$SESSION" clear

# Codex runs user hooks through a command runner its shell_environment_policy
# never reaches, so OSO_STATE_BIN is unset for the whole rail and every case
# above would still pass while the real host resolved nothing.  A plain system
# PATH is the faithful fixture: oso-state is installed on none of these
# directories, and unlike a symlink farm it cannot turn a missing state binary
# into a missing coreutil — or a missing interpreter — the farm forgot.
PLAN_RUNTIME="$TEST_HOME/plan-runtime"
PLAN_RUNTIME_REPO="$TEST_HOME/plan-runtime-repo"
PLAN_RUNTIME_PATH=/usr/local/bin:/usr/bin:/bin
mkdir -p "$PLAN_RUNTIME/hooks" "$PLAN_RUNTIME/bin" "$PLAN_RUNTIME_REPO"
cp "$PLUGIN/hooks/capture-plan-approval.sh" "$PLUGIN/hooks/approve-plan-token.sh" \
  "$PLUGIN/hooks/lib.sh" "$PLUGIN/hooks/lexer.sh" "$PLAN_RUNTIME/hooks/"
cp "$PLUGIN/bin/oso-state" "$PLAN_RUNTIME/bin/"
chmod +x "$PLAN_RUNTIME/hooks/capture-plan-approval.sh" \
  "$PLAN_RUNTIME/hooks/approve-plan-token.sh" "$PLAN_RUNTIME/bin/oso-state"
assert_equals "the plan-rail regression PATH cannot resolve bare oso-state" \
  "missing" "$(
    PATH="$PLAN_RUNTIME_PATH"
    hash -r
    command -v oso-state >/dev/null 2>&1 && echo present || echo missing
  )"

runtime_plan_state() {
  ( cd "$PLAN_RUNTIME_REPO" && oso-state --session "$SESSION" get "$1" )
}

runtime_plan_document="$(printf 'Repaso de cambios\nRuntime slice: oso-state resolves beside the hooks')"
runtime_plan_message='Repaso de cambios\nRuntime slice: oso-state resolves beside the hooks\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
runtime_stop_payload="$(printf '{"session_id":"%s","transcript_path":null,"cwd":"%s","permission_mode":"plan","hook_event_name":"Stop","turn_id":"turn-runtime-plan","stop_hook_active":false,"last_assistant_message":"%s"}' \
  "$SESSION" "$PLAN_RUNTIME_REPO" "$runtime_plan_message")"
runtime_approval_payload="$(printf '{"session_id":"%s","transcript_path":null,"cwd":"%s","permission_mode":"default","hook_event_name":"UserPromptSubmit","turn_id":"turn-runtime-approve","prompt":"Implement the plan."}' \
  "$SESSION" "$PLAN_RUNTIME_REPO")"
unset OSO_STATE_BIN
OSO_AGENT=1 PATH="$PLAN_RUNTIME_PATH" run_hook \
  "$PLAN_RUNTIME/hooks/capture-plan-approval.sh" "$runtime_stop_payload"
assert_after_hook "the runtime-fallback Stop rail records the plan instead of blocking it" \
  [ "$hook_stdout" = '{}' ]
assert_equals "the runtime-fallback capture leaves the approval pending" \
  pending "$(runtime_plan_state plan_approval)"
runtime_plan_digest="$(runtime_plan_state plan_approval_digest)"
case "$runtime_plan_digest" in
  ''|*[!0-9a-f]*) runtime_digest_shape=invalid ;;
  *) [ "${#runtime_plan_digest}" -eq 64 ] && runtime_digest_shape=valid || runtime_digest_shape=invalid ;;
esac
assert_equals "the runtime-fallback capture binds a 64-hex document digest" \
  valid "$runtime_digest_shape"
runtime_plan_dir="$STATE_DIR/plans/$(state_key_of "$PLAN_RUNTIME_REPO")"
assert_equals "the runtime-fallback capture snapshots the pending document" \
  "$runtime_plan_document" \
  "$(cat "$runtime_plan_dir/presented-${runtime_plan_digest}.md" 2>/dev/null || true)"
assert_equals "the runtime-fallback capture publishes the operational plan" \
  "$runtime_plan_document" "$(cat "$runtime_plan_dir/current.md" 2>/dev/null || true)"

OSO_AGENT=1 PATH="$PLAN_RUNTIME_PATH" run_hook \
  "$PLAN_RUNTIME/hooks/approve-plan-token.sh" "$runtime_approval_payload"
assert_after_hook "the runtime-fallback native phrase opens the execution gate" \
  hook_returned_prompt_context
assert_equals "the Codex plan rail records and approves through the installed runtime when OSO_STATE_BIN is unset" \
  approved "$(runtime_plan_state plan_approval)"
( cd "$PLAN_RUNTIME_REPO" && oso-state --session "$SESSION" clear >/dev/null )

# --- Runtime: plan_approval_session survives a model-issued write under the
# fixed Codex marker (ADR-0107) -------------------------------------------
# Every model-issued oso-state call on Codex carries the same OSO_AGENT=1
# marker, never the real session capture-plan recorded, so one shared key
# could not tell the two identities apart. This proves the second key does:
# a marker-scoped write overwrites ownership and leaves approval untouched.
identity_split_digest="$(sha256_text 'identity split fixture plan')"
printf 'Identity split fixture plan' |
  oso-state --session "$SESSION" capture-plan "$identity_split_digest" >/dev/null
assert_equals "capture-plan records the presenting session as the approval identity" \
  "$SESSION" "$(oso-state --session "$SESSION" get plan_approval_session)"

oso-state --session 1 set mode=plan active_slice=none verify_green=false >/dev/null
assert_equals "a marker-scoped model write overwrites ownership, not approval" \
  1 "$(oso-state --session "$SESSION" get session)"
assert_equals "the approval identity survives the marker-scoped write" \
  "$SESSION" "$(oso-state --session "$SESSION" get plan_approval_session)"

if oso-state --session "$SESSION" approve-plan "$identity_split_digest" >/dev/null 2>&1; then
  echo "ok: approve-plan still succeeds for the presenting session after the marker write"; pass=$((pass + 1))
else
  echo "FAIL: approve-plan rejected the presenting session after the marker write"; fail=$((fail + 1))
fi
assert_equals "the surviving approval identity lets the presenting session's approval land" \
  approved "$(oso-state --session "$SESSION" get plan_approval)"
oso-state --session "$SESSION" clear

# --- Runtime: native approval survives an ordinary model-issued write under
# the fixed Codex marker end to end, through approve-plan-token.sh itself
# (ADR-0107) -------------------------------------------------------------
# Between a plan going pending and the operator approving it, Codex's own flow
# issues ordinary state writes under OSO_AGENT (mode=plan, active_slice,
# verify_green — plan.md §6 step 1) that overwrite `session`, the ownership
# key. The prompt hook's own pre-check must read plan_approval_session, or it
# blocks the very session that presented the plan as soon as any such write
# has landed — which is always.
regression_marker_write_plan_ok='Repaso de cambios\nFull slice plan: marker-write regression, presenting session\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$regression_marker_write_plan_ok")"
assert_after_hook "the marker-write regression plan is captured" \
  [ "$hook_stdout" = '{}' ]
assert_equals "capture-plan records the presenting session as plan_approval_session" \
  "$SESSION" "$(oso-state --session "$SESSION" get plan_approval_session)"
oso-state --session 1 set mode=plan active_slice=1 verify_green=false >/dev/null
assert_equals "the ordinary model-issued write overwrites ownership, not approval" \
  1 "$(oso-state --session "$SESSION" get session)"
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
assert_after_hook "native approval from the presenting session opens the gate after a marker-scoped write" \
  hook_returned_prompt_context
assert_equals "the presenting session's native approval promotes state to approved" approved \
  "$(oso-state --session "$SESSION" get plan_approval)"
oso-state --session "$SESSION" clear

# The negative: a different session must still be refused, byte-identical
# message, after the same marker-scoped write — or the fix could degrade into
# accepting any session.
regression_marker_write_plan_wrong='Repaso de cambios\nFull slice plan: marker-write regression, wrong session\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->'
run_hook "$PLAN_STOP_HOOK" "$(codex_stop_input plan "$SESSION" "$regression_marker_write_plan_wrong")"
assert_after_hook "the wrong-session marker-write regression plan is captured" \
  [ "$hook_stdout" = '{}' ]
oso-state --session 1 set mode=plan active_slice=1 verify_green=false >/dev/null
run_hook "$PLAN_PROMPT_HOOK" \
  "$(codex_prompt_input default other-session 'Implement the plan.')"
assert_after_hook "a different session is still refused after the same marker-scoped write" \
  hook_returned_block
case "$hook_stdout" in
  *'"reason":"oso-code: this plan-control prompt does not belong to the session that presented the pending plan."'*)
    echo "ok: the wrong-session refusal keeps the existing byte-identical message"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the wrong-session refusal message changed — got: $hook_stdout"; fail=$((fail + 1)) ;;
esac
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

# --- B1 (D18): a deny hands over its remedy, executably, not a menu to guess --
# A6 made a deny record what it denied; this is the other half — every deny
# with a legitimate next step spells it as a runnable command or a named flow.
# Assert per gate and per cause, not once globally: a shared assertion would
# let one gate's remedy regress silently while the suite kept reading
# someone else's.
oso-state --session "$SESSION" set mode=plan active_slice=none verify_green=false
assert_denies "the slice gate denies while no slice is active" \
  block-edits-without-slice.sh "$edit_input"
case "$hook_stdout" in
  *"oso-state --session $SESSION set active_slice="*)
    echo "ok: the slice gate's remedy is the exact oso-state call that arms a slice"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the slice gate's remedy is not a runnable oso-state call — got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
esac
edit_denial_reason="$hook_stdout"

plan_commit_reason=""
quick_commit_reason=""
debug_commit_reason=""
for commit_mode in plan quick debug; do
  oso-state --session "$SESSION" set mode="$commit_mode" active_slice=none verify_green=false
  assert_denies "the commit gate denies red verify in $commit_mode mode" \
    block-commit-until-green.sh "$(bash_input 'git commit -m x')"
  case "$commit_mode" in
    plan)
      case "$hook_stdout" in
        *'apply → verify loop'*) echo "ok: plan mode's remedy names its own loop"; pass=$((pass + 1)) ;;
        *) echo "FAIL: plan mode's remedy does not name its own loop — got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
      esac
      plan_commit_reason="$hook_stdout" ;;
    quick)
      case "$hook_stdout" in
        *'quick'*'close step'*) echo "ok: quick mode's remedy names its own close step"; pass=$((pass + 1)) ;;
        *) echo "FAIL: quick mode's remedy does not name its own close step — got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
      esac
      quick_commit_reason="$hook_stdout" ;;
    debug)
      case "$hook_stdout" in
        *'debug'*'close step'*) echo "ok: debug mode's remedy names its own close step"; pass=$((pass + 1)) ;;
        *) echo "FAIL: debug mode's remedy does not name its own close step — got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
      esac
      debug_commit_reason="$hook_stdout" ;;
  esac
done
if [ "$plan_commit_reason" = "$quick_commit_reason" ]; then
  echo "FAIL: plan and quick mode share one commit remedy instead of naming their own flow"; fail=$((fail + 1))
else
  echo "ok: plan and quick mode's commit remedies name two different flows"; pass=$((pass + 1))
fi

oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "the unknown-tool gate denies a tool absent from the allowlist" \
  hook_returned_deny
case "$hook_stdout" in
  *'Bash'*)
    echo "ok: the unknown-tool gate's allowlist remedy names an allowed local tool"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: the unknown-tool gate's allowlist remedy names no allowed tool — got: ${hook_stdout:-<empty>}"; fail=$((fail + 1)) ;;
esac
allowlist_denial_reason="$hook_stdout"

oso-state --session "$SESSION" set plan_approval=pending "plan_approval_session=$SESSION"
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input Bash)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "the unknown-tool gate denies while its own plan approval is pending" \
  hook_returned_deny
pending_denial_reason="$hook_stdout"
# Not mere string inequality — two unrelated messages, one of them empty of any
# remedy, would already differ. This asserts each cause's OWN remedy content is
# present and stayed out of the other's message, so a future collapse into one
# shared sentence — or one cause silently losing its remedy — turns it red.
case "$allowlist_denial_reason" in *'Bash'*) allowlist_has_own_remedy=true ;; *) allowlist_has_own_remedy=false ;; esac
case "$pending_denial_reason" in *'CANCEL OSO PLAN'*) pending_has_own_remedy=true ;; *) pending_has_own_remedy=false ;; esac
case "$allowlist_denial_reason" in *'CANCEL OSO PLAN'*) allowlist_leaked_pending=true ;; *) allowlist_leaked_pending=false ;; esac
case "$pending_denial_reason" in *'Bash'*) pending_leaked_allowlist=true ;; *) pending_leaked_allowlist=false ;; esac
if [ "$allowlist_has_own_remedy" = true ] && [ "$pending_has_own_remedy" = true ] &&
   [ "$allowlist_leaked_pending" = false ] && [ "$pending_leaked_allowlist" = false ]; then
  echo "ok: the unknown-tool gate's two causes carry two distinct, content-bearing remedies"; pass=$((pass + 1))
else
  echo "FAIL: the unknown-tool gate's two causes do not each carry their own remedy — allowlist: ${allowlist_denial_reason:-<empty>} / pending: ${pending_denial_reason:-<empty>}"; fail=$((fail + 1))
fi

# The security assertion: a remedy that told the operator to write
# verify_green=true directly would be the bypass this slice exists to forbid,
# so this scans every remedy captured above for that literal state write —
# strict enough that adding it to any one of them turns this red.
remedy_offers_bypass=""
for remedy_text in "$edit_denial_reason" "$plan_commit_reason" "$quick_commit_reason" \
    "$debug_commit_reason" "$allowlist_denial_reason" "$pending_denial_reason"; do
  case "$remedy_text" in
    *'verify_green=true'*) remedy_offers_bypass="yes" ;;
  esac
done
if [ -n "$remedy_offers_bypass" ]; then
  echo "FAIL: a captured remedy offers the state write that disarms its own gate"; fail=$((fail + 1))
else
  echo "ok: no captured remedy offers the state write that would disarm its gate"; pass=$((pass + 1))
fi
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

# --- Integration: security-pass stays provider-neutral at its public edge ----
# The mechanism differs by host, so it belongs in the platform adapter, never in
# either wrapper's public description.  Read only the frontmatter field: Claude's
# platform file MUST still name `security-review`, and treating that legitimate
# host fact as a description violation would make a file-wide grep falsely red.
frontmatter_description() {
  awk '
    NR == 1 && $0 == "---" { inside = 1; next }
    inside && $0 == "---" { inside = 0; exit }
    inside && /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/, "")
      print
      descriptions++
    }
    END { if (descriptions != 1) exit 1 }
  ' "$1"
}

security_description_status() {
  local description
  if ! description="$(frontmatter_description "$1" 2>/dev/null)"; then
    printf invalid
  elif printf '%s\n' "$description" | grep -qF 'security-review'; then
    printf names-security-review
  else
    printf neutral
  fi
}

for security_wrapper in \
  "$PLUGIN/skills/security-pass/SKILL.md" \
  "$CODEX_SKILLS/security-pass/SKILL.md"; do
  case "$security_wrapper" in
    "$PLUGIN"/*) security_host=Claude ;;
    *) security_host=Codex ;;
  esac
  assert_equals "the $security_host security-pass description is provider-neutral" \
    neutral "$(security_description_status "$security_wrapper")"
done

# Prove the frontmatter boundary with a mutation: add the forbidden provider
# name to DESCRIPTION and require that exact field to turn red.  A detector that
# merely greps the repository would already be red on Claude's valid adapter and
# could not satisfy the clean assertions above.
SECURITY_DESCRIPTION_FIXTURE="$TEST_HOME/security-description-SKILL.md"
awk '
  /^description:[[:space:]]*/ {
    print "description: security-review provider detail leaked into the public contract"
    next
  }
  { print }
' "$CODEX_SKILLS/security-pass/SKILL.md" > "$SECURITY_DESCRIPTION_FIXTURE"
assert_equals "a provider-specific security-pass description is rejected" \
  names-security-review "$(security_description_status "$SECURITY_DESCRIPTION_FIXTURE")"

# --- Integration: Claude's seven delegated contracts have seven Codex roles --
# Codex has two source shapes to port: the three Claude agent contracts, and the
# four skills whose frontmatter asks Claude for a fresh fork.  Keep the mapping
# in one closed table, then derive BOTH source inventories from disk.  Comparing
# only the table with codex/agents would let a deleted Claude agent and its
# deleted table row agree on the same wrong answer.
S5_ROLE_MAP='writer|oso-applier|oso-applier
writer|oso-integrator|oso-integrator
writer|oso-verifier|oso-verifier
judge|debt-sweep|oso-debt-sweep
judge|doubt-pass|oso-doubt-pass
judge|security-pass|oso-security-reviewer
judge|triage|oso-triage'

mapped_writers=""
mapped_judges=""
mapped_roles=""
mapping_rows=0
while IFS='|' read -r role_kind source_name codex_role; do
  [ -n "$role_kind" ] || continue
  mapping_rows=$((mapping_rows + 1))
  mapped_roles="$mapped_roles $codex_role"
  case "$role_kind" in
    writer) mapped_writers="$mapped_writers $source_name" ;;
    judge) mapped_judges="$mapped_judges $source_name" ;;
    *) mapped_roles="$mapped_roles invalid-kind:$role_kind" ;;
  esac
done <<< "$S5_ROLE_MAP"

source_writers=""
for source_agent in "$PLUGIN"/agents/*.md; do
  [ -f "$source_agent" ] || continue
  source_writers="$source_writers $(basename "$source_agent" .md)"
done

source_judges=""
for source_skill in "$PLUGIN"/skills/*/SKILL.md; do
  [ -f "$source_skill" ] || continue
  if sed -n '2,/^---$/p' "$source_skill" |
     grep -Eq '^context:[[:space:]]*fork[[:space:]]*$'; then
    source_judges="$source_judges $(basename "$(dirname "$source_skill")")"
  fi
done

CODEX_AGENTS="$REPO_ROOT/codex/agents"
codex_roles=""
for role_file in "$CODEX_AGENTS"/*.toml; do
  [ -f "$role_file" ] || continue
  codex_roles="$codex_roles $(basename "$role_file" .toml)"
done

assert_equals "the S5 role ledger has exactly seven rows" 7 "$mapping_rows"
assert_equals "the source tree has exactly three delegated agent contracts" \
  3 "$(printf '%s\n' $source_writers | awk 'NF { n++ } END { print n + 0 }')"
assert_equals "the source tree has exactly four context-fork judges" \
  4 "$(printf '%s\n' $source_judges | awk 'NF { n++ } END { print n + 0 }')"
assert_equals "every Claude agent contract has one mapped Codex role" \
  "$(sorted_words "$source_writers")" "$(sorted_words "$mapped_writers")"
assert_equals "every context-fork skill has one mapped Codex judge" \
  "$(sorted_words "$source_judges")" "$(sorted_words "$mapped_judges")"
assert_equals "codex/agents contains exactly the seven mapped custom roles" \
  "$(sorted_words "$mapped_roles")" "$(sorted_words "$codex_roles")"

# Parse scalar TOML fields without jq: these role files deliberately use the
# baseline's simple top-level strings.  A missing or duplicate key returns a
# value other than the one expected, so neither can disappear as a false green.
toml_scalar() {
  local role_file="$1" key="$2"
  sed -n "s/^${key}[[:space:]]*=[[:space:]]*\"\([^\"]*\)\"[[:space:]]*$/\1/p" "$role_file"
}

# `developer_instructions = ""` is accepted TOML and a syntactically valid role
# that does nothing.  Count the delimiters and a real content line separately;
# this also rejects a truncated multiline value instead of mistaking its prefix
# for instructions.
developer_instructions_status() {
  awk '
    /^developer_instructions[[:space:]]*=[[:space:]]*"""[[:space:]]*$/ {
      starts++; inside = 1; next
    }
    inside && /^"""[[:space:]]*$/ { closes++; inside = 0; next }
    inside && /[^[:space:]]/ { content = 1 }
    END {
      if (starts == 1 && closes == 1 && !inside && content) print "nonempty"
      else printf "starts=%d closes=%d content=%d", starts, closes, content
    }
  ' "$1"
}

role_contract_status() {
  local role="$1" source_name="$2" role_file="$3"
  case "$role" in
    oso-applier)
      grep -qF 'implement exactly ONE assignment' "$role_file" &&
        grep -qF 'status: blocked' "$role_file" &&
        grep -qF 'status: done' "$role_file" && printf 'present'
      ;;
    oso-integrator)
      grep -qF 'Integrate exactly ONE wave' "$role_file" &&
        grep -qF 'NEVER resolve a conflict' "$role_file" &&
        grep -qF 'status: conflict' "$role_file" && printf 'present'
      ;;
    oso-verifier)
      grep -qF 'Judge only; never edit' "$role_file" &&
        grep -qF 'verdict: pass | fail | blocked' "$role_file" && printf 'present'
      ;;
    *)
      grep -qF "\`$source_name/SKILL.md\`" "$role_file" &&
        grep -Eqi 'never edit' "$role_file" && printf 'present'
      ;;
  esac
}

while IFS='|' read -r role_kind source_name codex_role; do
  [ -n "$role_kind" ] || continue
  role_file="$CODEX_AGENTS/$codex_role.toml"
  if [ ! -f "$role_file" ]; then
    # The inventory equality above names the missing file.  Avoid a cascade of
    # parser errors here while keeping every other extant role independently
    # observable.
    continue
  fi
  assert_equals "$codex_role names itself in TOML" \
    "$codex_role" "$(toml_scalar "$role_file" name)"
  assert_equals "$codex_role has a nonempty description" \
    "nonempty" "$([ -n "$(toml_scalar "$role_file" description)" ] && printf nonempty || printf empty)"
  assert_equals "$codex_role pins the Codex baseline model" \
    "gpt-5.5" "$(toml_scalar "$role_file" model)"
  assert_equals "$codex_role pins the required reasoning effort" \
    "xhigh" "$(toml_scalar "$role_file" model_reasoning_effort)"
  assert_equals "$codex_role has observable nonempty developer instructions" \
    "nonempty" "$(developer_instructions_status "$role_file")"
  if [ "$codex_role" = oso-security-reviewer ]; then
    # Unlike the other judges, this role starts a nested `codex review`.
    # A read-only role cannot start that path. The outer CLI needs authenticated
    # runtime paths and network beyond the workspace; the nested review is the
    # layer constrained back to workspace-write.
    assert_equals "oso-security-reviewer can run the native Codex review" \
      "danger-full-access" "$(toml_scalar "$role_file" sandbox_mode)"
  elif [ "$codex_role" = oso-doubt-pass ]; then
    # doubt-pass judges a frozen-candidate ledger from intent, surface map and
    # bare decisions alone; its body runs no project check, so read-only stays
    # the mechanical guarantee the contract needs (ADR-0109).
    assert_equals "oso-doubt-pass is read-only" \
      "read-only" "$(toml_scalar "$role_file" sandbox_mode)"
  elif [ "$role_kind" = judge ]; then
    # debt-sweep and triage each re-run project checks (the zero-warnings bar,
    # a failing check's re-run) their own bodies require, and those checks
    # write caches, build output and coverage dumps a read-only sandbox cannot
    # produce. They match oso-verifier's workspace-write precedent; ADR-0109
    # records the mechanical read-only guarantee this trades for a prompt
    # instruction, asserted next.
    assert_equals "$codex_role is workspace-write" \
      "workspace-write" "$(toml_scalar "$role_file" sandbox_mode)"
    assert_equals "$codex_role names an explicit never-edit-source instruction now that the sandbox no longer enforces it" \
      "present" "$(grep -qF 'edit a source file' "$role_file" && printf present || printf missing)"
  else
    writer_sandbox="$(toml_scalar "$role_file" sandbox_mode)"
    case "$writer_sandbox" in
      "") writer_sandbox_status=missing ;;
      read-only) writer_sandbox_status=read-only ;;
      *) writer_sandbox_status=writable ;;
    esac
    assert_equals "$codex_role is not trapped in a read-only sandbox" \
      "writable" "$writer_sandbox_status"
    if [ "$codex_role" = oso-integrator ]; then
      # A normal writable role still cannot update the main checkout's .git or
      # remove sibling worktrees.  This one narrow agent needs the baseline's
      # unrestricted sandbox to perform the git-only contract it is handed.
      assert_equals "oso-integrator can reach git metadata and external worktrees" \
        "danger-full-access" "$writer_sandbox"
    fi
  fi
  assert_equals "$codex_role preserves its load-bearing role contract" \
    "present" "$(role_contract_status "$codex_role" "$source_name" "$role_file")"
done <<< "$S5_ROLE_MAP"

integrator_smoke_function="$(sed -n \
  '/^run_integrator_fixture() {$/,/^}$/p' \
  "$REPO_ROOT/bootstrap/verify-codex.sh")"
integrator_handoff_function="$(sed -n \
  '/^integrator_handoff_consumed() {$/,/^}$/p' \
  "$REPO_ROOT/bootstrap/verify-codex.sh")"
assert_equals "the authenticated smoke preserves the integrator's live sandbox authority" \
  "1" "$(printf '%s\n' "$integrator_smoke_function" | \
    grep -Fc 'codex exec --ephemeral --json --sandbox danger-full-access --color never' || true)"
assert_equals "the authenticated smoke does not override the integrator back to workspace-write" \
  "0" "$(printf '%s\n' "$integrator_smoke_function" | \
    grep -Fc 'codex exec --ephemeral --json --sandbox workspace-write --color never' || true)"
assert_equals "the authenticated smoke requires a fresh explicit integrator launch" \
  "1" "$(printf '%s\n' "$integrator_smoke_function" | \
    grep -Fc 'agent_type oso-integrator explicitly and launch it with fresh context by setting fork_turns=\"none\"' || true)"
integrator_smoke_observable_contract="$(
  if printf '%s\n' "$integrator_smoke_function" | grep -F 'status: done' >/dev/null 2>&1 ||
     printf '%s\n' "$integrator_smoke_function" | grep -F 'torn_down:' >/dev/null 2>&1; then
    printf child-report-dependent
  elif printf '%s\n' "$integrator_handoff_function" | grep -F 'item.get("type") != "command_execution"' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_handoff_function" | grep -F 'tokens[1:3] != ["handoff", "consume"]' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_handoff_function" | grep -F 'receipt["agent_id"] == agent_id' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_handoff_function" | grep -F 'spawn_agent' >/dev/null 2>&1; then
    printf spawn-parser-retained
  elif printf '%s\n' "$integrator_handoff_function" | grep -F 'item.get("type") != "command_execution"' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_handoff_function" | grep -F 'tokens[1:3] != ["handoff", "consume"]' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_handoff_function" | grep -F 'receipt["agent_id"] == agent_id' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'HANDOFF SLICE: $SMOKE_HANDOFF_SLICE' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'HANDOFF ATTEMPT: $SMOKE_HANDOFF_ATTEMPT' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'oso-state handoff wait --slice $SMOKE_HANDOFF_SLICE --attempt $SMOKE_HANDOFF_ATTEMPT --agent-id <agent-id> --agent-type $SMOKE_INTEGRATOR_AGENT_TYPE --timeout 10' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'oso-state handoff consume --slice $SMOKE_HANDOFF_SLICE --attempt $SMOKE_HANDOFF_ATTEMPT --agent-id <agent-id> --agent-type $SMOKE_INTEGRATOR_AGENT_TYPE' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'integrator_handoff_consumed &&' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F '[ -f "$SMOKE_MAIN/integrated.txt" ]' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F "grep -Fqx 'integrated by oso-integrator' \"\$SMOKE_MAIN/integrated.txt\"" >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'git -C "$SMOKE_MAIN" merge-base --is-ancestor "$SMOKE_SLICE_COMMIT" HEAD' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'git -C "$SMOKE_MAIN" show-ref --verify --quiet refs/heads/oso-smoke-slice' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'git -C "$SMOKE_MAIN" worktree list --porcelain' >/dev/null 2>&1 &&
       printf '%s\n' "$integrator_smoke_function" | grep -F 'grep -F "$SMOKE_WORKTREE"' >/dev/null 2>&1; then
    printf complete
  else
    printf incomplete
  fi
)"
assert_equals "authenticated integrator smoke requires a consumed oso-integrator handoff plus repository effects" \
  complete "$integrator_smoke_observable_contract"

integrator_handoff_status() (
  SMOKE_HANDOFF_SLICE=codex-integrator-smoke
  SMOKE_HANDOFF_ATTEMPT=1
  SMOKE_INTEGRATOR_AGENT_TYPE=oso-integrator
  SMOKE_OUTPUT="$1"
  eval "$integrator_handoff_function"
  if integrator_handoff_consumed; then printf observed; else printf missing; fi
)

smoke_receipt_json() {
  printf 'version=1\\nhook_session=session-smoke\\nslice=%s\\nattempt=%s\\nagent_id=%s\\nagent_type=%s' \
    "$1" "$2" "$3" "$4"
}

smoke_consume_command() {
  printf 'oso-state handoff consume --slice %s --attempt %s --agent-id %s --agent-type %s' \
    "$1" "$2" "$3" "$4"
}

smoke_command_event() {
  local command="$1" escaped_stdout="$2" status="${3:-completed}" exit_code="${4:-0}"
  local event_type="${5:-item.completed}"
  printf '{"type":"%s","item":{"type":"command_execution","command":"%s","status":"%s","stdout":"%s","exit_code":%s}}\n' \
    "$event_type" "$command" "$status" "$escaped_stdout" "$exit_code"
}

# integrator_handoff_consumed returns 1 outright where python3 is absent, so the
# whole group goes with the parser rather than the failing case alone: without it
# the positive case reports missing, and every negative case below reports the
# verdict it wants for the one reason that proves nothing about the parser.
if ! command -v python3 >/dev/null 2>&1; then
  echo "skip: python3 is absent here, so the smoke's handoff receipt parser has nothing to run"
  skipped=$((skipped + 1))
else
  smoke_agent_id=agent-smoke-123
  smoke_valid_command="$(
    smoke_consume_command codex-integrator-smoke 1 "$smoke_agent_id" oso-integrator
  )"
  smoke_valid_receipt="$(
    smoke_receipt_json codex-integrator-smoke 1 "$smoke_agent_id" oso-integrator
  )"
  smoke_valid_jsonl="$(smoke_command_event "$smoke_valid_command" "$smoke_valid_receipt")"
  assert_equals "valid completed consume plus matching receipt passes" \
    observed "$(integrator_handoff_status "$smoke_valid_jsonl")"
  assert_equals "missing receipt fails" \
    missing "$(integrator_handoff_status "$(smoke_command_event "$smoke_valid_command" "")")"
  assert_equals "failed command fails" \
    missing "$(integrator_handoff_status "$(smoke_command_event "$smoke_valid_command" "$smoke_valid_receipt" failed 1)")"
  assert_equals "started command event fails" \
    missing "$(integrator_handoff_status "$(smoke_command_event "$smoke_valid_command" "$smoke_valid_receipt" completed 0 item.started)")"

  smoke_wrong_slice_jsonl="$(
    smoke_command_event \
      "$(smoke_consume_command wrong-integrator-smoke 1 "$smoke_agent_id" oso-integrator)" \
      "$(smoke_receipt_json wrong-integrator-smoke 1 "$smoke_agent_id" oso-integrator)"
  )"
  smoke_wrong_attempt_jsonl="$(
    smoke_command_event \
      "$(smoke_consume_command codex-integrator-smoke 2 "$smoke_agent_id" oso-integrator)" \
      "$(smoke_receipt_json codex-integrator-smoke 2 "$smoke_agent_id" oso-integrator)"
  )"
  smoke_wrong_type_jsonl="$(
    smoke_command_event \
      "$(smoke_consume_command codex-integrator-smoke 1 "$smoke_agent_id" oso-verifier)" \
      "$(smoke_receipt_json codex-integrator-smoke 1 "$smoke_agent_id" oso-verifier)"
  )"
  assert_equals "wrong slice, attempt, or agent type fails" \
    "missing missing missing" \
    "$(printf '%s %s %s' \
      "$(integrator_handoff_status "$smoke_wrong_slice_jsonl")" \
      "$(integrator_handoff_status "$smoke_wrong_attempt_jsonl")" \
      "$(integrator_handoff_status "$smoke_wrong_type_jsonl")")"

  smoke_mismatch_receipt="$(
    smoke_receipt_json codex-integrator-smoke 1 agent-smoke-other oso-integrator
  )"
  assert_equals "receipt agent id mismatching the command fails" \
    missing "$(integrator_handoff_status "$(smoke_command_event "$smoke_valid_command" "$smoke_mismatch_receipt")")"
  smoke_spawn_only_jsonl='{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"completed","receiver_thread_ids":["agent-smoke-123"],"prompt":"BRANCH oso-smoke-slice"}}'
  assert_equals "spawn-only JSONL fails" \
    missing "$(integrator_handoff_status "$smoke_spawn_only_jsonl")"
  smoke_report_only_jsonl='{"type":"item.completed","item":{"type":"agent_message","text":"oso-handoff: v=1 slice=codex-integrator-smoke attempt=1\nstatus: done"}}'
  assert_equals "report-only JSONL fails" \
    missing "$(integrator_handoff_status "$smoke_report_only_jsonl")"
fi
assert_equals "the shared Codex protocol forbids full-history forks with explicit roles" \
  "1" "$(grep -Fc 'Every launch that selects an explicit `agent_type` starts with fresh context: set `fork_turns="none"`.' \
    "$REPO_ROOT/plugin/skills/_shared/platform/codex/subagents.md" || true)"
smoke_cleanup_function="$(sed -n \
  '/^cleanup_smoke_project_config() {$/,/^}$/p' \
  "$REPO_ROOT/bootstrap/verify-codex.sh")"
assert_equals "the smoke cleanup removes only its exact project table from the latest config" \
  "complete" "$(
    printf '%s\n' "$smoke_cleanup_function" | grep -F 'target_header="[projects.\"$SMOKE_MAIN\"]"' >/dev/null &&
    printf '%s\n' "$smoke_cleanup_function" | grep -F 'action=remove-table' >/dev/null &&
    printf '%s\n' "$smoke_cleanup_function" | grep -F 'cmp -s "$source" "$CONFIG_FILE"' >/dev/null &&
    printf complete || printf incomplete
  )"

# --- Codex host contract: claims checked against the installed binary ---------
# ADR-0106: every other check here asserts the harness against its own prose;
# this one drives host_contract_status() itself, through a fake `codex` on
# PATH whose bytes carry (or omit) the two literals ADR-0105 found six sites
# instructing a spelling the host had already refused. verify-codex.sh calls
# main unconditionally at its tail (install-codex.sh's sourcing guard has no
# counterpart here), so the whole script runs as a subprocess with env
# overrides — the mechanism the "incomplete Codex fixture" case below already
# uses — rather than being sourced or having a guard added for this slice.
HOST_CONTRACT_VERIFY_SH="$REPO_ROOT/bootstrap/verify-codex.sh"
HOST_CONTRACT_SUPPORTED_VERSION="$(sed -n 's/^SUPPORTED_CODEX_VERSION=//p' \
  "$REPO_ROOT/bootstrap/install-codex.sh")"
HOST_CONTRACT_UNVERIFIED_VERSION="${HOST_CONTRACT_SUPPORTED_VERSION}-unverified-fixture"
HOST_CONTRACT_FORK_CONTEXT_LITERAL='fork_context is not supported in MultiAgentV2; use fork_turns instead'
HOST_CONTRACT_FORK_TURNS_LITERAL='fork_turns must be `none`, `all`, or a positive integer string'

# The two literals live inside `#` comments so grep -a finds (or misses) them
# in the shim's own bytes without them ever executing; --version echoes the
# given string in the exact `codex-cli <version>` shape a real install prints.
write_host_contract_codex_shim() {
  local shim_dir="$1" with_fork_context="$2" with_fork_turns="$3" version="$4"
  mkdir -p "$shim_dir"
  printf '%s\n' '#!/bin/sh' > "$shim_dir/codex"
  if [ "$with_fork_context" = yes ]; then
    printf '# %s\n' "$HOST_CONTRACT_FORK_CONTEXT_LITERAL" >> "$shim_dir/codex"
  fi
  if [ "$with_fork_turns" = yes ]; then
    printf '# %s\n' "$HOST_CONTRACT_FORK_TURNS_LITERAL" >> "$shim_dir/codex"
  fi
  printf '%s\n' \
    'case "$*" in' \
    "  --version) printf '%s\\n' 'codex-cli $version' ;;" \
    '  *) exit 1 ;;' \
    'esac' >> "$shim_dir/codex"
  chmod +x "$shim_dir/codex"
}

# Drops only the PATH entries that resolve a real `codex`, so the skip lane
# reproduces "codex is not on PATH" without hiding the coreutils the rest of
# run_local_checks still calls (git, awk, sed, mktemp, ...).
host_contract_path_without_codex() {
  local dir result="" saved_ifs="$IFS"
  IFS=':'
  for dir in $PATH; do
    if [ -n "$dir" ] && [ -x "$dir/codex" ]; then
      continue
    fi
    result="${result:+$result:}$dir"
  done
  IFS="$saved_ifs"
  printf '%s' "$result"
}

HOST_CONTRACT_CONFORMANT_SHIMS="$TEST_HOME/host-contract-conformant-shims"
HOST_CONTRACT_CONFORMANT_HOME="$TEST_HOME/host-contract-conformant-home"
mkdir -p "$HOST_CONTRACT_CONFORMANT_HOME/.codex"
write_host_contract_codex_shim "$HOST_CONTRACT_CONFORMANT_SHIMS" yes yes \
  "$HOST_CONTRACT_SUPPORTED_VERSION"
HOST_CONTRACT_CONFORMANT_OUTPUT="$(
  HOME="$HOST_CONTRACT_CONFORMANT_HOME" \
    CODEX_HOME="$HOST_CONTRACT_CONFORMANT_HOME/.codex" \
    PATH="$HOST_CONTRACT_CONFORMANT_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim carrying both literals at the supported version reads as conformant" \
  "1" "$(printf '%s\n' "$HOST_CONTRACT_CONFORMANT_OUTPUT" | \
    grep -Fxc 'ok:   Codex binary matches the fork_turns host contract (conformant)' || true)"

HOST_CONTRACT_NONCONFORMANT_SHIMS="$TEST_HOME/host-contract-nonconformant-shims"
HOST_CONTRACT_NONCONFORMANT_HOME="$TEST_HOME/host-contract-nonconformant-home"
mkdir -p "$HOST_CONTRACT_NONCONFORMANT_HOME/.codex"
write_host_contract_codex_shim "$HOST_CONTRACT_NONCONFORMANT_SHIMS" no yes \
  "$HOST_CONTRACT_SUPPORTED_VERSION"
HOST_CONTRACT_NONCONFORMANT_OUTPUT="$(
  HOME="$HOST_CONTRACT_NONCONFORMANT_HOME" \
    CODEX_HOME="$HOST_CONTRACT_NONCONFORMANT_HOME/.codex" \
    PATH="$HOST_CONTRACT_NONCONFORMANT_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim missing one literal at the supported version fails through check() rather than passing" \
  "1" "$(printf '%s\n' "$HOST_CONTRACT_NONCONFORMANT_OUTPUT" | \
    grep -Fxc 'FAIL: Codex binary matches the fork_turns host contract — expected conformant, got nonconformant' || true)"

HOST_CONTRACT_UNVERIFIED_SHIMS="$TEST_HOME/host-contract-unverified-shims"
HOST_CONTRACT_UNVERIFIED_HOME="$TEST_HOME/host-contract-unverified-home"
mkdir -p "$HOST_CONTRACT_UNVERIFIED_HOME/.codex"
write_host_contract_codex_shim "$HOST_CONTRACT_UNVERIFIED_SHIMS" yes yes \
  "$HOST_CONTRACT_UNVERIFIED_VERSION"
HOST_CONTRACT_UNVERIFIED_OUTPUT="$(
  HOME="$HOST_CONTRACT_UNVERIFIED_HOME" \
    CODEX_HOME="$HOST_CONTRACT_UNVERIFIED_HOME/.codex" \
    PATH="$HOST_CONTRACT_UNVERIFIED_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim outside the supported version names both versions instead of asserting pass or fail" \
  "1" "$(printf '%s\n' "$HOST_CONTRACT_UNVERIFIED_OUTPUT" | \
    grep -Fxc "unverified: Codex host contract — claims were verified against Codex $HOST_CONTRACT_SUPPORTED_VERSION only; installed $HOST_CONTRACT_UNVERIFIED_VERSION falls outside that window, so pass/fail is not asserted here" || true)"

HOST_CONTRACT_SKIP_HOME="$TEST_HOME/host-contract-skip-home"
mkdir -p "$HOST_CONTRACT_SKIP_HOME/.codex"
HOST_CONTRACT_SKIP_OUTPUT="$(
  HOME="$HOST_CONTRACT_SKIP_HOME" \
    CODEX_HOME="$HOST_CONTRACT_SKIP_HOME/.codex" \
    PATH="$(host_contract_path_without_codex)" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "no codex on PATH skips the host contract check rather than tallying a pass" \
  "complete" "$(
    if printf '%s\n' "$HOST_CONTRACT_SKIP_OUTPUT" | \
        grep -Fxq 'skip: Codex host contract — codex is not on PATH, so the host contract could not be asserted' &&
       ! printf '%s\n' "$HOST_CONTRACT_SKIP_OUTPUT" | \
        grep -Fq 'Codex binary matches the fork_turns host contract'; then
      printf complete
    else
      printf incomplete
    fi
  )"

# --- ADR-0120 capability columns: present, and inert to the render ---------
# (a): the two capability cells exist on every tool row, and the manifests
# operators and hosts actually read stay byte-identical to their addition --
# no git history needed, since a renderer that reads past a row's host cells
# would be the thing to catch here, and the committed manifests already ARE
# the render this proves against.
CAPABILITY_COLUMN_STATUS="$(awk '
  $1 == "tool" {
    n = split($0, f)
    class = f[n - 1]; mandated = f[n]
    if (class != "read" && class != "write" && class != "role") { bad = "bad-class:" $0 }
    else if (mandated != "yes" && mandated != "no") { bad = "bad-mandated:" $0 }
  }
  END { print (bad ? bad : "ok") }
' "$REPO_ROOT/tools/hook-gates.txt")"
assert_equals "every tool row in tools/hook-gates.txt carries a read/write/role class and a yes/no mandated cell" \
  "ok" "$CAPABILITY_COLUMN_STATUS"
assert_equals "the capability columns leave the committed Claude manifest byte-identical" \
  identical "$("$HOOK_RENDERER" --host claude --table "$REPO_ROOT/tools/hook-gates.txt" | \
    cmp -s - "$REPO_ROOT/plugin/hooks/hooks.json" && echo identical || echo divergent)"
assert_equals "the capability columns leave the committed Codex manifest byte-identical" \
  identical "$("$HOOK_RENDERER" --host codex --table "$REPO_ROOT/tools/hook-gates.txt" | \
    cmp -s - "$REPO_ROOT/codex/hooks/hooks.json" && echo identical || echo divergent)"

# --- Codex MCP tool table drift (ADR-0120) -------------------------------
# 5905a27 found mem_judge missing by reading the live Engram server by hand.
# This is the check that catches the next one on its own. Driven here against
# fixture servers rather than the live one, so the case is reproducible and
# fast rather than depending on whatever happens to be installed on the
# machine running the suite.
MCP_DRIFT_FIXTURE_SERVER="$TEST_HOME/mcp-drift-fixture-server.sh"
cat > "$MCP_DRIFT_FIXTURE_SERVER" <<'EOF'
#!/bin/sh
# A minimal stdio MCP server: answers tools/list with exactly the tool names
# given as arguments, then stays alive like a real server would -- the
# caller's own bound is what ends this, never its own exit.
names=""
for n in "$@"; do
  names="${names:+$names,}{\"name\":\"$n\"}"
done
printf '{"jsonrpc":"2.0","id":2,"result":{"tools":[%s]}}\n' "$names"
sleep 30
EOF
chmod +x "$MCP_DRIFT_FIXTURE_SERVER"

MCP_DRIFT_HANGING_SERVER="$TEST_HOME/mcp-drift-hanging-server.sh"
printf '%s\n' '#!/bin/sh' 'sleep 60' > "$MCP_DRIFT_HANGING_SERVER"
chmod +x "$MCP_DRIFT_HANGING_SERVER"

mcp_drift_config_home() {
  local codex_home="$1" body="$2"
  mkdir -p "$codex_home"
  printf '%s\n' "$body" > "$codex_home/config.toml"
}

# $1 = repo root to run bootstrap/verify-codex.sh from, $2 = CODEX_HOME,
# $3 = bound in seconds. Runs the whole script the same way the host-contract
# cases above do: as a subprocess, main() is unconditional at its tail.
run_mcp_drift_check() {
  local repo_root="$1" codex_home="$2" bound="$3"
  HOME="$(dirname "$codex_home")" CODEX_HOME="$codex_home" \
    OSO_VERIFY_SKIP_SMOKE=1 OSO_MCP_DRIFT_BOUND_SECONDS="$bound" \
    bash "$repo_root/bootstrap/verify-codex.sh" 2>&1 || true
}

# (b) + (c): a scratch table copy with mem_judge removed and a stale
# mcp__engram__mem_ghost row added, checked against a fixture Engram server
# that exposes the eight mandated tools minus mem_judge -- never mem_ghost.
MCP_DRIFT_TABLE_FIXTURE="$TEST_HOME/mcp-drift-table-fixture"
copy_lint_fixture "$MCP_DRIFT_TABLE_FIXTURE"
sed -e '/^tool  unknown  none  mcp__engram__mem_judge/d' \
  -e '$a\
tool  unknown  none  mcp__engram__mem_ghost  read  no' \
  "$REPO_ROOT/tools/hook-gates.txt" > "$MCP_DRIFT_TABLE_FIXTURE/tools/hook-gates.txt.tmp"
mv "$MCP_DRIFT_TABLE_FIXTURE/tools/hook-gates.txt.tmp" "$MCP_DRIFT_TABLE_FIXTURE/tools/hook-gates.txt"
if grep -q 'mcp__engram__mem_judge' "$MCP_DRIFT_TABLE_FIXTURE/tools/hook-gates.txt" ||
   ! grep -q 'mcp__engram__mem_ghost' "$MCP_DRIFT_TABLE_FIXTURE/tools/hook-gates.txt"; then
  echo "FAIL: the drift-fixture table mutation did not remove mem_judge and add mem_ghost"; fail=$((fail + 1))
else
  MCP_DRIFT_TABLE_HOME="$TEST_HOME/mcp-drift-table-home/.codex"
  mcp_drift_config_home "$MCP_DRIFT_TABLE_HOME" "
[mcp_servers.engram]
command = \"$MCP_DRIFT_FIXTURE_SERVER\"
args = [\"mem_save\", \"mem_search\", \"mem_context\", \"mem_session_summary\", \"mem_get_observation\", \"mem_save_prompt\", \"mem_current_project\", \"mem_update\", \"mem_judge\"]
"
  MCP_DRIFT_TABLE_OUTPUT="$(run_mcp_drift_check "$MCP_DRIFT_TABLE_FIXTURE" "$MCP_DRIFT_TABLE_HOME" 5)"
  assert_equals "a live protocol-mandated tool missing from the table names the exact row to add" \
    "1" "$(printf '%s\n' "$MCP_DRIFT_TABLE_OUTPUT" | \
      grep -Fxc 'FAIL: engram MCP protocol-mandated tools present in tools/hook-gates.txt — expected none, got mcp__engram__mem_judge' || true)"
  assert_equals "a table row the live server no longer exposes is named stale" \
    "1" "$(printf '%s\n' "$MCP_DRIFT_TABLE_OUTPUT" | \
      grep -Fxc 'FAIL: engram MCP table rows all match a live tool — expected none, got mcp__engram__mem_ghost' || true)"
fi

# (d): an absent server -- no executable at the configured command -- takes
# the named skip lane rather than ever being tallied as a pass.
MCP_DRIFT_ABSENT_HOME="$TEST_HOME/mcp-drift-absent-home/.codex"
mcp_drift_config_home "$MCP_DRIFT_ABSENT_HOME" '
[mcp_servers.engram]
command = "/nonexistent/oso-mcp-drift-fixture"
'
MCP_DRIFT_ABSENT_OUTPUT="$(run_mcp_drift_check "$REPO_ROOT" "$MCP_DRIFT_ABSENT_HOME" 3)"
assert_equals "a server with no executable at its configured command skips rather than tallying a pass" \
  "complete" "$(
    if printf '%s\n' "$MCP_DRIFT_ABSENT_OUTPUT" | \
        grep -Fxq 'skip: engram MCP tool drift — /nonexistent/oso-mcp-drift-fixture is not executable, so the live tool list could not be read' &&
       ! printf '%s\n' "$MCP_DRIFT_ABSENT_OUTPUT" | grep -Fq 'engram MCP protocol-mandated tools' &&
       ! printf '%s\n' "$MCP_DRIFT_ABSENT_OUTPUT" | grep -Fq 'engram MCP table rows'; then
      printf complete
    else
      printf incomplete
    fi
  )"

# A remote/URL-based server (context7's real shape) has no command this check
# spawns and takes its own named skip lane instead of a guess at that transport.
MCP_DRIFT_URL_HOME="$TEST_HOME/mcp-drift-url-home/.codex"
mcp_drift_config_home "$MCP_DRIFT_URL_HOME" '
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
'
MCP_DRIFT_URL_OUTPUT="$(run_mcp_drift_check "$REPO_ROOT" "$MCP_DRIFT_URL_HOME" 3)"
assert_equals "a remote url-based server skips with its own named reason" 1 \
  "$(printf '%s\n' "$MCP_DRIFT_URL_OUTPUT" | \
    grep -Fc 'skip: context7 MCP tool drift — no local command in' || true)"

# (e): a server that never answers ends the check with a verdict inside the
# configured bound rather than hanging bootstrap/verify-codex.sh.
MCP_DRIFT_HANG_HOME="$TEST_HOME/mcp-drift-hang-home/.codex"
mcp_drift_config_home "$MCP_DRIFT_HANG_HOME" "
[mcp_servers.engram]
command = \"$MCP_DRIFT_HANGING_SERVER\"
"
MCP_DRIFT_HANG_START="$(date +%s)"
MCP_DRIFT_HANG_OUTPUT="$(run_mcp_drift_check "$REPO_ROOT" "$MCP_DRIFT_HANG_HOME" 2)"
MCP_DRIFT_HANG_ELAPSED=$(($(date +%s) - MCP_DRIFT_HANG_START))
assert_equals "a server that never answers tools/list skips within its bound rather than hanging" \
  "1" "$(printf '%s\n' "$MCP_DRIFT_HANG_OUTPUT" | \
    grep -Fxc 'skip: engram MCP tool drift — tools/list did not answer within 2s, so drift could not be checked' || true)"
assert_equals "the bounded MCP drift check ends well inside a generous multiple of its own bound" \
  "bounded" "$([ "$MCP_DRIFT_HANG_ELAPSED" -le 30 ] && printf bounded || printf "unbounded:${MCP_DRIFT_HANG_ELAPSED}s")"
if pgrep -f "$MCP_DRIFT_HANGING_SERVER" >/dev/null 2>&1; then
  echo "FAIL: the hanging MCP fixture server outlived the bounded check"; fail=$((fail + 1))
else
  echo "ok: the hanging MCP fixture server does not outlive the bounded check"; pass=$((pass + 1))
fi

# The static half (step 0): agreement between the hardcoded mandated list and
# the table's own mandated column, needing no server and no config.toml at
# all -- this is the half CI can run. Both mismatch directions, driven with
# no CODEX_HOME/config.toml present whatsoever.
MCP_DRIFT_AGREEMENT_FIXTURE="$TEST_HOME/mcp-drift-agreement-fixture"
copy_lint_fixture "$MCP_DRIFT_AGREEMENT_FIXTURE"
sed -e '/^tool  unknown  none  mcp__engram__mem_search /d' \
  -e '$a\
tool  unknown  none  mcp__engram__mem_stats  read  yes' \
  "$REPO_ROOT/tools/hook-gates.txt" > "$MCP_DRIFT_AGREEMENT_FIXTURE/tools/hook-gates.txt.tmp"
mv "$MCP_DRIFT_AGREEMENT_FIXTURE/tools/hook-gates.txt.tmp" "$MCP_DRIFT_AGREEMENT_FIXTURE/tools/hook-gates.txt"
if grep -q 'mcp__engram__mem_search  ' "$MCP_DRIFT_AGREEMENT_FIXTURE/tools/hook-gates.txt" ||
   ! grep -q 'mcp__engram__mem_stats' "$MCP_DRIFT_AGREEMENT_FIXTURE/tools/hook-gates.txt"; then
  echo "FAIL: the agreement-fixture table mutation did not remove mem_search and add mem_stats"; fail=$((fail + 1))
else
  MCP_DRIFT_NO_CONFIG_HOME="$TEST_HOME/mcp-drift-no-config-home"
  MCP_DRIFT_AGREEMENT_OUTPUT="$(
    HOME="$MCP_DRIFT_NO_CONFIG_HOME" CODEX_HOME="$MCP_DRIFT_NO_CONFIG_HOME/.codex" \
      OSO_VERIFY_SKIP_SMOKE=1 bash "$MCP_DRIFT_AGREEMENT_FIXTURE/bootstrap/verify-codex.sh" 2>&1 || true
  )"
  assert_equals "a hardcoded mandated tool with no yes row in the table fails with no config.toml or server present" \
    "1" "$(printf '%s\n' "$MCP_DRIFT_AGREEMENT_OUTPUT" | \
      grep -Fc 'mcp__engram__mem_search(hardcoded-not-a-yes-row)' || true)"
  assert_equals "a yes row with no hardcoded counterpart fails with no config.toml or server present" \
    "1" "$(printf '%s\n' "$MCP_DRIFT_AGREEMENT_OUTPUT" | \
      grep -Fc 'mcp__engram__mem_stats(yes-row-not-hardcoded)' || true)"
fi

TOML_REMOVE_TABLE_INPUT="$TEST_HOME/toml-remove-table-input.toml"
TOML_REMOVE_TABLE_ACTUAL="$TEST_HOME/toml-remove-table-actual.toml"
TOML_REMOVE_TABLE_EXPECTED="$TEST_HOME/toml-remove-table-expected.toml"
cat > "$TOML_REMOVE_TABLE_INPUT" <<'EOF'
note = """
[projects."/tmp/oso-codex-smoke.fixture/main"]
This header-looking prose is operator data.
"""

[projects."/workspace/keep-before"]
trust_level = "trusted"

[projects."/tmp/oso-codex-smoke.fixture/main"]
trust_level = "trusted"
details = """
[projects."/workspace/not-a-table"]
"""

[projects."/workspace/keep-after"]
trust_level = "trusted"
EOF
cat > "$TOML_REMOVE_TABLE_EXPECTED" <<'EOF'
note = """
[projects."/tmp/oso-codex-smoke.fixture/main"]
This header-looking prose is operator data.
"""

[projects."/workspace/keep-before"]
trust_level = "trusted"

[projects."/workspace/keep-after"]
trust_level = "trusted"
EOF
awk -v action=remove-table \
  -v target_header='[projects."/tmp/oso-codex-smoke.fixture/main"]' \
  -f "$REPO_ROOT/bootstrap/lib/toml-regions.awk" \
  "$TOML_REMOVE_TABLE_INPUT" > "$TOML_REMOVE_TABLE_ACTUAL"
assert_equals "exact smoke-table cleanup preserves multiline decoys and unrelated projects" \
  "identical" "$(cmp -s "$TOML_REMOVE_TABLE_EXPECTED" "$TOML_REMOVE_TABLE_ACTUAL" && echo identical || echo divergent)"
printf '%s\n' \
  '[projects."/tmp/oso-codex-smoke.fixture/main"]' 'one = true' \
  '[projects."/workspace/keep"]' 'keep = true' \
  '[projects."/tmp/oso-codex-smoke.fixture/main"]' 'two = true' \
  > "$TEST_HOME/toml-remove-table-duplicate.toml"
if awk -v action=remove-table \
    -v target_header='[projects."/tmp/oso-codex-smoke.fixture/main"]' \
    -f "$REPO_ROOT/bootstrap/lib/toml-regions.awk" \
    "$TEST_HOME/toml-remove-table-duplicate.toml" >/dev/null 2>&1; then
  duplicate_smoke_table_status=accepted
else
  duplicate_smoke_table_status=refused
fi
assert_equals "smoke cleanup refuses duplicate exact project ownership" \
  "refused" "$duplicate_smoke_table_status"

# The exact scalar is the sandbox contract, so mutate only that TOML field and
# prove the checker sees the prohibited value rather than another occurrence of
# "read-only" in prose.
SECURITY_ROLE_FIXTURE="$TEST_HOME/oso-security-reviewer-read-only.toml"
awk '
  /^sandbox_mode[[:space:]]*=/ {
    print "sandbox_mode = \"read-only\""
    next
  }
  { print }
' "$CODEX_AGENTS/oso-security-reviewer.toml" > "$SECURITY_ROLE_FIXTURE"
assert_equals "a read-only native security reviewer is observable at its TOML boundary" \
  "read-only" "$(toml_scalar "$SECURITY_ROLE_FIXTURE" sandbox_mode)"

# S9 turns Codex's separate CLI review into this judge's native path.  The
# adapter is the routing contract and the role's multiline instructions are the
# execution contract, so read those two bounded regions independently.  A
# `codex review` mention in a wrapper, a TOML description or a neighbouring
# markdown section is deliberately invisible here.
markdown_h2_section() {
  local file="$1" heading="$2"
  awk -v heading="$heading" '
    $0 == heading { found++; inside = 1; next }
    inside && /^## / { inside = 0; exit }
    inside { print }
    END { if (found != 1) exit 1 }
  ' "$file"
}

developer_instructions_text() {
  awk '
    /^developer_instructions[[:space:]]*=[[:space:]]*"""[[:space:]]*$/ {
      starts++; inside = 1; next
    }
    inside && /^"""[[:space:]]*$/ { closes++; inside = 0; next }
    inside { print }
    END { if (starts != 1 || closes != 1 || inside) exit 1 }
  ' "$1"
}

codex_security_route_status() {
  local platform_file="$1" role_file="$2" platform_section role_instructions phrase
  if ! platform_section="$(markdown_h2_section "$platform_file" \
      '## Which reviewer is native, and how to reach it' 2>/dev/null)"; then
    printf invalid-platform-section
    return
  fi
  if ! role_instructions="$(developer_instructions_text "$role_file" 2>/dev/null)"; then
    printf invalid-role-instructions
    return
  fi
  for phrase in 'codex review' 'oso-security-reviewer' 'inside' 'orchestrator' \
    'Fallback criteria' 'ARGUMENTS' 'security-only' 'native target selector' \
    'developer_instructions' 'exactly one locally resolvable base ref' \
    'invalid, unresolved, or multi-argument value is blocked' 'one quoted argument' \
    'Never discover a remote or default branch' 'remote inference' \
    'actual validated ref substituted verbatim' 'missing' 'cannot authenticate' \
    'cannot reach its service' 'exits unsuccessfully' 'report the failure as blocked' \
    'do not silently downgrade to the fallback'; do
    case "$platform_section" in
      *"$phrase"*) ;;
      *) printf 'platform-misses:%s' "$phrase"; return ;;
    esac
  done
  for phrase in 'codex review' 'inside this subagent' 'orchestrator' \
    'native target selector' 'developer-instruction override' 'sandbox' 'network' \
    'covered-scope header'; do
    case "$role_instructions" in
      *"$phrase"*) ;;
      *) printf 'role-misses:%s' "$phrase"; return ;;
    esac
  done
  printf complete
}

CODEX_SECURITY_PLATFORM="$PLUGIN/skills/_shared/platform/codex/security-pass.md"
CLAUDE_SECURITY_PLATFORM="$PLUGIN/skills/_shared/platform/claude/security-pass.md"
SECURITY_BODY="$PLUGIN/skills/_shared/bodies/security-pass.md"
SECURITY_ROLE="$CODEX_AGENTS/oso-security-reviewer.toml"

assert_equals "the Codex security route runs native review inside its own subagent" \
  complete "$(codex_security_route_status "$CODEX_SECURITY_PLATFORM" "$SECURITY_ROLE")"

# Remove the executable route only from its owning H2 block, then leave the same
# words in a neighbouring decoy section.  The expected named gap proves the
# assertion did not pass on the role's independent mention or a file-wide grep.
SECURITY_ROUTE_FIXTURE="$TEST_HOME/security-pass-codex-route.md"
awk '
  $0 == "## Which reviewer is native, and how to reach it" { inside = 1 }
  inside && $0 != "## Which reviewer is native, and how to reach it" && /^## / { inside = 0 }
  inside { gsub(/codex review/, "codex inspect") }
  { print }
  END {
    print ""
    print "## Non-routing decoy"
    print "The words codex review live outside the native route."
  }
' "$CODEX_SECURITY_PLATFORM" > "$SECURITY_ROUTE_FIXTURE"
assert_equals "a codex-review mention outside the native route cannot satisfy it" \
  "platform-misses:codex review" \
  "$(codex_security_route_status "$SECURITY_ROUTE_FIXTURE" "$SECURITY_ROLE")"

# `codex review` accepts either a selector or a custom PROMPT, never both. This
# route uses the selector for acquisition and a config-level developer instruction
# for the security policy. Inspect only backticked command spans in the native H2;
# prose that names a forbidden flag is not itself an invocation.
codex_review_command_status() {
  local section commands command phrase
  section="$(markdown_h2_section "$1" \
    '## Which reviewer is native, and how to reach it' 2>/dev/null)" \
    || { printf invalid-section; return; }
  commands="$(printf '%s\n' "$section" | awk '
    {
      rest = $0
      while (match(rest, /`[^`]+`/)) {
        span = substr(rest, RSTART + 1, RLENGTH - 2)
        if (span ~ /^codex review /) print span
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
  ')"
  [ "$(printf '%s\n' "$commands" | awk 'NF { n++ } END { print n + 0 }')" = 1 ] \
    || { printf wrong-command-count; return; }
  command="$commands"
  if printf '%s\n' "$command" | grep -Eq -- '--(uncommitted|base|commit)([[:space:]]|$)' &&
     printf '%s\n' "$command" | grep -qE -- ' -$'; then
    printf selector-plus-prompt
    return
  fi
  for phrase in 'sandbox_mode="workspace-write"' \
    'sandbox_workspace_write.network_access=true' 'approval_policy="never"' \
    'review_model="gpt-5.5"' 'model_reasoning_effort="xhigh"' \
    'developer_instructions=<security instructions>'; do
    case "$command" in *"$phrase"*) ;; *) printf 'command-misses:%s' "$phrase"; return ;; esac
  done
  for phrase in 'append `--uncommitted`' 'append `--base <base-ref>`' \
    'custom PROMPT conflict' 'never add a positional PROMPT' 'stdin spelling `-`'; do
    case "$section" in *"$phrase"*) ;; *) printf 'selector-contract:%s' "$phrase"; return ;; esac
  done
  case "$section" in
    *'git ls-files --others --exclude-standard'*'read every returned file'*) ;;
    *) printf base-untracked-contract; return ;;
  esac
  if printf '%s\n' "$command" | grep -Eq -- ' -$|<security prompt>'; then
    printf positional-prompt
  else
    printf selector-only
  fi
}

assert_equals "the native security command uses selectors without a conflicting prompt" \
  selector-only "$(codex_review_command_status "$CODEX_SECURITY_PLATFORM")"

SECURITY_SELECTOR_FIXTURE="$TEST_HOME/security-pass-selector-plus-prompt.md"
awk '
  $0 == "## Which reviewer is native, and how to reach it" { inside = 1 }
  inside && $0 != "## Which reviewer is native, and how to reach it" && /^## / { inside = 0 }
  inside && /`codex review / {
    sub(/`\.$/, " --uncommitted -`.")
  }
  { print }
  END {
    print ""
    print "## Command decoy"
    print "`codex review -c developer_instructions=security-only --uncommitted`"
  }
' "$CODEX_SECURITY_PLATFORM" > "$SECURITY_SELECTOR_FIXTURE"
assert_equals "a selector cannot coexist with a positional prompt" \
  selector-plus-prompt "$(codex_review_command_status "$SECURITY_SELECTOR_FIXTURE")"

# The shared report owns the fallback/default shape; each host adapter owns only
# its native spelling.  Code-span matching makes the exact header the unit: a
# longer or prose-only lookalike cannot stand in for the report line consumers
# parse, and Claude's pre-existing native/fallback vocabulary remains explicit.
security_header_status() {
  local body_file="$1" claude_file="$2" codex_file="$3"
  local report_section claude_section codex_section
  report_section="$(markdown_h2_section "$body_file" '## Report' 2>/dev/null)" \
    || { printf invalid-report-section; return; }
  claude_section="$(markdown_h2_section "$claude_file" \
    '## Which reviewer is native, and how to reach it' 2>/dev/null)" \
    || { printf invalid-claude-section; return; }
  codex_section="$(markdown_h2_section "$codex_file" \
    '## Which reviewer is native, and how to reach it' 2>/dev/null)" \
    || { printf invalid-codex-section; return; }
  case "$report_section" in
    *'`Security Pass: fallback`'*'platform file declares'*) ;;
    *) printf shared-report; return ;;
  esac
  case "$claude_section" in
    *'`security-review`'*'Skill tool'*'`Security Pass: native`'*) ;;
    *) printf claude-native; return ;;
  esac
  case "$codex_section" in
    *'`Security Pass: native — covered: staged, unstaged, and untracked changes`'*) ;;
    *) printf codex-uncommitted; return ;;
  esac
  case "$codex_section" in
    *'`Security Pass: native — covered: merge base of HEAD and <base-ref> through HEAD, plus staged, unstaged, and untracked changes`'*) ;;
    *) printf codex-base; return ;;
  esac
  printf complete
}

assert_equals "security-pass headers name the exact native coverage on each host" \
  complete "$(security_header_status "$SECURITY_BODY" \
    "$CLAUDE_SECURITY_PLATFORM" "$CODEX_SECURITY_PLATFORM")"

SECURITY_HEADER_FIXTURE="$TEST_HOME/security-pass-codex-header.md"
awk '
  $0 == "## Which reviewer is native, and how to reach it" { inside = 1 }
  inside && $0 != "## Which reviewer is native, and how to reach it" && /^## / { inside = 0 }
  inside {
    gsub(/Security Pass: native — covered: merge base of HEAD and <base-ref> through HEAD, plus staged, unstaged, and untracked changes/,
      "Security Pass: native — covered merge base and working tree")
  }
  { print }
  END {
    print ""
    print "## Header decoy"
    print "`Security Pass: native — covered: merge base of HEAD and <base-ref> through HEAD, plus staged, unstaged, and untracked changes`"
  }
' "$CODEX_SECURITY_PLATFORM" > "$SECURITY_HEADER_FIXTURE"
assert_equals "a base-coverage header outside the native route cannot satisfy it" \
  codex-base "$(security_header_status "$SECURITY_BODY" \
    "$CLAUDE_SECURITY_PLATFORM" "$SECURITY_HEADER_FIXTURE")"

# D17 makes parity part of the contract, not release-note decoration. Select
# each row by its first cell and require exactly one: a stale original beside a
# corrected duplicate must fail rather than letting the new row hide the old.
parity_row() {
  local label="$1"
  awk -v prefix="| $label |" '
    index($0, prefix) == 1 { print; rows++ }
    END { if (rows != 1) exit 1 }
  ' "$REPO_ROOT/docs/parity-codex.md"
}

security_parity_status() {
  local forked_row native_row phrase
  forked_row="$(parity_row 'A forked judge' 2>/dev/null)" \
    || { printf forked-row-count; return; }
  native_row="$(parity_row 'The native security reviewer' 2>/dev/null)" \
    || { printf native-row-count; return; }
  for phrase in 'Four dedicated custom roles' '`gpt-5.5`' '`xhigh`' \
    '`oso-doubt-pass`' '`oso-debt-sweep`' '`oso-triage`' 'read-only' \
    '`oso-security-reviewer`' '`danger-full-access`' '`workspace-write`' 'Settled'; do
    case "$forked_row" in *"$phrase"*) ;; *) printf 'forked-row:%s' "$phrase"; return ;; esac
  done
  for phrase in '`oso-security-reviewer`' '`codex review`' 'native target selector' \
    'security-only developer instructions' '`danger-full-access`' '`workspace-write`' \
    'network' 'interactive approval' 'pins the review model' \
    'staged/unstaged/untracked' 'validated base range' 'Settled'; do
    case "$native_row" in *"$phrase"*) ;; *) printf 'native-row:%s' "$phrase"; return ;; esac
  done
  printf complete
}

assert_equals "parity records all four judges and the native-security exception once" \
  complete "$(security_parity_status)"

# The transport marker is outside every role's semantic report.  Pin the same
# first-line envelope in all seven TOMLs while preserving each role's existing
# terminal status/verdict line as the authoritative last line.
handoff_envelope_missing=""
for codex_role in $mapped_roles; do
  role_file="$CODEX_AGENTS/$codex_role.toml"
  if [ ! -f "$role_file" ] ||
     ! grep -qF '`oso-handoff: v=1 slice=<ID> attempt=<N>`' "$role_file" ||
     ! grep -Eqi 'first line' "$role_file" ||
     ! grep -Eqi 'terminal (line|verdict) stays last' "$role_file"; then
    handoff_envelope_missing="$handoff_envelope_missing $codex_role"
  fi
done
assert_equals "all seven roles preserve their report inside the explicit handoff envelope" \
  "" "$handoff_envelope_missing"

# S5 also closes the three orchestration placeholders.  Other placeholders in
# these files intentionally belong to later slices, so reject only claims that
# delegated agents or forked judges themselves are still unavailable.  All three
# call sites route through one shared Codex protocol: repeating the seven-name
# map in each mode would create three new places for the same contract to drift.
unported_role_claims=""
subagent_routes_missing=""
for platform_mode in plan debug quick; do
  platform_file="$PLUGIN/skills/_shared/platform/codex/$platform_mode.md"
  if [ ! -f "$platform_file" ]; then
    unported_role_claims="$unported_role_claims $platform_mode(missing)"
  elif grep -Eqi \
    '(forked judges|agents)[^.]{0,240}(no skill-level route|unported)|(no skill-level route|unported)[^.]{0,240}(forked judges|agents)' \
    "$platform_file"; then
    unported_role_claims="$unported_role_claims $platform_mode(still-unported)"
  fi
  grep -qF 'subagents.md' "$platform_file" 2>/dev/null \
    || subagent_routes_missing="$subagent_routes_missing $platform_mode"
done
assert_equals "plan, debug and quick no longer claim delegated roles are unported" \
  "" "$unported_role_claims"
assert_equals "plan, debug and quick route through one shared subagent protocol" \
  "" "$subagent_routes_missing"

# Through that shared route, plan can launch all seven custom roles and uses
# Codex's native explorer for discovery.  Explorer is deliberately NOT an eighth
# custom role file; spelling that distinction here prevents either half of the
# routing decision drifting.
codex_subagent_protocol="$PLUGIN/skills/_shared/platform/codex/subagents.md"
protocol_roles_missing=""
for codex_role in $mapped_roles; do
  grep -qF "$codex_role" "$codex_subagent_protocol" 2>/dev/null \
    || protocol_roles_missing="$protocol_roles_missing $codex_role"
done
assert_equals "the shared Codex protocol maps all seven custom roles" \
  "" "$protocol_roles_missing"
native_explorer_status="$([ -f "$codex_subagent_protocol" ] &&
  grep -Eqi '(native|built-in)[^.]{0,80}explorer|explorer[^.]{0,80}(native|built-in)' "$codex_subagent_protocol" &&
  printf present || printf missing)"
assert_equals "the shared Codex protocol routes discovery to the native explorer" \
  "present" "$native_explorer_status"
assert_equals "the native explorer is not duplicated as an eighth custom TOML" \
  "absent" "$([ ! -e "$CODEX_AGENTS/explorer.toml" ] && printf absent || printf present)"

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

# The host schema, not Claude's cadence, fixes Codex's question cap. Read the
# dedicated platform section and the single parity row independently: a stale
# PLACEHOLDER/4 in either surface would otherwise survive beside a correct claim
# in the other and fail only when a real decision round reaches question four.
codex_question_section="$(sed -n \
  '/^## Question rounds$/,/^## /p' "$PLUGIN/skills/_shared/platform/codex/plan.md" 2>/dev/null)"
codex_question_parity_row="$(parity_row 'Question rounds' 2>/dev/null || true)"
assert_says_every "the Codex platform binds request_user_input to its three-question cap" \
  "$codex_question_section" <<'CODEX_QUESTION_CAP_TABLE'
`request_user_input`
maximum of 3 questions
3 per round
A fourth question starts the next round
CODEX_QUESTION_CAP_TABLE
assert_says_every "the parity ledger records Codex's three-question cap" \
  "$codex_question_parity_row" <<'CODEX_PARITY_QUESTION_CAP_TABLE'
`request_user_input`
maximum of 3 questions
3 per round
carries a fourth question into the next round
CODEX_PARITY_QUESTION_CAP_TABLE
case "$codex_question_section$codex_question_parity_row" in
  *PLACEHOLDER*|*'hold to 4 questions per round'*|*'holds to 4 questions per round'*)
    echo "FAIL: the settled Codex question cap still carries its PLACEHOLDER/4 contract"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the settled Codex question cap carries no PLACEHOLDER/4 contract"; pass=$((pass + 1)) ;;
esac

# ADR-0097 makes these five losses release input, not explanatory prose. Require
# exactly five table rows and the load-bearing boundary in each one; this is the
# parity mutation gate S14 needs in addition to linter rules 10–12.
codex_loss_ledger="$(sed -n \
  '/^## Frozen loss and degradation ledger$/,/^## /p' \
  "$REPO_ROOT/docs/parity-codex.md" 2>/dev/null)"
codex_loss_rows="$(printf '%s\n' "$codex_loss_ledger" | awk '
  /^\| Loss or degradation \|/ { next }
  /^\|---/ { next }
  /^\|/ { rows++ }
  END { print rows + 0 }
')"
assert_equals "the frozen Codex ledger carries exactly its five release losses" \
  "5" "$codex_loss_rows"
assert_says_every "the frozen Codex ledger names every loss and remaining boundary" \
  "$codex_loss_ledger" <<'CODEX_FROZEN_LOSS_TABLE'
Plan approval composes native UI with a narrower local rail
Hosted tools
specialized paths
`write_stdin`
Oso voice is global instruction prose instead of an applied output style
Context compaction may weaken it
Security review uses a different native reviewer
`codex review`
Two agent sessions in one repository share one state file
The authenticated integrator smoke runs outside CI
operator-run local release check
CODEX_FROZEN_LOSS_TABLE

# S7's Codex approval prose has a runtime gate behind it, but the hook cannot
# repair an orchestrator that never presents the plan or tells the operator how
# to cross Plan Mode's read-only boundary. Read only the platform section that
# defines that handoff so a phrase in a placeholder, wrapper or unrelated warning
# cannot make the contract look complete. Extract the one native approval phrase
# independently; repeating it is fine, alternatives are not.
CODEX_PLAN_PLATFORM="$PLUGIN/skills/_shared/platform/codex/plan.md"
codex_approval_section="$(sed -n \
  '/^## The approval gate$/,/^## /p' "$CODEX_PLAN_PLATFORM" 2>/dev/null)"
approval_literal_candidates() {
  printf '%s' "$1" | awk '
    {
      rest = $0
      while (match(rest, /`[^`]+`/)) {
        literal = substr(rest, RSTART + 1, RLENGTH - 2)
        if (literal == "Implement the plan.") print literal
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
  ' | sort -u
}

assert_equals "the Codex approval section names one native phrase, not alternatives" \
  "Implement the plan." "$(approval_literal_candidates "$codex_approval_section")"
assert_says_every "the Codex approval gate composes native approval with durable artifacts" \
  "$codex_approval_section" <<'CODEX_APPROVAL_GATE_TABLE'
`Implement the plan.`
turn-ending
repaso first
full detail
Plan Mode
`$oso-code:plan`
`/plan`
`permission_mode=default`
`transcript_path`
`turn_id`
`task_started.collaboration_mode_kind`
native plan approval control
whole user prompt
case-sensitive
Punctuation
code fence
surrounding text
not approval
`<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->`
internal
`Stop`
`UserPromptSubmit`
`CANCEL OSO PLAN`
abandon
not a second approval gate
feedback
invalidates
`presented-<approval digest>.md`
`approved-<approval digest>.md`
`current.md`
amend-plan <slice-id>
`mem_update`
frozen intent and scope
roadmap
CODEX_APPROVAL_GATE_TABLE
case "$codex_approval_section" in
  *'PLACEHOLDER'*)
    echo "FAIL: the Codex approval gate still calls its S7 contract a placeholder"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the Codex approval gate is no longer an S7 placeholder"; pass=$((pass + 1)) ;;
esac

# Approval belongs to the exact document the operator saw.  The invalidation
# rule is host-neutral, so it lives in §5 of the shared body rather than being
# silently invented by the Codex adapter.  Restricting this assertion to §5
# prevents a generic "material change" note in execution from satisfying it.
assert_says_every "a material change invalidates approval and re-presents the whole plan" \
  "$(plan_section 5)" <<'APPROVAL_INVALIDATION_TABLE'
Approval applies only to that exact document
A material change after presentation invalidates it
re-present the complete repaso-first plan
fresh approval
APPROVAL_INVALIDATION_TABLE

# Parity has to record the enforcement mechanism and its honest boundary in the
# approval row itself. Other rows legitimately discuss hooks, so a file-wide
# scan would be vacuous. Local calls observed by PreToolUse are held while the
# token is pending; hosted tools that emit no PreToolUse event remain outside
# that layer, and saying so is accuracy rather than reopening the gate.
approval_parity_row="$(awk '
  /^\| The approval gate \|/ { print; rows++ }
  END { if (rows == 0) exit 1 }
' "$REPO_ROOT/docs/parity-codex.md" 2>/dev/null || true)"
assert_equals "the parity ledger has exactly one approval-gate row" \
  "1" "$(printf '%s\n' "$approval_parity_row" | awk 'NF { rows++ } END { print rows + 0 }')"
assert_says_every "the approval row records the enforced gate and its hosted-tool limit" \
  "$approval_parity_row" <<'APPROVAL_PARITY_TABLE'
`Implement the plan.`
`Stop`
`UserPromptSubmit`
`PreToolUse`
pending
hosted
do not cross that hook
Degraded
APPROVAL_PARITY_TABLE
case "$approval_parity_row" in
  *'advisory'*|*'no hook can observe'*|*'no hook can enforce'*)
    echo "FAIL: the approval parity row still claims the technical gate is unobservable"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the approval parity row no longer calls the hard gate advisory"; pass=$((pass + 1)) ;;
esac
case "$approval_parity_row" in
  *'PLACEHOLDER'*)
    echo "FAIL: the approval parity row still defers its enforcement loss to S7"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the approval parity row no longer defers S7"; pass=$((pass + 1)) ;;
esac

# D6 is a prose rail as well as a file primitive.  A perfectly atomic receipt
# still breaks the flow if the orchestrator treats its existence as `pass`, or
# if the read-only child is told to write it.  The shared Codex protocol is the
# single source for every mode, so pin each load-bearing statement there.
assert_says_every "the Codex delegation protocol makes the file a precondition, never a verdict" \
  "$(cat "$codex_subagent_protocol")" <<'HANDOFF_PROTOCOL_TABLE'
`HANDOFF SLICE`
`HANDOFF ATTEMPT`
`oso-handoff: v=1 slice=<ID> attempt=<N>`
`SubagentStop`
`last_assistant_message`
outside the child's sandbox
`oso-state handoff wait`
`--timeout 10`
`oso-state handoff consume`
FILE PRECONDITION
The MESSAGE is always the verdict
Never derive pass, fail, blocked, done, clean or findings from the file
HANDOFF_PROTOCOL_TABLE

s6_placeholders=""
for s6_mode in plan debug; do
  s6_platform="$PLUGIN/skills/_shared/platform/codex/$s6_mode.md"
  grep -qF 'PLACEHOLDER — slice S6 settles this' "$s6_platform" 2>/dev/null \
    && s6_placeholders="$s6_placeholders $s6_mode"
done
assert_equals "plan and debug no longer leave the Codex wait rail to S6" \
  "" "$s6_placeholders"

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

# --- Impeccable on Codex: mounted instructions, never a cache pointer --------
# Codex has no Skill tool invocation for Impeccable.  Its adapter therefore has
# to name the mounted SKILL.md for every argument the neutral contract reaches;
# seeing all four words somewhere in the tree is not enough (a path in an install
# note plus three arguments in the Claude comparison would still ship no runnable
# Codex route).  Each argument must occur in a paragraph that also carries the
# canonical mounted path.
CODEX_FRONT_SURFACE="$PLUGIN/skills/_shared/platform/codex/front-surface.md"
codex_front_surface_routes_missing=""
for codex_front_mode in plan quick debug; do
  grep -qF 'front-surface.md' "$CODEX_PLATFORM/$codex_front_mode.md" 2>/dev/null \
    || codex_front_surface_routes_missing="$codex_front_surface_routes_missing $codex_front_mode"
done
assert_equals "all three Codex modes route front work through one platform adapter" \
  "" "$codex_front_surface_routes_missing"

# Resolve the prose's actual relative token from the file that carries it.  A
# grep-only assertion accepted `../front-surface.md` during review even though,
# from platform/codex/, that names the missing platform/front-surface.md rather
# than the neutral `_shared/front-surface.md` two levels above.
resolve_markdown_reference() {
  local origin="$1" reference="$2" origin_dir reference_dir reference_leaf
  origin_dir="$(dirname "$origin")"
  reference_dir="$(dirname "$reference")"
  reference_leaf="$(basename "$reference")"
  [ -d "$origin_dir/$reference_dir" ] || return 0
  resolved_reference_dir="$(cd "$origin_dir/$reference_dir" && pwd -P)"
  [ -f "$resolved_reference_dir/$reference_leaf" ] || return 0
  printf '%s/%s' "$resolved_reference_dir" "$reference_leaf"
}

for codex_front_mode in plan quick debug; do
  codex_mode_file="$CODEX_PLATFORM/$codex_front_mode.md"
  codex_mode_front_ref="$({ grep -oE '(\.\./)*front-surface\.md' "$codex_mode_file" || true; } | sort -u)"
  assert_equals "$codex_front_mode carries its neutral trigger and direct Codex adapter references" \
    "../../front-surface.md
front-surface.md" "$codex_mode_front_ref"
  assert_equals "$codex_front_mode's neutral trigger reference resolves to the shared contract" \
    "$PLUGIN/skills/_shared/front-surface.md" \
    "$(resolve_markdown_reference "$codex_mode_file" '../../front-surface.md')"
  assert_equals "$codex_front_mode's platform reference resolves to the Codex adapter" \
    "$CODEX_FRONT_SURFACE" \
    "$(resolve_markdown_reference "$codex_mode_file" 'front-surface.md')"
done

codex_adapter_neutral_ref="$({ grep -oE '(\.\./)+front-surface\.md' "$CODEX_FRONT_SURFACE" 2>/dev/null || true; } | sort -u)"
assert_equals "the Codex front adapter carries one relative reference to the neutral contract" \
  "../../front-surface.md" "$codex_adapter_neutral_ref"
assert_equals "the Codex adapter's neutral front-surface reference resolves to a real file" \
  "$PLUGIN/skills/_shared/front-surface.md" \
  "$(resolve_markdown_reference "$CODEX_FRONT_SURFACE" "$codex_adapter_neutral_ref")"

# The adapter split changed Claude's path graph too. Keep that production tree
# as executable documentation: every mode must reach both the unchanged neutral
# contract and the new Claude binding, and the binding must still carry every
# host spelling removed from the neutral file during the split.
CLAUDE_PLATFORM="$PLUGIN/skills/_shared/platform/claude"
CLAUDE_FRONT_SURFACE="$CLAUDE_PLATFORM/front-surface.md"
for claude_front_mode in plan quick debug; do
  claude_mode_file="$CLAUDE_PLATFORM/$claude_front_mode.md"
  claude_mode_front_ref="$({ grep -oE '(\.\./)*front-surface\.md' "$claude_mode_file" || true; } | sort -u)"
  assert_equals "$claude_front_mode carries its neutral trigger and direct Claude adapter references" \
    "../../front-surface.md
front-surface.md" "$claude_mode_front_ref"
  assert_equals "$claude_front_mode's neutral trigger reference resolves to the shared contract" \
    "$PLUGIN/skills/_shared/front-surface.md" \
    "$(resolve_markdown_reference "$claude_mode_file" '../../front-surface.md')"
  assert_equals "$claude_front_mode's platform reference resolves to the Claude adapter" \
    "$CLAUDE_FRONT_SURFACE" \
    "$(resolve_markdown_reference "$claude_mode_file" 'front-surface.md')"
done

claude_adapter_neutral_ref="$({ grep -oE '(\.\./)+front-surface\.md' "$CLAUDE_FRONT_SURFACE" 2>/dev/null || true; } | sort -u)"
assert_equals "the Claude front adapter carries one relative reference to the neutral contract" \
  "../../front-surface.md" "$claude_adapter_neutral_ref"
assert_equals "the Claude adapter's neutral front-surface reference resolves to a real file" \
  "$PLUGIN/skills/_shared/front-surface.md" \
  "$(resolve_markdown_reference "$CLAUDE_FRONT_SURFACE" "$claude_adapter_neutral_ref")"

claude_front_surface_contract="$(cat "$CLAUDE_FRONT_SURFACE" 2>/dev/null || true)"
assert_says_every "the Claude front adapter preserves every load-bearing host spelling" \
  "$claude_front_surface_contract" <<'CLAUDE_IMPECCABLE_SPELLINGS'
`impeccable:impeccable`
Skill tool
`claude plugin list`
`/plugin marketplace add pbakaus/impeccable`
`/plugin install impeccable@impeccable`
CLAUDE_IMPECCABLE_SPELLINGS

codex_front_surface_contract="$(cat "$CODEX_FRONT_SURFACE" 2>/dev/null || true)"
assert_says_every "the Codex front adapter publishes both mounted-path spellings" \
  "$codex_front_surface_contract" <<'CODEX_IMPECCABLE_PATHS'
`~/.agents/skills/impeccable/SKILL.md`
`$HOME/.agents/skills/impeccable/SKILL.md`
absolute
`reference/`
CODEX_IMPECCABLE_PATHS
case "$codex_front_surface_contract" in
  *'PLACEHOLDER'*)
    echo "FAIL: the Codex front adapter still calls its S8 contract a placeholder"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the Codex front adapter is no longer an S8 placeholder"; pass=$((pass + 1)) ;;
esac

codex_argument_block_status() {
  local argument="$1" exact_route
  case "$argument" in
    init|document) exact_route="\`\$impeccable $argument\`" ;;
    audit) exact_route='`$impeccable audit <touched surfaces>`' ;;
    *) printf 'unknown'; return 0 ;;
  esac
  awk -v route="$exact_route" '
    BEGIN { RS = "" }
    index($0, "~/.agents/skills/impeccable/SKILL.md") &&
      index($0, route) &&
      $0 ~ /(^|[^A-Za-z])ARGUMENT([^A-Za-z]|$)/ {
        matched++
      }
    END { if (matched == 1) print "exact"; else print matched + 0 }
  ' "$CODEX_FRONT_SURFACE" 2>/dev/null
}

for impeccable_argument in init document audit; do
  assert_equals "Codex binds exact $impeccable_argument ARGUMENT and mounted SKILL route in one block" \
    "exact" "$(codex_argument_block_status "$impeccable_argument")"
done

# The mount helper receives an already-resolved versioned source and owns only
# the stable Codex destination. A copied destination must consist only of real data; the
# separate adversarial fixture below permits either safe dereferencing or loud
# rejection of source links, but never a surviving pointer.
MOUNT_IMPECCABLE="$REPO_ROOT/bootstrap/lib/mount-impeccable.sh"
IMPECCABLE_CACHE="$TEST_HOME/codex-plugin-cache/impeccable/1.2.3/skills/impeccable"
IMPECCABLE_MOUNT="$HOME/.agents/skills/impeccable"

write_codex_impeccable_fixture() {
  local destination="$1" name_line="$2" version_line="$3"
  mkdir -p "$destination/reference"
  printf '%s\n' '---' > "$destination/SKILL.md"
  [ -z "$name_line" ] || printf '%s\n' "$name_line" >> "$destination/SKILL.md"
  [ -z "$version_line" ] || printf '%s\n' "$version_line" >> "$destination/SKILL.md"
  printf '%s\n' \
    '---' \
    'installed-root: .agents/skills/impeccable' \
    'usage: $impeccable init | $impeccable document | $impeccable audit <target>' \
    'references: reference/init.md reference/document.md reference/audit.md' \
    >> "$destination/SKILL.md"
  printf '%s\n' 'Codex init reference' > "$destination/reference/init.md"
  printf '%s\n' 'Codex document reference' > "$destination/reference/document.md"
  printf '%s\n' 'Codex audit reference' > "$destination/reference/audit.md"
}

write_codex_impeccable_fixture "$IMPECCABLE_CACHE" \
  'name: impeccable' 'version: 1.2.3'
mkdir -p "$IMPECCABLE_CACHE/reference/linked-assets" "$IMPECCABLE_CACHE/assets"
printf '%s\n' 'stable playbook' > "$IMPECCABLE_CACHE/reference/playbook.md"
printf '%s\n' 'stable asset' > "$IMPECCABLE_CACHE/assets/palette.txt"
printf '%s\n' 'stable playbook' > "$IMPECCABLE_CACHE/reference/linked-playbook.md"
printf '%s\n' 'stable asset' > "$IMPECCABLE_CACHE/reference/linked-assets/palette.txt"

if [ ! -x "$MOUNT_IMPECCABLE" ]; then
  echo "FAIL: the Codex Impeccable mount helper is absent or not executable"
  fail=$((fail + 1))
elif mount_report="$("$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" 2>&1)"; then
  echo "ok: the Codex Impeccable mount accepts one resolved skill directory"
  pass=$((pass + 1))

  assert_equals "the Impeccable mount is a directory, not a cache symlink" \
    "directory" "$([ -d "$IMPECCABLE_MOUNT" ] && [ ! -L "$IMPECCABLE_MOUNT" ] && printf directory || printf pointer)"
  assert_equals "the mounted SKILL.md is copied data" \
    "regular" "$([ -f "$IMPECCABLE_MOUNT/SKILL.md" ] && [ ! -L "$IMPECCABLE_MOUNT/SKILL.md" ] && printf regular || printf pointer)"
  assert_equals "the mounted skill identity is exactly impeccable" \
    "name: impeccable" "$(sed -n '/^name:[[:space:]]*/p' "$IMPECCABLE_MOUNT/SKILL.md")"
  mounted_impeccable_version="$(sed -n 's/^version:[[:space:]]*//p' "$IMPECCABLE_MOUNT/SKILL.md")"
  assert_equals "the mounted skill carries one nonempty semantic version" \
    "valid" "$(printf '%s\n' "$mounted_impeccable_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$' && printf valid || printf invalid)"
  assert_equals "a mounted reference file is real copied data" \
    "stable playbook" "$([ ! -L "$IMPECCABLE_MOUNT/reference/linked-playbook.md" ] && cat "$IMPECCABLE_MOUNT/reference/linked-playbook.md" || printf pointer)"
  assert_equals "a mounted reference directory is real copied data" \
    "stable asset" "$([ ! -L "$IMPECCABLE_MOUNT/reference/linked-assets" ] && cat "$IMPECCABLE_MOUNT/reference/linked-assets/palette.txt" || printf pointer)"
  mounted_impeccable_refs_missing=""
  for mounted_impeccable_ref in init document audit; do
    [ -f "$IMPECCABLE_MOUNT/reference/$mounted_impeccable_ref.md" ] \
      && [ ! -L "$IMPECCABLE_MOUNT/reference/$mounted_impeccable_ref.md" ] \
      || mounted_impeccable_refs_missing="$mounted_impeccable_refs_missing $mounted_impeccable_ref"
  done
  assert_equals "the mounted Codex skill carries all three required argument references" \
    "" "$mounted_impeccable_refs_missing"

  # A mounted copy must remain usable after the cache entry changes.  This is
  # the behavioural distinction D8 makes; checking only `test ! -L` at the root
  # would miss a bind made of symlinked descendants.
  printf '%s\n' 'cache changed later' > "$IMPECCABLE_CACHE/reference/playbook.md"
  assert_equals "the mounted reference is independent of later cache mutation" \
    "stable playbook" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

  # Re-running replaces the complete snapshot.  A stale file in the old mount
  # may not survive, and the newly resolved cache contents must arrive without
  # changing the stable destination path.
  printf '%s\n' 'stale local file' > "$IMPECCABLE_MOUNT/stale.md"
  if remount_report="$("$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" 2>&1)"; then
    assert_equals "a second mount replaces stale destination contents" \
      "gone" "$([ ! -e "$IMPECCABLE_MOUNT/stale.md" ] && printf gone || printf present)"
    assert_equals "a second mount refreshes the independent snapshot" \
      "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

    # Model cache collection without deleting fixture data: after the versioned
    # source moves away, the stable global mount must still be complete.
    mv "$IMPECCABLE_CACHE" "$IMPECCABLE_CACHE.collected"
    assert_equals "the mounted skill survives collection of its cache version" \
      "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"
    mv "$IMPECCABLE_CACHE.collected" "$IMPECCABLE_CACHE"
  else
    echo "FAIL: a second Impeccable mount was not idempotent — ${remount_report:-<empty>}"
    fail=$((fail + 1))
  fi

  # The registry directory is stable; ownership is one unique symlink per
  # acquirer, published atomically. A process removes only its own link. Dead
  # links are logical stale records (ignored but retained), while a live link
  # blocks and any entry outside the exact symlink grammar fails closed.
  IMPECCABLE_MOUNT_LOCK="$HOME/.agents/skills/.impeccable.mount.lock"
  mkdir -p "$IMPECCABLE_MOUNT_LOCK"
  ln -s "pid=$$;token=live-fixture-token" \
    "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token"
  printf '%s\n' 'must survive a live lock' > "$IMPECCABLE_MOUNT/live-lock-sentinel"
  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
    echo "FAIL: a live Impeccable mount lock was stolen"
    fail=$((fail + 1))
  else
    echo "ok: a live Impeccable mount lock rejects a concurrent replacement"
    pass=$((pass + 1))
  fi
  assert_equals "live-lock rejection preserves the mounted snapshot" \
    "must survive a live lock" "$(cat "$IMPECCABLE_MOUNT/live-lock-sentinel")"
  assert_equals "live-lock rejection preserves the owner's exact target" \
    "pid=$$;token=live-fixture-token" \
    "$(readlink "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token")"

  rm -f "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token"
  ln -s 'pid=2147483647;token=dead-fixture-token' \
    "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token"
  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
    echo "ok: a dead Impeccable mount owner is ignored so mounting can continue"
    pass=$((pass + 1))
  else
    echo "FAIL: a dead Impeccable mount owner blocked logical recovery"
    fail=$((fail + 1))
  fi
  assert_equals "dead-lock recovery completes the replacement" \
    "gone" "$([ ! -e "$IMPECCABLE_MOUNT/live-lock-sentinel" ] && printf gone || printf present)"
  assert_equals "dead-lock recovery never deletes a foreign owner record" \
    "pid=2147483647;token=dead-fixture-token" \
    "$(readlink "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token")"

  rm -f "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token"
  printf '%s\n' 'must survive only until empty-lock recovery' \
    > "$IMPECCABLE_MOUNT/empty-lock-sentinel"
  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
    echo "ok: an empty owner registry permits a fresh atomic acquisition"
    pass=$((pass + 1))
  else
    echo "FAIL: an empty owner registry blocked a fresh mount"
    fail=$((fail + 1))
  fi
  assert_equals "empty-registry acquisition completes the replacement" \
    "gone" "$([ ! -e "$IMPECCABLE_MOUNT/empty-lock-sentinel" ] && printf gone || printf present)"
  assert_equals "a completed mount withdraws its owner from the stable registry" \
    "empty" "$([ -d "$IMPECCABLE_MOUNT_LOCK" ] \
      && [ -z "$(find "$IMPECCABLE_MOUNT_LOCK" -mindepth 1 -print -quit)" ] \
      && printf empty || printf occupied)"

  printf '%s\n' 'unknown primary payload' > "$IMPECCABLE_MOUNT_LOCK/owner.unexpected"
  printf '%s\n' 'must survive corrupt primary' > "$IMPECCABLE_MOUNT/corrupt-lock-sentinel"
  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
    echo "FAIL: unexpected primary-lock contents were discarded"
    fail=$((fail + 1))
  else
    echo "ok: unexpected primary-lock contents fail closed"
    pass=$((pass + 1))
  fi
  assert_equals "corrupt-primary rejection preserves the mounted snapshot" \
    "must survive corrupt primary" "$(cat "$IMPECCABLE_MOUNT/corrupt-lock-sentinel")"
  assert_equals "corrupt-primary rejection preserves unexpected evidence" \
    "unknown primary payload" "$(cat "$IMPECCABLE_MOUNT_LOCK/owner.unexpected")"
  rm -f "$IMPECCABLE_MOUNT_LOCK/owner.unexpected"
  rm -f "$IMPECCABLE_MOUNT/corrupt-lock-sentinel"

  # An entry outside owner.* is not irrelevant: `owner` is the exact live-owner
  # filename shipped by the immediately previous lock protocol. Ignoring it
  # would let a new installer overlap an old-version critical section. Unknown
  # children therefore fail closed and remain as evidence; they are never
  # silently skipped merely because the new contender glob cannot parse them.
  printf 'pid=%s\ntoken=%s\n' "$$" 'legacy-live-token' \
    > "$IMPECCABLE_MOUNT_LOCK/owner"
  printf '%s\n' 'must survive a legacy registry owner' \
    > "$IMPECCABLE_MOUNT/legacy-owner-sentinel"
  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
    echo "FAIL: a legacy owner outside the atomic registry grammar was ignored"
    fail=$((fail + 1))
  else
    echo "ok: a legacy owner outside the atomic registry grammar fails closed"
    pass=$((pass + 1))
  fi
  assert_equals "legacy-owner rejection preserves the mounted snapshot" \
    "must survive a legacy registry owner" \
    "$([ -f "$IMPECCABLE_MOUNT/legacy-owner-sentinel" ] \
      && cat "$IMPECCABLE_MOUNT/legacy-owner-sentinel" || printf missing)"
  assert_equals "legacy-owner rejection preserves old-protocol evidence" \
    "pid=$$
token=legacy-live-token" "$(cat "$IMPECCABLE_MOUNT_LOCK/owner")"
  rm -f "$IMPECCABLE_MOUNT_LOCK/owner"
  rm -f "$IMPECCABLE_MOUNT/legacy-owner-sentinel"

  # Deterministic ABA regression. A pauses immediately before publishing its
  # ownership primitive (the former implementation used mv; the atomic one uses
  # ln). B publishes and reaches the protected copy while A is still paused.
  # Resuming A must make A withdraw/fail without touching B's unique owner.
  ABA_HOME="$TEST_HOME/impeccable-aba-home"
  ABA_CONTROL="$TEST_HOME/impeccable-aba-control"
  ABA_SHIMS="$TEST_HOME/impeccable-aba-shims"
  ABA_SOURCE_A="$TEST_HOME/impeccable-aba-source-a"
  ABA_SOURCE_B="$TEST_HOME/impeccable-aba-source-b"
  mkdir -p "$ABA_HOME" "$ABA_CONTROL" "$ABA_SHIMS"
  write_codex_impeccable_fixture "$ABA_SOURCE_A" \
    'name: impeccable' 'version: 1.2.3'
  write_codex_impeccable_fixture "$ABA_SOURCE_B" \
    'name: impeccable' 'version: 1.2.3'
  printf '%s\n' 'complete source A' > "$ABA_SOURCE_A/reference/race-winner.md"
  printf '%s\n' 'complete source B' > "$ABA_SOURCE_B/reference/race-winner.md"

  ABA_REAL_LN="$(command -v ln)"
  ABA_REAL_MV="$(command -v mv)"
  ABA_REAL_CP="$(command -v cp)"
  printf '%s\n' \
    '#!/bin/sh' \
    'last=' \
    'for argument in "$@"; do last=$argument; done' \
    'case "${ABA_PAUSE_OWNER_PUBLICATION:-}:$last" in' \
    '  1:*/.impeccable.mount.lock/owner.*)' \
    '    : > "$ABA_CONTROL/a-publication-paused"' \
    '    while [ ! -f "$ABA_CONTROL/release-a" ]; do sleep 1; done' \
    '    ;;' \
    'esac' \
    'exec "$ABA_REAL_LN" "$@"' \
    > "$ABA_SHIMS/ln"
  printf '%s\n' \
    '#!/bin/sh' \
    'last=' \
    'for argument in "$@"; do last=$argument; done' \
    'case "${ABA_PAUSE_OWNER_PUBLICATION:-}:$last" in' \
    '  1:*/.impeccable.mount.lock/owner)' \
    '    : > "$ABA_CONTROL/a-publication-paused"' \
    '    while [ ! -f "$ABA_CONTROL/release-a" ]; do sleep 1; done' \
    '    ;;' \
    'esac' \
    'exec "$ABA_REAL_MV" "$@"' \
    > "$ABA_SHIMS/mv"
  printf '%s\n' \
    '#!/bin/sh' \
    'if [ "${ABA_PAUSE_PROTECTED_COPY:-}" = 1 ]; then' \
    '  : > "$ABA_CONTROL/b-entered-critical-section"' \
    '  while [ ! -f "$ABA_CONTROL/release-b" ]; do sleep 1; done' \
    'fi' \
    'exec "$ABA_REAL_CP" "$@"' \
    > "$ABA_SHIMS/cp"
  chmod +x "$ABA_SHIMS/ln" "$ABA_SHIMS/mv" "$ABA_SHIMS/cp"

  wait_for_aba_marker() {
    local marker="$1" process_id="$2" waited=0
    while [ ! -f "$marker" ] && [ "$waited" -lt 10 ]; do
      kill -0 "$process_id" 2>/dev/null || return 1
      sleep 1
      waited=$((waited + 1))
    done
    [ -f "$marker" ]
  }

  (
    if HOME="$ABA_HOME" PATH="$ABA_SHIMS:$PATH" \
      ABA_CONTROL="$ABA_CONTROL" ABA_REAL_LN="$ABA_REAL_LN" \
      ABA_REAL_MV="$ABA_REAL_MV" ABA_REAL_CP="$ABA_REAL_CP" \
      ABA_PAUSE_OWNER_PUBLICATION=1 \
      "$MOUNT_IMPECCABLE" "$ABA_SOURCE_A" \
      > "$ABA_CONTROL/a.stdout" 2> "$ABA_CONTROL/a.stderr"; then
      aba_child_rc=0
    else
      aba_child_rc=$?
    fi
    printf '%s\n' "$aba_child_rc" > "$ABA_CONTROL/a.rc"
  ) &
  aba_a_pid=$!
  aba_ready=true
  if ! wait_for_aba_marker "$ABA_CONTROL/a-publication-paused" "$aba_a_pid"; then
    echo "FAIL: ABA process A never reached the atomic owner-publication seam"
    fail=$((fail + 1))
    aba_ready=false
    : > "$ABA_CONTROL/release-a"
    wait "$aba_a_pid" 2>/dev/null || true
  fi

  if [ "$aba_ready" = true ]; then
    (
      if HOME="$ABA_HOME" PATH="$ABA_SHIMS:$PATH" \
        ABA_CONTROL="$ABA_CONTROL" ABA_REAL_LN="$ABA_REAL_LN" \
        ABA_REAL_MV="$ABA_REAL_MV" ABA_REAL_CP="$ABA_REAL_CP" \
        ABA_PAUSE_PROTECTED_COPY=1 \
        "$MOUNT_IMPECCABLE" "$ABA_SOURCE_B" \
        > "$ABA_CONTROL/b.stdout" 2> "$ABA_CONTROL/b.stderr"; then
        aba_child_rc=0
      else
        aba_child_rc=$?
      fi
      printf '%s\n' "$aba_child_rc" > "$ABA_CONTROL/b.rc"
    ) &
    aba_b_pid=$!
    if ! wait_for_aba_marker "$ABA_CONTROL/b-entered-critical-section" "$aba_b_pid"; then
      echo "FAIL: ABA process B never published ownership and entered the protected copy"
      fail=$((fail + 1))
      aba_ready=false
      : > "$ABA_CONTROL/release-a"
      : > "$ABA_CONTROL/release-b"
      wait "$aba_a_pid" 2>/dev/null || true
      wait "$aba_b_pid" 2>/dev/null || true
    fi
  fi

  if [ "$aba_ready" = true ]; then
    : > "$ABA_CONTROL/release-a"
    wait "$aba_a_pid" 2>/dev/null || true

    aba_registry="$ABA_HOME/.agents/skills/.impeccable.mount.lock"
    aba_owner_entries="$(find "$aba_registry" -mindepth 1 -maxdepth 1 -type l -name 'owner.*' 2>/dev/null)"
    aba_owner_count="$(printf '%s\n' "$aba_owner_entries" | awk 'NF { count++ } END { print count + 0 }')"
    assert_equals "losing process A never cleans up process B's published owner" \
      "1" "$aba_owner_count"

    : > "$ABA_CONTROL/release-b"
    wait "$aba_b_pid" 2>/dev/null || true

    aba_successes=0
    aba_failures=0
    for aba_rc_file in "$ABA_CONTROL/a.rc" "$ABA_CONTROL/b.rc"; do
      if [ "$(cat "$aba_rc_file")" = 0 ]; then
        aba_successes=$((aba_successes + 1))
      else
        aba_failures=$((aba_failures + 1))
      fi
    done
    aba_mounted_lines="$({ grep -h '^mounted impeccable at ' \
      "$ABA_CONTROL/a.stdout" "$ABA_CONTROL/b.stdout" || true; } \
      | awk 'NF { count++ } END { print count + 0 }')"
    assert_equals "the ABA race has exactly one successful mount" \
      "1" "$aba_successes"
    assert_equals "the ABA race has exactly one losing helper" \
      "1" "$aba_failures"
    assert_equals "only the successful ABA helper prints mounted" \
      "1" "$aba_mounted_lines"

    ABA_FINAL_MOUNT="$ABA_HOME/.agents/skills/impeccable"
    aba_final_refs_missing=""
    for aba_required_ref in init document audit race-winner; do
      [ -f "$ABA_FINAL_MOUNT/reference/$aba_required_ref.md" ] \
        || aba_final_refs_missing="$aba_final_refs_missing $aba_required_ref"
    done
    assert_equals "the ABA winner leaves one complete mounted skill" \
      "" "$aba_final_refs_missing"
    assert_equals "process B's complete snapshot is the ABA winner" \
      "complete source B" "$(cat "$ABA_FINAL_MOUNT/reference/race-winner.md")"
    assert_equals "the ABA winner withdraws its own owner without foreign residue" \
      "empty" "$([ -d "$aba_registry" ] \
        && [ -z "$(find "$aba_registry" -mindepth 1 -print -quit)" ] \
        && printf empty || printf occupied)"
  fi

  # Validation happens before replacement.  A malformed cache result must fail
  # loudly while leaving the last known-good mounted snapshot intact.
  INVALID_IMPECCABLE="$TEST_HOME/impeccable-cache/invalid"
  mkdir -p "$INVALID_IMPECCABLE/reference"
  if "$MOUNT_IMPECCABLE" "$INVALID_IMPECCABLE" >/dev/null 2>&1; then
    echo "FAIL: an Impeccable source without a regular SKILL.md was accepted"
    fail=$((fail + 1))
  else
    echo "ok: an Impeccable source without a regular SKILL.md is rejected"
    pass=$((pass + 1))
  fi
  assert_equals "an invalid source preserves the last known-good mount" \
    "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

  assert_bad_identity_preserves_mount() {
    local case_name="$1" bad_source="$2" name_line="$3" version_line="$4"
    local preserved_playbook
    write_codex_impeccable_fixture "$bad_source" "$name_line" "$version_line"
    if "$MOUNT_IMPECCABLE" "$bad_source" >/dev/null 2>&1; then
      echo "FAIL: $case_name was accepted as a Codex Impeccable source"
      fail=$((fail + 1))
      preserved_playbook="$([ -f "$IMPECCABLE_MOUNT/reference/playbook.md" ] \
        && cat "$IMPECCABLE_MOUNT/reference/playbook.md" || printf missing)"
      "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1 || true
    else
      echo "ok: $case_name is rejected before replacement"
      pass=$((pass + 1))
      preserved_playbook="$([ -f "$IMPECCABLE_MOUNT/reference/playbook.md" ] \
        && cat "$IMPECCABLE_MOUNT/reference/playbook.md" || printf missing)"
    fi
    assert_equals "$case_name preserves the last known-good mount" \
      "cache changed later" "$preserved_playbook"
  }

  assert_bad_identity_preserves_mount \
    "a Codex skill with no name" \
    "$TEST_HOME/codex-plugin-cache/impeccable/no-name/skills/impeccable" \
    "" "version: 1.2.3"
  assert_bad_identity_preserves_mount \
    "a Codex skill with the wrong name" \
    "$TEST_HOME/codex-plugin-cache/impeccable/wrong-name/skills/impeccable" \
    "name: impeccable-helper" "version: 1.2.3"
  assert_bad_identity_preserves_mount \
    "a Codex skill with no version" \
    "$TEST_HOME/codex-plugin-cache/impeccable/no-version/skills/impeccable" \
    "name: impeccable" ""
  assert_bad_identity_preserves_mount \
    "a Codex skill with a non-version label" \
    "$TEST_HOME/codex-plugin-cache/impeccable/bad-version/skills/impeccable" \
    "name: impeccable" "version: latest"

  # A provider-wrong artifact is more dangerous than an incomplete one: it has
  # the expected skill and all three references, so a structural-only check
  # would publish commands and paths that are valid in Claude but dead in Codex.
  CLAUDE_IMPECCABLE="$TEST_HOME/claude-plugin-cache/impeccable/1.2.3/skills/impeccable"
  mkdir -p "$CLAUDE_IMPECCABLE/reference"
  printf '%s\n' \
    '---' \
    'name: impeccable' \
    'version: 1.2.3' \
    '---' \
    'installed-root: .claude/skills/impeccable' \
    'usage: /impeccable init | /impeccable document | /impeccable audit <target>' \
    'references: reference/init.md reference/document.md reference/audit.md' \
    > "$CLAUDE_IMPECCABLE/SKILL.md"
  printf '%s\n' 'Claude init reference' > "$CLAUDE_IMPECCABLE/reference/init.md"
  printf '%s\n' 'Claude document reference' > "$CLAUDE_IMPECCABLE/reference/document.md"
  printf '%s\n' 'Claude audit reference' > "$CLAUDE_IMPECCABLE/reference/audit.md"
  if "$MOUNT_IMPECCABLE" "$CLAUDE_IMPECCABLE" >/dev/null 2>&1; then
    echo "FAIL: a structurally complete Claude-compiled Impeccable skill was mounted into Codex"
    fail=$((fail + 1))
  else
    echo "ok: a structurally complete Claude-compiled Impeccable skill is rejected"
    pass=$((pass + 1))
  fi
  assert_equals "provider rejection preserves the last known-good Codex mount" \
    "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

  INCOMPLETE_CODEX_IMPECCABLE="$TEST_HOME/codex-plugin-cache/impeccable/incomplete/skills/impeccable"
  write_codex_impeccable_fixture "$INCOMPLETE_CODEX_IMPECCABLE" \
    'name: impeccable' 'version: 1.2.3'
  mv "$INCOMPLETE_CODEX_IMPECCABLE/reference/audit.md" \
    "$INCOMPLETE_CODEX_IMPECCABLE/audit-reference-omitted"
  if "$MOUNT_IMPECCABLE" "$INCOMPLETE_CODEX_IMPECCABLE" >/dev/null 2>&1; then
    echo "FAIL: a Codex Impeccable source missing its audit reference was accepted"
    fail=$((fail + 1))
  else
    echo "ok: a Codex Impeccable source missing a required argument reference is rejected"
    pass=$((pass + 1))
  fi
  assert_equals "incomplete-reference rejection preserves the last known-good Codex mount" \
    "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

  LINKED_CODEX_IMPECCABLE="$TEST_HOME/codex-plugin-cache/impeccable/linked/skills/impeccable"
  write_codex_impeccable_fixture "$LINKED_CODEX_IMPECCABLE" \
    'name: impeccable' 'version: 1.2.3'
  ln -s "$LINKED_CODEX_IMPECCABLE/reference/audit.md" \
    "$LINKED_CODEX_IMPECCABLE/reference/cache-pointer.md"
  if "$MOUNT_IMPECCABLE" "$LINKED_CODEX_IMPECCABLE" >/dev/null 2>&1; then
    linked_mount_result="$([ ! -L "$IMPECCABLE_MOUNT/reference/cache-pointer.md" ] && printf dereferenced || printf pointer)"
    assert_equals "a source link can mount only when it becomes independent copied data" \
      "dereferenced" "$linked_mount_result"
    if ! "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" >/dev/null 2>&1; then
      echo "FAIL: the known-good Codex mount could not be restored after the link case"
      fail=$((fail + 1))
    fi
  else
    echo "ok: a Codex source carrying a cache pointer is rejected before replacement"
    pass=$((pass + 1))
  fi
  assert_equals "a source link never replaces the last known-good Codex mount with a pointer" \
    "absent" "$([ ! -e "$IMPECCABLE_MOUNT/reference/cache-pointer.md" ] && printf absent || printf present)"

  if "$MOUNT_IMPECCABLE" "$IMPECCABLE_MOUNT" >/dev/null 2>&1; then
    echo "FAIL: the mount accepted its own destination as the cache source"
    fail=$((fail + 1))
  else
    echo "ok: the mount rejects its own destination as the cache source"
    pass=$((pass + 1))
  fi
  assert_equals "rejecting a self-source does not consume the mounted copy" \
    "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"
else
  echo "FAIL: the Codex Impeccable mount rejected a valid source — ${mount_report:-<empty>}"
  fail=$((fail + 1))
fi

if [ ! -x "$MOUNT_IMPECCABLE" ]; then
  # The primary existence case above already reports the missing helper.  Do
  # not misreport that absence as successful arity validation too.
  echo "FAIL: mount arity could not be checked because the helper is not executable"
  fail=$((fail + 1))
elif "$MOUNT_IMPECCABLE" >/dev/null 2>&1 \
  || "$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" unexpected >/dev/null 2>&1; then
  echo "FAIL: the Codex Impeccable mount accepted an argument count other than one"
  fail=$((fail + 1))
else
  echo "ok: the Codex Impeccable mount requires exactly one source argument"
  pass=$((pass + 1))
fi

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

# --- Delegation handoff: exact attempt, bounded wait, atomic one-shot receipt --
# The report itself stays in the SubagentStop message.  The file rail stores only
# an identity-bound receipt for that message.  Parent wait/consume calls therefore
# need no child session id, and a verdict word can never leak into the file rail.
HANDOFF_REPO="$TEST_HOME/handoff-repo"
HANDOFF_STDERR="$TEST_HOME/handoff-stderr"
mkdir -p "$HANDOFF_REPO"
rm -rf "$STATE_DIR/.handoffs"

digest_text() {
  printf '%s' "$1" |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; } |
    awk '{ print $1 }'
}

expected_receipt() {
  local hook_session="$1" slice="$2" attempt="$3" agent_id="$4" agent_type="$5"
  printf '%s\n' \
    'version=1' \
    "hook_session=$hook_session" \
    "slice=$slice" \
    "attempt=$attempt" \
    "agent_id=$agent_id" \
    "agent_type=$agent_type"
}

handoff_receipt_path() {
  local agent_id="$1"
  printf '%s/.handoffs/%s/%s.receipt' \
    "$STATE_DIR" "$(state_key_of "$HANDOFF_REPO")" "$(digest_text "$agent_id")"
}

run_handoff() {
  local input="$1"
  shift
  : > "$HANDOFF_STDERR"
  if handoff_stdout="$(printf '%s' "$input" |
       ( cd "$HANDOFF_REPO" && oso-state "$@" ) \
       2>"$HANDOFF_STDERR")"; then
    handoff_rc=0
  else
    handoff_rc=$?
  fi
  handoff_stderr="$(cat "$HANDOFF_STDERR")"
}

# The child sandbox never publishes.  SubagentStop receives the parent session
# and the exact final message, and the host hook is the writer that bridges a
# read-only judge to the receipt directory.
HANDOFF_HOOK="$PLUGIN/hooks/publish-subagent-handoff.sh"
hook_report='oso-handoff: v=1 slice=slice-hook attempt=1
evidence: the named check is green
verdict: pass'
hook_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-hook\",\"agent_id\":\"agent-hook\",\"agent_type\":\"oso-verifier\",\"agent_transcript_path\":\"%s\",\"stop_hook_active\":false,\"last_assistant_message\":\"oso-handoff: v=1 slice=slice-hook attempt=1\\nevidence: the named check is green\\nverdict: pass\"}' \
  "$SESSION" "$HANDOFF_REPO" "$TEST_HOME/agent-hook.jsonl")"
run_hook "$HANDOFF_HOOK" "$hook_payload"
assert_after_hook "SubagentStop publishes a receipt outside a read-only delegate" \
  [ "$hook_stdout" = '{}' ]
hook_receipt="$(expected_receipt "$SESSION" slice-hook 1 agent-hook oso-verifier)"
run_handoff "" handoff wait \
  --slice slice-hook --attempt 1 --agent-id agent-hook --agent-type oso-verifier --timeout 0
assert_equals "the hook receipt binds host metadata while the message keeps the terminal verdict" \
  "rc=0:$hook_receipt" "rc=$handoff_rc:$handoff_stdout"
run_handoff "" handoff consume \
  --slice slice-hook --attempt 1 --agent-id agent-hook --agent-type oso-verifier
assert_equals "the host-published receipt is consumed through the same one-shot rail" 0 "$handoff_rc"

( cd "$HANDOFF_REPO" && oso-state --session 1 set mode=plan active_slice=fixed-marker verify_green=false >/dev/null )
HANDOFF_RUNTIME="$TEST_HOME/handoff-runtime"
HANDOFF_NO_STATE_PATH="$TEST_HOME/handoff-no-state-path"
mkdir -p "$HANDOFF_RUNTIME/hooks" "$HANDOFF_RUNTIME/bin" "$HANDOFF_NO_STATE_PATH"
for handoff_runtime_tool in bash cat chmod date dirname grep mkdir mktemp mv rm rmdir sha256sum shasum sleep stat tr wc; do
  handoff_runtime_tool_path="$(PATH=/usr/bin:/bin command -v "$handoff_runtime_tool" 2>/dev/null || true)"
  [ -n "$handoff_runtime_tool_path" ] || continue
  ln -s "$handoff_runtime_tool_path" "$HANDOFF_NO_STATE_PATH/$handoff_runtime_tool"
done
cp "$PLUGIN/hooks/publish-subagent-handoff.sh" "$PLUGIN/hooks/lib.sh" "$PLUGIN/hooks/lexer.sh" \
  "$HANDOFF_RUNTIME/hooks/"
cp "$PLUGIN/bin/oso-state" "$HANDOFF_RUNTIME/bin/"
chmod +x "$HANDOFF_RUNTIME/hooks/publish-subagent-handoff.sh" "$HANDOFF_RUNTIME/bin/oso-state"
assert_equals "the runtime fallback regression PATH cannot resolve bare oso-state" \
  "missing" "$(
    PATH="$HANDOFF_NO_STATE_PATH"
    hash -r
    command -v oso-state >/dev/null 2>&1 && echo present || echo missing
  )"
fixed_marker_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-fixed-marker\",\"agent_id\":\"agent-fixed-marker\",\"agent_type\":\"oso-verifier\",\"agent_transcript_path\":\"%s\",\"stop_hook_active\":false,\"last_assistant_message\":\"oso-handoff: v=1 slice=slice-fixed-marker attempt=2\\nevidence: the named check is green\\nverdict: pass\"}' \
  "payload-native-uuid-7d1a-4d1e-bf19" "$HANDOFF_REPO" "$TEST_HOME/agent-fixed-marker.jsonl")"
unset OSO_STATE_BIN
OSO_AGENT=1 PATH="$HANDOFF_NO_STATE_PATH" run_hook "$HANDOFF_RUNTIME/hooks/publish-subagent-handoff.sh" "$fixed_marker_payload"
assert_after_hook "Codex SubagentStop resolves oso-state from its installed runtime when OSO_STATE_BIN is unset" \
  [ "$hook_stdout" = '{}' ]
fixed_marker_receipt="$(expected_receipt 1 slice-fixed-marker 2 agent-fixed-marker oso-verifier)"
run_handoff "" handoff wait \
  --slice slice-fixed-marker --attempt 2 --agent-id agent-fixed-marker \
  --agent-type oso-verifier --timeout 0
assert_equals "the runtime-fallback hook receipt waits through the fixed OSO_AGENT rail" \
  "rc=0:$fixed_marker_receipt" "rc=$handoff_rc:$handoff_stdout"
run_handoff "" handoff consume \
  --slice slice-fixed-marker --attempt 2 --agent-id agent-fixed-marker \
  --agent-type oso-verifier
assert_equals "the runtime-fallback hook receipt is consumed through the fixed OSO_AGENT rail" \
  "rc=0:$fixed_marker_receipt" "rc=$handoff_rc:$handoff_stdout"
( cd "$HANDOFF_REPO" && oso-state --session 1 clear >/dev/null )

# SubagentStop is a user-level global hook and therefore sees ordinary Codex
# explorers outside oso-code too.  No marker means the call is not this harness's
# and must stay invisible — no receipt, no event and no stderr.
IGNORED_HANDOFF_REPO="$TEST_HOME/ignored-handoff-repo"
mkdir -p "$IGNORED_HANDOFF_REPO"
handoff_events_log="$STATE_DIR/events.jsonl"
events_before_ignored="$(wc -l < "$handoff_events_log" 2>/dev/null || printf 0)"
ignored_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-ignored\",\"agent_id\":\"agent-ignored\",\"agent_type\":\"explorer\",\"agent_transcript_path\":\"%s\",\"stop_hook_active\":false,\"last_assistant_message\":\"ordinary exploration report\"}' \
  "$SESSION" "$IGNORED_HANDOFF_REPO" "$TEST_HOME/agent-ignored.jsonl")"
run_hook "$HANDOFF_HOOK" "$ignored_payload"
events_after_ignored="$(wc -l < "$handoff_events_log" 2>/dev/null || printf 0)"
assert_equals "a non-harness SubagentStop stays globally invisible" \
  "rc=0 stdout={} stderr= events=$events_before_ignored" \
  "rc=$hook_rc stdout=$hook_stdout stderr=$hook_stderr events=$events_after_ignored"

# A marker belongs on the exact first line and carries an explicit envelope
# version.  Near misses are harness attempts, so the hook reports them, but it
# must not publish a receipt that could satisfy the parent.
old_marker_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-old-marker\",\"agent_id\":\"agent-old-marker\",\"agent_type\":\"oso-verifier\",\"last_assistant_message\":\"oso-handoff: slice=slice-old-marker attempt=1\\nverdict: pass\"}' \
  "$SESSION" "$HANDOFF_REPO")"
run_hook "$HANDOFF_HOOK" "$old_marker_payload" 0 \
  'final message must begin with one exact oso-handoff marker'
old_marker_hook_status="$hook_rc:$hook_stdout"
run_handoff "" handoff wait \
  --slice slice-old-marker --attempt 1 --agent-id agent-old-marker \
  --agent-type oso-verifier --timeout 0
assert_equals "a marker without v=1 never publishes a receipt" \
  "hook=0:{} wait=1" "hook=$old_marker_hook_status wait=$handoff_rc"

misplaced_marker_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-misplaced-marker\",\"agent_id\":\"agent-misplaced-marker\",\"agent_type\":\"oso-verifier\",\"last_assistant_message\":\"verdict: pass\\noso-handoff: v=1 slice=slice-misplaced attempt=1\"}' \
  "$SESSION" "$HANDOFF_REPO")"
run_hook "$HANDOFF_HOOK" "$misplaced_marker_payload" 0 \
  'final message must begin with one exact oso-handoff marker'
misplaced_hook_status="$hook_rc:$hook_stdout"
run_handoff "" handoff wait \
  --slice slice-misplaced --attempt 1 --agent-id agent-misplaced-marker \
  --agent-type oso-verifier --timeout 0
assert_equals "a marker below the semantic report never publishes a receipt" \
  "hook=0:{} wait=1" "hook=$misplaced_hook_status wait=$handoff_rc"

basic_slice=slice-basic
basic_attempt=1
basic_agent=agent-basic
basic_type=oso-verifier
basic_report='oso-handoff: v=1 slice=slice-basic attempt=1
evidence: the named check is red
verdict: fail'
basic_receipt="$(expected_receipt hook-basic "$basic_slice" "$basic_attempt" "$basic_agent" "$basic_type")"

run_handoff "$basic_report" handoff publish \
  --slice "$basic_slice" --attempt "$basic_attempt" \
  --agent-id "$basic_agent" --agent-type "$basic_type" --hook-session hook-basic
assert_equals "publishing a handoff receipt succeeds silently" \
  "rc=0 stdout= stderr=" "rc=$handoff_rc stdout=$handoff_stdout stderr=$handoff_stderr"

published_receipt="$(cat "$(handoff_receipt_path "$basic_agent")" 2>/dev/null || true)"
assert_equals "the published file is exactly six provenance lines, never the report verdict" \
  "$basic_receipt" "$published_receipt"

run_handoff "" handoff wait \
  --slice "$basic_slice" --attempt "$basic_attempt" \
  --agent-id "$basic_agent" --agent-type "$basic_type" --timeout 0
assert_equals "wait returns the complete matching receipt without consuming it" \
  "rc=0:$basic_receipt" "rc=$handoff_rc:$handoff_stdout"

run_handoff "" handoff consume \
  --slice "$basic_slice" --attempt "$basic_attempt" \
  --agent-id "$basic_agent" --agent-type "$basic_type"
assert_equals "consume returns that same complete receipt" \
  "rc=0:$basic_receipt" "rc=$handoff_rc:$handoff_stdout"
run_handoff "" handoff consume \
  --slice "$basic_slice" --attempt "$basic_attempt" \
  --agent-id "$basic_agent" --agent-type "$basic_type"
assert_equals "a consumed receipt cannot be consumed a second time" 1 "$handoff_rc"

# The watermark survives consumption.  Without it, an old background result can
# arrive after the retry completed and satisfy a future read under the same slice.
fresh_report='oso-handoff: v=1 slice=slice-stale attempt=2
status: done'
run_handoff "$fresh_report" handoff publish \
  --slice slice-stale --attempt 2 --agent-id agent-stale --agent-type oso-applier \
  --hook-session hook-new
assert_equals "the newer attempt publishes before the stale-report probe" 0 "$handoff_rc"
run_handoff "" handoff consume \
  --slice slice-stale --attempt 2 --agent-id agent-stale --agent-type oso-applier
assert_equals "the newer attempt is consumed before its delayed predecessor arrives" 0 "$handoff_rc"
stale_report='oso-handoff: v=1 slice=slice-stale attempt=1
status: done'
run_handoff "$stale_report" handoff publish \
  --slice slice-stale --attempt 1 --agent-id agent-stale --agent-type oso-applier \
  --hook-session hook-old
assert_equals "a delayed report from an older attempt is rejected after the newer one was consumed" \
  1 "$handoff_rc"

# Every coordinate is part of the match.  Wrong probes must leave the right
# receipt available; otherwise a timeout on one typo destroys the report that
# could have let the operator recover.
identity_report='oso-handoff: v=1 slice=slice-identity attempt=3
verdict: pass'
identity_receipt="$(expected_receipt hook-identity slice-identity 3 agent-identity oso-verifier)"
run_handoff "$identity_report" handoff publish \
  --slice slice-identity --attempt 3 --agent-id agent-identity --agent-type oso-verifier \
  --hook-session hook-identity
assert_equals "the identity fixture publishes" 0 "$handoff_rc"
for wrong_identity in \
  'slice-other|3|agent-identity|oso-verifier' \
  'slice-identity|2|agent-identity|oso-verifier' \
  'slice-identity|3|agent-other|oso-verifier' \
  'slice-identity|3|agent-identity|oso-applier'; do
  IFS='|' read -r wrong_slice wrong_attempt wrong_agent wrong_type <<< "$wrong_identity"
  run_handoff "" handoff wait \
    --slice "$wrong_slice" --attempt "$wrong_attempt" \
    --agent-id "$wrong_agent" --agent-type "$wrong_type" --timeout 0
  assert_equals "a receipt rejects mismatched identity: $wrong_identity" 1 "$handoff_rc"
done
run_handoff "" handoff consume \
  --slice slice-identity --attempt 3 --agent-id agent-identity --agent-type oso-verifier
assert_equals "wrong identity probes never consume the exact receipt" \
  "rc=0:$identity_receipt" "rc=$handoff_rc:$handoff_stdout"

# Two host sessions can complete the same logical slice and attempt at once.
# Agent identity is the storage lane, so neither publisher may overwrite or
# block the other's receipt.
shared_report_a='oso-handoff: v=1 slice=slice-shared attempt=1
verdict: pass'
shared_report_b='oso-handoff: v=1 slice=slice-shared attempt=1
verdict: blocked'
shared_a_out="$TEST_HOME/shared-a-out"
shared_a_err="$TEST_HOME/shared-a-err"
shared_a_rc="$TEST_HOME/shared-a-rc"
shared_b_out="$TEST_HOME/shared-b-out"
shared_b_err="$TEST_HOME/shared-b-err"
shared_b_rc="$TEST_HOME/shared-b-rc"
(
  if printf '%s' "$shared_report_a" | ( cd "$HANDOFF_REPO" && oso-state handoff publish \
       --slice slice-shared --attempt 1 --agent-id agent-shared-a \
       --agent-type oso-verifier --hook-session parent-a ) \
       >"$shared_a_out" 2>"$shared_a_err"; then
    printf '0\n' > "$shared_a_rc"
  else
    printf '%s\n' "$?" > "$shared_a_rc"
  fi
) &
shared_a_pid=$!
(
  if printf '%s' "$shared_report_b" | ( cd "$HANDOFF_REPO" && oso-state handoff publish \
       --slice slice-shared --attempt 1 --agent-id agent-shared-b \
       --agent-type oso-verifier --hook-session parent-b ) \
       >"$shared_b_out" 2>"$shared_b_err"; then
    printf '0\n' > "$shared_b_rc"
  else
    printf '%s\n' "$?" > "$shared_b_rc"
  fi
) &
shared_b_pid=$!
wait "$shared_a_pid"
wait "$shared_b_pid"
shared_publish_status="a=$(cat "$shared_a_rc"):$(cat "$shared_a_out"):$(cat "$shared_a_err") b=$(cat "$shared_b_rc"):$(cat "$shared_b_out"):$(cat "$shared_b_err")"
run_handoff "" handoff consume \
  --slice slice-shared --attempt 1 --agent-id agent-shared-a --agent-type oso-verifier
shared_a_consumed="rc=$handoff_rc:$handoff_stdout"
run_handoff "" handoff consume \
  --slice slice-shared --attempt 1 --agent-id agent-shared-b --agent-type oso-verifier
shared_b_consumed="rc=$handoff_rc:$handoff_stdout"
assert_equals "simultaneous equal slice attempts with different agent ids never collide" \
  "publish=a=0:: b=0:: a=rc=0:$(expected_receipt parent-a slice-shared 1 agent-shared-a oso-verifier) b=rc=0:$(expected_receipt parent-b slice-shared 1 agent-shared-b oso-verifier)" \
  "publish=$shared_publish_status a=$shared_a_consumed b=$shared_b_consumed"

# Missing means wait until the declared bound, then fail.  Seconds are measured
# coarsely for Bash 3.2 portability; a 1-second contract may take either one or
# two displayed ticks, never hang with the rest of the suite behind it.
handoff_files_before_timeout="$(find "$STATE_DIR/.handoffs" -type f -print 2>/dev/null | LC_ALL=C sort || true)"
missing_wait_started="$(date +%s)"
run_handoff "" handoff wait \
  --slice slice-absent --attempt 1 --agent-id agent-absent \
  --agent-type oso-verifier --timeout 1
missing_wait_elapsed=$(( $(date +%s) - missing_wait_started ))
case "$handoff_rc:$missing_wait_elapsed" in
  1:1|1:2) missing_wait_status=bounded ;;
  *) missing_wait_status="rc=$handoff_rc elapsed=${missing_wait_elapsed}s" ;;
esac
assert_equals "an absent handoff stops at its declared timeout" bounded "$missing_wait_status"
handoff_files_after_timeout="$(find "$STATE_DIR/.handoffs" -type f -print 2>/dev/null | LC_ALL=C sort || true)"
assert_equals "a timed-out wait leaves no synthetic receipt or watermark" \
  "$handoff_files_before_timeout" "$handoff_files_after_timeout"

# Start the reader first, then publish.  The reader may return only the complete
# six-line receipt; a partial parse, early failure, or mixed receipt fails.
atomic_slice=slice-atomic
atomic_attempt=7
atomic_agent=agent-atomic
atomic_type=oso-applier
atomic_report='oso-handoff: v=1 slice=slice-atomic attempt=7
status: done'
atomic_receipt="$(expected_receipt hook-atomic "$atomic_slice" "$atomic_attempt" "$atomic_agent" "$atomic_type")"
atomic_reader_started="$TEST_HOME/handoff-reader-started"
atomic_reader_output="$TEST_HOME/handoff-reader-output"
atomic_reader_error="$TEST_HOME/handoff-reader-error"
atomic_reader_rc="$TEST_HOME/handoff-reader-rc"
(
  : > "$atomic_reader_started"
  if ( cd "$HANDOFF_REPO" && oso-state handoff wait \
       --slice "$atomic_slice" --attempt "$atomic_attempt" \
       --agent-id "$atomic_agent" --agent-type "$atomic_type" --timeout 2 \
       > "$atomic_reader_output" 2> "$atomic_reader_error" ); then
    printf '0\n' > "$atomic_reader_rc"
  else
    printf '%s\n' "$?" > "$atomic_reader_rc"
  fi
) &
atomic_reader_pid=$!
while [ ! -f "$atomic_reader_started" ]; do :; done
sleep 0.05
run_handoff "$atomic_report" handoff publish \
  --slice "$atomic_slice" --attempt "$atomic_attempt" \
  --agent-id "$atomic_agent" --agent-type "$atomic_type" --hook-session hook-atomic
atomic_publish_rc="$handoff_rc"
wait "$atomic_reader_pid"
atomic_read_result="$(cat "$atomic_reader_output" 2>/dev/null || true)"
atomic_read_rc="$(cat "$atomic_reader_rc" 2>/dev/null || true)"
atomic_read_stderr="$(cat "$atomic_reader_error" 2>/dev/null || true)"
assert_equals "a reader concurrent with publication sees one complete atomic receipt" \
  "publish=0 read=0 stderr= receipt=$atomic_receipt" \
  "publish=$atomic_publish_rc read=$atomic_read_rc stderr=$atomic_read_stderr receipt=$atomic_read_result"
run_handoff "" handoff consume \
  --slice "$atomic_slice" --attempt "$atomic_attempt" \
  --agent-id "$atomic_agent" --agent-type "$atomic_type"
assert_equals "the concurrent wait left the receipt for one explicit consume" 0 "$handoff_rc"

# Slice/type names use a closed safe alphabet, attempts are positive integers,
# and opaque ids are length/control bounded before hashing.  Agent slashes are
# deliberately safe because no raw id is ever interpolated into a path.
invalid_handoffs=""
run_handoff 'report' handoff publish \
  --slice '../escape' --attempt 1 --agent-id agent --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs traversal-slice:$handoff_rc"
run_handoff 'report' handoff publish \
  --slice slice-safe --attempt 0 --agent-id agent --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs zero-attempt:$handoff_rc"
run_handoff 'report' handoff publish \
  --slice slice-safe --attempt 1x --agent-id agent --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs malformed-attempt:$handoff_rc"
bad_agent_id="$(printf 'agent\nbad')"
run_handoff 'report' handoff publish \
  --slice slice-safe --attempt 1 --agent-id "$bad_agent_id" --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs control-agent:$handoff_rc"
run_handoff 'report' handoff publish \
  --slice slice-safe --attempt 1 --agent-id 'agent=bad' --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs equals-agent:$handoff_rc"
long_agent_id=""
while [ "${#long_agent_id}" -le 256 ]; do long_agent_id="${long_agent_id}abcdefgh"; done
run_handoff 'report' handoff publish \
  --slice slice-safe --attempt 1 --agent-id "$long_agent_id" --agent-type oso-applier --hook-session hook
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs long-agent:$handoff_rc"
run_handoff "" handoff wait \
  --slice '../escape' --attempt 1 --agent-id agent --agent-type oso-applier --timeout 0
[ "$handoff_rc" = 1 ] || invalid_handoffs="$invalid_handoffs traversal-wait:$handoff_rc"
assert_equals "malformed, traversal-shaped, or overlong handoff coordinates fail closed" \
  "" "$invalid_handoffs"

corrupt_report='oso-handoff: v=1 slice=slice-corrupt attempt=1
verdict: pass'
run_handoff "$corrupt_report" handoff publish \
  --slice slice-corrupt --attempt 1 --agent-id agent-corrupt --agent-type oso-verifier \
  --hook-session hook-corrupt
corrupt_receipt="$(handoff_receipt_path agent-corrupt)"
if [ -n "$corrupt_receipt" ]; then
  printf 'version=1\nslice=slice-corrupt\n' > "$corrupt_receipt"
fi
run_handoff "" handoff wait \
  --slice slice-corrupt --attempt 1 --agent-id agent-corrupt \
  --agent-type oso-verifier --timeout 0
corrupt_wait_rc="$handoff_rc"
run_handoff "" handoff consume \
  --slice slice-corrupt --attempt 1 --agent-id agent-corrupt --agent-type oso-verifier
assert_equals "a malformed on-disk receipt fails closed at both read edges" \
  "path=present wait=1 consume=1" \
  "path=$([ -f "$corrupt_receipt" ] && printf present || printf missing) wait=$corrupt_wait_rc consume=$handoff_rc"

# TTL cleanup is observable under the agent lock: old receipts, watermarks and
# interrupted atomic temp files disappear on the next operation for that lane.
ttl_agent=agent-ttl
ttl_key="$(digest_text "$ttl_agent")"
ttl_dir="$STATE_DIR/.handoffs/$(state_key_of "$HANDOFF_REPO")"
ttl_receipt="$ttl_dir/$ttl_key.receipt"
ttl_watermark="$ttl_dir/$ttl_key.watermark"
run_handoff 'oso-handoff: v=1 slice=slice-ttl attempt=1
status: done' handoff publish \
  --slice slice-ttl --attempt 1 --agent-id "$ttl_agent" --agent-type oso-applier \
  --hook-session hook-ttl-one
run_handoff "" handoff consume \
  --slice slice-ttl --attempt 1 --agent-id "$ttl_agent" --agent-type oso-applier
ttl_orphan_receipt="$ttl_dir/.$ttl_key.receipt.orphan"
ttl_orphan_consuming="$ttl_dir/.$ttl_key.consuming.orphan"
: > "$ttl_orphan_receipt"
: > "$ttl_orphan_consuming"
touch -t 200001010000 "$ttl_watermark" "$ttl_orphan_receipt" "$ttl_orphan_consuming"
run_handoff 'oso-handoff: v=1 slice=slice-ttl attempt=2
status: done' handoff publish \
  --slice slice-ttl --attempt 2 --agent-id "$ttl_agent" --agent-type oso-applier \
  --hook-session hook-ttl-two
ttl_watermark_after_publish="$(cat "$ttl_watermark" 2>/dev/null || true)"
ttl_publish_cleanup="$([ "$ttl_watermark_after_publish" = 'version=1
attempt=2' ] && [ ! -e "$ttl_orphan_receipt" ] && [ ! -e "$ttl_orphan_consuming" ] && printf pruned-replaced || printf retained)"
touch -t 200001010000 "$ttl_receipt"
run_handoff "" handoff wait \
  --slice slice-ttl --attempt 2 --agent-id "$ttl_agent" --agent-type oso-applier --timeout 0
assert_equals "TTL cleanup prunes old receipts, watermarks and orphaned atomic temps" \
  "publish=pruned-replaced aged-wait=1 receipt=absent" \
  "publish=$ttl_publish_cleanup aged-wait=$handoff_rc receipt=$([ -e "$ttl_receipt" ] && printf present || printf absent)"

# The repository-wide TTL sweep may opportunistically clean other agent lanes,
# but it cannot touch one whose lock is held.  Once that foreign lock is gone,
# the very next operation should remove its aged two-line watermark.
foreign_agent=agent-foreign-ttl
foreign_key="$(digest_text "$foreign_agent")"
foreign_watermark="$ttl_dir/$foreign_key.watermark"
foreign_lock="$ttl_dir/$foreign_key.lock"
printf 'version=1\nattempt=9\n' > "$foreign_watermark"
touch -t 200001010000 "$foreign_watermark"
mkdir -p "$foreign_lock"
run_handoff 'oso-handoff: v=1 slice=slice-sweeper attempt=1
status: done' handoff publish \
  --slice slice-sweeper --attempt 1 --agent-id agent-sweeper --agent-type oso-applier \
  --hook-session hook-sweeper
foreign_while_locked="$([ -f "$foreign_watermark" ] && [ -d "$foreign_lock" ] && printf preserved || printf touched)"
rmdir "$foreign_lock"
run_handoff "" handoff wait \
  --slice slice-never --attempt 1 --agent-id agent-next-op --agent-type oso-verifier --timeout 0
assert_equals "the TTL sweep preserves a locked foreign lane then prunes it on the next unlocked operation" \
  "locked=preserved next=pruned" \
  "locked=$foreign_while_locked next=$([ ! -e "$foreign_watermark" ] && printf pruned || printf retained)"

# An ancient lock may still belong to a live paused process.  Acquisition is
# bounded at two seconds and must never reclaim or remove somebody else's lock.
lock_agent=agent-lock
lock_key="$(digest_text "$lock_agent")"
lock_dir="$ttl_dir/$lock_key.lock"
mkdir -p "$lock_dir"
touch -t 200001010000 "$lock_dir"
lock_wait_started="$(date +%s)"
run_handoff 'oso-handoff: v=1 slice=slice-lock attempt=1
status: done' handoff publish \
  --slice slice-lock --attempt 1 --agent-id "$lock_agent" --agent-type oso-applier \
  --hook-session hook-lock
lock_wait_elapsed=$(( $(date +%s) - lock_wait_started ))
case "$handoff_rc:$lock_wait_elapsed:$([ -d "$lock_dir" ] && printf retained || printf removed)" in
  1:1:retained|1:2:retained|1:3:retained) lock_wait_status=bounded-retained ;;
  *) lock_wait_status="rc=$handoff_rc elapsed=${lock_wait_elapsed}s lock=$([ -d "$lock_dir" ] && printf retained || printf removed)" ;;
esac
assert_equals "handoff lock acquisition is bounded and never reclaims an old live lock" \
  bounded-retained "$lock_wait_status"
rmdir "$lock_dir"

rm -rf "$STATE_DIR/.handoffs"

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

# --- A6: every deny records what it denied, not just that it denied -----------
rm -f "$events_log"
oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input FutureWriter)" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_logged "a denied tool call writes the tool name into the event record" \
  '"event":"unknown-tool-denied","command":"FutureWriter","session":"'
oso-state --session "$SESSION" clear

rm -f "$events_log"
oso-state --session "$SESSION" set mode=plan
run_hook block-edits-without-slice.sh "$edit_input"
assert_logged "a denied edit writes the target path into the event record" \
  '"event":"edit-denied","command":"/tmp/x.ts","session":"'
oso-state --session "$SESSION" clear

rm -f "$events_log"
oso-state --session "$SESSION" set mode=plan verify_green=false
run_hook block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_logged "a denied commit writes the command it judged" \
  '"event":"commit-denied","command":"git commit -m x","session":"'
assert_logged "every logged event carries the schema version" '"schema":2'
# ADR-0108's own claim — "diagnosable from the log alone: which gate fired, on
# which hook event" — names two fields deny() always passes; nothing before this
# line ever grepped for either, so a future edit that dropped them from deny()
# would have left this suite green.
assert_logged "a deny names the gate script that fired" \
  '"gate":"block-commit-until-green.sh"'
assert_logged "a deny names the hook event it fired on" '"hook_event":"PreToolUse"'
oso-state --session "$SESSION" clear

# A byte cut can land inside a multi-byte character. 119 ASCII bytes put the
# 120-byte bound on the second byte of the two-byte 'é' that follows, so a naive
# cut would keep 'é''s lone lead byte — a half-written character a strict JSONL
# parser rejects — and the bound must back up to the last complete character
# instead.
utf8_boundary_prefix="git commit -m x && echo $(printf 'a%.0s' $(seq 1 95))"
utf8_boundary_command="${utf8_boundary_prefix}é more text past the 120-byte bound"
rm -f "$events_log"
oso-state --session "$SESSION" set mode=plan verify_green=false
run_hook block-commit-until-green.sh "$(bash_input "$utf8_boundary_command")"
logged_command="$(tail -n 1 "$events_log" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
assert_equals "a command past the bound is truncated at a character boundary, not mid-character" \
  "$utf8_boundary_prefix" "$logged_command"
oso-state --session "$SESSION" clear

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
# ADR-0108 scopes `gate`/`hook_event` to deny-shaped calls on purpose — widening
# every line would grow the log's highest-volume lines past the budget the
# decision sized against — so the event verb's own lines must carry neither.
if grep -q '"gate"\|"hook_event"' "$events_log"; then
  echo "FAIL: an event-verb line carries gate or hook_event, which ADR-0108 scopes to denies only"
  fail=$((fail + 1))
else
  echo "ok: event-verb lines keep the unwidened five-field schema-1 shape"
  pass=$((pass + 1))
fi

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

( cd "$ELSEWHERE" && oso-state --session 1 set mode=plan verify_green=true >/dev/null )
assert_equals "the fixed Codex identity arms state before lifecycle cleanup" \
  "written" "$([ -f "$elsewhere_state" ] && echo written || echo missing)"
OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"codex-payload-session"}'
assert_after_hook "Codex SessionEnd cleans fixed-marker state despite a different payload session" \
  [ ! -f "$elsewhere_state" ]

# --- Runtime: SessionEnd clears its own orphaned pending by plan_approval_session,
# never a stranger's (ADR-0107) --------------------------------------------------
# hook_session() is the fixed OSO_AGENT marker on Codex, so the ownership sweep
# above can never match a pending still carrying the real session capture-plan
# recorded under it — the orphan a second, narrower sweep on the real SessionEnd
# payload session exists to reach.
orphan_pending_state="$STATE_DIR/orphan-pending.state"
printf 'mode=plan\nplan_approval=pending\nsession=orphan-real-session\nplan_approval_session=orphan-real-session\n' \
  > "$orphan_pending_state"
OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"unrelated-session"}'
assert_after_hook "SessionEnd for an unrelated session leaves another session's pending alone" \
  [ -f "$orphan_pending_state" ]
OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"orphan-real-session"}'
assert_after_hook "SessionEnd for the session whose plan_approval_session matches drops its own orphaned pending" \
  [ ! -f "$orphan_pending_state" ]

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

# --- SessionStart: only THIS repository's own stale state is worth hearing ---
# Every gate reads state_file_for(cwd) — never the whole state directory — so a
# foreign repository's leftovers arm nothing here; naming one would hand the
# operator a file no remedy run from this cwd could reach. The hook is scoped
# to the one file its own gates actually read: this repository's, keyed by the
# session recorded inside it, since a resumed session keeps that id and a file
# this session armed is one it is resuming, not one it has to be told about.
stale_session_input() { printf '{"session_id":"%s","cwd":"%s"}' "$SESSION" "$REPO_ROOT"; }

# (a) Only a foreign repository's state exists — this repository has armed
# nothing, so nothing is named.
rm -f "$REPO_STATE"
printf 'mode=plan\nsession=other-session\n' > "$STATE_DIR/other-session.state"
assert_allows "SessionStart names nothing when only a foreign repository's state exists" \
  warn-stale-state.sh "$(stale_session_input)"

# (b) THIS repository's own state names another session — the crash/resume
# case the hook exists for — and it must still fire and still name it.
printf 'mode=plan\nsession=other-session\n' > "$REPO_STATE"
mkdir -p "$WORKTREES_DIR/wt-parallel/1"
run_hook warn-stale-state.sh "$(stale_session_input)"
# Which of the dir's entries reached the SessionStart context. The report is
# prose the model reads, so the case asks which names it carries rather than how
# the sentence around them is worded.
named_as_stale=""
for dir_entry in "$(basename "$REPO_STATE")" other-session.state worktrees; do
  case "$hook_stdout" in *"$dir_entry"*) named_as_stale="$named_as_stale $dir_entry" ;; esac
done
named_as_stale="${named_as_stale# }"
assert_after_hook "SessionStart names this repository's own stale state, never a foreign repository's and never a worktree" \
  [ "$named_as_stale" = "$(basename "$REPO_STATE")" ]
assert_equals "Claude stale-state guidance uses its installed slash route" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-code:plan {change}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "stale-state guidance prints a complete session-scoped clear command" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- "--session \\\"$SESSION\\\" clear" >/dev/null; then echo present; else echo missing; fi)"
# (d) The old message claimed a repository-keyed file's flags arm this
# session's gates no matter whose repository it named — false for a foreign
# file, since every gate resolves its own state file from cwd. That
# generalization is gone; what remains is true only because the file named
# above is this session's own.
assert_equals "SessionStart drops the false claim that a repository-keyed file arms this session's gates regardless of whose it is" \
  "" "$(printf '%s' "$hook_stdout" | grep -F 'State is keyed by repository' || true)"

OSO_AGENT=1 run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "Codex stale-state guidance uses the discovered plugin route" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '$oso-code:plan {change}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "Codex stale-state guidance clears the fixed runtime identity" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- '--session \"1\" clear' >/dev/null; then echo present; else echo missing; fi)"

# (c) Whatever the message named (captured above as named_as_stale) must be
# reachable by the remedy it offers: run it exactly as printed, from this
# repository, and confirm every file the message actually named is now gone —
# not just the one file this fix happens to scope it to. Against the old sweep
# this catches the real defect directly: a message naming a foreign file too
# would still only ever clear this repository's own, leaving the foreign name
# standing though the message said the remedy "drops it".
( cd "$REPO_ROOT" && oso-state --session "$SESSION" clear )
remedy_missed=""
for dir_entry in $named_as_stale; do
  [ ! -e "$STATE_DIR/$dir_entry" ] || remedy_missed="$remedy_missed $dir_entry"
done
if [ -z "$remedy_missed" ]; then
  echo "ok: the remedy the message offers reaches every file the message named"; pass=$((pass + 1))
else
  echo "FAIL: the remedy the message offers left${remedy_missed} standing though the message named it"; fail=$((fail + 1))
fi

rm -f "$STATE_DIR/other-session.state"
printf 'mode=plan\nsession=%s\n' "$SESSION" > "$REPO_STATE"
assert_allows "SessionStart says nothing when the only state is this session's" \
  warn-stale-state.sh "$(stale_session_input)"

# Fail-open on a machine that has never armed a session: no state dir at all.
# HOME is what the state path hangs off, so the case moves it rather than
# deleting the directory every later case reads.
HOME="$TEST_HOME/never-armed"
assert_allows "SessionStart says nothing where there is no state dir" \
  warn-stale-state.sh "$(stale_session_input)"
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
# 350 is a budget, not a round number: one command head, which lib.sh caps at
# LOG_COMMAND_HEAD_BYTES=120, plus one envelope — the ts, event, session, client
# and schema fields run about 115 bytes with this suite's session name and longer
# in a real session, where the id is a uuid — plus the gate and hook_event fields
# a deny record carries (A6), up to "block-edits-without-slice.sh" and
# "PreToolUse", the longest either family has — plus room for the escapes a head
# can add. Over it, something wrote more than a head, which is how a whole 3 KB
# command line would land in the log. Nor is any of it safe to leave
# world-readable while the state files are not.
longest_event=0
while IFS= read -r event_line; do
  if [ "${#event_line}" -gt "$longest_event" ]; then
    longest_event="${#event_line}"
  fi
done < "$events_log"
if [ "$longest_event" -le 350 ]; then
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
  case "$commit_output" in
    *"oso-state --session $SESSION clear"*)
      echo "ok: an unreadable state file's remedy is the exact oso-state call that clears it"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: an unreadable state file's remedy is not a runnable oso-state call — got: ${commit_output:-<empty>}"; fail=$((fail + 1)) ;;
  esac
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
VERIFY_INSTALLED_ROOT="$HOME/.claude/plugins/cache/oso-code/oso-code/verify-fixture"
mkdir -p "$VERIFY_INSTALLED_ROOT/hooks"
printf '%s\n' \
  '#!/bin/sh' \
  'cat >/dev/null' \
  '[ "${OSO_AGENT:-}" = 1 ] || exit 0' \
  'printf '\''{"hookSpecificOutput":{"permissionDecision":"deny"}}\n'\''' \
  > "$VERIFY_INSTALLED_ROOT/hooks/block-commit-until-green.sh"
chmod +x "$VERIFY_INSTALLED_ROOT/hooks/block-commit-until-green.sh"

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
assert_equals "verify.sh exports the agent marker when probing the installed commit gate" \
  "ok" "$(report_line_kind "$report_without_marker" 'installed hook denies red commit (e2e)')"
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

# --- Engram repair helper: static safety rails, no real HOME writes -----------
REPAIR_ENGRAM_CODEX_SH="$REPO_ROOT/bootstrap/repair-engram-codex.sh"
REPAIR_CONFIG_MARKER_START="# oso-code:start"
REPAIR_CONFIG_MARKER_END="# oso-code:end"
repair_engram_codex_surface_status() {
  local script="$1" missing="" phrase syntax_output
  [ -f "$script" ] || { printf missing-helper; return; }
  [ -x "$script" ] || { printf not-executable; return; }
  if ! syntax_output="$(bash -n "$script" 2>&1)"; then
    printf 'syntax-error:%s' "$(printf '%s' "$syntax_output" | tr '\n' ' ')"
    return
  fi
  while IFS= read -r phrase; do
    [ -n "$phrase" ] || continue
    grep -Fq -- "$phrase" "$script" \
      || missing="$missing [$phrase]"
  done <<'REPAIR_ENGRAM_SURFACE_TABLE'
set -Eeuo pipefail
ENGRAM_RELEASE_VERSION=1.20.0
ENGRAM_DATA_DIR="${ENGRAM_DATA_DIR:-$HOME/.engram}"
ENGRAM_BIN="${ENGRAM_BIN:-$HOME/.local/bin/engram}"
ENGRAM_DB="$ENGRAM_DATA_DIR/engram.db"
backup parent must be outside this repository
pgrep -x codex
pkill -TERM -x engram
.backup
"$ENGRAM_BIN" export
checksums.txt
selected-checksums.txt
sha256sum -c
engram_${ENGRAM_RELEASE_VERSION}_linux_${ENGRAM_RELEASE_ARCH}.tar.gz
mv -f "$STAGED_INSTALL" "$ENGRAM_BIN"
doctor --json
setup codex
config.before-engram-pointer-normalize.toml
codex sandbox -P oso -- /bin/true
verify-codex.sh
restart Codex now
REPAIR_ENGRAM_SURFACE_TABLE
  if grep -Eq 'rm -rf --? "\$ENGRAM_(DATA_DIR|DB)"|rm -rf --? \$ENGRAM_(DATA_DIR|DB)' "$script"; then
    printf destructive-live-engram-data
  elif [ -n "$missing" ]; then
    printf 'missing:%s' "$missing"
  else
    printf complete
  fi
}

write_repair_codex_config() {
  local fixture_home="$1" shape="$2"
  CODEX_HOME="$fixture_home/.codex" "$REPAIR_CONFIG_WRITER" "$shape"
}

run_repair_sequence_fixture() {
  local fixture_home="$1" calls="$2" output="$3" sequence_root
  sequence_root="${REPAIR_SEQUENCE_TEST_ROOT:-$TEST_HOME}"
  if (
    HOME="$fixture_home"
    CODEX_HOME="$fixture_home/.codex"
    ENGRAM_DATA_DIR="$fixture_home/.engram"
    ENGRAM_BIN="$REPAIR_CODEX_SHIMS/engram"
    PATH="$REPAIR_CODEX_SHIMS:$PATH"
    OSO_REPAIR_CALLS="$calls"
    OSO_REPAIR_CONFIG_WRITER="$REPAIR_CONFIG_WRITER"
    OSO_REPAIR_ENGRAM_CODEX_TEST_RUN_REPAIRED=1
    OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT="$sequence_root"
    OSO_REPAIR_ENGRAM_CODEX_TEST_BACKUP_DIR="$fixture_home/backup"
    export HOME CODEX_HOME ENGRAM_DATA_DIR ENGRAM_BIN PATH
    export OSO_REPAIR_CALLS OSO_REPAIR_CONFIG_SHAPE OSO_REPAIR_CONFIG_WRITER
    export OSO_REPAIR_ENGRAM_CODEX_TEST_RUN_REPAIRED
    export OSO_REPAIR_ENGRAM_CODEX_TEST_ROOT OSO_REPAIR_ENGRAM_CODEX_TEST_BACKUP_DIR
    mkdir -p "$ENGRAM_DATA_DIR"
    "$REPAIR_ENGRAM_CODEX_SH"
  ) > "$output" 2>&1; then
    REPAIR_NORMALIZE_RC=0
  else
    REPAIR_NORMALIZE_RC=$?
  fi
  REPAIR_NORMALIZE_LOG="$(cat "$output")"
}

repair_setup_validation_order() {
  awk '
    $0 == "engram:setup codex" { setup_line = NR }
    $0 == "codex:sandbox -P oso -- /bin/true" { validation_line = NR }
    END {
      if (setup_line > 0 && validation_line > setup_line) print "setup-before-validation"
      else printf "setup=%d validation=%d", setup_line, validation_line
    }
  ' "$1"
}

repair_pointer_status() {
  local fixture_home="$1" config_dir="$1/.codex"
  awk \
    -v start_marker="$REPAIR_CONFIG_MARKER_START" \
    -v model_line="model_instructions_file = \"$config_dir/engram-instructions.md\"" \
    -v compact_line="experimental_compact_prompt_file = \"$config_dir/engram-compact-prompt.md\"" '
    $0 == start_marker { start = NR }
    $0 == model_line { model_rows++; model_line_number = NR }
    $0 == compact_line { compact_rows++; compact_line_number = NR }
    END {
      if (model_rows == 1 && compact_rows == 1 &&
          model_line_number < start && compact_line_number < start) print "before-once"
      else printf "model=%d:%d compact=%d:%d start=%d",
        model_rows, model_line_number, compact_rows, compact_line_number, start
    }
  ' "$config_dir/config.toml"
}

repair_managed_region_body() {
  awk -v start_marker="$REPAIR_CONFIG_MARKER_START" -v end_marker="$REPAIR_CONFIG_MARKER_END" '
    $0 == start_marker { inside = 1; next }
    $0 == end_marker { inside = 0; exit }
    inside { print }
  ' "$1/.codex/config.toml"
}

repair_engram_codex_behavior_status() {
  local calls output fixture_home before after expected_region backup_file safe_root external_config_dir
  REPAIR_CODEX_SHIMS="$TEST_HOME/repair-codex-shims"
  REPAIR_CONFIG_WRITER="$REPAIR_CODEX_SHIMS/write-config"
  calls="$TEST_HOME/repair-codex-calls"
  output="$TEST_HOME/repair-codex-output"
  rm -rf "$REPAIR_CODEX_SHIMS" "$TEST_HOME/repair-normalize-home" \
    "$TEST_HOME/repair-duplicate-home" "$TEST_HOME/repair-malformed-home" \
    "$TEST_HOME/repair-contained-root" "$TEST_HOME/repair-external-target" \
    "$TEST_HOME/repair-contained-file-root" "$TEST_HOME/repair-external-config-target"
  mkdir -p "$REPAIR_CODEX_SHIMS"
  cat > "$REPAIR_CONFIG_WRITER" <<'REPAIR_CONFIG_WRITER_SCRIPT'
#!/bin/sh
set -eu
shape=$1
config_dir="${CODEX_HOME:?}"
config="$config_dir/config.toml"
mkdir -p "$config_dir"
case "$shape" in
  divergent)
    printf '%s\n' \
      'model = "operator-model"' \
      '# oso-code:start' \
      "model_instructions_file = \"$config_dir/engram-instructions.md\"" \
      "experimental_compact_prompt_file = \"$config_dir/engram-compact-prompt.md\"" \
      '[agents]' \
      'answer = "managed"' \
      '# oso-code:end' \
      '' \
      '[mcp_servers.engram]' \
      'command = "engram"' > "$config"
    ;;
  duplicate)
    printf '%s\n' \
      "model_instructions_file = \"$config_dir/engram-instructions.md\"" \
      '# oso-code:start' \
      "model_instructions_file = \"$config_dir/engram-instructions.md\"" \
      "experimental_compact_prompt_file = \"$config_dir/engram-compact-prompt.md\"" \
      '[agents]' \
      'answer = "managed"' \
      '# oso-code:end' > "$config"
    ;;
  malformed)
    printf '%s\n' \
      '# oso-code:start' \
      "model_instructions_file = \"$config_dir/engram-instructions.md\"" \
      "experimental_compact_prompt_file = \"$config_dir/engram-compact-prompt.md\"" \
      '# oso-code:start' \
      '[agents]' \
      '# oso-code:end' > "$config"
    ;;
  *)
    exit 63
    ;;
esac
REPAIR_CONFIG_WRITER_SCRIPT
  chmod +x "$REPAIR_CONFIG_WRITER"
  cat > "$REPAIR_CODEX_SHIMS/engram" <<'REPAIR_ENGRAM_SHIM'
#!/bin/sh
set -eu
printf 'engram:%s\n' "$*" >> "$OSO_REPAIR_CALLS"
case "$*" in
  version)
    printf 'engram 1.20.0\n'
    ;;
  "doctor --json")
    printf '{}\n'
    ;;
  stats)
    printf 'observations: 0\n'
    ;;
  "setup codex")
    "${OSO_REPAIR_CONFIG_WRITER:?}" "${OSO_REPAIR_CONFIG_SHAPE:?}"
    ;;
  *)
    exit 64
    ;;
esac
REPAIR_ENGRAM_SHIM
  chmod +x "$REPAIR_CODEX_SHIMS/engram"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''codex:%s\n'\'' "$*" >> "$OSO_REPAIR_CALLS"' \
    '[ "$*" = "sandbox -P oso -- /bin/true" ] || exit 64' \
    'grep -Fqx "engram:setup codex" "$OSO_REPAIR_CALLS" || exit 68' \
    '[ -f "${CODEX_HOME:?}/config.toml" ] || exit 65' \
    'grep -Fq "model_instructions_file = " "$CODEX_HOME/config.toml" || exit 66' \
    'grep -Fq "experimental_compact_prompt_file = " "$CODEX_HOME/config.toml" || exit 67' \
    > "$REPAIR_CODEX_SHIMS/codex"
  chmod +x "$REPAIR_CODEX_SHIMS/codex"

  fixture_home="$TEST_HOME/repair-normalize-home"
  : > "$calls"
  OSO_REPAIR_CONFIG_SHAPE=divergent run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -eq 0 ] || { printf 'first-run:%s' "$REPAIR_NORMALIZE_LOG"; return; }
  [ "$(repair_setup_validation_order "$calls")" = setup-before-validation ] ||
    { printf 'call-order:%s' "$(repair_setup_validation_order "$calls")"; return; }
  [ "$(repair_pointer_status "$fixture_home")" = before-once ] ||
    { printf 'pointer-status:%s' "$(repair_pointer_status "$fixture_home")"; return; }
  expected_region="$(printf '%s\n' '[agents]' 'answer = "managed"')"
  [ "$(repair_managed_region_body "$fixture_home")" = "$expected_region" ] ||
    { printf 'managed-region:%s' "$(repair_managed_region_body "$fixture_home")"; return; }
  backup_file="$fixture_home/backup/codex/config.before-engram-pointer-normalize.toml"
  [ -f "$backup_file" ] || { printf missing-pre-normalize-backup; return; }
  grep -Fq "model_instructions_file = \"$fixture_home/.codex/engram-instructions.md\"" "$backup_file" ||
    { printf backup-did-not-retain-divergent-config; return; }
  before="$(cat "$fixture_home/.codex/config.toml")"
  : > "$calls"
  OSO_REPAIR_CONFIG_SHAPE=divergent run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -eq 0 ] || { printf 'second-run:%s' "$REPAIR_NORMALIZE_LOG"; return; }
  [ "$(repair_setup_validation_order "$calls")" = setup-before-validation ] ||
    { printf 'second-call-order:%s' "$(repair_setup_validation_order "$calls")"; return; }
  after="$(cat "$fixture_home/.codex/config.toml")"
  [ "$before" = "$after" ] || { printf second-run-changed-config; return; }

  fixture_home="$TEST_HOME/repair-duplicate-home"
  write_repair_codex_config "$fixture_home" duplicate
  before="$(cat "$fixture_home/.codex/config.toml")"
  : > "$calls"
  OSO_REPAIR_CONFIG_SHAPE=duplicate run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -ne 0 ] || { printf duplicate-ownership-accepted; return; }
  grep -Fqx 'engram:setup codex' "$calls" ||
    { printf duplicate-setup-not-run; return; }
  ! grep -Fqx 'codex:sandbox -P oso -- /bin/true' "$calls" ||
    { printf duplicate-config-validated; return; }
  [ "$before" = "$(cat "$fixture_home/.codex/config.toml")" ] ||
    { printf duplicate-ownership-replaced-config; return; }

  fixture_home="$TEST_HOME/repair-malformed-home"
  write_repair_codex_config "$fixture_home" malformed
  before="$(cat "$fixture_home/.codex/config.toml")"
  : > "$calls"
  OSO_REPAIR_CONFIG_SHAPE=malformed run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -ne 0 ] || { printf malformed-markers-accepted; return; }
  grep -Fqx 'engram:setup codex' "$calls" ||
    { printf malformed-setup-not-run; return; }
  ! grep -Fqx 'codex:sandbox -P oso -- /bin/true' "$calls" ||
    { printf malformed-config-validated; return; }
  [ "$before" = "$(cat "$fixture_home/.codex/config.toml")" ] ||
    { printf malformed-markers-replaced-config; return; }

  safe_root="$TEST_HOME/repair-contained-root"
  fixture_home="$safe_root/repair-symlink-home"
  external_config_dir="$TEST_HOME/repair-external-target"
  mkdir -p "$fixture_home" "$external_config_dir"
  printf 'external sentinel\n' > "$external_config_dir/config.toml"
  ln -s "$external_config_dir" "$fixture_home/.codex"
  : > "$calls"
  REPAIR_SEQUENCE_TEST_ROOT="$safe_root" \
    OSO_REPAIR_CONFIG_SHAPE=divergent \
    run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -ne 0 ] || { printf symlink-escape-accepted; return; }
  [ ! -s "$calls" ] || { printf symlink-escape-reached-production; return; }
  [ "$(cat "$external_config_dir/config.toml")" = "external sentinel" ] ||
    { printf symlink-escape-modified-sentinel; return; }

  safe_root="$TEST_HOME/repair-contained-file-root"
  fixture_home="$safe_root/repair-config-symlink-home"
  external_config_dir="$TEST_HOME/repair-external-config-target"
  mkdir -p "$fixture_home/.codex" "$external_config_dir"
  printf 'external config sentinel\n' > "$external_config_dir/config.toml"
  ln -s "$external_config_dir/config.toml" "$fixture_home/.codex/config.toml"
  : > "$calls"
  REPAIR_SEQUENCE_TEST_ROOT="$safe_root" \
    OSO_REPAIR_CONFIG_SHAPE=divergent \
    run_repair_sequence_fixture "$fixture_home" "$calls" "$output"
  [ "$REPAIR_NORMALIZE_RC" -ne 0 ] || { printf config-symlink-escape-accepted; return; }
  [ ! -s "$calls" ] || { printf config-symlink-escape-reached-production; return; }
  [ "$(cat "$external_config_dir/config.toml")" = "external config sentinel" ] ||
    { printf config-symlink-escape-modified-sentinel; return; }

  printf complete
}

repair_engram_codex_contract_status() {
  local surface_status behavior_status
  surface_status="$(repair_engram_codex_surface_status "$REPAIR_ENGRAM_CODEX_SH")"
  [ "$surface_status" = complete ] || { printf 'surface:%s' "$surface_status"; return; }
  behavior_status="$(repair_engram_codex_behavior_status)"
  [ "$behavior_status" = complete ] || { printf 'behavior:%s' "$behavior_status"; return; }
  printf complete
}

assert_equals "repair-engram-codex shell surface is syntax-valid and contains fail-safe backup/checksum/setup/verification rails" \
  complete "$(repair_engram_codex_contract_status)"

# --- Codex installer: an isolated release install, not a real user mutation ---
# S11 owns user-wide Codex state, which makes a source-only assertion too weak:
# the test runs the shipped installer with HOME, CODEX_HOME and every external
# client redirected into this fixture. The shims model only the public contracts
# the installer is allowed to rely on. An unexpected client spelling is a hard
# failure, so a test cannot stay green when the implementation quietly changes
# the command it would run on an operator's machine.
INSTALL_CODEX_SH="$REPO_ROOT/bootstrap/install-codex.sh"
CODEX_INSTALL_SHIMS="$TEST_HOME/codex-install-shims"
CODEX_INSTALL_CALLS="$TEST_HOME/codex-install-calls"
CODEX_INSTALL_VERSION="$TEST_HOME/codex-install-version"
CODEX_INSTALL_OUTPUT="$TEST_HOME/codex-install-output"
CODEX_IMPECCABLE_SOURCE="$TEST_HOME/codex-install-impeccable"
mkdir -p "$CODEX_INSTALL_SHIMS"

printf '%s\n' \
  '#!/bin/sh' \
  'printf '\''codex:%s\n'\'' "$*" >> "$OSO_TEST_CALLS"' \
  'case "$*" in' \
  '  --version) printf '\''codex-cli %s\n'\'' "$(cat "$OSO_TEST_CODEX_VERSION")" ;;' \
  '  "sandbox -P oso -- /bin/true") [ "${OSO_TEST_CONFIG_FAIL:-}" != 1 ] || exit 65 ;;' \
  '  "plugin marketplace list --json")' \
  '    if [ "${OSO_TEST_ENGRAM_REGISTERED:-}" = 1 ]; then printf '\''{"marketplaces":[{"name":"engram"}]}\n'\''' \
  '    else printf '\''{"marketplaces":[]}\n'\''; fi ;;' \
  '  "plugin marketplace remove engram") rm -rf "${CODEX_HOME:-$HOME/.codex}/.tmp/marketplaces/engram" ;;' \
  '  "plugin marketplace add "*) exit 0 ;;' \
  '  "plugin add oso-code@oso-code --json") exit 0 ;;' \
  '  *) printf '\''unexpected codex call: %s\n'\'' "$*" >&2; exit 64 ;;' \
  'esac' > "$CODEX_INSTALL_SHIMS/codex"

printf '%s\n' \
  '#!/bin/sh' \
  'printf '\''npm:%s\n'\'' "$*" >> "$OSO_TEST_CALLS"' \
  'case "$*" in' \
  '  "install --global @openai/codex@0.146.0") printf '\''0.146.0\n'\'' > "$OSO_TEST_CODEX_VERSION" ;;' \
  '  *) printf '\''unexpected npm call: %s\n'\'' "$*" >&2; exit 64 ;;' \
  'esac' > "$CODEX_INSTALL_SHIMS/npm"

# The real `engram setup codex` owns these two files, its top-level pointers and
# its MCP table. This shim deliberately writes all four instead of letting the
# oso installer counterfeit Engram's payload. Like Engram 1.20.0, every setup
# removes both root pointers and reinserts them before the first TOML table. On
# reinstall that table is inside oso-code's managed region, reproducing the
# relocation that deleted both pointers in 0.18.3.
printf '%s\n' \
  '#!/bin/sh' \
  'printf '\''engram:%s\n'\'' "$*" >> "$OSO_TEST_CALLS"' \
  '[ "$*" = "setup codex" ] || { printf '\''unexpected engram call: %s\n'\'' "$*" >&2; exit 64; }' \
  'codex_dir=${CODEX_HOME:-$HOME/.codex}' \
  'config=$codex_dir/config.toml' \
  'mkdir -p "$codex_dir"' \
  'printf '\''# fixture Engram memory protocol\n### AFTER COMPACTION\n'\'' > "$codex_dir/engram-instructions.md"' \
  'printf '\''Save durable memory before compaction.\n'\'' > "$codex_dir/engram-compact-prompt.md"' \
  'touch "$config"' \
  'tmp=$config.engram-tmp' \
  'awk -v instruction="$codex_dir/engram-instructions.md" -v compact="$codex_dir/engram-compact-prompt.md" '\''' \
  '  function emit() { print "model_instructions_file = \"" instruction "\""; print "experimental_compact_prompt_file = \"" compact "\""; print ""; inserted=1 }' \
  '  /^model_instructions_file[[:space:]]*=/ || /^experimental_compact_prompt_file[[:space:]]*=/ { next }' \
  '  !inserted && !multiline && /^\[/ { emit() }' \
  '  { print; copy=$0; triples=gsub(/"""/, "", copy); if (triples % 2 == 1) multiline=!multiline }' \
  '  END { if (!inserted) emit() }' \
  '  '\'' "$config" > "$tmp" && mv "$tmp" "$config"' \
  'if ! grep -F '\''[mcp_servers.engram]'\'' "$config" >/dev/null 2>&1; then' \
  '  printf '\''\n[mcp_servers.engram]\ncommand = "engram"\nargs = ["mcp", "--tools=agent"]\n'\'' >> "$config"' \
  'fi' > "$CODEX_INSTALL_SHIMS/engram"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$CODEX_INSTALL_SHIMS/fallow-mcp"
chmod +x "$CODEX_INSTALL_SHIMS/codex" "$CODEX_INSTALL_SHIMS/npm" \
  "$CODEX_INSTALL_SHIMS/engram" "$CODEX_INSTALL_SHIMS/fallow-mcp"

# The compatibility image intentionally contains Bash 3.2 and little else.
# The native suite uses the real Python JSON parser; in that minimal image this
# fixture-only shim preserves the installer's public dependency check so the
# remainder of the shell flow can still be exercised by the old interpreter.
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' \
    '#!/bin/sh' \
    'if [ "$1" = "-m" ] && [ "$2" = "json.tool" ] && [ -f "$3" ]; then exit 0; fi' \
    '# The only baseline -c call asks whether Engram is registered; this fixture inventory is empty.' \
    'if [ "$1" = "-c" ]; then cat >/dev/null; exit 1; fi' \
    'exit 64' > "$CODEX_INSTALL_SHIMS/python3"
  chmod +x "$CODEX_INSTALL_SHIMS/python3"
fi

write_codex_impeccable_fixture "$CODEX_IMPECCABLE_SOURCE" \
  'name: impeccable' 'version: 4.0.2'

write_codex_install_personal_state() {
  local fixture_home="$1"
  mkdir -p "$fixture_home/.codex" "$fixture_home/.agents/plugins"
  printf '%s\n' \
    'model = "operator-model"' \
    'personal_key = "leave-this-alone"' \
    'developer_instructions = """' \
    'Keep this operator prose byte-for-byte.' \
    '[This is prose, not a TOML table]' \
    '[features]' \
    'default_permissions = "operator prose, not a root key"' \
    '# oso-code:start' \
    'operator marker-looking prose must survive' \
    '# oso-code:end' \
    '"""' \
    '' \
    '[projects."/workspace/personal"]' \
    'trust_level = "trusted"' \
    '' \
    '[mcp_servers.personal]' \
    'command = "personal-mcp"' > "$fixture_home/.codex/config.toml"
  mkdir -p "$fixture_home/.codex/agents"
  printf '%s\n' \
    'name = "personal-agent"' \
    'description = "operator-owned role"' > "$fixture_home/.codex/agents/personal.toml"
  printf '%s\n' \
    '# Personal Codex rules' \
    '' \
    'This paragraph belongs to the operator.' > "$fixture_home/.codex/AGENTS.md"
  printf '%s\n' \
    '{' \
    '  "$schema": "https://example.test/personal-marketplace.schema.json",' \
    '  "name": "personal",' \
    '  "description": "operator-owned metadata",' \
    '  "sentinel": "keep-me",' \
    '  "plugins": [' \
    '    {' \
    '      "name": "unrelated",' \
    '      "source": "./plugins/unrelated",' \
    '      "description": "operator plugin"' \
    '    }' \
    '  ]' \
    '}' > "$fixture_home/.agents/plugins/marketplace.json"
}

# Codex writes this unrelated feature on a normal authenticated installation.
# oso-code owns two keys in the same TOML table, not the whole table: the merge
# must retain the operator key while still producing one valid [features]
# declaration. Keep this fixture free of marker-looking prose so exact textual
# counts below are also exact TOML counts.
write_codex_install_existing_features_state() {
  local fixture_home="$1"
  mkdir -p "$fixture_home/.codex"
  printf '%s\n' \
    'model = "operator-model"' \
    '' \
    '[features]' \
    'prevent_idle_sleep = true' \
    '' \
    '[projects."/workspace/personal"]' \
    'trust_level = "trusted"' > "$fixture_home/.codex/config.toml"
}

write_official_engram_marketplace_cache() {
  local fixture_home="$1" remote="${2:-https://github.com/Gentleman-Programming/engram.git}"
  local cache="$fixture_home/.codex/.tmp/marketplaces/engram"
  mkdir -p "$cache/.agents/plugins" "$cache/plugin/codex/.codex-plugin"
  cat > "$cache/.agents/plugins/marketplace.json" <<'JSON'
{
  "name": "engram",
  "interface": { "displayName": "Engram Persistent Memory" },
  "plugins": [
    {
      "name": "engram",
      "source": { "source": "local", "path": "./plugin/codex" },
      "policy": { "installation": "INSTALLED_BY_DEFAULT" }
    }
  ]
}
JSON
  printf '%s\n' '{"name":"engram","version":"0.1.1"}' \
    > "$cache/plugin/codex/.codex-plugin/plugin.json"
  git -C "$cache" init -q
  git -C "$cache" remote add origin "$remote"
  git -C "$cache" add .
  git -C "$cache" -c user.name=Fixture -c user.email=fixture@example.test \
    commit -qm fixture
  git -C "$cache" update-ref refs/remotes/origin/main HEAD
  git -C "$cache" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
}

# Results land in CODEX_INSTALL_RC and CODEX_INSTALL_LOG. Keeping the call out of
# a command substitution matters: the installer may replace whole directories,
# and every assertion must observe the same fixture tree it ran against.
run_codex_install() {
  local fixture_home="$1" failure_step="${2:-}" installer="${3:-$INSTALL_CODEX_SH}"
  : > "$CODEX_INSTALL_CALLS"
  if HOME="$fixture_home" \
    CODEX_HOME="$fixture_home/.codex" \
    PATH="$CODEX_INSTALL_SHIMS:$PATH" \
    OSO_TEST_CALLS="$CODEX_INSTALL_CALLS" \
    OSO_TEST_CODEX_VERSION="$CODEX_INSTALL_VERSION" \
    OSO_TEST_CONFIG_FAIL="${OSO_TEST_CONFIG_FAIL:-}" \
    OSO_TEST_ENGRAM_REGISTERED="${OSO_TEST_ENGRAM_REGISTERED:-}" \
    OSO_HOOK_HASHES_FILE="${OSO_HOOK_HASHES_FILE:-}" \
    OSO_IMPECCABLE_SOURCE="$CODEX_IMPECCABLE_SOURCE" \
    OSO_INSTALL_FAIL_AFTER="$failure_step" \
    bash "$installer" --yes --no-git-hook > "$CODEX_INSTALL_OUTPUT" 2>&1; then
    CODEX_INSTALL_RC=0
  else
    CODEX_INSTALL_RC=$?
  fi
  CODEX_INSTALL_LOG="$(cat "$CODEX_INSTALL_OUTPUT")"
}

run_codex_install_with_git_hook() {
  local fixture_home="$1" installer="$2" failure_step="${3:-}"
  : > "$CODEX_INSTALL_CALLS"
  if HOME="$fixture_home" \
    CODEX_HOME="$fixture_home/.codex" \
    PATH="$CODEX_INSTALL_SHIMS:$PATH" \
    OSO_TEST_CALLS="$CODEX_INSTALL_CALLS" \
    OSO_TEST_CODEX_VERSION="$CODEX_INSTALL_VERSION" \
    OSO_TEST_ENGRAM_REGISTERED="${OSO_TEST_ENGRAM_REGISTERED:-}" \
    OSO_IMPECCABLE_SOURCE="$CODEX_IMPECCABLE_SOURCE" \
    OSO_INSTALL_FAIL_AFTER="$failure_step" \
    bash "$installer" --yes --no-impeccable > "$CODEX_INSTALL_OUTPUT" 2>&1; then
    CODEX_INSTALL_RC=0
  else
    CODEX_INSTALL_RC=$?
  fi
  CODEX_INSTALL_LOG="$(cat "$CODEX_INSTALL_OUTPUT")"
}

codex_install_log_class() {
  local label="$1" pattern="$2"
  if printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Eq "$pattern"; then
    printf '%s' "$label"
  else
    printf 'wrong reason: %s' "$CODEX_INSTALL_LOG"
  fi
}

file_sha256() {
  local digest
  digest="$({ sha256sum "$1" 2>/dev/null || shasum -a 256 "$1" 2>/dev/null; })"
  printf '%s' "${digest%% *}"
}

install_file_snapshot() {
  local fixture_home="$1" path rel digest
  for path in \
    "$fixture_home/.codex" \
    "$fixture_home/.agents" \
    "$fixture_home/.local/share/oso-code" \
    "$fixture_home/.local/state/oso-code/impeccable-opt-out"; do
    [ -e "$path" ] || continue
    find "$path" \( -type f -o -type l \) -print
  done | LC_ALL=C sort | while IFS= read -r path; do
    rel="${path#$fixture_home/}"
    if [ -L "$path" ]; then
      printf 'link %s -> %s\n' "$rel" "$(readlink "$path")"
    else
      digest="$(file_sha256 "$path")"
      printf 'file %s %s\n' "$rel" "$digest"
    fi
  done
}

# Sourcing is the slice's inspection/test surface. It exposes functions, parses
# no inherited positional flags and performs no installation as a side effect.
CODEX_SOURCE_HOME="$TEST_HOME/codex-source-home"
mkdir -p "$CODEX_SOURCE_HOME"
source_probe="$({
  set -- inherited-flag
  HOME="$CODEX_SOURCE_HOME"
  CODEX_HOME="$CODEX_SOURCE_HOME/.codex"
  PATH="$CODEX_INSTALL_SHIMS:$PATH"
  . "$INSTALL_CODEX_SH"
  declare -F main >/dev/null && printf 'main exposed'
} 2>&1)" || source_probe="source failed: $source_probe"
assert_equals "sourcing install-codex exposes main without running it" \
  "main exposed" "$source_probe"
assert_equals "sourcing install-codex leaves the isolated HOME untouched" \
  "absent" "$([ -e "$CODEX_SOURCE_HOME/.codex" ] || [ -e "$CODEX_SOURCE_HOME/.agents" ] && echo mutated || echo absent)"

. "$REPO_ROOT/bootstrap/lib/codex-managed-config.sh"
CODEX_CARGO_FALLOW_HOME="$TEST_HOME/codex-cargo-fallow-home"
CODEX_NO_FALLOW_PATH="$TEST_HOME/no-fallow-path"
mkdir -p "$CODEX_CARGO_FALLOW_HOME/.cargo/bin" "$CODEX_NO_FALLOW_PATH"
ln -s "$(command -v cat)" "$CODEX_NO_FALLOW_PATH/cat"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp"
chmod +x "$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp"
cargo_fallow_config="$(
  PATH="$CODEX_NO_FALLOW_PATH" render_codex_managed_config \
    "$CODEX_CARGO_FALLOW_HOME" \
    "$CODEX_CARGO_FALLOW_HOME/.local/share/oso-code/runtime"
)"
assert_equals "Codex config resolves a Cargo-home fallow binary outside PATH" \
  "1" "$(printf '%s\n' "$cargo_fallow_config" |
    grep -Fxc "command = \"$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp\"" || true)"

CODEX_DECLINE_HOME="$TEST_HOME/codex-decline-home"
write_codex_install_personal_state "$CODEX_DECLINE_HOME"
printf '0.145.0\n' > "$CODEX_INSTALL_VERSION"
: > "$CODEX_INSTALL_CALLS"
printf 'n\n' > "$TEST_HOME/codex-decline-input"
if HOME="$CODEX_DECLINE_HOME" \
  CODEX_HOME="$CODEX_DECLINE_HOME/.codex" \
  PATH="$CODEX_INSTALL_SHIMS:$PATH" \
  OSO_TEST_CALLS="$CODEX_INSTALL_CALLS" \
  OSO_TEST_CODEX_VERSION="$CODEX_INSTALL_VERSION" \
  bash "$INSTALL_CODEX_SH" --no-impeccable --no-git-hook \
    < "$TEST_HOME/codex-decline-input" > "$CODEX_INSTALL_OUTPUT" 2>&1; then
  codex_decline_rc=0
else
  codex_decline_rc=$?
fi
assert_equals "declining the install exits before any global Codex update" \
  "nonzero" "$([ "$codex_decline_rc" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "declining an old-version install makes no npm or Codex client call" \
  "0" "$(wc -l < "$CODEX_INSTALL_CALLS" | tr -d ' ')"

CODEX_HAPPY_HOME="$TEST_HOME/codex-install-home"
write_codex_install_personal_state "$CODEX_HAPPY_HOME"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_HAPPY_HOME"
codex_install_outcome="$CODEX_INSTALL_RC"
if [ "$CODEX_INSTALL_RC" -ne 0 ]; then
  codex_install_outcome="$CODEX_INSTALL_RC ($CODEX_INSTALL_LOG)"
fi
assert_equals "the shimmed Codex installer completes without network or real-HOME access" \
  "0" "$codex_install_outcome"

CODEX_HAPPY_CONFIG="$CODEX_HAPPY_HOME/.codex/config.toml"
CODEX_HAPPY_AGENTS="$CODEX_HAPPY_HOME/.codex/AGENTS.md"
CODEX_HAPPY_MARKETPLACE="$CODEX_HAPPY_HOME/.agents/plugins/marketplace.json"
CODEX_STAGED_MARKETPLACE="$CODEX_HAPPY_HOME/.local/share/oso-code/codex-marketplace"
assert_equals "the installer registers the staged Codex marketplace root exactly" \
  "1" "$(grep -Fxc "codex:plugin marketplace add $CODEX_STAGED_MARKETPLACE --json" "$CODEX_INSTALL_CALLS" || true)"
assert_equals "the installer calls the oso-code marketplace entry exactly" \
  "1" "$(grep -Fxc 'codex:plugin add oso-code@oso-code --json' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "a Codex already at the frozen floor is never replaced through npm" \
  "0" "$(grep -c '^npm:' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "Engram restores its own Codex integration exactly once" \
  "1" "$(grep -Fxc 'engram:setup codex' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "the installer asks Codex itself to validate the merged config" \
  "1" "$(grep -Fxc 'codex:sandbox -P oso -- /bin/true' "$CODEX_INSTALL_CALLS" || true)"

assert_equals "the bounded config edit preserves personal top-level content" \
  "1" "$(grep -Fxc 'personal_key = "leave-this-alone"' "$CODEX_HAPPY_CONFIG" || true)"
multiline_region_order="$(awk '
  $0 == "\"\"\"" { multiline_end = NR }
  $0 == "# oso-code:start" { managed_start = NR }
  END { if (multiline_end && managed_start && multiline_end < managed_start) print "closed-before-managed"; else print "absorbed" }
' "$CODEX_HAPPY_CONFIG")"
assert_equals "a TOML multiline string closes before the managed region" \
  "closed-before-managed" "$multiline_region_order"
assert_equals "multiline operator prose that looks like a table is preserved" \
  "1" "$(grep -Fxc '[This is prose, not a TOML table]' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "owned-looking symbols inside multiline operator prose do not trigger preflight conflicts" \
  "1" "$(grep -Fxc 'default_permissions = "operator prose, not a root key"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "marker-looking content inside operator TOML text is preserved" \
  "1" "$(grep -Fxc 'operator marker-looking prose must survive' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the bounded config edit preserves projects tables" \
  "1" "$(grep -Fxc '[projects."/workspace/personal"]' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the bounded config edit preserves unrelated MCP tables" \
  "1" "$(grep -Fxc '[mcp_servers.personal]' "$CODEX_HAPPY_CONFIG" || true)"
for codex_mcp in engram context7 fallow; do
  assert_equals "the Codex config wires the settled $codex_mcp MCP" \
    "1" "$(grep -Fxc "[mcp_servers.$codex_mcp]" "$CODEX_HAPPY_CONFIG" || true)"
done
assert_equals "context7 uses the settled remote MCP endpoint" \
  "present" "$(grep -F 'url = "https://mcp.context7.com/mcp"' "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"
assert_equals "fallow uses its native server binary" \
  "present" "$(grep -F 'fallow-mcp' "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"
assert_equals "the agent marker is installed once inside the managed config region" \
  "1" "$(grep -c 'OSO_AGENT' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the fixed Codex state marker has the settled value" \
  "present" "$(grep -E 'OSO_AGENT[[:space:]]*=[[:space:]]*"1"' "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"
assert_equals "the state binary is installed once inside the managed config region" \
  "1" "$(grep -c 'OSO_STATE_BIN' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the config contains one textual and one managed start marker" \
  "2" "$(grep -Fxc '# oso-code:start' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the config contains one textual and one managed end marker" \
  "2" "$(grep -Fxc '# oso-code:end' "$CODEX_HAPPY_CONFIG" || true)"
config_region_order="$(awk '
  $0 == "# oso-code:end" { managed_end = NR }
  $0 == "[projects.\"/workspace/personal\"]" { project = NR }
  END { if (managed_end && project && managed_end < project) print "bounded-before-projects"; else print "invalid-order" }
' "$CODEX_HAPPY_CONFIG")"
assert_equals "the managed region closes before preserved projects tables" \
  "bounded-before-projects" "$config_region_order"
assert_equals "the state binary setting points into the self-contained plugin copy" \
  "present" "$(grep -F "$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/bin/oso-state" "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"
for codex_config_contract in \
  'default_permissions = "oso"' \
  'multi_agent = true' \
  'max_threads = 4' \
  'max_depth = 2' \
  'job_max_runtime_seconds = 1800' \
  '[permissions.oso]' \
  '[permissions.oso.network]' \
  '[permissions.oso.workspace_roots]'; do
  assert_equals "the managed config carries $codex_config_contract" \
    "1" "$(grep -Fxc "$codex_config_contract" "$CODEX_HAPPY_CONFIG" || true)"
done
assert_equals "the managed permissions grant the settled state root" \
  "1" "$(grep -Fxc "\"$CODEX_HAPPY_HOME/.local/state/oso-code\" = true" "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the managed permissions grant the settled worktree root" \
  "1" "$(grep -Fxc "\"$CODEX_HAPPY_HOME/.local/state/oso-code/worktrees\" = true" "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the managed permissions keep secret material denied" \
  "present" "$(grep -F '"**/*.key" = "deny"' "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"

assert_equals "Engram's instruction file survives the oso config merge" \
  "fixture Engram memory protocol" "$(sed -n 's/^# //p' "$CODEX_HAPPY_HOME/.codex/engram-instructions.md" | head -n 1)"
assert_equals "Engram's compact prompt survives the oso config merge" \
  "Save durable memory before compaction." "$(cat "$CODEX_HAPPY_HOME/.codex/engram-compact-prompt.md")"
assert_equals "Engram's instruction pointer survives as a top-level key" \
  "1" "$(grep -c '^model_instructions_file = ' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "Engram's compact prompt pointer survives as a top-level key" \
  "1" "$(grep -c '^experimental_compact_prompt_file = ' "$CODEX_HAPPY_CONFIG" || true)"

missing_codex_agents=""
for codex_agent_toml in "$REPO_ROOT"/codex/agents/*.toml; do
  codex_agent_name="$(basename "$codex_agent_toml" .toml)"
  [ -f "$CODEX_HAPPY_HOME/.codex/agents/$codex_agent_name.toml" ] \
    && [ ! -L "$CODEX_HAPPY_HOME/.codex/agents/$codex_agent_name.toml" ] \
    && cmp -s "$codex_agent_toml" "$CODEX_HAPPY_HOME/.codex/agents/$codex_agent_name.toml" \
    || missing_codex_agents="$missing_codex_agents $codex_agent_name"
done
assert_equals "all seven auto-discovered Codex roles are copied exactly" \
  "" "$missing_codex_agents"
assert_equals "an unrelated auto-discovered role survives agent installation" \
  "operator-owned role" "$(sed -n 's/^description = "\([^"]*\)"/\1/p' "$CODEX_HAPPY_HOME/.codex/agents/personal.toml")"
assert_equals "the seven oso roles are additive beside the personal role" \
  "8" "$(find "$CODEX_HAPPY_HOME/.codex/agents" -maxdepth 1 -type f -name '*.toml' -print | wc -l | tr -d ' ')"

assert_equals "the rendered user hook manifest is installed" \
  "present" "$([ -f "$CODEX_HAPPY_HOME/.codex/hooks.json" ] && [ ! -L "$CODEX_HAPPY_HOME/.codex/hooks.json" ] && echo present || echo missing)"
assert_equals "installed hook commands contain no unresolved release token" \
  "0" "$(grep -c '__OSO_HOOKS_DIR__' "$CODEX_HAPPY_HOME/.codex/hooks.json" || true)"
assert_equals "installed hook commands resolve below the self-contained plugin copy" \
  "present" "$(grep -F "$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/hooks" "$CODEX_HAPPY_HOME/.codex/hooks.json" >/dev/null && echo present || echo missing)"
assert_equals "every installed Codex hook command receives the fixed state marker explicitly" \
  "$(grep -c '"command":' "$CODEX_HAPPY_HOME/.codex/hooks.json" || true)" \
  "$(grep -c '"command": "OSO_AGENT=1 ' "$CODEX_HAPPY_HOME/.codex/hooks.json" || true)"
assert_equals "the installer does not invent Codex per-handler trust hashes" \
  "0" "$({ cat "$CODEX_HAPPY_HOME/.codex/hooks.json" "$CODEX_HAPPY_CONFIG"; } | grep -Ec 'trusted_hash|\[hooks\.state\]' || true)"
assert_equals "the install close tells the operator to review hook trust explicitly" \
  "/hooks" "$(codex_install_log_class /hooks /hooks)"

missing_installed_hook=""
while IFS='  ' read -r published_digest published_path; do
  case "$published_digest" in ''|'#'*) continue ;; esac
  published_path="${published_path# }"
  case "$published_path" in
    codex/hooks/hooks.json)
      installed_hook_path="$CODEX_HAPPY_HOME/.codex/hooks.json"
      normalized_hook_digest="$(sed "s|$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/hooks|__OSO_HOOKS_DIR__|g" "$installed_hook_path" |
        { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })"
      normalized_hook_digest="${normalized_hook_digest%% *}"
      [ "$normalized_hook_digest" = "$published_digest" ] \
        || missing_installed_hook="$missing_installed_hook $published_path"
      continue
      ;;
    plugin/hooks/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/hooks/${published_path#plugin/hooks/}" ;;
    plugin/git-hooks/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/git-hooks/${published_path#plugin/git-hooks/}" ;;
    plugin/bin/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/bin/${published_path#plugin/bin/}" ;;
    *) installed_hook_path="" ;;
  esac
  [ -n "$installed_hook_path" ] \
    && [ -f "$installed_hook_path" ] \
    && [ "$(file_sha256 "$installed_hook_path")" = "$published_digest" ] \
    || missing_installed_hook="$missing_installed_hook $published_path"
done < "$REPO_ROOT/bootstrap/hook-hashes.txt"
assert_equals "every published hook dependency is installed with its released bytes" \
  "" "$missing_installed_hook"
assert_equals "the git commit boundary is staged with the runtime even when wiring is opted out" \
  "identical" "$(cmp -s "$REPO_ROOT/plugin/git-hooks/pre-commit" "$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/git-hooks/pre-commit" && echo identical || echo divergent)"

assert_equals "the installed Codex plugin carries a real wrapper" \
  "present" "$([ -f "$CODEX_STAGED_MARKETPLACE/codex/skills/plan/SKILL.md" ] && [ ! -L "$CODEX_STAGED_MARKETPLACE/codex/skills/plan/SKILL.md" ] && echo present || echo missing)"
assert_equals "the installed Codex plugin carries the shared body beside its wrappers" \
  "present" "$([ -f "$CODEX_STAGED_MARKETPLACE/codex/skills/_shared/bodies/plan.md" ] && [ ! -L "$CODEX_STAGED_MARKETPLACE/codex/skills/_shared/bodies/plan.md" ] && echo present || echo missing)"
assert_equals "the staged plugin carries all eight Codex skill wrappers" \
  "8" "$(find "$CODEX_STAGED_MARKETPLACE/codex/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print | wc -l | tr -d ' ')"
assert_equals "the installed Codex plugin is self-contained, not linked to the checkout" \
  "0" "$(find "$CODEX_STAGED_MARKETPLACE" -type l -print | wc -l | tr -d ' ')"
assert_equals "the plugin manifest remains skills-only rather than claiming user hooks" \
  "0" "$(grep -Ec '"(hooks|agents)"[[:space:]]*:' "$CODEX_STAGED_MARKETPLACE/codex/.codex-plugin/plugin.json" || true)"
assert_equals "the staged shared tree is byte-identical to its single source" \
  "identical" "$(diff -qr "$REPO_ROOT/plugin/skills/_shared" "$CODEX_STAGED_MARKETPLACE/codex/skills/_shared" >/dev/null && echo identical || echo divergent)"

assert_equals "the installer never edits the operator's personal marketplace" \
  "keep-me" "$(sed -n 's/.*"sentinel": "\([^"]*\)".*/\1/p' "$CODEX_HAPPY_MARKETPLACE")"
CODEX_STAGED_CATALOG="$CODEX_STAGED_MARKETPLACE/.agents/plugins/marketplace.json"
assert_equals "the staged catalog names oso-code at both catalog and entry levels" \
  "2" "$(grep -c '"name"[[:space:]]*:[[:space:]]*"oso-code"' "$CODEX_STAGED_CATALOG" || true)"
assert_equals "the staged catalog points at its local Codex package" \
  "1" "$(grep -c '"path"[[:space:]]*:[[:space:]]*"./codex"' "$CODEX_STAGED_CATALOG" || true)"
assert_equals "the staged catalog declares the source as local" \
  "1" "$(grep -c '"source"[[:space:]]*:[[:space:]]*"local"' "$CODEX_STAGED_CATALOG" || true)"
assert_equals "the staged catalog keeps installation available to the operator" \
  "1" "$(grep -c '"installation"[[:space:]]*:[[:space:]]*"AVAILABLE"' "$CODEX_STAGED_CATALOG" || true)"
assert_equals "the staged catalog applies authentication when installed" \
  "1" "$(grep -c '"authentication"[[:space:]]*:[[:space:]]*"ON_INSTALL"' "$CODEX_STAGED_CATALOG" || true)"
assert_equals "the staged catalog is the tracked marketplace, unchanged" \
  "identical" "$(cmp -s "$REPO_ROOT/.agents/plugins/marketplace.json" "$CODEX_STAGED_CATALOG" && echo identical || echo divergent)"

assert_equals "the global Codex file preserves personal prose" \
  "1" "$(grep -Fxc 'This paragraph belongs to the operator.' "$CODEX_HAPPY_AGENTS" || true)"
assert_equals "the global Codex file has exactly one oso-code start marker" \
  "1" "$(grep -Fxc '<!-- oso-code:start -->' "$CODEX_HAPPY_AGENTS" || true)"
assert_equals "the global Codex file has exactly one oso-code end marker" \
  "1" "$(grep -Fxc '<!-- oso-code:end -->' "$CODEX_HAPPY_AGENTS" || true)"
for codex_mode in plan quick debug; do
  namespaced_mode="\$oso-code:$codex_mode"
  assert_equals "global Codex routing uses the discovered $codex_mode identity" \
    "present" "$(grep -F "$namespaced_mode" "$CODEX_HAPPY_AGENTS" >/dev/null && echo present || echo missing)"
  assert_equals "the installed $codex_mode wrapper stays explicit-only" \
    "1" "$(grep -Fxc 'disable-model-invocation: true' "$CODEX_STAGED_MARKETPLACE/codex/skills/$codex_mode/SKILL.md" || true)"
done
assert_equals "the mounted Impeccable skill is the provider-correct independent copy" \
  "4.0.2" "$(sed -n 's/^version:[[:space:]]*//p' "$CODEX_HAPPY_HOME/.agents/skills/impeccable/SKILL.md")"
assert_equals "the mounted Impeccable skill does not point back to its source" \
  "independent" "$([ ! -L "$CODEX_HAPPY_HOME/.agents/skills/impeccable" ] && echo independent || echo linked)"

stale_codex_runtime_contract=""
for codex_mode_file in \
  "$REPO_ROOT/plugin/skills/_shared/platform/codex/plan.md" \
  "$REPO_ROOT/plugin/skills/_shared/platform/codex/quick.md" \
  "$REPO_ROOT/plugin/skills/_shared/platform/codex/debug.md"; do
  grep -F -- '--session "${OSO_AGENT}"' "$codex_mode_file" >/dev/null \
    || stale_codex_runtime_contract="$stale_codex_runtime_contract $(basename "$codex_mode_file"):no-session"
  grep -E 'what fills `--session`|gate is unported|gates are unported' "$codex_mode_file" >/dev/null \
    && stale_codex_runtime_contract="$stale_codex_runtime_contract $(basename "$codex_mode_file"):placeholder" \
    || true
done
assert_equals "plan, quick and debug bind state to the installed OSO_AGENT marker" \
  "" "$stale_codex_runtime_contract"
assert_equals "Codex parity no longer calls the S11 state identity a placeholder" \
  "0" "$(grep -c 'PLACEHOLDER (the session id, not the identity)' "$REPO_ROOT/docs/parity-codex.md" || true)"
assert_equals "Codex parity no longer says the S11 runtime installer is deferred" \
  "0" "$(grep -Ec 'later installer slice|installer slice is what sets' "$REPO_ROOT/docs/parity-codex.md" || true)"

# Codex can retain an official Engram checkout under its internal marketplace
# cache even after losing the corresponding registry entry. Engram's next setup
# cannot add the official remote until that orphan is removed. The installer may
# repair only the exact clean official checkout, under its transaction.
if command -v git >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  CODEX_STALE_ENGRAM_HOME="$TEST_HOME/codex-stale-engram-home"
  write_codex_install_personal_state "$CODEX_STALE_ENGRAM_HOME"
  write_official_engram_marketplace_cache "$CODEX_STALE_ENGRAM_HOME"
  run_codex_install "$CODEX_STALE_ENGRAM_HOME"
  assert_equals "a clean unregistered official Engram cache is repaired" \
    "zero" "$([ "$CODEX_INSTALL_RC" -eq 0 ] && echo zero || echo nonzero)"
  assert_equals "the bounded Engram repair asks Codex to remove exactly its orphan" \
    "1" "$(grep -Fxc 'codex:plugin marketplace remove engram' "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "the stale Engram cache is absent before setup can register it again" \
    "absent" "$([ -e "$CODEX_STALE_ENGRAM_HOME/.codex/.tmp/marketplaces/engram" ] && echo present || echo absent)"

  CODEX_MODIFIED_ENGRAM_HOME="$TEST_HOME/codex-modified-engram-home"
  write_codex_install_personal_state "$CODEX_MODIFIED_ENGRAM_HOME"
  write_official_engram_marketplace_cache "$CODEX_MODIFIED_ENGRAM_HOME"
  printf 'operator evidence\n' > "$CODEX_MODIFIED_ENGRAM_HOME/.codex/.tmp/marketplaces/engram/operator.txt"
  git -C "$CODEX_MODIFIED_ENGRAM_HOME/.codex/.tmp/marketplaces/engram" add operator.txt
  git -C "$CODEX_MODIFIED_ENGRAM_HOME/.codex/.tmp/marketplaces/engram" \
    -c user.name=Operator -c user.email=operator@example.test commit -qm 'operator: keep evidence'
  modified_engram_before="$(install_file_snapshot "$CODEX_MODIFIED_ENGRAM_HOME")"
  run_codex_install "$CODEX_MODIFIED_ENGRAM_HOME"
  modified_engram_after="$(install_file_snapshot "$CODEX_MODIFIED_ENGRAM_HOME")"
  assert_equals "a locally committed unregistered Engram cache is refused" \
    "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "an unsafe Engram cache is neither removed nor passed to setup" \
    "0" "$(grep -Ec '^codex:plugin marketplace remove engram$|^engram:' "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "unsafe Engram cache refusal preserves every destination byte-for-byte" \
    "$modified_engram_before" "$modified_engram_after"

  CODEX_ENGRAM_ROLLBACK_HOME="$TEST_HOME/codex-engram-rollback-home"
  write_codex_install_personal_state "$CODEX_ENGRAM_ROLLBACK_HOME"
  write_official_engram_marketplace_cache "$CODEX_ENGRAM_ROLLBACK_HOME"
  engram_rollback_before="$(install_file_snapshot "$CODEX_ENGRAM_ROLLBACK_HOME")"
  run_codex_install "$CODEX_ENGRAM_ROLLBACK_HOME" after-engram-marketplace-repair
  engram_rollback_after="$(install_file_snapshot "$CODEX_ENGRAM_ROLLBACK_HOME")"
  assert_equals "a failure immediately after Engram orphan repair exits nonzero" \
    "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "rollback restores the exact official Engram checkout removed by Codex" \
    "$engram_rollback_before" "$engram_rollback_after"

  CODEX_REGISTERED_ENGRAM_HOME="$TEST_HOME/codex-registered-engram-home"
  write_codex_install_personal_state "$CODEX_REGISTERED_ENGRAM_HOME"
  write_official_engram_marketplace_cache "$CODEX_REGISTERED_ENGRAM_HOME"
  OSO_TEST_ENGRAM_REGISTERED=1 run_codex_install "$CODEX_REGISTERED_ENGRAM_HOME"
  assert_equals "a registered Engram marketplace remains outside orphan repair" \
    "zero" "$([ "$CODEX_INSTALL_RC" -eq 0 ] && echo zero || echo nonzero)"
  assert_equals "registered Engram ownership is never removed" \
    "0" "$(grep -Fxc 'codex:plugin marketplace remove engram' "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "the registered Engram checkout remains present" \
    "present" "$([ -d "$CODEX_REGISTERED_ENGRAM_HOME/.codex/.tmp/marketplaces/engram" ] && echo present || echo absent)"
else
  echo "skip: git or python3 is absent, so bounded Engram orphan repair cannot be exercised"
  skipped=$((skipped + 1))
fi

# A login-only Codex home already carries [features].prevent_idle_sleep. That
# unrelated key must not make oso-code reject the whole table, and the two keys
# oso-code does own must be incorporated without emitting a second TOML table.
CODEX_EXISTING_FEATURES_HOME="$TEST_HOME/codex-existing-features-home"
write_codex_install_existing_features_state "$CODEX_EXISTING_FEATURES_HOME"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_EXISTING_FEATURES_HOME"
codex_existing_features_outcome="$CODEX_INSTALL_RC"
if [ "$CODEX_INSTALL_RC" -ne 0 ]; then
  codex_existing_features_outcome="$CODEX_INSTALL_RC ($CODEX_INSTALL_LOG)"
fi
assert_equals "an existing unrelated Codex feature does not block installation" \
  "0" "$codex_existing_features_outcome"
CODEX_EXISTING_FEATURES_CONFIG="$CODEX_EXISTING_FEATURES_HOME/.codex/config.toml"
assert_equals "the existing features table is emitted exactly once" \
  "1" "$(grep -Fxc '[features]' "$CODEX_EXISTING_FEATURES_CONFIG" || true)"
assert_equals "the installer preserves prevent_idle_sleep exactly once" \
  "1" "$(grep -Fxc 'prevent_idle_sleep = true' "$CODEX_EXISTING_FEATURES_CONFIG" || true)"
assert_equals "the installer manages hooks exactly once beside the existing feature" \
  "1" "$(grep -Fxc 'hooks = true' "$CODEX_EXISTING_FEATURES_CONFIG" || true)"
assert_equals "the installer manages multi_agent exactly once beside the existing feature" \
  "1" "$(grep -Fxc 'multi_agent = true' "$CODEX_EXISTING_FEATURES_CONFIG" || true)"
feature_marker_placement="$(awk '
  $0 == "[features]" { feature_tables++; in_features = 1; next }
  in_features && /^\[/ { in_features = 0 }
  $0 == "# oso-code:features:start" {
    feature_starts++
    if (in_features) start_inside++
    in_leaf = 1
  }
  $0 == "# oso-code:features:end" {
    feature_ends++
    if (in_features && in_leaf) end_inside++
    in_leaf = 0
  }
  $0 == "prevent_idle_sleep = true" && in_leaf { adopted_operator_key++ }
  END {
    if (feature_tables == 1 && feature_starts == 1 && feature_ends == 1 &&
        start_inside == 1 && end_inside == 1 && adopted_operator_key == 0) {
      print "bounded-inside-features"
    } else {
      print "misplaced-or-duplicated"
    }
  }
' "$CODEX_EXISTING_FEATURES_CONFIG")"
assert_equals "the leaf ownership block is bounded once inside [features] without annexing the operator key" \
  "bounded-inside-features" "$feature_marker_placement"

codex_existing_features_first="$(install_file_snapshot "$CODEX_EXISTING_FEATURES_HOME")"
run_codex_install "$CODEX_EXISTING_FEATURES_HOME"
codex_existing_features_second="$(install_file_snapshot "$CODEX_EXISTING_FEATURES_HOME")"
assert_equals "the second install with an existing unrelated feature also completes" \
  "0" "$CODEX_INSTALL_RC"
assert_equals "a second install with an existing unrelated feature is byte-idempotent" \
  "$codex_existing_features_first" "$codex_existing_features_second"

# The merge participates in the same transaction as every other destination.
# A failure after the last materialization boundary must restore the original
# operator-owned [features] table, not leave a half-adopted table behind.
CODEX_EXISTING_FEATURES_ROLLBACK_HOME="$TEST_HOME/codex-existing-features-rollback-home"
write_codex_install_existing_features_state "$CODEX_EXISTING_FEATURES_ROLLBACK_HOME"
codex_existing_features_rollback_before="$(install_file_snapshot "$CODEX_EXISTING_FEATURES_ROLLBACK_HOME")"
run_codex_install "$CODEX_EXISTING_FEATURES_ROLLBACK_HOME" after-impeccable
codex_existing_features_rollback_after="$(install_file_snapshot "$CODEX_EXISTING_FEATURES_ROLLBACK_HOME")"
assert_equals "a late failure after merging an existing features table exits nonzero" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "the existing-features rollback reaches the injected late boundary" \
  "after-impeccable" "$(codex_install_log_class after-impeccable after-impeccable)"
assert_equals "a late failure restores the original existing features table byte-for-byte" \
  "$codex_existing_features_rollback_before" "$codex_existing_features_rollback_after"

# Table ownership is deliberately narrower than key ownership. An unrelated
# key is preserved above, but either oso-owned key outside the managed region is
# still an ambiguity and must fail before any external integration is touched.
for codex_owned_feature in hooks multi_agent; do
  CODEX_FEATURE_CONFLICT_HOME="$TEST_HOME/codex-${codex_owned_feature}-conflict-home"
  write_codex_install_existing_features_state "$CODEX_FEATURE_CONFLICT_HOME"
  awk -v owned_feature="$codex_owned_feature = false" '
    { print }
    $0 == "prevent_idle_sleep = true" { print owned_feature }
  ' "$CODEX_FEATURE_CONFLICT_HOME/.codex/config.toml" \
    > "$CODEX_FEATURE_CONFLICT_HOME/.codex/config.toml.tmp"
  mv "$CODEX_FEATURE_CONFLICT_HOME/.codex/config.toml.tmp" \
    "$CODEX_FEATURE_CONFLICT_HOME/.codex/config.toml"
  codex_feature_conflict_before="$(install_file_snapshot "$CODEX_FEATURE_CONFLICT_HOME")"
  run_codex_install "$CODEX_FEATURE_CONFLICT_HOME"
  codex_feature_conflict_after="$(install_file_snapshot "$CODEX_FEATURE_CONFLICT_HOME")"
  assert_equals "an external $codex_owned_feature feature conflicts with oso ownership" \
    "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "an external $codex_owned_feature conflict reaches no plugin or Engram client" \
    "0" "$(grep -Ec '^codex:plugin|^engram:' "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "an external $codex_owned_feature conflict leaves every destination byte-identical" \
    "$codex_feature_conflict_before" "$codex_feature_conflict_after"
done

# The leaf markers declare ownership of exactly the renderer's two assignments,
# not arbitrary bytes placed between them. Silently stripping a future Codex key
# from a stale or hand-edited block would turn the ownership boundary into data
# loss on reinstall, so a divergent block is a preflight conflict too.
CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME="$TEST_HOME/codex-feature-foreign-in-block-home"
write_codex_install_existing_features_state "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME"
awk '
  $0 == "prevent_idle_sleep = true" {
    print "# oso-code:features:start"
    print "hooks = true"
    print "prevent_idle_sleep = true"
    print "multi_agent = true"
    print "# oso-code:features:end"
    next
  }
  { print }
' "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME/.codex/config.toml" \
  > "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME/.codex/config.toml.tmp"
mv "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME/.codex/config.toml.tmp" \
  "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME/.codex/config.toml"
codex_feature_foreign_in_block_before="$(install_file_snapshot "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME")"
run_codex_install "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME"
codex_feature_foreign_in_block_after="$(install_file_snapshot "$CODEX_FEATURE_FOREIGN_IN_BLOCK_HOME")"
assert_equals "a foreign feature inside oso's leaf block is rejected" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a divergent feature block reaches no plugin or Engram client" \
  "0" "$(grep -Ec '^codex:plugin|^engram:' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "a divergent feature block preserves every destination byte-for-byte" \
  "$codex_feature_foreign_in_block_before" "$codex_feature_foreign_in_block_after"

# A second run must converge byte-for-byte. Calls may repeat; no managed file,
# personal file or copied payload may accumulate another block or change bytes.
codex_first_snapshot="$(install_file_snapshot "$CODEX_HAPPY_HOME")"
run_codex_install "$CODEX_HAPPY_HOME"
codex_second_snapshot="$(install_file_snapshot "$CODEX_HAPPY_HOME")"
assert_equals "a second Codex install is byte-idempotent across every managed tree" \
  "$codex_first_snapshot" "$codex_second_snapshot"
assert_equals "a second config merge keeps one textual and one managed start marker" \
  "2" "$(grep -Fxc '# oso-code:start' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "a second config merge keeps one textual and one managed end marker" \
  "2" "$(grep -Fxc '# oso-code:end' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "a second Engram setup leaves both root pointers before oso-code ownership" \
  "before-once" "$(awk '
    $0 == "# oso-code:start" { managed_start = NR }
    /^model_instructions_file[[:space:]]*=/ { model_rows++; model_line = NR }
    /^experimental_compact_prompt_file[[:space:]]*=/ { compact_rows++; compact_line = NR }
    END {
      if (model_rows == 1 && compact_rows == 1 &&
          model_line < managed_start && compact_line < managed_start) print "before-once"
      else printf "model=%d compact=%d start=%d", model_rows, compact_rows, managed_start
    }
  ' "$CODEX_HAPPY_CONFIG")"

# D14 is a behavioral pin: the wrong CLI is repaired to the ADR's exact floor,
# then rechecked. `@latest` would make this fixture fail for the precise command.
CODEX_OLD_HOME="$TEST_HOME/codex-old-version-home"
write_codex_install_personal_state "$CODEX_OLD_HOME"
printf '0.145.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_OLD_HOME"
assert_equals "an old Codex is updated through the frozen package pin" \
  "1" "$(grep -Fxc 'npm:install --global @openai/codex@0.146.0' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "the installer rechecks the CLI after the pinned update" \
  "2" "$(grep -Fxc 'codex:--version' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "the shipped Codex installer contains no @latest escape hatch" \
  "0" "$(grep -c '@latest' "$INSTALL_CODEX_SH" || true)"

# Published hashes are checked before the transaction starts. This fixture is a
# release tree whose hook bytes were changed after publication; it must neither
# call a client nor create one destination path.
CODEX_TAMPERED_RELEASE="$TEST_HOME/codex-tampered-release"
mkdir -p "$CODEX_TAMPERED_RELEASE"
cp -R "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" "$REPO_ROOT/plugin" "$CODEX_TAMPERED_RELEASE/"
printf '\n# post-publication tamper\n' >> "$CODEX_TAMPERED_RELEASE/plugin/hooks/lib.sh"
CODEX_HASH_HOME="$TEST_HOME/codex-hash-home"
mkdir -p "$CODEX_HASH_HOME"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_HASH_HOME" "" "$CODEX_TAMPERED_RELEASE/bootstrap/install-codex.sh"
assert_equals "a published hook hash mismatch aborts the Codex installer" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "the hash refusal names the exact trust-boundary reason" \
  "hash mismatch" "$(codex_install_log_class 'hash mismatch' 'hash mismatch')"
assert_equals "a hash mismatch happens before any external installer call" \
  "0" "$(wc -l < "$CODEX_INSTALL_CALLS" | tr -d ' ')"
assert_equals "a hash mismatch happens before any destination mutation" \
  "absent" "$([ -e "$CODEX_HASH_HOME/.codex" ] || [ -e "$CODEX_HASH_HOME/.agents" ] || [ -e "$CODEX_HASH_HOME/.local/share/oso-code" ] && echo mutated || echo absent)"

CODEX_TAMPERED_GIT_RELEASE="$TEST_HOME/codex-tampered-git-release"
mkdir -p "$CODEX_TAMPERED_GIT_RELEASE"
cp -R "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" "$REPO_ROOT/plugin" \
  "$CODEX_TAMPERED_GIT_RELEASE/"
printf '\n# foreign post-publication hook bytes\n' >> \
  "$CODEX_TAMPERED_GIT_RELEASE/plugin/git-hooks/pre-commit"
CODEX_GIT_HASH_HOME="$TEST_HOME/codex-git-hash-home"
mkdir -p "$CODEX_GIT_HASH_HOME"
run_codex_install "$CODEX_GIT_HASH_HOME" "" \
  "$CODEX_TAMPERED_GIT_RELEASE/bootstrap/install-codex.sh"
assert_equals "tampered git-hook bytes are outside the published owner" \
  "git hash mismatch" "$(codex_install_log_class 'git hash mismatch' 'hash mismatch.*plugin/git-hooks/pre-commit')"
assert_equals "a git-hook hash refusal happens before any external installer call" \
  "0" "$(wc -l < "$CODEX_INSTALL_CALLS" | tr -d ' ')"
assert_equals "a git-hook hash refusal happens before any destination mutation" \
  "absent" "$([ -e "$CODEX_GIT_HASH_HOME/.codex" ] || [ -e "$CODEX_GIT_HASH_HOME/.agents" ] || [ -e "$CODEX_GIT_HASH_HOME/.local/share/oso-code" ] && echo mutated || echo absent)"

CODEX_OVERRIDE_HASHES="$TEST_HOME/codex-override-hook-hashes.txt"
cp "$REPO_ROOT/bootstrap/hook-hashes.txt" "$CODEX_OVERRIDE_HASHES"
tampered_lib_digest="$(file_sha256 "$CODEX_TAMPERED_RELEASE/plugin/hooks/lib.sh")"
awk -v digest="$tampered_lib_digest" '
  $2 == "plugin/hooks/lib.sh" { $1 = digest }
  { if ($0 ~ /^#/ || NF == 0) print; else printf "%s  %s\n", $1, $2 }
' "$CODEX_OVERRIDE_HASHES" > "$CODEX_OVERRIDE_HASHES.tmp"
mv "$CODEX_OVERRIDE_HASHES.tmp" "$CODEX_OVERRIDE_HASHES"
OSO_HOOK_HASHES_FILE="$CODEX_OVERRIDE_HASHES" \
  run_codex_install "$CODEX_HASH_HOME" "" "$CODEX_TAMPERED_RELEASE/bootstrap/install-codex.sh"
assert_equals "an external hash manifest cannot bless post-publication hook bytes" \
  "hash mismatch" "$(codex_install_log_class 'hash mismatch' 'hash mismatch')"
assert_equals "the ignored hash override reaches no installer client" \
  "0" "$(wc -l < "$CODEX_INSTALL_CALLS" | tr -d ' ')"

CODEX_DUPLICATE_HASH_RELEASE="$TEST_HOME/codex-duplicate-hash-release"
mkdir -p "$CODEX_DUPLICATE_HASH_RELEASE"
cp -R "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" "$REPO_ROOT/plugin" "$CODEX_DUPLICATE_HASH_RELEASE/"
awk '
  /^#/ || NF == 0 { print; next }
  data++
  data == 1 { first = $0; print; next }
  data == 2 { print first; next }
  { print }
' "$CODEX_DUPLICATE_HASH_RELEASE/bootstrap/hook-hashes.txt" \
  > "$CODEX_DUPLICATE_HASH_RELEASE/bootstrap/hook-hashes.txt.tmp"
mv "$CODEX_DUPLICATE_HASH_RELEASE/bootstrap/hook-hashes.txt.tmp" \
  "$CODEX_DUPLICATE_HASH_RELEASE/bootstrap/hook-hashes.txt"
run_codex_install "$CODEX_HASH_HOME" "" "$CODEX_DUPLICATE_HASH_RELEASE/bootstrap/install-codex.sh"
assert_equals "a duplicate published hash path is rejected even with thirteen rows" \
  "duplicate path" "$(codex_install_log_class 'duplicate path' 'duplicate published hook path')"
assert_equals "duplicate hash coverage is rejected before any destination mutation" \
  "absent" "$([ -e "$CODEX_HASH_HOME/.codex" ] || [ -e "$CODEX_HASH_HOME/.agents" ] || [ -e "$CODEX_HASH_HOME/.local/share/oso-code" ] && echo mutated || echo absent)"

# Every file mutation participates in one transaction. A deterministic failure
# after the last materialization point is the strongest rollback case because it
# proves hooks, agents, config, global rules, plugin and Impeccable are restored
# together rather than only protecting the file nearest the failure.
CODEX_ROLLBACK_HOME="$TEST_HOME/codex-rollback-home"
mkdir -p "$CODEX_ROLLBACK_HOME"
cp -R "$CODEX_HAPPY_HOME/." "$CODEX_ROLLBACK_HOME/"
# This fixture changes HOME, so the copied rendered hooks manifest correctly
# points at the source fixture's runtime and is foreign in the destination.
# Leave hooks absent here: the late-failure assertion still proves a newly
# created manifest is removed by rollback without weakening ownership checks.
rm -f "$CODEX_ROLLBACK_HOME/.codex/hooks.json"
mkdir -p "$CODEX_ROLLBACK_HOME/.local/state/oso-code"
printf 'operator pre-existing opt-out\n' > "$CODEX_ROLLBACK_HOME/.local/state/oso-code/impeccable-opt-out"
codex_rollback_before="$(install_file_snapshot "$CODEX_ROLLBACK_HOME")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_ROLLBACK_HOME" after-impeccable
codex_rollback_after="$(install_file_snapshot "$CODEX_ROLLBACK_HOME")"
assert_equals "a deterministic late installer failure exits nonzero" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a deterministic failure names the exact injected boundary" \
  "after-impeccable" "$(codex_install_log_class after-impeccable after-impeccable)"
assert_equals "a late failure rolls every user-owned destination back byte-for-byte" \
  "$codex_rollback_before" "$codex_rollback_after"

CODEX_CONFIG_REJECT_HOME="$TEST_HOME/codex-config-reject-home"
write_codex_install_personal_state "$CODEX_CONFIG_REJECT_HOME"
codex_config_reject_before="$(install_file_snapshot "$CODEX_CONFIG_REJECT_HOME")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
OSO_TEST_CONFIG_FAIL=1 run_codex_install "$CODEX_CONFIG_REJECT_HOME"
codex_config_reject_after="$(install_file_snapshot "$CODEX_CONFIG_REJECT_HOME")"
assert_equals "a Codex sandbox-profile validation rejection aborts the install" \
  "config rejection" "$(codex_install_log_class 'config rejection' 'Codex rejected the merged config')"
assert_equals "profile validation rejection rolls every destination back byte-for-byte" \
  "$codex_config_reject_before" "$codex_config_reject_after"

if command -v git >/dev/null 2>&1; then
  # ADR-0099: a previous oso-code install may have pointed this checkout at the
  # published source directory. That exact, single-hook owner is safe to migrate
  # to the self-contained runtime; a lookalike path or any sibling is not.
  CODEX_GIT_MIGRATE_RELEASE="$TEST_HOME/codex-git-migrate-release"
  mkdir -p "$CODEX_GIT_MIGRATE_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_MIGRATE_RELEASE/"
  git init -q "$CODEX_GIT_MIGRATE_RELEASE"
  git -C "$CODEX_GIT_MIGRATE_RELEASE" config core.hooksPath \
    "$CODEX_GIT_MIGRATE_RELEASE/plugin/git-hooks"
  CODEX_GIT_MIGRATE_HOME="$TEST_HOME/codex-git-migrate-home"
  write_codex_install_personal_state "$CODEX_GIT_MIGRATE_HOME"
  printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
  run_codex_install_with_git_hook "$CODEX_GIT_MIGRATE_HOME" \
    "$CODEX_GIT_MIGRATE_RELEASE/bootstrap/install-codex.sh"
  assert_equals "the exact single-hook oso checkout owner migrates successfully" \
    "zero" "$([ "$CODEX_INSTALL_RC" -eq 0 ] && echo zero || echo nonzero)"
  assert_equals "the checkout hook migration is reported explicitly" \
    "migration" "$(codex_install_log_class migration 'migrating oso-code.*checkout hook')"
  assert_equals "the migrated git gate points at the self-contained runtime" \
    "$CODEX_GIT_MIGRATE_HOME/.local/share/oso-code/runtime/git-hooks" \
    "$(git -C "$CODEX_GIT_MIGRATE_RELEASE" config --local --get core.hooksPath)"
  assert_equals "the migrated runtime git gate keeps the published bytes" \
    "identical" "$(cmp -s "$CODEX_GIT_MIGRATE_RELEASE/plugin/git-hooks/pre-commit" \
      "$CODEX_GIT_MIGRATE_HOME/.local/share/oso-code/runtime/git-hooks/pre-commit" \
      && echo identical || echo divergent)"
  assert_equals "the migrated runtime git gate is executable" \
    "executable" "$([ -x "$CODEX_GIT_MIGRATE_HOME/.local/share/oso-code/runtime/git-hooks/pre-commit" ] && echo executable || echo inert)"
  run_codex_install_with_git_hook "$CODEX_GIT_MIGRATE_HOME" \
    "$CODEX_GIT_MIGRATE_RELEASE/bootstrap/install-codex.sh"
  assert_equals "reinstall after checkout-hook migration is idempotent" \
    "zero" "$([ "$CODEX_INSTALL_RC" -eq 0 ] && echo zero || echo nonzero)"

  CODEX_GIT_LEGACY_ROLLBACK_RELEASE="$TEST_HOME/codex-git-legacy-rollback-release"
  mkdir -p "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE/"
  git init -q "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE"
  legacy_rollback_path="$CODEX_GIT_LEGACY_ROLLBACK_RELEASE/plugin/git-hooks"
  git -C "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE" config core.hooksPath \
    "$legacy_rollback_path"
  CODEX_GIT_LEGACY_ROLLBACK_HOME="$TEST_HOME/codex-git-legacy-rollback-home"
  write_codex_install_personal_state "$CODEX_GIT_LEGACY_ROLLBACK_HOME"
  legacy_rollback_before="$(install_file_snapshot "$CODEX_GIT_LEGACY_ROLLBACK_HOME")"
  run_codex_install_with_git_hook "$CODEX_GIT_LEGACY_ROLLBACK_HOME" \
    "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE/bootstrap/install-codex.sh" after-git-hook
  assert_equals "a failure after legacy hook migration exits nonzero" \
    "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "legacy hook rollback restores its exact checkout path" \
    "$legacy_rollback_path" \
    "$(git -C "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE" config --local --get core.hooksPath)"
  assert_equals "legacy hook rollback restores every installed destination" \
    "$legacy_rollback_before" \
    "$(install_file_snapshot "$CODEX_GIT_LEGACY_ROLLBACK_HOME")"

  CODEX_GIT_LOOKALIKE_RELEASE="$TEST_HOME/codex-git-lookalike-release"
  mkdir -p "$CODEX_GIT_LOOKALIKE_RELEASE/operator-hooks"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_LOOKALIKE_RELEASE/"
  cp "$REPO_ROOT/plugin/git-hooks/pre-commit" \
    "$CODEX_GIT_LOOKALIKE_RELEASE/operator-hooks/pre-commit"
  git init -q "$CODEX_GIT_LOOKALIKE_RELEASE"
  git -C "$CODEX_GIT_LOOKALIKE_RELEASE" config core.hooksPath \
    "$CODEX_GIT_LOOKALIKE_RELEASE/operator-hooks"
  CODEX_GIT_LOOKALIKE_HOME="$TEST_HOME/codex-git-lookalike-home"
  write_codex_install_personal_state "$CODEX_GIT_LOOKALIKE_HOME"
  run_codex_install_with_git_hook "$CODEX_GIT_LOOKALIKE_HOME" \
    "$CODEX_GIT_LOOKALIKE_RELEASE/bootstrap/install-codex.sh"
  assert_equals "identical hook bytes at another path remain foreign" \
    "foreign owner" "$(codex_install_log_class 'foreign owner' 'refusing to replace existing git hook owner')"
  assert_equals "a refused lookalike hook keeps its configured owner" \
    "$CODEX_GIT_LOOKALIKE_RELEASE/operator-hooks" \
    "$(git -C "$CODEX_GIT_LOOKALIKE_RELEASE" config --local --get core.hooksPath)"

  CODEX_GIT_SIBLING_RELEASE="$TEST_HOME/codex-git-sibling-release"
  mkdir -p "$CODEX_GIT_SIBLING_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_SIBLING_RELEASE/"
  printf 'operator-owned hidden sibling\n' > \
    "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks/.operator-hook"
  git init -q "$CODEX_GIT_SIBLING_RELEASE"
  git -C "$CODEX_GIT_SIBLING_RELEASE" config core.hooksPath \
    "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks"
  CODEX_GIT_SIBLING_HOME="$TEST_HOME/codex-git-sibling-home"
  write_codex_install_personal_state "$CODEX_GIT_SIBLING_HOME"
  run_codex_install_with_git_hook "$CODEX_GIT_SIBLING_HOME" \
    "$CODEX_GIT_SIBLING_RELEASE/bootstrap/install-codex.sh"
  assert_equals "an extra hook beside oso-code prevents migration" \
    "foreign owner" "$(codex_install_log_class 'foreign owner' 'refusing to replace existing git hook owner')"
  assert_equals "a refused mixed checkout keeps its configured owner" \
    "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks" \
    "$(git -C "$CODEX_GIT_SIBLING_RELEASE" config --local --get core.hooksPath)"
  assert_equals "a refused mixed checkout preserves its hidden sibling" \
    "operator-owned hidden sibling" \
    "$(cat "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks/.operator-hook")"

  CODEX_GIT_LINK_RELEASE="$TEST_HOME/codex-git-link-release"
  mkdir -p "$CODEX_GIT_LINK_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_LINK_RELEASE/"
  mv "$CODEX_GIT_LINK_RELEASE/plugin/git-hooks" \
    "$CODEX_GIT_LINK_RELEASE/plugin/git-hooks-source"
  ln -s git-hooks-source "$CODEX_GIT_LINK_RELEASE/plugin/git-hooks"
  git init -q "$CODEX_GIT_LINK_RELEASE"
  git -C "$CODEX_GIT_LINK_RELEASE" config core.hooksPath \
    "$CODEX_GIT_LINK_RELEASE/plugin/git-hooks"
  CODEX_GIT_LINK_HOME="$TEST_HOME/codex-git-link-home"
  write_codex_install_personal_state "$CODEX_GIT_LINK_HOME"
  run_codex_install_with_git_hook "$CODEX_GIT_LINK_HOME" \
    "$CODEX_GIT_LINK_RELEASE/bootstrap/install-codex.sh"
  assert_equals "a symlinked checkout hook directory is never adopted" \
    "foreign owner" "$(codex_install_log_class 'foreign owner' 'refusing to replace existing git hook owner')"
  assert_equals "a refused checkout hook directory remains a symlink" \
    "git-hooks-source" "$(readlink "$CODEX_GIT_LINK_RELEASE/plugin/git-hooks")"

  CODEX_GIT_FILE_LINK_RELEASE="$TEST_HOME/codex-git-file-link-release"
  mkdir -p "$CODEX_GIT_FILE_LINK_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_FILE_LINK_RELEASE/"
  mv "$CODEX_GIT_FILE_LINK_RELEASE/plugin/git-hooks/pre-commit" \
    "$CODEX_GIT_FILE_LINK_RELEASE/plugin/git-hooks/published-pre-commit"
  ln -s published-pre-commit \
    "$CODEX_GIT_FILE_LINK_RELEASE/plugin/git-hooks/pre-commit"
  git init -q "$CODEX_GIT_FILE_LINK_RELEASE"
  git -C "$CODEX_GIT_FILE_LINK_RELEASE" config core.hooksPath \
    "$CODEX_GIT_FILE_LINK_RELEASE/plugin/git-hooks"
  CODEX_GIT_FILE_LINK_HOME="$TEST_HOME/codex-git-file-link-home"
  write_codex_install_personal_state "$CODEX_GIT_FILE_LINK_HOME"
  run_codex_install_with_git_hook "$CODEX_GIT_FILE_LINK_HOME" \
    "$CODEX_GIT_FILE_LINK_RELEASE/bootstrap/install-codex.sh"
  assert_equals "a symlinked pre-commit is never adopted" \
    "foreign owner" "$(codex_install_log_class 'foreign owner' 'refusing to replace existing git hook owner')"
  assert_equals "a refused pre-commit remains a symlink" \
    "published-pre-commit" \
    "$(readlink "$CODEX_GIT_FILE_LINK_RELEASE/plugin/git-hooks/pre-commit")"

  CODEX_GIT_GLOBAL_RELEASE="$TEST_HOME/codex-git-global-release"
  mkdir -p "$CODEX_GIT_GLOBAL_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_GLOBAL_RELEASE/"
  git init -q "$CODEX_GIT_GLOBAL_RELEASE"
  CODEX_GIT_GLOBAL_HOME="$TEST_HOME/codex-git-global-home"
  write_codex_install_personal_state "$CODEX_GIT_GLOBAL_HOME"
  HOME="$CODEX_GIT_GLOBAL_HOME" git config --global core.hooksPath \
    "$CODEX_GIT_GLOBAL_RELEASE/plugin/git-hooks"
  run_codex_install_with_git_hook "$CODEX_GIT_GLOBAL_HOME" \
    "$CODEX_GIT_GLOBAL_RELEASE/bootstrap/install-codex.sh"
  assert_equals "an exact path inherited from global config is not a checkout owner" \
    "foreign owner" "$(codex_install_log_class 'foreign owner' 'refusing to replace existing git hook owner')"
  assert_equals "a refused global owner does not create a local replacement" \
    "absent" "$(if git -C "$CODEX_GIT_GLOBAL_RELEASE" config --local --get core.hooksPath >/dev/null 2>&1; then echo present; else echo absent; fi)"
  assert_equals "a refused global owner remains byte-identical" \
    "$CODEX_GIT_GLOBAL_RELEASE/plugin/git-hooks" \
    "$(HOME="$CODEX_GIT_GLOBAL_HOME" git config --global --get core.hooksPath)"

  CODEX_GIT_ROLLBACK_RELEASE="$TEST_HOME/codex-git-rollback-release"
  mkdir -p "$CODEX_GIT_ROLLBACK_RELEASE"
  cp -R "$REPO_ROOT/.agents" "$REPO_ROOT/bootstrap" "$REPO_ROOT/codex" \
    "$REPO_ROOT/plugin" "$CODEX_GIT_ROLLBACK_RELEASE/"
  git init -q "$CODEX_GIT_ROLLBACK_RELEASE"
  CODEX_GIT_ROLLBACK_HOME="$TEST_HOME/codex-git-rollback-home"
  write_codex_install_personal_state "$CODEX_GIT_ROLLBACK_HOME"
  : > "$CODEX_INSTALL_CALLS"
  printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
  if HOME="$CODEX_GIT_ROLLBACK_HOME" \
    CODEX_HOME="$CODEX_GIT_ROLLBACK_HOME/.codex" \
    PATH="$CODEX_INSTALL_SHIMS:$PATH" \
    OSO_TEST_CALLS="$CODEX_INSTALL_CALLS" \
    OSO_TEST_CODEX_VERSION="$CODEX_INSTALL_VERSION" \
    OSO_IMPECCABLE_SOURCE="$CODEX_IMPECCABLE_SOURCE" \
    OSO_INSTALL_FAIL_AFTER=after-git-hook \
    bash "$CODEX_GIT_ROLLBACK_RELEASE/bootstrap/install-codex.sh" \
      --yes --no-impeccable > "$CODEX_INSTALL_OUTPUT" 2>&1; then
    codex_git_rollback_rc=0
  else
    codex_git_rollback_rc=$?
  fi
  assert_equals "a deterministic failure after git wiring exits nonzero" \
    "nonzero" "$([ "$codex_git_rollback_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "rollback removes core.hooksPath when it was previously absent" \
    "absent" "$(if git -C "$CODEX_GIT_ROLLBACK_RELEASE" config --local --get core.hooksPath >/dev/null 2>&1; then echo present; else echo absent; fi)"
else
  echo "skip: git is absent, so core.hooksPath rollback cannot be exercised"
  skipped=$((skipped + 1))
fi

# The region may not annex an operator-owned table of the same name. TOML does
# not permit two definitions, so silently appending the oso block would create a
# config Codex cannot parse; deleting the earlier table would be data loss.
CODEX_CONFLICT_HOME="$TEST_HOME/codex-conflict-home"
write_codex_install_personal_state "$CODEX_CONFLICT_HOME"
printf '%s\n' \
  '' \
  '[mcp_servers.context7]' \
  'url = "https://operator.example/context"' >> "$CODEX_CONFLICT_HOME/.codex/config.toml"
codex_conflict_before="$(install_file_snapshot "$CODEX_CONFLICT_HOME")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_CONFLICT_HOME"
codex_conflict_after="$(install_file_snapshot "$CODEX_CONFLICT_HOME")"
assert_equals "an owned TOML table outside the oso region is rejected" \
  "owned table conflict" "$(codex_install_log_class 'owned table conflict' 'oso-code-owned.*outside.*managed|outside.*oso-code|conflict.*context7')"
assert_equals "a conflicting config aborts before plugin or Engram wiring" \
  "0" "$(grep -Ec '^codex:plugin|^engram:' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "a conflicting config leaves every destination byte-identical" \
  "$codex_conflict_before" "$codex_conflict_after"

CODEX_FOREIGN_HOOKS_HOME="$TEST_HOME/codex-foreign-hooks-home"
write_codex_install_personal_state "$CODEX_FOREIGN_HOOKS_HOME"
printf '%s\n' '{"hooks":{"foreign":[]}}' > "$CODEX_FOREIGN_HOOKS_HOME/.codex/hooks.json"
foreign_hooks_before="$(install_file_snapshot "$CODEX_FOREIGN_HOOKS_HOME")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_FOREIGN_HOOKS_HOME"
foreign_hooks_after="$(install_file_snapshot "$CODEX_FOREIGN_HOOKS_HOME")"
assert_equals "a foreign user hooks manifest is rejected loudly" \
  "foreign hooks" "$(codex_install_log_class 'foreign hooks' 'foreign.*hooks|refus.*hooks')"
assert_equals "a foreign hooks refusal happens before plugin or Engram wiring" \
  "0" "$(grep -Ec '^codex:plugin|^engram:' "$CODEX_INSTALL_CALLS" || true)"
assert_equals "a foreign hooks refusal leaves every destination byte-identical" \
  "$foreign_hooks_before" "$foreign_hooks_after"

CODEX_SUBSTRING_HOOKS_HOME="$TEST_HOME/codex-substring-hooks-home"
write_codex_install_personal_state "$CODEX_SUBSTRING_HOOKS_HOME"
substring_runtime="$CODEX_SUBSTRING_HOOKS_HOME/.local/share/oso-code/runtime/hooks"
printf '%s\n' \
  '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"foreign-wrapper '"$substring_runtime"'/block-commit-until-green.sh"}]}]}}' \
  > "$CODEX_SUBSTRING_HOOKS_HOME/.codex/hooks.json"
substring_hooks_before="$(install_file_snapshot "$CODEX_SUBSTRING_HOOKS_HOME")"
run_codex_install "$CODEX_SUBSTRING_HOOKS_HOME"
assert_equals "mentioning the oso hooks path as an argument does not establish ownership" \
  "foreign hooks" "$(codex_install_log_class 'foreign hooks' 'foreign.*hooks|refus.*hooks')"
assert_equals "substring-only hook ownership leaves every destination byte-identical" \
  "$substring_hooks_before" "$(install_file_snapshot "$CODEX_SUBSTRING_HOOKS_HOME")"

CODEX_MIXED_HOOKS_HOME="$TEST_HOME/codex-mixed-hooks-home"
write_codex_install_personal_state "$CODEX_MIXED_HOOKS_HOME"
mixed_runtime="$CODEX_MIXED_HOOKS_HOME/.local/share/oso-code/runtime/hooks"
printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"OSO_AGENT=1 \\"%s\\"/block-commit-until-green.sh"},{"type":"prompt","prompt":"operator-owned"}]}]}}\n' \
  "$mixed_runtime" > "$CODEX_MIXED_HOOKS_HOME/.codex/hooks.json"
mixed_hooks_before="$(install_file_snapshot "$CODEX_MIXED_HOOKS_HOME")"
run_codex_install "$CODEX_MIXED_HOOKS_HOME"
assert_equals "one valid oso command cannot annex a second operator-owned hook handler" \
  "foreign hooks" "$(codex_install_log_class 'foreign hooks' 'foreign.*hooks|refus.*hooks')"
assert_equals "mixed hook ownership refusal preserves the complete manifest" \
  "$mixed_hooks_before" "$(install_file_snapshot "$CODEX_MIXED_HOOKS_HOME")"

CODEX_LINKED_AGENTS_HOME="$TEST_HOME/codex-linked-agents-home"
write_codex_install_personal_state "$CODEX_LINKED_AGENTS_HOME"
CODEX_LINKED_AGENTS_TARGET="$TEST_HOME/codex-personal-agent-target"
mkdir -p "$CODEX_LINKED_AGENTS_TARGET"
printf 'operator-owned linked role\n' > "$CODEX_LINKED_AGENTS_TARGET/personal.toml"
rm -rf "$CODEX_LINKED_AGENTS_HOME/.codex/agents"
ln -s "$CODEX_LINKED_AGENTS_TARGET" "$CODEX_LINKED_AGENTS_HOME/.codex/agents"
run_codex_install "$CODEX_LINKED_AGENTS_HOME"
assert_equals "a symlink-managed agents directory is rejected instead of rewritten" \
  "linked agents" "$(codex_install_log_class 'linked agents' 'symlinked Codex agents directory')"
assert_equals "agent symlink refusal preserves the link itself" \
  "$CODEX_LINKED_AGENTS_TARGET" "$(readlink "$CODEX_LINKED_AGENTS_HOME/.codex/agents")"
assert_equals "agent symlink refusal preserves its external target" \
  "operator-owned linked role" "$(cat "$CODEX_LINKED_AGENTS_TARGET/personal.toml")"

# Marker damage is ambiguity, never permission to delete through the next end
# marker or append a second region. Exercise each managed text file independently
# and require that refusal itself leave the malformed bytes untouched.
CODEX_BAD_CONFIG_HOME="$TEST_HOME/codex-bad-config-home"
mkdir -p "$CODEX_BAD_CONFIG_HOME"
cp -R "$CODEX_HAPPY_HOME/." "$CODEX_BAD_CONFIG_HOME/"
bad_config="$CODEX_BAD_CONFIG_HOME/.codex/config.toml"
bad_config_end='# oso-code:end'
awk -v marker="$bad_config_end" '$0 != marker { print }' "$bad_config" > "$bad_config.tmp"
mv "$bad_config.tmp" "$bad_config"
bad_config_before="$(file_sha256 "$bad_config")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_BAD_CONFIG_HOME"
assert_equals "an unmatched config marker is rejected as malformed" \
  "malformed config markers" "$(codex_install_log_class 'malformed config markers' 'config.*malformed.*oso-code.*marker|malformed.*config.*marker')"
assert_equals "a malformed config is untouched by the refused install" \
  "$bad_config_before" "$(file_sha256 "$bad_config")"

CODEX_BAD_GLOBAL_HOME="$TEST_HOME/codex-bad-global-home"
mkdir -p "$CODEX_BAD_GLOBAL_HOME"
cp -R "$CODEX_HAPPY_HOME/." "$CODEX_BAD_GLOBAL_HOME/"
bad_global="$CODEX_BAD_GLOBAL_HOME/.codex/AGENTS.md"
bad_global_start='<!-- oso-code:start -->'
printf '%s\n%s\n' "$bad_global_start" "$(cat "$bad_global")" > "$bad_global.tmp"
mv "$bad_global.tmp" "$bad_global"
bad_global_before="$(file_sha256 "$bad_global")"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_BAD_GLOBAL_HOME"
assert_equals "a duplicate global start marker is rejected as malformed" \
  "malformed global markers" "$(codex_install_log_class 'malformed global markers' 'AGENTS.*malformed.*oso-code.*marker|global.*malformed.*oso-code.*marker|malformed.*AGENTS.*marker')"
assert_equals "a malformed global file is untouched by the refused install" \
  "$bad_global_before" "$(file_sha256 "$bad_global")"

# --- Codex installer: migrates a pre-split plan-approval state file inside
# the transaction (ADR-0110/D20) -----------------------------------------------
# 526a558 (ADR-0107) split `session` (ownership) from `plan_approval_session`
# (who may approve or cancel a pending plan). A state file written before that
# split holds only the old key; installing the split without converting it
# manufactures the exact trap the split closes. state_key_of mirrors
# state_file_for exactly, so each digest below names the same path both the
# migration and the runtime hooks resolve for that repository identity.
CODEX_MIGRATION_HOME="$TEST_HOME/codex-migration-home"
write_codex_install_personal_state "$CODEX_MIGRATION_HOME"
mkdir -p "$CODEX_MIGRATION_HOME/.local/state/oso-code"

MIGRATION_ULID_REPO="$TEST_HOME/codex-migration-repo-ulid"
MIGRATION_MARKER_REPO="$TEST_HOME/codex-migration-repo-marker"
MIGRATION_SPLIT_REPO="$TEST_HOME/codex-migration-repo-split"
mkdir -p "$MIGRATION_ULID_REPO" "$MIGRATION_MARKER_REPO" "$MIGRATION_SPLIT_REPO"

migration_ulid_digest="$(state_key_of "$MIGRATION_ULID_REPO")"
migration_marker_digest="$(state_key_of "$MIGRATION_MARKER_REPO")"
migration_split_digest="$(state_key_of "$MIGRATION_SPLIT_REPO")"

migration_ulid_state="$CODEX_MIGRATION_HOME/.local/state/oso-code/${migration_ulid_digest}.state"
migration_marker_state="$CODEX_MIGRATION_HOME/.local/state/oso-code/${migration_marker_digest}.state"
migration_split_state="$CODEX_MIGRATION_HOME/.local/state/oso-code/${migration_split_digest}.state"

migration_plan_digest="$(printf '%064d' 0)"
migration_presenting_session="01hqtq0z7hzx6z0z1z2z3z4z5z"

# Case a: the old `session` value still names a real presenting session — that
# pending stays legitimately approvable, so it is backfilled, not cleared.
printf '%s\n' \
  'mode=plan' 'active_slice=none' 'verify_green=false' \
  'plan_approval=pending' \
  "plan_approval_digest=$migration_plan_digest" \
  "plan_snapshot_file=$MIGRATION_ULID_REPO/presented.md" \
  "plan_current_file=$MIGRATION_ULID_REPO/current.md" \
  'plan_revision=0' \
  "session=$migration_presenting_session" > "$migration_ulid_state"

# Case b: the old `session` value is the ownership marker — the presenting
# session is unrecoverable, so this pending is cleared rather than preserved.
printf '%s\n' \
  'mode=plan' 'active_slice=none' 'verify_green=false' \
  'plan_approval=pending' \
  "plan_approval_digest=$migration_plan_digest" \
  "plan_snapshot_file=$MIGRATION_MARKER_REPO/presented.md" \
  "plan_current_file=$MIGRATION_MARKER_REPO/current.md" \
  'plan_revision=0' \
  'session=1' > "$migration_marker_state"

# Case c: already carries the new key — migration must be idempotent.
printf '%s\n' \
  'mode=plan' 'active_slice=none' 'verify_green=false' \
  'plan_approval=pending' \
  "plan_approval_digest=$migration_plan_digest" \
  'plan_approval_session=01hqtq0zalreadysplit000000' \
  "plan_snapshot_file=$MIGRATION_SPLIT_REPO/presented.md" \
  "plan_current_file=$MIGRATION_SPLIT_REPO/current.md" \
  'plan_revision=0' \
  'session=1' > "$migration_split_state"
migration_split_before="$(file_sha256 "$migration_split_state")"

printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_MIGRATION_HOME"
assert_equals "an install that migrates plan-approval state still succeeds" \
  "zero" "$([ "$CODEX_INSTALL_RC" -eq 0 ] && echo zero || echo nonzero)"

assert_equals "a ULID-shaped pre-split session backfills plan_approval_session" \
  "$migration_presenting_session" \
  "$(sed -n 's/^plan_approval_session=//p' "$migration_ulid_state")"
assert_equals "the backfilled file keeps its original pending flag" \
  pending "$(sed -n 's/^plan_approval=//p' "$migration_ulid_state")"
assert_equals "the backfill is reported so the operator can see what moved" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Fc "$migration_ulid_digest" || true)"

assert_equals "a marker-owned pre-split pending is cleared, not left standing" \
  "absent" "$([ -e "$migration_marker_state" ] && echo present || echo absent)"
assert_equals "the clear is reported so the operator can see what moved" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Fc "$migration_marker_digest" || true)"

assert_equals "a state file already carrying plan_approval_session is untouched" \
  "$migration_split_before" "$(file_sha256 "$migration_split_state")"

# The positive consequence, not just the bookkeeping: before the clear, the
# leftover armed state denies any local tool outside the allowlist forever,
# since nothing on disk can ever approve or cancel it. After the clear there
# is no state file at all, so the catch-all is invisible again for this
# repository — proven with a tool the allowlist has never carried, since Bash
# would pass regardless of whether the pending were ever scoped to anyone.
migration_marker_probe_input="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{}}' \
  "codex-migration-marker-probe-session" "$MIGRATION_MARKER_REPO" FutureWriter)"
HOME="$CODEX_MIGRATION_HOME" run_hook "$UNKNOWN_TOOL_HOOK" "$migration_marker_probe_input" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "the cleared repository no longer denies a tool call at all" \
  [ -z "$hook_stdout" ]

# --- Codex installer: a partial rollback tells the truth (ADR-0110) ----------
# on_exit calls `rollback_transaction || true`, which turns off errexit for the
# whole function — the old code had no per-item check at all and always printed
# "rollback complete" regardless of what `rm -rf`/`cp -a` actually did. The shim
# below fails exactly the one restore call rollback issues for the fixture's
# config.toml (a `cp -a SRC DST` whose DST is that exact path); every other
# cp -a, including begin_transaction's own backup of the same file, passes
# through to the real binary untouched.
CODEX_ROLLBACK_HONESTY_HOME="$TEST_HOME/codex-rollback-honesty-home"
write_codex_install_personal_state "$CODEX_ROLLBACK_HONESTY_HOME"
rollback_honesty_target="$CODEX_ROLLBACK_HONESTY_HOME/.codex/config.toml"
real_cp="$(command -v cp)"
printf '%s\n' \
  '#!/bin/sh' \
  'printf '\''cp:%s\n'\'' "$*" >> "$OSO_TEST_CALLS"' \
  'if [ "$1" = "-a" ] && [ "$#" -eq 3 ] && [ "$3" = "$OSO_TEST_ROLLBACK_FAIL_TARGET" ]; then' \
  '  exit 1' \
  'fi' \
  'exec "$OSO_TEST_REAL_CP" "$@"' \
  > "$CODEX_INSTALL_SHIMS/cp"
chmod +x "$CODEX_INSTALL_SHIMS/cp"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
OSO_TEST_REAL_CP="$real_cp" OSO_TEST_ROLLBACK_FAIL_TARGET="$rollback_honesty_target" \
  run_codex_install "$CODEX_ROLLBACK_HONESTY_HOME" after-backup
rm -f "$CODEX_INSTALL_SHIMS/cp"
assert_equals "a rollback with a failed restore item still exits nonzero" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a failed restore item is never reported as a clean rollback" \
  "0" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Fc 'rollback complete' || true)"
assert_equals "the rollback report names the item that failed to restore" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Fc "$rollback_honesty_target" || true)"
assert_equals "the rollback report tells the operator the snapshot is still there to restore by hand" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Ec 'snapshot.*restore it by hand' || true)"

# --- Codex purge: total, reversible and confined to a fixture HOME -----------
# The operator's real migration is already complete. Every invocation below
# redirects HOME and CODEX_HOME into a disposable tree, while client shims make
# an accidental install, uninstall or login call a visible test failure.
PURGE_CODEX_SH="$REPO_ROOT/bootstrap/purge-codex.sh"
CODEX_PURGE_OUTPUT="$TEST_HOME/codex-purge-output"
CODEX_PURGE_CLIENT_CALLS="$TEST_HOME/codex-purge-client-calls"
CODEX_PURGE_SHIMS="$TEST_HOME/codex-purge-shims"
mkdir -p "$CODEX_PURGE_SHIMS"
for purge_client in codex npm; do
  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''%s:%s\n'\'' "$(basename "$0")" "$*" >> "$OSO_PURGE_CLIENT_CALLS"' \
    'exit 97' > "$CODEX_PURGE_SHIMS/$purge_client"
  chmod +x "$CODEX_PURGE_SHIMS/$purge_client"
done

write_codex_purge_fixture() {
  local fixture_home="$1"
  mkdir -p \
    "$fixture_home/.codex/plugins/gentle-ai" \
    "$fixture_home/.codex/agents" \
    "$fixture_home/.codex/personal/empty" \
    "$fixture_home/.agents/skills/gentle" \
    "$fixture_home/.agents/skills/oso-local" \
    "$fixture_home/.agents/personal/empty" \
    "$fixture_home/.claude" \
    "$fixture_home/.local/share/oso-code/runtime" \
    "$fixture_home/.local/state/oso-code/worktrees/keep"
  printf 'personal codex config\n' > "$fixture_home/.codex/config.toml"
  printf 'legacy gentle plugin\n' > "$fixture_home/.codex/plugins/gentle-ai/plugin.json"
  printf 'oso role\n' > "$fixture_home/.codex/agents/oso-applier.toml"
  printf '\001\002personal bytes\000\377' > "$fixture_home/.codex/personal/blob.bin"
  printf 'gentle skill\n' > "$fixture_home/.agents/skills/gentle/SKILL.md"
  printf 'personal oso skill\n' > "$fixture_home/.agents/skills/oso-local/SKILL.md"
  ln -s gentle "$fixture_home/.agents/skills/current"
  chmod 640 "$fixture_home/.codex/personal/blob.bin"
  chmod 750 "$fixture_home/.codex/personal" "$fixture_home/.agents/personal"
  printf 'claude survives\n' > "$fixture_home/.claude/sentinel"
  printf 'runtime survives\n' > "$fixture_home/.local/share/oso-code/runtime/sentinel"
  printf 'state survives\n' > "$fixture_home/.local/state/oso-code/worktrees/keep/sentinel"
}

purge_tree_snapshot() {
  local fixture_home="$1" path rel permissions digest
  for path in "$fixture_home/.codex" "$fixture_home/.agents"; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    find "$path" -print
  done | LC_ALL=C sort | while IFS= read -r path; do
    rel="${path#$fixture_home/}"
    permissions="$(LC_ALL=C ls -ld "$path" | awk '{ print $1 }')"
    if [ -L "$path" ]; then
      printf 'link %s %s -> %s\n' "$permissions" "$rel" "$(readlink "$path")"
    elif [ -d "$path" ]; then
      printf 'dir  %s %s\n' "$permissions" "$rel"
    elif [ -f "$path" ]; then
      digest="$(file_sha256 "$path")"
      printf 'file %s %s %s\n' "$permissions" "$rel" "$digest"
    else
      printf 'other %s %s\n' "$permissions" "$rel"
    fi
  done
}

purge_backup_count() {
  local fixture_home="$1" backup_parent
  backup_parent="$fixture_home/.local/state/oso-code/purge-backups"
  [ -d "$backup_parent" ] || { printf '0'; return; }
  find "$backup_parent" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' '
}

run_codex_purge() {
  local fixture_home="$1"
  shift
  : > "$CODEX_PURGE_CLIENT_CALLS"
  if HOME="$fixture_home" \
    CODEX_HOME="$fixture_home/.codex" \
    PATH="$CODEX_PURGE_SHIMS:$PATH" \
    OSO_PURGE_CLIENT_CALLS="$CODEX_PURGE_CLIENT_CALLS" \
    OSO_PURGE_FAIL_AFTER="${OSO_PURGE_FAIL_AFTER:-}" \
    bash "$PURGE_CODEX_SH" "$@" > "$CODEX_PURGE_OUTPUT" 2>&1; then
    CODEX_PURGE_RC=0
  else
    CODEX_PURGE_RC=$?
  fi
  CODEX_PURGE_LOG="$(cat "$CODEX_PURGE_OUTPUT")"
}

verify_purge_manifest() {
  local backup="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$backup" && sha256sum -c manifest.sha256 >/dev/null 2>&1)
  else
    (cd "$backup" && shasum -a 256 -c manifest.sha256 >/dev/null 2>&1)
  fi
}

purge_backup_snapshot() {
  local backup="$1" path
  find "$backup" -type f -print | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s %s\n' "${path#$backup/}" "$(file_sha256 "$path")"
  done
}

purge_backup_location() {
  local backup="$1" fixture_home="$2"
  case "$backup" in
    "$fixture_home"/.local/state/oso-code/purge-backups/*) printf 'inside' ;;
    *) printf 'outside' ;;
  esac
}

CODEX_PURGE_DECLINE_HOME="$TEST_HOME/codex-purge-decline-home"
write_codex_purge_fixture "$CODEX_PURGE_DECLINE_HOME"
codex_purge_decline_before="$(purge_tree_snapshot "$CODEX_PURGE_DECLINE_HOME")"
printf '\n' > "$TEST_HOME/codex-purge-decline-input"
: > "$CODEX_PURGE_CLIENT_CALLS"
if HOME="$CODEX_PURGE_DECLINE_HOME" \
  CODEX_HOME="$CODEX_PURGE_DECLINE_HOME/.codex" \
  PATH="$CODEX_PURGE_SHIMS:$PATH" \
  OSO_PURGE_CLIENT_CALLS="$CODEX_PURGE_CLIENT_CALLS" \
  bash "$PURGE_CODEX_SH" < "$TEST_HOME/codex-purge-decline-input" \
    > "$CODEX_PURGE_OUTPUT" 2>&1; then
  codex_purge_decline_rc=0
else
  codex_purge_decline_rc=$?
fi
assert_equals "the Codex purge defaults to no without explicit confirmation" \
  "nonzero" "$([ "$codex_purge_decline_rc" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "declining the Codex purge preserves both source trees exactly" \
  "$codex_purge_decline_before" "$(purge_tree_snapshot "$CODEX_PURGE_DECLINE_HOME")"
assert_equals "declining the Codex purge creates no backup" \
  "0" "$(purge_backup_count "$CODEX_PURGE_DECLINE_HOME")"

run_codex_purge "$CODEX_PURGE_DECLINE_HOME" --unknown
assert_equals "an unknown Codex purge flag is a usage error" \
  "2" "$CODEX_PURGE_RC"
assert_equals "a usage error preserves both Codex source trees exactly" \
  "$codex_purge_decline_before" "$(purge_tree_snapshot "$CODEX_PURGE_DECLINE_HOME")"

: > "$CODEX_PURGE_CLIENT_CALLS"
if HOME="$CODEX_PURGE_DECLINE_HOME" \
  CODEX_HOME="$TEST_HOME/outside-codex-home" \
  PATH="$CODEX_PURGE_SHIMS:$PATH" \
  OSO_PURGE_CLIENT_CALLS="$CODEX_PURGE_CLIENT_CALLS" \
  bash "$PURGE_CODEX_SH" --yes > "$CODEX_PURGE_OUTPUT" 2>&1; then
  codex_purge_override_rc=0
else
  codex_purge_override_rc=$?
fi
assert_equals "the purge rejects a CODEX_HOME outside HOME/.codex" \
  "nonzero" "$([ "$codex_purge_override_rc" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a CODEX_HOME refusal preserves both source trees exactly" \
  "$codex_purge_decline_before" "$(purge_tree_snapshot "$CODEX_PURGE_DECLINE_HOME")"

CODEX_PURGE_OVERLAP_HOME="$TEST_HOME/codex-purge-overlap-home"
write_codex_purge_fixture "$CODEX_PURGE_OVERLAP_HOME"
mkdir -p "$CODEX_PURGE_OVERLAP_HOME/.codex/backups"
ln -s ../../../.codex/backups \
  "$CODEX_PURGE_OVERLAP_HOME/.local/state/oso-code/purge-backups"
codex_purge_overlap_before="$(purge_tree_snapshot "$CODEX_PURGE_OVERLAP_HOME")"
run_codex_purge "$CODEX_PURGE_OVERLAP_HOME" --yes
assert_equals "a physical backup path inside a purge target is rejected" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "backup overlap refusal preserves both purge targets exactly" \
  "$codex_purge_overlap_before" "$(purge_tree_snapshot "$CODEX_PURGE_OVERLAP_HOME")"
assert_equals "backup overlap refusal preserves the indirection that exposed it" \
  "../../../.codex/backups" "$(readlink "$CODEX_PURGE_OVERLAP_HOME/.local/state/oso-code/purge-backups")"

CODEX_PURGE_ANCESTOR_HOME="$TEST_HOME/codex-purge-ancestor-home"
mkdir -p "$CODEX_PURGE_ANCESTOR_HOME/.codex/local" \
  "$CODEX_PURGE_ANCESTOR_HOME/.agents"
printf 'must remain byte-identical\n' > "$CODEX_PURGE_ANCESTOR_HOME/.codex/config.toml"
ln -s .codex/local "$CODEX_PURGE_ANCESTOR_HOME/.local"
codex_purge_ancestor_before="$(purge_tree_snapshot "$CODEX_PURGE_ANCESTOR_HOME")"
run_codex_purge "$CODEX_PURGE_ANCESTOR_HOME" --yes
assert_equals "backup ancestor overlap is rejected before mkdir can mutate a target" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "preflight overlap refusal leaves both purge targets byte-identical" \
  "$codex_purge_ancestor_before" "$(purge_tree_snapshot "$CODEX_PURGE_ANCESTOR_HOME")"
assert_equals "preflight overlap refusal creates no downstream backup directories" \
  "absent" "$([ ! -e "$CODEX_PURGE_ANCESTOR_HOME/.codex/local/state" ] && echo absent || echo present)"

CODEX_PURGE_EXTERNAL_HOME="$TEST_HOME/codex-purge-external-home"
CODEX_PURGE_EXTERNAL_PARENT="$TEST_HOME/codex-purge-external-parent"
mkdir -p "$CODEX_PURGE_EXTERNAL_HOME/.codex" \
  "$CODEX_PURGE_EXTERNAL_HOME/.agents" \
  "$CODEX_PURGE_EXTERNAL_PARENT"
printf 'external preflight source\n' > "$CODEX_PURGE_EXTERNAL_HOME/.codex/config.toml"
ln -s "$CODEX_PURGE_EXTERNAL_PARENT" "$CODEX_PURGE_EXTERNAL_HOME/.local"
codex_purge_external_before="$(purge_tree_snapshot "$CODEX_PURGE_EXTERNAL_HOME")"
run_codex_purge "$CODEX_PURGE_EXTERNAL_HOME" --yes
assert_equals "an external backup ancestor is rejected before mkdir" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "external ancestor refusal leaves both purge targets byte-identical" \
  "$codex_purge_external_before" "$(purge_tree_snapshot "$CODEX_PURGE_EXTERNAL_HOME")"
assert_equals "external ancestor refusal creates nothing outside fixture HOME" \
  "absent" "$([ ! -e "$CODEX_PURGE_EXTERNAL_PARENT/state" ] && echo absent || echo present)"

CODEX_PURGE_FAILURE_HOME="$TEST_HOME/codex-purge-failure-home"
write_codex_purge_fixture "$CODEX_PURGE_FAILURE_HOME"
codex_purge_failure_before="$(purge_tree_snapshot "$CODEX_PURGE_FAILURE_HOME")"
OSO_PURGE_FAIL_AFTER=after-backup run_codex_purge "$CODEX_PURGE_FAILURE_HOME" --yes
assert_equals "a deterministic failure after backup exits before deletion" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a verified-backup failure leaves both source trees exactly intact" \
  "$codex_purge_failure_before" "$(purge_tree_snapshot "$CODEX_PURGE_FAILURE_HOME")"
assert_equals "the pre-delete failure retains exactly one diagnostic backup" \
  "1" "$(purge_backup_count "$CODEX_PURGE_FAILURE_HOME")"
CODEX_PURGE_FAILURE_BACKUP="$(find "$CODEX_PURGE_FAILURE_HOME/.local/state/oso-code/purge-backups" -mindepth 1 -maxdepth 1 -type d -print | head -n 1)"
assert_equals "the retained pre-delete backup still passes its manifest" \
  "valid" "$(verify_purge_manifest "$CODEX_PURGE_FAILURE_BACKUP" && echo valid || echo invalid)"

CODEX_PURGE_HOME="$TEST_HOME/codex-purge-home"
write_codex_purge_fixture "$CODEX_PURGE_HOME"
codex_purge_before="$(purge_tree_snapshot "$CODEX_PURGE_HOME")"
run_codex_purge "$CODEX_PURGE_HOME" --yes
codex_purge_outcome="$CODEX_PURGE_RC"
if [ "$CODEX_PURGE_RC" -ne 0 ]; then
  codex_purge_outcome="$CODEX_PURGE_RC ($CODEX_PURGE_LOG)"
fi
assert_equals "the fixture-only Codex purge completes" "0" "$codex_purge_outcome"
CODEX_PURGE_BACKUP="$(printf '%s\n' "$CODEX_PURGE_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
assert_equals "the purge reports one absolute backup inside the fixture HOME" \
  "inside" "$(purge_backup_location "$CODEX_PURGE_BACKUP" "$CODEX_PURGE_HOME")"
assert_equals "the purge backup root has mode 0700" \
  "0700" "$([ -d "$CODEX_PURGE_BACKUP" ] && find "$CODEX_PURGE_BACKUP" -maxdepth 0 -type d -perm 0700 -print | grep -q . && echo 0700 || echo wrong)"

missing_purge_backup_file=""
for purge_backup_file in \
  format \
  codex-home.target codex-home.state codex-home.tar \
  agents-home.target agents-home.state agents-home.tar \
  manifest.sha256; do
  [ -f "$CODEX_PURGE_BACKUP/$purge_backup_file" ] \
    || missing_purge_backup_file="$missing_purge_backup_file $purge_backup_file"
done
assert_equals "the purge publishes its complete restorable backup contract" \
  "" "$missing_purge_backup_file"
missing_purge_manifest_row=""
for purge_manifest_path in \
  format \
  codex-home.target codex-home.state codex-home.tar \
  agents-home.target agents-home.state agents-home.tar; do
  awk -v path="$purge_manifest_path" '$2 == path { found++ } END { exit found == 1 ? 0 : 1 }' \
    "$CODEX_PURGE_BACKUP/manifest.sha256" \
    || missing_purge_manifest_row="$missing_purge_manifest_row $purge_manifest_path"
done
assert_equals "the purge manifest signs every decision-bearing backup file once" \
  "" "$missing_purge_manifest_row"
assert_equals "the purge records the exact Codex destination" \
  "$CODEX_PURGE_HOME/.codex" "$(cat "$CODEX_PURGE_BACKUP/codex-home.target")"
assert_equals "the purge records the exact shared agents destination" \
  "$CODEX_PURGE_HOME/.agents" "$(cat "$CODEX_PURGE_BACKUP/agents-home.target")"
assert_equals "the published purge manifest verifies every recorded payload" \
  "valid" "$(verify_purge_manifest "$CODEX_PURGE_BACKUP" && echo valid || echo invalid)"
assert_equals "the complete Codex tree is absent after its verified backup" \
  "absent" "$([ ! -e "$CODEX_PURGE_HOME/.codex" ] && [ ! -L "$CODEX_PURGE_HOME/.codex" ] && echo absent || echo present)"
assert_equals "the complete shared agents tree is absent after its verified backup" \
  "absent" "$([ ! -e "$CODEX_PURGE_HOME/.agents" ] && [ ! -L "$CODEX_PURGE_HOME/.agents" ] && echo absent || echo present)"
assert_equals "the purge preserves Claude state outside its two-target boundary" \
  "claude survives" "$(cat "$CODEX_PURGE_HOME/.claude/sentinel")"
assert_equals "the purge preserves the installed oso runtime outside its boundary" \
  "runtime survives" "$(cat "$CODEX_PURGE_HOME/.local/share/oso-code/runtime/sentinel")"
assert_equals "the purge preserves oso worktree state outside its boundary" \
  "state survives" "$(cat "$CODEX_PURGE_HOME/.local/state/oso-code/worktrees/keep/sentinel")"
assert_equals "the purge never invokes Codex, npm or login" \
  "0" "$(wc -l < "$CODEX_PURGE_CLIENT_CALLS" | tr -d ' ')"

codex_purge_backup_count="$(purge_backup_count "$CODEX_PURGE_HOME")"
run_codex_purge "$CODEX_PURGE_HOME" --yes
assert_equals "purging an already empty Codex home is idempotent" "0" "$CODEX_PURGE_RC"
assert_equals "an empty idempotent purge creates no redundant backup" \
  "$codex_purge_backup_count" "$(purge_backup_count "$CODEX_PURGE_HOME")"

CODEX_TAMPERED_PURGE_BACKUP="$TEST_HOME/codex-tampered-purge-backup"
cp -R "$CODEX_PURGE_BACKUP" "$CODEX_TAMPERED_PURGE_BACKUP"
printf 'tamper\n' >> "$CODEX_TAMPERED_PURGE_BACKUP/codex-home.tar"
run_codex_purge "$CODEX_PURGE_HOME" --restore "$CODEX_TAMPERED_PURGE_BACKUP"
assert_equals "a modified purge archive is rejected by its published digest" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a corrupt restore writes neither Codex destination" \
  "absent" "$([ ! -e "$CODEX_PURGE_HOME/.codex" ] && [ ! -e "$CODEX_PURGE_HOME/.agents" ] && echo absent || echo present)"

CODEX_TAMPERED_PURGE_METADATA="$TEST_HOME/codex-tampered-purge-metadata"
cp -R "$CODEX_PURGE_BACKUP" "$CODEX_TAMPERED_PURGE_METADATA"
printf 'absent\n' > "$CODEX_TAMPERED_PURGE_METADATA/codex-home.state"
run_codex_purge "$CODEX_PURGE_HOME" --restore "$CODEX_TAMPERED_PURGE_METADATA"
assert_equals "modified purge metadata is rejected by its published digest" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "corrupt absence metadata cannot silently omit a Codex restore" \
  "absent" "$([ ! -e "$CODEX_PURGE_HOME/.codex" ] && [ ! -e "$CODEX_PURGE_HOME/.agents" ] && echo absent || echo present)"

OSO_PURGE_FAIL_AFTER=after-codex-restore run_codex_purge \
  "$CODEX_PURGE_HOME" --restore "$CODEX_PURGE_BACKUP"
assert_equals "a failure after publishing the first restore target exits nonzero" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a partial restore failure rolls both destinations back to absent" \
  "absent" "$([ ! -e "$CODEX_PURGE_HOME/.codex" ] && [ ! -L "$CODEX_PURGE_HOME/.codex" ] && [ ! -e "$CODEX_PURGE_HOME/.agents" ] && [ ! -L "$CODEX_PURGE_HOME/.agents" ] && echo absent || echo present)"

purge_backup_before_restore="$(purge_backup_snapshot "$CODEX_PURGE_BACKUP")"
run_codex_purge "$CODEX_PURGE_HOME" --restore "$CODEX_PURGE_BACKUP"
codex_restore_outcome="$CODEX_PURGE_RC"
if [ "$CODEX_PURGE_RC" -ne 0 ]; then
  codex_restore_outcome="$CODEX_PURGE_RC ($CODEX_PURGE_LOG)"
fi
assert_equals "the verified Codex purge backup restores successfully" "0" "$codex_restore_outcome"
assert_equals "restore reproduces bytes, links, empty directories and modes" \
  "$codex_purge_before" "$(purge_tree_snapshot "$CODEX_PURGE_HOME")"
purge_backup_after_restore="$(purge_backup_snapshot "$CODEX_PURGE_BACKUP")"
assert_equals "a successful restore retains the verified backup unchanged" \
  "$purge_backup_before_restore" "$purge_backup_after_restore"

codex_restored_before_conflict="$(purge_tree_snapshot "$CODEX_PURGE_HOME")"
run_codex_purge "$CODEX_PURGE_HOME" --restore "$CODEX_PURGE_BACKUP"
assert_equals "restore refuses to merge over existing Codex destinations" \
  "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "a restore conflict leaves both existing trees exactly intact" \
  "$codex_restored_before_conflict" "$(purge_tree_snapshot "$CODEX_PURGE_HOME")"
assert_equals "a restore conflict leaves the backup manifest valid" \
  "valid" "$(verify_purge_manifest "$CODEX_PURGE_BACKUP" && echo valid || echo invalid)"

CODEX_PURGE_SYMLINK_HOME="$TEST_HOME/codex-purge-symlink-home"
mkdir -p "$CODEX_PURGE_SYMLINK_HOME/external-codex"
printf 'external target survives\n' > "$CODEX_PURGE_SYMLINK_HOME/external-codex/sentinel"
ln -s external-codex "$CODEX_PURGE_SYMLINK_HOME/.codex"
ln -s missing-agents-target "$CODEX_PURGE_SYMLINK_HOME/.agents"
run_codex_purge "$CODEX_PURGE_SYMLINK_HOME" --yes
CODEX_PURGE_SYMLINK_BACKUP="$(printf '%s\n' "$CODEX_PURGE_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
assert_equals "the total purge removes a symlinked Codex root without following it" \
  "absent" "$([ ! -e "$CODEX_PURGE_SYMLINK_HOME/.codex" ] && [ ! -L "$CODEX_PURGE_SYMLINK_HOME/.codex" ] && echo absent || echo present)"
assert_equals "the total purge removes a dangling agents root link" \
  "absent" "$([ ! -e "$CODEX_PURGE_SYMLINK_HOME/.agents" ] && [ ! -L "$CODEX_PURGE_SYMLINK_HOME/.agents" ] && echo absent || echo present)"
assert_equals "purging a root link preserves its external destination" \
  "external target survives" "$(cat "$CODEX_PURGE_SYMLINK_HOME/external-codex/sentinel")"
assert_equals "the backup records a symlinked Codex root without dereferencing it" \
  "symlink" "$(cat "$CODEX_PURGE_SYMLINK_BACKUP/codex-home.state")"
assert_equals "the backup records a dangling agents root link" \
  "symlink" "$(cat "$CODEX_PURGE_SYMLINK_BACKUP/agents-home.state")"
run_codex_purge "$CODEX_PURGE_SYMLINK_HOME" --restore "$CODEX_PURGE_SYMLINK_BACKUP"
assert_equals "restore recreates the exact Codex root link" \
  "external-codex" "$(readlink "$CODEX_PURGE_SYMLINK_HOME/.codex")"
assert_equals "restore recreates the exact dangling agents root link" \
  "missing-agents-target" "$(readlink "$CODEX_PURGE_SYMLINK_HOME/.agents")"
assert_equals "root-link restore still leaves the external destination unchanged" \
  "external target survives" "$(cat "$CODEX_PURGE_SYMLINK_HOME/external-codex/sentinel")"

# --- Codex verifier: fixture failures still produce the complete report -------
VERIFY_CODEX_SH="$REPO_ROOT/bootstrap/verify-codex.sh"
CODEX_VERIFY_HOME="$TEST_HOME/codex-verify-home"
CODEX_VERIFY_SHIMS="$TEST_HOME/codex-verify-shims"
CODEX_VERIFY_CALLS="$TEST_HOME/codex-verify-calls"
CODEX_VERIFY_OUTPUT="$TEST_HOME/codex-verify-output"
mkdir -p "$CODEX_VERIFY_HOME" "$CODEX_VERIFY_SHIMS"
mkdir -p "$CODEX_VERIFY_HOME/.codex"
cat > "$CODEX_VERIFY_HOME/.codex/config.toml" <<EOF
decoy = """
default_permissions = "oso"
hooks = true
multi_agent = true
max_threads = 4
max_depth = 2
job_max_runtime_seconds = 1800
OSO_AGENT = "1"
[permissions.oso]
[permissions.oso.network]
[mcp_servers.context7]
[mcp_servers.fallow]
$CODEX_VERIFY_HOME/.local/share/oso-code/runtime/bin/oso-state
$CODEX_VERIFY_HOME/.local/state/oso-code/worktrees
"""
EOF
: > "$CODEX_VERIFY_CALLS"
printf '%s\n' \
  '#!/bin/sh' \
  'printf '\''%s\n'\'' "$*" >> "$OSO_VERIFY_CODEX_CALLS"' \
  'case "$*" in' \
  '  "--version") printf '\''codex-cli 0.145.0\n'\''; exit 0 ;;' \
  '  *) exit 97 ;;' \
  'esac' > "$CODEX_VERIFY_SHIMS/codex"
chmod +x "$CODEX_VERIFY_SHIMS/codex"

if HOME="$CODEX_VERIFY_HOME" \
  CODEX_HOME="$CODEX_VERIFY_HOME/.codex" \
  PATH="$CODEX_VERIFY_SHIMS:$PATH" \
  OSO_VERIFY_CODEX_CALLS="$CODEX_VERIFY_CALLS" \
  OSO_VERIFY_SKIP_SMOKE=1 \
  bash "$VERIFY_CODEX_SH" > "$CODEX_VERIFY_OUTPUT" 2>&1; then
  codex_verify_rc=0
else
  codex_verify_rc=$?
fi
codex_verify_report="$(cat "$CODEX_VERIFY_OUTPUT")"
assert_equals "an incomplete Codex fixture makes verification fail" \
  "nonzero" "$([ "$codex_verify_rc" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "the Codex verifier exercises multiple failures before its footer" \
  "multiple" "$([ "$(grep -c '^FAIL:' "$CODEX_VERIFY_OUTPUT" || true)" -ge 2 ] && echo multiple || echo too-few)"
assert_equals "config decoys outside an owned region cannot satisfy verification" \
  "malformed" "$(sed -n 's/^FAIL: managed Codex config — expected valid, got //p' "$CODEX_VERIFY_OUTPUT")"
assert_equals "the Codex verifier exercises the installed plan artifact contract" \
  "1" "$(grep -c '^FAIL: installed Codex plan artifact round-trip' "$CODEX_VERIFY_OUTPUT" || true)"
assert_equals "the Codex verifier always reaches exactly one final summary" \
  "1" "$(printf '%s\n' "$codex_verify_report" | grep -c '^passed:' || true)"
codex_authenticated_calls="$(grep -Ec '^(login([[:space:]]|$)|exec([[:space:]]|$))' "$CODEX_VERIFY_CALLS" || true)"
assert_equals "fixture verification never attempts Codex authentication or execution" \
  "0" "$codex_authenticated_calls"

echo "----"
echo "passed: $pass, failed: $fail, skipped: $skipped"
[ "$fail" -eq 0 ]
