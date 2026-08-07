#!/usr/bin/env bash
# oso-code bootstrap: prerequisites, MCP wiring, plugin install, legacy cleanup.
# Runs on Linux, macOS, and Windows (Git Bash — required anyway for the hooks).
#
# Usage: install.sh [--yes] [--replace-claude-md] [--no-impeccable] [--no-git-hook]
#   --yes                skip the confirmation prompt (CI / scripted installs)
#   --replace-claude-md  replace ~/.claude/CLAUDE.md entirely instead of
#                        merging the oso-code block between markers
#   --no-impeccable      skip installing the impeccable plugin (on by default)
#   --no-git-hook        skip wiring this repo's core.hooksPath to the shipped
#                        pre-commit gate (on by default)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"
# A backup root of this side's own, one directory below install-codex.sh's, in
# the naming shape lib/install-backup.sh defines. Both halves matter: the shape
# is what lets that library's inventory find these at all, and the deeper root is
# what keeps the two snapshot sets out of each other's reach — its glob never
# recurses, so restore-codex.sh cannot offer one of these as a snapshot to replay
# (they carry no manifest) and cannot count one against a budget that is not this
# side's. The pid is part of the stamp because two runs can start in one second.
BACKUP_ROOT="${HOME}/.local/state/oso-code/claude-backups"
BACKUP_DIR="$BACKUP_ROOT/install-backup-$(date +%Y%m%d-%H%M%S)-$$"
MARKER_START="<!-- oso-code:start -->"
MARKER_END="<!-- oso-code:end -->"

# The retention bound and the backup inventory are ADR-0124's, already bounding
# install-codex.sh's snapshots; a second copy of either here is how the two would
# drift into meaning different things by "300 MiB". Sourced when it is beside this
# script and never fatal when it is not: every other shared value in this file is
# duplicated with a "keep this identical" note precisely because the shape that
# pipes this through curl has no bootstrap/lib to source, and retention is the one
# thing here that can be skipped without changing what gets installed — a run
# without the library prunes nothing and says so, which is what every run did
# before there was a bound at all.
BACKUP_LIB="$SCRIPT_DIR/lib/install-backup.sh"
if [ -f "$BACKUP_LIB" ]; then
  . "$BACKUP_LIB"
fi

# Context budget for the global CLAUDE.md: 8000 bytes ≈ 2k tokens.
# Keep this identical to CLAUDE_MD_BUDGET_BYTES in bootstrap/verify.sh — the
# two scripts run standalone via curl and cannot source a shared file.
CLAUDE_MD_BUDGET_BYTES=8000

ASSUME_YES=false
REPLACE_CLAUDE_MD=false
INSTALL_IMPECCABLE=true
INSTALL_GIT_HOOK=true
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=true ;;
    --replace-claude-md) REPLACE_CLAUDE_MD=true ;;
    --no-impeccable) INSTALL_IMPECCABLE=false ;;
    --no-git-hook) INSTALL_GIT_HOOK=false ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

info() { printf '[oso-code] %s\n' "$1"; }
warn() { printf '[oso-code] WARNING: %s\n' "$1" >&2; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }

run_or_fail() {
  local label="$1"; shift
  local output
  if ! output="$("$@" 2>&1)"; then
    fail "$label failed: $output"
  fi
}

# Wiring is best-effort: a single MCP or plugin failure never aborts the install.
# Outcomes accumulate here and print as a summary at the end (print_wiring_summary),
# because later steps scroll an inline warning off screen.
# Each entry: "OK|<component>|<note>" or "FAILED|<component>|<reason> — fix: <command>".
WIRING_SUMMARY=()
wiring_ok()   { WIRING_SUMMARY+=("OK|$1|$2"); }
wiring_fail() { WIRING_SUMMARY+=("FAILED|$1|$2"); }

run_wiring() {
  # Run a wiring command without aborting; on failure echo its output so the
  # caller can record the reason. Idempotence is the command's own exit code and
  # never its prose: `claude plugin install` and `cargo install` both exit 0 on an
  # already-installed package, while `cargo install` exits 101 when a binary it
  # does not track already sits in the destination — a hard failure whose message
  # also says "already".
  local output
  if output="$("$@" 2>&1)"; then
    return 0
  fi
  printf '%s' "$output"
  return 1
}

