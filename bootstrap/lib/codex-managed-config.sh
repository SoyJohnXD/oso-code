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

[features]
hooks = true
multi_agent = true

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

toml_quote() {
  local value=$1
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}
