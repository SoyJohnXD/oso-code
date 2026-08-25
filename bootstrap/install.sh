#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"
BACKUP_ROOT="${HOME}/.local/state/oso-code/claude-backups"
BACKUP_DIR="$BACKUP_ROOT/install-backup-$(date +%Y%m%d-%H%M%S)-$$"
MARKER_START="<!-- oso-code:start -->"
MARKER_END="<!-- oso-code:end -->"


BACKUP_LIB="$SCRIPT_DIR/lib/install-backup.sh"
if [ -f "$BACKUP_LIB" ]; then
  . "$BACKUP_LIB"
fi

FALLOW_COMMAND_LIB="$SCRIPT_DIR/lib/codex-managed-config.sh"
if [ -f "$FALLOW_COMMAND_LIB" ]; then
  . "$FALLOW_COMMAND_LIB"
fi

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

WIRING_SUMMARY=()
wiring_ok()   { WIRING_SUMMARY+=("OK|$1|$2"); }
wiring_fail() { WIRING_SUMMARY+=("FAILED|$1|$2"); }

run_wiring() {
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
    rel="${rel%$'\r'}"
    case "$rel" in ''|'#'*) continue ;; esac
    if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
      artifact_count=$((artifact_count + 1))
    fi
  done < "$SCRIPT_DIR/gentle-manifest.txt"

  info "this will:"
  info "  - install/verify MCPs (engram, context7, fallow) and the oso-code plugin"
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
  info "  - publish OSO_STATE_BIN into ~/.claude/settings.json so every skill reaches oso-state by path, and on Windows the Git Bash path the client spawns the hooks through — replacing a stored one only where it no longer resolves (backed up first)"
  info "  - remove $artifact_count legacy gentle-ai artifacts from ~/.claude (backed up first)"
  info "  - clean legacy hook entries from settings.json (backed up first)"
  if [ "$REPLACE_CLAUDE_MD" = true ]; then
    info "  - REPLACE ~/.claude/CLAUDE.md entirely (backed up first)"
  else
    info "  - merge the oso-code block into ~/.claude/CLAUDE.md between markers (backed up first)"
  fi
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
  command -v jq >/dev/null || fail "jq installed but not on PATH yet — open a new terminal and re-run"
}

ensure_node() {
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

winget_install_per_user() {
  local winget_id="$1" answer
  local manual="winget install --id $winget_id --exact"
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
  wire_engram
  wire_fallow
}

wire_engram() {
  install_engram_plugin
  provision_engram_binary
}

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

SUPPORTED_ENGRAM_VERSION=1.20.0

provision_engram_binary() {
  local install_dir="$HOME/.local/bin" resolved failure
  resolved="$(engram_client_binary)"
  if [ -n "$resolved" ]; then
    if engram_binary_runs "$resolved"; then
      wiring_ok "engram (binary)" "already installed where Claude Code resolves it: $resolved"
    else
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

engram_client_binary() {
  local entry candidate name
  name="$(engram_binary_name)"
  while IFS= read -r entry; do
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

client_path_entries() {
  if ! running_on_windows; then
    printf '%s\n' "${PATH//:/$'\n'}"
    return 0
  fi
  powershell -NoProfile -NonInteractive -Command \
    '@("Machine","User") | ForEach-Object { [Environment]::GetEnvironmentVariable("Path", $_) } | Where-Object { $_ } | ForEach-Object { $_ -split ";" }' \
    2>/dev/null || true
}

running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

engram_binary_name() {
  if running_on_windows; then printf 'engram.exe'; else printf 'engram'; fi
}

engram_binary_runs() {
  "$1" version >/dev/null 2>&1
}

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
      powershell -NoProfile -NonInteractive -Command \
        "Expand-Archive -LiteralPath '$(cygpath -w "$archive")' -DestinationPath '$(cygpath -w "$destination")' -Force" \
        >/dev/null 2>&1
      ;;
    *) tar -xzf "$archive" -C "$destination" >/dev/null 2>&1 ;;
  esac
}

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
    rm -f "$target" 2>/dev/null || true
    printf 'engram %s was verified and placed at %s but would not run there — an antivirus may have quarantined it, which upstream documents happening to its unsigned prebuilt releases' \
      "$SUPPORTED_ENGRAM_VERSION" "$target"
    return 1
  }
}