confirm_plan() {
  local artifact_count=0 rel
  while IFS= read -r rel; do
    # A CRLF checkout of the manifest — what Git for Windows' default autocrlf
    # hands a Windows operator — puts a trailing CR on every path, and no
    # "$CLAUDE_DIR/$rel" then exists: this count announces 0, remove_legacy_artifacts
    # removes nothing, and verify.sh confirms the cleanup as done. .gitattributes
    # pins the file, but it renormalizes no clone that already exists, so each of
    # the three readers drops the CR itself.
    rel="${rel%$'\r'}"
    case "$rel" in ''|'#'*) continue ;; esac
    if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
      artifact_count=$((artifact_count + 1))
    fi
  done < "$SCRIPT_DIR/gentle-manifest.txt"

  info "this will:"
  info "  - install/verify MCPs (engram, context7, fallow) and the oso-code plugin"
  if [ "$INSTALL_IMPECCABLE" = true ]; then
    info "  - install the impeccable plugin (opt out with --no-impeccable)"
  else
    info "  - skip impeccable (--no-impeccable)"
  fi
  if [ "$INSTALL_GIT_HOOK" = true ]; then
    info "  - point this repo's core.hooksPath at the shipped pre-commit gate, unless another tool already owns its hooks (opt out with --no-git-hook)"
  else
    info "  - skip the git pre-commit gate (--no-git-hook)"
  fi
  info "  - remove $artifact_count legacy gentle-ai artifacts from ~/.claude (backed up first)"
  info "  - clean legacy hook entries from settings.json (backed up first)"
  if [ "$REPLACE_CLAUDE_MD" = true ]; then
    info "  - REPLACE ~/.claude/CLAUDE.md entirely (backed up first)"
  else
    info "  - merge the oso-code block into ~/.claude/CLAUDE.md between markers (backed up first)"
  fi
  # Created before the line that promises it, rather than at the first copy: that
  # first mkdir used to sit in phase 6 of 7, so every run that died earlier left
  # the operator reading a path that had never existed. An answer of no takes the
  # still-empty directory straight back out — nothing was backed up, so nothing
  # is left behind, and repeated declines cannot silt up the state dir.
  mkdir -p "$BACKUP_DIR"
  info "  - backup location: $BACKUP_DIR"

  if [ "$ASSUME_YES" = false ]; then
    printf '[oso-code] proceed? [y/N] '
    read -r answer
    case "$answer" in
      [Yy]|[Yy][Ee][Ss]) ;;
      *) rmdir "$BACKUP_DIR" 2>/dev/null || true; fail "aborted by user" ;;
    esac
  fi
}

ensure_prerequisites() {
  command -v git >/dev/null || fail "git is required"
  command -v claude >/dev/null || fail "Claude Code CLI is required: https://code.claude.com"
  # jq is needed only by this script (settings.json surgery) — the runtime
  # hooks are pure bash and work without it.
  if command -v jq >/dev/null; then
    return 0
  fi
  info "installing jq (needed by this installer for settings.json cleanup)"
  if command -v brew >/dev/null; then brew install jq
  elif command -v pacman >/dev/null; then sudo pacman -S --noconfirm jq
  elif command -v apt-get >/dev/null; then sudo apt-get install -y jq
  elif command -v dnf >/dev/null; then sudo dnf install -y jq
  elif command -v winget >/dev/null; then winget_install_per_user jqlang.jq || true
  else fail "could not detect a package manager — install jq manually, then re-run"
  fi
  # On Windows, winget installs do not join PATH until a new shell.
  command -v jq >/dev/null || fail "jq installed but not on PATH yet — open a new terminal and re-run"
}

ensure_node() {
  # context7 ships in the oso-code plugin and starts via npx. Ensure Node the
  # same way we ensure jq, but never abort: without Node, context7 simply will
  # not connect until the operator installs it (surfaced in the wiring summary).
  command -v npx >/dev/null && return 0
  info "installing Node.js (needed by the context7 MCP, which runs via npx)"
  if   command -v brew    >/dev/null; then brew install node || true
  elif command -v pacman  >/dev/null; then sudo pacman -S --noconfirm nodejs npm || true
  elif command -v apt-get >/dev/null; then sudo apt-get install -y nodejs npm || true
  elif command -v dnf     >/dev/null; then sudo dnf install -y nodejs npm || true
  elif command -v winget  >/dev/null; then winget_install_per_user OpenJS.NodeJS.LTS || true
  else warn "no package manager detected — install Node.js manually so context7 can start"; return 0
  fi
  command -v npx >/dev/null \
    || warn "Node.js not on PATH yet — context7 will start once npx is available (open a new terminal if you just installed it)"
}

