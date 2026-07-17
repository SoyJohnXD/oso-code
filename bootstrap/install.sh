#!/usr/bin/env bash
# oso-code bootstrap: prerequisites, MCP wiring, plugin install, legacy cleanup.
# Runs on Linux, macOS, and Windows (Git Bash — required anyway for the hooks).
#
# Usage: install.sh [--yes] [--replace-claude-md]
#   --yes                skip the confirmation prompt (CI / scripted installs)
#   --replace-claude-md  replace ~/.claude/CLAUDE.md entirely instead of
#                        merging the oso-code block between markers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"
BACKUP_DIR="${HOME}/.local/state/oso-code/backup-$(date +%Y%m%d-%H%M%S)"
MARKER_START="<!-- oso-code:start -->"
MARKER_END="<!-- oso-code:end -->"

# Context budget for the global CLAUDE.md: 8000 bytes ≈ 2k tokens.
# Keep this identical to CLAUDE_MD_BUDGET_BYTES in bootstrap/verify.sh — the
# two scripts run standalone via curl and cannot source a shared file.
CLAUDE_MD_BUDGET_BYTES=8000

ASSUME_YES=false
REPLACE_CLAUDE_MD=false
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=true ;;
    --replace-claude-md) REPLACE_CLAUDE_MD=true ;;
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
    case "$output" in
      *already*) info "$label: already done" ;;
      *) fail "$label failed: $output" ;;
    esac
  fi
}

# MCP wiring is best-effort: a single server failure never aborts the install.
# Outcomes accumulate here and print as a summary at the end (print_mcp_summary).
# Each entry: "OK|<server>|<note>" or "FAILED|<server>|<reason> — fix: <command>".
MCP_SUMMARY=()
mcp_ok()   { MCP_SUMMARY+=("OK|$1|$2"); }
mcp_fail() { MCP_SUMMARY+=("FAILED|$1|$2"); }

run_mcp() {
  # Run a wiring command without aborting; on failure echo its output so the
  # caller can record the reason. "already exists" counts as success (idempotent).
  local output
  if output="$("$@" 2>&1)"; then
    return 0
  fi
  case "$output" in
    *already*) return 0 ;;
    *) printf '%s' "$output"; return 1 ;;
  esac
}

confirm_plan() {
  local artifact_count=0 rel
  while IFS= read -r rel; do
    case "$rel" in ''|'#'*) continue ;; esac
    if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
      artifact_count=$((artifact_count + 1))
    fi
  done < "$SCRIPT_DIR/gentle-manifest.txt"

  info "this will:"
  info "  - install/verify MCPs (engram, context7, fallow) and the oso-code plugin"
  info "  - remove $artifact_count legacy gentle-ai artifacts from ~/.claude (backed up first)"
  info "  - clean legacy hook entries from settings.json (backed up first)"
  if [ "$REPLACE_CLAUDE_MD" = true ]; then
    info "  - REPLACE ~/.claude/CLAUDE.md entirely (backed up first)"
  else
    info "  - merge the oso-code block into ~/.claude/CLAUDE.md between markers (backed up first)"
  fi
  info "  - backup location: $BACKUP_DIR"

  if [ "$ASSUME_YES" = false ]; then
    printf '[oso-code] proceed? [y/N] '
    read -r answer
    case "$answer" in y|Y|yes|YES) ;; *) fail "aborted by user" ;; esac
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
  elif command -v winget >/dev/null; then winget install jqlang.jq
  else fail "could not detect a package manager — install jq manually, then re-run"
  fi
  # On Windows, winget installs do not join PATH until a new shell.
  command -v jq >/dev/null || fail "jq installed but not on PATH yet — open a new terminal and re-run"
}

ensure_node() {
  # context7 ships in the oso-code plugin and starts via npx. Ensure Node the
  # same way we ensure jq, but never abort: without Node, context7 simply will
  # not connect until the operator installs it (surfaced in the MCP summary).
  command -v npx >/dev/null && return 0
  info "installing Node.js (needed by the context7 MCP, which runs via npx)"
  if   command -v brew    >/dev/null; then brew install node || true
  elif command -v pacman  >/dev/null; then sudo pacman -S --noconfirm nodejs npm || true
  elif command -v apt-get >/dev/null; then sudo apt-get install -y nodejs npm || true
  elif command -v dnf     >/dev/null; then sudo dnf install -y nodejs npm || true
  elif command -v winget  >/dev/null; then winget install OpenJS.NodeJS.LTS || true
  else warn "no package manager detected — install Node.js manually so context7 can start"; return 0
  fi
  command -v npx >/dev/null \
    || warn "Node.js not on PATH yet — context7 will start once npx is available (open a new terminal if you just installed it)"
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
  if err="$(run_mcp claude plugin install engram@engram)"; then
    mcp_ok engram "plugin installed"
  else
    mcp_fail engram "plugin install failed: $err — fix: claude plugin install engram@engram"
  fi
}