engram_path_fix_command() {
  local install_dir="$1" windows_dir
  if ! running_on_windows; then
    printf 'add %s to your PATH (in ~/.profile, say), then restart Claude Code' "$install_dir"
    return 0
  fi
  windows_dir="$(cygpath -w "$install_dir" 2>/dev/null || printf '%s' "$install_dir")"
  printf '%s' "powershell -NoProfile -Command \"[Environment]::SetEnvironmentVariable('Path', '$windows_dir;' + [Environment]::GetEnvironmentVariable('Path','User'), 'User')\", then open a new terminal and restart Claude Code"
}

engram_manual_install_command() {
  if running_on_windows; then
    printf 'install engram yourself — go install github.com/%s/cmd/engram@v%s, or unpack the release zip from https://github.com/%s/releases/tag/v%s onto the PATH Claude Code reads — then re-run this installer' \
      "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION" "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION"
  else
    printf 'install engram yourself — brew install gentleman-programming/tap/engram, or go install github.com/%s/cmd/engram@v%s — then re-run this installer' \
      "$ENGRAM_SOURCE_REPO" "$SUPPORTED_ENGRAM_VERSION"
  fi
}

SUPPORTED_FALLOW_VERSION=3.14.0

wire_fallow() {
  local err wired_command fix="npm install --global fallow@$SUPPORTED_FALLOW_VERSION, then claude mcp add --scope user fallow -- fallow-mcp"
  if ! command -v npm >/dev/null; then
    wiring_fail fallow "no npm to install the fallow package with — fix: install Node.js 22 or newer, then $fix"
    return 0
  fi
  info "installing fallow@$SUPPORTED_FALLOW_VERSION from npm"
  if ! err="$(run_wiring npm install --global "fallow@$SUPPORTED_FALLOW_VERSION")"; then
    wiring_fail fallow "could not install fallow@$SUPPORTED_FALLOW_VERSION: $err — a fallow already wired here keeps working, at whatever version it is — fix: $fix"
    return 0
  fi
  local fallow_command=fallow-mcp
  if command -v resolve_fallow_mcp_command >/dev/null 2>&1; then
    fallow_command="$(resolve_fallow_mcp_command "$HOME")" || fallow_command=fallow-mcp
  fi
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

fallow_wired_command() {
  local entry
  entry="$(claude mcp get fallow 2>/dev/null || true)"
  printf '%s\n' "$entry" |
    sed -n -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*Command:[[:space:]]*//p'
}

IMPECCABLE_OPT_OUT_MARKER="${HOME}/.local/state/oso-code/impeccable-opt-out"

wire_impeccable() {
  rm -f "$IMPECCABLE_OPT_OUT_MARKER"
  claude plugin marketplace add pbakaus/impeccable >/dev/null 2>&1 || true
  local err
  if ! err="$(run_wiring claude plugin install impeccable@impeccable)"; then
    wiring_fail "impeccable (plugin)" "install failed: $err — fix: claude plugin install impeccable@impeccable"
    return 0
  fi
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
  claude plugin marketplace update oso-code \
    || warn "could not refresh the oso-code marketplace — fix: claude plugin marketplace update oso-code"
  claude plugin update oso-code@oso-code \
    || warn "could not update the oso-code plugin — fix: claude plugin update oso-code@oso-code"
  migrate_context7
}

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

plugin_context7_entry() {
  claude mcp list 2>/dev/null | grep -F context7 | grep -F 'plugin:' | head -1 || true
}

publish_client_environment() {
  publish_state_bin_path
  publish_git_bash_path
}

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

installed_oso_state_path() {
  local install_root state_bin
  install_root="$(jq -r '.plugins["oso-code@oso-code"][0].installPath // empty' \
    "$CLAUDE_DIR/plugins/installed_plugins.json" 2>/dev/null || true)"
  [ -n "$install_root" ] || return 0
  state_bin="$install_root/bin/oso-state"
  if running_on_windows; then
    state_bin="$(cygpath -m "$state_bin" 2>/dev/null || printf '%s' "$state_bin")"
  fi
  [ -x "$(shell_spelling_of "$state_bin")" ] || return 0
  printf '%s' "$state_bin"
}

publish_git_bash_path() {
  local stored candidate="${CLAUDE_CODE_GIT_BASH_PATH:-}" outcome failure
  running_on_windows || return 0
  stored="$(client_env_value CLAUDE_CODE_GIT_BASH_PATH)"
  if git_bash_resolves "$stored"; then
    wiring_ok "Git Bash path" "left as you set it: $stored"
    return 0
  fi
  if ! git_bash_resolves "$candidate"; then
    if [ -n "$stored" ]; then
      wiring_fail "Git Bash path" "settings.json points CLAUDE_CODE_GIT_BASH_PATH at $stored, which is not there any more, and this run was handed no Git Bash to repair it with — the client spawns every oso-code hook through that path, so the gates are off until it resolves — fix: re-run from PowerShell via bootstrap\\install.ps1, which finds Git Bash and hands it to this script, or set the key yourself to the bash.exe you have (typically C:\\Program Files\\Git\\bin\\bash.exe)"
    fi
    return 0
  fi
  candidate="$(cygpath -m "$candidate" 2>/dev/null || printf '%s' "$candidate")"
  outcome=published
  [ -z "$stored" ] || outcome="repaired from $stored"
  if failure="$(store_client_env CLAUDE_CODE_GIT_BASH_PATH "$candidate")"; then
    wiring_ok "Git Bash path" "$outcome: $candidate"
  else
    wiring_fail "Git Bash path" "$failure — fix: add \"env\": { \"CLAUDE_CODE_GIT_BASH_PATH\": \"$candidate\" } to $CLAUDE_DIR/settings.json by hand, then restart Claude Code"
  fi
}

git_bash_resolves() {
  [ -n "$1" ] && [ -f "$(shell_spelling_of "$1")" ]
}

shell_spelling_of() {
  if running_on_windows; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

rewrite_settings_json() {
  local settings="$1" program="$2" failure
  shift 2
  if ! failure="$(jq "$@" "$program" "$settings" 2>&1 >"${settings}.tmp")"; then
    rm -f "${settings}.tmp"
    printf 'jq refused %s: %s' "$settings" "${failure//$'\n'/ }"
    return 1
  fi
  if [ ! -s "${settings}.tmp" ]; then
    rm -f "${settings}.tmp"
    printf 'jq read no JSON value out of %s' "$settings"
    return 1
  fi
  if ! failure="$(mv "${settings}.tmp" "$settings" 2>&1)"; then
    rm -f "${settings}.tmp"
    printf 'could not put the rewritten %s back: %s' "$settings" "${failure//$'\n'/ }"
    return 1
  fi
}

store_client_env() {
  local key="$1" value="$2" settings="$CLAUDE_DIR/settings.json" failure
  if ! mkdir -p "$CLAUDE_DIR" 2>/dev/null; then
    printf 'could not create %s' "$CLAUDE_DIR"
    return 1
  fi
  if [ ! -s "$settings" ] && ! printf '{}\n' > "$settings" 2>/dev/null; then
    printf 'could not create %s' "$settings"
    return 1
  fi
  if ! failure="$(rewrite_settings_json "$settings" '.env[$key] = $value' \
    --arg key "$key" --arg value "$value")"; then
    printf 'could not write %s into %s — %s' "$key" "$settings" "$failure"
    return 1
  fi
  if [ "$(client_env_value "$key")" != "$value" ]; then
    printf '%s was written into %s and did not read back as %s' "$key" "$settings" "$value"
    return 1
  fi
}

client_env_value() {
  jq -r --arg key "$1" '.env[$key] // empty' "$CLAUDE_DIR/settings.json" 2>/dev/null || true
}

GIT_HOOKS_DIR="$REPO_ROOT/plugin/git-hooks"

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

git_hooks_owner() {
  local configured git_dir hook
  configured="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
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

normalized_path() {
  local path="${1//\\//}"
  case "$path" in
    /[A-Za-z]/*|/[A-Za-z])
      path="${path#/}"
      path="${path%%/*}:${path#?}"
      ;;
  esac
  case "$path" in
    [a-z]:*) path="$(printf '%s' "${path%%:*}" | tr 'a-z' 'A-Z'):${path#*:}" ;;
  esac
  case "$path" in ?*/) path="${path%/}" ;; esac
  printf '%s' "$path"
}

print_wiring_summary() {
  info "wiring summary:"
  local entry status component note
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

remove_legacy_settings_entries() {
  local settings="$CLAUDE_DIR/settings.json" failure
  local legacy_hook_commands='check-plan-contract|clean-code-gate|skill-registry-refresh|gentle-ai'
  [ -s "$settings" ] || return 0
  if ! failure="$(rewrite_settings_json "$settings" '
        if (.hooks | type) != "object" then .
        else
          .hooks |= (
            with_entries(.value |= map(select(
              [.hooks[]?.command // ""] | any(test($legacy)) | not
            )))
            | with_entries(select(.value | length > 0))
          )
        end' --arg legacy "$legacy_hook_commands")"; then
    warn "left settings.json exactly as it was — $failure"
    return 0
  fi
  info "cleaned legacy hook entries from settings.json"
}

ensure_output_style() {
  local settings="$CLAUDE_DIR/settings.json" failure
  local current=absent
  if [ -s "$settings" ] && ! current="$(jq -r '.outputStyle // "absent"' "$settings" 2>&1)"; then
    warn "left your output style alone — jq could not read settings.json: ${current//$'\n'/ }"
    return 0
  fi
  [ -n "$current" ] || current=absent

  case "$current" in
    absent | Gentleman | Oso) ;;
    *)
      info "keeping your output style \"$current\" — switch to Oso anytime via /config → output style"
      return 0
      ;;
  esac

  if ! failure="$(mkdir -p "$CLAUDE_DIR" 2>&1)"; then
    warn "left your output style unset — could not create $CLAUDE_DIR: ${failure//$'\n'/ }"
    return 0
  fi
  if [ ! -s "$settings" ]; then
    if ! failure="$(jq -n '{outputStyle: "Oso"}' 2>&1 >"$settings")"; then
      warn "left your output style unset — could not write $settings: ${failure//$'\n'/ }"
      return 0
    fi
  elif ! failure="$(rewrite_settings_json "$settings" '.outputStyle = "Oso"')"; then
    warn "left your output style as it was — $failure"
    return 0
  fi
  info "output style set to Oso"
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

prune_install_backups() {
  if ! command -v install_backups_over_budget >/dev/null 2>&1; then
    info "backup retention: skipped — $BACKUP_LIB is not beside this script, so older backups under $BACKUP_ROOT stay until you remove them"
    return 0
  fi
  local backup budget_kib
  budget_kib="$(install_backup_budget_kib)"
  install_backup_dirs_newest_first "$BACKUP_ROOT" |
    install_backups_over_budget | while IFS= read -r backup; do
    rm -rf "$backup"
    info "backup retention: removed $backup (over the ${budget_kib} KiB budget)"
  done
}

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

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