# Provisioning on Windows without asking for administrator rights: the per-user
# scope first, and the machine-wide retry that raises a UAC prompt only where the
# operator answered yes to raising it. The flags are the other half of running
# unattended — winget otherwise stops on package and source agreements in a shell
# nobody is watching. install.ps1 carries this same policy for the runs that start
# there; the two scripts run standalone via curl and cannot source a shared file.
# It also reads the answer to this same question with `-match '^y(es)?$'`, which
# PowerShell matches case-insensitively, so the prompts here take y and yes in any
# case too: an operator meets whichever prompt their entry point raises, and `Yes`
# cannot mean elevate on one half and skip on the other.
#
# That twin tells an unsupported scope from a transient failure by winget's own
# exit code (0x8A150010, APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER), which no
# shell can read here: $? is eight bits wide and that HRESULT does not fit in it.
# So this half asks about ANY per-user failure — one prompt too many at worst,
# never an elevation prompt the operator did not ask for.
#
# The guard is what the callers add: under `set -euo pipefail` a bare winget call
# that exits non-zero — an already-installed package, an unreachable source — took
# the whole installer down in phase 1 of 7.
winget_install_per_user() {
  local winget_id="$1" answer
  local manual="winget install --id $winget_id --exact"
  # One list for both calls, so the retry differs from the first attempt in the
  # scope and in nothing else — the shape install.ps1's own $common builds.
  local unattended_install=(install --id "$winget_id" --exact
    --accept-package-agreements --accept-source-agreements --silent)
  if winget "${unattended_install[@]}" --scope user; then
    return 0
  fi
  if [ "$ASSUME_YES" = true ]; then
    warn "could not install $winget_id per-user, and an unattended run never asks Windows for administrator approval — install it yourself, then re-run: $manual"
    return 1
  fi
  printf '[oso-code] could not install %s per-user. Retry machine-wide? Windows will ask for administrator approval. [y/N] ' "$winget_id"
  read -r answer
  case "$answer" in
    [Yy]|[Yy][Ee][Ss]) ;;
    *) warn "skipping the machine-wide install of $winget_id — run it yourself when ready: $manual"; return 1 ;;
  esac
  winget "${unattended_install[@]}" \
    || { warn "the machine-wide install of $winget_id failed — fix: $manual"; return 1; }
}

