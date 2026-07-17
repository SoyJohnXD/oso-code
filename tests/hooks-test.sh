#!/usr/bin/env bash
# Regression tests for the oso-code state-gate hooks and oso-state helper.
# Runs against an isolated HOME so it never touches real session state.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$REPO_ROOT/plugin"
export HOME="$(mktemp -d)"
export PATH="$PLUGIN/bin:$PATH"
SESSION="test-session"

pass=0
fail=0

assert_allows() {
  local name="$1" hook="$2" input="$3" out
  out="$(printf '%s' "$input" | "$PLUGIN/hooks/$hook")"
  if [ -z "$out" ]; then
    echo "ok: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected allow, got: $out"; fail=$((fail + 1))
  fi
}

assert_denies() {
  local name="$1" hook="$2" input="$3" out
  out="$(printf '%s' "$input" | "$PLUGIN/hooks/$hook")"
  case "$out" in
    *'"permissionDecision":"deny"'*) echo "ok: $name"; pass=$((pass + 1)) ;;
    *) echo "FAIL: $name — expected deny, got: ${out:-<empty>}"; fail=$((fail + 1)) ;;
  esac
}

bash_input() { printf '{"session_id":"%s","tool_input":{"command":"%s"}}' "$SESSION" "$1"; }
edit_input='{"session_id":"test-session","tool_input":{"file_path":"/tmp/x.ts"}}'

# --- Commit gate: state transitions ---
assert_allows "commit with no state file"  block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set mode=plan active_slice=1 verify_green=false
assert_denies "commit while verify is red" block-commit-until-green.sh "$(bash_input 'git commit -m x')"
oso-state --session "$SESSION" set verify_green=true
assert_allows "commit when verify is green" block-commit-until-green.sh "$(bash_input 'git commit -m x')"

# --- Commit gate: matcher hardening (state red for all of these) ---
oso-state --session "$SESSION" set verify_green=false
assert_denies "bypass: git -C <repo> commit"    block-commit-until-green.sh "$(bash_input 'git -C /repo commit -m x')"
assert_denies "bypass: git -c k=v commit"       block-commit-until-green.sh "$(bash_input 'git -c user.email=a@b commit')"
assert_denies "bypass: chained after &&"        block-commit-until-green.sh "$(bash_input 'cd /repo && git commit -m x')"
assert_denies "bypass: double space"            block-commit-until-green.sh "$(bash_input 'git  commit -m x')"
assert_allows "no false positive: echo"         block-commit-until-green.sh "$(bash_input 'echo git commit is blocked')"
assert_allows "no false positive: quoted rg"    block-commit-until-green.sh "$(bash_input 'rg \\"git commit\\" docs/')"
assert_allows "no false positive: git checkout" block-commit-until-green.sh "$(bash_input 'git checkout -b commit')"
assert_allows "non-commit bash is ignored"      block-commit-until-green.sh "$(bash_input 'npm test')"

# --- Commit gate: execution-wrapper bypasses (state still red) ---
assert_denies "bypass: bash -c wraps commit" block-commit-until-green.sh "$(bash_input 'bash -c '\''git commit -m x'\''')"
assert_denies "bypass: sh -c wraps commit"   block-commit-until-green.sh "$(bash_input 'sh -c '\''git commit -m x'\''')"
assert_denies "bypass: eval wraps commit"    block-commit-until-green.sh "$(bash_input 'eval '\''git commit -m x'\''')"
assert_denies "bypass: piped into xargs git commit" block-commit-until-green.sh "$(bash_input 'git diff --name-only | xargs git commit -m x')"
assert_allows "no false positive: bash -c git status" block-commit-until-green.sh "$(bash_input 'bash -c '\''git status'\''')"
assert_allows "no false positive: quoted echo"        block-commit-until-green.sh "$(bash_input 'echo \\"git commit\\"')"

# Double-quoted wrappers reach the hook JSON-escaped (\"…\") the way the harness
# sends them; the payload matcher must see through the escaped quotes too.
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
oso-state --session "$SESSION" clear
oso-state --session "$SESSION" set mode=quick verify_green=false
assert_allows "quick-mode edit is unrestricted" block-edits-without-slice.sh "$edit_input"
oso-state --session "$SESSION" clear

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
stale_lock="$HOME/.local/state/oso-code/$SESSION.state.lock"
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
if [ -s "$HOME/.local/state/oso-code/events.jsonl" ]; then
  echo "ok: gate events are logged"; pass=$((pass + 1))
else
  echo "FAIL: no events.jsonl telemetry written"; fail=$((fail + 1))
fi

# --- Session-end cleanup + path traversal safety ---
oso-state --session "$SESSION" set mode=plan verify_green=true
mkdir -p "$HOME/.local/state/oso-code/$SESSION.state.lock"
printf '{"session_id":"%s"}' "$SESSION" | "$PLUGIN/hooks/cleanup-state.sh"
if [ ! -f "$HOME/.local/state/oso-code/$SESSION.state" ]; then
  echo "ok: session end removes state"; pass=$((pass + 1))
else
  echo "FAIL: state file survived cleanup"; fail=$((fail + 1))
fi
if [ ! -d "$HOME/.local/state/oso-code/$SESSION.state.lock" ]; then
  echo "ok: session end removes leftover lock"; pass=$((pass + 1))
else
  echo "FAIL: lock dir survived cleanup"; fail=$((fail + 1))
fi
touch "$HOME/canary"
printf '{"session_id":"../../canary"}' | "$PLUGIN/hooks/cleanup-state.sh"
if [ -f "$HOME/canary" ]; then
  echo "ok: traversal session id cannot delete outside state dir"; pass=$((pass + 1))
else
  echo "FAIL: path traversal deleted a file outside the state dir"; fail=$((fail + 1))
fi

# --- SessionStart: OSO_STATE_BIN reaches the real oso-state binary ---
# The skills invoke "${OSO_STATE_BIN:-oso-state}"; this hook is what makes that
# env var land in the session, so assert it resolves to a runnable binary.
env_file="$(mktemp)"
CLAUDE_ENV_FILE="$env_file" "$PLUGIN/hooks/persist-state-bin.sh" </dev/null
persisted="$(. "$env_file"; printf '%s' "${OSO_STATE_BIN:-}")"
if [ -n "$persisted" ] && [ -x "$persisted" ]; then
  echo "ok: SessionStart persists OSO_STATE_BIN to an executable"; pass=$((pass + 1))
else
  echo "FAIL: OSO_STATE_BIN not persisted or not executable — got: ${persisted:-<empty>}"; fail=$((fail + 1))
fi
rm -f "$env_file"

# No CLAUDE_ENV_FILE must degrade to a silent no-op (Windows-safe old behavior).
noop_out="$(env -u CLAUDE_ENV_FILE "$PLUGIN/hooks/persist-state-bin.sh" </dev/null)"
if [ -z "$noop_out" ]; then
  echo "ok: SessionStart no-ops when CLAUDE_ENV_FILE is unset"; pass=$((pass + 1))
else
  echo "FAIL: persist hook emitted output with no env file — got: $noop_out"; fail=$((fail + 1))
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
