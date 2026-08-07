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

# Every helper and value below marked "keep this identical" is duplicated byte for
# byte in bootstrap/verify.sh, and no constraint keeps them apart: both scripts
# resolve $SCRIPT_DIR from $BASH_SOURCE and read files beside it, so neither has
# ever run from a pipe — `cat bootstrap/install.sh | bash` dies on the $SCRIPT_DIR
# line under `set -u` — and this one already sources bootstrap/lib/*.sh below. The
# copies are debt, to be replaced by a shared file under that same lib/; until
# then the parity notes and the cases in tests/hooks-test.sh behind them are what
# holds the two sides equal.

# The retention bound and the backup inventory are ADR-0124's, already bounding
# install-codex.sh's snapshots; a second copy of either here is how the two would
# drift into meaning different things by "300 MiB". Sourced when it is beside this
# script and never fatal when it is not: retention is the one thing here that can
# be skipped without changing what gets installed, so a copy of this file reached
# by some path with no bootstrap/lib beside it prunes nothing and says so, which is
# what every run did before there was a bound at all.
BACKUP_LIB="$SCRIPT_DIR/lib/install-backup.sh"
if [ -f "$BACKUP_LIB" ]; then
  . "$BACKUP_LIB"
fi

# resolve_fallow_mcp_command, for the same reason and on the same terms: fallow
# now arrives as an npm package whose Windows shim is a .cmd no POSIX PATH search
# finds, and the Codex renderer already had to answer which spelling a client can
# spawn. Sourced beside this script and never fatal without it — where the library
# is not there, wire_fallow falls back to the bare name PATH resolves everywhere
# except Windows.
FALLOW_COMMAND_LIB="$SCRIPT_DIR/lib/codex-managed-config.sh"
if [ -f "$FALLOW_COMMAND_LIB" ]; then
  . "$FALLOW_COMMAND_LIB"
fi

# Context budget for the global CLAUDE.md: 8000 bytes ≈ 2k tokens.
# Keep this identical to CLAUDE_MD_BUDGET_BYTES in bootstrap/verify.sh.
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
  # never its prose: `claude plugin install` and `npm install --global` both exit
  # 0 on a package that is already installed, while "already" in a message is no
  # verdict at all — `claude mcp add` says exactly that on the exit 1 that means
  # it refused to touch an entry someone else put there.
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
  # Named on its own line because it is the one step that downloads a binary from
  # outside npm and writes it outside ~/.claude — and the one the operator can
  # already have satisfied, in which case nothing is fetched at all.
  info "  - download engram $SUPPORTED_ENGRAM_VERSION (checksum-verified) into ~/.local/bin, unless Claude Code can already resolve an engram"
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
  # Named here because one half of it is the only operator value this installer
  # writes over, and consent to that belongs in the plan the operator answers.
  info "  - publish OSO_STATE_BIN into ~/.claude/settings.json so every skill reaches oso-state by path, and on Windows the Git Bash path the client spawns the hooks through — replacing a stored one only where it no longer resolves (backed up first)"
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
# there, in its own copy: PowerShell can share no code with this file.
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

# The pre-image of the client state the phases after this one rewrite, taken
# before the first of them runs and only here, so a recovery cannot pick the wrong
# copy. It cannot wait: migrate_context7's `claude mcp remove` is an outright
# delete of state this installer did not create, and four phases write
# settings.json — marketplace add, plugin install, publish_client_environment,
# wire_impeccable — so a copy taken any later holds this run's own work instead of
# what the operator brought. core.hooksPath is the one mutation deliberately not
# copied; see wire_git_commit_hook.
# User-scope MCP servers live in ~/.claude.json, the client keeps its plugin and
# marketplace registrations at the top of ~/.claude/plugins, and it records
# extraKnownMarketplaces and enabledPlugins in ~/.claude/settings.json. The
# registration files are taken as a glob rather than by name: the file names inside
# that documented directory are the client's, so a list here would go on succeeding
# while protecting nothing the day one is renamed. What is under those
# subdirectories — the unpacked marketplaces and the plugin cache — is left out:
# hundreds of MiB the client re-fetches on its own. settings.json alone lands at
# the top of the backup rather than under client-config/, beside the CLAUDE.md and
# the legacy artifacts the later phases put there: that is the ~/.claude-relative
# layout the operator is pointed at.
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

# engram arrives in TWO artifacts and this used to install one of them: the plugin
# carries the skills, the hooks and the .mcp.json, and that .mcp.json launches
# `{"command": "engram"}` — a bare binary the plugin install never puts anywhere.
# Reported from the plugin install's exit code alone, a clean Windows box read
# `engram: OK — plugin installed` and then failed to start the server (D3).
wire_engram() {
  install_engram_plugin
  provision_engram_binary
}