# Every mutation main() makes, walked in its own order against whether a copy of
# what it replaces exists first — which is what this function closes for phases
# 2 to 5, where the gaps were:
#   1/7  jq, Node.js and fallow-mcp package installs — additive, nothing replaced.
#   2/7  `claude mcp add` and `claude plugin marketplace add` / `plugin install`
#        write all three config locations below, and a `marketplace add` against
#        a name already registered can repoint it — which is the very thing
#        ensure_marketplace_source stops to ask the operator about, in
#        settings.json's extraKnownMarketplaces as much as in the registration
#        file beside it.
#   3/7  migrate_context7 runs `claude mcp remove --scope user context7`
#        unconditionally, before anything has confirmed the plugin-shipped
#        replacement registered: the one outright DELETE this installer performs
#        on state it did not create, and the reason the copy cannot wait.
#        install_plugin's own marketplace add and plugin install write
#        settings.json again on the way there.
#   4/7  core.hooksPath is deliberately NOT copied — see wire_git_commit_hook.
#   5/7  wire_impeccable's plugin install writes settings.json a third time, and
#        an enabledPlugins entry the operator set to false is what it flips back
#        to true. The opt-out marker beside it is this installer's own one-line
#        record, rewritten by design; operator state it is not.
#   6/7 and 7/7  legacy artifacts and CLAUDE.md are copied by the function that
#        changes them, and nothing earlier in the run touches either.
#        settings.json is the exception this function exists to cover: by the
#        time remove_legacy_settings_entries and ensure_output_style rewrite it,
#        three earlier phases have already written it, so the copy taken here is
#        the only one that can still hold what the operator brought — and, so a
#        recovery cannot pick the wrong one, the only one taken at all.
# User-scope MCP servers live in ~/.claude.json, the client keeps its plugin and
# marketplace registrations at the top of ~/.claude/plugins, and it records
# extraKnownMarketplaces and enabledPlugins in ~/.claude/settings.json. The
# registration files are taken as a glob rather than by name: the directory is
# documented and the file names inside it are the client's, so a list here would
# go on succeeding while protecting nothing the day one is renamed. What is under
# those subdirectories — the unpacked marketplaces and the plugin cache — is
# deliberately left out: hundreds of MiB the client re-fetches on its own.
# settings.json alone lands at the top of the backup rather than under
# client-config/, beside the CLAUDE.md and the legacy artifacts the later phases
# put there: that is the ~/.claude-relative layout the operator is pointed at,
# and it keeps this file at one path in the backup instead of two.
backup_client_config() {
  local source relative
  for source in "$HOME/.claude.json" "$CLAUDE_DIR"/plugins/*.json; do
    [ -f "$source" ] || continue
    relative="${source#"$HOME"/}"
    mkdir -p "$BACKUP_DIR/client-config/$(dirname "$relative")"
    cp -a "$source" "$BACKUP_DIR/client-config/$relative"
  done
  if [ -f "$CLAUDE_DIR/settings.json" ]; then
    mkdir -p "$BACKUP_DIR"
    cp -a "$CLAUDE_DIR/settings.json" "$BACKUP_DIR/settings.json"
  fi
}

wire_mcps() {
  # engram + fallow wire here; context7 rides the oso-code plugin and is
  # migrated in install_plugin. Every outcome is recorded, never fatal.
  wire_engram
  wire_fallow
}

wire_engram() {
  # engram: persistent memory (plugin that ships its own MCP server)
  claude plugin marketplace add Gentleman-Programming/engram >/dev/null 2>&1 || true
  local err
  if err="$(run_wiring claude plugin install engram@engram)"; then
    wiring_ok engram "plugin installed"
  else
    wiring_fail engram "plugin install failed: $err — fix: claude plugin install engram@engram"
  fi
}

wire_fallow() {
  # fallow: TS/JS codebase analysis, used by the debt-sweep phase
  if fallow_is_wired; then
    wiring_ok fallow "already wired"
    return 0
  fi
  local err fix="cargo install fallow-mcp, then claude mcp add --scope user fallow -- fallow-mcp"
  if ! command -v fallow-mcp >/dev/null; then
    if ! command -v cargo >/dev/null; then
      wiring_fail fallow "no fallow-mcp binary and no cargo to build it — fix: install Rust, then $fix"
      return 0
    fi
    info "installing fallow-mcp via cargo (this can take a few minutes)"
    if ! err="$(run_wiring cargo install fallow-mcp)"; then
      wiring_fail fallow "cargo install fallow-mcp failed: $err — fix: $fix"
      return 0
    fi
  fi
  # `claude mcp add` is the one wiring step that reports an existing entry as a
  # failure (exit 1, "already exists in user config"), which the health check at
  # the top of this function only misses when it could not run at all.
  if err="$(run_wiring claude mcp add --scope user fallow -- fallow-mcp)"; then
    wiring_ok fallow "wired (user scope)"
  elif fallow_is_wired; then
    wiring_ok fallow "already wired"
  else
    wiring_fail fallow "mcp add failed: $err — fix: claude mcp add --scope user fallow -- fallow-mcp"
  fi
}

fallow_is_wired() { claude mcp get fallow >/dev/null 2>&1; }

# Whether the operator opted out is DATA verify.sh reads, never a flag it can see:
# while its impeccable check is hard, an install that skipped the plugin on purpose
# has no green path and no way to tell that choice from a broken install. Keep this
# path identical to IMPECCABLE_OPT_OUT_MARKER in bootstrap/verify.sh — the two
# scripts run standalone via curl and cannot source a shared file.
IMPECCABLE_OPT_OUT_MARKER="${HOME}/.local/state/oso-code/impeccable-opt-out"

wire_impeccable() {
  # Third-party plugin backing the front-surface design bar (its CLI runs via npx).
  # Clearing the marker is the other half of the contract: left behind by an earlier
  # opt-out, it would report a genuinely failed install as the operator's choice
  # forever — a blind spot worse than the one the marker closes.
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
  claude plugin marketplace add pbakaus/impeccable >/dev/null 2>&1 || true
  local err
  if err="$(run_wiring claude plugin install impeccable@impeccable)"; then
    wiring_ok "impeccable (plugin)" "installed"
  else
    wiring_fail "impeccable (plugin)" "install failed: $err — fix: claude plugin install impeccable@impeccable"
  fi
}

skip_impeccable() {
  info "skipping impeccable (--no-impeccable)"
  mkdir -p "$(dirname "$IMPECCABLE_OPT_OUT_MARKER")"
  printf 'skipped by --no-impeccable on %s\n' "$(date +%Y-%m-%d)" > "$IMPECCABLE_OPT_OUT_MARKER"
}

MARKETPLACE_SOURCE="SoyJohnXD/oso-code"

install_plugin() {
  ensure_marketplace_source
  run_or_fail "oso-code plugin install" claude plugin install oso-code@oso-code
  # `claude plugin install` tolerates an already-installed plugin without
  # refreshing it, so without these a re-run after a release stays on the old
  # version. Warn-not-abort: an offline re-run must not die here.
  claude plugin marketplace update oso-code \
    || warn "could not refresh the oso-code marketplace — fix: claude plugin marketplace update oso-code"
  claude plugin update oso-code@oso-code \
    || warn "could not update the oso-code plugin — fix: claude plugin update oso-code@oso-code"
  migrate_context7
}

# GitHub is the distribution source so `claude plugin update` pulls new versions
# without re-cloning. A local clone is only ever the offline fallback, and one
# already registered is never repointed behind the operator's back: this plugin is
# developed from a clone like that, where an unasked repoint would swap unreleased
# edits for the published release.
ensure_marketplace_source() {
  local clone_path
  clone_path="$(local_marketplace_path)"
  if [ -n "$clone_path" ]; then
    warn "the oso-code marketplace is registered as the local directory $clone_path — \`claude plugin marketplace update\` refreshes nothing there, and \`claude plugin update\` installs whatever that working tree currently holds"
    github_marketplace_is_reachable || return 0
    repoint_approved "$clone_path" || return 0
  fi
  register_github_marketplace
}

# The working tree the oso-code marketplace is registered from, or nothing when it
# comes from a remote or is not registered at all. `directory` is the source kind
# whose refresh never git-pulls, which is what makes it a dead end. A client that
# cannot answer says so and reads as "no local clone": refusing to install against
# one too old to answer would be the worse failure of the two.
local_marketplace_path() {
  local registry
  registry="$(claude plugin marketplace list --json 2>&1)" || {
    warn "could not read which source each marketplace is registered from ($registry)"
    return 0
  }
  jq -r '.[] | select(.name == "oso-code" and .source == "directory") | .path' <<< "$registry" || true
}

github_marketplace_is_reachable() {
  GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code "https://github.com/$MARKETPLACE_SOURCE.git" HEAD >/dev/null 2>&1
}

# confirm_plan's consent idiom, except "no" is a supported answer rather than an
# abort: staying on a local clone is a legitimate choice to make.
repoint_approved() {
  local answer
  if [ "$ASSUME_YES" = true ]; then
    return 0
  fi
  printf '[oso-code] repoint it at %s? uncommitted work in %s stops loading. [y/N] ' \
    "$MARKETPLACE_SOURCE" "$1"
  read -r answer
  case "$answer" in [Yy]|[Yy][Ee][Ss]) return 0 ;; esac
  info "keeping the local source — repoint anytime: claude plugin marketplace add $MARKETPLACE_SOURCE"
  return 1
}

register_github_marketplace() {
  local output failure
  if output="$(claude plugin marketplace add "$MARKETPLACE_SOURCE" 2>&1)"; then
    return 0
  fi
  failure="$(classify_marketplace_add_failure "$output")"
  if [ "$failure" = unreachable ] && register_clone_marketplace "$REPO_ROOT"; then
    return 0
  fi
  warn "could not add the oso-code marketplace from $MARKETPLACE_SOURCE ($failure): $output"
  run_or_fail "marketplace refresh" claude plugin marketplace update oso-code
}

# Why a `claude plugin marketplace add` failed, read off the client's own report.
# Only an unreachable remote earns the local fallback: under a policy block, a
# malformed manifest or a seed-managed name, repointing at a working tree would
# bury the real problem under a source the operator never chose. Prose is the only
# signal the client gives, so anything unrecognised classifies as `unknown` and
# takes no fallback — a reworded message in some future release costs a fallback,
# never a silent repoint.
classify_marketplace_add_failure() {
  case "$1" in
    *"is seed-managed"*) printf 'seed-managed' ;;
    *"blocked by enterprise policy"* | *"not in the allowed marketplace list"*) printf 'policy-blocked' ;;
    *"Invalid marketplace source format"*) printf 'invalid-source' ;;
    *"Failed to parse marketplace file"* | *"Marketplace file not found"*) printf 'invalid-manifest' ;;
    *"Failed to clone marketplace repository"*) printf 'unreachable' ;;
    *) printf 'unknown' ;;
  esac
}

# Registering a working tree as a plugin source is only safe when it is one. Piped
# through `curl | bash` there is no $BASH_SOURCE, so $REPO_ROOT lands on `/` under
# bash 3.2 or on the parent of the operator's cwd elsewhere, and a marketplace
# manifest is the one thing that tells a real clone from either.
register_clone_marketplace() {
  local clone="$1" output
  [ -f "$clone/.claude-plugin/marketplace.json" ] || return 1
  if ! output="$(claude plugin marketplace add "$clone" 2>&1)"; then
    warn "the offline fallback could not register $clone either ($(classify_marketplace_add_failure "$output")): $output"
    return 1
  fi
  warn "$MARKETPLACE_SOURCE is unreachable, so the oso-code marketplace now points at $clone — the plugin loads from that working tree, edits and all, and \`claude plugin marketplace update\` cannot refresh a local source. Revert once you are online: claude plugin marketplace add $MARKETPLACE_SOURCE"
  return 0
}

migrate_context7() {
  # context7 now ships in the oso-code plugin's .mcp.json and auto-registers
  # with the plugin. Drop any legacy hand-added user-scope entry so there is
  # exactly one source of truth. Tolerate its absence.
  claude mcp remove --scope user context7 >/dev/null 2>&1 || true
  if command -v npx >/dev/null; then
    wiring_ok context7 "ships with the oso-code plugin"
  else
    wiring_fail context7 "plugin wired but npx (Node.js) is missing, so it cannot start — fix: install Node.js, then restart Claude Code"
  fi
}

# The shipped git hook, next to the lib it reads session state with. core.hooksPath
# names its directory, so both copies work: this clone, and the plugin cache a
# marketplace install unpacks.
GIT_HOOKS_DIR="$REPO_ROOT/plugin/git-hooks"

# The commit gate's primary layer, at the commit's own boundary: a git hook parses
# no command line, so it sees the wrappers, aliases, remote shells and absolute git
# paths a PreToolUse matcher structurally cannot. Wired per repo because
# core.hooksPath is a repo setting — and never over another tool's hooks, because
# setting it makes git ignore .git/hooks entirely and would silently disable
# whatever that team relies on.
# That refusal is also why the prior value is not backed up: git_hooks_owner names
# any core.hooksPath that is not this same directory and any hook standing in
# .git/hooks, so the only value this can ever write over is absent or already
# ours. A copy of something nothing destroys would make the backup set look more
# protective than it is.
wire_git_commit_hook() {
  local owner err
  owner="$(git_hooks_owner)"
  if [ -n "$owner" ]; then
    wiring_fail "git commit hook" "not wired in $REPO_ROOT — $owner already owns this repo's hooks and core.hooksPath would take it out of git's reach; the PreToolUse commit gate still applies here — fix: to run both, call $GIT_HOOKS_DIR/pre-commit from your own pre-commit"
    return 0
  fi
  if err="$(git -C "$REPO_ROOT" config core.hooksPath "$GIT_HOOKS_DIR" 2>&1)"; then
    wiring_ok "git commit hook" "core.hooksPath wired in $REPO_ROOT — for another repo: git -C <repo> config core.hooksPath $GIT_HOOKS_DIR"
  else
    wiring_fail "git commit hook" "git config failed: $err — fix: git -C $REPO_ROOT config core.hooksPath $GIT_HOOKS_DIR"
  fi
}

# What already owns this repo's hooks, named so the summary can say which: a foreign
# core.hooksPath (Husky, lefthook, pre-commit), or any hook under .git/hooks, which
# core.hooksPath would stop git from ever reading again. The .sample files git ships
# are nobody's hooks, and an unmatched glob is a path no file test accepts.
git_hooks_owner() {
  local configured git_dir hook
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
  # Normalized on both sides rather than byte-compared: what git stored is not the
  # string this script built, so on Windows a byte comparison finds a foreign owner
  # in this installer's OWN wiring on every run after the first.
  if [ -n "$configured" ] &&
     [ "$(normalized_path "$configured")" != "$(normalized_path "$GIT_HOOKS_DIR")" ]; then
    printf 'core.hooksPath=%s' "$configured"
    return 0
  fi
  git_dir="$(git -C "$REPO_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
  for hook in "$git_dir"/hooks/*; do
    case "$hook" in *.sample) continue ;; esac
    if [ -f "$hook" ]; then
      printf '%s' "$hook"
      return 0
    fi
  done
}

# One spelling for a directory Windows writes four ways, so a comparison can be
# about the directory instead of about who built the string. $GIT_HOOKS_DIR comes
# from `cd`+`pwd`, which under Git Bash reads /c/Users/…, but MSYS argv conversion
# rewrites a POSIX-form argument before a native git.exe ever sees it — so
# C:/Users/… is what lands in .git/config, and the two are never byte-equal. A
# backslash spelling, a lowercase drive letter and a trailing slash are the other
# ways the same directory comes back out of a config someone else wired.
# It builds a comparison key, not a canonical path: /u/jane comes back as U:/jane,
# and a backslash inside a POSIX filename comes back as a separator, so what it
# returns can be a spelling no filesystem holds. What makes that safe is that every
# comparison folds BOTH sides through it — a fold that fires where no Windows path
# exists fires on both sides and cannot change a verdict. Valid inside one
# comparison only: never stored, never printed back to an operator.
# Keep this identical to normalized_path in bootstrap/verify.sh — the two scripts
# run standalone via curl and cannot source a shared file.
normalized_path() {
  local path="${1//\\//}"
  case "$path" in
    /[A-Za-z]/*|/[A-Za-z])
      path="${path#/}"              # /c/Users/x -> c/Users/x
      path="${path%%/*}:${path#?}"  # c/Users/x  -> c:/Users/x
      ;;
  esac
  # bash 3.2 has no ${var^^}, so the drive letter costs a fork — and only where it
  # is the lowercase spelling that needs one.
  case "$path" in
    [a-z]:*) path="$(printf '%s' "${path%%:*}" | tr 'a-z' 'A-Z'):${path#*:}" ;;
  esac
  # A trailing separator names the same directory. `/` is a root, not a trailing
  # separator, so it keeps its own name.
  case "$path" in ?*/) path="${path%/}" ;; esac
  printf '%s' "$path"
}

