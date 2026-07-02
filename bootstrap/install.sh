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

wire_mcps() {
  # engram: persistent memory (plugin that ships its own MCP server)
  claude plugin marketplace add Gentleman-Programming/engram >/dev/null 2>&1 || true
  run_or_fail "engram plugin install" claude plugin install engram@engram

  # context7: library docs on demand
  if ! claude mcp list 2>/dev/null | grep -q 'context7'; then
    command -v npx >/dev/null || fail "npx (Node.js) is required for the context7 MCP"
    run_or_fail "context7 mcp add" claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp
  fi

  # fallow: TS/JS codebase analysis, used by the debt-sweep phase
  if ! claude mcp list 2>/dev/null | grep -q 'fallow'; then
    if command -v fallow-mcp >/dev/null; then
      run_or_fail "fallow mcp add" claude mcp add --scope user fallow -- fallow-mcp
    elif command -v cargo >/dev/null; then
      info "installing fallow-mcp via cargo (this can take a few minutes)"
      run_or_fail "fallow-mcp build" cargo install fallow-mcp
      run_or_fail "fallow mcp add" claude mcp add --scope user fallow -- fallow-mcp
    else
      info "SKIP fallow: install Rust, run 'cargo install fallow-mcp', then re-run this script"
    fi
  fi
}

install_plugin() {
  claude plugin marketplace add "$REPO_ROOT" >/dev/null 2>&1 \
    || run_or_fail "marketplace refresh" claude plugin marketplace update oso-code
  run_or_fail "oso-code plugin install" claude plugin install oso-code@oso-code
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

remove_legacy_hooks_from_settings() {
  local settings="$CLAUDE_DIR/settings.json"
  [ -f "$settings" ] || return 0
  mkdir -p "$BACKUP_DIR"
  cp -a "$settings" "$BACKUP_DIR/settings.json"
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
  if [ "$size" -gt 12000 ]; then
    info "WARNING: CLAUDE.md is still ${size} bytes — review the non-oso content; every session pays for it"
  fi
}

confirm_plan
info "1/5 prerequisites"
ensure_prerequisites
info "2/5 MCP wiring"
wire_mcps
info "3/5 oso-code plugin"
install_plugin
info "4/5 legacy cleanup"
remove_legacy_artifacts
remove_legacy_hooks_from_settings
info "5/5 global CLAUDE.md"
merge_global_claude_md
info "done — restart your Claude Code sessions to pick everything up"