# One repo behind both halves: the plugin marketplace and the binary releases live
# in it, so a fork or a rename moves them together instead of drifting apart.
ENGRAM_SOURCE_REPO=Gentleman-Programming/engram

install_engram_plugin() {
  claude plugin marketplace add "$ENGRAM_SOURCE_REPO" >/dev/null 2>&1 || true
  local err
  if err="$(run_wiring claude plugin install engram@engram)"; then
    wiring_ok "engram (plugin)" "installed"
  else
    wiring_fail "engram (plugin)" "plugin install failed: $err — fix: claude plugin install engram@engram"
  fi
}

# The engram release this repo has verified, pinned the way fallow, the Codex CLI
# and Impeccable are — a version, never `@latest`. Keep this identical to
# ENGRAM_RELEASE_VERSION in bootstrap/repair-engram-codex.sh: that script swaps the
# binary beside a live ~/.engram database and this one puts the first copy on the
# machine, so two pins would mean which engram a machine runs depends on which
# script ran last.
SUPPORTED_ENGRAM_VERSION=1.20.0

# An engram the client can already resolve is left exactly where it is, whatever
# version it is: it owns ~/.engram/engram.db, whose schema the binary migrates, and
# pairing a database a newer engram has migrated with this older pin is the very
# accident repair-engram-codex.sh exists to keep from happening on purpose. Left
# where it is, never taken on trust: it is held to the same bar as a copy this
# script places, because a binary that cannot answer starts no MCP whichever run
# put it there.
provision_engram_binary() {
  local install_dir="$HOME/.local/bin" resolved failure
  resolved="$(engram_client_binary)"
  if [ -n "$resolved" ]; then
    if engram_binary_runs "$resolved"; then
      wiring_ok "engram (binary)" "already installed where Claude Code resolves it: $resolved"
    else
      # This one is not removed the way place_engram_binary removes its own dead
      # copy: it is the operator's, and which engram their machine keeps is not a
      # call an installer makes for them — so the way out is theirs to run.
      wiring_fail "engram (binary)" "the engram Claude Code resolves at $resolved does not run, so its MCP cannot start — an antivirus may have quarantined it, which upstream documents happening to unsigned prebuilt releases — fix: rm \"$resolved\", then re-run this installer to put the pinned release there; if that one will not run either, $(engram_manual_install_command)"
    fi
    return 0
  fi
  info "installing engram $SUPPORTED_ENGRAM_VERSION from its official release"
  if ! failure="$(install_pinned_engram "$install_dir")"; then
    wiring_fail "engram (binary)" "$failure — fix: $(engram_manual_install_command)"
    return 0
  fi
  resolved="$(engram_client_binary)"
  if [ -n "$resolved" ]; then
    wiring_ok "engram (binary)" "installed $SUPPORTED_ENGRAM_VERSION at $resolved"
  else
    wiring_fail "engram (binary)" "installed $SUPPORTED_ENGRAM_VERSION into $install_dir, which is not on the PATH Claude Code reads — the plugin spawns a bare \`engram\`, so its MCP cannot start until that directory is on it — fix: $(engram_path_fix_command "$install_dir")"
  fi
}

# The engram a newly launched Claude Code would spawn, empty when it would find
# none. Never `command -v`: on Windows this shell's PATH carries /usr/bin,
# /mingw64/bin and $HOME/bin, which a native claude.exe cannot use, so an engram
# sitting in one of them would report a working install to an operator whose client
# can never start it — the same split between what this shell sees and what the
# client sees that verify.sh's home-dir check exists for.
# Keep this identical to engram_client_binary in bootstrap/verify.sh.
engram_client_binary() {
  local entry candidate name
  name="$(engram_binary_name)"
  while IFS= read -r entry; do
    # A registry PATH entry arrives in whatever spelling was written into it:
    # backslashes, sometimes a trailing separator, and — since PowerShell ends its
    # lines the Windows way — a carriage return this shell would otherwise make
    # part of the directory name. Forward slashes are what `[ -x ]` reads most
    # reliably under Git Bash, and a trailing separator would make the join a `//`.
    entry="${entry%$'\r'}"
    entry="${entry//\\//}"
    entry="${entry%/}"
    [ -n "$entry" ] || continue
    candidate="$entry/$name"
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done <<< "$(client_path_entries)"
  return 0
}

# The PATH a newly launched Claude Code resolves a bare command name against, one
# entry per line. Off Windows that is this shell's own — the client starts from a
# shell like this one. On Windows it is emphatically not: Git Bash builds its PATH
# from the persisted one plus MSYS directories no native process can use, while
# claude.exe reads the persisted machine and user scopes, which is exactly the pair
# bootstrap/install.ps1's Update-EnvPath re-reads. PowerShell ships with every
# supported Windows and is already this repo's Windows entry point, so it is what
# reads them back; a run where it cannot answer yields nothing, which every caller
# reads as "not found" rather than as agreement.
# Keep this identical to client_path_entries in bootstrap/verify.sh.
client_path_entries() {
  if ! running_on_windows; then
    printf '%s\n' "${PATH//:/$'\n'}"
    return 0
  fi
  powershell -NoProfile -NonInteractive -Command \
    '@("Machine","User") | ForEach-Object { [Environment]::GetEnvironmentVariable("Path", $_) } | Where-Object { $_ } | ForEach-Object { $_ -split ";" }' \
    2>/dev/null || true
}