print_wiring_summary() {
  info "wiring summary:"
  local entry status component note
  # An array with no elements expands to "unbound variable" under `set -u` on bash
  # < 4.4, which is what macOS ships; the `+` form expands to nothing there instead.
  # wire_engram appends before this runs today, so the abort waits for the first
  # wiring path that records nothing at all.
  for entry in ${WIRING_SUMMARY[@]+"${WIRING_SUMMARY[@]}"}; do
    IFS='|' read -r status component note <<< "$entry"
    info "  $component: $status — $note"
  done
}

remove_legacy_artifacts() {
  local manifest="$SCRIPT_DIR/gentle-manifest.txt"
  local removed=0
  local rel target
  mkdir -p "$BACKUP_DIR"
  while IFS= read -r rel; do
    # The CR strip confirm_plan explains, and it runs BEFORE the guard below
    # rather than after: a line that is nothing but a CR has to read as blank,
    # or $rel is empty, "$CLAUDE_DIR/" exists, and the rm below takes ~/.claude.
    rel="${rel%$'\r'}"
    case "$rel" in ''|'#'*) continue ;; esac
    target="$CLAUDE_DIR/$rel"
    if [ -e "$target" ] || [ -L "$target" ]; then
      mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
      cp -a "$target" "$BACKUP_DIR/$rel"
      rm -rf "$target"
      removed=$((removed + 1))
    fi
  done < "$manifest"
  info "removed $removed legacy artifacts (backup: $BACKUP_DIR)"
  if [ -x "$HOME/.local/bin/gentle-ai" ]; then
    info "NOTE: the gentle-ai binary is still at ~/.local/bin/gentle-ai — remove it manually when ready"
  fi
}