wire_fallow() {
  # fallow: TS/JS codebase analysis, used by the debt-sweep phase
  if claude mcp list 2>/dev/null | grep -q 'fallow'; then
    mcp_ok fallow "already wired"
    return 0
  fi
  local err fix="cargo install fallow-mcp, then claude mcp add --scope user fallow -- fallow-mcp"
  if ! command -v fallow-mcp >/dev/null; then
    if ! command -v cargo >/dev/null; then
      mcp_fail fallow "no fallow-mcp binary and no cargo to build it — fix: install Rust, then $fix"
      return 0
    fi
    info "installing fallow-mcp via cargo (this can take a few minutes)"
    if ! err="$(run_mcp cargo install fallow-mcp)"; then
      mcp_fail fallow "cargo install fallow-mcp failed: $err — fix: $fix"
      return 0
    fi
  fi
  if err="$(run_mcp claude mcp add --scope user fallow -- fallow-mcp)"; then
    mcp_ok fallow "wired (user scope)"
  else
    mcp_fail fallow "mcp add failed: $err — fix: claude mcp add --scope user fallow -- fallow-mcp"
  fi
}

MARKETPLACE_SOURCE="SoyJohnXD/oso-code"

install_plugin() {
  # GitHub is the distribution source so `claude plugin update` pulls new
  # versions without re-cloning. Falls back to this local clone when offline.
  claude plugin marketplace add "$MARKETPLACE_SOURCE" >/dev/null 2>&1 \
    || claude plugin marketplace add "$REPO_ROOT" >/dev/null 2>&1 \
    || run_or_fail "marketplace refresh" claude plugin marketplace update oso-code
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

migrate_context7() {
  # context7 now ships in the oso-code plugin's .mcp.json and auto-registers
  # with the plugin. Drop any legacy hand-added user-scope entry so there is
  # exactly one source of truth. Tolerate its absence.
  claude mcp remove --scope user context7 >/dev/null 2>&1 || true
  if command -v npx >/dev/null; then
    mcp_ok context7 "ships with the oso-code plugin"
  else
    mcp_fail context7 "plugin wired but npx (Node.js) is missing, so it cannot start — fix: install Node.js, then restart Claude Code"
  fi
}

print_mcp_summary() {
  info "MCP wiring summary (engram, context7, fallow):"
  local entry status server note
  for entry in "${MCP_SUMMARY[@]}"; do
    IFS='|' read -r status server note <<< "$entry"
    info "  $server: $status — $note"
  done
}

remove_legacy_artifacts() {
  local manifest="$SCRIPT_DIR/gentle-manifest.txt"
  local removed=0
  local rel target
  mkdir -p "$BACKUP_DIR"
  while IFS= read -r rel; do
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
  local settings="$CLAUDE_DIR/settings.json"
  [ -f "$settings" ] || return 0
  mkdir -p "$BACKUP_DIR"
  cp -a "$settings" "$BACKUP_DIR/settings.json"
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
      mkdir -p "$BACKUP_DIR" "$CLAUDE_DIR"
      if [ -f "$settings" ]; then
        [ -f "$BACKUP_DIR/settings.json" ] || cp -a "$settings" "$BACKUP_DIR/settings.json"
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

  local without_block
  without_block="$(awk -v start="$MARKER_START" -v end="$MARKER_END" '
    $0 == start { skipping = 1; next }
    $0 == end   { skipping = 0; next }
    !skipping   { print }
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

confirm_plan
info "1/5 prerequisites"
ensure_prerequisites
ensure_node
info "2/5 MCP wiring"
wire_mcps
info "3/5 oso-code plugin"
install_plugin
info "4/5 legacy cleanup"
remove_legacy_artifacts
remove_legacy_settings_entries
ensure_output_style
info "5/5 global CLAUDE.md"
merge_global_claude_md
print_mcp_summary
info "done — restart your Claude Code sessions to pick everything up"