# Whether this shell is Git Bash on Windows, which decides three things a POSIX
# host answers differently: which asset engram publishes, the .exe suffix a native
# client needs to spawn a bare name, and whose PATH that name is resolved against.
# Keep this identical to running_on_windows in bootstrap/verify.sh.
running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

# Keep this identical to engram_binary_name in bootstrap/verify.sh.
engram_binary_name() {
  if running_on_windows; then printf 'engram.exe'; else printf 'engram'; fi
}

# The bar every engram gets held to here, whichever run put it on the machine: a
# checksum proves which bytes arrived and a file test proves they are there, but
# asking the binary to answer is what proves this machine will let it run.
# Upstream's prebuilt releases are unsigned and it documents Defender and other
# scanners flagging them as a heuristic false positive — a quarantined copy
# surfaces here, as a binary that is gone or will not start, instead of as a
# confusing failure somewhere downstream.
# Keep this identical to engram_binary_runs in bootstrap/verify.sh.
engram_binary_runs() {
  "$1" version >/dev/null 2>&1
}

# Prints nothing when the pinned engram lands at $1; on any failure prints the
# reason for the summary and returns 1, because a wiring step never aborts the
# install. It owns the staging directory's whole lifetime — that is the one thing
# the steps below cannot each own for themselves.
install_pinned_engram() {
  local install_dir="$1" staging staged reason status=0
  staging="$(mktemp -d "${TMPDIR:-/tmp}/oso-engram.XXXXXX" 2>/dev/null)" || {
    printf 'could not create a staging directory for the engram release'
    return 1
  }
  if staged="$(download_verified_engram "$staging")"; then
    reason="$(place_engram_binary "$staged" "$install_dir")" || status=1
  else
    reason="$staged"
    status=1
  fi
  rm -rf "$staging"
  if [ "$status" -ne 0 ]; then
    printf '%s' "$reason"
    return 1
  fi
}

# The verified binary's path inside $1 on success, the reason on failure. Every
# step that can fail says which one did: "engram did not install" is no diagnosis
# on a machine that has no curl, one whose architecture upstream publishes nothing
# for, and one whose download arrived corrupted.
download_verified_engram() {
  local staging="$1" asset release_base archive extracted binary
  asset="$(engram_release_asset)" || {
    printf 'engram publishes no official release for %s/%s' \
      "$(uname -s 2>/dev/null || echo unknown)" "$(uname -m 2>/dev/null || echo unknown)"
    return 1
  }
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    printf 'no curl or wget here to download the engram release with'
    return 1
  fi
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    printf 'no sha256sum or shasum here, and an engram release nothing can verify is never installed'
    return 1
  fi
  release_base="https://github.com/$ENGRAM_SOURCE_REPO/releases/download/v$SUPPORTED_ENGRAM_VERSION"
  archive="$staging/$asset"
  extracted="$staging/extracted"
  download_release_file "$release_base/checksums.txt" "$staging/checksums.txt" || {
    printf 'could not download %s' "$release_base/checksums.txt"
    return 1
  }
  download_release_file "$release_base/$asset" "$archive" || {
    printf 'could not download %s' "$release_base/$asset"
    return 1
  }
  engram_checksum_matches "$staging" "$asset" || {
    printf '%s does not match its published SHA-256 checksum, so nothing was installed' "$asset"
    return 1
  }
  mkdir -p "$extracted" && extract_engram_archive "$archive" "$extracted" || {
    printf 'could not unpack %s' "$asset"
    return 1
  }
  binary="$(find "$extracted" -type f -name "$(engram_binary_name)" 2>/dev/null | head -1)"
  if [ -z "$binary" ]; then
    printf '%s carries no %s' "$asset" "$(engram_binary_name)"
    return 1
  fi
  printf '%s' "$binary"
}

# Upstream publishes one asset per platform under goreleaser's
# <name>_<version>_<os>_<arch> naming — tar.gz for Linux and macOS, zip for Windows
# — plus one checksums.txt covering the whole release. A host outside that table
# gets no guessed asset name: the caller says so and hands over the manual install.
engram_release_asset() {
  local os arch
  case "$(uname -s 2>/dev/null || true)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *) return 1 ;;
  esac
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) return 1 ;;
  esac
  if [ "$os" = windows ]; then
    printf 'engram_%s_windows_%s.zip' "$SUPPORTED_ENGRAM_VERSION" "$arch"
  else
    printf 'engram_%s_%s_%s.tar.gz' "$SUPPORTED_ENGRAM_VERSION" "$os" "$arch"
  fi
}