# No copy here, and none in ensure_output_style below: backup_client_config took
# the pre-image in phase 2, before the client wrote this file three times, and a
# copy taken now would hold the run's own work under the same name.
remove_legacy_settings_entries() {
  local settings="$CLAUDE_DIR/settings.json"
  [ -f "$settings" ] || return 0
  # Drop gentle-ai hook entries; the output style is repointed separately by
  # ensure_output_style.
  jq '(.hooks // {}) |= with_entries(
        .value |= map(select(
          [.hooks[]?.command // ""]
          | any(test("check-plan-contract|clean-code-gate|skill-registry-refresh|gentle-ai"))
          | not
        ))
      )
      | .hooks |= with_entries(select(.value | length > 0))' \
    "$settings" > "${settings}.tmp"
  mv "${settings}.tmp" "$settings"
  info "cleaned legacy hook entries from settings.json"
}

ensure_output_style() {
  # Point Claude Code at the Oso output style: fresh-set it on a clean machine
  # (no style yet, absent or dangling "Gentleman"), but never override a style
  # the operator chose on purpose — just show how to switch. The manifest removes
  # output-styles/gentleman.md, so a lingering "Gentleman" pointer would dangle.
  local settings="$CLAUDE_DIR/settings.json"
  local current=absent
  [ -f "$settings" ] && current="$(jq -r '.outputStyle // "absent"' "$settings")"

  case "$current" in
    absent | Gentleman | Oso)
      mkdir -p "$CLAUDE_DIR"
      if [ -f "$settings" ]; then
        jq '.outputStyle = "Oso"' "$settings" > "${settings}.tmp"
        mv "${settings}.tmp" "$settings"
      else
        jq -n '{outputStyle: "Oso"}' > "$settings"
      fi
      info "output style set to Oso"
      ;;
    *)
      info "keeping your output style \"$current\" — switch to Oso anytime via /config → output style"
      ;;
  esac
}

