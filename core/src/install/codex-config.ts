import path from "node:path";
import { isExecutableRegularFile } from "../state/store.ts";

export const CONFIG_MARKER_START = "# oso-code:start";
export const CONFIG_MARKER_END = "# oso-code:end";
export const FEATURE_MARKER_START = "# oso-code:features:start";
export const FEATURE_MARKER_END = "# oso-code:features:end";
export const GLOBAL_MARKER_START = "<!-- oso-code:start -->";
export const GLOBAL_MARKER_END = "<!-- oso-code:end -->";
export const MODEL_INSTRUCTIONS_KEY = "model_instructions_file";
export const COMPACT_PROMPT_KEY = "experimental_compact_prompt_file";
export const FALLOW_FALLBACK_COMMAND = "fallow-mcp";

const DENIED_WORKSPACE_GLOBS = [
  "**/secrets/*",
  "**/*.key",
  "**/*.pem",
  "**/.env.*.local",
  "**/.env.local",
  "**/.env",
  "**/.env.production",
  "**/.npmrc",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/id_rsa",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ecdsa_sk",
  "**/id_ed25519",
  "**/id_ed25519_sk",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.config/gcloud/**",
  "**/.azure/**",
  "**/.kube/**",
];

export type FallowResolution = Readonly<{ command: string; resolved: boolean }>;

export function tomlQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderCodexManagedFeatures(): string {
  return "hooks = true\nmulti_agent = true\n";
}

export function renderCodexManagedConfig(targetHome: string, runtimeRoot: string, fallowCommand: string): string {
  const stateBin = tomlQuote(path.posix.join(runtimeRoot, "bin", "oso-state"));
  const stateRoot = tomlQuote(path.posix.join(targetHome, ".local", "state", "oso-code"));
  const worktreeRoot = tomlQuote(path.posix.join(targetHome, ".local", "state", "oso-code", "worktrees"));
  return [
    'default_permissions = "oso"',
    "",
    "[agents]",
    "max_threads = 4",
    "max_depth = 2",
    "job_max_runtime_seconds = 1800",
    "",
    "[shell_environment_policy.set]",
    'OSO_AGENT = "1"',
    `OSO_STATE_BIN = ${stateBin}`,
    "",
    "[permissions.oso]",
    'extends = ":workspace"',
    "",
    'description = "oso-code workspace profile"',
    "",
    "[permissions.oso.workspace_roots]",
    `${stateRoot} = true`,
    `${worktreeRoot} = true`,
    "",
    "[permissions.oso.filesystem]",
    "glob_scan_max_depth = 6",
    "",
    '[permissions.oso.filesystem.":workspace_roots"]',
    ...DENIED_WORKSPACE_GLOBS.map((glob) => `"${glob}" = "deny"`),
    '".git/**" = "write"',
    '".git/config" = "read"',
    "",
    "[permissions.oso.network]",
    "enabled = true",
    "",
    "[permissions.oso.network.domains]",
    '"*" = "allow"',
    '"169.254.169.254" = "deny"',
    '"metadata.google.internal" = "deny"',
    "",
    "[mcp_servers.context7]",
    'url = "https://mcp.context7.com/mcp"',
    "",
    "[mcp_servers.fallow]",
    `command = ${tomlQuote(fallowCommand)}`,
    "",
  ].join("\n");
}

export function resolveFallowMcpCommand(
  targetHome: string,
  environment: NodeJS.ProcessEnv,
  npmPrefixOf: () => string | undefined,
  firstOnPath: (name: string) => string | undefined,
): FallowResolution {
  const appData = environment["APPDATA"] ?? "";
  if (appData !== "") {
    const prefix = (npmPrefixOf() ?? path.posix.join(appData, "npm")).replaceAll("\\", "/");
    const shim = path.posix.join(prefix, "fallow-mcp.cmd");
    if (isExecutableRegularFile(shim)) return { command: shim, resolved: true };
  }
  const onPath = firstOnPath(FALLOW_FALLBACK_COMMAND);
  if (onPath !== undefined && onPath !== "") return { command: onPath, resolved: true };
  for (const name of ["fallow-mcp", "fallow-mcp.exe"]) {
    const cargo = path.posix.join(targetHome, ".cargo", "bin", name);
    if (isExecutableRegularFile(cargo)) return { command: cargo, resolved: true };
  }
  return { command: FALLOW_FALLBACK_COMMAND, resolved: false };
}