# curl and wget each carry their own connect and transfer timeouts, so a stalled
# download names itself instead of hanging an install nobody is watching — no
# GNU timeout(1) needed, which macOS ships none of anyway. The 120 seconds is the
# value repair-engram-codex.sh bounds this same download with.
ENGRAM_DOWNLOAD_BOUND_SECONDS=120

download_release_file() {
  local url="$1" destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 \
      --connect-timeout "$ENGRAM_DOWNLOAD_BOUND_SECONDS" \
      --max-time "$ENGRAM_DOWNLOAD_BOUND_SECONDS" \
      -o "$destination" "$url" 2>/dev/null
  else
    wget -q --tries=3 --timeout="$ENGRAM_DOWNLOAD_BOUND_SECONDS" -O "$destination" "$url" 2>/dev/null
  fi
}

# checksums.txt covers every asset in the release, so the row for THIS one is
# selected first and checked on its own — `sha256sum -c` over the whole file would
# go red on the five assets that were never downloaded. Exactly one row must name
# the asset: none means the release does not carry it, and two would leave which
# hash was checked to the tool's own ordering.
engram_checksum_matches() {
  local staging="$1" asset="$2" selected="$staging/selected-checksum.txt"
  awk -v asset="$asset" '$2 == asset { print; rows++ } END { exit rows == 1 ? 0 : 1 }' \
    "$staging/checksums.txt" > "$selected" 2>/dev/null || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$staging" && sha256sum -c "$selected" >/dev/null 2>&1 )
  else
    ( cd "$staging" && shasum -a 256 -c "$selected" >/dev/null 2>&1 )
  fi
}

extract_engram_archive() {
  local archive="$1" destination="$2"
  case "$archive" in
    *.zip)
      # Git Bash ships no unzip and its GNU tar cannot read a zip, so what unpacks
      # the Windows asset is what every supported Windows carries and what
      # upstream's own Windows instructions use. The paths are converted first:
      # inside a -Command string they are PowerShell's to resolve, and MSYS
      # rewrites only arguments that are a path by themselves.
      powershell -NoProfile -NonInteractive -Command \
        "Expand-Archive -LiteralPath '$(cygpath -w "$archive")' -DestinationPath '$(cygpath -w "$destination")' -Force" \
        >/dev/null 2>&1
      ;;
    *) tar -xzf "$archive" -C "$destination" >/dev/null 2>&1 ;;
  esac
}

# Written through a pending name in the target directory so a failed or killed copy
# never leaves half a binary at the name the client spawns.
place_engram_binary() {
  local staged="$1" install_dir="$2" target pending
  target="$install_dir/$(engram_binary_name)"
  pending="$target.oso-pending-$$"
  mkdir -p "$install_dir" 2>/dev/null || {
    printf 'could not create %s' "$install_dir"
    return 1
  }
  if ! { cp "$staged" "$pending" 2>/dev/null && chmod 755 "$pending" 2>/dev/null; }; then
    rm -f "$pending"
    printf 'could not write %s' "$target"
    return 1
  fi
  mv -f "$pending" "$target" 2>/dev/null || {
    rm -f "$pending"
    printf 'could not move the downloaded engram into %s' "$install_dir"
    return 1
  }
  engram_binary_runs "$target" || {
    # Removed rather than moved aside under another name: every remediation this
    # installer prints ends in "re-run this installer", and a re-run resolves this
    # name before it downloads anything — so a copy left dead here is one the
    # operator would have to delete by hand before a re-run could even try again.
    # Nothing is lost by deleting: these bytes are the release the checksum just
    # matched, and a re-run fetches them again.
    rm -f "$target" 2>/dev/null || true
    printf 'engram %s was verified and placed at %s but would not run there — an antivirus may have quarantined it, which upstream documents happening to its unsigned prebuilt releases' \
      "$SUPPORTED_ENGRAM_VERSION" "$target"
    return 1
  }
}

# The one action this installer will not take for the operator: a persisted PATH
# entry outlives the install and is theirs to own, so it is handed over as the
# exact command instead. Windows gets the per-user environment call upstream's own
# instructions use — no elevation, no machine scope — and the directory in the
# spelling PowerShell can act on; a POSIX host gets its profile, since a client
# started from a shell inherits that shell's PATH.
engram_path_fix_command() {
  local install_dir="$1" windows_dir
  if ! running_on_windows; then
    printf 'add %s to your PATH (in ~/.profile, say), then restart Claude Code' "$install_dir"
    return 0
  fi
  windows_dir="$(cygpath -w "$install_dir" 2>/dev/null || printf '%s' "$install_dir")"
  printf '%s' "powershell -NoProfile -Command \"[Environment]::SetEnvironmentVariable('Path', '$windows_dir;' + [Environment]::GetEnvironmentVariable('Path','User'), 'User')\", then open a new terminal and restart Claude Code"
}