merge_global_claude_md() {
  local target="$CLAUDE_DIR/CLAUDE.md"
  mkdir -p "$BACKUP_DIR" "$CLAUDE_DIR"
  [ -f "$target" ] && cp -a "$target" "$BACKUP_DIR/CLAUDE.md"

  if [ "$REPLACE_CLAUDE_MD" = true ] || [ ! -f "$target" ]; then
    {
      printf '%s\n' "$MARKER_START"
      cat "$SCRIPT_DIR/claude-global.md"
      printf '%s\n' "$MARKER_END"
    } > "$target"
    info "wrote ~/.claude/CLAUDE.md (previous version, if any, is in the backup)"
    return 0
  fi

  # The markers are matched with a trailing CR stripped rather than byte-exact.
  # This file is the OPERATOR's, not one this installer owns, and a Windows
  # editor rewrites it CRLF: the markers an earlier run wrote come back as
  # "<!-- oso-code:start -->\r" and equal neither test, so the strip below turns
  # into a no-op and the block is appended a SECOND time — a third run a third
  # time — until the size warning at the end of this function is the only
  # symptom. `print` writes $0, so their own line endings survive untouched.
  local without_block
  without_block="$(awk -v start="$MARKER_START" -v end="$MARKER_END" '
    { marker = $0; sub(/\r$/, "", marker) }
    marker == start { skipping = 1; next }
    marker == end   { skipping = 0; next }
    !skipping       { print }
  ' "$target")"
  {
    printf '%s\n' "$without_block"
    printf '%s\n' "$MARKER_START"
    cat "$SCRIPT_DIR/claude-global.md"
    printf '%s\n' "$MARKER_END"
  } > "$target"
  info "merged the oso-code block into ~/.claude/CLAUDE.md (personal content preserved)"

  local size
  size="$(wc -c < "$target")"
  if [ "$size" -gt "$CLAUDE_MD_BUDGET_BYTES" ]; then
    warn "CLAUDE.md is still ${size} bytes — review the non-oso content; every session pays for it"
  fi
}

