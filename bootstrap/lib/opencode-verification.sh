#!/usr/bin/env bash

FREE_SESSION_MODEL_PATTERN='^opencode/.*-free$'

first_free_model_in() {
  grep -E "$FREE_SESSION_MODEL_PATTERN" "$1" | head -1
}

OPENCODE_PROBE_PREFIX=oso-opencode-probe

opencode_version_of() {
  local binary=$1 probe_parent probe_home version
  probe_parent="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)" || return 1
  probe_home="$(mktemp -d "$probe_parent/$OPENCODE_PROBE_PREFIX.XXXXXX")" || return 1
  version="$(run_in_opencode_fixture "$probe_home" "$PATH" "$binary" --version 2>&1 |
    sed 's/\x1b\[[0-9;]*m//g' | tr -d '[:space:]')"
  remove_temporary_fixture "$probe_home" "$probe_parent" "$OPENCODE_PROBE_PREFIX" >&2
  printf '%s' "$version"
}

run_within_bound() {
  local bound_seconds=$1 pid waited=0
  shift
  ( set -m
    "$@" &
    pid=$!
    set +m
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$bound_seconds" ]; then
        kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
        exit 124
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "$pid"
  )
}

write_opencode_installer_shims() {
  local shims=$1
  printf '%s\n' \
    '#!/bin/sh' \
    'case "$*" in' \
    '  "setup --help") printf '\''usage: engram setup [<agent>] (claude-code, opencode, codex, ...)\n'\''; exit 0 ;;' \
    '  "setup opencode")' \
    '    mkdir -p "$HOME/.config/opencode/plugins"' \
    '    printf '\''fixture engram plugin\n'\'' > "$HOME/.config/opencode/plugins/engram.ts"' \
    '    exit 0 ;;' \
    '  *) exit 64 ;;' \
    'esac' > "$shims/engram" || return 1
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$shims/fallow-mcp" || return 1
  chmod +x "$shims/engram" "$shims/fallow-mcp"
}

opencode_fixture_config_home() {
  printf '%s' "$1/.config/opencode"
}

run_in_opencode_fixture() {
  local fixture_home=$1 fixture_path=$2 fixture_tmp="$1/tmp"
  shift 2
  mkdir -p "$fixture_tmp" || return 1
  env HOME="$fixture_home" \
    TMPDIR="$fixture_tmp" \
    XDG_CONFIG_HOME="$fixture_home/.config" \
    XDG_STATE_HOME="$fixture_home/.local/state" \
    XDG_CACHE_HOME="$fixture_home/.cache" \
    XDG_DATA_HOME="$fixture_home/.local/share" \
    PATH="$fixture_path" \
    "$@"
}

OPENCODE_BIN=""
OPENCODE_BIN_STATUS=""

opencode_binary_candidate() {
  local override=$1 on_path
  if [ -n "$override" ]; then
    printf '%s' "$override"
    return
  fi
  on_path="$(command -v opencode 2>/dev/null)"
  if [ -n "$on_path" ]; then
    printf '%s' "$on_path"
    return
  fi
  if [ -x "${HOME:-}/.opencode/bin/opencode" ]; then
    printf '%s' "$HOME/.opencode/bin/opencode"
  fi
}

resolve_pinned_opencode_binary() {
  local override=$1 pinned_version=$2 candidate probed
  OPENCODE_BIN=""
  candidate="$(opencode_binary_candidate "$override")"
  if [ -z "$candidate" ]; then
    OPENCODE_BIN_STATUS='no binary named by the override, on PATH, or at $HOME/.opencode/bin/opencode'
    return 1
  fi
  if [ ! -x "$candidate" ]; then
    OPENCODE_BIN_STATUS="no executable at $candidate"
    return 1
  fi
  probed="$(opencode_version_of "$candidate")"
  if [ "$probed" != "$pinned_version" ]; then
    OPENCODE_BIN_STATUS="${probed:-no version} at $candidate"
    return 1
  fi
  OPENCODE_BIN="$candidate"
  OPENCODE_BIN_STATUS="$probed"
  return 0
}

OPENCODE_FIXTURE_PARENT=""
OPENCODE_FIXTURE_PREFIX=""
OPENCODE_FIXTURE_ROOT=""
OPENCODE_FIXTURE_HOME=""
OPENCODE_FIXTURE_CONFIG_HOME=""
OPENCODE_FIXTURE_PATH=""
OPENCODE_FIXTURE_RESULT=""

install_opencode_fixture() {
  local source_root=$1 fixture_prefix=$2 shims
  OPENCODE_FIXTURE_PREFIX="$fixture_prefix"
  OPENCODE_FIXTURE_PARENT="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)"
  [ -n "$OPENCODE_FIXTURE_PARENT" ] || { OPENCODE_FIXTURE_RESULT=temporary-parent-unavailable; return 1; }
  if ! OPENCODE_FIXTURE_ROOT="$(mktemp -d "$OPENCODE_FIXTURE_PARENT/$fixture_prefix.XXXXXX" 2>&1)"; then
    OPENCODE_FIXTURE_RESULT="$(printf '%s' "$OPENCODE_FIXTURE_ROOT" | fold_lines)"
    OPENCODE_FIXTURE_ROOT=""
    return 1
  fi
  OPENCODE_FIXTURE_HOME="$OPENCODE_FIXTURE_ROOT/home"
  if [ -n "${HOME:-}" ] && [ "$OPENCODE_FIXTURE_HOME" = "$HOME" ]; then
    OPENCODE_FIXTURE_RESULT=refusing-to-reuse-the-real-home
    remove_opencode_fixture
    return 1
  fi
  shims="$OPENCODE_FIXTURE_ROOT/shims"
  if ! mkdir -p "$OPENCODE_FIXTURE_HOME" "$shims" || ! write_opencode_installer_shims "$shims"; then
    OPENCODE_FIXTURE_RESULT=fixture-setup-failed
    remove_opencode_fixture
    return 1
  fi
  OPENCODE_FIXTURE_PATH="$shims:$(dirname "$OPENCODE_BIN"):$PATH"
  OPENCODE_FIXTURE_CONFIG_HOME="$(opencode_fixture_config_home "$OPENCODE_FIXTURE_HOME")"
  if ! run_in_opencode_fixture "$OPENCODE_FIXTURE_HOME" "$OPENCODE_FIXTURE_PATH" \
      bash "$source_root/bootstrap/install-opencode.sh" --yes --no-impeccable --no-git-hook \
      > "$OPENCODE_FIXTURE_ROOT/install.log" 2>&1; then
    OPENCODE_FIXTURE_RESULT="install-failed:$(tail -1 "$OPENCODE_FIXTURE_ROOT/install.log" 2>/dev/null | fold_lines)"
    remove_opencode_fixture
    return 1
  fi
  OPENCODE_FIXTURE_RESULT=ready
  return 0
}

remove_opencode_fixture() {
  remove_temporary_fixture "$OPENCODE_FIXTURE_ROOT" "$OPENCODE_FIXTURE_PARENT" \
    "$OPENCODE_FIXTURE_PREFIX" || return 1
  OPENCODE_FIXTURE_ROOT=""
}

run_in_installed_fixture() {
  run_in_opencode_fixture "$OPENCODE_FIXTURE_HOME" "$OPENCODE_FIXTURE_PATH" "$@"
}