# Upstream's own recommended paths, in its own order: Homebrew where it has a tap,
# and a local Go build on Windows — which it recommends there precisely because a
# binary compiled on the machine is the one thing no antivirus heuristic flags.
engram_manual_install_command() {
  if running_on_windows; then
    printf 'install engram yourself — go install github.com/%s/cmd/engram@v%s, or unpack the release zip from https://github.com/%s/releases/tag/v%s onto the PATH Claude Code reads — then re-run this installer' \
      "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION" "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION"
  else
    printf 'install engram yourself — brew install gentleman-programming/tap/engram, or go install github.com/%s/cmd/engram@v%s — then re-run this installer' \
      "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION"
  fi
}

# The fallow version this repo has verified, pinned the way install-codex.sh pins
# the Codex CLI and Impeccable — a version, never `@latest`. `fallow` is the
# package; `fallow-mcp` is one of the bins it ships and is no package name at all.
# It ships prebuilt binaries for Windows, Linux and macOS, which is what took the
# Rust toolchain out of this path and let verify.sh count fallow (D2).
SUPPORTED_FALLOW_VERSION=3.14.0

wire_fallow() {
  # fallow: TS/JS codebase analysis, used by the debt-sweep phase.
  local err wired_command fix="npm install --global fallow@$SUPPORTED_FALLOW_VERSION, then claude mcp add --scope user fallow -- fallow-mcp"
  if ! command -v npm >/dev/null; then
    wiring_fail fallow "no npm to install the fallow package with — fix: install Node.js 22 or newer, then $fix"
    return 0
  fi
  # Installed on every run, wired or not. Skipping this wherever an entry already
  # exists is how the pin came to apply on clean machines only — which are exactly
  # the machines nobody can go and look at — and an entry says nothing about which
  # version the binary behind it is.
  info "installing fallow@$SUPPORTED_FALLOW_VERSION from npm"
  if ! err="$(run_wiring npm install --global "fallow@$SUPPORTED_FALLOW_VERSION")"; then
    wiring_fail fallow "could not install fallow@$SUPPORTED_FALLOW_VERSION: $err — a fallow already wired here keeps working, at whatever version it is — fix: $fix"
    return 0
  fi
  # The bare name is what PATH resolves everywhere but Windows, where the npm shim
  # is a .cmd the client has to be pointed at; the shared resolver knows both, and
  # is absent only from a copy of this file reached by some path with no
  # bootstrap/lib beside it.
  local fallow_command=fallow-mcp
  if command -v resolve_fallow_mcp_command >/dev/null 2>&1; then
    fallow_command="$(resolve_fallow_mcp_command "$HOME")" || fallow_command=fallow-mcp
  fi
  # `claude mcp add` is the one wiring step that refuses an entry someone else put
  # there (exit 1, "already exists in user config") and leaves it untouched, so on
  # that refusal the question is not whether an entry exists but whether the one
  # that does points at the command resolved above. verify.sh counts that entry
  # connecting, and reporting a stale one as wired would make its check a red no
  # re-run of this installer could ever clear.
  if err="$(run_wiring claude mcp add --scope user fallow -- "$fallow_command")"; then
    wiring_ok fallow "wired (user scope): $fallow_command"
    return 0
  fi
  wired_command="$(fallow_wired_command)"
  if [ "$wired_command" = "$fallow_command" ]; then
    wiring_ok fallow "already wired: $fallow_command"
  elif [ -n "$wired_command" ]; then
    wiring_fail fallow "wired to $wired_command, not the $fallow_command this host resolves — no re-run of this installer can repoint it — fix: claude mcp remove fallow -s user && claude mcp add --scope user fallow -- $fallow_command"
  else
    wiring_fail fallow "mcp add failed: $err — fix: claude mcp add --scope user fallow -- $fallow_command"
  fi
}

# The command the wired entry holds, empty when none can be read. `claude mcp get`
# exits 0 on an entry whose command cannot be spawned, so its exit code answers
# existence and never correctness — only the Command line it prints tells a stale
# entry from a live one. Matched loosely because the client's spacing is its own
# business, and a line that never arrives comes back empty, which the caller reads
# as a problem rather than as agreement.
fallow_wired_command() {
  local entry
  entry="$(claude mcp get fallow 2>/dev/null || true)"
  printf '%s\n' "$entry" |
    sed -n -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*Command:[[:space:]]*//p'
}

# Whether the operator opted out is DATA verify.sh reads, never a flag it can see:
# while its impeccable check is hard, an install that skipped the plugin on purpose
# has no green path and no way to tell that choice from a broken install. Keep this
# path identical to IMPECCABLE_OPT_OUT_MARKER in bootstrap/verify.sh.
IMPECCABLE_OPT_OUT_MARKER="${HOME}/.local/state/oso-code/impeccable-opt-out"