# Every install used to leave one more backup directory in the operator's home,
# forever. The bound is ADR-0124's, reached through the shared library rather
# than restated: total size rather than count, and the newest snapshot kept
# whatever the budget says, so the run that just installed is never the one a
# tight budget empties.
# What this side does NOT carry is that policy's restore-verified gate. There,
# pruning waits until restore-codex.sh has proved a replay works on this machine,
# because a broken automated restore must keep its fuel. D11 gives this side no
# restore command at all: recovery is a copy the operator makes by hand out of a
# directory of plain files, so there is no replay whose provenness could be in
# doubt — and a gate on a marker only the Codex restore can ever write would
# leave this unbounded on every Claude-only machine, which is the defect it is
# here to close. Runs after the install, so a run that died half way keeps every
# older snapshot it might be recovered from.
prune_install_backups() {
  if ! command -v install_backups_over_budget >/dev/null 2>&1; then
    info "backup retention: skipped — $BACKUP_LIB is not beside this script, so older backups under $BACKUP_ROOT stay until you remove them"
    return 0
  fi
  local backup budget_kib
  budget_kib="$(install_backup_budget_kib)"
  install_backups_over_budget "$BACKUP_ROOT" | while IFS= read -r backup; do
    rm -rf "$backup"
    info "backup retention: removed $backup (over the ${budget_kib} KiB budget)"
  done
}

# D11 is honest backups, not a transaction: there is no restore command on this
# side, so the recovery path is the operator's own `cp -a` and they have to be
# told at the end of the run exactly how far it reaches. restore-codex.sh names
# the one thing its restore cannot revert for the same reason — here the whole
# recovery is manual, so the whole boundary gets named.
report_backup_coverage() {
  info "backup: $BACKUP_DIR"
  info "  it holds what this run replaced, as it stood before the run started — Claude Code's user config and plugin registrations, settings.json, CLAUDE.md, and every legacy artifact removed. Copy one back by hand to undo it; there is no restore command on this side."
  info "  it does not undo: packages installed (jq, Node.js, fallow-mcp); the plugin and marketplace CONTENT the client downloaded, since only the registration files are copied; and core.hooksPath, which this wires per repo and only where nothing else owned it — clear it with: git -C $REPO_ROOT config --unset core.hooksPath"
  info "  releases before this one wrote their backups to ~/.local/state/oso-code/backup-* instead, outside this root: nothing here lists or prunes those, so remove them yourself once you no longer want them"
}

main() {
  confirm_plan
  info "1/7 prerequisites"
  ensure_prerequisites
  ensure_node
  info "2/7 MCP wiring"
  backup_client_config
  wire_mcps
  info "3/7 oso-code plugin"
  install_plugin
  info "4/7 git commit hook"
  if [ "$INSTALL_GIT_HOOK" = true ]; then
    wire_git_commit_hook
  else
    info "skipping the git commit hook (--no-git-hook)"
  fi
  info "5/7 impeccable"
  if [ "$INSTALL_IMPECCABLE" = true ]; then
    wire_impeccable
  else
    skip_impeccable
  fi
  info "6/7 legacy cleanup"
  remove_legacy_artifacts
  remove_legacy_settings_entries
  ensure_output_style
  info "7/7 global CLAUDE.md"
  merge_global_claude_md
  print_wiring_summary
  prune_install_backups
  report_backup_coverage
  info "done — restart your Claude Code sessions to pick everything up"
}

# Installing is what running this file does and sourcing it is not: the suite reads
# the two decisions that can repoint the marketplace by sourcing this and calling
# them directly. Piped through `curl | bash` there is no $BASH_SOURCE at all, and
# that shape has to keep installing.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main
fi
