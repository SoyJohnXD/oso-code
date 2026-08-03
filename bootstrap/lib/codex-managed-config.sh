#!/usr/bin/env bash
# Sourceable renderer for the oso-code-owned Codex configuration region.

render_codex_managed_config() {
  [ "$#" -eq 2 ] || {
    printf 'render_codex_managed_config requires HOME and runtime root\n' >&2
    return 2
  }
  local target_home=$1 runtime_root=$2 state_bin worktree_root
  state_bin="$(toml_quote "$runtime_root/bin/oso-state")"
  worktree_root="$(toml_quote "$target_home/.local/state/oso-code/worktrees")"
  cat <<EOF
default_permissions = "oso"

[agents]
max_threads = 4
max_depth = 2
job_max_runtime_seconds = 1800

[shell_environment_policy.set]
OSO_AGENT = "1"
OSO_STATE_BIN = $state_bin

[permissions.oso]
extends = ":workspace"

description = "oso-code workspace profile"

[permissions.oso.workspace_roots]
$worktree_root = true

[permissions.oso.filesystem]
glob_scan_max_depth = 4

[permissions.oso.filesystem.":workspace_roots"]
"**/secrets/*" = "deny"
"**/*.key" = "deny"
"**/*.pem" = "deny"
"**/.env.*.local" = "deny"
"**/.env.local" = "deny"
"**/.env" = "deny"
".git/**" = "write"

[permissions.oso.network]
enabled = true

[permissions.oso.network.domains]
"*" = "allow"

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.fallow]
command = "fallow-mcp"
EOF
}

render_codex_managed_features() {
  [ "$#" -eq 0 ] || {
    printf 'render_codex_managed_features takes no arguments\n' >&2
    return 2
  }
  cat <<'EOF'
hooks = true
multi_agent = true
EOF
}

# Return 0 for an exact oso-code features leaf, 1 when it is absent, 2 when its
# markers/table shape are malformed, and 3 when the owned bytes diverge. The
# parser keeps marker-looking lines inside multiline TOML strings inert.
codex_managed_features_region_status() {
  [ "$#" -eq 4 ] || {
    printf 'codex_managed_features_region_status requires source, parser, start marker, and end marker\n' >&2
    return 64
  }
  local source=$1 parser=$2 start_marker=$3 end_marker=$4 extracted expected status=0
  extracted="$(mktemp "${TMPDIR:-/tmp}/oso-codex-features-extracted.XXXXXX")" || return 2
  expected="$(mktemp "${TMPDIR:-/tmp}/oso-codex-features-expected.XXXXXX")" || {
    rm -f "$extracted"
    return 2
  }
  if ! awk -v action=features-strip \
      -v feature_start_marker="$start_marker" \
      -v feature_end_marker="$end_marker" \
      -f "$parser" "$source" >/dev/null 2>&1; then
    status=2
  elif awk -v action=extract -v require_region=1 \
      -v start_marker="$start_marker" -v end_marker="$end_marker" \
      -f "$parser" "$source" > "$extracted" 2>/dev/null; then
    render_codex_managed_features > "$expected"
    cmp -s "$expected" "$extracted" || status=3
  else
    status=1
  fi
  rm -f "$extracted" "$expected"
  return "$status"
}

toml_quote() {
  local value=$1
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}