wire_impeccable() {
  # Third-party plugin backing the front-surface design bar (its CLI runs via npx).
  # Clearing the marker is the other half of the contract: left behind by an earlier
  # opt-out, it would report a genuinely failed install as the operator's choice
  # forever — a blind spot worse than the one the marker closes.
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
  claude plugin marketplace add pbakaus/impeccable >/dev/null 2>&1 || true
  local err
  if ! err="$(run_wiring claude plugin install impeccable@impeccable)"; then
    wiring_fail "impeccable (plugin)" "install failed: $err — fix: claude plugin install impeccable@impeccable"
    return 0
  fi
  # Read back rather than reported from the exit code: verify.sh holds this to the
  # client LISTING the plugin, and a summary claiming installed while that check
  # goes red is the engram shape one notch smaller (D3).
  if claude plugin list 2>/dev/null | grep -Fq impeccable; then
    wiring_ok "impeccable (plugin)" "installed"
  else
    wiring_fail "impeccable (plugin)" "the install reported success but the client lists no impeccable plugin — fix: claude plugin install impeccable@impeccable, then restart Claude Code"
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

# Registering a working tree as a plugin source is only safe when it is one, and
# $REPO_ROOT is the parent of wherever this file sits — a copy of the two bootstrap
# scripts dropped in a directory of their own makes it any directory at all. A
# marketplace manifest is the one thing that tells a real clone from that.
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

# context7 ships in the oso-code plugin's .mcp.json and registers with the plugin,
# so a legacy hand-added user-scope entry is a second source of truth for one
# server and this is what removes it. What it no longer does is remove it FIRST:
# that delete is the one outright destruction this installer performs on state it
# did not create, it ran unconditionally, and the verdict beside it came from
# `command -v npx` — so a plugin whose server never registered took a working
# context7 with it and the summary still printed OK.
# What the client can be asked instead is which servers it now knows about and
# whether each answered: `claude mcp list` spawns them and prints Connected per
# line, the same bar verify.sh holds this to. `claude mcp get` was the other
# candidate and is not one — it exits 0 for an entry whose command cannot be
# spawned, which is the lesson fallow's read-back above was built on.
# Connected rather than merely listed is the bar for deleting, because a
# replacement that does not start is exactly the state the legacy entry is worth
# keeping through: registered-but-silent leaves the operator whatever context7 they
# already had, and says why.
migrate_context7() {
  local entry
  entry="$(plugin_context7_entry)"
  if [ -z "$entry" ]; then
    wiring_fail context7 "the oso-code plugin's context7 server is not registered with the client, so a legacy user-scope entry, if any, was left standing rather than removed — fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer"
    return 0
  fi
  case "$entry" in
    *Connected*) ;;
    *)
      wiring_fail context7 "the oso-code plugin's context7 is registered but did not answer ($entry), so a legacy user-scope entry, if any, was left standing rather than removed — fix: install Node.js (context7 starts through npx), restart Claude Code, then re-run this installer"
      return 0
      ;;
  esac
  claude mcp remove --scope user context7 >/dev/null 2>&1 || true
  wiring_ok context7 "ships with the oso-code plugin, registered and connected"
}

# The client's own line for the plugin-shipped context7, empty when it lists none.
# Plugin servers render with a `plugin:<plugin>:<server>` prefix, which is what
# tells the replacement apart from the very legacy user-scope `context7` entry this
# migration deletes — matched on the two parts rather than the whole rendering,
# because the client's exact spacing and decoration are its own business and a
# reworded line must cost a confirmation, never a wrong deletion.
plugin_context7_entry() {
  claude mcp list 2>/dev/null | grep -F context7 | grep -F 'plugin:' | head -1 || true
}

# The two values Claude Code has to carry for anything here to work, written where
# the client reads them at the start of every session: the `env` block of its own
# settings.json (D9, D10). Neither rides a PATH any more. The plugin's bin
# directory reaches the Bash tool through an injection the client documents
# nowhere and that has already failed on Windows, and a skill whose
# "${OSO_STATE_BIN:-oso-state}" fell through to the bare name found nothing there
# — every plan capture on that host blocked on a sentence that named no cause.
# settings.json is read the same way by the CLI and by Claude Desktop, so one
# write covers both surfaces.
publish_client_environment() {
  publish_state_bin_path
  publish_git_bash_path
}

