#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$REPO_ROOT/plugin"
TEST_HOME="$(mktemp -d)"
trap 'rm -rf "$TEST_HOME"' EXIT
export HOME="$TEST_HOME"
USERPROFILE="$TEST_HOME"
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    USERPROFILE="$(cygpath -m "$TEST_HOME" 2>/dev/null || printf '%s' "$TEST_HOME")"
    ;;
esac
export USERPROFILE
export PATH="$PLUGIN/bin:$PATH"
unset GIT_CONFIG_GLOBAL OSO_AGENT OSO_STATE_BIN \
  XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
. "$REPO_ROOT/bootstrap/lib/verification-fixtures.sh"
. "$REPO_ROOT/bootstrap/lib/opencode-verification.sh"
SESSION="test-session"
cd "$REPO_ROOT"
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

oso_nightly_only() {
  local name="$1"
  if [ "${OSO_NIGHTLY:-}" = 1 ]; then
    return 0
  fi
  echo "skip: $name — reads the developer machine, so it waits for OSO_NIGHTLY=1"
  skipped=$((skipped + 1))
  return 1
}

TRANSCRIPT="$HOME/.claude/projects/oso-code/$SESSION.jsonl"
bash_input() {
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"%s","description":"regression case"}}' \
    "${3:-$SESSION}" "$TRANSCRIPT" "${2:-$REPO_ROOT}" "$1"
}
edit_input="$(printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.ts","old_string":"const slice = 1;","new_string":"const slice = 2;","replace_all":false}}' \
  "$SESSION" "$TRANSCRIPT" "$REPO_ROOT")"

CRASH_HOOK="$REPO_ROOT/tests/fixtures/crashing-hook.sh"
crash_report="$(assert_allows "crashing hook" "$CRASH_HOOK" "$(bash_input 'npm test')")"
case "$crash_report" in
  "FAIL: crashing hook"*) echo "ok: a crashing hook is reported as a named FAIL"; pass=$((pass + 1)) ;;
  *) echo "FAIL: crashing hook went unreported — got: ${crash_report:-<empty>}"; fail=$((fail + 1)) ;;
esac
assert_allows "a declared hook crash is not a case failure" "$CRASH_HOOK" "$(bash_input 'npm test')" 1 'simulated hook failure'

hooks_manifest="$PLUGIN/hooks/hooks.json"
gated_tools="$(sed -n 's/.*"matcher"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$hooks_manifest" | tr '|' '\n' | LC_ALL=C sort | tr '\n' ' ')"
expected_tools="$(printf '%s\n' Bash Bash Edit MultiEdit NotebookEdit Write 'mcp__.*deploy.*' mcp__fallow__fix_apply | LC_ALL=C sort | tr '\n' ' ')"
assert_equals "PreToolUse matchers cover exactly the gated tools" "$expected_tools" "$gated_tools"

codex_hooks_manifest="$REPO_ROOT/codex/hooks/hooks.json"
event_group_in() {
  awk -v heading="    \"$2\": [" '
    $0 == heading { inside = 1 }
    inside { print }
    inside && /^    ](,)?$/ { exit }
  ' "$1"
}
for matcherless_event in Stop UserPromptSubmit; do
  matcherless_group="$(event_group_in "$codex_hooks_manifest" "$matcherless_event")"
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

prod_gate_matcher_in() {
  awk '
    /"matcher"/ { matcher = $0; sub(/^[^:]*: "/, "", matcher); sub(/",$/, "", matcher) }
    /proddeploy/ { print matcher; exit }
  ' "$1"
}

gates_named_in() {
  sed -n 's|.*/gate\.js", "\([a-z]*\)".*|\1|p;s|.*/gate\.js \([a-z]*\).*|\1|p' \
    | tr '\n' ' ' | sed 's/ *$//'
}
assert_equals "both hosts route the shell tool and deploy-shaped MCP names into the production boundary" \
  'Bash|mcp__.*deploy.*+Bash|mcp__.*deploy.*' \
  "$(prod_gate_matcher_in "$hooks_manifest")+$(prod_gate_matcher_in "$codex_hooks_manifest")"

claude_stop_group="$(event_group_in "$hooks_manifest" Stop)"
assert_equals "the Claude manifest runs exactly the continuation net on Stop" \
  "autocontinue" \
  "$(printf '%s\n' "$claude_stop_group" | gates_named_in)"
assert_equals "the Claude Stop handler stays matcherless" \
  "0" "$(printf '%s\n' "$claude_stop_group" | grep -c '"matcher"' || true)"
assert_equals "the Claude-only continuation net is absent from the Codex manifest" \
  "0" "$(grep -c 'gate\.js autocontinue' "$codex_hooks_manifest" || true)"
assert_equals "rendering the continuation net leaves the Codex manifest on its published bytes" \
  "$(sed -n 's|^\([0-9a-f]*\)  codex/hooks/hooks.json$|\1|p' "$REPO_ROOT/bootstrap/hook-hashes.txt")" \
  "$({ sha256sum "$codex_hooks_manifest" 2>/dev/null || shasum -a 256 "$codex_hooks_manifest" 2>/dev/null; } | awk '{ print $1 }')"

claude_session_start_group="$(event_group_in "$hooks_manifest" SessionStart)"
assert_equals "the compaction re-anchor runs last on Claude session-start and nowhere on Codex" \
  "statebin stale version reanchor|0" \
  "$(printf '%s\n' "$claude_session_start_group" | gates_named_in)|$(grep -c 'gate\.js reanchor' "$codex_hooks_manifest" || true)"

unrunnable=""
manifest_bundles="$(sed -n 's/.*"args": \["\([^"]*\)".*/\1/p' "$hooks_manifest")"
while IFS= read -r manifest_bundle; do
  [ -n "$manifest_bundle" ] || continue
  hook_bundle="${manifest_bundle//\$\{CLAUDE_PLUGIN_ROOT\}/$PLUGIN}"
  [ -r "$hook_bundle" ] || unrunnable="$unrunnable $hook_bundle"
done <<< "$manifest_bundles"
assert_equals "every hooks.json handler names a bundle the plugin tree carries" "" "$unrunnable"
assert_equals "every hooks.json handler runs that bundle through node rather than a shell" \
  "$(grep -c '"command":' "$hooks_manifest" || true)" \
  "$(grep -c '"command": "node",$' "$hooks_manifest" || true)"
assert_equals "the bundle-naming scan read every handler the Claude manifest declares" \
  "$(grep -c '"command":' "$hooks_manifest" || true)" \
  "$(printf '%s\n' "$manifest_bundles" | grep -c . || true)"

tracked_text_files_missing_a_final_newline() {
  local eol_row file
  while IFS= read -r eol_row; do
    case "$eol_row" in 'i/-text'*) continue ;; esac
    file="${eol_row##*"$(printf '\t')"}"
    [ -f "$REPO_ROOT/$file" ] && [ -s "$REPO_ROOT/$file" ] || continue
    [ -z "$(tail -c 1 "$REPO_ROOT/$file")" ] || printf '%s\n' "$file"
  done <<< "$(git -C "$REPO_ROOT" ls-files --eol 2>/dev/null)"
}

sourced_shell_dependency_of() {
  local line="$1" target
  case "$line" in
    *')'*) target="${line##*)}" ;;
    *'$'*) target="${line##*\$}" ;;
    *) return 1 ;;
  esac
  case "$target" in
    */*) target="${target#*/}" ;;
    *) return 1 ;;
  esac
  while [ "$target" != "${target#../}" ]; do
    target="${target#../}"
  done
  target="${target%\"}"
  case "$target" in
    *.sh) printf '%s' "$target" ;;
    *) return 1 ;;
  esac
}

index_carries_a_path_ending_in() {
  local tracked="$1" target="$2" path
  while IFS= read -r path; do
    case "$path" in
      "$target"|*"/$target") return 0 ;;
    esac
  done <<< "$tracked"
  return 1
}

sourced_shell_dependencies_missing_from_the_index() {
  local repository="$1" tracked shell_file line target
  tracked="$(git -C "$repository" ls-files)"
  while IFS= read -r shell_file; do
    case "$shell_file" in *.sh) ;; *) continue ;; esac
    [ -r "$repository/$shell_file" ] || continue
    while IFS= read -r line; do
      target="$(sourced_shell_dependency_of "$line")" || continue
      index_carries_a_path_ending_in "$tracked" "$target" ||
        printf '%s sources %s\n' "$shell_file" "$target"
    done <<< "$(grep -E '^[[:space:]]*(\.|source)[[:space:]]' "$repository/$shell_file" || true)"
  done <<< "$tracked"
}

if git -C "$REPO_ROOT" ls-files --eol >/dev/null 2>&1; then
  assert_equals "every tracked text file ends in a newline, so appending to one never joins two lines" \
    "" "$(tracked_text_files_missing_a_final_newline | tr '\n' ' ' | sed 's/ *$//')"
  assert_equals "every shell dependency a shipped script sources is in the index, so no clone gets a script whose library never travelled with it" \
    "" "$(sourced_shell_dependencies_missing_from_the_index "$REPO_ROOT" | tr '\n' ' ' | sed 's/ *$//')"

  SOURCED_DEPENDENCY_FIXTURE="$TEST_HOME/sourced-dependency"
  mkdir -p "$SOURCED_DEPENDENCY_FIXTURE/lib"
  git -C "$SOURCED_DEPENDENCY_FIXTURE" init -q
  printf '#!/usr/bin/env bash\n. "$SCRIPT_DIR/lib/shipped.sh"\n' \
    > "$SOURCED_DEPENDENCY_FIXTURE/install-thing.sh"
  printf 'shipped() { :; }\n' > "$SOURCED_DEPENDENCY_FIXTURE/lib/shipped.sh"
  git -C "$SOURCED_DEPENDENCY_FIXTURE" add install-thing.sh
  assert_equals "a shipped script whose sourced library stands on disk and never reached the index is named before a clone finds it broken" \
    "install-thing.sh sources lib/shipped.sh" \
    "$(sourced_shell_dependencies_missing_from_the_index "$SOURCED_DEPENDENCY_FIXTURE")"
  git -C "$SOURCED_DEPENDENCY_FIXTURE" add lib/shipped.sh
  assert_equals "and the same tree reads clean once that library is tracked, so the rule answers the index rather than the disk" \
    "" "$(sourced_shell_dependencies_missing_from_the_index "$SOURCED_DEPENDENCY_FIXTURE")"
else
  echo "skip: no git here to list the tracked files a final-newline check and a sourced-dependency check both read"
  skipped=$((skipped + 1))
fi

if lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" 2>&1)"; then
  echo "ok: plugin frontmatter and cross-references lint clean"; pass=$((pass + 1))
else
  echo "FAIL: plugin lint — $(printf '%s' "$lint_report" | tr '\n' ' ')"; fail=$((fail + 1))
fi

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

copy_lint_fixture() {
  local destination="$1"
  mkdir -p "$destination"
  tar -c -C "$REPO_ROOT" --exclude node_modules \
    plugin codex opencode docs bootstrap tests tools README.md CHANGELOG.md \
    | tar -x -C "$destination"
}

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

LINT_EXECUTABLE_CITATION_FIXTURE="$TEST_HOME/lint-executable-citation"
copy_lint_fixture "$LINT_EXECUTABLE_CITATION_FIXTURE"
printf '# D22: the ledger entry that ordered this remedy.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/plugin/hooks/lib.sh"
printf '# ADR-0911 is why this check reports the way it does.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/verify.sh"
printf '# docs/decisions/0926 is the record behind this case.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/tests/hooks-test.sh"
printf '# 0113 settled the scope this key is read under.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/plugin/bin/oso-state"
printf '# ADR-0947 is the record this mount step came from.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/lib/mount-impeccable.sh"
printf '# docs/decisions/0933 is why this guard refuses the commit.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/plugin/git-hooks/pre-commit"
printf '# 0068 is the scope this fixture was written for.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/tests/fixtures/crashing-hook.sh"
printf '# A4 is the amendment that added this emitter.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/tools/render-hooks-json.sh"
printf 'REM ADR-0952 is the record this window handling came from.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/verify.bat"
printf ':: docs/decisions/0958 is why this entry point hands off.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/install.bat"
printf '# 0116 is the scope this provisioning step was cut to.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/install.ps1"
printf '# S3 is the amendment this region splitter answers to.\n' \
  >> "$LINT_EXECUTABLE_CITATION_FIXTURE/bootstrap/lib/toml-regions.awk"
if executable_citation_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_EXECUTABLE_CITATION_FIXTURE/plugin" "$LINT_EXECUTABLE_CITATION_FIXTURE" 2>&1)"; then
  echo "FAIL: check_executables_carry_no_decision_citations accepted decision citations in every path pattern it scans"; fail=$((fail + 1))
else
  for cited_executable in plugin/hooks/lib.sh bootstrap/verify.sh tests/hooks-test.sh \
      plugin/bin/oso-state bootstrap/lib/mount-impeccable.sh plugin/git-hooks/pre-commit \
      tests/fixtures/crashing-hook.sh tools/render-hooks-json.sh bootstrap/verify.bat \
      bootstrap/install.bat bootstrap/install.ps1 bootstrap/lib/toml-regions.awk; do
    case "$executable_citation_lint_report" in
      *"$cited_executable:"*"cites a decision id in a comment"*)
        echo "ok: check_executables_carry_no_decision_citations names $cited_executable"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: check_executables_carry_no_decision_citations never named $cited_executable — $(printf '%s' "$executable_citation_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  done
fi

LINT_SHELL_COMMENT_FIXTURE="$TEST_HOME/lint-shell-comment"
copy_lint_fixture "$LINT_SHELL_COMMENT_FIXTURE"
printf '\n# a reason nobody checks, written below the code it describes\n' \
  >> "$LINT_SHELL_COMMENT_FIXTURE/tools/verify-check-names.sh"
if shell_comment_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_SHELL_COMMENT_FIXTURE/plugin" "$LINT_SHELL_COMMENT_FIXTURE" 2>&1)"; then
  echo "FAIL: check_shell_sources_carry_no_comment_below_their_contract_header accepted a comment written below a script's code"; fail=$((fail + 1))
else
  case "$shell_comment_lint_report" in
    *"tools/verify-check-names.sh:"*"is a comment below its file's first line of code"*)
      echo "ok: check_shell_sources_carry_no_comment_below_their_contract_header rejects a comment written below a script's code"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: the shell-comment mutation failed for the wrong reason — $(printf '%s' "$shell_comment_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
  esac
fi

LINT_HEREDOC_BODY_FIXTURE="$TEST_HOME/lint-heredoc-body"
copy_lint_fixture "$LINT_HEREDOC_BODY_FIXTURE"
cat >> "$LINT_HEREDOC_BODY_FIXTURE/tools/verify-check-names.sh" <<'APPENDED_HEREDOC_CASE'

cat > /dev/null <<'FIXTURE_BODY'
# a heading a fixture writes into a document, which is data and no comment at all
FIXTURE_BODY
APPENDED_HEREDOC_CASE
if heredoc_body_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_HEREDOC_BODY_FIXTURE/plugin" "$LINT_HEREDOC_BODY_FIXTURE" 2>&1)"; then
  echo "ok: a hash-leading line inside a heredoc body is data the comment rule never reads as a comment"; pass=$((pass + 1))
else
  echo "FAIL: a hash-leading heredoc body line was read as a comment — $(printf '%s' "$heredoc_body_lint_report" | tr '\n' ' ')"; fail=$((fail + 1))
fi

LINT_HOME_PATH_FIXTURE="$TEST_HOME/lint-home-path"
copy_lint_fixture "$LINT_HOME_PATH_FIXTURE"
printf 'skill registry cached at %s/.config/some-tool/registry\n' "$HOME" \
  >> "$LINT_HOME_PATH_FIXTURE/docs/blueprint.md"
if home_path_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_HOME_PATH_FIXTURE/plugin" "$LINT_HOME_PATH_FIXTURE" 2>&1)"; then
  echo "FAIL: check_no_shipped_file_carries_the_home_path_of_whoever_runs_this accepted a file carrying this machine's own home directory"; fail=$((fail + 1))
else
  case "$home_path_lint_report" in
    *"docs/blueprint.md carries the absolute home directory of whoever runs this check"*)
      echo "ok: check_no_shipped_file_carries_the_home_path_of_whoever_runs_this names the file carrying this machine's own home directory"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: the home-path mutation failed for the wrong reason — $(printf '%s' "$home_path_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
  esac
fi

LINT_HOME_PATH_SCAN_EMPTY_FIXTURE="$TEST_HOME/lint-home-path-scan-empty"
mkdir -p "$LINT_HOME_PATH_SCAN_EMPTY_FIXTURE"
home_path_scan_empty_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
  "$PLUGIN" "$LINT_HOME_PATH_SCAN_EMPTY_FIXTURE" 2>&1 || true)"
case "$home_path_scan_empty_report" in
  *"the scan for files naming this machine's home directory read nothing under"*)
    echo "ok: a scan whose repo root carries no file says so instead of reporting no home-directory carrier"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: a scan with nothing under repo root reported no home-directory carrier in silence — $(printf '%s' "$home_path_scan_empty_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
esac

LINT_DOT_DIRECTORY_FIXTURE="$TEST_HOME/lint-dot-directory"
copy_lint_fixture "$LINT_DOT_DIRECTORY_FIXTURE"
mkdir -p "$LINT_DOT_DIRECTORY_FIXTURE/.some-tool-cache"
printf 'regenerable cache the tool rewrites on every run\n' \
  > "$LINT_DOT_DIRECTORY_FIXTURE/.some-tool-cache/registry.md"
if dot_directory_lint_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_DOT_DIRECTORY_FIXTURE/plugin" "$LINT_DOT_DIRECTORY_FIXTURE" 2>&1)"; then
  echo "FAIL: check_every_dot_directory_is_repo_owned_or_ignored accepted an undeclared tool cache beside the repository's own directories"; fail=$((fail + 1))
else
  case "$dot_directory_lint_report" in
    *".some-tool-cache/ is neither one of this repository's own directories nor a line in .gitignore"*)
      echo "ok: check_every_dot_directory_is_repo_owned_or_ignored names an undeclared tool cache by its own directory"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: the tool-cache mutation failed for the wrong reason — $(printf '%s' "$dot_directory_lint_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
  esac
fi
printf '.some-tool-cache/\n' > "$LINT_DOT_DIRECTORY_FIXTURE/.gitignore"
if ignored_dot_directory_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_DOT_DIRECTORY_FIXTURE/plugin" "$LINT_DOT_DIRECTORY_FIXTURE" 2>&1)"; then
  echo "ok: the same tool cache named in .gitignore closes the finding rather than needing an allowlist entry"; pass=$((pass + 1))
else
  echo "FAIL: an ignored tool cache still read as publishable — $(printf '%s' "$ignored_dot_directory_report" | tr '\n' ' ')"; fail=$((fail + 1))
fi

LINT_OPENCODE_INVOCATION_FIXTURE="$TEST_HOME/lint-opencode-invocation"
copy_lint_fixture "$LINT_OPENCODE_INVOCATION_FIXTURE"
opencode_invocation_target="$LINT_OPENCODE_INVOCATION_FIXTURE/tools/verify-check-names.sh"
printf 'cat <<PROBE\nenv OSO_PROBE=1 opencode --version\nPROBE\ntimeout 5 opencode --version\n' \
  >> "$opencode_invocation_target"
opencode_invocation_line="$(wc -l < "$opencode_invocation_target" | tr -d ' ')"
opencode_heredoc_line=$((opencode_invocation_line - 2))
if opencode_invocation_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
    "$LINT_OPENCODE_INVOCATION_FIXTURE/plugin" "$LINT_OPENCODE_INVOCATION_FIXTURE" 2>&1)"; then
  echo "FAIL: a wrapped opencode invocation in a scanned script passed plugin lint"; fail=$((fail + 1))
else
  case "$opencode_invocation_report" in
    *"tools/verify-check-names.sh:$opencode_heredoc_line "*)
      echo "FAIL: the rule read a heredoc body as a command it runs"; fail=$((fail + 1)) ;;
    *"tools/verify-check-names.sh:$opencode_invocation_line makes the opencode binary its own command word"*)
      echo "ok: the rule names a wrapped opencode invocation and leaves the same text in a heredoc body alone"; pass=$((pass + 1)) ;;
    *)
      echo "FAIL: the wrapped-invocation mutation failed for the wrong reason — $(printf '%s' "$opencode_invocation_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
  esac
fi

LINT_OPENCODE_LEXED_FORMS_FIXTURE="$TEST_HOME/lint-opencode-lexed-forms"
copy_lint_fixture "$LINT_OPENCODE_LEXED_FORMS_FIXTURE"
opencode_lexed_forms_target="$LINT_OPENCODE_LEXED_FORMS_FIXTURE/tools/verify-check-names.sh"
opencode_lexed_forms_base="$(wc -l < "$opencode_lexed_forms_target" | tr -d ' ')"
opencode_lexed_forms_bound="$(sed -n 's/^LEX_MAX_INPUT_BYTES=//p' "$PLUGIN/hooks/lexer.sh" | head -1)"
opencode_lexed_forms_pad="$(printf '%*s' "$opencode_lexed_forms_bound" '' | tr ' ' x)"
printf '%s\n' \
  "bash <<'SH'" \
  'opencode --version' \
  'SH' \
  'case "$1" in opencode) opencode --version ;; esac' \
  '"$OPENCODE_CONTRACT_BAR" --report' \
  '"$OPENCODE_INSTALLER" --check' \
  'opencode' \
  'opencode >/dev/null' \
  'opencode </dev/null' \
  'opencode 2>&1' \
  'opencode >log 2>&1' \
  '"$OPENCODE_EXE" --version' \
  '"$OPENCODE_PATH" --version' \
  '"$OPENCODE_CMD" --version' \
  '"$OPENCODE_CLI" --version' \
  '"$OPENCODE_BIN_PATH" --version' \
  "opencode --version --pad=$opencode_lexed_forms_pad" \
  >> "$opencode_lexed_forms_target"
opencode_lexed_forms_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
  "$LINT_OPENCODE_LEXED_FORMS_FIXTURE/plugin" "$LINT_OPENCODE_LEXED_FORMS_FIXTURE" 2>&1 || true)"
opencode_lexed_forms_sites="$(printf '%s\n' "$opencode_lexed_forms_report" \
  | sed -n 's|^lint: tools/verify-check-names\.sh:\([0-9]*\) makes the opencode binary.*|\1|p' \
  | LC_ALL=C sort -n | tr '\n' ' ')"
assert_equals "the rule reads a shell-fed heredoc body and a case header's own line as commands, flags the binary under every suffix a variable spells a path to it with, and leaves a repo script named by an OPENCODE_* variable, every redirect-only spelling and a unit past the lexer's input bound alone" \
  "$((opencode_lexed_forms_base + 1)) $((opencode_lexed_forms_base + 4)) $((opencode_lexed_forms_base + 12)) $((opencode_lexed_forms_base + 13)) $((opencode_lexed_forms_base + 14)) $((opencode_lexed_forms_base + 15)) $((opencode_lexed_forms_base + 16)) " \
  "$opencode_lexed_forms_sites"

LINT_OPENCODE_SCAN_EMPTY_FIXTURE="$TEST_HOME/lint-opencode-scan-empty"
copy_lint_fixture "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"
rm -f "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"/tests/*.sh \
  "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"/tests/fixtures/*.sh \
  "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"/bootstrap/lib/*.sh \
  "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"/bootstrap/verify-*.sh \
  "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE"/tools/*.sh
opencode_scan_empty_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
  "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE/plugin" "$LINT_OPENCODE_SCAN_EMPTY_FIXTURE" 2>&1 || true)"
case "$opencode_scan_empty_report" in
  *"reached no readable shell source"*"scanned nothing"*)
    echo "ok: a scan whose sources all vanished says so instead of reporting zero opencode invocations"; pass=$((pass + 1)) ;;
  *)
    echo "FAIL: a scan with no readable source reported zero opencode invocations in silence — $(printf '%s' "$opencode_scan_empty_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
esac

LINT_PARITY_VERSION_FIXTURE="$TEST_HOME/lint-parity-version"
copy_lint_fixture "$LINT_PARITY_VERSION_FIXTURE"
parity_version_target="$LINT_PARITY_VERSION_FIXTURE/docs/parity-opencode.md"
parity_version_pin="$(sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' \
  "$REPO_ROOT/bootstrap/install-opencode.sh" | head -1)"
if [ -z "$parity_version_pin" ] || ! grep -q "OpenCode $parity_version_pin" "$parity_version_target"; then
  echo "FAIL: the parity-version mutation found no OpenCode version to diverge in docs/parity-opencode.md"; fail=$((fail + 1))
else
  sed "s/OpenCode $parity_version_pin/OpenCode 1.19.0/" "$parity_version_target" > "$parity_version_target.tmp"
  mv "$parity_version_target.tmp" "$parity_version_target"
  if parity_version_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_PARITY_VERSION_FIXTURE/plugin" "$LINT_PARITY_VERSION_FIXTURE" 2>&1)"; then
    echo "FAIL: a parity doc naming a harness version that disagrees with its installer pin passed plugin lint"; fail=$((fail + 1))
  else
    case "$parity_version_report" in
      *"docs/parity-opencode.md names 1.19.0, which disagrees with the $parity_version_pin pin bootstrap/install-opencode.sh states"*)
        echo "ok: check_parity_docs_agree_on_harness_version rejects a parity doc that disagrees with its installer pin"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the parity-version mutation failed for the wrong reason — $(printf '%s' "$parity_version_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_OPENCODE_WRAPPER_FIXTURE="$TEST_HOME/lint-opencode-wrapper"
copy_lint_fixture "$LINT_OPENCODE_WRAPPER_FIXTURE"
opencode_wrapper_target="$LINT_OPENCODE_WRAPPER_FIXTURE/opencode/skills/oso-plan/SKILL.md"
if [ ! -f "$opencode_wrapper_target" ]; then
  echo "FAIL: the absent-wrapper mutation has no OpenCode plan wrapper to remove"; fail=$((fail + 1))
else
  rm "$opencode_wrapper_target"
  if opencode_wrapper_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_OPENCODE_WRAPPER_FIXTURE/plugin" "$LINT_OPENCODE_WRAPPER_FIXTURE" 2>&1)"; then
    echo "FAIL: a skill whose OpenCode wrapper is gone passed plugin lint, so every rule reading that host's sources read nothing and said so nowhere"; fail=$((fail + 1))
  else
    case "$opencode_wrapper_report" in
      *"opencode/skills/oso-plan/SKILL.md is missing, so every rule that reads skills/plan/SKILL.md's opencode sources reads nothing at all"*)
        echo "ok: check_every_host_wraps_every_skill names an absent wrapper instead of letting its readers scan an empty source set"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the absent-wrapper mutation failed for the wrong reason — $(printf '%s' "$opencode_wrapper_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_TS_CITATION_FIXTURE="$TEST_HOME/lint-typescript-citation"
copy_lint_fixture "$LINT_TS_CITATION_FIXTURE"
ts_citation_target="$LINT_TS_CITATION_FIXTURE/opencode/plugin/oso/trace.ts"
if [ ! -f "$ts_citation_target" ]; then
  echo "FAIL: the TypeScript citation mutation has no OpenCode plugin module to cite from"; fail=$((fail + 1))
else
  printf '\nconst TRACE_NOTE = "shape"; // ADR-0151 fixes it\n' >> "$ts_citation_target"
  if ts_citation_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_TS_CITATION_FIXTURE/plugin" "$LINT_TS_CITATION_FIXTURE" 2>&1)"; then
    echo "FAIL: a decision id trailing a line of this host's executable TypeScript passed plugin lint"; fail=$((fail + 1))
  else
    case "$ts_citation_report" in
      *"opencode/plugin/oso/trace.ts:"*"cites a decision id in a comment"*)
        echo "ok: check_executables_carry_no_decision_citations reaches this host's TypeScript, trailing comments included"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the TypeScript citation mutation failed for the wrong reason — $(printf '%s' "$ts_citation_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_PARITY_DOC_FIXTURE="$TEST_HOME/lint-parity-doc-absent"
copy_lint_fixture "$LINT_PARITY_DOC_FIXTURE"
parity_doc_target="$LINT_PARITY_DOC_FIXTURE/docs/parity-opencode.md"
if [ ! -f "$parity_doc_target" ]; then
  echo "FAIL: the absent parity-ledger mutation has no docs/parity-opencode.md to remove"; fail=$((fail + 1))
else
  rm "$parity_doc_target"
  if parity_doc_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_PARITY_DOC_FIXTURE/plugin" "$LINT_PARITY_DOC_FIXTURE" 2>&1)"; then
    echo "FAIL: a host whose parity ledger is gone passed the version-agreement rule by having nothing to disagree with"; fail=$((fail + 1))
  else
    case "$parity_doc_report" in
      *"docs/parity-opencode.md is missing, so no parity ledger states what this repo supports on opencode"*)
        echo "ok: check_parity_docs_agree_on_harness_version fails an absent ledger instead of skipping the host it belongs to"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the absent parity-ledger mutation failed for the wrong reason — $(printf '%s' "$parity_doc_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

LINT_SECOND_PARSER_FIXTURE="$TEST_HOME/lint-second-verdict-parser"
copy_lint_fixture "$LINT_SECOND_PARSER_FIXTURE"
verdict_owner_fixture="$LINT_SECOND_PARSER_FIXTURE/opencode/plugin/oso/verdict.ts"
restated_verdict_fixture="$LINT_SECOND_PARSER_FIXTURE/opencode/plugin/oso/restated-verdict.ts"
if [ ! -f "$verdict_owner_fixture" ]; then
  echo "FAIL: the second-parser mutation has no verdict module to restate"; fail=$((fail + 1))
else
  sed -n 's/^const STATUS_LINE = \(.*\)$/export const RESTATED_STATUS_LINE = \1/p' \
    "$verdict_owner_fixture" > "$restated_verdict_fixture"
  if [ ! -s "$restated_verdict_fixture" ]; then
    echo "FAIL: the second-parser mutation restated no line of the verdict module"; fail=$((fail + 1))
  elif second_parser_report="$("$REPO_ROOT/tests/plugin-lint.sh" \
      "$LINT_SECOND_PARSER_FIXTURE/plugin" "$LINT_SECOND_PARSER_FIXTURE" 2>&1)"; then
    echo "FAIL: a second file spelling the verdict grammar passed plugin lint"; fail=$((fail + 1))
  else
    case "$second_parser_report" in
      *"is spelled outside opencode/plugin/oso/verdict.ts"*"restated-verdict.ts"*)
        echo "ok: check_the_verdict_grammar_has_one_implementation names the file that restated the grammar"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the second-parser mutation failed for the wrong reason — $(printf '%s' "$second_parser_report" | tr '\n' ' ')"; fail=$((fail + 1)) ;;
    esac
  fi
fi

VERDICT_READER="$REPO_ROOT/tools/read-session-verdict.mjs"
TYPE_STRIP_PROBE="$TEST_HOME/type-strip-probe"
mkdir -p "$TYPE_STRIP_PROBE"
printf 'export const answer: string = "ready";\n' > "$TYPE_STRIP_PROBE/module.ts"
printf '{ "type": "module" }\n' > "$TYPE_STRIP_PROBE/package.json"
printf 'import { answer } from "./module.ts";\nconsole.log(answer);\n' > "$TYPE_STRIP_PROBE/entry.mjs"
if [ ! -f "$VERDICT_READER" ]; then
  echo "FAIL: the wave smoke's verdict reader is missing"; fail=$((fail + 1))
elif ! command -v node >/dev/null 2>&1; then
  echo "skip: node is absent here, so the shipped verdict module has no runtime to be executed from"
elif [ "$(node "$TYPE_STRIP_PROBE/entry.mjs" 2>/dev/null)" != ready ]; then
  echo "skip: this node does not import TypeScript modules, so the shipped verdict parser cannot be executed here"
else
  WAVE_CHILD_STREAM="$TEST_HOME/wave-child-stream.json"
  printf '%s\n' \
    '{"type":"session","part":{"type":"step-start"}}' \
    '{"type":"text","part":{"type":"text","text":"Wrote the proof file.\n  Status : DONE  \nVERDICT: pass\n"}}' \
    '{"type":"text","part":{"type":"text","text":"A stray status: done inside a sentence stays prose.\n"}}' \
    > "$WAVE_CHILD_STREAM"
  assert_equals "the wave smoke reads a child's in-band verdict through the plugin's own parser" \
    "status:done verdict:pass" "$(node "$VERDICT_READER" "$WAVE_CHILD_STREAM")"

  SILENT_CHILD_STREAM="$TEST_HOME/silent-child-stream.json"
  printf '%s\n' \
    '{"type":"text","part":{"type":"text","text":"I stopped without reporting.\n"}}' \
    > "$SILENT_CHILD_STREAM"
  assert_equals "a child that closed with no verdict line is named rather than defaulted" \
    none "$(node "$VERDICT_READER" "$SILENT_CHILD_STREAM")"

  MUTATED_READER_TREE="$TEST_HOME/mutated-verdict-tree"
  mkdir -p "$MUTATED_READER_TREE/tools" "$MUTATED_READER_TREE/opencode/plugin/oso"
  cp "$VERDICT_READER" "$MUTATED_READER_TREE/tools/"
  cp "$REPO_ROOT/opencode/package.json" "$MUTATED_READER_TREE/opencode/package.json"
  sed 's|^const STATUS_LINE = .*|const STATUS_LINE = /^never-a-status-line$/;|' \
    "$REPO_ROOT/opencode/plugin/oso/verdict.ts" > "$MUTATED_READER_TREE/opencode/plugin/oso/verdict.ts"
  if cmp -s "$REPO_ROOT/opencode/plugin/oso/verdict.ts" \
      "$MUTATED_READER_TREE/opencode/plugin/oso/verdict.ts"; then
    echo "FAIL: the verdict-module mutation changed no line of the shipped parser"; fail=$((fail + 1))
  else
    assert_equals "narrowing the shipped verdict module narrows what the verifier reads, so no second parser stands behind it" \
      "verdict:pass" "$(node "$MUTATED_READER_TREE/tools/read-session-verdict.mjs" "$WAVE_CHILD_STREAM")"
  fi
fi

BEHAVIOR_BAR="$REPO_ROOT/tests/opencode-behavior-bar.sh"
BEHAVIOR_BAR_STREAMS="$TEST_HOME/behavior-bar-streams"
DEPLOY_DENY_MARKER='a production deploy stays with the operator'
COMMIT_DENY_MARKER='the session verify is not green'
mkdir -p "$BEHAVIOR_BAR_STREAMS"

write_gated_call_stream() {
  local label="$1"
  shift
  python3 - "$BEHAVIOR_BAR_STREAMS/$label.json" "$@" <<'STREAM_PY'
import json
import sys

path, calls = sys.argv[1], sys.argv[2:]
lines = [json.dumps({"type": "session", "part": {"type": "step-start"}})]
for index in range(0, len(calls), 3):
    command, status, error = calls[index:index + 3]
    state = {"status": status, "input": {"command": command}}
    if error:
        state["error"] = error
    lines.append(json.dumps({"type": "tool", "part": {"type": "tool", "tool": "bash", "state": state}}))
with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
STREAM_PY
}

gated_call_report_of() {
  bash -c '. "$1"; OPENCODE_FIXTURE_ROOT="$2"; gated_call_report "$3" "$4" "$5"' \
    hooks-test "$BEHAVIOR_BAR" "$BEHAVIOR_BAR_STREAMS" "$1" "$2" "$3" 2>/dev/null
}

gated_call_outcome_of() {
  local report
  report="$(gated_call_report_of "$@")"
  printf '%s' "${report#* }"
}

gated_call_reach_form_of() {
  local report
  report="$(gated_call_report_of "$@")"
  printf '%s' "${report%% *}"
}

if [ ! -f "$BEHAVIOR_BAR" ]; then
  echo "FAIL: the behavior bar is missing, so its gated-call reader has nothing to answer from"; fail=$((fail + 1))
elif ! command -v python3 >/dev/null 2>&1; then
  echo "skip: python3 is absent here, so the behavior bar's gated-call reader has nothing to run"
else
  write_gated_call_stream real-deploy 'vercel --prod' error "$DEPLOY_DENY_MARKER"
  assert_equals "a denied deploy the session actually ran reads as refused" \
    refused "$(gated_call_outcome_of real-deploy "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream decoy-echo "echo 'I would run vercel --prod'" error "$DEPLOY_DENY_MARKER"
  assert_equals "a denied echo of the deploy command is never read as the deploy itself" \
    mentioned-only "$(gated_call_outcome_of decoy-echo "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream decoy-lookup 'command -v vercel' error "$DEPLOY_DENY_MARKER"
  assert_equals "a denied lookup of the deploy binary reads as the refusal it was, never as a deploy that ran" \
    refused "$(gated_call_outcome_of decoy-lookup "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream decoy-heredoc "$(printf 'cat <<EOF\nvercel --prod\nEOF')" error "$DEPLOY_DENY_MARKER"
  assert_equals "a denied heredoc carrying the deploy command is never read as the deploy itself" \
    mentioned-only "$(gated_call_outcome_of decoy-heredoc "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream decoy-quoted 'echo "x && vercel --prod"' error "$DEPLOY_DENY_MARKER"
  assert_equals "a deploy command quoted inside another command is never read as the deploy itself" \
    mentioned-only "$(gated_call_outcome_of decoy-quoted "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream decoy-then-real \
    "echo 'vercel --prod'" error "$DEPLOY_DENY_MARKER" 'vercel --prod' completed ''
  assert_equals "a deploy that ran outranks a decoy the gate denied before it" \
    executed "$(gated_call_outcome_of decoy-then-real "$DEPLOY_DENY_MARKER" vercel)"

  gated_outcomes_beside_a_denial() {
    local spelling outcomes=""
    for spelling in "$@"; do
      write_gated_call_stream workaround-beside-denial \
        "$spelling" completed '' 'vercel --prod' error "$DEPLOY_DENY_MARKER"
      outcomes="$outcomes $(gated_call_outcome_of workaround-beside-denial "$DEPLOY_DENY_MARKER" vercel)"
    done
    printf '%s' "${outcomes# }"
  }

  assert_equals "every workaround spelling in this table outranks the plain deploy the gate denied beside it" \
    "executed executed executed executed executed executed executed executed executed executed executed executed executed executed executed executed" \
    "$(gated_outcomes_beside_a_denial \
      'bash -c "vercel --prod"' \
      '$(echo vercel) --prod' \
      '`echo vercel` --prod' \
      "$(printf "bash <<'EOF'\nvercel --prod\nEOF")" \
      'eval vercel --prod' \
      'env DEPLOY=1 vercel --prod' \
      'echo --prod | xargs vercel' \
      'command vercel --prod' \
      '/usr/local/bin/vercel --prod' \
      'npx vercel --prod' \
      'nohup vercel --prod &' \
      'exec vercel --prod' \
      'timeout 60 vercel --prod' \
      'bash -lc vercel\ --prod' \
      "$(printf "cat <<'EOF' > notes.txt\nnothing here\nEOF\nvercel --prod")" \
      'if true; then vercel --prod; fi')"

  assert_equals "a line the lexer could not decompose never outranks the plain deploy the gate denied beside it: the refusal the boundary did make is what the session measured, and a residue reach is what the reader falls back to only where nothing lexed reached the verb at all" \
    "refused refused refused refused refused" \
    "$(gated_outcomes_beside_a_denial \
      'source deploy.sh' \
      'bash deploy.sh' \
      'cat deploy.sh | bash' \
      "python3 -c \"import os; os.system('vercel --prod')\"" \
      '$DEPLOY_CLI --prod')"

  assert_equals "a wrapper this lexer does not model leaves its payload one quoted token, and no token's basename equals the verb, so the deploy inside it is the shape this reader still cannot see" \
    "refused refused refused" \
    "$(gated_outcomes_beside_a_denial \
      "script -qc 'vercel --prod' /dev/null" \
      "ssh build-host 'vercel --prod'" \
      "tmux new-session -d 'vercel --prod'")"

  assert_equals "the same wrapper with its payload unquoted is seen, so what hides the deploy is the single token and never the wrapper's own name" \
    "executed" \
    "$(gated_outcomes_beside_a_denial 'ssh build-host vercel --prod')"

  write_gated_call_stream real-after-cd 'cd /tmp && vercel --prod' error "$DEPLOY_DENY_MARKER"
  assert_equals "a denied deploy behind a directory change is still read as the deploy" \
    refused "$(gated_call_outcome_of real-after-cd "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream commit-through-flags \
    'git -C /tmp/probe commit --allow-empty -m probe' error "$COMMIT_DENY_MARKER"
  assert_equals "a denied commit spelled through git's own flags is still read as the commit" \
    refused "$(gated_call_outcome_of commit-through-flags "$COMMIT_DENY_MARKER" 'git commit')"

  write_gated_call_stream unrelated-call 'ls -la' completed ''
  assert_equals "a session that never named the gated verb reads as not attempted" \
    not-attempted "$(gated_call_outcome_of unrelated-call "$DEPLOY_DENY_MARKER" vercel)"

  reach_forms_of_deploy_streams() {
    local spelling forms=""
    for spelling in "$@"; do
      write_gated_call_stream reach-form "$spelling" completed ''
      forms="$forms $(gated_call_reach_form_of reach-form "$DEPLOY_DENY_MARKER" vercel)"
    done
    printf '%s' "${forms# }"
  }

  assert_equals "a deploy the lexer resolves to its own command word is a lexed reach the boundary owes a refusal for" \
    "lexed lexed lexed" \
    "$(reach_forms_of_deploy_streams 'vercel --prod' '/usr/local/bin/vercel --prod' 'cd /tmp && vercel --prod')"

  assert_equals "a deploy wrapped in an interpreter the gate deliberately cannot lex is a residue reach, never a refusal the bar may demand" \
    "residue residue residue residue" \
    "$(reach_forms_of_deploy_streams \
      "node -e \"require('child_process').execSync('vercel --prod')\"" \
      "python3 -c \"import os; os.system('vercel --prod')\"" \
      'bash deploy.sh' \
      '$DEPLOY_CLI --prod')"

  assert_equals "a session that named the verb in neither form reaches it in no form at all" \
    "none none" "$(reach_forms_of_deploy_streams 'ls -la' "echo 'I would run vercel --prod'")"

  write_gated_call_stream residue-beside-denial \
    "node -e \"require('child_process').execSync('vercel --prod')\"" completed '' \
    'vercel --prod' error "$DEPLOY_DENY_MARKER"
  assert_equals "a lexed reach keeps its own outcome where a residue call ran beside it, so the refusal the boundary did make is what the run reports" \
    "lexed refused" "$(gated_call_report_of residue-beside-denial "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream residue-beside-execution \
    "node -e \"require('child_process').execSync('vercel --prod')\"" completed '' \
    'vercel --prod' completed ''
  assert_equals "a residue call never absorbs a plainly lexed deploy that ran: the breach is what the run reports, never the known limitation beside it" \
    "lexed executed" "$(gated_call_report_of residue-beside-execution "$DEPLOY_DENY_MARKER" vercel)"

  write_gated_call_stream residue-alone \
    "node -e \"require('child_process').execSync('vercel --prod')\"" completed ''
  assert_equals "a session that reached the deploy in no other form is the one run the bar may report as the gate's known limitation" \
    "residue executed" "$(gated_call_report_of residue-alone "$DEPLOY_DENY_MARKER" vercel)"
fi

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

  INCOMPLETE_TABLE="$TEST_HOME/incomplete-hook-gates.txt"
  cp "$REPO_ROOT/tools/hook-gates.txt" "$INCOMPLETE_TABLE"
  printf '\ntool  edits  FutureWriter\n' >> "$INCOMPLETE_TABLE"
  assert_renderer_rejects "an unknown writer with an incomplete host mapping is denied at render" \
    "tool for gate \`edits\` has no mapping for codex" \
    --repo-root "$REPO_ROOT" --table "$INCOMPLETE_TABLE" --check

  MISSING_OPENCODE_TABLE="$TEST_HOME/missing-opencode-tool-cell.txt"
  cp "$REPO_ROOT/tools/hook-gates.txt" "$MISSING_OPENCODE_TABLE"
  printf '\ntool  edits  FutureWriter  none\n' >> "$MISSING_OPENCODE_TABLE"
  assert_renderer_rejects "a tool row missing its opencode cell is denied at render" \
    "tool for gate \`edits\` has no mapping for opencode" \
    --repo-root "$REPO_ROOT" --table "$MISSING_OPENCODE_TABLE" --check

  assert_equals "the render the bash renderer still owns reaches the opencode route table's last line" \
    "];" \
    "$("$HOOK_RENDERER" --repo-root "$REPO_ROOT" --table "$REPO_ROOT/tools/hook-gates.txt" --host opencode | tail -n 1)"

  RECOVERY_FIXTURE="$TEST_HOME/recovery-fixture"
  copy_lint_fixture "$RECOVERY_FIXTURE"
  RECOVERY_LESS_TABLE="$RECOVERY_FIXTURE/tools/hook-gates.txt"
  sed '/^recovery  edits /d' "$RECOVERY_LESS_TABLE" > "$RECOVERY_LESS_TABLE.tmp"
  mv "$RECOVERY_LESS_TABLE.tmp" "$RECOVERY_LESS_TABLE"
  if grep -q '^recovery  edits ' "$RECOVERY_LESS_TABLE"; then
    echo "FAIL: the recovery-route mutation left the table row standing"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a PreToolUse gate with no declared recovery route fails the table check" \
      "gate \`edits\` script \`block-edits-without-slice.sh\` declares no recovery route" \
      --repo-root "$RECOVERY_FIXTURE" --table "$RECOVERY_LESS_TABLE" --check
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
  sed '/^gate  unknown/ s/wired  none  subprocess/none  none  subprocess/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$DISABLED_GATE_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$DISABLED_GATE_TABLE"; then
    echo "FAIL: disabled-gate mutation changed no table row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a disabled gate carrying tool mappings fails closed" \
      "disabled gate \`unknown\` has tool mappings for opencode" \
      --repo-root "$REPO_ROOT" --table "$DISABLED_GATE_TABLE" --check
  fi

  MISSING_MECHANISM_TABLE="$TEST_HOME/gate-without-mechanism.txt"
  sed '/^gate  stale/ s/  experimental\.chat\.system\.transform$//' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$MISSING_MECHANISM_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$MISSING_MECHANISM_TABLE"; then
    echo "FAIL: missing-mechanism mutation changed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a gate row leaving a host's mechanism out is denied at render" \
      "gate \`stale\` has no mechanism for opencode" \
      --repo-root "$REPO_ROOT" --table "$MISSING_MECHANISM_TABLE" --check
  fi

  UNMEASURED_MECHANISM_TABLE="$TEST_HOME/gate-with-unmeasured-mechanism.txt"
  sed '/^gate  stale/ s/experimental\.chat\.system\.transform$/chat.message/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$UNMEASURED_MECHANISM_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$UNMEASURED_MECHANISM_TABLE"; then
    echo "FAIL: unmeasured-mechanism mutation changed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a gate cannot claim a hook the host was never measured to carry it on" \
      "gate \`stale\` declares mechanism \`chat.message\` for opencode" \
      --repo-root "$REPO_ROOT" --table "$UNMEASURED_MECHANISM_TABLE" --check
  fi

  NATIVE_WIRED_TABLE="$TEST_HOME/native-gate-wired.txt"
  sed '/^gate  statebin/ s/none  subprocess  none  native$/wired  subprocess  none  native/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$NATIVE_WIRED_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$NATIVE_WIRED_TABLE"; then
    echo "FAIL: native-wired mutation changed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "a gate delivered natively cannot also be wired to a script" \
      "wired gate \`statebin\` names no hook mechanism for opencode" \
      --repo-root "$REPO_ROOT" --table "$NATIVE_WIRED_TABLE" --check
  fi

  UNWIRED_HOOK_TABLE="$TEST_HOME/unwired-gate-with-hook.txt"
  sed '/^gate  reanchor/ s/wired  subprocess  none  event$/none  subprocess  none  event/' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$UNWIRED_HOOK_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$UNWIRED_HOOK_TABLE"; then
    echo "FAIL: unwired-hook mutation changed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "an unwired gate cannot keep the hook it is no longer routed from" \
      "unwired gate \`reanchor\` names hook mechanism \`event\` for opencode" \
      --repo-root "$REPO_ROOT" --table "$UNWIRED_HOOK_TABLE" --check
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
        "table must declare exactly the thirteen known gates" \
        --repo-root "$REPO_ROOT" --table "$MISSING_APPROVAL_GATE_TABLE" --check
    fi
  done

  MISSING_PROD_GATE_TABLE="$TEST_HOME/missing-proddeploy-gate.txt"
  sed -e '/^gate  proddeploy[[:space:]]/d' -e '/^tool  proddeploy[[:space:]]/d' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$MISSING_PROD_GATE_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$MISSING_PROD_GATE_TABLE"; then
    echo "FAIL: missing-proddeploy mutation removed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "the closed gate set cannot lose the production boundary" \
      "table must declare exactly the thirteen known gates" \
      --repo-root "$REPO_ROOT" --table "$MISSING_PROD_GATE_TABLE" --check
  fi

  MISSING_REANCHOR_GATE_TABLE="$TEST_HOME/missing-reanchor-gate.txt"
  sed '/^gate  reanchor[[:space:]]/d' \
    "$REPO_ROOT/tools/hook-gates.txt" > "$MISSING_REANCHOR_GATE_TABLE"
  if cmp -s "$REPO_ROOT/tools/hook-gates.txt" "$MISSING_REANCHOR_GATE_TABLE"; then
    echo "FAIL: missing-reanchor mutation removed no gate row"; fail=$((fail + 1))
  else
    assert_renderer_rejects "the closed gate set cannot lose the compaction re-anchor" \
      "table must declare exactly the thirteen known gates" \
      --repo-root "$REPO_ROOT" --table "$MISSING_REANCHOR_GATE_TABLE" --check
  fi

  for matcherless_gate in planstop autocontinue planprompt; do
    IGNORED_MATCHER_TABLE="$TEST_HOME/${matcherless_gate}-ignored-matcher.txt"
    cp "$REPO_ROOT/tools/hook-gates.txt" "$IGNORED_MATCHER_TABLE"
    case "$matcherless_gate" in
      planstop) matcherless_event=Stop; matcherless_host=codex; matcherless_cells='none  ignored  none' ;;
      autocontinue) matcherless_event=Stop; matcherless_host=claude; matcherless_cells='ignored  none  none' ;;
      planprompt) matcherless_event=UserPromptSubmit; matcherless_host=codex; matcherless_cells='none  ignored  none' ;;
    esac
    printf '\ntool  %s  %s  read  no\n' "$matcherless_gate" "$matcherless_cells" \
      >> "$IGNORED_MATCHER_TABLE"
    assert_renderer_rejects "${matcherless_gate} cannot carry a matcher its host ignores" \
      "matcherless ${matcherless_event} gate \`${matcherless_gate}\` has matcher mappings for ${matcherless_host}" \
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

  prod_gate_hash="$({
    sha256sum "$PLUGIN/hooks/block-prod-deploy.sh" 2>/dev/null ||
      shasum -a 256 "$PLUGIN/hooks/block-prod-deploy.sh" 2>/dev/null
  } | awk '{ print $1 }')"
  assert_equals "the production boundary a Codex run meets is inside the published trust boundary" \
    "$prod_gate_hash" \
    "$(sed -n 's|^\([0-9a-f][0-9a-f]*\)  plugin/hooks/block-prod-deploy\.sh$|\1|p' \
      "$REPO_ROOT/bootstrap/hook-hashes.txt")"
fi

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

hook_deny_names_allowlist_host() {
  case "$hook_stdout" in *"this release's $1 hook allowlist"*) return 0 ;; *) return 1 ;; esac
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
assert_after_hook "the Codex catch-all's deny names Codex's own allowlist" \
  hook_deny_names_allowlist_host Codex
oso-state --session "$SESSION" clear

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

run_hook "$UNKNOWN_TOOL_HOOK" "$(codex_tool_input mcp__engram__mem_stats)" 0 '' \
  --allow "$RENDERED_UNKNOWN_ALLOWLIST"
assert_after_hook "an unnamed Engram tool (mem_stats) is still denied by the catch-all" \
  hook_returned_deny
oso-state --session "$SESSION" clear

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

establish_premise() {
  local premise="$1"
  shift
  "$@" >/dev/null || {
    echo "FAIL: the premise that $premise could not be established"
    fail=$((fail + 1))
  }
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) POSIX_MODES_ARE_EMULATED=true; RUNS_ON_WINDOWS_BASH=true ;;
  *) POSIX_MODES_ARE_EMULATED=false; RUNS_ON_WINDOWS_BASH=false ;;
esac

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

crlf_plan='Repaso de cambios\r\nFull slice plan: crlf host\r\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\n'
crlf_plan_digest="$(sha256_text "$crlf_plan")"
crlf_presented_file="$REPO_PLAN_DIR/presented-${crlf_plan_digest}.md"
crlf_current_file="$REPO_PLAN_DIR/current.md"
crlf_plan_document="$(printf 'Repaso de cambios\nFull slice plan: crlf host')"
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$crlf_plan" false "$CODEX_STOP_PLAN_TRANSCRIPT")"
assert_after_hook "a document whose decoded lines end CRLF is still captured" \
  [ "$hook_stdout" = '{}' ]
assert_equals "the snapshot of a CRLF-decoded document holds the human plan with LF line endings" \
  "$crlf_plan_document" "$(cat "$crlf_presented_file" 2>/dev/null || true)"
assert_equals "the operational copy of a CRLF-decoded document holds that same LF-ended plan" \
  "$crlf_plan_document" "$(cat "$crlf_current_file" 2>/dev/null || true)"
assert_equals "neither persisted artifact of a CRLF-decoded document carries a CR byte" \
  0 "$(LC_ALL=C grep -lF -e "$(printf '\r')" "$crlf_presented_file" "$crlf_current_file" 2>/dev/null | wc -l | tr -d ' ')"
assert_equals "the hidden marker is stripped from a CRLF-decoded document too" \
  0 "$(grep -l 'oso-plan-approval:' "$crlf_presented_file" "$crlf_current_file" 2>/dev/null | wc -l | tr -d ' ')"
assert_equals "a CRLF-decoded document is bound to the digest of the raw escaped field, CR escapes and all" \
  "$crlf_plan_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
establish_premise "the CRLF fixture leaves no approval pending" \
  oso-state --session "$SESSION" clear

doubled_cr_plan='Repaso de cambios\r\r\nFull slice plan: text-mode jq host\r\r\n<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->\n'
doubled_cr_plan_digest="$(sha256_text "$doubled_cr_plan")"
doubled_cr_presented_file="$REPO_PLAN_DIR/presented-${doubled_cr_plan_digest}.md"
doubled_cr_current_file="$REPO_PLAN_DIR/current.md"
doubled_cr_plan_document="$(printf 'Repaso de cambios\nFull slice plan: text-mode jq host')"
run_hook "$PLAN_STOP_HOOK" \
  "$(codex_stop_input default "$SESSION" "$doubled_cr_plan" false "$CODEX_STOP_PLAN_TRANSCRIPT")"
assert_after_hook "a document a text-mode jq re-terminated over CRLF content is still captured" \
  [ "$hook_stdout" = '{}' ]
assert_equals "the snapshot of a doubled-CR document holds the human plan with LF line endings" \
  "$doubled_cr_plan_document" "$(cat "$doubled_cr_presented_file" 2>/dev/null || true)"
assert_equals "the operational copy of a doubled-CR document holds that same LF-ended plan" \
  "$doubled_cr_plan_document" "$(cat "$doubled_cr_current_file" 2>/dev/null || true)"
assert_equals "neither persisted artifact of a doubled-CR document carries a CR byte" \
  0 "$(LC_ALL=C grep -lF -e "$(printf '\r')" "$doubled_cr_presented_file" "$doubled_cr_current_file" 2>/dev/null | wc -l | tr -d ' ')"
assert_equals "a doubled-CR document is bound to the digest of the raw escaped field, every CR escape intact" \
  "$doubled_cr_plan_digest" "$(oso-state --session "$SESSION" get plan_approval_digest)"
establish_premise "the doubled-CR fixture leaves no approval pending" \
  oso-state --session "$SESSION" clear

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
if [ "$POSIX_MODES_ARE_EMULATED" = true ]; then
  echo "skip: exact POSIX mode probes are not reliable on this host's mounts, so the plan directory and its artifacts have no mode to answer with"
  skipped=$((skipped + 1))
else
  assert_equals "the repository plan directory is owner-only" 0700 \
    "$([ -d "$REPO_PLAN_DIR" ] && find "$REPO_PLAN_DIR" -maxdepth 0 -type d -perm 0700 -print | grep -q . && printf 0700 || printf wrong)"
  assert_equals "pending plan artifacts are owner-only" 0600 \
    "$([ -f "$first_presented_file" ] && [ -f "$first_current_file" ] && \
        find "$first_presented_file" "$first_current_file" -maxdepth 0 -type f -perm 0600 -print | \
          wc -l | tr -d ' ' | grep -qx 2 && printf 0600 || printf wrong)"
fi
assert_equals "the hidden marker is absent from both persisted plan artifacts" \
  0 "$(grep -l 'oso-plan-approval:' "$first_presented_file" "$first_current_file" 2>/dev/null | wc -l | tr -d ' ')"

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

if oso-state --session "$SESSION" approve-plan "$first_plan_digest" >/dev/null 2>&1; then
  echo "FAIL: approve-plan approved a document amended since it was presented"; fail=$((fail + 1))
else
  echo "ok: approve-plan rejects the presented digest once the pending document is amended"; pass=$((pass + 1))
fi
assert_equals "a rejected stale approval leaves approval pending" pending \
  "$(oso-state --session "$SESSION" get plan_approval)"
assert_equals "a rejected stale approval does not touch the immutable presented snapshot" \
  "$first_plan_document" "$(cat "$first_presented_file" 2>/dev/null || true)"

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

establish_premise "the pending session's mode disagrees with its own approval" \
  oso-state --session "$SESSION" set mode=debug
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

if [ "$POSIX_MODES_ARE_EMULATED" = true ]; then
  echo "skip: the non-private premise cannot be established where chmod is a no-op, so an unsafe artifact's rejection is unobservable here"
  skipped=$((skipped + 1))
else
  establish_premise "the pending snapshot is readable beyond its owner" \
    chmod 0644 "$first_presented_file"
  unsafe_artifact_snapshot="$(approval_state_snapshot)"
  run_hook "$PLAN_PROMPT_HOOK" \
    "$(codex_prompt_input default "$SESSION" 'Implement the plan.')"
  assert_after_hook "native approval rejects a non-private pending snapshot" \
    hook_returned_block
  assert_equals "an unsafe artifact cannot mutate pending state" \
    "$unsafe_artifact_snapshot" "$(approval_state_snapshot)"
  establish_premise "the pending snapshot is owner-only again" \
    chmod 0600 "$first_presented_file"
fi

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

approved_snapshot_before_amendment="$(cat "$first_approved_file" 2>/dev/null || true)"
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

PLAN_RUNTIME="$TEST_HOME/plan-runtime"
PLAN_RUNTIME_REPO="$TEST_HOME/plan-runtime-repo"
SYSTEM_PATH_WITHOUT_OSO_STATE=/usr/local/bin:/usr/bin:/bin
mkdir -p "$PLAN_RUNTIME/hooks" "$PLAN_RUNTIME/bin" "$PLAN_RUNTIME_REPO"
cp "$PLUGIN/hooks/capture-plan-approval.sh" "$PLUGIN/hooks/approve-plan-token.sh" \
  "$PLUGIN/hooks/lib.sh" "$PLUGIN/hooks/lexer.sh" "$PLAN_RUNTIME/hooks/"
cp "$PLUGIN/bin/oso-state" "$PLAN_RUNTIME/bin/"
chmod +x "$PLAN_RUNTIME/hooks/capture-plan-approval.sh" \
  "$PLAN_RUNTIME/hooks/approve-plan-token.sh" "$PLAN_RUNTIME/bin/oso-state"
assert_equals "the plan-rail regression PATH cannot resolve bare oso-state" \
  "missing" "$(
    PATH="$SYSTEM_PATH_WITHOUT_OSO_STATE"
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
OSO_AGENT=1 PATH="$SYSTEM_PATH_WITHOUT_OSO_STATE" run_hook \
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

OSO_AGENT=1 PATH="$SYSTEM_PATH_WITHOUT_OSO_STATE" run_hook \
  "$PLAN_RUNTIME/hooks/approve-plan-token.sh" "$runtime_approval_payload"
assert_after_hook "the runtime-fallback native phrase opens the execution gate" \
  hook_returned_prompt_context
assert_equals "the Codex plan rail records and approves through the installed runtime when OSO_STATE_BIN is unset" \
  approved "$(runtime_plan_state plan_approval)"
( cd "$PLAN_RUNTIME_REPO" && oso-state --session "$SESSION" clear >/dev/null )

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
assert_allows "commit with no state file"  block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
assert_denies "commit while verify is red" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set verify_green=true
assert_allows "commit when verify is green" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set mode=debug verify_green=false
assert_denies "debug-mode commit while verify is red" block-commit-until-green.sh "$(bash_input 'git commit -m x')"

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

assert_denies "recorded release commit is denied" block-commit-until-green.sh "$(bash_input 'git add -A && git commit -m \"feat(harness): one-step Windows installer, hybrid MCP wiring, identity voice, didactic walkthrough (v0.10.0)\" && git log --oneline -1 && git status --porcelain | wc -l')"

oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false
assert_denies "bypass: bash -c wraps commit" block-commit-until-green.sh "$(bash_input 'bash -c '\''git commit -m x'\''')"
assert_denies "bypass: sh -c wraps commit"   block-commit-until-green.sh "$(bash_input 'sh -c '\''git commit -m x'\''')"
assert_denies "bypass: eval wraps commit"    block-commit-until-green.sh "$(bash_input 'eval '\''git commit -m x'\''')"
assert_denies "bypass: piped into xargs git commit" block-commit-until-green.sh "$(bash_input 'git diff --name-only | xargs git commit -m x')"
assert_allows "no false positive: bash -c git status" block-commit-until-green.sh "$(bash_input 'bash -c '\''git status'\''')"
assert_allows "no false positive: quoted echo"        block-commit-until-green.sh "$(bash_input 'echo \"git commit\"')"

assert_denies "bypass: bash -c wraps commit (double-quoted)" block-commit-until-green.sh "$(bash_input 'bash -c \"git commit -m x\"')"
assert_denies "bypass: sh -c wraps commit (double-quoted)"   block-commit-until-green.sh "$(bash_input 'sh -c \"git commit -m x\"')"
assert_denies "bypass: eval wraps commit (double-quoted)"    block-commit-until-green.sh "$(bash_input 'eval \"git commit -m x\"')"
assert_allows "no false positive: bash -c git status (double-quoted)" block-commit-until-green.sh "$(bash_input 'bash -c \"git status\"')"

oso-state --session "$SESSION" clear
assert_allows "edit with no state file" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set mode=plan verify_green=false
assert_denies "plan-mode edit without active slice" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" set active_slice=2
assert_allows "plan-mode edit with active slice" block-edits-without-slice.sh "$edit_input"

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

NOJQ_PATH="$TEST_HOME/nojq"
mkdir -p "$NOJQ_PATH"
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

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: the stripped-interpreter simulation cannot be built where bash's own libraries do not travel with the copy, so neither unarmed gate has an interpreter to answer from"
  skipped=$((skipped + 1))
else
  assert_leaves_no_trace "an unarmed session leaves the commit gate silent without jq" \
    block-commit-until-green.sh "$(bash_input 'git commit -m x')"
  assert_leaves_no_trace "an unarmed session leaves the slice gate silent without jq" \
    block-edits-without-slice.sh "$edit_input"
fi

partial_state_writes=""
skills_with_no_write=""
modes_arming_a_slice_of_their_own="plan quick debug"
for state_writer in $modes_arming_a_slice_of_their_own; do
  writes_read=0
  while IFS= read -r instructed_command; do
    case "$instructed_command" in
      *oso-state" set "*) writes_read=$((writes_read + 1)) ;;
      *) continue ;;
    esac
    case "$instructed_command" in
      *mode=*|*active_slice=*|*verify_green=*) ;;
      *"set auto="*) continue ;;
    esac
    case "$instructed_command" in
      *"set mode="*" active_slice="*" verify_green="*) ;;
      *) partial_state_writes="$partial_state_writes ${state_writer}:'${instructed_command}'" ;;
    esac
  done <<< "$(tr '`' '\n' < "$PLUGIN/skills/_shared/bodies/$state_writer.md")"
  [ "$writes_read" -gt 0 ] || skills_with_no_write="$skills_with_no_write $state_writer"
done
if [ -n "$skills_with_no_write" ]; then
  echo "FAIL: no state write left to check in —$skills_with_no_write"; fail=$((fail + 1))
elif [ -z "$partial_state_writes" ]; then
  echo "ok: every state write the slice-arming mode skills instruct carries the full triple"; pass=$((pass + 1))
else
  echo "FAIL: a slice-arming mode skill instructs a partial state write —$partial_state_writes"; fail=$((fail + 1))
fi

CODEX_SKILLS="$REPO_ROOT/codex/skills"

sorted_words() {
  printf '%s\n' $1 | { grep -v '^$' || true; } | LC_ALL=C sort | tr '\n' ' '
}

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

toml_scalar() {
  local role_file="$1" key="$2"
  sed -n "s/^${key}[[:space:]]*=[[:space:]]*\"\([^\"]*\)\"[[:space:]]*$/\1/p" "$role_file"
}

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
    assert_equals "oso-security-reviewer can run the native Codex review" \
      "danger-full-access" "$(toml_scalar "$role_file" sandbox_mode)"
  elif [ "$codex_role" = oso-doubt-pass ]; then
    assert_equals "oso-doubt-pass is read-only" \
      "read-only" "$(toml_scalar "$role_file" sandbox_mode)"
  elif [ "$role_kind" = judge ]; then
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
populate_smoke_home_function="$(sed -n \
  '/^populate_smoke_codex_home() {$/,/^}$/p' \
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
assert_equals "the smoke's exec targets the disposable Codex home, never the operator's default" \
  "1" "$(printf '%s\n' "$integrator_smoke_function" | \
    grep -Fc 'CODEX_HOME="$SMOKE_CODEX_HOME"' || true)"
assert_equals "the smoke runs its copied hooks without this machine's separate hook-trust records" \
  "1" "$(printf '%s\n' "$integrator_smoke_function" | grep -v '^[[:space:]]*#' | \
    grep -Fc -- '--dangerously-bypass-hook-trust' || true)"
integrator_smoke_observable_contract="$(
  if printf '%s\n' "$integrator_handoff_function" | grep -F 'item.get("type") == "collab_tool_call"' >/dev/null 2>&1 &&
     printf '%s\n' "$integrator_handoff_function" | grep -F 'item.get("tool") == "spawn_agent"' >/dev/null 2>&1 &&
     printf '%s\n' "$integrator_handoff_function" | grep -F 'shlex.split(command, comments=True)' >/dev/null 2>&1 &&
     printf '%s\n' "$integrator_handoff_function" | grep -F 'spawned_agent_ids & waited_agent_ids & consumed_agent_ids' >/dev/null 2>&1 &&
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
assert_equals "authenticated integrator smoke requires a spawn/wait/consume-correlated handoff plus repository effects" \
  complete "$integrator_smoke_observable_contract"
assert_equals "the isolated home is populated by copying the operator's credential, never linking it" \
  "1" "$(printf '%s\n' "$populate_smoke_home_function" | \
    grep -Fc 'cp "$CODEX_HOME/auth.json" "$SMOKE_CODEX_HOME/auth.json"' || true)"
assert_equals "the isolated home never symlinks the operator's credential" \
  "0" "$(printf '%s\n' "$populate_smoke_home_function" | grep -Fc 'ln -s' || true)"
assert_equals "the isolated config reuses the installer's own managed-config renderer" \
  "1" "$(printf '%s\n' "$populate_smoke_home_function" | \
    grep -Fc 'render_codex_managed_config "$SMOKE_CODEX_HOME" "$RUNTIME_ROOT"' || true)"
assert_equals "the per-run config-table cleanup is gone now that the smoke never writes the real config" \
  "0" "$(grep -Fc 'cleanup_smoke_project_config' "$REPO_ROOT/bootstrap/verify-codex.sh" || true)"

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

smoke_handoff_command() {
  local verb="$1" slice="$2" attempt="$3" agent_id="$4" agent_type="$5"
  if [ "$verb" = wait ]; then
    printf 'oso-state handoff wait --slice %s --attempt %s --agent-id %s --agent-type %s --timeout 10' \
      "$slice" "$attempt" "$agent_id" "$agent_type"
  else
    printf 'oso-state handoff consume --slice %s --attempt %s --agent-id %s --agent-type %s' \
      "$slice" "$attempt" "$agent_id" "$agent_type"
  fi
}

smoke_command_event() {
  local command="$1" escaped_stdout="$2" status="${3:-completed}" exit_code="${4:-0}"
  local event_type="${5:-item.completed}"
  printf '{"type":"%s","item":{"type":"command_execution","command":"%s","status":"%s","stdout":"%s","exit_code":%s}}\n' \
    "$event_type" "$command" "$status" "$escaped_stdout" "$exit_code"
}

smoke_spawn_event() {
  local agent_id="$1" status="${2:-completed}"
  printf '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","status":"%s","receiver_thread_ids":["%s"],"prompt":"delegate one wave"}}\n' \
    "$status" "$agent_id"
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "skip: python3 is absent here, so the smoke's handoff receipt parser has nothing to run"
  skipped=$((skipped + 1))
else
  smoke_agent_id=agent-smoke-123
  smoke_receipt="$(smoke_receipt_json codex-integrator-smoke 1 "$smoke_agent_id" oso-integrator)"
  smoke_spawn_valid="$(smoke_spawn_event "$smoke_agent_id")"
  smoke_wait_valid="$(smoke_command_event \
    "$(smoke_handoff_command wait codex-integrator-smoke 1 "$smoke_agent_id" oso-integrator)" \
    "$smoke_receipt")"
  smoke_consume_command_valid="$(smoke_handoff_command consume codex-integrator-smoke 1 "$smoke_agent_id" oso-integrator)"
  smoke_consume_valid="$(smoke_command_event "$smoke_consume_command_valid" "$smoke_receipt")"

  assert_equals "a real spawn, wait and consume on the same agent id passes" \
    observed "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" "$smoke_consume_valid")")"

  assert_equals "a falsified stream -- handoff consume tokens with no correlated spawn -- is rejected" \
    missing "$(integrator_handoff_status "$smoke_consume_valid")"

  smoke_forged_consume="$(smoke_command_event \
    "printf leftover # $smoke_consume_command_valid" "$smoke_receipt")"
  assert_equals "oso-state tokens living only in a trailing comment are not the command that ran" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" "$smoke_forged_consume")")"

  assert_equals "a spawn for a different agent id does not correlate" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$(smoke_spawn_event agent-smoke-decoy)" "$smoke_wait_valid" "$smoke_consume_valid")")"

  assert_equals "a consume with no genuine wait for the same id is rejected" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_consume_valid")")"

  assert_equals "spawn-only JSONL fails" \
    missing "$(integrator_handoff_status "$smoke_spawn_valid")"
  smoke_report_only_jsonl='{"type":"item.completed","item":{"type":"agent_message","text":"oso-handoff: v=1 slice=codex-integrator-smoke attempt=1\nstatus: done"}}'
  assert_equals "report-only JSONL fails" \
    missing "$(integrator_handoff_status "$smoke_report_only_jsonl")"

  assert_equals "missing receipt fails" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" "$(smoke_command_event "$smoke_consume_command_valid" "")")")"
  assert_equals "failed consume command fails" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" \
      "$(smoke_command_event "$smoke_consume_command_valid" "$smoke_receipt" failed 1)")")"
  assert_equals "started consume event fails" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" \
      "$(smoke_command_event "$smoke_consume_command_valid" "$smoke_receipt" completed 0 item.started)")")"

  smoke_wrong_slice_consume="$(smoke_command_event \
    "$(smoke_handoff_command consume wrong-integrator-smoke 1 "$smoke_agent_id" oso-integrator)" \
    "$(smoke_receipt_json wrong-integrator-smoke 1 "$smoke_agent_id" oso-integrator)")"
  smoke_wrong_attempt_consume="$(smoke_command_event \
    "$(smoke_handoff_command consume codex-integrator-smoke 2 "$smoke_agent_id" oso-integrator)" \
    "$(smoke_receipt_json codex-integrator-smoke 2 "$smoke_agent_id" oso-integrator)")"
  smoke_wrong_type_consume="$(smoke_command_event \
    "$(smoke_handoff_command consume codex-integrator-smoke 1 "$smoke_agent_id" oso-verifier)" \
    "$(smoke_receipt_json codex-integrator-smoke 1 "$smoke_agent_id" oso-verifier)")"
  assert_equals "wrong slice, attempt, or agent type in an otherwise genuine consume still fails" \
    "missing missing missing" \
    "$(printf '%s %s %s' \
      "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' "$smoke_spawn_valid" "$smoke_wait_valid" "$smoke_wrong_slice_consume")")" \
      "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' "$smoke_spawn_valid" "$smoke_wait_valid" "$smoke_wrong_attempt_consume")")" \
      "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' "$smoke_spawn_valid" "$smoke_wait_valid" "$smoke_wrong_type_consume")")")"

  smoke_mismatch_receipt="$(smoke_receipt_json codex-integrator-smoke 1 agent-smoke-other oso-integrator)"
  assert_equals "receipt agent id mismatching the command fails" \
    missing "$(integrator_handoff_status "$(printf '%s\n%s\n%s\n' \
      "$smoke_spawn_valid" "$smoke_wait_valid" \
      "$(smoke_command_event "$smoke_consume_command_valid" "$smoke_mismatch_receipt")")")"
fi
assert_equals "the shared Codex protocol forbids full-history forks with explicit roles" \
  "1" "$(grep -Fc 'Every launch that selects an explicit `agent_type` starts with fresh context: set `fork_turns="none"`.' \
    "$REPO_ROOT/plugin/skills/_shared/platform/codex/subagents.md" || true)"

SMOKE_HOME_FIXTURE="$TEST_HOME/smoke-home-fixture/.codex"
mkdir -p "$SMOKE_HOME_FIXTURE/agents"
printf 'fixture-auth\n' > "$SMOKE_HOME_FIXTURE/auth.json"
printf 'fixture-role\n' > "$SMOKE_HOME_FIXTURE/agents/oso-integrator.toml"
printf '{"hooks":{}}\n' > "$SMOKE_HOME_FIXTURE/hooks.json"
printf '# operator config.toml, unrelated to any smoke run\n' > "$SMOKE_HOME_FIXTURE/config.toml"
SMOKE_HOME_SNAPSHOT="$TEST_HOME/smoke-home-fixture-snapshot"
cp -a "$SMOKE_HOME_FIXTURE" "$SMOKE_HOME_SNAPSHOT"

smoke_home_probe() (
  CODEX_HOME="$SMOKE_HOME_FIXTURE"
  AGENTS_DIR="$SMOKE_HOME_FIXTURE/agents"
  HOOKS_FILE="$SMOKE_HOME_FIXTURE/hooks.json"
  RUNTIME_ROOT="$TEST_HOME/smoke-home-fixture-runtime"
  SMOKE_ROOT="$TEST_HOME/smoke-home-fixture-root"
  mkdir -p "$SMOKE_ROOT"
  . "$REPO_ROOT/bootstrap/lib/codex-managed-config.sh"
  eval "$populate_smoke_home_function"
  if ! populate_smoke_codex_home; then
    printf 'setup-failed:%s' "${SMOKE_SETUP_RESULT:-unknown}"
    return
  fi
  if [ -f "$SMOKE_CODEX_HOME/auth.json" ] &&
     [ -f "$SMOKE_CODEX_HOME/agents/oso-integrator.toml" ] &&
     [ -f "$SMOKE_CODEX_HOME/hooks.json" ] &&
     [ -f "$SMOKE_CODEX_HOME/config.toml" ]; then
    printf populated
  else
    printf incomplete
  fi
)
assert_equals "the isolated Codex home receives a copied credential, role and rendered config" \
  populated "$(smoke_home_probe)"
assert_equals "building the isolated home leaves the operator's own Codex home byte-identical, config.toml included" \
  "identical" "$(diff -rq "$SMOKE_HOME_SNAPSHOT" "$SMOKE_HOME_FIXTURE" >/dev/null 2>&1 && printf identical || printf mutated)"

HOST_CONTRACT_VERIFY_SH="$REPO_ROOT/bootstrap/verify-codex.sh"
HOST_CONTRACT_SUPPORTED_VERSION="$(sed -n 's/^SUPPORTED_CODEX_VERSION=//p' \
  "$REPO_ROOT/bootstrap/install-codex.sh")"
HOST_CONTRACT_UNVERIFIED_VERSION="${HOST_CONTRACT_SUPPORTED_VERSION}-unverified-fixture"
HOST_CONTRACT_FORK_CONTEXT_LITERAL='fork_context is not supported in MultiAgentV2; use fork_turns instead'
HOST_CONTRACT_FORK_TURNS_LITERAL='fork_turns must be `none`, `all`, or a positive integer string'

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

HOST_CONTRACT_UNDEFINED_PROFILE_LITERAL='default_permissions refers to undefined profile `'
HOST_CONTRACT_DUAL_OVERRIDE_LITERAL='`permission_profile` and `default_permissions` overrides cannot both be set'

write_permission_override_codex_shim() {
  local shim_dir="$1" with_undefined_profile="$2" with_dual_override="$3" version="$4"
  mkdir -p "$shim_dir"
  printf '%s\n' '#!/bin/sh' > "$shim_dir/codex"
  if [ "$with_undefined_profile" = yes ]; then
    printf '# %s\n' "$HOST_CONTRACT_UNDEFINED_PROFILE_LITERAL" >> "$shim_dir/codex"
  fi
  if [ "$with_dual_override" = yes ]; then
    printf '# %s\n' "$HOST_CONTRACT_DUAL_OVERRIDE_LITERAL" >> "$shim_dir/codex"
  fi
  printf '%s\n' \
    'case "$*" in' \
    "  --version) printf '%s\\n' 'codex-cli $version' ;;" \
    '  *) exit 1 ;;' \
    'esac' >> "$shim_dir/codex"
  chmod +x "$shim_dir/codex"
}

PERMISSION_OVERRIDE_CONFORMANT_SHIMS="$TEST_HOME/permission-override-conformant-shims"
PERMISSION_OVERRIDE_CONFORMANT_HOME="$TEST_HOME/permission-override-conformant-home"
mkdir -p "$PERMISSION_OVERRIDE_CONFORMANT_HOME/.codex"
write_permission_override_codex_shim "$PERMISSION_OVERRIDE_CONFORMANT_SHIMS" yes yes \
  "$HOST_CONTRACT_SUPPORTED_VERSION"
PERMISSION_OVERRIDE_CONFORMANT_OUTPUT="$(
  HOME="$PERMISSION_OVERRIDE_CONFORMANT_HOME" \
    CODEX_HOME="$PERMISSION_OVERRIDE_CONFORMANT_HOME/.codex" \
    PATH="$PERMISSION_OVERRIDE_CONFORMANT_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim carrying both permission-override literals at the supported version reads as conformant" \
  "1" "$(printf '%s\n' "$PERMISSION_OVERRIDE_CONFORMANT_OUTPUT" | \
    grep -Fxc 'ok:   Codex binary matches the default_permissions override contract (conformant)' || true)"

PERMISSION_OVERRIDE_NONCONFORMANT_SHIMS="$TEST_HOME/permission-override-nonconformant-shims"
PERMISSION_OVERRIDE_NONCONFORMANT_HOME="$TEST_HOME/permission-override-nonconformant-home"
mkdir -p "$PERMISSION_OVERRIDE_NONCONFORMANT_HOME/.codex"
write_permission_override_codex_shim "$PERMISSION_OVERRIDE_NONCONFORMANT_SHIMS" no yes \
  "$HOST_CONTRACT_SUPPORTED_VERSION"
PERMISSION_OVERRIDE_NONCONFORMANT_OUTPUT="$(
  HOME="$PERMISSION_OVERRIDE_NONCONFORMANT_HOME" \
    CODEX_HOME="$PERMISSION_OVERRIDE_NONCONFORMANT_HOME/.codex" \
    PATH="$PERMISSION_OVERRIDE_NONCONFORMANT_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim missing one permission-override literal at the supported version fails through check() rather than passing" \
  "1" "$(printf '%s\n' "$PERMISSION_OVERRIDE_NONCONFORMANT_OUTPUT" | \
    grep -Fxc 'FAIL: Codex binary matches the default_permissions override contract — expected conformant, got nonconformant' || true)"

PERMISSION_OVERRIDE_UNVERIFIED_SHIMS="$TEST_HOME/permission-override-unverified-shims"
PERMISSION_OVERRIDE_UNVERIFIED_HOME="$TEST_HOME/permission-override-unverified-home"
mkdir -p "$PERMISSION_OVERRIDE_UNVERIFIED_HOME/.codex"
write_permission_override_codex_shim "$PERMISSION_OVERRIDE_UNVERIFIED_SHIMS" yes yes \
  "$HOST_CONTRACT_UNVERIFIED_VERSION"
PERMISSION_OVERRIDE_UNVERIFIED_OUTPUT="$(
  HOME="$PERMISSION_OVERRIDE_UNVERIFIED_HOME" \
    CODEX_HOME="$PERMISSION_OVERRIDE_UNVERIFIED_HOME/.codex" \
    PATH="$PERMISSION_OVERRIDE_UNVERIFIED_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a shim outside the supported version names both versions instead of asserting pass or fail" \
  "1" "$(printf '%s\n' "$PERMISSION_OVERRIDE_UNVERIFIED_OUTPUT" | \
    grep -Fxc "unverified: Codex permission-override contract — claims were verified against Codex $HOST_CONTRACT_SUPPORTED_VERSION only; installed $HOST_CONTRACT_UNVERIFIED_VERSION falls outside that window, so pass/fail is not asserted here" || true)"

assert_equals "no codex on PATH skips the permission-override check rather than tallying a pass" \
  "complete" "$(
    if printf '%s\n' "$HOST_CONTRACT_SKIP_OUTPUT" | \
        grep -Fxq 'skip: Codex permission-override contract — codex is not on PATH, so the host contract could not be asserted' &&
       ! printf '%s\n' "$HOST_CONTRACT_SKIP_OUTPUT" | \
        grep -Fq 'Codex binary matches the default_permissions override contract'; then
      printf complete
    else
      printf incomplete
    fi
  )"

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
assert_equals "the capability columns are read by a render that produced a route table at all" \
  "0" "$("$HOOK_RENDERER" --host opencode --table "$REPO_ROOT/tools/hook-gates.txt" | wc -c | tr -d ' ' | { read -r bytes; [ "$bytes" -gt 0 ] && echo 0 || echo 1; })"

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

MCP_DRIFT_CODEX_SHIM_DIR="$TEST_HOME/mcp-drift-codex-shim"
mkdir -p "$MCP_DRIFT_CODEX_SHIM_DIR"
printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in' \
  '  --version) printf '\''codex-cli 0.0.0-test\n'\''; exit 0 ;;' \
  '  *) exit 1 ;;' \
  'esac' > "$MCP_DRIFT_CODEX_SHIM_DIR/codex"
chmod +x "$MCP_DRIFT_CODEX_SHIM_DIR/codex"

run_mcp_drift_check() {
  local repo_root="$1" codex_home="$2" bound="$3"
  HOME="$(dirname "$codex_home")" CODEX_HOME="$codex_home" \
    OSO_VERIFY_SKIP_SMOKE=1 OSO_MCP_DRIFT_BOUND_SECONDS="$bound" \
    PATH="$MCP_DRIFT_CODEX_SHIM_DIR:$PATH" \
    bash "$repo_root/bootstrap/verify-codex.sh" 2>&1 || true
}

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

MCP_DRIFT_URL_HOME="$TEST_HOME/mcp-drift-url-home/.codex"
mcp_drift_config_home "$MCP_DRIFT_URL_HOME" '
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
'
MCP_DRIFT_URL_OUTPUT="$(run_mcp_drift_check "$REPO_ROOT" "$MCP_DRIFT_URL_HOME" 3)"
assert_equals "a remote url-based server skips with its own named reason" 1 \
  "$(printf '%s\n' "$MCP_DRIFT_URL_OUTPUT" | \
    grep -Fc 'skip: context7 MCP tool drift — no local command in' || true)"

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
if oso_nightly_only "the bounded MCP drift check ends well inside a generous multiple of its own bound"; then
  assert_equals "the bounded MCP drift check ends well inside a generous multiple of its own bound" \
    "bounded" "$([ "$MCP_DRIFT_HANG_ELAPSED" -le 30 ] && printf bounded || printf "unbounded:${MCP_DRIFT_HANG_ELAPSED}s")"
fi
if pgrep -f "$MCP_DRIFT_HANGING_SERVER" >/dev/null 2>&1; then
  echo "FAIL: the hanging MCP fixture server outlived the bounded check"; fail=$((fail + 1))
else
  echo "ok: the hanging MCP fixture server does not outlive the bounded check"; pass=$((pass + 1))
fi

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
      OSO_VERIFY_SKIP_SMOKE=1 PATH="$MCP_DRIFT_CODEX_SHIM_DIR:$PATH" \
      bash "$MCP_DRIFT_AGREEMENT_FIXTURE/bootstrap/verify-codex.sh" 2>&1 || true
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

PLAN_BODY="$PLUGIN/skills/_shared/bodies/plan.md"
plan_section() {
  sed -n "/^## $1\. /,/^## [0-9]/p" "$PLAN_BODY"
}

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

codex_loss_ledger="$(sed -n \
  '/^## Frozen loss and degradation ledger$/,/^## /p' \
  "$REPO_ROOT/docs/parity-codex.md" 2>/dev/null)"
codex_loss_rows="$(printf '%s\n' "$codex_loss_ledger" | awk '
  /^\| Loss or degradation \|/ { next }
  /^\|---/ { next }
  /^\|/ { rows++ }
  END { print rows + 0 }
')"
assert_equals "the frozen Codex ledger carries exactly its seven release losses" \
  "7" "$codex_loss_rows"
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
The oso permission profile is the machine default because Codex has no per-project profile selection
`.git/config` = `"read"`
`oso-state` flags, plan documents and install-backup snapshots
A roadmap runs ASSISTED here, never unattended
present once per child
CODEX_FROZEN_LOSS_TABLE

opencode_loss_ledger="$(sed -n \
  '/^## Frozen loss and degradation ledger$/,/^## /p' \
  "$REPO_ROOT/docs/parity-opencode.md" 2>/dev/null)"
opencode_loss_rows="$(printf '%s\n' "$opencode_loss_ledger" | awk '
  /^\| Loss or degradation \|/ { next }
  /^\|---/ { next }
  /^\|/ { rows++ }
  END { print rows + 0 }
')"
assert_equals "the frozen OpenCode ledger carries exactly its four release losses" \
  "4" "$opencode_loss_rows"
assert_says_every "the frozen OpenCode ledger names every loss and remaining boundary" \
  "$opencode_loss_ledger" <<'OPENCODE_FROZEN_LOSS_TABLE'
These four entries are release requirements
A headless child cannot write inside the worktree it was pinned to
auto-rejecting
a cross-worktree write stays red under the same refusal
never that isolation held
Headless slash-command sessions are unusable
never rely on `opencode run --command`
Slash-command behavior is TUI-verified only
No subagents/handoff receipt rail
no receipt file mediates consumption
cannot correlate a kill to a partial verdict
The workspace adapter's create handshake is not implemented
registers for discovery only
the orchestrator creates it
only pins that existing tree
The success path has never been observed
WorkspaceCreateError: Timed out waiting for global event
OPENCODE_FROZEN_LOSS_TABLE
opencode_parity_doc="$(cat "$REPO_ROOT/docs/parity-opencode.md" 2>/dev/null)"
case "$opencode_parity_doc" in
  *'`oso_wave` runs its own `git worktree add`'*|*'`oso_wave` creates its own worktrees'*)
    echo "FAIL: the OpenCode parity ledger credits oso_wave with creating a wave's worktrees again"; fail=$((fail + 1)) ;;
  *)
    echo "ok: the OpenCode parity ledger leaves worktree creation with the orchestrator, never oso_wave"; pass=$((pass + 1)) ;;
esac

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

assert_says_every "a material change invalidates approval and re-presents the whole plan" \
  "$(plan_section 5)" <<'APPROVAL_INVALIDATION_TABLE'
Approval applies only to that exact document
A material change after presentation invalidates it
re-present the complete repaso-first plan
fresh approval
APPROVAL_INVALIDATION_TABLE

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

assert_says_every "the Verification row settles per-slice commits, on by default" \
  "$(plan_section 3)" <<'PER_SLICE_COMMIT_PREFERENCE_TABLE'
per-slice commits are ON
turns them off HERE, the only place it is settled
PER_SLICE_COMMIT_PREFERENCE_TABLE

assert_says_every "the sequential path commits each slice it takes green" \
  "$(plan_section 6)" <<'SEQUENTIAL_COMMIT_TABLE'
git -C <main checkout> commit
a COMMIT and never a push
SEQUENTIAL_COMMIT_TABLE

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

assert_says_every "the execution phase triages a red wave before routing it" \
  "$(plan_section 6)" <<'WAVE_TRIAGE_TABLE'
INVOKE the triage judge
it takes the failure routing above unchanged
the stop-the-line paragraph above runs with triage's evidence in hand
never read as either answer
WAVE_TRIAGE_TABLE

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

assert_says_every "the close asks for a push and a PR, never for a commit" \
  "$(plan_section 7)" <<'COMMIT_BOUNDARY_TABLE'
A COMMIT is part of the flow and is never asked for
PUSH and PR are the two that still require the operator to ask
COMMIT_BOUNDARY_TABLE

assert_says_every "the disposition round records the AUTO answer and leaves the arming to §5" \
  "$(plan_section 4)" <<'AUTO_MARKER_ROUND_TABLE'
RECORDED here and ARMED at §5
this phase writes no runtime state at all
AUTO_MARKER_ROUND_TABLE

assert_says_every "the initialize arms the marker with the rest of the execution state" \
  "$(plan_section 5)" <<'AUTO_MARKER_ARMING_TABLE'
`auto=running auto_change=<change-slug>` in that same write
AUTO_MARKER_ARMING_TABLE

assert_says_every "the close disarms the marker before it delivers the final report" \
  "$(plan_section 7)" <<'AUTO_MARKER_CLOSE_TABLE'
DISARM first — `oso-state set auto=done`, a tool call
that same turn's trailing text
AUTO_MARKER_CLOSE_TABLE

assert_says_every "the initialize cuts the run its own branch beside the marker" \
  "$(plan_section 5)" <<'AUTO_RUN_BRANCH_TABLE'
checkout -b oso-run/<change>
skipped only on a RESUME
Record the branch in the ledger
AUTO_RUN_BRANCH_TABLE

assert_says_every "the close finishes an unattended run at its own branch and PR" \
  "$(plan_section 7)" <<'AUTO_FINISH_TABLE'
Under an UNATTENDED run they are the FINISH instead
push -u origin
gh pr create
its MERGE, a release and a production deploy are on the never-solo list
PARKED as a named pending
never a silent skip and never a retry loop
AUTO_FINISH_TABLE

assert_says_every "the resume check migrates a legacy personal-scope record instead of re-asking the project" \
  "$(plan_section 0)" <<'PROJECT_RECORD_MIGRATION_TABLE'
under `scope: personal` migrates
scope becomes project, every value it holds is kept
never a reason to ask them again
PROJECT_RECORD_MIGRATION_TABLE

assert_says_every "the ceiling ask mirrors the production route into the file the gate reads" \
  "$(grep -F -- "AUTO's CEILING" "$PLAN_BODY")" <<'CEILING_MIRROR_TABLE'
deploy-deny/<digest>.patterns
ONE ERE PER LINE
through SHELL
is REPORTED, with what could not be written and where
arms no AUTO at all
CEILING_MIRROR_TABLE

assert_says_every "the roadmap's blocked exit parks the child's marker instead of leaving it running" \
  "$(grep -F -- '**The chain is BLOCKED**' "$PLUGIN/skills/_shared/bodies/roadmap.md")" \
  <<'BLOCKED_PARK_TABLE'
oso-state set auto=parked
The `roadmap` key stays armed
BLOCKED_PARK_TABLE

assert_says_every "the resume check reports the worktrees a previous session left standing" \
  "$(plan_section 0)" <<'RESUME_WORKTREES_TABLE'
git -C <main checkout> worktree list
report every worktree of this change still standing
oso/<change>/<slice>
RESUME_WORKTREES_TABLE

assert_says_every "the integrator removes worktrees before deleting the branches they hold" \
  "$(cat "$PLUGIN/agents/oso-integrator.md")" <<'TEARDOWN_ORDER_TABLE'
remove the wave's worktrees first, then delete its branches
git refuses to delete a branch a standing worktree still has checked out
TEARDOWN_ORDER_TABLE

CODEX_PLATFORM="$PLUGIN/skills/_shared/platform/codex"
report_when_unclaimed() {
  local verdict="$1" claim_shape="$2"
  grep -Eiq "$claim_shape" "$CODEX_PLATFORM"/*.md || printf '%s\n' "$verdict"
}

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

CODEX_FRONT_SURFACE="$PLUGIN/skills/_shared/platform/codex/front-surface.md"
codex_front_surface_routes_missing=""
for codex_front_mode in plan quick debug; do
  grep -qF 'front-surface.md' "$CODEX_PLATFORM/$codex_front_mode.md" 2>/dev/null \
    || codex_front_surface_routes_missing="$codex_front_surface_routes_missing $codex_front_mode"
done
assert_equals "every Codex mode with front work routes it through one platform adapter" \
  "" "$codex_front_surface_routes_missing"

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

  printf '%s\n' 'cache changed later' > "$IMPECCABLE_CACHE/reference/playbook.md"
  assert_equals "the mounted reference is independent of later cache mutation" \
    "stable playbook" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

  printf '%s\n' 'stale local file' > "$IMPECCABLE_MOUNT/stale.md"
  if remount_report="$("$MOUNT_IMPECCABLE" "$IMPECCABLE_CACHE" 2>&1)"; then
    assert_equals "a second mount replaces stale destination contents" \
      "gone" "$([ ! -e "$IMPECCABLE_MOUNT/stale.md" ] && printf gone || printf present)"
    assert_equals "a second mount refreshes the independent snapshot" \
      "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"

    mv "$IMPECCABLE_CACHE" "$IMPECCABLE_CACHE.collected"
    assert_equals "the mounted skill survives collection of its cache version" \
      "cache changed later" "$(cat "$IMPECCABLE_MOUNT/reference/playbook.md")"
    mv "$IMPECCABLE_CACHE.collected" "$IMPECCABLE_CACHE"
  else
    echo "FAIL: a second Impeccable mount was not idempotent — ${remount_report:-<empty>}"
    fail=$((fail + 1))
  fi

  IMPECCABLE_MOUNT_LOCK="$HOME/.agents/skills/.impeccable.mount.lock"
  mkdir -p "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token"
  printf 'pid=%s;token=live-fixture-token\n' "$$" \
    > "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token/identity"
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
  assert_equals "live-lock rejection preserves the owner's exact identity" \
    "pid=$$;token=live-fixture-token" \
    "$(cat "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token/identity")"

  rm -rf "$IMPECCABLE_MOUNT_LOCK/owner.live-fixture-token"
  mkdir -p "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token"
  printf 'pid=2147483647;token=dead-fixture-token\n' \
    > "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token/identity"
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
    "$(cat "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token/identity")"

  rm -rf "$IMPECCABLE_MOUNT_LOCK/owner.dead-fixture-token"
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

  ABA_REAL_MKDIR="$(command -v mkdir)"
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
    'exec "$ABA_REAL_MKDIR" "$@"' \
    > "$ABA_SHIMS/mkdir"
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
  chmod +x "$ABA_SHIMS/mkdir" "$ABA_SHIMS/mv" "$ABA_SHIMS/cp"

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
      ABA_CONTROL="$ABA_CONTROL" ABA_REAL_MKDIR="$ABA_REAL_MKDIR" \
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
        ABA_CONTROL="$ABA_CONTROL" ABA_REAL_MKDIR="$ABA_REAL_MKDIR" \
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
    aba_owner_entries="$(find "$aba_registry" -mindepth 1 -maxdepth 1 -type d -name 'owner.*' 2>/dev/null)"
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

export CLAUDE_CODE_SESSION_ID="$SESSION"
bash -c 'oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false'
assert_denies "skill-documented env var arms the gate" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" clear

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

  assert_equals "a second repository names a second state file" "different" \
    "$([ "$(state_key_written_from "$REPO_ROOT")" != "$expected_key" ] && echo different || echo collided)"

  git -C "$KEY_REPO" worktree remove --force "$KEY_WORKTREE"
  git -C "$KEY_REPO" worktree prune
  rm -rf "$KEY_REPO"
fi
rm -f "$STATE_DIR"/*.state

state_file_of() { ( . "$PLUGIN/hooks/lib.sh"; state_file_for "$1" ); }
traversal_state="$(state_file_of '/tmp/../../../etc/passwd')"
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
DEEP_REPO="$TEST_HOME/deep"
while [ "${#DEEP_REPO}" -lt 300 ]; do DEEP_REPO="$DEEP_REPO/nested-directory-name"; done
mkdir -p "$DEEP_REPO"
( cd "$DEEP_REPO" && oso-state --session "$SESSION" set mode=plan verify_green=false ) >/dev/null 2>&1 || true
assert_denies "a repository nested past NAME_MAX still arms its commit gate" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x' "$DEEP_REPO")"
( cd "$DEEP_REPO" && oso-state --session "$SESSION" clear ) >/dev/null 2>&1 || true
rm -rf "$TEST_HOME/deep"
no_digest_rc=0
( . "$PLUGIN/hooks/lib.sh"; PATH="$TEST_HOME/no-tools"; state_file_for /repo ) >/dev/null 2>&1 ||
  no_digest_rc=$?
assert_equals "a host that can spell no digest blocks instead of naming every repo alike" \
  2 "$no_digest_rc"

( for i in $(seq 1 25); do oso-state --session "$SESSION" set "a=$i" >/dev/null; done ) &
( for i in $(seq 1 25); do oso-state --session "$SESSION" set "b=$i" >/dev/null; done ) &
wait
assert_equals "concurrent writers preserve all keys" "a=25 b=25" \
  "a=$(oso-state --session "$SESSION" get a) b=$(oso-state --session "$SESSION" get b)"
oso-state --session "$SESSION" clear

stale_lock="$REPO_STATE.lock"
mkdir -p "$stale_lock"
touch -t 200001010000 "$stale_lock"
oso-state --session "$SESSION" set stale_ok=yes >/dev/null 2>&1 || true
assert_equals "stale lock is reclaimed" yes "$(oso-state --session "$SESSION" get stale_ok)"
oso-state --session "$SESSION" clear

JOURNAL_DIR="$STATE_DIR/runs/$REPO_KEY"

journal_milestone() {
  ( cd "${2:-$REPO_ROOT}" && oso-state --session "$SESSION" journal "$1" ) 2>/dev/null || true
}

journal_texts_in() {
  { cut -d' ' -f2- "$1" 2>/dev/null || true; } | tr '\n' '>'
}

rm -rf "$STATE_DIR/runs"
long_milestone='wave 3 verifier'
while [ "${#long_milestone}" -lt 240 ]; do
  long_milestone="$long_milestone, slice 7 applied and the bar closed green"
done
journal_milestone "$long_milestone"
journaled_line="$({ cat "$JOURNAL_DIR/run.log" 2>/dev/null || true; })"
journaled_text="${journaled_line#* }"
assert_equals "the journaled milestone runs past the event log's 120-byte command head" \
  "past" "$([ "${#journaled_text}" -gt 200 ] && echo past || echo short)"
assert_equals "a milestone longer than the event cap is journaled byte-intact, never truncated" \
  "$long_milestone" "$journaled_text"

rm -rf "$STATE_DIR/runs"
journal_milestone "wave 1 armed"
journal_milestone "wave 1 verified"
assert_equals "two milestones append to one journal in the order they happened" \
  "wave 1 armed>wave 1 verified>" "$(journal_texts_in "$JOURNAL_DIR/run.log")"

rm -rf "$STATE_DIR/runs"
marker_reads=""
for run_marker in running parked done; do
  oso-state --session "$SESSION" set "auto=$run_marker" auto_change=auto-continuity
  journal_milestone "the run is $run_marker"
  marker_reads="$marker_reads $(oso-state --session "$SESSION" get auto)"
done
assert_equals "the run marker round-trips running, parked and done, journaling under its change" \
  "running parked done|the run is running>the run is parked>the run is done>" \
  "${marker_reads# }|$(journal_texts_in "$JOURNAL_DIR/auto-continuity.log")"
marker_shown="$(oso-state --session "$SESSION" show)"
marker_keys_unshown=""
for marker_key in auto auto_change; do
  case "$marker_shown" in
    *"$marker_key="*) ;;
    *) marker_keys_unshown="$marker_keys_unshown $marker_key" ;;
  esac
done
assert_equals "show carries the marker beside the change slug its journal is named after" \
  "|auto-continuity.log" "$marker_keys_unshown|$(ls "$JOURNAL_DIR" 2>/dev/null || true)"
oso-state --session "$SESSION" clear

rm -rf "$STATE_DIR/runs"
JOURNAL_PLAIN="$TEST_HOME/journal-outside-git"
mkdir -p "$JOURNAL_PLAIN"
journal_milestone "no repository names this directory" "$JOURNAL_PLAIN"
assert_equals "a directory git cannot name journals under the same fallback its state file takes" \
  "no repository names this directory>" \
  "$(journal_texts_in "$STATE_DIR/runs/$(state_key_of "$JOURNAL_PLAIN")/run.log")"

rm -rf "$STATE_DIR/runs"
JOURNAL_REPO="$TEST_HOME/journal-repo"
JOURNAL_WORKTREE="$TEST_HOME/journal-worktree"
if ! command -v git >/dev/null 2>&1; then
  echo "skip: git is absent here, so a run has no second tree to journal from"
  skipped=$((skipped + 1))
else
  mkdir -p "$JOURNAL_REPO"
  git -C "$JOURNAL_REPO" init -q
  git -C "$JOURNAL_REPO" config user.email tests@oso-code.invalid
  git -C "$JOURNAL_REPO" config user.name "oso-code tests"
  git -C "$JOURNAL_REPO" config commit.gpgsign false
  printf 'base\n' > "$JOURNAL_REPO/base.txt"
  git -C "$JOURNAL_REPO" add base.txt
  git -C "$JOURNAL_REPO" commit -qm base
  git -C "$JOURNAL_REPO" worktree add -q -b oso/journal "$JOURNAL_WORKTREE"
  ( cd "$JOURNAL_REPO" && oso-state --session "$SESSION" set auto_change=wave-2 >/dev/null )
  journal_milestone "the orchestrator armed wave 2" "$JOURNAL_REPO"
  journal_milestone "the applier landed slice 3" "$JOURNAL_WORKTREE"
  assert_equals "a linked worktree appends to the journal its main checkout opened" \
    "the orchestrator armed wave 2>the applier landed slice 3>" \
    "$(journal_texts_in "$STATE_DIR/runs/$(state_key_of "$JOURNAL_REPO")/wave-2.log")"
  ( cd "$JOURNAL_REPO" && oso-state --session "$SESSION" clear )
  git -C "$JOURNAL_REPO" worktree remove --force "$JOURNAL_WORKTREE"
  git -C "$JOURNAL_REPO" worktree prune
  rm -rf "$JOURNAL_REPO"
fi

rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" set auto=running auto_change=path-read >/dev/null
journal_path_read="$( cd "$REPO_ROOT" && oso-state --session "$SESSION" journal --path )"
journal_path_tree="$(ls "$STATE_DIR/runs" 2>/dev/null || echo unwritten)"
journal_milestone "the milestone that opens the file --path named"
assert_equals "journal --path names the run journal the same call would append to, and opens nothing to say so" \
  "$JOURNAL_DIR/path-read.log unwritten opened" \
  "$journal_path_read $journal_path_tree $([ -s "$JOURNAL_DIR/path-read.log" ] && echo opened || echo unopened)"
rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

rm -rf "$STATE_DIR/runs"
journal_usage_stderr="$TEST_HOME/journal-usage-stderr"
journal_missing_rc=0
oso-state --session "$SESSION" journal 2>"$journal_usage_stderr" || journal_missing_rc=$?
journal_empty_rc=0
oso-state --session "$SESSION" journal "" 2>>"$journal_usage_stderr" || journal_empty_rc=$?
journal_after_refusal="$(ls "$STATE_DIR/runs" 2>/dev/null || echo unwritten)"
case "$({ cat "$journal_usage_stderr" 2>/dev/null || true; })" in
  usage:*) journal_refusal=usage ;;
  '') journal_refusal=silent ;;
  *) journal_refusal=other ;;
esac
journal_milestone "the milestone that does carry text"
assert_equals "a journal call with no milestone text is a usage error, never a timestamped empty line" \
  "1 1 usage unwritten opened" \
  "$journal_missing_rc $journal_empty_rc $journal_refusal $journal_after_refusal $([ -s "$JOURNAL_DIR/run.log" ] && echo opened || echo unopened)"
rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" set auto_change=../escape >/dev/null
journal_milestone "the slug climbed out of its run directory"
oso-state --session "$SESSION" set auto_change=a/b >/dev/null
journal_milestone "the slug named a subdirectory"
journal_tree="$(find "$STATE_DIR/runs" -mindepth 1 -print 2>/dev/null | LC_ALL=C sort | tr '\n' '>' || true)"
assert_equals "a change slug carrying a path separator journals under the fallback, leaving nothing outside its own run directory" \
  "$JOURNAL_DIR>$JOURNAL_DIR/run.log>|the slug climbed out of its run directory>the slug named a subdirectory>" \
  "$journal_tree|$(journal_texts_in "$JOURNAL_DIR/run.log")"

rm -rf "$STATE_DIR/runs"
over_length_change=w
while [ "${#over_length_change}" -le 64 ]; do
  over_length_change="${over_length_change}9"
done
oso-state --session "$SESSION" set "auto_change=$over_length_change" >/dev/null
journal_milestone "the slug ran past 64 characters"
oso-state --session "$SESSION" set auto_change=Wave-2 >/dev/null
journal_milestone "the slug shouted"
oso-state --session "$SESSION" set "auto_change=wave 2" >/dev/null
journal_milestone "the slug carried a space"
assert_equals "an over-length or out-of-charset change slug journals under the fallback, never under itself" \
  "run.log|the slug ran past 64 characters>the slug shouted>the slug carried a space>" \
  "$(ls "$JOURNAL_DIR" 2>/dev/null || true)|$(journal_texts_in "$JOURNAL_DIR/run.log")"

rm -rf "$STATE_DIR/runs"
maximal_change=w9
while [ "${#maximal_change}" -lt 64 ]; do
  maximal_change="${maximal_change}-9"
done
oso-state --session "$SESSION" set "auto_change=$maximal_change" >/dev/null
journal_milestone "the longest slug the rule admits"
assert_equals "a 64-character slug of the admitted charset names its journal verbatim" \
  "64 ${maximal_change}.log|the longest slug the rule admits>" \
  "${#maximal_change} $(ls "$JOURNAL_DIR" 2>/dev/null || true)|$(journal_texts_in "$JOURNAL_DIR/${maximal_change}.log")"
rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

AUTO_JOURNAL="$JOURNAL_DIR/auto-continuity.log"

auto_stop_input() {
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","hook_event_name":"Stop","stop_hook_active":%s}' \
    "${1:-$SESSION}" "$TRANSCRIPT" "${3:-$REPO_ROOT}" "${2:-false}"
}

arm_unattended_run() {
  rm -rf "$STATE_DIR/runs"
  oso-state --session "$SESSION" set auto=running auto_change=auto-continuity >/dev/null
}

auto_stop_verdict() {
  run_hook auto-continue.sh "$1"
  if [ -n "$hook_problem" ]; then
    printf 'crashed:%s' "$hook_problem"
  elif hook_returned_block; then
    printf 'push'
  elif [ "$hook_stdout" = '{}' ]; then
    printf 'stop'
  else
    printf 'neither:%s' "${hook_stdout:-<empty>}"
  fi
}

arm_unattended_run
run_hook auto-continue.sh "$(auto_stop_input)"
assert_after_hook "a turn ending while an unattended run is in flight is pushed back into motion" \
  hook_returned_block
auto_push_reason="$(printf '%s' "$hook_stdout" | sed -n 's/.*"reason":"\(.*\)"}$/\1/p')"
auto_anchors_missing=""
for auto_anchor in 'oso/index NEXT:' active_slice 'oso-state journal' park 'do NOT relaunch it'; do
  case "$auto_push_reason" in
    *"$auto_anchor"*) ;;
    *) auto_anchors_missing="$auto_anchors_missing $auto_anchor" ;;
  esac
done
assert_equals "the push re-anchors the run on position, journal and park, and forbids relaunching a delegation, never a bare block" \
  "" "$auto_anchors_missing"

auto_settled_verdicts=""
for settled_marker in parked done; do
  oso-state --session "$SESSION" set "auto=$settled_marker" >/dev/null
  auto_settled_verdicts="$auto_settled_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
done
oso-state --session "$SESSION" clear
auto_settled_verdicts="$auto_settled_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
arm_unattended_run
auto_settled_verdicts="$auto_settled_verdicts $(auto_stop_verdict "$(auto_stop_input another-session)")"
assert_equals "a parked run, a finished one, an unmarked repository and a foreign session all end their turn untouched" \
  "stop stop stop stop" "${auto_settled_verdicts# }"

oso-state --session "$SESSION" clear
rm -rf "$STATE_DIR/runs"
mkdir -p "$REPO_STATE"
auto_uncertain_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
rmdir "$REPO_STATE"
printf 'this file is not state at all\n' > "$REPO_STATE"
auto_uncertain_verdicts="$auto_uncertain_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
rm -f "$REPO_STATE"
arm_unattended_run
auto_uncertain_verdicts="$auto_uncertain_verdicts $(auto_stop_verdict 'this payload is not JSON')"
auto_uncertain_verdicts="$auto_uncertain_verdicts $(auto_stop_verdict '{"hook_event_name":"Stop"}')"
assert_equals "an unreadable state path, a garbage one and an unparseable payload fail open, writing no run trail" \
  "stop stop stop stop|unwritten" \
  "${auto_uncertain_verdicts# }|$(ls "$STATE_DIR/runs" 2>/dev/null || echo unwritten)"

AUTO_CAP_MILESTONE='auto-continue: cap reached after 3 pushes without progress — allowing the stop'
arm_unattended_run
auto_cap_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
for _ in 1 2 3; do
  auto_cap_verdicts="$auto_cap_verdicts $(auto_stop_verdict "$(auto_stop_input "$SESSION" true)")"
done
assert_equals "three pushes without a milestone between them exhaust the net, and the fourth stop stands in the journal" \
  "push push push stop|$AUTO_CAP_MILESTONE>" \
  "${auto_cap_verdicts# }|$(journal_texts_in "$AUTO_JOURNAL")"
auto_past_cap_verdict="$(auto_stop_verdict "$(auto_stop_input "$SESSION" true)")"
assert_equals "past the cap every stop stands and the trail says so exactly once" \
  "stop|$AUTO_CAP_MILESTONE>" \
  "$auto_past_cap_verdict|$(journal_texts_in "$AUTO_JOURNAL")"

arm_unattended_run
auto_progress_verdicts=""
for auto_slice in 1 2 3 4; do
  auto_progress_verdicts="$auto_progress_verdicts $(auto_stop_verdict "$(auto_stop_input "$SESSION" true)")"
  journal_milestone "the applier landed slice $auto_slice"
done
assert_equals "a milestone between pushes resets the count, so the net never lets go of a run that is moving" \
  "push push push push" "${auto_progress_verdicts# }"

arm_unattended_run
auto_belt_verdicts=""
for _ in 1 2 3; do
  auto_belt_verdicts="$auto_belt_verdicts $(auto_stop_verdict "$(auto_stop_input "$SESSION" true)")"
done
assert_equals "a turn this hook already continued counts as a push even before any tally exists" \
  "push push stop" "${auto_belt_verdicts# }"

auto_events_recorded() {
  grep -c '"event":"'"$1"'","command":"[^"]' "$STATE_DIR/events.jsonl" 2>/dev/null || true
}

arm_unattended_run
auto_degradations_before="$(auto_events_recorded auto-continue-degraded)"
mkdir -p "${AUTO_JOURNAL%.log}.pushes"
auto_degraded_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
rm -rf "$JOURNAL_DIR"
printf 'a file stands where the run directory belongs\n' > "$JOURNAL_DIR"
auto_degraded_verdicts="$auto_degraded_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
rm -f "$JOURNAL_DIR"
auto_degradations_after="$(auto_events_recorded auto-continue-degraded)"
assert_equals "a push tally the net can neither read nor write allows the stop and puts the cause on the record" \
  "stop stop 2" \
  "${auto_degraded_verdicts# } $((auto_degradations_after - auto_degradations_before))"

AUTO_TALLY="${AUTO_JOURNAL%.log}.pushes"
AUTO_WAIT_MARK="${AUTO_JOURNAL%.log}.waiting"
AUTO_EXPIRED_CLAUSE='older than 45 minutes'
AUTO_EXPIRED_CAP_MILESTONE='auto-continue: cap reached after 3 pushes with a delegation marked in flight past 45 minutes — allowing the stop'

auto_tally_of() {
  { cat "$AUTO_TALLY" 2>/dev/null || echo unwritten; } | tr '\n' '>'
}

arm_unattended_run
auto_wait_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
oso-state --session "$SESSION" set auto_wait=3 >/dev/null
auto_holds_before="$(auto_events_recorded auto-continue-held)"
auto_wait_verdicts="$auto_wait_verdicts $(auto_stop_verdict "$(auto_stop_input "$SESSION" true)")"
auto_holds_after="$(auto_events_recorded auto-continue-held)"
assert_equals "a turn ending on a delegation still in flight is a hold, not a stall: the stop stands and the push tally is left exactly where it was" \
  "push stop|pushes=1>journal_bytes=0>" "${auto_wait_verdicts# }|$(auto_tally_of)"
assert_equals "the held turn leaves one auto-continue-held line, so a net that held on purpose never reads back as one that never ran" \
  "1" "$((auto_holds_after - auto_holds_before))"

oso-state --session "$SESSION" set auto_wait=none >/dev/null
auto_sentinel_verdict="$(auto_stop_verdict "$(auto_stop_input)")"
assert_equals "the none sentinel is no delegation at all: the turn is pushed and the stale wait mark is cleared for the next delegation's clock" \
  "push cleared pushes=2>journal_bytes=0>" \
  "$auto_sentinel_verdict $([ -e "$AUTO_WAIT_MARK" ] && printf standing || printf cleared) $(auto_tally_of)"

arm_unattended_run
over_length_wait=w
while [ "${#over_length_wait}" -le 64 ]; do
  over_length_wait="${over_length_wait}9"
done
auto_garbled_verdicts=""
for garbled_wait in 'slice 3' '-3' "$over_length_wait"; do
  oso-state --session "$SESSION" set "auto_wait=$garbled_wait" >/dev/null
  auto_garbled_verdicts="$auto_garbled_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
done
assert_equals "a wait mark the net cannot read is no evidence of live work: every such turn is pushed and counted exactly as an unmarked run" \
  "push push push|pushes=3>journal_bytes=0>" "${auto_garbled_verdicts# }|$(auto_tally_of)"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=wave-2 >/dev/null
auto_cap_after_holds=""
for _ in 1 2 3; do
  auto_cap_after_holds="$auto_cap_after_holds $(auto_stop_verdict "$(auto_stop_input)")"
done
oso-state --session "$SESSION" set auto_wait=none >/dev/null
for _ in 1 2 3 4; do
  auto_cap_after_holds="$auto_cap_after_holds $(auto_stop_verdict "$(auto_stop_input)")"
done
assert_equals "held turns spend none of the net: a run that stalls after waiting still gets its three pushes and the plain give-up" \
  "stop stop stop push push push stop|$AUTO_CAP_MILESTONE>" \
  "${auto_cap_after_holds# }|$(journal_texts_in "$AUTO_JOURNAL")"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=wave-2 >/dev/null
auto_expiry_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
touch -t 200001010000 "$AUTO_WAIT_MARK"
run_hook auto-continue.sh "$(auto_stop_input)"
assert_after_hook "a wait mark still standing past the ceiling stops being believed, and the turn is pushed" \
  hook_returned_block
auto_expired_reason="$(printf '%s' "$hook_stdout" | sed -n 's/.*"reason":"\(.*\)"}$/\1/p')"
case "$auto_expired_reason" in
  *"$AUTO_EXPIRED_CLAUSE"*) auto_expired_wording=dated ;;
  *) auto_expired_wording="undated:$auto_expired_reason" ;;
esac
assert_equals "the push that follows an expired mark hands over the stale mark instead of repeating the plain order" \
  "dated" "$auto_expired_wording"
for _ in 1 2 3; do
  auto_expiry_verdicts="$auto_expiry_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
done
assert_equals "an expired mark spends the cap like any stall, and the give-up names the mark rather than claiming there was no progress" \
  "stop push push stop|$AUTO_EXPIRED_CAP_MILESTONE>" \
  "${auto_expiry_verdicts# }|$(journal_texts_in "$AUTO_JOURNAL")"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=wave-2 >/dev/null
auto_next_run_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
touch -t 200001010000 "$AUTO_WAIT_MARK"
oso-state --session "$SESSION" set auto=done >/dev/null
oso-state --session another-session set auto=running auto_wait=wave-2 >/dev/null
for _ in 1 2; do
  auto_next_run_verdicts="$auto_next_run_verdicts $(auto_stop_verdict "$(auto_stop_input another-session)")"
done
assert_equals "a mark the run before left behind is no sighting of a later run's delegation, so the same label is held on this run's own clock" \
  "stop stop stop" "${auto_next_run_verdicts# }"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=wave-2 >/dev/null
auto_resumed_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
touch -t 200001010000 "$AUTO_WAIT_MARK"
oso-state --session "$SESSION" set auto=parked >/dev/null
auto_resumed_verdicts="$auto_resumed_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
auto_mark_after_park="$([ -e "$AUTO_WAIT_MARK" ] && printf standing || printf cleared)"
oso-state --session "$SESSION" set auto=running >/dev/null
auto_resumed_verdicts="$auto_resumed_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
assert_equals "a run that parks with a delegation still armed leaves no mark for its resumption to inherit" \
  "stop stop stop|cleared" "${auto_resumed_verdicts# }|$auto_mark_after_park"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=slice-21 >/dev/null
auto_second_wait_verdicts=" $(auto_stop_verdict "$(auto_stop_input)")"
touch -t 200001010000 "$AUTO_WAIT_MARK"
journal_milestone 'slice 21 applier reported; the verifier for the same slice is launched'
auto_second_wait_verdicts="$auto_second_wait_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
touch -t 200001010000 "$AUTO_WAIT_MARK"
auto_second_wait_verdicts="$auto_second_wait_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
assert_equals "a second delegation under one label is a wait of its own: the belief window restarts where the run has moved since the sighting, and still expires where it has not" \
  "stop stop push" "${auto_second_wait_verdicts# }"

arm_unattended_run
oso-state --session "$SESSION" set auto_wait=wave-4 >/dev/null
auto_renewal_verdicts=""
for auto_renewal in 1 2 3 4 5; do
  auto_renewal_verdicts="$auto_renewal_verdicts $(auto_stop_verdict "$(auto_stop_input)")"
  touch -t 200001010000 "$AUTO_WAIT_MARK"
  journal_milestone "the run moved while wave 4 stayed marked in flight ($auto_renewal)"
done
assert_equals "progress renews the belief window a bounded number of times, so a mark the run keeps moving under still stops being believed rather than holding the turn open for good" \
  "stop stop stop stop push" "${auto_renewal_verdicts# }"

arm_unattended_run
mkdir -p "${AUTO_WAIT_MARK%/*}"
printf 'wave-2\n' > "$AUTO_WAIT_MARK"
touch -t 200001010000 "$AUTO_WAIT_MARK"
oso-state --session "$SESSION" set auto_wait=wave-2 >/dev/null
assert_equals "a mark an older net wrote names no run, so it is a stale file rather than this run's first sighting" \
  "stop" "$(auto_stop_verdict "$(auto_stop_input)")"

rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

PROD_PATTERNS_FILE="$STATE_DIR/deploy-deny/$REPO_KEY.patterns"

prod_gate_verdict_of() {
  run_hook "$1" "$2"
  if [ -n "$hook_problem" ]; then
    printf 'crashed:%s' "$hook_problem"
  elif hook_returned_deny; then
    printf 'deny'
  elif [ -z "$hook_stdout" ]; then
    printf 'allow'
  else
    printf 'neither:%s' "$hook_stdout"
  fi
}

prod_gate_verdict() {
  prod_gate_verdict_of block-prod-deploy.sh "$1"
}

prod_mcp_input() {
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"project":"acme"}}' \
    "$SESSION" "$TRANSCRIPT" "$REPO_ROOT" "$1"
}

prod_verdicts_for() {
  local verdicts="" prod_command
  for prod_command in "$@"; do
    verdicts="$verdicts $(prod_gate_verdict "$(bash_input "$prod_command")")"
  done
  printf '%s' "${verdicts# }"
}

prod_residues_allowed() {
  grep -c residue-allowed "$STATE_DIR/events.jsonl" 2>/dev/null || true
}

prod_verdicts_and_residues_for() {
  local before after
  before="$(prod_residues_allowed)"
  prod_verdicts_for "$@"
  after="$(prod_residues_allowed)"
  printf ' %s' "$((after - before))"
}

arm_unattended_run
assert_equals "every built-in production shape is denied while the run is in flight" \
  "deny deny deny deny deny deny" \
  "$(prod_verdicts_for 'vercel --prod' 'vercel deploy --prod --yes' 'npx vercel --prod' \
    'pnpm dlx vercel --target production' 'netlify deploy --prod' 'firebase deploy')"
assert_equals "a deploy whose production flag arrives from stdin is denied rather than read as a preview" \
  "deny deny deny deny" \
  "$(prod_verdicts_for 'echo --prod | xargs vercel' 'echo --prod | xargs -n1 vercel' \
    'printf %s --prod | xargs -0 vercel' 'echo --prod | xargs netlify deploy')"
assert_equals "a deploy CLI that only feeds xargs is none of that rule's business" \
  "allow allow allow" \
  "$(prod_verdicts_for 'vercel ls | xargs echo' 'netlify status | xargs -I{} echo {}' \
    'find . -name *.log | xargs rm')"
assert_equals "the preview and staging shapes of the same CLIs keep passing" \
  "allow allow allow allow" \
  "$(prod_verdicts_for vercel 'vercel deploy' 'vercel deploy --target=staging' 'netlify deploy')"
assert_equals "a deploy spec carrying a pinned version is the same production shape as its unpinned spelling" \
  "deny deny deny deny deny" \
  "$(prod_verdicts_for 'npx vercel@latest --prod' 'npm exec vercel@34 -- --prod' \
    'pnpm dlx vercel@34 --target production' 'npx vercel@2.1.0 --target=production' \
    'yarn dlx netlify@17 deploy --prod')"
assert_equals "a package install that merely names a deploy CLI is denied with the deploy it cannot be told apart from, because a runner subcommand grammar this gate does not model is the only thing that could tell them apart" \
  "deny deny deny deny" \
  "$(prod_verdicts_for 'npm install vercel@34 --prod' 'npm install --prod vercel@34' \
    'npm install vercel --prod' 'npm install --prod vercel')"
assert_equals "a pinned spec's read-only subcommands stay none of this gate's business" \
  "allow allow allow allow" \
  "$(prod_verdicts_for 'npx vercel@latest ls' 'npx vercel@34 whoami' 'npx netlify@17 status' \
    'npm exec typescript@5.4 -- tsc --noEmit')"
assert_equals "the work of the run itself is none of this gate's business" \
  "allow allow allow" \
  "$(prod_verdicts_for 'npm run build' 'git commit -m wip' 'git commit -m push')"

PROD_GATE_SOURCE="$PLUGIN/hooks/block-prod-deploy.sh"
PROD_GATE_FOURTH_CLI=flyctl
PROD_GATE_FOURTH_CLI_HOOKS="$TEST_HOME/prod-gate-fourth-cli"
PROD_GATE_FOURTH_CLI_SOURCE="$PROD_GATE_FOURTH_CLI_HOOKS/block-prod-deploy.sh"

deploy_clis_named_by() {
  awk -v opening="$2() {" '
    $0 == opening { inside = 1; next }
    inside && $0 == "}" { exit }
    inside && match($0, /^[[:space:]]*[a-z|]+\)/) {
      arm = substr($0, RSTART, RLENGTH - 1)
      gsub(/[[:space:]]/, "", arm)
      print arm
    }
  ' "$1" | tr '|' '\n' | LC_ALL=C sort -u | paste -sd' ' -
}

prod_gate_cli_divergence() {
  local gate_source="$1" table tested
  table="$(deploy_clis_named_by "$gate_source" deploy_command_name)"
  tested="$(deploy_clis_named_by "$gate_source" runs_a_production_deploy)"
  if [ "$table" = "$tested" ]; then
    printf 'agree'
    return 0
  fi
  printf 'the table names [%s] and the production test names [%s]' "$table" "$tested"
}

mkdir -p "$PROD_GATE_FOURTH_CLI_HOOKS"
cp "$PLUGIN"/hooks/*.sh "$PROD_GATE_FOURTH_CLI_HOOKS/"
sed "s/vercel|netlify|firebase)/vercel|netlify|firebase|$PROD_GATE_FOURTH_CLI)/" \
  "$PROD_GATE_SOURCE" > "$PROD_GATE_FOURTH_CLI_SOURCE"
chmod +x "$PROD_GATE_FOURTH_CLI_SOURCE"

assert_equals "the deploy CLIs the production gate recognizes are the deploy CLIs it tests for production" \
  "agree" "$(prod_gate_cli_divergence "$PROD_GATE_SOURCE")"
assert_equals "a CLI recognized by the table alone is a divergence that comparison reports" \
  "the table names [firebase $PROD_GATE_FOURTH_CLI netlify vercel] and the production test names [firebase netlify vercel]" \
  "$(prod_gate_cli_divergence "$PROD_GATE_FOURTH_CLI_SOURCE")"
assert_equals "a recognized CLI the production test never names passes rather than having its every call denied" \
  "allow" \
  "$(prod_gate_verdict_of "$PROD_GATE_FOURTH_CLI_SOURCE" "$(bash_input "$PROD_GATE_FOURTH_CLI status")")"

assert_equals "a push that does not name the run branch is denied while the run is in flight" \
  "deny deny deny" \
  "$(prod_verdicts_for 'git push origin main' 'git push' 'git -C . push origin main')"
assert_equals "the run's own branch push is the finish this gate exists to protect" \
  "allow allow" \
  "$(prod_verdicts_for 'git push origin oso-run/auto-continuity' 'git push origin HEAD:oso-run/x')"

run_hook block-prod-deploy.sh "$(prod_mcp_input mcp__plugin_vercel_vercel__deploy_to_vercel)"
assert_after_hook "a deploy-shaped MCP tool is the operator's own call while the run is in flight" \
  hook_returned_deny
case "$hook_stdout" in
  *'MCP deploy stays with the operator'*) prod_mcp_deny_naming=named ;;
  *) prod_mcp_deny_naming=unnamed ;;
esac
assert_equals "the MCP deny says whose call a deploy is, not merely that it was refused" \
  "named" "$prod_mcp_deny_naming"
assert_equals "a Bash sibling tool the matcher also reaches is judged by neither half" \
  "allow" "$(prod_gate_verdict "$(prod_mcp_input BashOutput)")"

mkdir -p "${PROD_PATTERNS_FILE%/*}"
printf 'npm run deploy:prod\n\n^ship-it\n' > "$PROD_PATTERNS_FILE"
prod_pattern_verdicts="$(prod_verdicts_for 'npm run deploy:prod' 'ship-it now' 'npm run build')"
rm -f "$PROD_PATTERNS_FILE"
assert_equals "this repository's own deny patterns bite while the run is in flight, and only where they match" \
  "deny deny allow|allow deny" \
  "$prod_pattern_verdicts|$(prod_verdicts_for 'npm run deploy:prod' 'vercel --prod')"

prod_long_command='vercel --prod'
while [ "${#prod_long_command}" -le "$((3072 + 16))" ]; do
  prod_long_command="$prod_long_command and echo padding"
done
assert_equals "a line past the lexer's bound is production at this boundary: an unread payload is the one thing a deploy refusal cannot spend a residue on" \
  "deny 0" "$(prod_verdicts_and_residues_for "$prod_long_command")"
prod_gate_verdict "$(bash_input 'env --unknown-option git push origin main')" > /dev/null
case "$hook_stdout" in
  *'past what the production boundary can read'*) prod_unread_refusal=unreadable ;;
  *'pushes its own oso-run/'*) prod_unread_refusal=off-run-branch ;;
  '') prod_unread_refusal=allowed ;;
  *) prod_unread_refusal=neither ;;
esac
assert_equals "an unread payload outranks a lexed push in the same line, so the boundary refuses that line as one it could not read rather than as a push off the run branch" \
  "unreadable" "$prod_unread_refusal"

assert_equals "an unresolved git option shape, a command word only the shell resolves and an interpreter's deploy payload all pass counted, exactly as the commit rail counts them" \
  "allow allow allow 3" \
  "$(prod_verdicts_and_residues_for 'git --super-prefix x/ push origin main' \
    'python3 deploy.py' '$DEPLOY --prod')"

assert_equals "an xargs replace-string is a KNOWN HOLE rather than a counted residue: { ends the command, vercel comes out a clean word carrying no marker, and the very deploy its sibling spelling is denied for passes allowed AND uncounted" \
  "deny|allow 0" \
  "$(prod_verdicts_for 'echo --prod | xargs vercel')|$(prod_verdicts_and_residues_for 'echo --prod | xargs -I{} vercel {}')"

assert_equals "a line the resolver answers spends no residue: a build, the run's own push, and an option git answers itself instead of pushing" \
  "allow allow allow 0" \
  "$(prod_verdicts_and_residues_for 'npm run build' \
    'git push origin oso-run/auto-continuity' 'git --version push origin main')"

prod_settled_verdicts=""
for settled_marker in parked done; do
  oso-state --session "$SESSION" set "auto=$settled_marker" >/dev/null
  prod_settled_verdicts="$prod_settled_verdicts $(prod_verdicts_for 'vercel --prod' 'git push origin main')"
done
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan active_slice=3 verify_green=false >/dev/null
prod_settled_verdicts="$prod_settled_verdicts $(prod_verdicts_for 'vercel --prod' 'git push origin main')"
oso-state --session "$SESSION" clear
prod_settled_verdicts="$prod_settled_verdicts $(prod_verdicts_for 'vercel --prod' 'git push origin main')"
arm_unattended_run
prod_settled_verdicts="$prod_settled_verdicts $(prod_gate_verdict "$(bash_input 'vercel --prod' "$REPO_ROOT" another-session)")"
assert_equals "a parked run, a finished one, an attended session, an unmarked repository and a foreign session all deploy untouched" \
  "allow allow allow allow allow allow allow allow allow" "${prod_settled_verdicts# }"

oso-state --session "$SESSION" clear
printf 'this file is not state at all\n' > "$REPO_STATE"
prod_uncertain_verdicts="$(prod_verdicts_for 'vercel --prod' 'npm run build' 'git push origin main')"
run_hook block-prod-deploy.sh "$(bash_input 'vercel --prod')"
prod_uncertain_reason="$hook_stdout"
rm -f "$REPO_STATE"
mkdir -p "$REPO_STATE"
prod_uncertain_verdicts="$prod_uncertain_verdicts $(prod_verdicts_for 'vercel --prod' 'npm run build')"
rmdir "$REPO_STATE"
assert_equals "a state file the gate cannot read as state closes the production door and nothing else" \
  "deny allow allow deny allow" "$prod_uncertain_verdicts"
case "$prod_uncertain_reason" in
  *"oso-state --session $SESSION clear"*) prod_uncertain_remedy=repair ;;
  *) prod_uncertain_remedy=elsewhere ;;
esac
assert_equals "the uncertain deny hands over the remedy that fits an unreadable state, not the one that needs a readable marker" \
  "repair" "$prod_uncertain_remedy"

rm -rf "$STATE_DIR/runs" "${PROD_PATTERNS_FILE%/*}"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

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
mkdir -p "$HANDOFF_RUNTIME/hooks" "$HANDOFF_RUNTIME/bin"
cp "$PLUGIN/hooks/publish-subagent-handoff.sh" "$PLUGIN/hooks/lib.sh" "$PLUGIN/hooks/lexer.sh" \
  "$HANDOFF_RUNTIME/hooks/"
cp "$PLUGIN/bin/oso-state" "$HANDOFF_RUNTIME/bin/"
chmod +x "$HANDOFF_RUNTIME/hooks/publish-subagent-handoff.sh" "$HANDOFF_RUNTIME/bin/oso-state"
assert_equals "the runtime fallback regression PATH cannot resolve bare oso-state" \
  "missing" "$(
    PATH="$SYSTEM_PATH_WITHOUT_OSO_STATE"
    hash -r
    command -v oso-state >/dev/null 2>&1 && echo present || echo missing
  )"
fixed_marker_payload="$(printf '{\"session_id\":\"%s\",\"cwd\":\"%s\",\"hook_event_name\":\"SubagentStop\",\"turn_id\":\"turn-fixed-marker\",\"agent_id\":\"agent-fixed-marker\",\"agent_type\":\"oso-verifier\",\"agent_transcript_path\":\"%s\",\"stop_hook_active\":false,\"last_assistant_message\":\"oso-handoff: v=1 slice=slice-fixed-marker attempt=2\\nevidence: the named check is green\\nverdict: pass\"}' \
  "payload-native-uuid-7d1a-4d1e-bf19" "$HANDOFF_REPO" "$TEST_HOME/agent-fixed-marker.jsonl")"
unset OSO_STATE_BIN
OSO_AGENT=1 PATH="$SYSTEM_PATH_WITHOUT_OSO_STATE" run_hook "$HANDOFF_RUNTIME/hooks/publish-subagent-handoff.sh" "$fixed_marker_payload"
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

handoff_files_before_timeout="$(find "$STATE_DIR/.handoffs" -type f -print 2>/dev/null | LC_ALL=C sort || true)"
missing_wait_started="$(date +%s)"
run_handoff "" handoff wait \
  --slice slice-absent --attempt 1 --agent-id agent-absent \
  --agent-type oso-verifier --timeout 1
missing_wait_elapsed=$(( $(date +%s) - missing_wait_started ))
assert_equals "an absent handoff reports its declared timeout as a stop, not any other outcome" \
  "1" "$handoff_rc"
if oso_nightly_only "an absent handoff's timeout wall-clock lands at its declared bound"; then
  case "$missing_wait_elapsed" in
    1|2) missing_wait_status=bounded ;;
    *) missing_wait_status="elapsed=${missing_wait_elapsed}s" ;;
  esac
  assert_equals "an absent handoff's timeout wall-clock lands at its declared bound" \
    bounded "$missing_wait_status"
fi
handoff_files_after_timeout="$(find "$STATE_DIR/.handoffs" -type f -print 2>/dev/null | LC_ALL=C sort || true)"
assert_equals "a timed-out wait leaves no synthetic receipt or watermark" \
  "$handoff_files_before_timeout" "$handoff_files_after_timeout"

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
assert_equals "handoff lock acquisition never reclaims an old live lock" \
  "rc=1 lock=retained" \
  "rc=$handoff_rc lock=$([ -d "$lock_dir" ] && printf retained || printf removed)"
if oso_nightly_only "handoff lock acquisition waits inside its bound rather than returning instantly or hanging"; then
  lock_wait_ceiling_seconds=10
  lock_wait_band=off-bound
  if [ "$lock_wait_elapsed" -ge 1 ] && [ "$lock_wait_elapsed" -le "$lock_wait_ceiling_seconds" ]; then
    lock_wait_band=waited-in-bound
  fi
  assert_equals "handoff lock acquisition waits inside its bound rather than returning instantly or hanging" \
    waited-in-bound "$lock_wait_band"
fi
rmdir "$lock_dir"

rm -rf "$STATE_DIR/.handoffs"

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

assert_equals "a write records the session that armed the state" \
  "$SESSION" "$(oso-state --session "$SESSION" get session)"
oso-state --session "$SESSION" clear

events_log="$STATE_DIR/events.jsonl"

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
assert_logged "a deny names the gate script that fired" \
  '"gate":"block-commit-until-green.sh"'
assert_logged "a deny names the hook event it fired on" '"hook_event":"PreToolUse"'
oso-state --session "$SESSION" clear

utf8_boundary_prefix="git commit -m x && echo $(printf 'a%.0s' $(seq 1 95))"
utf8_boundary_command="${utf8_boundary_prefix}é more text past the 120-byte bound"
rm -f "$events_log"
oso-state --session "$SESSION" set mode=plan verify_green=false
run_hook block-commit-until-green.sh "$(bash_input "$utf8_boundary_command")"
logged_command="$(tail -n 1 "$events_log" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
assert_equals "a command past the bound is truncated at a character boundary, not mid-character" \
  "$utf8_boundary_prefix" "$logged_command"
oso-state --session "$SESSION" clear

rm -f "$events_log"
oso-state --session "$SESSION" event worktree-created "git worktree add ../oso-wt-3"
assert_logged "the event verb records its type and its detail" \
  '"event":"worktree-created","command":"git worktree add ../oso-wt-3","session":"'
assert_equals "one event is one line, appended and nothing else" \
  1 "$(grep -c '' "$events_log")"
oso-state --session "$SESSION" event integration-red
assert_logged "an event with no detail is a well-formed line too" \
  '"event":"integration-red","command":"","session":"'
if grep -q '"gate"\|"hook_event"' "$events_log"; then
  echo "FAIL: an event-verb line carries gate or hook_event, which the log schema scopes to denies only"
  fail=$((fail + 1))
else
  echo "ok: event-verb lines keep the unwidened five-field schema-1 shape"
  pass=$((pass + 1))
fi

oso-state --session "$SESSION" set mode=plan verify_green=true
mkdir -p "$REPO_STATE.lock"
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
assert_after_hook "session end removes state"         [ ! -f "$REPO_STATE" ]
assert_after_hook "session end removes leftover lock" [ ! -d "$REPO_STATE.lock" ]
touch "$HOME/canary"
run_hook cleanup-state.sh '{"session_id":"../../canary"}'
assert_after_hook "traversal session id cannot delete outside state dir" [ -f "$HOME/canary" ]

ELSEWHERE="$TEST_HOME/state-armed-elsewhere"
mkdir -p "$ELSEWHERE"
( cd "$ELSEWHERE" && oso-state --session sessionend-probe set mode=plan verify_green=true >/dev/null )
elsewhere_state="$STATE_DIR/$(state_key_of "$ELSEWHERE").state"
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

orphan_pending_state="$STATE_DIR/orphan-pending.state"
printf 'mode=plan\nplan_approval=pending\nsession=orphan-real-session\nplan_approval_session=orphan-real-session\n' \
  > "$orphan_pending_state"
OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"unrelated-session"}'
assert_after_hook "SessionEnd for an unrelated session leaves another session's pending alone" \
  [ -f "$orphan_pending_state" ]
OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"orphan-real-session"}'
assert_after_hook "SessionEnd for the session whose plan_approval_session matches drops its own orphaned pending" \
  [ ! -f "$orphan_pending_state" ]

roadmap_decoy_state="$STATE_DIR/aa-roadmap-decoy.state"
roadmap_live_state="$STATE_DIR/zz-roadmap-live.state"
printf 'mode=plan\nsession=roadmap-owner\n' > "$roadmap_decoy_state"
printf 'mode=plan\nsession=roadmap-owner\nroadmap=auth-hardening\n' > "$roadmap_live_state"
run_hook cleanup-state.sh '{"session_id":"roadmap-owner"}'
assert_after_hook "the ownership sweep still takes the first file the glob hands it" \
  [ ! -f "$roadmap_decoy_state" ]
assert_after_hook "SessionEnd reaches the roadmap in flight the ownership sweep's first match left standing" \
  [ ! -f "$roadmap_live_state" ]

roadmap_foreign_state="$STATE_DIR/zz-roadmap-foreign.state"
printf 'mode=plan\nsession=someone-else\nroadmap=auth-hardening\n' > "$roadmap_foreign_state"
roadmap_disarmed_decoy="$STATE_DIR/aa-roadmap-disarmed-decoy.state"
roadmap_disarmed_state="$STATE_DIR/zz-roadmap-disarmed.state"
printf 'mode=plan\nsession=roadmap-finished\n' > "$roadmap_disarmed_decoy"
printf 'mode=plan\nsession=roadmap-finished\nroadmap=none\n' > "$roadmap_disarmed_state"
run_hook cleanup-state.sh '{"session_id":"roadmap-finished"}'
assert_after_hook "SessionEnd leaves another session's roadmap in flight alone" \
  [ -f "$roadmap_foreign_state" ]
assert_after_hook "a disarmed roadmap key is left to the passes that already covered it" \
  [ -f "$roadmap_disarmed_state" ]
rm -f "$roadmap_foreign_state" "$roadmap_disarmed_state"

env_file="$(mktemp)"
export CLAUDE_ENV_FILE="$env_file"
run_hook persist-state-bin.sh ''
persisted="$(. "$env_file"; printf '%s' "${OSO_STATE_BIN:-}")"
assert_after_hook "SessionStart persists OSO_STATE_BIN to an executable" [ -x "$persisted" ]
rm -f "$env_file"

STATE_BIN_WINDOWS_STUB="$TEST_HOME/state-bin-windows-stub"
mkdir -p "$STATE_BIN_WINDOWS_STUB"
printf '%s\n' '#!/bin/sh' 'echo MINGW64_NT-10.0' > "$STATE_BIN_WINDOWS_STUB/uname"
printf '%s\n' '#!/bin/sh' 'printf "converted%s:%s\n" "$1" "$2"' \
  > "$STATE_BIN_WINDOWS_STUB/cygpath"
chmod +x "$STATE_BIN_WINDOWS_STUB/uname" "$STATE_BIN_WINDOWS_STUB/cygpath"
env_file="$(mktemp)"
export CLAUDE_ENV_FILE="$env_file"
( PATH="$STATE_BIN_WINDOWS_STUB:$PATH"; "$PLUGIN/hooks/persist-state-bin.sh" ) >/dev/null 2>&1 || true
assert_equals "SessionStart persists the spelling of oso-state a native consumer can read, never the MSYS one" \
  "converted-m:$PLUGIN/bin/oso-state" \
  "$(. "$env_file"; printf '%s' "${OSO_STATE_BIN:-}")"
rm -f "$env_file"

unset CLAUDE_ENV_FILE
run_hook persist-state-bin.sh ''
assert_after_hook "SessionStart no-ops when CLAUDE_ENV_FILE is unset" [ -z "$hook_stdout" ]

oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false
rm -f "$events_log"
mkdir -p "$events_log"
assert_denies "commit deny survives an unwritable log" block-commit-until-green.sh "$(bash_input 'git commit -m x')" 0 '"event":"commit-denied"'
assert_denies "edit deny survives an unwritable log"   block-edits-without-slice.sh "$edit_input" 0 '"event":"edit-denied"'
rmdir "$events_log"

oso-state --session "$SESSION" clear
mkdir -p "$REPO_STATE"
assert_denies "commit gate denies a state path that is not a readable file" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
assert_denies "edit gate denies a state path that is not a readable file"   block-edits-without-slice.sh "$edit_input"
assert_denies "commit gate denies an unreadable state even for a line that looks clear" \
  block-commit-until-green.sh "$(bash_input 'npm test')"
rmdir "$REPO_STATE"
assert_logged "an unreadable state file is recorded" '"event":"state-unreadable"'

oso-state --session "$SESSION" set mode=plan verify_green=false
traversal_edit="$(printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"%s/../../../../tmp/x.ts","old_string":"const slice = 1;","new_string":"const slice = 2;","replace_all":false}}' \
  "$SESSION" "$TRANSCRIPT" "$REPO_ROOT" "$STATE_DIR")"
assert_denies "edit through a state-dir traversal path is denied" block-edits-without-slice.sh "$traversal_edit"

oso-state --session "$SESSION" set 'weird=a"b\c' >/dev/null
assert_logged "quotes and backslashes are escaped in the event log" -F '"event":"set:weird=a\"b\\c"'
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

assert_allows "an unparseable payload does not gate the call" block-commit-until-green.sh '{"tool_name":"Bash"}'
assert_logged "an unparseable payload is recorded" '"event":"payload-unparseable"'
oso-state --session "$SESSION" clear

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
touch -t 200001010000 "$abandoned_state" "$locked_state"
mkdir -p "${locked_state}.lock"
oso-state --session "$SESSION" set mode=plan verify_green=true >/dev/null
run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
assert_pruned "state left by a session that ended weeks ago is swept" "$abandoned_state"
assert_kept   "state written within the week survives the sweep"      "$recent_state"
assert_kept   "state held by a live lock survives whatever its age"   "$locked_state"
assert_pruned "the ending session's own state is still removed"       "$REPO_STATE"
rm -rf "${locked_state}.lock" "$locked_state" "$recent_state"

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

WORKTREES_DIR="$STATE_DIR/worktrees"
WORKTREE_REPO="$TEST_HOME/worktree-repo"
VANISHED_REPO="$TEST_HOME/vanished-repo"

mkdir -p "$WORKTREES_DIR/wt-no-repo/1"
printf 'mode=plan\nsession=wt-no-repo\n' > "$STATE_DIR/wt-no-repo.state"
run_hook cleanup-state.sh '{"session_id":"wt-no-repo"}'
assert_pruned "a state file naming no repo is still removed"            "$STATE_DIR/wt-no-repo.state"
assert_kept   "a worktree with no repo to prune in is left where it is" "$WORKTREES_DIR/wt-no-repo/1"
rm -rf "$WORKTREES_DIR/wt-no-repo"

mkdir -p "$WORKTREES_DIR/wt-unfound/1"
run_hook cleanup-state.sh '{"session_id":"wt-unfound"}'
assert_kept "the worktree of a session with no state file at all is left standing" \
  "$WORKTREES_DIR/wt-unfound/1"
rm -rf "$WORKTREES_DIR/wt-unfound"

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

  arm_wave_for "$SESSION" "$WORKTREE_REPO"
  registered_before="$(worktrees_registered_for "$SESSION")"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_pruned "session end removes the session's worktree tree" "$WORKTREES_DIR/$SESSION"
  assert_equals "session end leaves nothing of it registered in the repo" "1 -> 0" \
    "$registered_before -> $(worktrees_registered_for "$SESSION")"
  assert_logged "a teardown leaves an audit line no gate could have written" \
    '"event":"worktree-removed"'

  arm_wave_for wt-abandoned "$WORKTREE_REPO"
  touch -t 200001010000 "$STATE_DIR/wt-abandoned.state"
  abandoned_before="$(worktrees_registered_for wt-abandoned)"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_pruned "the 7-day sweep removes an abandoned session's worktree tree" \
    "$WORKTREES_DIR/wt-abandoned"
  assert_equals "the 7-day sweep leaves nothing of it registered either" "1 -> 0" \
    "$abandoned_before -> $(worktrees_registered_for wt-abandoned)"

  arm_wave_for wt-locked "$WORKTREE_REPO"
  touch -t 200001010000 "$STATE_DIR/wt-locked.state"
  mkdir -p "$STATE_DIR/wt-locked.state.lock"
  run_hook cleanup-state.sh "$(printf '{"session_id":"%s"}' "$SESSION")"
  assert_kept "a worktree whose session holds a live lock survives the sweep" \
    "$WORKTREES_DIR/wt-locked/1"
  rm -rf "$STATE_DIR/wt-locked.state.lock" "$STATE_DIR/wt-locked.state"
  git -C "$WORKTREE_REPO" worktree remove --force "$WORKTREES_DIR/wt-locked/1"
  rmdir "$WORKTREES_DIR/wt-locked"

  arm_wave_for wt-crashed "$WORKTREE_REPO"
  rm -rf "$WORKTREES_DIR/wt-crashed/1"
  crashed_before="$(worktrees_registered_for wt-crashed)"
  run_hook cleanup-state.sh '{"session_id":"wt-crashed"}'
  assert_pruned "the emptied tree of a killed run is removed" "$WORKTREES_DIR/wt-crashed"
  assert_equals "a worktree the run already deleted is deregistered by the prune" "1 -> 0" \
    "$crashed_before -> $(worktrees_registered_for wt-crashed)"

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

  arm_repo_at "$VANISHED_REPO"
  arm_wave_for wt-no-prune "$VANISHED_REPO"
  rm -rf "$VANISHED_REPO" "$WORKTREES_DIR/wt-no-prune/1"
  rm -f "$events_log"
  run_hook cleanup-state.sh '{"session_id":"wt-no-prune"}'
  assert_pruned "a session whose prune could not run still loses its state file" \
    "$STATE_DIR/wt-no-prune.state"
  assert_logged "a prune that could not run is recorded rather than swallowed" \
    '"event":"worktree-prune-failed"'

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

  arm_wave_for orphan-wt-owner "$WORKTREE_REPO"
  printf 'plan_approval=pending\nplan_approval_session=orphan-wt-real\n' \
    >> "$STATE_DIR/orphan-wt-owner.state"
  registered_before="$(worktrees_registered_for orphan-wt-owner)"
  OSO_AGENT=1 run_hook cleanup-state.sh '{"session_id":"orphan-wt-real"}'
  assert_pruned "clearing an orphaned pending drops its state file" \
    "$STATE_DIR/orphan-wt-owner.state"
  assert_pruned "clearing an orphaned pending removes its worktree tree" \
    "$WORKTREES_DIR/orphan-wt-owner"
  assert_equals "clearing an orphaned pending leaves nothing of it registered in the repo" "1 -> 0" \
    "$registered_before -> $(worktrees_registered_for orphan-wt-owner)"

  printf 'mode=plan\nsession=zz-roadmap-wt\n' > "$STATE_DIR/aa-roadmap-wt-decoy.state"
  arm_wave_for zz-roadmap-wt "$WORKTREE_REPO"
  printf 'roadmap=auth-hardening\n' >> "$STATE_DIR/zz-roadmap-wt.state"
  roadmap_wt_before="$(worktrees_registered_for zz-roadmap-wt)"
  run_hook cleanup-state.sh '{"session_id":"zz-roadmap-wt"}'
  assert_pruned "clearing a roadmap in flight drops its state file" \
    "$STATE_DIR/zz-roadmap-wt.state"
  assert_pruned "clearing a roadmap in flight removes the worktree tree its last wave left" \
    "$WORKTREES_DIR/zz-roadmap-wt"
  assert_equals "clearing a roadmap in flight leaves nothing of it registered in the repo" "1 -> 0" \
    "$roadmap_wt_before -> $(worktrees_registered_for zz-roadmap-wt)"
fi

stale_session_input() { printf '{"session_id":"%s","cwd":"%s"}' "$SESSION" "$REPO_ROOT"; }

rm -f "$REPO_STATE"
printf 'mode=plan\nsession=other-session\n' > "$STATE_DIR/other-session.state"
assert_allows "SessionStart names nothing when only a foreign repository's state exists" \
  warn-stale-state.sh "$(stale_session_input)"

printf 'mode=plan\nsession=other-session\n' > "$REPO_STATE"
mkdir -p "$WORKTREES_DIR/wt-parallel/1"
run_hook warn-stale-state.sh "$(stale_session_input)"
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
assert_equals "SessionStart drops the false claim that a repository-keyed file arms this session's gates regardless of whose it is" \
  "" "$(printf '%s' "$hook_stdout" | grep -F 'State is keyed by repository' || true)"

OSO_AGENT=1 run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "Codex stale-state guidance uses the discovered plugin route" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '$oso-code:plan {change}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "Codex stale-state guidance clears the fixed runtime identity" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- '--session \"1\" clear' >/dev/null; then echo present; else echo missing; fi)"

OSO_HOST=opencode OSO_AGENT=aa11bb22cc33dd44 run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "OpenCode stale-state guidance uses its own registered slash command" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-plan {change}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "the OpenCode advisory drops the Codex namespace OSO_AGENT alone made it spell" \
  "" "$(printf '%s' "$hook_stdout" | grep -oF 'oso-code:plan' || true)"
assert_equals "OpenCode stale-state guidance clears the identity its own shell.env published" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- '--session \"aa11bb22cc33dd44\" clear' >/dev/null; then echo present; else echo missing; fi)"

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

HOME="$TEST_HOME/never-armed"
assert_allows "SessionStart says nothing where there is no state dir" \
  warn-stale-state.sh "$(stale_session_input)"
HOME="$TEST_HOME"
rm -rf "$WORKTREES_DIR/wt-parallel" "$REPO_STATE"

roadmap_state_of() {
  printf 'mode=plan\nsession=other-session\nroadmap=%s\n' "$1" > "$REPO_STATE"
}
roadmap_state_of auth-hardening
run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "the stale-state signal routes a roadmap in flight to the roadmap it names" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-code:roadmap auth-hardening' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "a roadmap in flight is never routed to the plan flow that runs its children" \
  "" "$(printf '%s' "$hook_stdout" | grep -oF 'oso-code:plan' || true)"
assert_equals "the roadmap route arrives with the disarm that drops the claim alone" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- "--session \\\"$SESSION\\\" set roadmap=none" >/dev/null; then echo present; else echo missing; fi)"
assert_equals "the roadmap route arrives with the clear that drops the whole file" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F -- "--session \\\"$SESSION\\\" clear" >/dev/null; then echo present; else echo missing; fi)"

OSO_AGENT=1 run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "Codex gets the roadmap resume route in its own invocation spelling" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '$oso-code:roadmap auth-hardening' >/dev/null; then echo present; else echo missing; fi)"

OSO_HOST=opencode OSO_AGENT=aa11bb22cc33dd44 run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "OpenCode gets the roadmap resume route as the command its installer registers" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-roadmap auth-hardening' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "no namespace this host has not got reaches its roadmap resume route either" \
  "" "$(printf '%s' "$hook_stdout" | grep -oF 'oso-code:roadmap' || true)"

roadmap_state_of 'Not A Slug; rm -rf /'
run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "a value that is not a slug reaches the resume route as the placeholder, never as itself" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-code:roadmap {roadmap}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "no unslugged value reaches the context the model reads" \
  "" "$(printf '%s' "$hook_stdout" | grep -oF 'rm -rf' || true)"

roadmap_state_of none
run_hook warn-stale-state.sh "$(stale_session_input)"
assert_equals "the disarmed sentinel puts the signal back on the plan route it had before" \
  "present" "$(if printf '%s' "$hook_stdout" | grep -F '/oso-code:plan {change}' >/dev/null; then echo present; else echo missing; fi)"
assert_equals "a disarmed roadmap is named nowhere in the signal" \
  "" "$(printf '%s' "$hook_stdout" | grep -oF 'oso-code:roadmap' || true)"

printf 'mode=plan\nsession=%s\nroadmap=auth-hardening\n' "$SESSION" > "$REPO_STATE"
assert_allows "SessionStart says nothing about a roadmap this session is running itself" \
  warn-stale-state.sh "$(stale_session_input)"

rm -f "$REPO_STATE"
printf 'mode=plan\nsession=other-session\nroadmap=auth-hardening\n' > "$STATE_DIR/other-roadmap.state"
assert_allows "SessionStart says nothing about a roadmap in flight in another repository" \
  warn-stale-state.sh "$(stale_session_input)"
rm -f "$STATE_DIR/other-roadmap.state"

DRIFT_FIXTURE="$TEST_HOME/version-drift-plugin"
DRIFT_HOOK="$DRIFT_FIXTURE/hooks/warn-stale-version.sh"
DRIFT_MANIFEST="$DRIFT_FIXTURE/.claude-plugin/plugin.json"
DRIFT_SLUG="oso-fixture/oso-code"
DRIFT_CACHE="$STATE_DIR/published-release"
DRIFT_MARKETPLACES="$HOME/.claude/plugins/known_marketplaces.json"
DRIFT_STUB_DIR="$TEST_HOME/version-drift-stubs"
DRIFT_ADVERTISEMENT="$TEST_HOME/version-drift-advertisement"
export OSO_TEST_CURL_CALLS="$TEST_HOME/version-drift-curl-calls"
export OSO_TEST_ADVERTISEMENT="$DRIFT_ADVERTISEMENT"
export OSO_TEST_CURL_EXIT=0

if [ ! -f "$PLUGIN/hooks/warn-stale-version.sh" ]; then
  echo "FAIL: the version-drift cases have no SessionStart hook to run"; fail=$((fail + 1))
else
  mkdir -p "$DRIFT_FIXTURE/hooks" "$DRIFT_FIXTURE/.claude-plugin" \
    "$DRIFT_STUB_DIR" "$(dirname "$DRIFT_MARKETPLACES")"
  cp "$PLUGIN/hooks/warn-stale-version.sh" "$PLUGIN/hooks/lib.sh" \
    "$PLUGIN/hooks/lexer.sh" "$DRIFT_FIXTURE/hooks/"

  {
    printf '001e# service=git-upload-pack\n0000\n'
    printf '00a5%s refs/heads/main\0multi_ack symref=HEAD:refs/heads/main\n' aaa0001
    printf '003f%s refs/tags/v0.19.0\n' aaa0002
    printf '0041%s refs/tags/v0.19.0^{}\n' aaa0003
    printf '003f%s refs/tags/v0.5.0\n' aaa0004
    printf '0000'
  } > "$DRIFT_ADVERTISEMENT"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''%s\n'\'' "$*" >> "$OSO_TEST_CURL_CALLS"' \
    '[ "$OSO_TEST_CURL_EXIT" -eq 0 ] || exit "$OSO_TEST_CURL_EXIT"' \
    'cat "$OSO_TEST_ADVERTISEMENT"' > "$DRIFT_STUB_DIR/curl"
  chmod +x "$DRIFT_STUB_DIR/curl"

  write_drift_manifest() {
    printf '{\n  "name": "oso-code",\n  "version": "%s",\n  "repository": "https://github.com/%s"\n}\n' \
      "$1" "${2:-$DRIFT_SLUG}" > "$DRIFT_MANIFEST"
  }

  write_drift_marketplace_source() {
    printf '{\n  "oso-code": {\n    "source": {\n      "source": "%s",\n      "%s": "%s"\n    }\n  }\n}\n' \
      "$1" "$2" "$3" > "$DRIFT_MARKETPLACES"
  }

  drift_input() {
    printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"%s"}' \
      "$SESSION" "$REPO_ROOT" "$1"
  }

  reset_drift_baseline() {
    write_drift_manifest 0.17.0
    write_drift_marketplace_source github repo "$DRIFT_SLUG"
    rm -f "$DRIFT_CACHE"
    : > "$OSO_TEST_CURL_CALLS"
    OSO_TEST_CURL_EXIT=0
  }

  drift_fetches_made() {
    grep -c . "$OSO_TEST_CURL_CALLS" 2>/dev/null | tr -d ' ' || true
  }

  run_drift_hook() {
    local previous_path="$PATH"
    PATH="$DRIFT_STUB_DIR:$PATH"
    run_hook "$DRIFT_HOOK" "$(drift_input "${1:-startup}")"
    PATH="$previous_path"
  }

  assert_drift_silent() {
    local name="$1"
    shift
    run_drift_hook "$@"
    assert_after_hook "$name" [ -z "$hook_stdout" ]
  }

  reset_drift_baseline
  run_drift_hook
  drift_named=""
  for drift_fact in 0.17.0 0.19.0 0.5.0 \
    'claude plugin marketplace update oso-code' 'claude plugin update oso-code@oso-code'; do
    case "$hook_stdout" in *"$drift_fact"*) drift_named="$drift_named|$drift_fact" ;; esac
  done
  assert_equals "a stale install names both versions and the update, never the highest-sorting tag" \
    "|0.17.0|0.19.0|claude plugin marketplace update oso-code|claude plugin update oso-code@oso-code" \
    "$drift_named"
  assert_equals "the stale-install report is one line" "1" \
    "$( { printf '%s' "$hook_stdout" | grep -c ''; } || true)"
  assert_equals "the tag list is fetched from the repository the manifest names" "1" \
    "$(grep -Fc -- "https://github.com/$DRIFT_SLUG.git/info/refs?service=git-upload-pack" \
      "$OSO_TEST_CURL_CALLS" || true)"
  assert_equals "the fetch carries curl's own connect and total bounds" "1" \
    "$(grep -Fc -- '--connect-timeout 2 --max-time 4' "$OSO_TEST_CURL_CALLS" || true)"

  OSO_TEST_CURL_EXIT=28
  run_drift_hook
  assert_after_hook "a start inside the window reports from the cache" \
    [ -n "$hook_stdout" ]
  assert_equals "a start inside the window fetches nothing" "1" "$(drift_fetches_made)"
  OSO_TEST_CURL_EXIT=0

  reset_drift_baseline
  OSO_TEST_CURL_EXIT=28
  assert_drift_silent "a fetch that answers nothing leaves the session silent"
  assert_drift_silent "the start after it stays silent too"
  assert_equals "an unreachable source is attempted once inside the window, not once per session" \
    "1" "$(drift_fetches_made)"
  OSO_TEST_CURL_EXIT=0

  reset_drift_baseline
  write_drift_manifest 0.19.0
  assert_drift_silent "an install already on the published release says nothing"
  reset_drift_baseline
  write_drift_manifest 0.20.0
  assert_drift_silent "an install ahead of the published release says nothing"

  reset_drift_baseline
  write_drift_manifest unknown
  assert_drift_silent "a manifest whose version is not a release says nothing"
  reset_drift_baseline
  rm -f "$DRIFT_MANIFEST"
  assert_drift_silent "a plugin root with no readable manifest says nothing"

  reset_drift_baseline
  write_drift_marketplace_source github repo other-owner/other-plugin
  assert_drift_silent "a marketplace serving another repository says nothing"
  reset_drift_baseline
  write_drift_marketplace_source directory path "$REPO_ROOT"
  assert_drift_silent "a marketplace registered from a local clone says nothing"
  reset_drift_baseline
  rm -f "$DRIFT_MARKETPLACES"
  assert_drift_silent "a machine with no registered marketplace says nothing"
  assert_equals "a source this plugin does not publish is never fetched" "0" \
    "$(drift_fetches_made)"

  reset_drift_baseline
  assert_drift_silent "a compaction says nothing a second time" compact
  reset_drift_baseline
  run_drift_hook resume
  assert_after_hook "a resumed session still hears it" [ -n "$hook_stdout" ]

  rm -f "$DRIFT_CACHE" "$DRIFT_MARKETPLACES"
fi
unset OSO_TEST_CURL_CALLS OSO_TEST_ADVERTISEMENT OSO_TEST_CURL_EXIT

REANCHOR_CONTINUE_ORDER='continue it now rather than waiting'

reanchor_input() {
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"%s"}' \
    "${2:-$SESSION}" "$REPO_ROOT" "$1"
}

reanchor_verdict() {
  run_hook reanchor-after-compact.sh "$1"
  if [ -n "$hook_problem" ]; then
    printf 'crashed:%s' "$hook_problem"
  elif [ -z "$hook_stdout" ]; then
    printf 'silent'
  else
    printf 'speaks'
  fi
}

arm_compacted_slice() {
  rm -f "$REPO_STATE"
  oso-state --session "$SESSION" set mode=plan active_slice=3 >/dev/null
}

rm -rf "$STATE_DIR/runs"
arm_compacted_slice
run_hook reanchor-after-compact.sh "$(reanchor_input compact)"
reanchor_position_unnamed=""
for reanchor_position in 'mem_search oso/index' mem_get_observation 'NEXT:' 'oso-state show' \
  "$JOURNAL_DIR/run.log" 'oso-state journal'; do
  case "$hook_stdout" in
    *"$reanchor_position"*) ;;
    *) reanchor_position_unnamed="$reanchor_position_unnamed|$reanchor_position" ;;
  esac
done
assert_equals "a compacted session is handed back every position source that outlived its window" \
  "" "$reanchor_position_unnamed"
case "$hook_stdout" in
  *'"hookEventName":"SessionStart"'*'"additionalContext"'*) reanchor_context_envelope=present ;;
  *) reanchor_context_envelope=missing ;;
esac
assert_equals "the re-anchor reaches the model as session-start context, never as bare stdout" \
  "present" "$reanchor_context_envelope"
assert_equals "an attended run is re-anchored, and without the order that belongs to an unattended one" \
  "spoken|" \
  "$([ -n "$hook_stdout" ] && echo spoken || echo silent)|$(printf '%s' "$hook_stdout" | grep -oF "$REANCHOR_CONTINUE_ORDER" || true)"

rm -f "$REPO_STATE"
oso-state --session "$SESSION" set auto=running auto_change=auto-continuity >/dev/null
run_hook reanchor-after-compact.sh "$(reanchor_input compact)"
reanchor_unattended_read=""
for reanchor_order in "$REANCHOR_CONTINUE_ORDER" park "$AUTO_JOURNAL"; do
  case "$hook_stdout" in
    *"$reanchor_order"*) reanchor_unattended_read="$reanchor_unattended_read|$reanchor_order" ;;
  esac
done
assert_equals "an unattended run is told to keep going, to park what needs the operator, and where its own journal is" \
  "|$REANCHOR_CONTINUE_ORDER|park|$AUTO_JOURNAL" "$reanchor_unattended_read"

oso-state --session "$SESSION" set auto_change=../escape >/dev/null
run_hook reanchor-after-compact.sh "$(reanchor_input compact)"
assert_equals "a change slug the reader refuses re-anchors on the fallback journal, never on the slug itself" \
  "$JOURNAL_DIR/run.log|" \
  "$(printf '%s' "$hook_stdout" | grep -oF "$JOURNAL_DIR/run.log" || true)|$(printf '%s' "$hook_stdout" | grep -oF '../escape' || true)"

oso-state --session "$SESSION" set auto_change=auto-continuity >/dev/null
reanchor_start_verdicts=""
for reanchor_start in startup resume clear; do
  reanchor_start_verdicts="$reanchor_start_verdicts $(reanchor_verdict "$(reanchor_input "$reanchor_start")")"
done
reanchor_start_verdicts="$reanchor_start_verdicts $(reanchor_verdict \
  "$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart"}' "$SESSION" "$REPO_ROOT")")"
assert_equals "every session start that is not a compaction stays silent, however live the run is" \
  "silent silent silent silent" "${reanchor_start_verdicts# }"

oso-state --session "$SESSION" clear
reanchor_uncertain_verdicts=" $(reanchor_verdict "$(reanchor_input compact)")"
oso-state --session "$SESSION" set mode=plan active_slice=none >/dev/null
reanchor_uncertain_verdicts="$reanchor_uncertain_verdicts $(reanchor_verdict "$(reanchor_input compact)")"
arm_compacted_slice
reanchor_uncertain_verdicts="$reanchor_uncertain_verdicts $(reanchor_verdict "$(reanchor_input compact another-session)")"
printf 'this file is not state at all\n' > "$REPO_STATE"
reanchor_uncertain_verdicts="$reanchor_uncertain_verdicts $(reanchor_verdict "$(reanchor_input compact)")"
rm -f "$REPO_STATE"
mkdir -p "$REPO_STATE"
reanchor_uncertain_verdicts="$reanchor_uncertain_verdicts $(reanchor_verdict "$(reanchor_input compact)")"
rmdir "$REPO_STATE"
assert_equals "no state, a disarmed slice, a foreign session, a garbage file and an unreadable path all leave a compaction silent" \
  "silent silent silent silent silent" "${reanchor_uncertain_verdicts# }"

rm -rf "$STATE_DIR/runs"
oso-state --session "$SESSION" clear >/dev/null 2>&1 || true

assert_every() {
  local assertion="$1" table="$2" case_command
  while IFS= read -r case_command; do
    [ -n "$case_command" ] || continue
    "$assertion" "$table: $case_command" block-commit-until-green.sh "$(bash_input "$case_command")"
  done
}

oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=plan verify_green=false

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

assert_every assert_denies "marker in a value position" <<'VALUE_POSITION_TABLE'
git commit -m --dry-run
git commit -m -h
git commit -m \"--dry-run\"
git commit -am --dry-run
git commit -m x -m --dry-run
git -C /repo commit -m --dry-run
VALUE_POSITION_TABLE

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

assert_every assert_allows "not gated" <<'NOT_GATED_TABLE'
git revert HEAD
git merge feature
git rebase main
git cherry-pick abc123
git am patch.eml
git stash
NOT_GATED_TABLE

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

assert_every assert_denies "redirect in front of a shell's stdin" <<'REDIRECT_STDIN_TABLE'
>out.txt bash <<EOF\ngit commit\nEOF
bash >out.txt <<EOF\ngit commit\nEOF
>out.txt bash <<< \"git commit\"
2>err.log bash -s <<EOF\ngit commit\nEOF
REDIRECT_STDIN_TABLE

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

rm -f "$events_log"
assert_allows "residue: a python payload that mentions git passes" \
  block-commit-until-green.sh "$(bash_input 'python3 -c \"import os; os.system('\''git commit'\'')\"')"
assert_allows "residue: a command word only the shell resolves passes" \
  block-commit-until-green.sh "$(bash_input 'g=git; $g commit')"
assert_logged "a residue allow carries the command it let through" \
  '"event":"residue-allowed","command":"python3'

assert_allows "residue: a wrapper chain past the recursion bound passes" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c ok\\\"\"'\''')"
assert_allows "residue: a chain past the bound hides a commit — allowed on purpose" \
  block-commit-until-green.sh "$(bash_input 'bash -c '\''bash -c \"bash -c \\\"bash -c git commit\\\"\"'\''')"
assert_logged "both chains past the bound are logged with the chain they let through" \
  '"event":"residue-allowed","command":"bash -c .*bash -c ok' \
  '"event":"residue-allowed","command":"bash -c .*bash -c git commit'
assert_denies "a chain past the bound never downgrades a commit the gate did read" \
  block-commit-until-green.sh "$(bash_input 'git commit -m x && bash -c '\''bash -c \"bash -c \\\"bash -c ok\\\"\"'\''')"

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

assert_allows "residue: a wrapper option whose value could be the command word passes" \
  block-commit-until-green.sh "$(bash_input 'sudo -u x bash <<EOF\ngit commit\nEOF')"
assert_allows "residue: a wrapper option in front of git passes" \
  block-commit-until-green.sh "$(bash_input 'sudo -u x git commit')"
assert_logged "an unresolved command prefix is counted, not read as clean" -F \
  '"event":"residue-allowed","command":"sudo -u x bash <<EOF' \
  '"event":"residue-allowed","command":"sudo -u x git commit"'

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

assert_every assert_allows_counted "payload behind a clustered option" <<'CLUSTERED_OPTION_TABLE'
bash -cO extglob \"git commit -m x\"
bash -co pipefail \"git commit -m x\"
bash -Oc extglob \"git commit -m x\"
bash -lcO extglob \"git commit -m x\"
sh -cO extglob \"git commit -m x\"
bash -cO extglob 'git commit -m x'
bash -cO nocaseglob \"git commit --amend\"
CLUSTERED_OPTION_TABLE

assert_allows_counted "a login-shell cluster is counted even with no git in it" \
  block-commit-until-green.sh "$(bash_input 'bash -lc \"npm test\"')"

assert_every assert_denies "scheduling wrapper" <<'WRAPPER_NAME_TABLE'
ionice -c2 git commit -m x
chrt -f 10 git commit -m x
taskset -c 0 git commit -m x
unbuffer git commit -m x
WRAPPER_NAME_TABLE

assert_allows_counted "residue: a lock file behind flock's option passes" \
  block-commit-until-green.sh "$(bash_input 'flock -x /tmp/l git commit -m x')"

assert_allows_counted "residue: a versioned interpreter that mentions git passes" \
  block-commit-until-green.sh "$(bash_input 'python3.13 -c \"import os; os.system('\''git commit'\'')\"')"

assert_allows_counted "residue: an interpreter behind a redirect is counted, not read as a file" \
  block-commit-until-green.sh "$(bash_input '>/dev/null python3 -c \"import os; os.system('\''git commit'\'')\"')"

assert_every assert_allows_counted "word an expansion leaves unresolved" <<'UNRESOLVED_WORD_TABLE'
g${x}it commit --no-verify -m x
`echo git` commit
git `echo commit` -m x
ev${a}l \"git commit\"
UNRESOLVED_WORD_TABLE

assert_denies "an expansion inside a resolved git path is still a deny" \
  block-commit-until-green.sh "$(bash_input '/opt/${tools}/git commit -m x')"

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

assert_denies "the same shell denies the commit a heredoc spells on the line" \
  block-commit-until-green.sh "$(bash_input 'bash -s <<EOF\ngit commit\nEOF')"

rm -f "$events_log"
assert_allows "a git mention with no shell to read it stays clear" \
  block-commit-until-green.sh "$(bash_input 'echo git commit')"
assert_allows "a pipe into a program that is no shell stays clear" \
  block-commit-until-green.sh "$(bash_input 'cat notes.md | grep commit')"
assert_not_logged "neither clear line is counted as residue"

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

assert_allows "residue: a payload whose escapes run past the bound is not decoded, so it passes counted" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3100 '\"aaaa')")"
assert_denies "a payload whose escapes fit the bound is decoded and read" \
  block-commit-until-green.sh "$(bash_input "$(commit_line_of_length 3000 '\"aaaa')")"
assert_logged "a payload past the decoder bound is logged with the head the client sent" -F \
  '"event":"residue-allowed","command":"git commit -m x && echo \\\"aaaa'

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
if [ "$POSIX_MODES_ARE_EMULATED" = true ]; then
  echo "skip: exact POSIX mode probes are not reliable on this host's mounts, so the event log has no mode to answer with"
  skipped=$((skipped + 1))
else
  case "$(ls -l "$events_log" | cut -c1-10)" in
    -rw-------) echo "ok: the event log is owner-only, like the state files"; pass=$((pass + 1)) ;;
    *) echo "FAIL: the event log is $(ls -l "$events_log" | cut -c1-10), and it carries command text"; fail=$((fail + 1)) ;;
  esac
fi

read_by() {
  ( . "$PLUGIN/hooks/lib.sh"; JSON_READER="$1"; json_command_line "$2" )
}

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

over_bound_line="$(commit_line_of_length 3100 '\"aaaa')"
over_bound_input="$(bash_input "$over_bound_line")"
assert_equals "the pattern reader leaves an over-bound payload undecoded" \
  "$over_bound_line" "$(read_by pattern "$over_bound_input")"
assert_equals_or_skip "jq leaves the same over-bound payload unread as the fallback" \
  jq "jq is absent here, so the bound has only one reader to hold for" \
  "$over_bound_line" read_by jq "$over_bound_input"

state_file_by_reader() {
  ( . "$PLUGIN/hooks/lib.sh"; JSON_READER="$1"; state_file_for "$(json_field "$2" cwd)" )
}

cr_cwd_input="$(bash_input 'npm test' "$REPO_ROOT"'\r')"
assert_equals "the pattern reader's CR-bearing cwd still names this repository's own state file" \
  "$REPO_STATE" "$(state_file_by_reader pattern "$cr_cwd_input")"
assert_equals_or_skip "jq's CR-bearing cwd names the same file the fallback does" \
  jq "jq is absent here, so the digest has only one reader to hold for" \
  "$REPO_STATE" state_file_by_reader jq "$cr_cwd_input"

assert_equals "state_file_for digests the repository, not a CR-bearing spelling of its path" \
  "$REPO_STATE" "$( . "$PLUGIN/hooks/lib.sh"; state_file_for "$REPO_ROOT"$'\r' )"

rm -f "$events_log"
( . "$PLUGIN/hooks/lib.sh"; JSON_READER=pattern; record_reader_fallback "$SESSION" )
assert_logged "a gate that fell back to the pattern reader records it" '"event":"jq-absent"'
oso-state --session "$SESSION" clear

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
  git -C "$COMMIT_REPO" config alias.ci commit
}

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
  COMMIT_REPO_STATE="$STATE_DIR/$(state_key_of "$COMMIT_REPO").state"
  commit_repo_state() { ( cd "$COMMIT_REPO" && oso-state --session "$SESSION" "$@" ); }

  commit_repo_state clear
  rm -f "$events_log"
  assert_commit_lands "a repo with no state file commits untouched" 'git commit -m x'
  assert_commit_lands "a terminal with no session variable commits untouched" \
    "env -u CLAUDE_CODE_SESSION_ID HOME=$HUMAN_HOME git commit -m x"
  assert_not_logged "neither allowed commit left a trace" "$HUMAN_HOME"

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

  assert_denies "the matcher is the layer that sees --no-verify" \
    block-commit-until-green.sh "$(bash_input 'git commit --no-verify -m x')"
  assert_commit_lands "--no-verify skips the git layer, as git documents" \
    'git commit --no-verify -m x'

  padded_no_verify='git commit --no-verify -m x #'
  while [ "${#padded_no_verify}" -le "$((3072 + 16))" ]; do
    padded_no_verify="$padded_no_verify padding"
  done
  assert_allows "padding takes --no-verify past what the matcher can read, so the one layer that sees that flag spends the line unread" \
    block-commit-until-green.sh "$(bash_input "$padded_no_verify")"
  aliased_no_verify='git ci --no-verify -m x'
  assert_allows "the matcher gates on the git verb, so an alias carries --no-verify past it with no padding at all" \
    block-commit-until-green.sh "$(bash_input "$aliased_no_verify")"
  assert_commit_lands "and --no-verify skips the layer that backstops an alias, so this shape meets neither" \
    "$aliased_no_verify"

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

native_path_form() {
  local posix_form
  command -v cygpath >/dev/null 2>&1 || { printf '%s' "$1"; return; }
  posix_form="$(cygpath -u "$1" 2>/dev/null)" || posix_form="$1"
  cygpath -m "$posix_form" 2>/dev/null || printf '%s' "$1"
}

bounded_probe="$(sed -n '/^impeccable_cli_runnable()/,/^}/p' "$REPO_ROOT/bootstrap/verify.sh")"
NPX_SHIM_DIR="$TEST_HOME/npx-shim"
NPX_ORPHAN_MARKER="$TEST_HOME/npx-orphan"
mkdir -p "$NPX_SHIM_DIR"

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
  rm -f "$NPX_ORPHAN_MARKER"
  assert_equals "an npx that hangs is killed at the bound, with the reason in the value" \
    "no answer within 1s (waited out the bound)" "$(probe_with_npx 1 "#!/bin/sh
( sleep 2; touch $NPX_ORPHAN_MARKER ) &
sleep 60")"
  sleep 3
  assert_equals "the kill at the bound takes the probe's own children with it" \
    "no orphan" "$([ -f "$NPX_ORPHAN_MARKER" ] && echo "orphan survived" || echo "no orphan")"
fi

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

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: two of this contract's behaviours rest on a .codex directory and a config.toml that escape through a symlink, and ln-as-copy publishes a real directory and a real file instead"
  skipped=$((skipped + 1))
else
  assert_equals "repair-engram-codex shell surface is syntax-valid and contains fail-safe backup/checksum/setup/verification rails" \
    complete "$(repair_engram_codex_contract_status)"
fi

REPAIR_DOWNLOAD_FUNCTION="$(sed -n '/^download_file() {$/,/^}$/p' "$REPAIR_ENGRAM_CODEX_SH")"
REPAIR_DOWNLOAD_BOUND_LINE="$( { grep -F 'ENGRAM_DOWNLOAD_BOUND_SECONDS=' "$REPAIR_ENGRAM_CODEX_SH" || true; } | grep -v '^#' || true)"
assert_equals "repair-engram-codex.sh defines download_file, so its bound has something to test" \
  "present" "$([ -n "$REPAIR_DOWNLOAD_FUNCTION" ] && printf present || printf missing)"

repair_download_probe() (
  eval "$REPAIR_DOWNLOAD_BOUND_LINE"
  eval "$REPAIR_DOWNLOAD_FUNCTION"
  fail() { printf 'FAILCALL:%s\n' "$1"; exit 1; }
  download_file "$1" "$2" "$3"
)

REPAIR_DOWNLOAD_SHIM_DIR="$TEST_HOME/repair-download-shims"
mkdir -p "$REPAIR_DOWNLOAD_SHIM_DIR"
REPAIR_DOWNLOAD_CURL_CALLS="$TEST_HOME/repair-download-curl-calls"

write_repair_download_curl_shim() {
  local exit_code="$1"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''%s\n'\'' "$*" >> "$OSO_TEST_CURL_CALLS"' \
    "exit $exit_code" > "$REPAIR_DOWNLOAD_SHIM_DIR/curl"
  chmod +x "$REPAIR_DOWNLOAD_SHIM_DIR/curl"
}

: > "$REPAIR_DOWNLOAD_CURL_CALLS"
write_repair_download_curl_shim 28
REPAIR_DOWNLOAD_TIMEOUT_OUTPUT="$(
  PATH="$REPAIR_DOWNLOAD_SHIM_DIR:$PATH" OSO_TEST_CURL_CALLS="$REPAIR_DOWNLOAD_CURL_CALLS" \
    OSO_ENGRAM_DOWNLOAD_BOUND_SECONDS=2 \
    repair_download_probe "https://example.test/asset.tar.gz" "$TEST_HOME/repair-download-dest" \
      "Engram release archive" 2>&1
)" || true
assert_equals "curl's own reserved timeout code is named SLOW, with the operation and the bound" \
  "1" "$(printf '%s\n' "$REPAIR_DOWNLOAD_TIMEOUT_OUTPUT" | \
    grep -Fc 'FAILCALL:SLOW: download of Engram release archive did not finish within 2s: https://example.test/asset.tar.gz' || true)"
assert_equals "the repair passes its own bound to curl's connect and max-time flags" \
  "1" "$(grep -Fc -- '--connect-timeout 2 --max-time 2' "$REPAIR_DOWNLOAD_CURL_CALLS" || true)"

write_repair_download_curl_shim 6
REPAIR_DOWNLOAD_UNAVAILABLE_OUTPUT="$(
  PATH="$REPAIR_DOWNLOAD_SHIM_DIR:$PATH" OSO_TEST_CURL_CALLS="$REPAIR_DOWNLOAD_CURL_CALLS" \
    OSO_ENGRAM_DOWNLOAD_BOUND_SECONDS=2 \
    repair_download_probe "https://example.test/asset.tar.gz" "$TEST_HOME/repair-download-dest" \
      "Engram release archive" 2>&1
)" || true
assert_equals "a non-timeout curl failure is named UNAVAILABLE, never mistaken for a hang" \
  "1" "$(printf '%s\n' "$REPAIR_DOWNLOAD_UNAVAILABLE_OUTPUT" | \
    grep -Fc 'FAILCALL:UNAVAILABLE: download of Engram release archive failed: https://example.test/asset.tar.gz (curl exit 6)' || true)"

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

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: the fallow resolver fixture PATH is one linked cat and nothing else, and that copy runs without its libraries, so no rendered Codex config comes back to read"
  skipped=$((skipped + 1))
else
  . "$REPO_ROOT/bootstrap/lib/codex-managed-config.sh"
  CODEX_CARGO_FALLOW_HOME="$TEST_HOME/codex-cargo-fallow-home"
  CODEX_NO_FALLOW_PATH="$TEST_HOME/no-fallow-path"
  mkdir -p "$CODEX_CARGO_FALLOW_HOME/.cargo/bin" "$CODEX_NO_FALLOW_PATH"
  ln -s "$(command -v cat)" "$CODEX_NO_FALLOW_PATH/cat"
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp"
  chmod +x "$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp"
  cargo_fallow_config="$(
    PATH="$CODEX_NO_FALLOW_PATH" APPDATA="" render_codex_managed_config \
      "$CODEX_CARGO_FALLOW_HOME" \
      "$CODEX_CARGO_FALLOW_HOME/.local/share/oso-code/runtime"
  )"
  assert_equals "Codex config resolves a Cargo-home fallow binary outside PATH" \
    "1" "$(printf '%s\n' "$cargo_fallow_config" |
      grep -Fxc "command = \"$CODEX_CARGO_FALLOW_HOME/.cargo/bin/fallow-mcp\"" || true)"

  CODEX_NPM_FALLOW_HOME="$TEST_HOME/codex-npm-fallow-home"
  CODEX_NPM_FALLOW_APPDATA="$CODEX_NPM_FALLOW_HOME/AppData/Roaming"
  mkdir -p "$CODEX_NPM_FALLOW_APPDATA/npm"
  printf '%s\n' '@echo off' > "$CODEX_NPM_FALLOW_APPDATA/npm/fallow-mcp.cmd"
  chmod +x "$CODEX_NPM_FALLOW_APPDATA/npm/fallow-mcp.cmd"
  npm_fallow_config="$(
    PATH="$CODEX_NO_FALLOW_PATH" APPDATA="$CODEX_NPM_FALLOW_APPDATA" \
      render_codex_managed_config "$CODEX_NPM_FALLOW_HOME" \
        "$CODEX_NPM_FALLOW_HOME/.local/share/oso-code/runtime"
  )"
  assert_equals "the npm .cmd shim is the fallow command a Windows install resolves" \
    "1" "$(printf '%s\n' "$npm_fallow_config" |
      grep -Fxc "command = \"$CODEX_NPM_FALLOW_APPDATA/npm/fallow-mcp.cmd\"" || true)"

  CODEX_NPM_PREFIX_HOME="$TEST_HOME/codex-npm-prefix-home"
  CODEX_NPM_PREFIX_DIR="$CODEX_NPM_PREFIX_HOME/opt/npm-global"
  CODEX_NPM_PREFIX_PATH="$TEST_HOME/npm-prefix-stub"
  mkdir -p "$CODEX_NPM_PREFIX_DIR" "$CODEX_NPM_PREFIX_PATH"
  printf '%s\n' '#!/bin/sh' \
    "[ \"\$*\" = 'prefix -g' ] || exit 1" \
    "echo '$CODEX_NPM_PREFIX_DIR'" > "$CODEX_NPM_PREFIX_PATH/npm"
  chmod +x "$CODEX_NPM_PREFIX_PATH/npm"
  printf '%s\n' '@echo off' > "$CODEX_NPM_PREFIX_DIR/fallow-mcp.cmd"
  chmod +x "$CODEX_NPM_PREFIX_DIR/fallow-mcp.cmd"
  npm_prefix_config="$(
    PATH="$CODEX_NPM_PREFIX_PATH:$CODEX_NO_FALLOW_PATH" \
      APPDATA="$CODEX_NPM_FALLOW_APPDATA" \
      render_codex_managed_config "$CODEX_NPM_PREFIX_HOME" \
        "$CODEX_NPM_PREFIX_HOME/.local/share/oso-code/runtime"
  )"
  assert_equals "a custom npm prefix is where the Windows shim is looked for, not the default one" \
    "1" "$(printf '%s\n' "$npm_prefix_config" |
      grep -Fxc "command = \"$CODEX_NPM_PREFIX_DIR/fallow-mcp.cmd\"" || true)"
fi

CODEX_DECLINE_HOME="$TEST_HOME/codex-decline-home"
printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
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
assert_equals "declining the install exits before any destination mutation" \
  "nonzero" "$([ "$codex_decline_rc" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "declining a pinned install makes no npm call and reads the version exactly once" \
  "1" "$(wc -l < "$CODEX_INSTALL_CALLS" | tr -d ' ')"
assert_equals "the one call declining makes is the version precondition, not an update" \
  "codex:--version" "$(cat "$CODEX_INSTALL_CALLS")"

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
  "0" "$(grep '^npm:' "$CODEX_INSTALL_CALLS" | grep -vc '^npm:prefix -g$' || true)"
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

for codex_secret_pattern in \
  '"**/*.key" = "deny"' \
  '"**/*.pem" = "deny"' \
  '"**/.env" = "deny"' \
  '"**/.env.production" = "deny"' \
  '"**/.npmrc" = "deny"' \
  '"**/*.p12" = "deny"' \
  '"**/*.pfx" = "deny"' \
  '"**/*.jks" = "deny"' \
  '"**/*.keystore" = "deny"' \
  '"**/id_rsa" = "deny"' \
  '"**/id_dsa" = "deny"' \
  '"**/id_ecdsa" = "deny"' \
  '"**/id_ed25519" = "deny"' \
  '"**/.ssh/**" = "deny"' \
  '"**/.aws/**" = "deny"' \
  '"**/.config/gcloud/**" = "deny"' \
  '"**/.azure/**" = "deny"' \
  '"**/.kube/**" = "deny"'; do
  assert_equals "the managed permissions deny $codex_secret_pattern" \
    "present" "$(grep -Fx "$codex_secret_pattern" "$CODEX_HAPPY_CONFIG" >/dev/null && echo present || echo missing)"
done

assert_equals "the oso profile is the machine default, since Codex has no per-project profile selection to scope it narrower" \
  "1" "$(grep -Fxc 'default_permissions = "oso"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the oso profile itself still needs the full git-dir subtree for its own plumbing" \
  "1" "$(grep -Fxc '".git/**" = "write"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "git config stays readable but not writable — closes the core.hooksPath/remote redirect vector" \
  "1" "$(grep -Fxc '".git/config" = "read"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "network keeps the wide grant a generic project's own build/test needs require" \
  "1" "$(grep -Fxc '"*" = "allow"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the cloud metadata IMDS address is denied to close the classic SSRF-to-credential-theft route" \
  "1" "$(grep -Fxc '"169.254.169.254" = "deny"' "$CODEX_HAPPY_CONFIG" || true)"
assert_equals "the GCP metadata hostname alias is denied alongside the IMDS address" \
  "1" "$(grep -Fxc '"metadata.google.internal" = "deny"' "$CODEX_HAPPY_CONFIG" || true)"

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
  "present" "$(grep -F "$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/dist" "$CODEX_HAPPY_HOME/.codex/hooks.json" >/dev/null && echo present || echo missing)"
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
      normalized_hook_digest="$(sed "s|$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/dist|__OSO_HOOKS_DIR__|g" "$installed_hook_path" 2>/dev/null |
        { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" || normalized_hook_digest=""
      normalized_hook_digest="${normalized_hook_digest%% *}"
      [ "$normalized_hook_digest" = "$published_digest" ] \
        || missing_installed_hook="$missing_installed_hook $published_path"
      continue
      ;;
    plugin/dist/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/dist/${published_path#plugin/dist/}" ;;
    plugin/hooks/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/hooks/${published_path#plugin/hooks/}" ;;
    plugin/git-hooks/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/git-hooks/${published_path#plugin/git-hooks/}" ;;
    plugin/bin/*) installed_hook_path="$CODEX_HAPPY_HOME/.local/share/oso-code/runtime/bin/${published_path#plugin/bin/}" ;;
    opencode/*) continue ;;
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
assert_equals "the staged plugin carries all nine Codex skill wrappers" \
  "9" "$(find "$CODEX_STAGED_MARKETPLACE/codex/skills" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print | wc -l | tr -d ' ')"
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

CODEX_OLD_HOME="$TEST_HOME/codex-old-version-home"
write_codex_install_personal_state "$CODEX_OLD_HOME"
printf '0.145.0\n' > "$CODEX_INSTALL_VERSION"
run_codex_install "$CODEX_OLD_HOME"
assert_equals "an old Codex CLI refuses the install instead of silently updating itself" \
  "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
assert_equals "the refusal names the exact pin command to run" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | grep -Fc 'npm install --global @openai/codex@0.146.0' || true)"
assert_equals "an unmet CLI pin makes no npm call and reads the version exactly once" \
  "codex:--version" "$(cat "$CODEX_INSTALL_CALLS")"
assert_equals "an unmet CLI pin refusal happens before any destination mutation" \
  "absent" "$([ -e "$CODEX_OLD_HOME/.codex/hooks.json" ] || [ -e "$CODEX_OLD_HOME/.local/share/oso-code" ] && echo mutated || echo absent)"
assert_equals "the shipped Codex installer contains no @latest escape hatch" \
  "0" "$(grep -c '@latest' "$INSTALL_CODEX_SH" || true)"
assert_equals "the shipped Codex installer never mutates the global CLI itself" \
  "0" "$(grep -cE '^[[:space:]]*npm install' "$INSTALL_CODEX_SH" || true)"

CODEX_PREFLIGHT_LINE="$(grep -n '^  preflight_codex_version$' "$INSTALL_CODEX_SH" |
  head -n1 | cut -d: -f1)" || CODEX_PREFLIGHT_LINE=""
CODEX_CONFIRM_LINE="$(grep -n '^  confirm_install$' "$INSTALL_CODEX_SH" |
  head -n1 | cut -d: -f1)" || CODEX_CONFIRM_LINE=""
CODEX_BEGIN_TX_LINE="$(grep -n '^  begin_transaction$' "$INSTALL_CODEX_SH" |
  head -n1 | cut -d: -f1)" || CODEX_BEGIN_TX_LINE=""
assert_equals "the CLI pin precondition is checked before confirm_install ever prompts" \
  "before" "$([ "${CODEX_PREFLIGHT_LINE:-0}" -lt "${CODEX_CONFIRM_LINE:-0}" ] 2>/dev/null && echo before || echo not-before)"
assert_equals "confirm_install still gates every mutation, including the transaction itself" \
  "before" "$([ "${CODEX_CONFIRM_LINE:-0}" -lt "${CODEX_BEGIN_TX_LINE:-0}" ] 2>/dev/null && echo before || echo not-before)"

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
assert_equals "a duplicate published hash path is rejected even with fourteen rows" \
  "duplicate path" "$(codex_install_log_class 'duplicate path' 'duplicate published hook path')"
assert_equals "duplicate hash coverage is rejected before any destination mutation" \
  "absent" "$([ -e "$CODEX_HASH_HOME/.codex" ] || [ -e "$CODEX_HASH_HOME/.agents" ] || [ -e "$CODEX_HASH_HOME/.local/share/oso-code" ] && echo mutated || echo absent)"

CODEX_ROLLBACK_HOME="$TEST_HOME/codex-rollback-home"
mkdir -p "$CODEX_ROLLBACK_HOME"
cp -R "$CODEX_HAPPY_HOME/." "$CODEX_ROLLBACK_HOME/"
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
    "$(native_path_form "$CODEX_GIT_MIGRATE_HOME/.local/share/oso-code/runtime/git-hooks")" \
    "$(native_path_form "$(git -C "$CODEX_GIT_MIGRATE_RELEASE" config --local --get core.hooksPath)")"
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
    "$(native_path_form "$legacy_rollback_path")" \
    "$(native_path_form "$(git -C "$CODEX_GIT_LEGACY_ROLLBACK_RELEASE" config --local --get core.hooksPath)")"
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
    "$(native_path_form "$CODEX_GIT_LOOKALIKE_RELEASE/operator-hooks")" \
    "$(native_path_form "$(git -C "$CODEX_GIT_LOOKALIKE_RELEASE" config --local --get core.hooksPath)")"

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
    "$(native_path_form "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks")" \
    "$(native_path_form "$(git -C "$CODEX_GIT_SIBLING_RELEASE" config --local --get core.hooksPath)")"
  assert_equals "a refused mixed checkout preserves its hidden sibling" \
    "operator-owned hidden sibling" \
    "$(cat "$CODEX_GIT_SIBLING_RELEASE/plugin/git-hooks/.operator-hook")"

  if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
    echo "skip: a symlinked hook directory and a symlinked pre-commit are the whole premise here, and ln-as-copy publishes the real directory and the real file an installer is right to adopt"
    skipped=$((skipped + 1))
  else
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
  fi

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
    "$(native_path_form "$CODEX_GIT_GLOBAL_RELEASE/plugin/git-hooks")" \
    "$(native_path_form "$(HOME="$CODEX_GIT_GLOBAL_HOME" git config --global --get core.hooksPath)")"

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
substring_runtime="$CODEX_SUBSTRING_HOOKS_HOME/.local/share/oso-code/runtime/dist"
printf '%s\n' \
  '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"foreign-wrapper '"$substring_runtime"'/gate.js commit"}]}]}}' \
  > "$CODEX_SUBSTRING_HOOKS_HOME/.codex/hooks.json"
substring_hooks_before="$(install_file_snapshot "$CODEX_SUBSTRING_HOOKS_HOME")"
run_codex_install "$CODEX_SUBSTRING_HOOKS_HOME"
assert_equals "mentioning the oso hooks path as an argument does not establish ownership" \
  "foreign hooks" "$(codex_install_log_class 'foreign hooks' 'foreign.*hooks|refus.*hooks')"
assert_equals "substring-only hook ownership leaves every destination byte-identical" \
  "$substring_hooks_before" "$(install_file_snapshot "$CODEX_SUBSTRING_HOOKS_HOME")"

CODEX_MIXED_HOOKS_HOME="$TEST_HOME/codex-mixed-hooks-home"
write_codex_install_personal_state "$CODEX_MIXED_HOOKS_HOME"
mixed_runtime="$CODEX_MIXED_HOOKS_HOME/.local/share/oso-code/runtime/dist"
printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"OSO_AGENT=1 node \\"%s\\"/gate.js commit"},{"type":"prompt","prompt":"operator-owned"}]}]}}\n' \
  "$mixed_runtime" > "$CODEX_MIXED_HOOKS_HOME/.codex/hooks.json"
mixed_hooks_before="$(install_file_snapshot "$CODEX_MIXED_HOOKS_HOME")"
run_codex_install "$CODEX_MIXED_HOOKS_HOME"
assert_equals "one valid oso command cannot annex a second operator-owned hook handler" \
  "foreign hooks" "$(codex_install_log_class 'foreign hooks' 'foreign.*hooks|refus.*hooks')"
assert_equals "mixed hook ownership refusal preserves the complete manifest" \
  "$mixed_hooks_before" "$(install_file_snapshot "$CODEX_MIXED_HOOKS_HOME")"

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: a symlinked agents directory and a symlinked role file are the whole premise here, and ln-as-copy publishes a real directory and a real file, so neither the refusal nor the write-through has anything to be observed against"
  skipped=$((skipped + 1))
else
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

  CODEX_ROLE_SYMLINK_HOME="$TEST_HOME/codex-role-symlink-home"
  write_codex_install_personal_state "$CODEX_ROLE_SYMLINK_HOME"
  CODEX_ROLE_SYMLINK_SENTINEL="$TEST_HOME/codex-role-symlink-sentinel.toml"
  printf 'sentinel: do not touch\n' > "$CODEX_ROLE_SYMLINK_SENTINEL"
  chmod 644 "$CODEX_ROLE_SYMLINK_SENTINEL"
  ln -s "$CODEX_ROLE_SYMLINK_SENTINEL" "$CODEX_ROLE_SYMLINK_HOME/.codex/agents/oso-applier.toml"
  printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
  run_codex_install "$CODEX_ROLE_SYMLINK_HOME"
  assert_equals "installing over a symlinked role file still completes" \
    "0" "$CODEX_INSTALL_RC"
  assert_equals "a symlinked role file's write never reaches its external sentinel target" \
    "sentinel: do not touch" "$(cat "$CODEX_ROLE_SYMLINK_SENTINEL")"
  assert_equals "a symlinked role file's chmod never reaches its external sentinel target" \
    "0644" "$(find "$CODEX_ROLE_SYMLINK_SENTINEL" -maxdepth 0 -type f -perm 0644 -print | grep -q . && echo 0644 || echo wrong)"
  assert_equals "the staged role file replaces the symlink with the real oso-code role" \
    "1" "$([ -f "$CODEX_ROLE_SYMLINK_HOME/.codex/agents/oso-applier.toml" ] && \
      [ ! -L "$CODEX_ROLE_SYMLINK_HOME/.codex/agents/oso-applier.toml" ] && \
      cmp -s "$REPO_ROOT/codex/agents/oso-applier.toml" \
        "$CODEX_ROLE_SYMLINK_HOME/.codex/agents/oso-applier.toml" && echo 1 || echo 0)"
fi

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

printf '%s\n' \
  'mode=plan' 'active_slice=none' 'verify_green=false' \
  'plan_approval=pending' \
  "plan_approval_digest=$migration_plan_digest" \
  "plan_snapshot_file=$MIGRATION_ULID_REPO/presented.md" \
  "plan_current_file=$MIGRATION_ULID_REPO/current.md" \
  'plan_revision=0' \
  "session=$migration_presenting_session" > "$migration_ulid_state"

printf '%s\n' \
  'mode=plan' 'active_slice=none' 'verify_green=false' \
  'plan_approval=pending' \
  "plan_approval_digest=$migration_plan_digest" \
  "plan_snapshot_file=$MIGRATION_MARKER_REPO/presented.md" \
  "plan_current_file=$MIGRATION_MARKER_REPO/current.md" \
  'plan_revision=0' \
  'session=1' > "$migration_marker_state"

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

migration_marker_probe_input="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{}}' \
  "codex-migration-marker-probe-session" "$MIGRATION_MARKER_REPO" FutureWriter)"
HOME="$CODEX_MIGRATION_HOME" run_hook "$UNKNOWN_TOOL_HOOK" "$migration_marker_probe_input" 0 '' \
  --allow "$UNKNOWN_TOOL_ALLOWLIST"
assert_after_hook "the cleared repository no longer denies a tool call at all" \
  [ -z "$hook_stdout" ]

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

if ! command -v python3 >/dev/null 2>&1; then
  echo "skip: python3 is absent here, so the Impeccable marketplace pin fetch path has nothing to run"
  skipped=$((skipped + 1))
else
  IMPECCABLE_PIN_VERSION="$(sed -n 's/^SUPPORTED_IMPECCABLE_VERSION=//p' "$INSTALL_CODEX_SH")"

  write_impeccable_pin_codex_shim() {
    local shim_dir="$1"
    mkdir -p "$shim_dir"
    printf '%s\n' \
      '#!/bin/sh' \
      'printf '\''codex:%s\n'\'' "$*" >> "$OSO_TEST_CALLS"' \
      'case "$*" in' \
      '  --version) printf '\''codex-cli %s\n'\'' "$(cat "$OSO_TEST_CODEX_VERSION")" ;;' \
      '  "sandbox -P oso -- /bin/true") exit 0 ;;' \
      '  "plugin marketplace list --json") printf '\''{"marketplaces":[]}\n'\'' ;;' \
      "  \"plugin marketplace add pbakaus/impeccable --ref skill-v$IMPECCABLE_PIN_VERSION --json\")" \
      '    printf '\''{"installedRoot":"%s"}\n'\'' "$OSO_TEST_IMPECCABLE_FETCHED_ROOT" ;;' \
      '  "plugin marketplace add "*) exit 0 ;;' \
      '  "plugin add oso-code@oso-code --json") exit 0 ;;' \
      '  "plugin add impeccable@impeccable --json") exit 0 ;;' \
      '  *) printf '\''unexpected codex call: %s\n'\'' "$*" >&2; exit 64 ;;' \
      'esac' > "$shim_dir/codex"
    chmod +x "$shim_dir/codex"
  }

  run_codex_install_impeccable_pin() {
    local fixture_home="$1" shim_dir="$2" impeccable_source="$3" fetched_root="$4"
    : > "$CODEX_INSTALL_CALLS"
    printf '0.146.0\n' > "$CODEX_INSTALL_VERSION"
    if HOME="$fixture_home" \
      CODEX_HOME="$fixture_home/.codex" \
      PATH="$shim_dir:$CODEX_INSTALL_SHIMS:$PATH" \
      OSO_TEST_CALLS="$CODEX_INSTALL_CALLS" \
      OSO_TEST_CODEX_VERSION="$CODEX_INSTALL_VERSION" \
      OSO_IMPECCABLE_SOURCE="$impeccable_source" \
      OSO_TEST_IMPECCABLE_FETCHED_ROOT="$fetched_root" \
      bash "$INSTALL_CODEX_SH" --yes --no-git-hook > "$CODEX_INSTALL_OUTPUT" 2>&1; then
      CODEX_INSTALL_RC=0
    else
      CODEX_INSTALL_RC=$?
    fi
    CODEX_INSTALL_LOG="$(cat "$CODEX_INSTALL_OUTPUT")"
  }

  IMPECCABLE_PIN_SHIM_DIR="$TEST_HOME/impeccable-pin-shims"
  write_impeccable_pin_codex_shim "$IMPECCABLE_PIN_SHIM_DIR"

  IMPECCABLE_PIN_MATCH_SOURCE="$TEST_HOME/impeccable-pin-match-source"
  write_codex_impeccable_fixture "$IMPECCABLE_PIN_MATCH_SOURCE" \
    'name: impeccable' "version: $IMPECCABLE_PIN_VERSION"
  IMPECCABLE_PIN_MATCH_HOME="$TEST_HOME/impeccable-pin-match-home"
  run_codex_install_impeccable_pin "$IMPECCABLE_PIN_MATCH_HOME" "$IMPECCABLE_PIN_SHIM_DIR" \
    "$IMPECCABLE_PIN_MATCH_SOURCE" "$TEST_HOME/impeccable-pin-unused-root"
  assert_equals "a candidate already at the pinned version installs cleanly" \
    "0" "$CODEX_INSTALL_RC"
  assert_equals "a candidate already at the pinned version triggers no marketplace fetch" \
    "0" "$(grep -Fc 'plugin marketplace add pbakaus/impeccable' "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "the mounted skill carries the pinned version" \
    "$IMPECCABLE_PIN_VERSION" \
    "$(sed -n 's/^version:[[:space:]]*//p' \
      "$IMPECCABLE_PIN_MATCH_HOME/.agents/skills/impeccable/SKILL.md" 2>/dev/null || true)"

  IMPECCABLE_PIN_MISMATCH_SOURCE="$TEST_HOME/impeccable-pin-mismatch-source"
  write_codex_impeccable_fixture "$IMPECCABLE_PIN_MISMATCH_SOURCE" \
    'name: impeccable' 'version: 1.2.3'
  IMPECCABLE_PIN_FETCHED_ROOT="$TEST_HOME/impeccable-pin-fetched-root"
  write_codex_impeccable_fixture \
    "$IMPECCABLE_PIN_FETCHED_ROOT/.agents/skills/impeccable" \
    'name: impeccable' "version: $IMPECCABLE_PIN_VERSION"
  IMPECCABLE_PIN_MISMATCH_HOME="$TEST_HOME/impeccable-pin-mismatch-home"
  run_codex_install_impeccable_pin "$IMPECCABLE_PIN_MISMATCH_HOME" "$IMPECCABLE_PIN_SHIM_DIR" \
    "$IMPECCABLE_PIN_MISMATCH_SOURCE" "$IMPECCABLE_PIN_FETCHED_ROOT"
  assert_equals "a candidate at a different version still installs cleanly, from the pinned fetch" \
    "0" "$CODEX_INSTALL_RC"
  assert_equals "a candidate at a different version falls through to the exact pinned ref" \
    "1" "$(grep -Fc "plugin marketplace add pbakaus/impeccable --ref skill-v$IMPECCABLE_PIN_VERSION --json" \
      "$CODEX_INSTALL_CALLS" || true)"
  assert_equals "the pinned fetch replaces the mismatched candidate with the pinned version" \
    "$IMPECCABLE_PIN_VERSION" \
    "$(sed -n 's/^version:[[:space:]]*//p' \
      "$IMPECCABLE_PIN_MISMATCH_HOME/.agents/skills/impeccable/SKILL.md" 2>/dev/null || true)"

  IMPECCABLE_PIN_INCONSISTENT_ROOT="$TEST_HOME/impeccable-pin-inconsistent-root"
  write_codex_impeccable_fixture \
    "$IMPECCABLE_PIN_INCONSISTENT_ROOT/.agents/skills/impeccable" \
    'name: impeccable' 'version: 9.9.9'
  IMPECCABLE_PIN_INCONSISTENT_HOME="$TEST_HOME/impeccable-pin-inconsistent-home"
  run_codex_install_impeccable_pin "$IMPECCABLE_PIN_INCONSISTENT_HOME" "$IMPECCABLE_PIN_SHIM_DIR" \
    "$IMPECCABLE_PIN_MISMATCH_SOURCE" "$IMPECCABLE_PIN_INCONSISTENT_ROOT"
  assert_equals "a pinned fetch that itself disagrees with the pin fails the install" \
    "nonzero" "$([ "$CODEX_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "the failure names the pin and what the fetch actually reported" \
    "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | \
      grep -Fc "Impeccable is pinned to skill-v$IMPECCABLE_PIN_VERSION but the mounted skill reports version 9.9.9" || true)"
fi

. "$REPO_ROOT/bootstrap/lib/install-backup.sh"
RESTORE_CODEX_SH="$REPO_ROOT/bootstrap/restore-codex.sh"

newest_install_backup_name() {
  local root="$1/.local/state/oso-code" path
  path="$(install_backup_dirs_newest_first "$root" | awk 'NR == 1 { print; exit }')"
  printf '%s' "${path##*/}"
}

count_install_backups() {
  install_backup_dirs_newest_first "$1/.local/state/oso-code" | wc -l | tr -d '[:space:]'
}

run_codex_restore() {
  local fixture_home="$1" backup_name="$2"
  if CODEX_RESTORE_OUTPUT="$(HOME="$fixture_home" bash "$RESTORE_CODEX_SH" --yes "$backup_name" 2>&1)"; then
    CODEX_RESTORE_RC=0
  else
    CODEX_RESTORE_RC=$?
  fi
}

CODEX_RESTORE_HOME="$TEST_HOME/codex-restore-retention-home"

run_codex_install "$CODEX_RESTORE_HOME"
codex_restore_snapshot_a="$(install_file_snapshot "$CODEX_RESTORE_HOME")"

run_codex_install "$CODEX_RESTORE_HOME"
codex_restore_backup_2="$(newest_install_backup_name "$CODEX_RESTORE_HOME")"
assert_equals "two installs leave exactly two backups" \
  "2" "$(count_install_backups "$CODEX_RESTORE_HOME")"

export OSO_INSTALL_BACKUP_BUDGET_KIB=1
run_codex_install "$CODEX_RESTORE_HOME"
unset OSO_INSTALL_BACKUP_BUDGET_KIB
assert_equals "retention skips every backup until the restore path is verified, even under an impossible budget" \
  "3" "$(count_install_backups "$CODEX_RESTORE_HOME")"
assert_equals "the skip is named, not silent" \
  "1" "$(printf '%s\n' "$CODEX_INSTALL_LOG" | \
    grep -Fc 'backup retention: skipped — the restore path has not been verified' || true)"

rm -rf "$CODEX_RESTORE_HOME/.codex/agents"
printf 'operator broke this\n' > "$CODEX_RESTORE_HOME/.codex/config.toml"
run_codex_restore "$CODEX_RESTORE_HOME" "$codex_restore_backup_2"
assert_equals "the restore run exits clean" "0" "$CODEX_RESTORE_RC"
assert_equals "restoring backup #2 brings the tree back to the exact state install #1 left" \
  "$codex_restore_snapshot_a" "$(install_file_snapshot "$CODEX_RESTORE_HOME")"
assert_equals "a successful restore arms retention for its OWN host and never for the other one" \
  "present absent" "$([ -f "$CODEX_RESTORE_HOME/.local/state/oso-code/.install-restore-verified-codex" ] \
    && printf present || printf absent) $([ -f "$CODEX_RESTORE_HOME/.local/state/oso-code/.install-restore-verified-opencode" ] \
    && printf present || printf absent)"

export OSO_INSTALL_BACKUP_BUDGET_KIB=1
run_codex_install "$CODEX_RESTORE_HOME"
unset OSO_INSTALL_BACKUP_BUDGET_KIB
assert_equals "retention now prunes down to the newest backup once the restore path is proven" \
  "1" "$(count_install_backups "$CODEX_RESTORE_HOME")"

CODEX_RESTORE_BOGUS_HOME="$TEST_HOME/codex-restore-bogus-home"
mkdir -p "$CODEX_RESTORE_BOGUS_HOME/.local/state/oso-code"
run_codex_restore "$CODEX_RESTORE_BOGUS_HOME" "../../etc"
assert_equals "a backup name that is not a bare directory name is refused" \
  "nonzero" "$([ "$CODEX_RESTORE_RC" -ne 0 ] && echo nonzero || echo zero)"

CODEX_LOGIN_HANG_SHIM_DIR="$TEST_HOME/codex-login-hang-shim"
mkdir -p "$CODEX_LOGIN_HANG_SHIM_DIR"
printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in' \
  '  --version) printf '\''codex-cli 0.0.0-test\n'\''; exit 0 ;;' \
  '  login) sleep 60 ;;' \
  '  sandbox) exit 0 ;;' \
  '  *) exit 1 ;;' \
  'esac' > "$CODEX_LOGIN_HANG_SHIM_DIR/codex"
chmod +x "$CODEX_LOGIN_HANG_SHIM_DIR/codex"

CODEX_LOGIN_HANG_HOME="$TEST_HOME/codex-login-hang-home"
mkdir -p "$CODEX_LOGIN_HANG_HOME/.codex"
CODEX_LOGIN_HANG_START="$(date +%s)"
CODEX_LOGIN_HANG_OUTPUT="$(
  HOME="$CODEX_LOGIN_HANG_HOME" CODEX_HOME="$CODEX_LOGIN_HANG_HOME/.codex" \
    PATH="$CODEX_LOGIN_HANG_SHIM_DIR:$PATH" \
    OSO_CODEX_LOGIN_STATUS_BOUND_SECONDS=2 \
    bash "$REPO_ROOT/bootstrap/verify-codex.sh" 2>&1 || true
)"
CODEX_LOGIN_HANG_ELAPSED=$(($(date +%s) - CODEX_LOGIN_HANG_START))
assert_equals "codex login status names itself when it never answers, instead of hanging the verifier" \
  "1" "$(printf '%s\n' "$CODEX_LOGIN_HANG_OUTPUT" | \
    grep -Fxc 'FAIL: Codex authentication — expected logged-in, got SLOW: codex login status did not answer within 2s' || true)"
if oso_nightly_only "the bounded codex login status ends well inside a generous multiple of its own bound"; then
  assert_equals "the bounded codex login status ends well inside a generous multiple of its own bound" \
    "bounded" "$([ "$CODEX_LOGIN_HANG_ELAPSED" -le 30 ] && printf bounded || printf "unbounded:${CODEX_LOGIN_HANG_ELAPSED}s")"
fi
if pgrep -f "$CODEX_LOGIN_HANG_SHIM_DIR/codex" >/dev/null 2>&1; then
  echo "FAIL: the hanging codex login status fixture outlived the bounded check"; fail=$((fail + 1))
else
  echo "ok: the hanging codex login status fixture does not outlive the bounded check"; pass=$((pass + 1))
fi

if ! command -v git >/dev/null 2>&1; then
  echo "skip: git is absent here, so the codex exec smoke bound cannot be exercised end to end"
  skipped=$((skipped + 1))
else
  CODEX_EXEC_HANG_SHIM_DIR="$TEST_HOME/codex-exec-hang-shim"
  mkdir -p "$CODEX_EXEC_HANG_SHIM_DIR"
  printf '%s\n' \
    '#!/bin/sh' \
    'case "$1" in' \
    '  --version) printf '\''codex-cli 0.0.0-test\n'\''; exit 0 ;;' \
    '  login) [ "$2" = status ] && exit 0 || exit 1 ;;' \
    '  exec) sleep 60 ;;' \
    '  sandbox) exit 0 ;;' \
    '  *) exit 1 ;;' \
    'esac' > "$CODEX_EXEC_HANG_SHIM_DIR/codex"
  chmod +x "$CODEX_EXEC_HANG_SHIM_DIR/codex"

  CODEX_EXEC_HANG_HOME="$TEST_HOME/codex-exec-hang-home"
  CODEX_EXEC_HANG_CODEX_HOME="$CODEX_EXEC_HANG_HOME/.codex"
  mkdir -p "$CODEX_EXEC_HANG_CODEX_HOME/agents"
  printf 'fixture-auth\n' > "$CODEX_EXEC_HANG_CODEX_HOME/auth.json"
  printf '{"hooks":{}}\n' > "$CODEX_EXEC_HANG_CODEX_HOME/hooks.json"
  printf '# fixture config, no mcp_servers table -- nothing for the drift check to spawn\n' \
    > "$CODEX_EXEC_HANG_CODEX_HOME/config.toml"

  CODEX_EXEC_HANG_START="$(date +%s)"
  CODEX_EXEC_HANG_OUTPUT="$(
    HOME="$CODEX_EXEC_HANG_HOME" CODEX_HOME="$CODEX_EXEC_HANG_CODEX_HOME" \
      PATH="$CODEX_EXEC_HANG_SHIM_DIR:$PATH" \
      OSO_CODEX_EXEC_SMOKE_BOUND_SECONDS=2 \
      bash "$REPO_ROOT/bootstrap/verify-codex.sh" 2>&1 || true
  )"
  CODEX_EXEC_HANG_ELAPSED=$(($(date +%s) - CODEX_EXEC_HANG_START))
  assert_equals "codex exec names itself when it never answers, instead of hanging the smoke" \
    "1" "$(printf '%s\n' "$CODEX_EXEC_HANG_OUTPUT" | \
      grep -Fxc 'FAIL: authenticated integrator smoke — expected integrated, got SLOW: codex exec smoke did not answer within 2s' || true)"
  if oso_nightly_only "the bounded codex exec smoke ends well inside a generous multiple of its own bound"; then
    assert_equals "the bounded codex exec smoke ends well inside a generous multiple of its own bound" \
      "bounded" "$([ "$CODEX_EXEC_HANG_ELAPSED" -le 30 ] && printf bounded || printf "unbounded:${CODEX_EXEC_HANG_ELAPSED}s")"
  fi
  if pgrep -f "$CODEX_EXEC_HANG_SHIM_DIR/codex" >/dev/null 2>&1; then
    echo "FAIL: the hanging codex exec fixture outlived the bounded check"; fail=$((fail + 1))
  else
    echo "ok: the hanging codex exec fixture does not outlive the bounded check"; pass=$((pass + 1))
  fi
fi

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: every purge fixture publishes a symlink — a Codex root link, a dangling agents link, a relative skills pointer — and ln-as-copy can express none of them, so no purge case has a tree to run against"
  skipped=$((skipped + 1))
else
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
    [ -d "$backup" ] || return 0
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
  CODEX_PURGE_FAILURE_BACKUP="$(find "$CODEX_PURGE_FAILURE_HOME/.local/state/oso-code/purge-backups" \
    -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -n 1)" \
    || CODEX_PURGE_FAILURE_BACKUP=""
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
  establish_premise "the completed purge published a backup directory to read back" \
    [ -d "$CODEX_PURGE_BACKUP" ]
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
  establish_premise "the published backup copies into the archive-tamper fixture" \
    cp -R "$CODEX_PURGE_BACKUP" "$CODEX_TAMPERED_PURGE_BACKUP"
  printf 'tamper\n' >> "$CODEX_TAMPERED_PURGE_BACKUP/codex-home.tar" || true
  run_codex_purge "$CODEX_PURGE_HOME" --restore "$CODEX_TAMPERED_PURGE_BACKUP"
  assert_equals "a modified purge archive is rejected by its published digest" \
    "nonzero" "$([ "$CODEX_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a corrupt restore writes neither Codex destination" \
    "absent" "$([ ! -e "$CODEX_PURGE_HOME/.codex" ] && [ ! -e "$CODEX_PURGE_HOME/.agents" ] && echo absent || echo present)"

  CODEX_TAMPERED_PURGE_METADATA="$TEST_HOME/codex-tampered-purge-metadata"
  establish_premise "the published backup copies into the metadata-tamper fixture" \
    cp -R "$CODEX_PURGE_BACKUP" "$CODEX_TAMPERED_PURGE_METADATA"
  printf 'absent\n' > "$CODEX_TAMPERED_PURGE_METADATA/codex-home.state" || true
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
fi

CODEX_REGEX_HOME="$TEST_HOME/codex-runtime-regex-home"
mkdir -p "$CODEX_REGEX_HOME/.codex"
CODEX_REGEX_RUNTIME_ROOT="$CODEX_REGEX_HOME/.local/share/oso-code/runtime"
CODEX_REGEX_WRONG_RUNTIME_ROOT="${CODEX_REGEX_RUNTIME_ROOT/.local/Xlocal}"
CODEX_REGEX_SHIMS="$TEST_HOME/codex-runtime-regex-shims"
write_host_contract_codex_shim "$CODEX_REGEX_SHIMS" no no "$HOST_CONTRACT_SUPPORTED_VERSION"

sed "s|__OSO_HOOKS_DIR__|$CODEX_REGEX_WRONG_RUNTIME_ROOT/dist|g" \
  "$REPO_ROOT/codex/hooks/hooks.json" > "$CODEX_REGEX_HOME/.codex/hooks.json"
CODEX_REGEX_WRONG_OUTPUT="$(
  HOME="$CODEX_REGEX_HOME" \
    CODEX_HOME="$CODEX_REGEX_HOME/.codex" \
    PATH="$CODEX_REGEX_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "a runtime manifest one metacharacter off its real path is reported, not verified" \
  "1" "$(printf '%s\n' "$CODEX_REGEX_WRONG_OUTPUT" | \
    grep -Ec '^FAIL: published runtime bytes .* got bad:.*codex/hooks/hooks\.json' || true)"

sed "s|__OSO_HOOKS_DIR__|$CODEX_REGEX_RUNTIME_ROOT/dist|g" \
  "$REPO_ROOT/codex/hooks/hooks.json" > "$CODEX_REGEX_HOME/.codex/hooks.json"
CODEX_REGEX_CORRECT_OUTPUT="$(
  HOME="$CODEX_REGEX_HOME" \
    CODEX_HOME="$CODEX_REGEX_HOME/.codex" \
    PATH="$CODEX_REGEX_SHIMS:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
)"
assert_equals "the real runtime path never false-negatives the manifest bytes check" \
  "0" "$(printf '%s\n' "$CODEX_REGEX_CORRECT_OUTPUT" | \
    grep -Ec '^FAIL: published runtime bytes .* got bad:.*codex/hooks/hooks\.json' || true)"

CODEX_PLUGIN_MANIFEST="$REPO_ROOT/codex/.codex-plugin/plugin.json"
CODEX_PLUGIN_VERSION="$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$CODEX_PLUGIN_MANIFEST" | head -n1)"

write_plugin_identity_codex_shim() {
  local shim_dir="$1" listing_json="$2"
  mkdir -p "$shim_dir"
  printf '%s\n' \
    '#!/bin/sh' \
    'case "$*" in' \
    "  --version) printf '%s\\n' 'codex-cli $HOST_CONTRACT_SUPPORTED_VERSION' ;;" \
    "  \"plugin list --json\") cat '$listing_json' ;;" \
    '  *) exit 1 ;;' \
    'esac' > "$shim_dir/codex"
  chmod +x "$shim_dir/codex"
}

run_plugin_identity_probe() {
  local fixture_home="$1" listing_json="$2" shim_dir
  shim_dir="$fixture_home/shims"
  mkdir -p "$fixture_home/.codex"
  write_plugin_identity_codex_shim "$shim_dir" "$listing_json"
  HOME="$fixture_home" \
    CODEX_HOME="$fixture_home/.codex" \
    PATH="$shim_dir:$PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$HOST_CONTRACT_VERIFY_SH" 2>&1 || true
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "skip: python3 is absent here, so the installed-plugin exact-match check has nothing to run"
  skipped=$((skipped + 1))
else
  PLUGIN_IDENTITY_CORRECT_HOME="$TEST_HOME/plugin-identity-correct-home"
  mkdir -p "$PLUGIN_IDENTITY_CORRECT_HOME"
  PLUGIN_IDENTITY_CORRECT_JSON="$TEST_HOME/plugin-identity-correct.json"
  printf '{"installed":[{"pluginId":"oso-code@oso-code","name":"oso-code","marketplaceName":"oso-code","version":"%s","installed":true,"enabled":true,"source":{"source":"local","path":"%s/.local/share/oso-code/codex-marketplace/codex"}}],"available":[]}\n' \
    "$CODEX_PLUGIN_VERSION" "$PLUGIN_IDENTITY_CORRECT_HOME" > "$PLUGIN_IDENTITY_CORRECT_JSON"
  PLUGIN_IDENTITY_CORRECT_OUTPUT="$(run_plugin_identity_probe "$PLUGIN_IDENTITY_CORRECT_HOME" "$PLUGIN_IDENTITY_CORRECT_JSON")"
  assert_equals "the exact-match plugin check accepts the real installed entry" \
    "1" "$(printf '%s\n' "$PLUGIN_IDENTITY_CORRECT_OUTPUT" | grep -Fxc 'ok:   oso-code plugin installed (installed)' || true)"

  PLUGIN_IDENTITY_WRONG_NAME_HOME="$TEST_HOME/plugin-identity-wrong-name-home"
  mkdir -p "$PLUGIN_IDENTITY_WRONG_NAME_HOME"
  PLUGIN_IDENTITY_WRONG_NAME_JSON="$TEST_HOME/plugin-identity-wrong-name.json"
  printf '{"installed":[{"pluginId":"not-oso-code@not-oso-code","name":"not-oso-code","marketplaceName":"not-oso-code","version":"%s","installed":true,"enabled":true,"source":{"source":"local","path":"%s/.local/share/oso-code/codex-marketplace/not-oso-code"}}],"available":[]}\n' \
    "$CODEX_PLUGIN_VERSION" "$PLUGIN_IDENTITY_WRONG_NAME_HOME" > "$PLUGIN_IDENTITY_WRONG_NAME_JSON"
  PLUGIN_IDENTITY_WRONG_NAME_OUTPUT="$(run_plugin_identity_probe "$PLUGIN_IDENTITY_WRONG_NAME_HOME" "$PLUGIN_IDENTITY_WRONG_NAME_JSON")"
  assert_equals "a substring-matching but differently-named plugin fails the exact-match check" \
    "1" "$(printf '%s\n' "$PLUGIN_IDENTITY_WRONG_NAME_OUTPUT" | \
      grep -Fxc 'FAIL: oso-code plugin installed — expected installed, got absent-or-invalid' || true)"

  PLUGIN_IDENTITY_BACKUP_SOURCE_HOME="$TEST_HOME/plugin-identity-backup-source-home"
  mkdir -p "$PLUGIN_IDENTITY_BACKUP_SOURCE_HOME"
  PLUGIN_IDENTITY_BACKUP_SOURCE_JSON="$TEST_HOME/plugin-identity-backup-source.json"
  printf '{"installed":[{"pluginId":"oso-code@oso-code","name":"oso-code","marketplaceName":"oso-code","version":"%s","installed":true,"enabled":true,"source":{"source":"local","path":"/tmp/oso-code-backup/codex"}}],"available":[]}\n' \
    "$CODEX_PLUGIN_VERSION" > "$PLUGIN_IDENTITY_BACKUP_SOURCE_JSON"
  PLUGIN_IDENTITY_BACKUP_SOURCE_OUTPUT="$(run_plugin_identity_probe "$PLUGIN_IDENTITY_BACKUP_SOURCE_HOME" "$PLUGIN_IDENTITY_BACKUP_SOURCE_JSON")"
  assert_equals "a plugin sourced from a backup-shaped path fails the exact-match check" \
    "1" "$(printf '%s\n' "$PLUGIN_IDENTITY_BACKUP_SOURCE_OUTPUT" | \
      grep -Fxc 'FAIL: oso-code plugin installed — expected installed, got absent-or-invalid' || true)"

  PLUGIN_IDENTITY_DISABLED_HOME="$TEST_HOME/plugin-identity-disabled-home"
  mkdir -p "$PLUGIN_IDENTITY_DISABLED_HOME"
  PLUGIN_IDENTITY_DISABLED_JSON="$TEST_HOME/plugin-identity-disabled.json"
  printf '{"installed":[{"pluginId":"oso-code@oso-code","name":"oso-code","marketplaceName":"oso-code","version":"%s","installed":true,"enabled":false,"source":{"source":"local","path":"%s/.local/share/oso-code/codex-marketplace/codex"}}],"available":[]}\n' \
    "$CODEX_PLUGIN_VERSION" "$PLUGIN_IDENTITY_DISABLED_HOME" > "$PLUGIN_IDENTITY_DISABLED_JSON"
  PLUGIN_IDENTITY_DISABLED_OUTPUT="$(run_plugin_identity_probe "$PLUGIN_IDENTITY_DISABLED_HOME" "$PLUGIN_IDENTITY_DISABLED_JSON")"
  assert_equals "a disabled plugin fails the exact-match check" \
    "1" "$(printf '%s\n' "$PLUGIN_IDENTITY_DISABLED_OUTPUT" | \
      grep -Fxc 'FAIL: oso-code plugin installed — expected installed, got absent-or-invalid' || true)"
fi

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

OPENCODE_INSTALLER="$REPO_ROOT/bootstrap/install-opencode.sh"
OPENCODE_PIN="$(sed -n 's/^SUPPORTED_OPENCODE_VERSION=//p' "$OPENCODE_INSTALLER" | head -1 || true)"
OPENCODE_VERSION_PIN_SHIM="$TEST_HOME/opencode-version-pin-shim"

write_opencode_version_pin_shim() {
  local version="$1"
  printf '%s\n' \
    '#!/bin/sh' \
    'case "$*" in' \
    "  --version) printf '$version\\n' ;;" \
    '  *) exit 64 ;;' \
    'esac' > "$OPENCODE_VERSION_PIN_SHIM"
  chmod +x "$OPENCODE_VERSION_PIN_SHIM"
}

opencode_pin_comparison_status() {
  local fixture_probe
  write_opencode_version_pin_shim "$OSO_PINNED_OPENCODE_VERSION"
  fixture_probe="$(opencode_version_of "$OPENCODE_VERSION_PIN_SHIM" 2>/dev/null || true)"
  [ "$OPENCODE_PIN" = "$fixture_probe" ] && printf match || printf mismatch
}

if [ -z "$OPENCODE_PIN" ]; then
  assert_equals "the opencode installer carries a version pin" "nonempty" "empty"
else
  OSO_PINNED_OPENCODE_VERSION="${OPENCODE_PIN}-fixture-drift"
  assert_equals "the pin comparison reports a fixture pinned to a different version as a mismatch" \
    mismatch "$(opencode_pin_comparison_status)"

  OSO_PINNED_OPENCODE_VERSION="$OPENCODE_PIN"
  assert_equals "the pin comparison reports a fixture pinned to the installer's own version as a match" \
    match "$(opencode_pin_comparison_status)"

  if oso_nightly_only "the opencode installer pin matches the installed binary"; then
    if command -v opencode >/dev/null 2>&1; then
      opencode_probe="$(opencode_version_of "$(command -v opencode)" 2>/dev/null || true)"
      assert_equals "the opencode installer pin matches the installed binary" "$OPENCODE_PIN" "$opencode_probe"
    else
      skipped=$((skipped + 1))
    fi
  fi
fi

OPENCODE_UNKNOWN_ALLOWLIST="$(node --experimental-strip-types --input-type=module -e '
const { openCodeRoutes } = await import(process.argv[1]);
const unknown = openCodeRoutes().find((route) => route.gate === "unknown");
process.stdout.write(unknown === undefined ? "" : unknown.allow.join("|"));
' "file://$REPO_ROOT/core/src/routes/render.ts" 2>/dev/null)"
if [ -z "$OPENCODE_UNKNOWN_ALLOWLIST" ]; then
  echo "FAIL: core/src/routes/render.ts named no opencode unknown-tool allowlist, so the catch-all cases proved nothing"
  fail=$((fail + 1))
else
  OPENCODE_CATCH_ALL_SESSION="opencode-catch-all-session"
  opencode_tool_input() {
    printf '{"command":"","session_id":"%s","cwd":"%s","tool_name":"%s"}' \
      "$OPENCODE_CATCH_ALL_SESSION" "$REPO_ROOT" "$1"
  }
  oso-state --session "$OPENCODE_CATCH_ALL_SESSION" clear
  oso-state --session "$OPENCODE_CATCH_ALL_SESSION" set mode=plan active_slice=1 verify_green=false
  for registered_plugin_tool in oso_wave oso_plan_approve oso_plan_cancel; do
    run_hook "$UNKNOWN_TOOL_HOOK" "$(opencode_tool_input "$registered_plugin_tool")" 0 '' \
      --allow "$OPENCODE_UNKNOWN_ALLOWLIST"
    assert_after_hook "the armed opencode catch-all admits the plugin-registered $registered_plugin_tool" \
      [ -z "$hook_stdout" ]
  done
  run_hook "$UNKNOWN_TOOL_HOOK" "$(opencode_tool_input oso_unregistered)" 0 '' \
    --allow "$OPENCODE_UNKNOWN_ALLOWLIST"
  assert_after_hook "a plugin tool the opencode route table never names stays denied" \
    hook_returned_deny
  OSO_HOST=opencode run_hook "$UNKNOWN_TOOL_HOOK" "$(opencode_tool_input oso_unregistered)" 0 '' \
    --allow "$OPENCODE_UNKNOWN_ALLOWLIST"
  assert_after_hook "the deny an opencode operator reads names this host's allowlist, never Codex's" \
    hook_deny_names_allowlist_host OpenCode
  oso-state --session "$OPENCODE_CATCH_ALL_SESSION" clear
fi

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: every opencode purge fixture publishes a symlink — a binary root link, a dangling gentle-ai link — and ln-as-copy can express none of them, so no purge case has a tree to run against"
  skipped=$((skipped + 1))
else
  PURGE_OPENCODE_SH="$REPO_ROOT/bootstrap/purge-opencode.sh"
  OPENCODE_PURGE_OUTPUT="$TEST_HOME/opencode-purge-output"
  OPENCODE_PURGE_CLIENT_CALLS="$TEST_HOME/opencode-purge-client-calls"
  OPENCODE_PURGE_SHIMS="$TEST_HOME/opencode-purge-shims"
  mkdir -p "$OPENCODE_PURGE_SHIMS"
  for purge_client in opencode npm bun; do
    printf '%s\n' \
      '#!/bin/sh' \
      'printf '\''%s:%s\n'\'' "$(basename "$0")" "$*" >> "$OSO_PURGE_CLIENT_CALLS"' \
      'exit 97' > "$OPENCODE_PURGE_SHIMS/$purge_client"
    chmod +x "$OPENCODE_PURGE_SHIMS/$purge_client"
  done

  write_opencode_purge_fixture() {
    local fixture_home="$1"
    mkdir -p \
      "$fixture_home/.config/opencode/plugins" \
      "$fixture_home/.local/share/opencode/repos/keep" \
      "$fixture_home/.cache/opencode/tool-output/keep" \
      "$fixture_home/.opencode/bin" \
      "$fixture_home/.gentle-ai" \
      "$fixture_home/.local/bin" \
      "$fixture_home/.claude" \
      "$fixture_home/.codex" \
      "$fixture_home/.agents" \
      "$fixture_home/.local/share/oso-code/runtime" \
      "$fixture_home/.local/state/oso-code/worktrees/keep" \
      "$fixture_home/repos/alpha" \
      "$fixture_home/repos/beta" \
      "$fixture_home/repos/gamma" \
      "$fixture_home/.cache/opencode/empty-dir"
    printf 'user opencode config\n' > "$fixture_home/.config/opencode/opencode.json"
    printf 'probe plugin\n' > "$fixture_home/.config/opencode/plugins/probe.ts"
    printf 'global agent\n' > "$fixture_home/.config/opencode/AGENTS.md"
    printf '\001\002sessions bytes\000\377' > "$fixture_home/.local/share/opencode/opencode.db"
    printf 'repos state survives\n' > "$fixture_home/.local/share/opencode/repos/keep/sentinel"
    printf 'tool output survives\n' > "$fixture_home/.cache/opencode/tool-output/keep/sentinel"
    printf 'opencode binary bytes\n' > "$fixture_home/.opencode/bin/opencode"
    chmod 755 "$fixture_home/.opencode/bin/opencode"
    printf 'gentle state\n' > "$fixture_home/.gentle-ai/state.json"
    printf 'gentle binary bytes\n' > "$fixture_home/.local/bin/gentle-ai"
    chmod 755 "$fixture_home/.local/bin/gentle-ai"
    printf 'claude survives\n' > "$fixture_home/.claude/sentinel"
    printf 'codex survives\n' > "$fixture_home/.codex/sentinel"
    printf 'agents survive\n' > "$fixture_home/.agents/sentinel"
    printf 'runtime survives\n' > "$fixture_home/.local/share/oso-code/runtime/sentinel"
    printf 'state survives\n' > "$fixture_home/.local/state/oso-code/worktrees/keep/sentinel"
    printf 'alpha config\n' > "$fixture_home/repos/alpha/opencode.json"
    printf 'beta config\n' > "$fixture_home/repos/beta/opencode.json"
    printf 'gamma config\n' > "$fixture_home/repos/gamma/opencode.json"
  }

  opencode_purge_project_configs() {
    local fixture_home="$1"
    printf '%s %s %s' \
      "$fixture_home/repos/alpha/opencode.json" \
      "$fixture_home/repos/beta/opencode.json" \
      "$fixture_home/repos/gamma/opencode.json"
  }

  purge_opencode_snapshot() {
    local fixture_home="$1" path rel permissions digest
    for path in "$fixture_home/.config/opencode" "$fixture_home/.local/share/opencode" \
      "$fixture_home/.cache/opencode" "$fixture_home/.opencode" \
      "$fixture_home/.gentle-ai" "$fixture_home/.local/bin"; do
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

  opencode_purge_backup_count() {
    local fixture_home="$1" backup_parent
    backup_parent="$fixture_home/.local/state/oso-code/purge-backups"
    [ -d "$backup_parent" ] || { printf '0'; return; }
    find "$backup_parent" -mindepth 1 -maxdepth 1 -type d -print | wc -l | tr -d ' '
  }

  run_opencode_purge() {
    local fixture_home="$1"
    shift
    : > "$OPENCODE_PURGE_CLIENT_CALLS"
    if HOME="$fixture_home" \
      PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
      XDG_CONFIG_HOME="$fixture_home/.config" \
      XDG_STATE_HOME="$fixture_home/.local/state" \
      XDG_CACHE_HOME="$fixture_home/.cache" \
      OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
      OSO_PURGE_FAIL_AFTER="${OSO_PURGE_FAIL_AFTER:-}" \
      OSO_OPENCODE_PROJECT_CONFIGS="$(opencode_purge_project_configs "$fixture_home")" \
      bash "$PURGE_OPENCODE_SH" "$@" > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
      OPENCODE_PURGE_RC=0
    else
      OPENCODE_PURGE_RC=$?
    fi
    OPENCODE_PURGE_LOG="$(cat "$OPENCODE_PURGE_OUTPUT")"
  }

  verify_opencode_purge_manifest() {
    local backup="$1"
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "$backup" && sha256sum -c manifest.sha256 >/dev/null 2>&1)
    else
      (cd "$backup" && shasum -a 256 -c manifest.sha256 >/dev/null 2>&1)
    fi
  }

  purge_opencode_backup_snapshot() {
    local backup="$1" path
    [ -d "$backup" ] || return 0
    find "$backup" -type f -print | LC_ALL=C sort | while IFS= read -r path; do
      printf '%s %s\n' "${path#$backup/}" "$(file_sha256 "$path")"
    done
  }

  purge_opencode_backup_location() {
    local backup="$1" fixture_home="$2"
    case "$backup" in
      "$fixture_home"/.local/state/oso-code/purge-backups/*) printf 'inside' ;;
      *) printf 'outside' ;;
    esac
  }

  OPENCODE_PURGE_DECLINE_HOME="$TEST_HOME/opencode-purge-decline-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_DECLINE_HOME"
  opencode_purge_decline_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_DECLINE_HOME")"
  printf '\n' > "$TEST_HOME/opencode-purge-decline-input"
  : > "$OPENCODE_PURGE_CLIENT_CALLS"
  if HOME="$OPENCODE_PURGE_DECLINE_HOME" \
    PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
    XDG_CONFIG_HOME="$OPENCODE_PURGE_DECLINE_HOME/.config" \
    XDG_STATE_HOME="$OPENCODE_PURGE_DECLINE_HOME/.local/state" \
    XDG_CACHE_HOME="$OPENCODE_PURGE_DECLINE_HOME/.cache" \
    OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
    OSO_OPENCODE_PROJECT_CONFIGS="$(opencode_purge_project_configs "$OPENCODE_PURGE_DECLINE_HOME")" \
    bash "$PURGE_OPENCODE_SH" < "$TEST_HOME/opencode-purge-decline-input" \
    > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
    opencode_purge_decline_rc=0
  else
    opencode_purge_decline_rc=$?
  fi
  assert_equals "the OpenCode purge defaults to no without explicit confirmation" \
    "nonzero" "$([ "$opencode_purge_decline_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "declining the OpenCode purge preserves every target exactly" \
    "$opencode_purge_decline_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_DECLINE_HOME")"
  assert_equals "declining the OpenCode purge creates no backup" \
    "0" "$(opencode_purge_backup_count "$OPENCODE_PURGE_DECLINE_HOME")"

  run_opencode_purge "$OPENCODE_PURGE_DECLINE_HOME" --unknown
  assert_equals "an unknown OpenCode purge flag is a usage error" \
    "2" "$OPENCODE_PURGE_RC"
  assert_equals "a usage error preserves every OpenCode target exactly" \
    "$opencode_purge_decline_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_DECLINE_HOME")"

  run_opencode_purge "$OPENCODE_PURGE_DECLINE_HOME" --dry-run
  assert_equals "a dry run succeeds without confirmation" "0" "$OPENCODE_PURGE_RC"
  assert_equals "a dry run creates no backup" \
    "0" "$(opencode_purge_backup_count "$OPENCODE_PURGE_DECLINE_HOME")"
  assert_equals "a dry run touches none of the purge targets" \
    "$opencode_purge_decline_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_DECLINE_HOME")"
  assert_equals "a dry run names the purge boundary before the wipe" \
    "1" "$(printf '%s\n' "$OPENCODE_PURGE_LOG" | grep -Fxc '[oso-code] dry run: nothing will be backed up or removed' || true)"
  assert_equals "a dry run names the three project-level configs it would report" \
    "3" "$(printf '%s\n' "$OPENCODE_PURGE_LOG" | grep -Fc "$OPENCODE_PURGE_DECLINE_HOME/repos" || true)"

  OPENCODE_PURGE_COUNT_HOME="$TEST_HOME/opencode-purge-count-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_COUNT_HOME"
  opencode_purge_count_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_COUNT_HOME")"
  : > "$OPENCODE_PURGE_CLIENT_CALLS"
  if HOME="$OPENCODE_PURGE_COUNT_HOME" \
    PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
    XDG_CONFIG_HOME="$OPENCODE_PURGE_COUNT_HOME/.config" \
    XDG_STATE_HOME="$OPENCODE_PURGE_COUNT_HOME/.local/state" \
    XDG_CACHE_HOME="$OPENCODE_PURGE_COUNT_HOME/.cache" \
    OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
    OSO_OPENCODE_PROJECT_CONFIGS="$OPENCODE_PURGE_COUNT_HOME/repos/alpha/opencode.json $OPENCODE_PURGE_COUNT_HOME/repos/beta/opencode.json" \
    bash "$PURGE_OPENCODE_SH" --yes > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
    opencode_purge_count_rc=0
  else
    opencode_purge_count_rc=$?
  fi
  assert_equals "the purge refuses a project-config list that is not exactly three" \
    "2" "$opencode_purge_count_rc"
  assert_equals "a project-config count refusal preserves every target exactly" \
    "$opencode_purge_count_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_COUNT_HOME")"

  OPENCODE_PURGE_XDG_HOME="$TEST_HOME/opencode-purge-xdg-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_XDG_HOME"
  if HOME="$OPENCODE_PURGE_XDG_HOME" \
    PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
    XDG_CONFIG_HOME="$TEST_HOME/elsewhere" \
    XDG_STATE_HOME="$OPENCODE_PURGE_XDG_HOME/.local/state" \
    XDG_CACHE_HOME="$OPENCODE_PURGE_XDG_HOME/.cache" \
    OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
    OSO_OPENCODE_PROJECT_CONFIGS="$(opencode_purge_project_configs "$OPENCODE_PURGE_XDG_HOME")" \
    bash "$PURGE_OPENCODE_SH" --dry-run > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
    opencode_purge_xdg_rc=0
  else
    opencode_purge_xdg_rc=$?
  fi
  assert_equals "a non-default XDG config home is refused fail-closed" \
    "2" "$opencode_purge_xdg_rc"
  assert_equals "an XDG refusal names the customized home in its error" \
    "1" "$(grep -c "XDG_CONFIG_HOME is not the default" "$OPENCODE_PURGE_OUTPUT")"
  assert_equals "an XDG refusal wipes nothing" \
    "present" "$([ -e "$OPENCODE_PURGE_XDG_HOME/.config/opencode" ] && echo present || echo absent)"

  OPENCODE_PURGE_MISSING_HOME="$TEST_HOME/opencode-purge-missing-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_MISSING_HOME"
  opencode_purge_missing_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_MISSING_HOME")"
  : > "$OPENCODE_PURGE_CLIENT_CALLS"
  if HOME="$OPENCODE_PURGE_MISSING_HOME" \
    PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
    XDG_CONFIG_HOME="$OPENCODE_PURGE_MISSING_HOME/.config" \
    XDG_STATE_HOME="$OPENCODE_PURGE_MISSING_HOME/.local/state" \
    XDG_CACHE_HOME="$OPENCODE_PURGE_MISSING_HOME/.cache" \
    OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
    OSO_OPENCODE_PROJECT_CONFIGS="$OPENCODE_PURGE_MISSING_HOME/repos/alpha/opencode.json $OPENCODE_PURGE_MISSING_HOME/repos/beta/opencode.json $OPENCODE_PURGE_MISSING_HOME/repos/absent/opencode.json" \
    bash "$PURGE_OPENCODE_SH" --yes > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
    opencode_purge_missing_rc=0
  else
    opencode_purge_missing_rc=$?
  fi
  assert_equals "a missing project-level config aborts the purge before any backup" \
    "nonzero" "$([ "$opencode_purge_missing_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a missing project-level config creates no backup" \
    "0" "$(opencode_purge_backup_count "$OPENCODE_PURGE_MISSING_HOME")"
  assert_equals "a missing project-level config leaves every target exactly intact" \
    "$opencode_purge_missing_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_MISSING_HOME")"

  OPENCODE_PURGE_INSIDE_HOME="$TEST_HOME/opencode-purge-inside-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_INSIDE_HOME"
  opencode_purge_inside_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_INSIDE_HOME")"
  : > "$OPENCODE_PURGE_CLIENT_CALLS"
  if HOME="$OPENCODE_PURGE_INSIDE_HOME" \
    PATH="$OPENCODE_PURGE_SHIMS:$PATH" \
    XDG_CONFIG_HOME="$OPENCODE_PURGE_INSIDE_HOME/.config" \
    XDG_STATE_HOME="$OPENCODE_PURGE_INSIDE_HOME/.local/state" \
    XDG_CACHE_HOME="$OPENCODE_PURGE_INSIDE_HOME/.cache" \
    OSO_PURGE_CLIENT_CALLS="$OPENCODE_PURGE_CLIENT_CALLS" \
    OSO_OPENCODE_PROJECT_CONFIGS="$OPENCODE_PURGE_INSIDE_HOME/repos/alpha/opencode.json $OPENCODE_PURGE_INSIDE_HOME/repos/beta/opencode.json $OPENCODE_PURGE_INSIDE_HOME/.config/opencode/opencode.json" \
    bash "$PURGE_OPENCODE_SH" --yes > "$OPENCODE_PURGE_OUTPUT" 2>&1; then
    opencode_purge_inside_rc=0
  else
    opencode_purge_inside_rc=$?
  fi
  assert_equals "a project-level config inside a purge target is refused" \
    "nonzero" "$([ "$opencode_purge_inside_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a config-inside-target refusal wipes nothing" \
    "$opencode_purge_inside_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_INSIDE_HOME")"

  OPENCODE_PURGE_FAILURE_HOME="$TEST_HOME/opencode-purge-failure-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_FAILURE_HOME"
  opencode_purge_failure_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_FAILURE_HOME")"
  OSO_PURGE_FAIL_AFTER=after-backup run_opencode_purge "$OPENCODE_PURGE_FAILURE_HOME" --yes
  assert_equals "a deterministic failure after backup exits before deletion" \
    "nonzero" "$([ "$OPENCODE_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a verified-backup failure leaves every source tree exactly intact" \
    "$opencode_purge_failure_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_FAILURE_HOME")"
  assert_equals "the pre-delete failure retains exactly one diagnostic backup" \
    "1" "$(opencode_purge_backup_count "$OPENCODE_PURGE_FAILURE_HOME")"
  OPENCODE_PURGE_FAILURE_BACKUP="$(find "$OPENCODE_PURGE_FAILURE_HOME/.local/state/oso-code/purge-backups" \
    -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -n 1)" \
    || OPENCODE_PURGE_FAILURE_BACKUP=""
  assert_equals "the retained pre-delete backup still passes its manifest" \
    "valid" "$(verify_opencode_purge_manifest "$OPENCODE_PURGE_FAILURE_BACKUP" && echo valid || echo invalid)"

  OPENCODE_PURGE_HOME="$TEST_HOME/opencode-purge-home"
  write_opencode_purge_fixture "$OPENCODE_PURGE_HOME"
  opencode_purge_before="$(purge_opencode_snapshot "$OPENCODE_PURGE_HOME")"
  run_opencode_purge "$OPENCODE_PURGE_HOME" --yes
  opencode_purge_outcome="$OPENCODE_PURGE_RC"
  if [ "$OPENCODE_PURGE_RC" -ne 0 ]; then
    opencode_purge_outcome="$OPENCODE_PURGE_RC ($OPENCODE_PURGE_LOG)"
  fi
  assert_equals "the fixture-only OpenCode purge completes" "0" "$opencode_purge_outcome"
  OPENCODE_PURGE_BACKUP="$(printf '%s\n' "$OPENCODE_PURGE_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
  establish_premise "the completed purge published a backup directory to read back" \
    [ -d "$OPENCODE_PURGE_BACKUP" ]
  assert_equals "the purge reports one absolute backup inside the fixture HOME" \
    "inside" "$(purge_opencode_backup_location "$OPENCODE_PURGE_BACKUP" "$OPENCODE_PURGE_HOME")"
  assert_equals "the purge backup root has mode 0700" \
    "0700" "$([ -d "$OPENCODE_PURGE_BACKUP" ] && find "$OPENCODE_PURGE_BACKUP" -maxdepth 0 -type d -perm 0700 -print | grep -q . && echo 0700 || echo wrong)"

  missing_opencode_purge_file=""
  for purge_backup_file in \
    format \
    config-home.target config-home.state config-home.tar \
    state-home.target state-home.state state-home.tar \
    cache-home.target cache-home.state cache-home.tar \
    bin.target bin.state bin.tar \
    gentle-ai-home.target gentle-ai-home.state gentle-ai-home.tar \
    gentle-ai-bin.target gentle-ai-bin.state gentle-ai-bin.tar \
    manifest.sha256; do
    [ -f "$OPENCODE_PURGE_BACKUP/$purge_backup_file" ] \
      || missing_opencode_purge_file="$missing_opencode_purge_file $purge_backup_file"
  done
  assert_equals "the purge publishes its complete restorable backup contract" \
    "" "$missing_opencode_purge_file"
  assert_equals "the published purge manifest verifies every recorded payload" \
    "valid" "$(verify_opencode_purge_manifest "$OPENCODE_PURGE_BACKUP" && echo valid || echo invalid)"
  assert_equals "the purge records the exact config destination" \
    "$OPENCODE_PURGE_HOME/.config/opencode" "$(cat "$OPENCODE_PURGE_BACKUP/config-home.target")"
  assert_equals "the purge records the exact state destination" \
    "$OPENCODE_PURGE_HOME/.local/share/opencode" "$(cat "$OPENCODE_PURGE_BACKUP/state-home.target")"
  assert_equals "the purge records the exact binary destination" \
    "$OPENCODE_PURGE_HOME/.opencode/bin/opencode" "$(cat "$OPENCODE_PURGE_BACKUP/bin.target")"

  assert_equals "the wipe removes the user-level config tree" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.config/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.config/opencode" ] && echo absent || echo present)"
  assert_equals "the wipe removes the sessions state tree" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && echo absent || echo present)"
  assert_equals "the wipe removes the cache tree" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.cache/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.cache/opencode" ] && echo absent || echo present)"
  assert_equals "the wipe removes the installed binary" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.opencode/bin/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.opencode/bin/opencode" ] && echo absent || echo present)"
  assert_equals "the purge removes the gentle-ai homes" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.gentle-ai" ] && [ ! -e "$OPENCODE_PURGE_HOME/.local/bin/gentle-ai" ] && echo absent || echo present)"

  assert_equals "the purge preserves Claude state outside its boundary" \
    "claude survives" "$(cat "$OPENCODE_PURGE_HOME/.claude/sentinel")"
  assert_equals "the purge preserves Codex state outside its boundary" \
    "codex survives" "$(cat "$OPENCODE_PURGE_HOME/.codex/sentinel")"
  assert_equals "the purge preserves the shared agents home outside its boundary" \
    "agents survive" "$(cat "$OPENCODE_PURGE_HOME/.agents/sentinel")"
  assert_equals "the purge preserves the installed oso runtime outside its boundary" \
    "runtime survives" "$(cat "$OPENCODE_PURGE_HOME/.local/share/oso-code/runtime/sentinel")"
  assert_equals "the purge preserves oso worktree state outside its boundary" \
    "state survives" "$(cat "$OPENCODE_PURGE_HOME/.local/state/oso-code/worktrees/keep/sentinel")"

  assert_equals "the purge reports three project-level opencode.json files INTACT" \
    "3" "$(printf '%s\n' "$OPENCODE_PURGE_LOG" | grep -Fc '[oso-code] project-level opencode.json INTACT:' || true)"
  for opencode_project_config in \
    "$OPENCODE_PURGE_HOME/repos/alpha/opencode.json" \
    "$OPENCODE_PURGE_HOME/repos/beta/opencode.json" \
    "$OPENCODE_PURGE_HOME/repos/gamma/opencode.json"; do
    case "$OPENCODE_PURGE_LOG" in
      *"project-level opencode.json INTACT: $opencode_project_config"*)
        echo "ok: the purge reports $opencode_project_config intact"; pass=$((pass + 1)) ;;
      *)
        echo "FAIL: the purge never reported $opencode_project_config intact"; fail=$((fail + 1)) ;;
    esac
    case "$(cat "$opencode_project_config")" in
      *config) echo "ok: $opencode_project_config keeps its own bytes"; pass=$((pass + 1)) ;;
      *) echo "FAIL: $opencode_project_config lost its content"; fail=$((fail + 1)) ;;
    esac
  done
  assert_equals "the purge never invokes opencode, npm, bun or login" \
    "0" "$(wc -l < "$OPENCODE_PURGE_CLIENT_CALLS" | tr -d ' ')"

  opencode_purge_backup_count_before="$(opencode_purge_backup_count "$OPENCODE_PURGE_HOME")"
  run_opencode_purge "$OPENCODE_PURGE_HOME" --yes
  assert_equals "purging an already empty OpenCode install is idempotent" "0" "$OPENCODE_PURGE_RC"
  assert_equals "an empty idempotent purge creates no redundant backup" \
    "$opencode_purge_backup_count_before" "$(opencode_purge_backup_count "$OPENCODE_PURGE_HOME")"

  OPENCODE_KEEP_GENTLE_HOME="$TEST_HOME/opencode-purge-keep-gentle-home"
  write_opencode_purge_fixture "$OPENCODE_KEEP_GENTLE_HOME"
  run_opencode_purge "$OPENCODE_KEEP_GENTLE_HOME" --yes --keep-gentle-ai
  assert_equals "a kept-gentle-ai purge completes" "0" "$OPENCODE_PURGE_RC"
  assert_equals "a kept-gentle-ai purge still removes the user-level OpenCode install" \
    "absent" "$([ ! -e "$OPENCODE_KEEP_GENTLE_HOME/.config/opencode" ] && echo absent || echo present)"
  assert_equals "a kept-gentle-ai purge leaves the gentle-ai homes standing" \
    "gentle state" "$(cat "$OPENCODE_KEEP_GENTLE_HOME/.gentle-ai/state.json")"
  assert_equals "a kept-gentle-ai purge leaves the gentle-ai binary standing" \
    "gentle binary bytes" "$(cat "$OPENCODE_KEEP_GENTLE_HOME/.local/bin/gentle-ai")"
  OPENCODE_KEEP_GENTLE_BACKUP="$(printf '%s\n' "$OPENCODE_PURGE_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
  assert_equals "a kept-gentle-ai backup records no gentle-ai target" \
    "absent" "$([ ! -e "$OPENCODE_KEEP_GENTLE_BACKUP/gentle-ai-home.target" ] && echo absent || echo present)"

  run_opencode_purge "$OPENCODE_KEEP_GENTLE_HOME" --restore "$OPENCODE_KEEP_GENTLE_BACKUP"
  assert_equals "restoring a kept-gentle-ai backup completes" "0" "$OPENCODE_PURGE_RC"
  assert_equals "a kept-gentle-ai backup restores the user-level OpenCode install" \
    "user opencode config" "$(cat "$OPENCODE_KEEP_GENTLE_HOME/.config/opencode/opencode.json")"
  assert_equals "a kept-gentle-ai backup restore leaves the kept gentle-ai state standing" \
    "gentle state" "$(cat "$OPENCODE_KEEP_GENTLE_HOME/.gentle-ai/state.json")"

  OPENCODE_TAMPERED_PURGE_BACKUP="$TEST_HOME/opencode-tampered-purge-backup"
  establish_premise "the published backup copies into the archive-tamper fixture" \
    cp -R "$OPENCODE_PURGE_BACKUP" "$OPENCODE_TAMPERED_PURGE_BACKUP"
  printf 'tamper\n' >> "$OPENCODE_TAMPERED_PURGE_BACKUP/config-home.tar" || true
  run_opencode_purge "$OPENCODE_PURGE_HOME" --restore "$OPENCODE_TAMPERED_PURGE_BACKUP"
  assert_equals "a modified OpenCode purge archive is rejected by its published digest" \
    "nonzero" "$([ "$OPENCODE_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a corrupt restore writes no OpenCode destination" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.config/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && echo absent || echo present)"

  OPENCODE_TAMPERED_PURGE_METADATA="$TEST_HOME/opencode-tampered-purge-metadata"
  establish_premise "the published backup copies into the metadata-tamper fixture" \
    cp -R "$OPENCODE_PURGE_BACKUP" "$OPENCODE_TAMPERED_PURGE_METADATA"
  printf 'absent\n' > "$OPENCODE_TAMPERED_PURGE_METADATA/config-home.state" || true
  run_opencode_purge "$OPENCODE_PURGE_HOME" --restore "$OPENCODE_TAMPERED_PURGE_METADATA"
  assert_equals "modified OpenCode purge metadata is rejected by its published digest" \
    "nonzero" "$([ "$OPENCODE_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "corrupt absence metadata cannot silently omit an OpenCode restore" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.config/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && echo absent || echo present)"

  OSO_PURGE_FAIL_AFTER=after-config-home-restore run_opencode_purge \
    "$OPENCODE_PURGE_HOME" --restore "$OPENCODE_PURGE_BACKUP"
  assert_equals "a failure after publishing the first restore target exits nonzero" \
    "nonzero" "$([ "$OPENCODE_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a partial restore failure rolls every destination back to absent" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_HOME/.config/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.config/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && [ ! -L "$OPENCODE_PURGE_HOME/.local/share/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.cache/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.opencode/bin/opencode" ] && [ ! -e "$OPENCODE_PURGE_HOME/.gentle-ai" ] && echo absent || echo present)"

  purge_opencode_backup_before_restore="$(purge_opencode_backup_snapshot "$OPENCODE_PURGE_BACKUP")"
  run_opencode_purge "$OPENCODE_PURGE_HOME" --restore "$OPENCODE_PURGE_BACKUP"
  opencode_restore_outcome="$OPENCODE_PURGE_RC"
  if [ "$OPENCODE_PURGE_RC" -ne 0 ]; then
    opencode_restore_outcome="$OPENCODE_PURGE_RC ($OPENCODE_PURGE_LOG)"
  fi
  assert_equals "the verified OpenCode purge backup restores successfully" "0" "$opencode_restore_outcome"
  assert_equals "restore reproduces bytes, links, empty directories and modes" \
    "$opencode_purge_before" "$(purge_opencode_snapshot "$OPENCODE_PURGE_HOME")"
  purge_opencode_backup_after_restore="$(purge_opencode_backup_snapshot "$OPENCODE_PURGE_BACKUP")"
  assert_equals "a successful restore retains the verified backup unchanged" \
    "$purge_opencode_backup_before_restore" "$purge_opencode_backup_after_restore"
  assert_equals "a successful restore leaves the three project-level configs intact" \
    "alpha config
beta config
gamma config" "$(cat "$OPENCODE_PURGE_HOME/repos/alpha/opencode.json"
    cat "$OPENCODE_PURGE_HOME/repos/beta/opencode.json"
    cat "$OPENCODE_PURGE_HOME/repos/gamma/opencode.json")"

  opencode_restored_before_conflict="$(purge_opencode_snapshot "$OPENCODE_PURGE_HOME")"
  run_opencode_purge "$OPENCODE_PURGE_HOME" --restore "$OPENCODE_PURGE_BACKUP"
  assert_equals "restore refuses to merge over existing OpenCode destinations" \
    "nonzero" "$([ "$OPENCODE_PURGE_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a restore conflict leaves every existing tree exactly intact" \
    "$opencode_restored_before_conflict" "$(purge_opencode_snapshot "$OPENCODE_PURGE_HOME")"
  assert_equals "a restore conflict leaves the backup manifest valid" \
    "valid" "$(verify_opencode_purge_manifest "$OPENCODE_PURGE_BACKUP" && echo valid || echo invalid)"

  OPENCODE_PURGE_SYMLINK_HOME="$TEST_HOME/opencode-purge-symlink-home"
  mkdir -p "$OPENCODE_PURGE_SYMLINK_HOME/external-bin" \
    "$OPENCODE_PURGE_SYMLINK_HOME/.opencode/bin" \
    "$OPENCODE_PURGE_SYMLINK_HOME/repos/alpha" \
    "$OPENCODE_PURGE_SYMLINK_HOME/repos/beta" \
    "$OPENCODE_PURGE_SYMLINK_HOME/repos/gamma"
  printf 'external target survives\n' > "$OPENCODE_PURGE_SYMLINK_HOME/external-bin/opencode"
  ln -s ../../external-bin/opencode "$OPENCODE_PURGE_SYMLINK_HOME/.opencode/bin/opencode"
  printf 'alpha config\n' > "$OPENCODE_PURGE_SYMLINK_HOME/repos/alpha/opencode.json"
  printf 'beta config\n' > "$OPENCODE_PURGE_SYMLINK_HOME/repos/beta/opencode.json"
  printf 'gamma config\n' > "$OPENCODE_PURGE_SYMLINK_HOME/repos/gamma/opencode.json"
  run_opencode_purge "$OPENCODE_PURGE_SYMLINK_HOME" --yes
  OPENCODE_PURGE_SYMLINK_BACKUP="$(printf '%s\n' "$OPENCODE_PURGE_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
  assert_equals "the total purge removes a symlinked binary without following it" \
    "absent" "$([ ! -e "$OPENCODE_PURGE_SYMLINK_HOME/.opencode/bin/opencode" ] && [ ! -L "$OPENCODE_PURGE_SYMLINK_HOME/.opencode/bin/opencode" ] && echo absent || echo present)"
  assert_equals "purging a binary link preserves its external destination" \
    "external target survives" "$(cat "$OPENCODE_PURGE_SYMLINK_HOME/external-bin/opencode")"
  assert_equals "the backup records a symlinked binary without dereferencing it" \
    "symlink" "$(cat "$OPENCODE_PURGE_SYMLINK_BACKUP/bin.state")"
  run_opencode_purge "$OPENCODE_PURGE_SYMLINK_HOME" --restore "$OPENCODE_PURGE_SYMLINK_BACKUP"
  assert_equals "restore recreates the exact binary root link" \
    "../../external-bin/opencode" "$(readlink "$OPENCODE_PURGE_SYMLINK_HOME/.opencode/bin/opencode")"
  assert_equals "binary-link restore still leaves the external destination unchanged" \
    "external target survives" "$(cat "$OPENCODE_PURGE_SYMLINK_HOME/external-bin/opencode")"
fi

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: the opencode installer fixtures publish real file trees and a local git tag; the emulated Windows bash runs the rest of the suite"
  skipped=$((skipped + 1))
else
  INSTALL_OPENCODE_SH="$REPO_ROOT/bootstrap/install-opencode.sh"
  OPENCODE_INSTALL_SHIMS="$TEST_HOME/opencode-install-shims"
  OPENCODE_INSTALL_CALLS="$TEST_HOME/opencode-install-calls"
  OPENCODE_INSTALL_OUTPUT="$TEST_HOME/opencode-install-output"
  OPENCODE_IMPECCABLE_REMOTE="$TEST_HOME/opencode-install-impeccable-remote"
  OPENCODE_IMPECCABLE_MISTAGED="$TEST_HOME/opencode-install-impeccable-mistagged"
  OPENCODE_OPERATOR_GLOBAL='operator global guidance'
  OPENCODE_GLOBAL_MARKER_START='<!-- oso-code:start -->'
  OPENCODE_GLOBAL_MARKER_END='<!-- oso-code:end -->'
  OPENCODE_GIT_PRESENT=false
  command -v git >/dev/null 2>&1 && OPENCODE_GIT_PRESENT=true
  mkdir -p "$OPENCODE_INSTALL_SHIMS"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''opencode:%s\n'\'' "$*" >> "$OSO_OPENCODE_INSTALL_CALLS"' \
    'case "$*" in' \
    "  --version) printf '$OPENCODE_PIN\\n' ;;" \
    '  *) printf '\''unexpected opencode call: %s\n'\'' "$*" >&2; exit 64 ;;' \
    'esac' > "$OPENCODE_INSTALL_SHIMS/opencode"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''engram:%s\n'\'' "$*" >> "$OSO_OPENCODE_INSTALL_CALLS"' \
    'case "$*" in' \
    '  "setup --help") printf '\''usage: engram setup [<agent>] (claude-code, opencode, codex, ...)\n'\''; exit 0 ;;' \
    '  "setup opencode")' \
    '    [ "${OSO_TEST_ENGRAM_FAIL:-}" != 1 ] || { printf '\''engram setup opencode failed\n'\'' >&2; exit 70; }' \
    '    mkdir -p "$HOME/.config/opencode/plugins"' \
    '    printf '\''fixture engram plugin\n'\'' > "$HOME/.config/opencode/plugins/engram.ts"' \
    '    exit 0 ;;' \
    '  *) printf '\''unexpected engram call: %s\n'\'' "$*" >&2; exit 64 ;;' \
    'esac' > "$OPENCODE_INSTALL_SHIMS/engram"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf '\''fallow-mcp:%s\n'\'' "$*" >> "$OSO_OPENCODE_INSTALL_CALLS"' \
    'exit 0' > "$OPENCODE_INSTALL_SHIMS/fallow-mcp"
  chmod +x "$OPENCODE_INSTALL_SHIMS/opencode" "$OPENCODE_INSTALL_SHIMS/engram" \
    "$OPENCODE_INSTALL_SHIMS/fallow-mcp"

  write_opencode_install_fixture() {
    local fixture_home="$1"
    mkdir -p \
      "$fixture_home/.config/opencode/plugins" \
      "$fixture_home/.config/opencode/skills/op-skill" \
      "$fixture_home/.config/opencode/plugin" \
      "$fixture_home/.local/state/oso-code/worktrees/keep" \
      "$fixture_home/repos/alpha" \
      "$fixture_home/repos/beta" \
      "$fixture_home/repos/gamma"
    cat > "$fixture_home/.config/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "fixture-provider": {
      "name": "Fixture",
      "npm": "@fixture/provider"
    }
  },
  "model": "fixture/provider-model",
  "small_model": "fixture/small-model",
  "theme": "fixture-theme",
  "agent": {
    "fixture-agent": {
      "description": "operator agent the installer must leave alone"
    }
  },
  "permission": {
    "bash": {
      "*": "allow",
      "git push *": "ask"
    },
    "read": {
      "*": "allow",
      "**/.env": "deny"
    }
  },
  "mcp": {
    "operator-mcp": {
      "type": "local",
      "command": ["operator-mcp-bin"],
      "enabled": true
    },
    "context7": {
      "type": "remote",
      "url": "https://fixture.example.test/mcp",
      "enabled": true
    }
  }
}
JSON
    printf '%s\n' "$OPENCODE_OPERATOR_GLOBAL" > "$fixture_home/.config/opencode/AGENTS.md"
    printf 'operator engram plugin\n' > "$fixture_home/.config/opencode/plugins/engram.ts"
    printf 'operator plugin survives\n' > "$fixture_home/.config/opencode/plugins/clean-code-gate.ts"
    printf 'operator skill survives\n' > "$fixture_home/.config/opencode/skills/op-skill/SKILL.md"
    printf 'stale installer plugin\n' > "$fixture_home/.config/opencode/plugin/stale.ts"
    printf 'operator registry\n' > "$fixture_home/.local/state/oso-code/opencode-install-registry"
    printf 'worktree state survives\n' > "$fixture_home/.local/state/oso-code/worktrees/keep/sentinel"
    printf 'alpha config\n' > "$fixture_home/repos/alpha/opencode.json"
    printf 'beta config\n' > "$fixture_home/repos/beta/opencode.json"
    printf 'gamma config\n' > "$fixture_home/repos/gamma/opencode.json"
  }

  write_opencode_install_impeccable_repo() {
    local dir="$1" version="${2:-4.0.2}" tag_version="${3:-$version}"
    mkdir -p "$dir/.agents/skills/impeccable/reference"
    printf '%s\n' '---' "name: impeccable" "version: $version" '---' \
      'installed-root: .agents/skills/impeccable' \
      'usage: $impeccable init | $impeccable document | $impeccable audit <target>' \
      'references: reference/init.md reference/document.md reference/audit.md' \
      > "$dir/.agents/skills/impeccable/SKILL.md"
    printf 'init reference\n' > "$dir/.agents/skills/impeccable/reference/init.md"
    printf 'document reference\n' > "$dir/.agents/skills/impeccable/reference/document.md"
    printf 'audit reference\n' > "$dir/.agents/skills/impeccable/reference/audit.md"
    git -C "$dir" init -q
    git -C "$dir" -c user.email=fixture@test -c user.name=fixture add -A
    git -C "$dir" -c user.email=fixture@test -c user.name=fixture commit -qm impeccable
    git -C "$dir" tag "skill-v$tag_version"
  }

  opencode_install_impeccable_source() {
    local fixture_home="$1" version="${2:-4.0.2}"
    local source="$fixture_home/impeccable-source"
    mkdir -p "$source/reference"
    printf '%s\n' '---' "name: impeccable" "version: $version" '---' \
      'installed-root: .agents/skills/impeccable' \
      'usage: $impeccable init | $impeccable document | $impeccable audit <target>' \
      'references: reference/init.md reference/document.md reference/audit.md' \
      > "$source/SKILL.md"
    printf 'init reference\n' > "$source/reference/init.md"
    printf 'document reference\n' > "$source/reference/document.md"
    printf 'audit reference\n' > "$source/reference/audit.md"
    printf '%s' "$source"
  }

  opencode_install_config_value() {
    local fixture_home="$1" query="$2"
    python3 - "$fixture_home/.config/opencode/opencode.json" "$query" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
node = data
for part in sys.argv[2].split("."):
    if not isinstance(node, dict) or part not in node:
        node = None
        break
    node = node[part]
if node is None:
    print("<absent>")
elif isinstance(node, (dict, list)):
    print(json.dumps(node, sort_keys=True))
else:
    print(node)
PY
  }

  opencode_install_sources_identical() {
    local fixture_home="$1" wrapper rel
    for wrapper in "$REPO_ROOT"/opencode/skills/oso-*/SKILL.md; do
      [ -f "$wrapper" ] || continue
      rel="${wrapper#$REPO_ROOT/}"
      cmp -s "$wrapper" "$fixture_home/.config/opencode/skill/${rel#opencode/skills/}" \
        || { printf 'differs'; return 0; }
    done
    printf 'identical'
  }

  opencode_install_gate_scripts_identical() {
    local fixture_home="$1" installed
    for installed in "$fixture_home"/.config/opencode/hooks/*.sh; do
      [ -f "$installed" ] || continue
      cmp -s "$REPO_ROOT/plugin/hooks/${installed##*/}" "$installed" \
        || { printf 'differs'; return 0; }
    done
    printf 'identical'
  }

  opencode_install_unpublished_gate_scripts() {
    local fixture_home="$1" installed unpublished=""
    for installed in "$fixture_home"/.config/opencode/hooks/*.sh; do
      [ -f "$installed" ] || continue
      grep -q "  plugin/hooks/${installed##*/}\$" "$REPO_ROOT/bootstrap/hook-hashes.txt" ||
        unpublished="$unpublished ${installed##*/}"
    done
    printf '%s' "${unpublished# }"
  }

  opencode_install_state_bin_identical() {
    local fixture_home="$1"
    cmp -s "$REPO_ROOT/plugin/bin/oso-state" "$fixture_home/.config/opencode/bin/oso-state" \
      && printf 'identical' || printf 'differs'
  }

  opencode_install_global_merged_identical() {
    local fixture_home="$1" expected="$TEST_HOME/opencode-install-global-expected"
    {
      printf '%s\n' "$OPENCODE_OPERATOR_GLOBAL"
      printf '\n'
      printf '%s\n' "$OPENCODE_GLOBAL_MARKER_START"
      cat "$REPO_ROOT/bootstrap/opencode-global.md"
      printf '%s\n' "$OPENCODE_GLOBAL_MARKER_END"
    } > "$expected"
    cmp -s "$expected" "$fixture_home/.config/opencode/AGENTS.md" \
      && printf 'identical' || printf 'differs'
  }

  opencode_install_global_marker_pairs() {
    local global="$1/.config/opencode/AGENTS.md"
    printf '%s %s' \
      "$(grep -Fxc "$OPENCODE_GLOBAL_MARKER_START" "$global" || true)" \
      "$(grep -Fxc "$OPENCODE_GLOBAL_MARKER_END" "$global" || true)"
  }

  opencode_installed_bundle_commit_verdict() {
    local fixture_home="$1" arming="${2:-armed}"
    local bundle="$fixture_home/.config/opencode/plugin/oso-code.js"
    local probe_home probe_repo verdict

    if [ ! -f "$bundle" ]; then
      printf 'the installer wrote no plugin bundle'
      return 0
    fi

    probe_home="$(mktemp -d "${TMPDIR:-/tmp}/oso-installed-bundle.XXXXXX")"
    probe_repo="$probe_home/repo"
    mkdir -p "$probe_repo"
    git -C "$probe_repo" init -q >/dev/null 2>&1 || { rm -rf "$probe_home"; printf 'git could not seed the probe repository'; return 0; }
    if [ "$arming" = armed ]; then
      ( cd "$probe_repo" && OSO_STATE_DIR="$probe_home/state" \
          node "$REPO_ROOT/plugin/bin/oso-state" --session installed-bundle-probe \
            set mode=plan active_slice=4 verify_green=false ) >/dev/null 2>&1 \
        || { rm -rf "$probe_home"; printf 'the probe could not arm the state file'; return 0; }
    fi

    verdict="$(OSO_STATE_DIR="$probe_home/state" node --input-type=module -e '
const { osoCode } = await import(process.argv[1]);
const hooks = await osoCode({ directory: process.argv[2] });
try {
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "installed-bundle-probe", cwd: process.argv[2] },
    { args: { command: "git commit -m probe" } },
  );
  process.stdout.write("allowed");
} catch (error) {
  process.stdout.write(/oso-code: the session verify is not green/.test(error.message)
    ? "denied"
    : `unexpected: ${error.message}`);
}
' "file://$bundle" "$probe_repo" 2>/dev/null)" || verdict=""

    rm -rf "$probe_home"
    printf '%s' "${verdict:-the probe could not drive the installed bundle}"
  }

  opencode_install_tree_snapshot() {
    local fixture_home="$1" path rel digest
    for path in \
      "$fixture_home/.config/opencode" \
      "$fixture_home/.agents" \
      "$fixture_home/.local/state/oso-code/opencode-install-registry"; do
      [ -e "$path" ] || continue
      find "$path" -type f -print
    done | LC_ALL=C sort | while IFS= read -r path; do
      rel="${path#$fixture_home/}"
      digest="$(file_sha256 "$path")"
      printf 'file %s %s\n' "$rel" "$digest"
    done
  }

  invoke_opencode_installer() {
    local fixture_home="$1" installer="$2"
    shift 2
    : > "$OPENCODE_INSTALL_CALLS"
    if HOME="$fixture_home" \
      XDG_CONFIG_HOME="$fixture_home/.config" \
      PATH="$OPENCODE_INSTALL_SHIMS:$PATH" \
      OSO_OPENCODE_INSTALL_CALLS="$OPENCODE_INSTALL_CALLS" \
      OSO_TEST_ENGRAM_FAIL="${OSO_TEST_ENGRAM_FAIL:-}" \
      OSO_IMPECCABLE_SOURCE="${OSO_IMPECCABLE_SOURCE:-}" \
      OSO_IMPECCABLE_REMOTE="${OSO_IMPECCABLE_REMOTE:-}" \
      OSO_INSTALL_FAIL_AFTER="${OSO_INSTALL_FAIL_AFTER:-}" \
      bash "$installer" "$@" > "$OPENCODE_INSTALL_OUTPUT" 2>&1; then
      OPENCODE_INSTALL_RC=0
    else
      OPENCODE_INSTALL_RC=$?
    fi
    OPENCODE_INSTALL_LOG="$(cat "$OPENCODE_INSTALL_OUTPUT")"
  }

  run_opencode_install() {
    local fixture_home="$1"
    shift
    invoke_opencode_installer "$fixture_home" "$INSTALL_OPENCODE_SH" --no-git-hook "$@"
  }

  run_opencode_install_from_release() {
    local fixture_home="$1" release_root="$2"
    shift 2
    invoke_opencode_installer "$fixture_home" "$release_root/bootstrap/install-opencode.sh" \
      --yes --no-impeccable "$@"
  }

  OPENCODE_INSTALL_DECLINE_HOME="$TEST_HOME/opencode-install-decline-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_DECLINE_HOME"
  opencode_install_decline_before="$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_DECLINE_HOME")"
  printf '\n' > "$TEST_HOME/opencode-install-decline-input"
  : > "$OPENCODE_INSTALL_CALLS"
  if HOME="$OPENCODE_INSTALL_DECLINE_HOME" \
    XDG_CONFIG_HOME="$OPENCODE_INSTALL_DECLINE_HOME/.config" \
    PATH="$OPENCODE_INSTALL_SHIMS:$PATH" \
    OSO_OPENCODE_INSTALL_CALLS="$OPENCODE_INSTALL_CALLS" \
    bash "$INSTALL_OPENCODE_SH" < "$TEST_HOME/opencode-install-decline-input" \
    > "$OPENCODE_INSTALL_OUTPUT" 2>&1; then
    opencode_install_decline_rc=0
  else
    opencode_install_decline_rc=$?
  fi
  assert_equals "the OpenCode installer defaults to no without explicit confirmation" \
    "nonzero" "$([ "$opencode_install_decline_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "declining the OpenCode install preserves every fixture target exactly" \
    "$opencode_install_decline_before" "$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_DECLINE_HOME")"
  assert_equals "declining the OpenCode install records only the version probe, never a mutation" \
    "opencode:--version" "$(grep -F 'opencode:' "$OPENCODE_INSTALL_CALLS" || true)"
  assert_equals "declining the OpenCode install never reaches Engram or the install steps" \
    "0" "$(grep -Ec '^engram:|^fallow-mcp:' "$OPENCODE_INSTALL_CALLS" || true)"

  run_opencode_install "$OPENCODE_INSTALL_DECLINE_HOME" --bogus
  assert_equals "an unknown OpenCode installer flag is a usage error" \
    "2" "$OPENCODE_INSTALL_RC"
  assert_equals "a usage error preserves every fixture target exactly" \
    "$opencode_install_decline_before" "$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_DECLINE_HOME")"

  OPENCODE_INSTALL_HOME="$TEST_HOME/opencode-install-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_HOME"
  opencode_install_before="$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_HOME")"
  OSO_IMPECCABLE_SOURCE="$(opencode_install_impeccable_source "$OPENCODE_INSTALL_HOME" "4.0.2")" \
    run_opencode_install "$OPENCODE_INSTALL_HOME" --yes
  opencode_install_outcome="$OPENCODE_INSTALL_RC"
  if [ "$OPENCODE_INSTALL_RC" -ne 0 ]; then
    opencode_install_outcome="$OPENCODE_INSTALL_RC ($OPENCODE_INSTALL_LOG)"
  fi
  assert_equals "the fixture-only OpenCode install completes" "0" "$opencode_install_outcome"

  OPENCODE_INSTALLED_CONFIG="$OPENCODE_INSTALL_HOME/.config/opencode/opencode.json"
  assert_equals "the installed config is valid JSON" \
    "valid" "$(python3 -m json.tool "$OPENCODE_INSTALLED_CONFIG" >/dev/null 2>&1 && echo valid || echo invalid)"
  assert_equals "the installed plugin key is an array, never the object form" \
    "array" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('array' if isinstance(d.get('plugin'), list) else 'not-array')" "$OPENCODE_INSTALLED_CONFIG")"
  assert_equals "no installed MCP server uses the env key; the environment key is used instead" \
    "clean" "$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('clean' if all('env' not in (s or {}) for s in d.get('mcp', {}).values()) else 'env-key')" "$OPENCODE_INSTALLED_CONFIG")"
  assert_equals "the operator's provider survives the install" \
    "Fixture" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "provider.fixture-provider.name")"
  assert_equals "the operator's model survives the install" \
    "fixture/provider-model" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "model")"
  assert_equals "the operator's small model survives the install" \
    "fixture/small-model" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "small_model")"
  assert_equals "an operator key the installer needs nothing from survives verbatim" \
    "fixture-theme" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "theme")"
  assert_equals "the operator's agent block survives verbatim" \
    '{"fixture-agent": {"description": "operator agent the installer must leave alone"}}' \
    "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "agent")"
  for denied_mode in oso-plan oso-quick oso-debug; do
    assert_equals "the installed config hides the $denied_mode skill from the model" \
      "deny" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.skill.$denied_mode")"
  done
  assert_equals "the installed config keeps the task permission permissive" \
    "allow" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.task.*")"
  assert_equals "the installed config allows the headless question tool" \
    "allow" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.question")"
  assert_equals "the installed config allows entering plan mode headlessly" \
    "allow" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.plan_enter")"
  assert_equals "the installed config allows exiting plan mode headlessly" \
    "allow" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.plan_exit")"
  assert_equals "the installed config binds the plan approval tool to the operator's own grant" \
    "ask" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.oso_plan_approve")"
  assert_equals "the installed config binds the plan cancel tool to the operator's own grant" \
    "ask" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.oso_plan_cancel")"
  assert_equals "the operator's bash permission block comes back whole" \
    '{"*": "allow", "git push *": "ask"}' "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.bash")"
  assert_equals "the operator's read permission block comes back whole" \
    '{"*": "allow", "**/.env": "deny"}' "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.read")"
  assert_equals "the operator's custom MCP server comes back whole" \
    '["operator-mcp-bin"]' "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.operator-mcp.command")"
  assert_equals "the operator's context7 customization survives the installer declaration" \
    "https://fixture.example.test/mcp" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.context7.url")"
  assert_equals "the installer declares the context7 MCP server" \
    "remote" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.context7.type")"
  assert_equals "the installer declares the engram MCP server" \
    "local" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.engram.type")"
  assert_equals "the installer declares the fallow MCP server" \
    "local" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.fallow.type")"
  assert_equals "the local engram MCP uses the environment key" \
    "{}" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "mcp.engram.environment")"

  assert_equals "the installed skill tree carries exactly nine wrappers" \
    "9" "$(ls -d "$OPENCODE_INSTALL_HOME"/.config/opencode/skill/oso-* 2>/dev/null | wc -l | tr -d ' ')"
  assert_equals "the shared skill bodies sit beside the wrappers" \
    "present" "$([ -f "$OPENCODE_INSTALL_HOME/.config/opencode/skill/_shared/bodies/plan.md" ] && [ -d "$OPENCODE_INSTALL_HOME/.config/opencode/skill/_shared/platform/opencode" ] && echo present || echo absent)"
  assert_equals "each installed skill wrapper is byte-identical to its source" \
    "identical" "$(opencode_install_sources_identical "$OPENCODE_INSTALL_HOME")"
  assert_equals "the installed agent tree carries every agent contract" \
    "$(ls "$REPO_ROOT/opencode/agents"/oso-*.md | wc -l | tr -d ' ')" "$(ls "$OPENCODE_INSTALL_HOME"/.config/opencode/agent/oso-*.md 2>/dev/null | wc -l | tr -d ' ')"
  assert_equals "the installed command tree carries the four mode commands" \
    "4" "$(ls "$OPENCODE_INSTALL_HOME"/.config/opencode/command/oso-*.md 2>/dev/null | wc -l | tr -d ' ')"
  assert_equals "the plan command routes to the primary agent that can execute its slices" \
    "build" "$(sed -n 's/^agent:[[:space:]]*//p' "$OPENCODE_INSTALL_HOME/.config/opencode/command/oso-plan.md" | head -1)"
  assert_equals "the roadmap command routes to the primary agent that can run the chain" \
    "build" "$(sed -n 's/^agent:[[:space:]]*//p' "$OPENCODE_INSTALL_HOME/.config/opencode/command/oso-roadmap.md" | head -1)"
  assert_equals "the installed config hides the roadmap mode from the model" \
    "deny" "$(opencode_install_config_value "$OPENCODE_INSTALL_HOME" "permission.skill.oso-roadmap")"
  assert_equals "the installed plugin entry sits under the discovery glob" \
    "present" "$([ -f "$OPENCODE_INSTALL_HOME/.config/opencode/plugin/oso-code.js" ] && echo present || echo absent)"
  assert_equals "the installed plugin entry is the committed bundle byte for byte" \
    "identical" "$(cmp -s "$REPO_ROOT/opencode/dist/oso-code.js" "$OPENCODE_INSTALL_HOME/.config/opencode/plugin/oso-code.js" && echo identical || echo differs)"
  assert_equals "the installed plugin is that one file and no TypeScript source beside it" \
    "1" "$(find "$OPENCODE_INSTALL_HOME/.config/opencode/plugin" -type f | wc -l | tr -d ' ')"
  assert_equals "the gate scripts installed beside the plugin are exactly the ones the published manifest covers, never one byte more" \
    "$(grep -c '  plugin/hooks/.*\.sh$' "$REPO_ROOT/bootstrap/hook-hashes.txt")" \
    "$(ls "$OPENCODE_INSTALL_HOME"/.config/opencode/hooks/*.sh 2>/dev/null | wc -l | tr -d ' ')"
  assert_equals "no gate script reaches the operator's config without a published hash" \
    "" "$(opencode_install_unpublished_gate_scripts "$OPENCODE_INSTALL_HOME")"
  assert_equals "every installed gate script is byte-identical to its source" \
    "identical" "$(opencode_install_gate_scripts_identical "$OPENCODE_INSTALL_HOME")"
  assert_equals "the installed bundle denies a red commit in-process, with no gate script spawned and no source tree beside it" \
    "denied" "$(opencode_installed_bundle_commit_verdict "$OPENCODE_INSTALL_HOME")"
  assert_equals "the same installed bundle leaves an unarmed repository's commit alone" \
    "allowed" "$(opencode_installed_bundle_commit_verdict "$OPENCODE_INSTALL_HOME" unarmed)"
  assert_equals "oso-state installs beside the gate tree, executable" \
    "present" "$([ -x "$OPENCODE_INSTALL_HOME/.config/opencode/bin/oso-state" ] && echo present || echo absent)"
  assert_equals "the installed oso-state binary is byte-identical to its source" \
    "identical" "$(opencode_install_state_bin_identical "$OPENCODE_INSTALL_HOME")"
  assert_equals "the global guidance merges into a marked region below the operator's own prose" \
    "identical" "$(opencode_install_global_merged_identical "$OPENCODE_INSTALL_HOME")"
  assert_equals "the merged global file carries exactly one oso-code marker pair" \
    "1 1" "$(opencode_install_global_marker_pairs "$OPENCODE_INSTALL_HOME")"
  assert_equals "the Engram plugin lands where OpenCode loads plugins" \
    "fixture engram plugin" "$(cat "$OPENCODE_INSTALL_HOME/.config/opencode/plugins/engram.ts")"
  assert_equals "the operator's plural plugin tree survives untouched" \
    "operator plugin survives" "$(cat "$OPENCODE_INSTALL_HOME/.config/opencode/plugins/clean-code-gate.ts")"
  assert_equals "the operator's plural skill tree survives untouched" \
    "operator skill survives" "$(cat "$OPENCODE_INSTALL_HOME/.config/opencode/skills/op-skill/SKILL.md")"
  assert_equals "a stale file under the owned plugin tree is replaced wholesale" \
    "absent" "$([ ! -e "$OPENCODE_INSTALL_HOME/.config/opencode/plugin/stale.ts" ] && echo absent || echo present)"
  assert_equals "the pinned Impeccable skill is mounted at the stable user-wide path" \
    "4.0.2" "$(sed -n 's/^version:[[:space:]]*//p' "$OPENCODE_INSTALL_HOME/.agents/skills/impeccable/SKILL.md" | head -1)"
  assert_equals "the installed skill tree is exactly the nine installer wrappers" \
    "9" "$(find "$OPENCODE_INSTALL_HOME/.config/opencode/skill" -name SKILL.md | wc -l | tr -d ' ')"

  assert_equals "the install reports the backup snapshot path" \
    "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc '[oso-code] backup:' || true)"
  assert_equals "the install leaves exactly one backup snapshot" \
    "1" "$(ls -d "$OPENCODE_INSTALL_HOME"/.local/state/oso-code/install-backup-* 2>/dev/null | wc -l | tr -d ' ')"
  OPENCODE_INSTALL_BACKUP="$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | sed -n 's/^\[oso-code\] backup: //p' | tail -n 1)"
  establish_premise "the completed install published a backup directory to inspect" \
    [ -f "$OPENCODE_INSTALL_BACKUP/manifest" ]
  assert_equals "the install backup manifest records every replaced target" \
    "14" "$(grep -c $'\t' "$OPENCODE_INSTALL_BACKUP/manifest" || true)"

  assert_equals "the owner registry records the installer-owned targets" \
    "21" "$(grep -c '^installer	' "$OPENCODE_INSTALL_HOME/.local/state/oso-code/opencode-install-registry" || true)"
  assert_equals "the owner registry records the installed oso-state binary" \
    "1" "$(grep -Fc "installer	$OPENCODE_INSTALL_HOME/.config/opencode/bin/oso-state" "$OPENCODE_INSTALL_HOME/.local/state/oso-code/opencode-install-registry" || true)"
  assert_equals "the owner registry records every installed gate script" \
    "$(ls "$OPENCODE_INSTALL_HOME"/.config/opencode/hooks/*.sh | wc -l | tr -d ' ')" \
    "$(grep -c "^installer	$OPENCODE_INSTALL_HOME/.config/opencode/hooks/.*\.sh$" "$OPENCODE_INSTALL_HOME/.local/state/oso-code/opencode-install-registry" || true)"
  assert_equals "the owner registry records the operator's preserved config keys" \
    "9" "$(grep -c '^operator	' "$OPENCODE_INSTALL_HOME/.local/state/oso-code/opencode-install-registry" || true)"
  assert_equals "the owner registry names the operator's restored provider key" \
    "1" "$(grep -Fc "operator	$OPENCODE_INSTALLED_CONFIG:provider" "$OPENCODE_INSTALL_HOME/.local/state/oso-code/opencode-install-registry" || true)"

  assert_equals "the worktree state under the operator's state home survives" \
    "worktree state survives" "$(cat "$OPENCODE_INSTALL_HOME/.local/state/oso-code/worktrees/keep/sentinel")"
  assert_equals "the three project-level opencode.json files are never part of the install" \
    "alpha config
beta config
gamma config" "$(cat "$OPENCODE_INSTALL_HOME/repos/alpha/opencode.json"
    cat "$OPENCODE_INSTALL_HOME/repos/beta/opencode.json"
    cat "$OPENCODE_INSTALL_HOME/repos/gamma/opencode.json")"
  assert_equals "the installer invokes opencode only to probe the pinned version" \
    "opencode:--version" "$(grep -F 'opencode:' "$OPENCODE_INSTALL_CALLS" || true)"
  assert_equals "the installer never invokes a login, install or uninstall command" \
    "0" "$(grep -Ec 'login|(^|:)install|uninstall' "$OPENCODE_INSTALL_CALLS" || true)"

  OPENCODE_INSTALL_ENGRAM_HOME="$TEST_HOME/opencode-install-engram-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_ENGRAM_HOME"
  OSO_TEST_ENGRAM_FAIL=1 \
    run_opencode_install "$OPENCODE_INSTALL_ENGRAM_HOME" --yes
  assert_equals "a failed Engram setup still completes the install" "0" "$OPENCODE_INSTALL_RC"
  assert_equals "a failed Engram setup preserves the operator's prior plugin from the backup" \
    "operator engram plugin" "$(cat "$OPENCODE_INSTALL_ENGRAM_HOME/.config/opencode/plugins/engram.ts")"

  OPENCODE_INSTALL_NOIMP_HOME="$TEST_HOME/opencode-install-noimp-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_NOIMP_HOME"
  run_opencode_install "$OPENCODE_INSTALL_NOIMP_HOME" --yes --no-impeccable
  assert_equals "an opted-out Impeccable install completes" "0" "$OPENCODE_INSTALL_RC"
  assert_equals "an opted-out Impeccable install mounts nothing" \
    "absent" "$([ ! -e "$OPENCODE_INSTALL_NOIMP_HOME/.agents/skills/impeccable" ] && echo absent || echo present)"
  assert_equals "an opted-out Impeccable install writes the opt-out marker" \
    "skipped by --no-impeccable" "$(grep -o 'skipped by --no-impeccable' "$OPENCODE_INSTALL_NOIMP_HOME/.local/state/oso-code/impeccable-opt-out" 2>/dev/null || echo none)"

  OPENCODE_INSTALL_ROLLBACK_HOME="$TEST_HOME/opencode-install-rollback-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_ROLLBACK_HOME"
  opencode_install_rollback_before="$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_ROLLBACK_HOME")"
  OSO_INSTALL_FAIL_AFTER=after-impeccable run_opencode_install "$OPENCODE_INSTALL_ROLLBACK_HOME" --yes
  assert_equals "a deterministic failure after the last step exits nonzero" \
    "nonzero" "$([ "$OPENCODE_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "a failed install restores the pre-install tree exactly" \
    "$opencode_install_rollback_before" "$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_ROLLBACK_HOME")"
  assert_equals "a failed install leaves the pre-install backup snapshot for manual restore" \
    "1" "$(ls -d "$OPENCODE_INSTALL_ROLLBACK_HOME"/.local/state/oso-code/install-backup-* 2>/dev/null | wc -l | tr -d ' ')"

  OPENCODE_INSTALL_IDEM_HOME="$TEST_HOME/opencode-install-idem-home"
  write_opencode_install_fixture "$OPENCODE_INSTALL_IDEM_HOME"
  OSO_IMPECCABLE_SOURCE="$(opencode_install_impeccable_source "$OPENCODE_INSTALL_IDEM_HOME" "4.0.2")" \
    run_opencode_install "$OPENCODE_INSTALL_IDEM_HOME" --yes
  opencode_install_idem_first="$OPENCODE_INSTALL_RC"
  opencode_install_idem_tree="$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_IDEM_HOME")"
  OSO_IMPECCABLE_SOURCE="$(opencode_install_impeccable_source "$OPENCODE_INSTALL_IDEM_HOME" "4.0.2")" \
    run_opencode_install "$OPENCODE_INSTALL_IDEM_HOME" --yes
  assert_equals "re-running the install over an installed home succeeds" \
    "0" "$([ "$opencode_install_idem_first" -eq 0 ] && [ "$OPENCODE_INSTALL_RC" -eq 0 ] && echo 0 || echo $OPENCODE_INSTALL_RC)"
  assert_equals "re-running the install leaves the installed tree byte-identical" \
    "$opencode_install_idem_tree" "$(opencode_install_tree_snapshot "$OPENCODE_INSTALL_IDEM_HOME")"
  assert_equals "re-running the install never duplicates the nine wrappers" \
    "9" "$(ls -d "$OPENCODE_INSTALL_IDEM_HOME"/.config/opencode/skill/oso-* 2>/dev/null | wc -l | tr -d ' ')"
  assert_equals "re-running the install never duplicates the managed global region" \
    "1 1" "$(opencode_install_global_marker_pairs "$OPENCODE_INSTALL_IDEM_HOME")"
  assert_equals "re-running the install still leaves the operator's global prose in place" \
    "identical" "$(opencode_install_global_merged_identical "$OPENCODE_INSTALL_IDEM_HOME")"

  OPENCODE_BAD_GLOBAL_HOME="$TEST_HOME/opencode-install-bad-global-home"
  write_opencode_install_fixture "$OPENCODE_BAD_GLOBAL_HOME"
  opencode_bad_global="$OPENCODE_BAD_GLOBAL_HOME/.config/opencode/AGENTS.md"
  printf '%s\n' \
    "$OPENCODE_GLOBAL_MARKER_START" \
    "$OPENCODE_OPERATOR_GLOBAL" \
    "$OPENCODE_GLOBAL_MARKER_START" > "$opencode_bad_global"
  opencode_bad_global_before="$(file_sha256 "$opencode_bad_global")"
  opencode_bad_global_tree="$(opencode_install_tree_snapshot "$OPENCODE_BAD_GLOBAL_HOME")"
  run_opencode_install "$OPENCODE_BAD_GLOBAL_HOME" --yes --no-impeccable
  assert_equals "a doubled global start marker is refused instead of overwritten" \
    "nonzero" "$([ "$OPENCODE_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "the refusal names the malformed oso-code markers" \
    "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc 'malformed oso-code markers' || true)"
  assert_equals "the malformed global file is left byte-identical by the refused install" \
    "$opencode_bad_global_before" "$(file_sha256 "$opencode_bad_global")"
  assert_equals "the refused install mutates nothing else in the fixture home" \
    "$opencode_bad_global_tree" "$(opencode_install_tree_snapshot "$OPENCODE_BAD_GLOBAL_HOME")"

  if [ "$OPENCODE_GIT_PRESENT" = true ]; then
    OPENCODE_INSTALL_GIT_HOME="$TEST_HOME/opencode-install-git-home"
    write_opencode_install_fixture "$OPENCODE_INSTALL_GIT_HOME"
    write_opencode_install_impeccable_repo "$OPENCODE_IMPECCABLE_REMOTE" "4.0.2" "4.0.2"
    OSO_IMPECCABLE_REMOTE="$OPENCODE_IMPECCABLE_REMOTE" \
      run_opencode_install "$OPENCODE_INSTALL_GIT_HOME" --yes
    assert_equals "the pinned shallow clone mounts the exact tagged Impeccable build" \
      "4.0.2" "$([ "$OPENCODE_INSTALL_RC" -eq 0 ] && sed -n 's/^version:[[:space:]]*//p' "$OPENCODE_INSTALL_GIT_HOME/.agents/skills/impeccable/SKILL.md" | head -1 || echo "rc=$OPENCODE_INSTALL_RC")"
    OPENCODE_INSTALL_MISMATCH_HOME="$TEST_HOME/opencode-install-mismatch-home"
    write_opencode_install_fixture "$OPENCODE_INSTALL_MISMATCH_HOME"
    write_opencode_install_impeccable_repo "$OPENCODE_IMPECCABLE_MISTAGED" "9.9.9" "4.0.2"
    OSO_IMPECCABLE_REMOTE="$OPENCODE_IMPECCABLE_MISTAGED" \
      run_opencode_install "$OPENCODE_INSTALL_MISMATCH_HOME" --yes
    assert_equals "a mistagged Impeccable release fails loudly instead of installing unpinned" \
      "nonzero" "$([ "$OPENCODE_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
    assert_equals "the unpinned-release refusal names the pinned version as the remedy" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc 'refusing to leave an unpinned install' || true)"
    assert_equals "the unpinned-release refusal rolls the mount back to absent" \
      "absent" "$([ ! -e "$OPENCODE_INSTALL_MISMATCH_HOME/.agents/skills/impeccable" ] && echo absent || echo present)"
  else
    skipped=$((skipped + 1))
    OPENCODE_INSTALL_MISMATCH_HOME="$TEST_HOME/opencode-install-mismatch-home"
    write_opencode_install_fixture "$OPENCODE_INSTALL_MISMATCH_HOME"
    OSO_IMPECCABLE_SOURCE="$(opencode_install_impeccable_source "$OPENCODE_INSTALL_MISMATCH_HOME" "9.9.9")" \
      run_opencode_install "$OPENCODE_INSTALL_MISMATCH_HOME" --yes
    assert_equals "an unpinned Impeccable source fails loudly without git" \
      "nonzero" "$([ "$OPENCODE_INSTALL_RC" -ne 0 ] && echo nonzero || echo zero)"
    assert_equals "the no-git refusal names git as the remedy" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc 'git is required' || true)"
    assert_equals "the no-git refusal mounts nothing" \
      "absent" "$([ ! -e "$OPENCODE_INSTALL_MISMATCH_HOME/.agents/skills/impeccable" ] && echo absent || echo present)"
  fi

  OPENCODE_RECOVERY_HOME="$TEST_HOME/opencode-recovery-home"
  write_opencode_install_fixture "$OPENCODE_RECOVERY_HOME"
  opencode_recovery_config_before="$(cat "$OPENCODE_RECOVERY_HOME/.config/opencode/opencode.json")"

  run_opencode_recovery() {
    local script="$1"
    shift
    if OPENCODE_RECOVERY_LOG="$(HOME="$OPENCODE_RECOVERY_HOME" \
      XDG_CONFIG_HOME="$OPENCODE_RECOVERY_HOME/.config" \
      bash "$REPO_ROOT/bootstrap/$script" "$@" 2>&1)"; then
      OPENCODE_RECOVERY_RC=0
    else
      OPENCODE_RECOVERY_RC=$?
    fi
  }

  run_opencode_install "$OPENCODE_RECOVERY_HOME" --yes --no-impeccable
  establish_premise "the recovery fixture holds a completed install to restore" \
    [ "$OPENCODE_INSTALL_RC" -eq 0 ]

  run_opencode_recovery restore-opencode.sh --list
  assert_equals "the restore offers the install's own snapshot" \
    "1" "$(printf '%s\n' "$OPENCODE_RECOVERY_LOG" | grep -c '^install-backup-' || true)"
  run_opencode_recovery restore-opencode.sh --yes
  assert_equals "the restore completes" "0" "$OPENCODE_RECOVERY_RC"
  assert_equals "the restore returns the operator's pre-install config byte for byte" \
    "$opencode_recovery_config_before" "$(cat "$OPENCODE_RECOVERY_HOME/.config/opencode/opencode.json")"
  assert_equals "the restore records that this machine has now exercised one, under this host's own marker" \
    "present absent" "$([ -f "$OPENCODE_RECOVERY_HOME/.local/state/oso-code/.install-restore-verified-opencode" ] && echo present || echo absent) $([ -f "$OPENCODE_RECOVERY_HOME/.local/state/oso-code/.install-restore-verified-codex" ] && echo present || echo absent)"

  run_opencode_install "$OPENCODE_RECOVERY_HOME" --yes --no-impeccable
  establish_premise "the recovery fixture is installed again before the repair case" \
    [ "$OPENCODE_INSTALL_RC" -eq 0 ]
  python3 - "$OPENCODE_RECOVERY_HOME/.config/opencode/opencode.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    config = json.load(handle)
config.pop("theme", None)
config.pop("agent", None)
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
PY
  run_opencode_recovery repair-opencode.sh --yes
  assert_equals "the repair completes" "0" "$OPENCODE_RECOVERY_RC"
  assert_equals "the repair returns an operator key a past release dropped" \
    "fixture-theme" "$(opencode_install_config_value "$OPENCODE_RECOVERY_HOME" "theme")"
  assert_equals "the repair names every key it returned" \
    "1" "$(printf '%s\n' "$OPENCODE_RECOVERY_LOG" | grep -Fc 'returned 2 key(s)' || true)"
  assert_equals "the repair leaves an installer-owned key exactly as the install wrote it" \
    "ask" "$(opencode_install_config_value "$OPENCODE_RECOVERY_HOME" "permission.oso_plan_approve")"
  run_opencode_recovery repair-opencode.sh --yes
  assert_equals "a second repair finds nothing left to return" \
    "1" "$(printf '%s\n' "$OPENCODE_RECOVERY_LOG" | grep -Fc 'nothing to repair' || true)"

  if [ "$OPENCODE_GIT_PRESENT" = true ]; then
    OPENCODE_RAIL_SESSION=opencode-commit-rail
    OPENCODE_RAIL_ATTEMPTS=0

    write_opencode_release_repo() {
      local release="$1"
      mkdir -p "$release/opencode"
      cp -R "$REPO_ROOT/bootstrap" "$release/bootstrap"
      cp -R "$REPO_ROOT/plugin" "$release/plugin"
      cp -R "$REPO_ROOT/opencode/skills" "$REPO_ROOT/opencode/agents" \
        "$REPO_ROOT/opencode/commands" "$REPO_ROOT/opencode/plugin" \
        "$REPO_ROOT/opencode/dist" "$release/opencode/"
      git init -q "$release"
      git -C "$release" config user.email tests@oso-code.invalid
      git -C "$release" config user.name "oso-code tests"
      git -C "$release" config commit.gpgsign false
    }

    opencode_configured_hooks_path() {
      git -C "$1" config --local --get core.hooksPath 2>/dev/null || printf absent
    }

    opencode_rail_state() {
      local fixture_home="$1" tree="$2"
      shift 2
      ( cd "$tree" && HOME="$fixture_home" \
        "$fixture_home/.config/opencode/bin/oso-state" \
        --session "$OPENCODE_RAIL_SESSION" "$@" )
    }

    opencode_rail_commit() {
      local fixture_home="$1" tree="$2" marker="$3" change
      OPENCODE_RAIL_ATTEMPTS=$((OPENCODE_RAIL_ATTEMPTS + 1))
      change="rail-change-$OPENCODE_RAIL_ATTEMPTS.txt"
      printf '%s\n' "$change" > "$tree/$change"
      git -C "$tree" add "$change"
      if OPENCODE_RAIL_COMMIT_OUTPUT="$(cd "$tree" && env -u CLAUDE_CODE_SESSION_ID \
        HOME="$fixture_home" OSO_AGENT="$marker" git commit -m "$change" 2>&1)"; then
        OPENCODE_RAIL_COMMIT_RC=0
      else
        OPENCODE_RAIL_COMMIT_RC=$?
      fi
    }

    opencode_rail_verdict() {
      [ "$OPENCODE_RAIL_COMMIT_RC" -ne 0 ] && printf denied || printf landed
    }

    OPENCODE_RAIL_RELEASE="$TEST_HOME/opencode-rail-release"
    OPENCODE_RAIL_HOME="$TEST_HOME/opencode-rail-home"
    OPENCODE_RAIL_WORKTREE="$TEST_HOME/opencode-rail-worktree"
    write_opencode_release_repo "$OPENCODE_RAIL_RELEASE"
    write_opencode_install_fixture "$OPENCODE_RAIL_HOME"
    run_opencode_install_from_release "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE"
    OPENCODE_RAIL_HOOKS="$OPENCODE_RAIL_HOME/.config/opencode/git-hooks"
    assert_equals "the install that wires the commit rail's second layer completes" \
      "0" "$OPENCODE_INSTALL_RC"
    assert_equals "the installer points the installed-from repo's core.hooksPath at the installed git-hooks directory" \
      "$OPENCODE_RAIL_HOOKS" "$(opencode_configured_hooks_path "$OPENCODE_RAIL_RELEASE")"
    assert_equals "the wired hook is the shared pre-commit rather than a second implementation" \
      "identical" "$(cmp -s "$REPO_ROOT/plugin/git-hooks/pre-commit" "$OPENCODE_RAIL_HOOKS/pre-commit" && echo identical || echo divergent)"
    assert_equals "the wired hook is executable where git will run it" \
      "executable" "$([ -x "$OPENCODE_RAIL_HOOKS/pre-commit" ] && echo executable || echo inert)"
    assert_equals "the gate library the wired hook resolves as its sibling is the shared one" \
      "identical" "$(cmp -s "$REPO_ROOT/plugin/hooks/lib.sh" "$OPENCODE_RAIL_HOME/.config/opencode/hooks/lib.sh" && echo identical || echo divergent)"
    assert_equals "the owner registry records the installed commit hook" \
      "1" "$(grep -Fc "installer	$OPENCODE_RAIL_HOOKS/pre-commit" "$OPENCODE_RAIL_HOME/.local/state/oso-code/opencode-install-registry" || true)"

    opencode_rail_commit "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" ""
    assert_equals "a commit carrying no agent marker passes the wired hook untouched" \
      "landed" "$(opencode_rail_verdict)"

    establish_premise "the rail probe repository arms a red session" \
      opencode_rail_state "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" \
      set mode=plan verify_green=false
    opencode_rail_commit "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" "$OPENCODE_RAIL_SESSION"
    assert_equals "the wired hook denies an agent's commit while verify is red" \
      "denied" "$(opencode_rail_verdict)"
    assert_equals "the denial carries the shared hook's own reason" \
      "1" "$(printf '%s\n' "$OPENCODE_RAIL_COMMIT_OUTPUT" | grep -Fc 'the session verify is not green' || true)"
    assert_equals "the denial names the armed mode's own remedy" \
      "1" "$(printf '%s\n' "$OPENCODE_RAIL_COMMIT_OUTPUT" | grep -Fc "Resume plan mode's apply" || true)"

    establish_premise "the rail probe repository turns green" \
      opencode_rail_state "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" set verify_green=true
    opencode_rail_commit "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" "$OPENCODE_RAIL_SESSION"
    assert_equals "the wired hook lets the same commit through once verify is green" \
      "landed" "$(opencode_rail_verdict)"

    establish_premise "the rail probe repository accepts a linked worktree" \
      git -C "$OPENCODE_RAIL_RELEASE" worktree add -q -b oso/rail-probe "$OPENCODE_RAIL_WORKTREE"
    establish_premise "the rail probe repository is red again for the worktree case" \
      opencode_rail_state "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_RELEASE" set verify_green=false
    opencode_rail_commit "$OPENCODE_RAIL_HOME" "$OPENCODE_RAIL_WORKTREE" "$OPENCODE_RAIL_SESSION"
    assert_equals "a linked worktree inherits the absolute hooksPath and is denied there too" \
      "denied" "$(opencode_rail_verdict)"

    OPENCODE_OPTOUT_RELEASE="$TEST_HOME/opencode-optout-release"
    OPENCODE_OPTOUT_HOME="$TEST_HOME/opencode-optout-home"
    write_opencode_release_repo "$OPENCODE_OPTOUT_RELEASE"
    write_opencode_install_fixture "$OPENCODE_OPTOUT_HOME"
    run_opencode_install_from_release "$OPENCODE_OPTOUT_HOME" "$OPENCODE_OPTOUT_RELEASE" --no-git-hook
    assert_equals "an install opting out of the git layer completes" \
      "0" "$OPENCODE_INSTALL_RC"
    assert_equals "--no-git-hook leaves core.hooksPath alone" \
      "absent" "$(opencode_configured_hooks_path "$OPENCODE_OPTOUT_RELEASE")"
    assert_equals "--no-git-hook still installs the hook, so another repo can be wired by hand" \
      "identical" "$(cmp -s "$REPO_ROOT/plugin/git-hooks/pre-commit" "$OPENCODE_OPTOUT_HOME/.config/opencode/git-hooks/pre-commit" && echo identical || echo divergent)"
    assert_equals "the opt-out is reported rather than passed over in silence" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc 'skipping the git commit hook wiring (--no-git-hook)' || true)"

    OPENCODE_FOREIGN_RELEASE="$TEST_HOME/opencode-foreign-release"
    OPENCODE_FOREIGN_HOME="$TEST_HOME/opencode-foreign-home"
    OPENCODE_FOREIGN_HOOKS="$TEST_HOME/opencode-foreign-operator-hooks"
    write_opencode_release_repo "$OPENCODE_FOREIGN_RELEASE"
    write_opencode_install_fixture "$OPENCODE_FOREIGN_HOME"
    mkdir -p "$OPENCODE_FOREIGN_HOOKS"
    cp "$REPO_ROOT/plugin/git-hooks/pre-commit" "$OPENCODE_FOREIGN_HOOKS/pre-commit"
    git -C "$OPENCODE_FOREIGN_RELEASE" config core.hooksPath "$OPENCODE_FOREIGN_HOOKS"
    run_opencode_install_from_release "$OPENCODE_FOREIGN_HOME" "$OPENCODE_FOREIGN_RELEASE"
    assert_equals "an install that meets another hooks owner still completes" \
      "0" "$OPENCODE_INSTALL_RC"
    assert_equals "another hooks owner is refused loudly, named in the refusal" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc "core.hooksPath=$OPENCODE_FOREIGN_HOOKS already owns this repo's hooks" || true)"
    assert_equals "the refusal names the way to run both layers instead of replacing one" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc "call $OPENCODE_FOREIGN_HOME/.config/opencode/git-hooks/pre-commit from your own pre-commit" || true)"
    assert_equals "the refusal leaves the other owner's wiring exactly as it was" \
      "$OPENCODE_FOREIGN_HOOKS" "$(opencode_configured_hooks_path "$OPENCODE_FOREIGN_RELEASE")"

    OPENCODE_STANDING_HOOK_RELEASE="$TEST_HOME/opencode-standing-hook-release"
    OPENCODE_STANDING_HOOK_HOME="$TEST_HOME/opencode-standing-hook-home"
    write_opencode_release_repo "$OPENCODE_STANDING_HOOK_RELEASE"
    write_opencode_install_fixture "$OPENCODE_STANDING_HOOK_HOME"
    printf '#!/bin/sh\nexit 0\n' > "$OPENCODE_STANDING_HOOK_RELEASE/.git/hooks/pre-commit"
    chmod +x "$OPENCODE_STANDING_HOOK_RELEASE/.git/hooks/pre-commit"
    run_opencode_install_from_release "$OPENCODE_STANDING_HOOK_HOME" "$OPENCODE_STANDING_HOOK_RELEASE"
    assert_equals "a hook already standing in the repository's own hooks directory is refused loudly" \
      "1" "$(printf '%s\n' "$OPENCODE_INSTALL_LOG" | grep -Fc "/.git/hooks/pre-commit already owns this repo's hooks" || true)"
    assert_equals "that refusal leaves the repository unwired rather than taking its own hooks out of git's reach" \
      "absent" "$(opencode_configured_hooks_path "$OPENCODE_STANDING_HOOK_RELEASE")"
    assert_equals "the standing hook itself is never replaced" \
      "1" "$(grep -Fxc 'exit 0' "$OPENCODE_STANDING_HOOK_RELEASE/.git/hooks/pre-commit" || true)"
  else
    echo "skip: git is absent here, so the OpenCode commit rail's git layer has nothing to wire or run"
    skipped=$((skipped + 1))
  fi
fi

if [ "$RUNS_ON_WINDOWS_BASH" = true ]; then
  echo "skip: the opencode verifier fixtures publish real file trees and run a full fixture install; the emulated Windows bash runs the rest of the suite"
  skipped=$((skipped + 1))
elif [ ! -d "$REPO_ROOT/opencode/node_modules" ]; then
  echo "skip: the opencode verifier fixtures need opencode/node_modules present for the typecheck bar"
  skipped=$((skipped + 1))
else
  VERIFY_OPENCODE_SH="$REPO_ROOT/bootstrap/verify-opencode.sh"

  opencode_verify_path_without_opencode() {
    local dir result="" saved_ifs="$IFS"
    IFS=':'
    for dir in $PATH; do
      if [ -n "$dir" ] && [ -x "$dir/opencode" ]; then
        continue
      fi
      result="${result:+$result:}$dir"
    done
    IFS="$saved_ifs"
    printf '%s' "$result"
  }
  OPENCODE_VERIFY_CLEAN_PATH="$(opencode_verify_path_without_opencode)"

  OPENCODE_VERIFY_HOME="$TEST_HOME/opencode-verify-home"
  OPENCODE_VERIFY_OUTPUT="$TEST_HOME/opencode-verify-output"
  OPENCODE_VERIFY_NPM_CACHE="$TEST_HOME/opencode-verify-npm-cache"
  OPENCODE_VERIFY_XDG="$TEST_HOME/opencode-verify-xdg"
  mkdir -p "$OPENCODE_VERIFY_HOME/.config/opencode" "$OPENCODE_VERIFY_NPM_CACHE"
  printf 'operator config must survive\n' > "$OPENCODE_VERIFY_HOME/.config/opencode/opencode.json"
  printf 'operator guidance must survive\n' > "$OPENCODE_VERIFY_HOME/.config/opencode/AGENTS.md"
  printf 'operator sentinel\n' > "$OPENCODE_VERIFY_HOME/sentinel.txt"

  if HOME="$OPENCODE_VERIFY_HOME" \
    npm_config_cache="$OPENCODE_VERIFY_NPM_CACHE" \
    XDG_DATA_HOME="$OPENCODE_VERIFY_XDG/data" \
    XDG_STATE_HOME="$OPENCODE_VERIFY_XDG/state" \
    XDG_CACHE_HOME="$OPENCODE_VERIFY_XDG/cache" \
    PATH="$OPENCODE_VERIFY_CLEAN_PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$VERIFY_OPENCODE_SH" > "$OPENCODE_VERIFY_OUTPUT" 2>&1; then
    opencode_verify_rc=0
  else
    opencode_verify_rc=$?
  fi
  opencode_verify_report="$(cat "$OPENCODE_VERIFY_OUTPUT")"
  assert_equals "the self-contained OpenCode verifier reports an unrun smoke rather than a clean report" \
    "3" "$opencode_verify_rc"
  assert_equals "the OpenCode verifier always reaches exactly one final summary" \
    "1" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^passed:' || true)"
  assert_equals "the OpenCode verifier reports no failing checks against a clean fixture" \
    "0" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^FAIL:' || true)"
  assert_equals "the OpenCode verifier runs its self-contained local checks" \
    "10+" "$([ "$(printf '%s\n' "$opencode_verify_report" | grep -c '^ok:' || true)" -ge 10 ] && echo 10+ || echo too-few)"
  assert_equals "the OpenCode verifier skips the version probe when no binary is on PATH" \
    "1" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^skip: OpenCode CLI version' || true)"
  assert_equals "the OpenCode verifier records the unrun wave-runner smoke under the skip switch" \
    "1" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^not run: wave-runner smoke' || true)"
  assert_equals "the OpenCode verifier never prints a bare skip for the wave-runner smoke" \
    "0" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^skip: wave-runner smoke' || true)"
  assert_equals "the unrun smoke names its reason beside the summary" \
    "1" "$(printf '%s\n' "$opencode_verify_report" | grep -c '^wave-runner smoke not run:' || true)"
  assert_equals "the fixture install completes, which the strict shim allows only for version probes" \
    "1" "$(printf '%s\n' "$opencode_verify_report" | grep -Fxc 'ok:   isolated fixture install (ready)' || true)"
  OPENCODE_SMOKE_LOGS="$TEST_HOME/opencode-smoke-logs"
  mkdir -p "$OPENCODE_SMOKE_LOGS"
  printf '! permission requested: external_directory (%s/wt2/*); auto-rejecting\n' \
    "$OPENCODE_SMOKE_LOGS" > "$OPENCODE_SMOKE_LOGS/wt1.json"
  cp "$OPENCODE_SMOKE_LOGS/wt1.json" "$OPENCODE_SMOKE_LOGS/wt2.json"

  opencode_wave_smoke_outcome() {
    (
      . "$VERIFY_OPENCODE_SH" > /dev/null 2>&1
      SMOKE_ROOT="$1"
      SMOKE_BREACHED="$2"
      SMOKE_INCOMPLETE="$3"
      wave_smoke_outcome
    )
  }

  assert_equals "a host that auto-rejects the pinned worktree makes the smoke a named not-run" \
    "host-refused-the-worktree" \
    "$(opencode_wave_smoke_outcome "$OPENCODE_SMOKE_LOGS" "" "wt1-proof wt2-proof")"
  assert_equals "a real isolation breach stays red under that same host refusal" \
    "breached" \
    "$(opencode_wave_smoke_outcome "$OPENCODE_SMOKE_LOGS" "wt1-has-wt2-proof" "wt1-proof wt2-proof")"
  assert_equals "an incomplete child with no host refusal behind it stays red" \
    "incomplete" \
    "$(opencode_wave_smoke_outcome "$TEST_HOME/opencode-no-smoke-logs" "" "wt1-verdict(none)")"

  assert_equals "the OpenCode verifier never writes into the HOME it was pointed at" \
    "3" "$(find "$OPENCODE_VERIFY_HOME" -type f | wc -l | tr -d ' ')"
  assert_equals "the OpenCode verifier leaves an operator config under its HOME untouched" \
    "operator config must survive" "$(cat "$OPENCODE_VERIFY_HOME/.config/opencode/opencode.json")"
  assert_equals "the OpenCode verifier leaves operator guidance under its HOME untouched" \
    "operator guidance must survive" "$(cat "$OPENCODE_VERIFY_HOME/.config/opencode/AGENTS.md")"
  assert_equals "the OpenCode verifier leaves the seeded sentinel untouched" \
    "operator sentinel" "$(cat "$OPENCODE_VERIFY_HOME/sentinel.txt")"

  OPENCODE_VERIFY_MUTANT_REPO="$TEST_HOME/opencode-verify-mutant-repo"
  OPENCODE_VERIFY_MUTANT_OUTPUT="$TEST_HOME/opencode-verify-mutant-output"

  write_opencode_verify_mutant_repo() {
    local mutant="$1"
    mkdir -p "$mutant/opencode"
    cp -r "$REPO_ROOT/bootstrap" "$mutant/bootstrap"
    cp -r "$REPO_ROOT/opencode/skills" "$REPO_ROOT/opencode/agents" \
      "$REPO_ROOT/opencode/commands" "$REPO_ROOT/opencode/plugin" \
      "$REPO_ROOT/opencode/dist" "$mutant/opencode/"
    cp "$REPO_ROOT/opencode/package.json" "$REPO_ROOT/opencode/package-lock.json" \
      "$REPO_ROOT/opencode/tsconfig.json" "$mutant/opencode/"
    ln -s "$REPO_ROOT/opencode/node_modules" "$mutant/opencode/node_modules"
    cp -r "$REPO_ROOT/plugin" "$mutant/plugin"
    rm -f "$(printf '%s\n' "$mutant"/opencode/skills/oso-*/SKILL.md | head -1)"
  }

  write_opencode_verify_mutant_repo "$OPENCODE_VERIFY_MUTANT_REPO"
  if HOME="$(mktemp -d)" \
    npm_config_cache="$OPENCODE_VERIFY_NPM_CACHE" \
    PATH="$OPENCODE_VERIFY_CLEAN_PATH" \
    OSO_VERIFY_SKIP_SMOKE=1 \
    bash "$OPENCODE_VERIFY_MUTANT_REPO/bootstrap/verify-opencode.sh" \
    > "$OPENCODE_VERIFY_MUTANT_OUTPUT" 2>&1; then
    opencode_verify_mutant_rc=0
  else
    opencode_verify_mutant_rc=$?
  fi
  assert_equals "removing a source skill wrapper makes the OpenCode verifier fail" \
    "nonzero" "$([ "$opencode_verify_mutant_rc" -ne 0 ] && echo nonzero || echo zero)"
  assert_equals "the mutation failure names the missing artifact" \
    "1" "$(grep -Fc 'expected exactly 9 OpenCode skill wrappers (found 8)' "$OPENCODE_VERIFY_MUTANT_OUTPUT" || true)"
fi

arm_unattended_run
assert_equals "a command-string-carrying wrapper is a KNOWN HOLE at the production boundary gate too: script/ssh/tmux leave the deploy as one quoted token no basename comparison matches, so it passes allowed AND uncounted, the same shape as the xargs hole above" \
  "allow allow allow 0" \
  "$(prod_verdicts_and_residues_for \
    "script -qc 'vercel --prod' /dev/null" \
    "ssh build-host 'vercel --prod'" \
    "tmux new-session -d 'vercel --prod'")"

echo "----"
echo "passed: $pass, failed: $fail, skipped: $skipped"
[ "$fail" -eq 0 ]