# OSO_STATE_BIN, absolute: what makes the skills' and hooks' oso-state a path
# instead of a name. Every failure here is recorded and never fatal, the way the
# wiring phases before it are.
publish_state_bin_path() {
  local state_bin failure
  state_bin="$(installed_oso_state_path)"
  if [ -z "$state_bin" ]; then
    wiring_fail "oso-state path" "the client records no installed oso-code plugin carrying a runnable bin/oso-state, so there is no absolute path to publish and every skill falls back to a bare \`oso-state\` on PATH — which resolves to nothing on Windows — fix: claude plugin install oso-code@oso-code, restart Claude Code, then re-run this installer"
    return 0
  fi
  if failure="$(store_client_env OSO_STATE_BIN "$state_bin")"; then
    wiring_ok "oso-state path" "every session reads OSO_STATE_BIN=$state_bin"
  else
    wiring_fail "oso-state path" "$failure — fix: add \"env\": { \"OSO_STATE_BIN\": \"$state_bin\" } to $CLAUDE_DIR/settings.json by hand, then restart Claude Code"
  fi
}

# The oso-state a session actually runs: the bin of the plugin version the client
# records as installed, which the phase before this one has just installed or
# updated. Never this clone's own copy — an operator is free to move or delete
# that — and never a version directory guessed out of the cache: an empty answer
# is reported by the caller, because a path published from a guess is exactly the
# silent degradation this phase exists to end.
installed_oso_state_path() {
  local install_root state_bin
  install_root="$(jq -r '.plugins["oso-code@oso-code"][0].installPath // empty' \
    "$CLAUDE_DIR/plugins/installed_plugins.json" 2>/dev/null || true)"
  [ -n "$install_root" ] || return 0
  state_bin="$install_root/bin/oso-state"
  if running_on_windows; then
    # claude.exe records installPath in its own native spelling (C:\Users\…), and
    # what lands in settings.json has to be readable by this shell AND by a native
    # process — the drive-letter form with forward slashes is the one spelling
    # that is both, and the one MSYS form (/c/Users/…) is not.
    state_bin="$(cygpath -m "$state_bin" 2>/dev/null || printf '%s' "$state_bin")"
  fi
  [ -x "$(shell_spelling_of "$state_bin")" ] || return 0
  printf '%s' "$state_bin"
}

# CLAUDE_CODE_GIT_BASH_PATH: what the client spawns every one of this plugin's
# hooks through where it cannot find Git Bash on its own — all five entries of
# plugin/hooks/hooks.json are .sh files, so a Windows machine without it loses
# every gate at once. Only ever
# written where there is something to write: a stored value that still resolves is
# the operator's and is left exactly as they set it, and one that no longer
# resolves is REPAIRED — a Git reinstalled, moved from Scoop to the official
# package or landed on another drive otherwise leaves the client spawning a
# bash.exe that is gone, permanently and invisibly (D10).
# The path is discovered by bootstrap/install.ps1, which hands it over in this
# same variable. The write is on this side because PowerShell 5.1's
# ConvertFrom-Json | ConvertTo-Json defaults to -Depth 2 and flattens everything
# deeper, and settings.json holds nested hook arrays: a whole-file rewrite from
# there would make the least-tested half of this bootstrap silently destructive.
publish_git_bash_path() {
  local stored candidate="${CLAUDE_CODE_GIT_BASH_PATH:-}" outcome failure
  # The key means nothing off Windows, and publishing it there would put a dead
  # variable into every session the client starts.
  running_on_windows || return 0
  stored="$(client_env_value CLAUDE_CODE_GIT_BASH_PATH)"
  if git_bash_resolves "$stored"; then
    wiring_ok "Git Bash path" "left as you set it: $stored"
    return 0
  fi
  if ! git_bash_resolves "$candidate"; then
    # Nothing stored and nothing handed over is the ordinary shape of a run
    # started from Git Bash rather than from install.ps1: the client looks for Git
    # Bash itself and usually finds it, so there is nothing to report and
    # verify.sh says as much on a note. A stored path that no longer resolves is a
    # different machine entirely, and nothing in this run can put it back.
    if [ -n "$stored" ]; then
      wiring_fail "Git Bash path" "settings.json points CLAUDE_CODE_GIT_BASH_PATH at $stored, which is not there any more, and this run was handed no Git Bash to repair it with — the client spawns every oso-code hook through that path, so the gates are off until it resolves — fix: re-run from PowerShell via bootstrap\\install.ps1, which finds Git Bash and hands it to this script, or set the key yourself to the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe)"
    fi
    return 0
  fi
  outcome=published
  [ -z "$stored" ] || outcome="repaired from $stored"
  if failure="$(store_client_env CLAUDE_CODE_GIT_BASH_PATH "$candidate")"; then
    wiring_ok "Git Bash path" "$outcome: $candidate"
  else
    wiring_fail "Git Bash path" "$failure — fix: add \"env\": { \"CLAUDE_CODE_GIT_BASH_PATH\": \"$candidate\" } to $CLAUDE_DIR/settings.json by hand, then restart Claude Code"
  fi
}

# Whether a path stored for a native Windows consumer still names a file here.
# Keep this identical to git_bash_resolves in bootstrap/verify.sh.
git_bash_resolves() {
  [ -n "$1" ] && [ -f "$(shell_spelling_of "$1")" ]
}

# A path written for a native Windows process, in the spelling THIS shell can
# stat: settings.json holds C:\… from an operator and C:/… from this script, and
# cygpath is what turns either — and a POSIX path, unchanged — into something a
# file test can read. Off Windows there is one spelling and the path comes back as
# it went in.
# Keep this identical to shell_spelling_of in bootstrap/verify.sh.
shell_spelling_of() {
  if running_on_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# Prints nothing when $1 reads back out of the client's env block as $2; on any
# failure prints the reason for the summary and returns 1, the shape
# install_pinned_engram above reports through. jq rather than a hand-rolled
# rewrite because settings.json is the operator's file and this script already
# edits it that way — and because jq creates `.env` on assignment, so one
# expression covers a file that has the block and one that does not.
# The read-back is not ceremony: a write nobody read back is how a summary comes
# to report a health nothing measured, which is the class this whole change closes.
store_client_env() {
  local key="$1" value="$2" settings="$CLAUDE_DIR/settings.json" failure
  if ! mkdir -p "$CLAUDE_DIR" 2>/dev/null; then
    printf 'could not create %s' "$CLAUDE_DIR"
    return 1
  fi
  if [ ! -f "$settings" ] && ! printf '{}\n' > "$settings" 2>/dev/null; then
    printf 'could not create %s' "$settings"
    return 1
  fi
  if ! failure="$(jq --arg key "$key" --arg value "$value" '.env[$key] = $value' \
    "$settings" 2>&1 >"${settings}.tmp")"; then
    # The rewrite lands in the .tmp beside it first, so a jq that refuses the file
    # — an operator's settings.json carrying a stray comma — leaves that file
    # exactly as it was rather than truncated to nothing.
    rm -f "${settings}.tmp"
    printf 'jq could not write %s into %s: %s' "$key" "$settings" "${failure//$'\n'/ }"
    return 1
  fi
  if ! failure="$(mv "${settings}.tmp" "$settings" 2>&1)"; then
    rm -f "${settings}.tmp"
    printf 'could not put the rewritten %s back: %s' "$settings" "${failure//$'\n'/ }"
    return 1
  fi
  if [ "$(client_env_value "$key")" != "$value" ]; then
    printf '%s was written into %s and did not read back as %s' "$key" "$settings" "$value"
    return 1
  fi
}

# What the client will hand every session for one key of its settings.json `env`
# block, empty when the file, the block, the key or jq itself is not there.
# Keep this identical to client_env_value in bootstrap/verify.sh.
client_env_value() {
  jq -r --arg key "$1" '.env[$key] // empty' "$CLAUDE_DIR/settings.json" 2>/dev/null || true
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
# Keep this identical to normalized_path in bootstrap/verify.sh.
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
# the pre-image in phase 2, before the client wrote this file three times and
# publish_client_environment added its env block to it, and a copy taken now would
# hold the run's own work under the same name.
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
  info "  it does not undo: packages installed (jq, Node.js, fallow); the plugin and marketplace CONTENT the client downloaded, since only the registration files are copied; and core.hooksPath, which this wires per repo and only where nothing else owned it — clear it with: git -C $REPO_ROOT config --unset core.hooksPath"
  info "  releases before this one wrote their backups to ~/.local/state/oso-code/backup-* instead, outside this root: nothing here lists or prunes those, so remove them yourself once you no longer want them"
}

main() {
  confirm_plan
  info "1/8 prerequisites"
  ensure_prerequisites
  ensure_node
  info "2/8 MCP wiring"
  backup_client_config
  wire_mcps
  info "3/8 oso-code plugin"
  install_plugin
  # After the plugin, never before: the path published here is the installed
  # plugin's own bin/oso-state, and phase 3 is what puts that version on the disk.
  info "4/8 client environment"
  publish_client_environment
  info "5/8 git commit hook"
  if [ "$INSTALL_GIT_HOOK" = true ]; then
    wire_git_commit_hook
  else
    info "skipping the git commit hook (--no-git-hook)"
  fi
  info "6/8 impeccable"
  if [ "$INSTALL_IMPECCABLE" = true ]; then
    wire_impeccable
  else
    skip_impeccable
  fi
  info "7/8 legacy cleanup"
  remove_legacy_artifacts
  remove_legacy_settings_entries
  ensure_output_style
  info "8/8 global CLAUDE.md"
  merge_global_claude_md
  print_wiring_summary
  prune_install_backups
  report_backup_coverage
  info "done — restart your Claude Code sessions to pick everything up"
}

# Installing is what running this file does and sourcing it is not: the suite reads
# the two decisions that can repoint the marketplace by sourcing this and calling
# them directly.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
