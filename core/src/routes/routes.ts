export const BUNDLE_DIRECTORY = "dist";
export const GATE_BUNDLE = "gate.js";
export const PRECOMMIT_BUNDLE = "precommit.js";
export const OPENCODE_PLUGIN_ENTRY = "opencode/plugin/oso-code.ts";
export const OPENCODE_PLUGIN_BUNDLE = "opencode/dist/oso-code.js";
export const PLUGIN_BUNDLE_DIRECTORY = `plugin/${BUNDLE_DIRECTORY}`;
export const PLUGIN_BINARY_DIRECTORY = "plugin/bin";
export const BOOTSTRAP_DIRECTORY = "bootstrap";
export const MODULE_MANIFEST = "package.json";
export const PLUGIN_STATE_BUNDLE = `${PLUGIN_BUNDLE_DIRECTORY}/oso-state.js`;
export const PLUGIN_STATE_EXECUTABLE = `${PLUGIN_BINARY_DIRECTORY}/oso-state`;
export const BOOTSTRAP_BUNDLE = `${BOOTSTRAP_DIRECTORY}/oso.js`;

export const GENERATED_BUNDLES: readonly string[] = [
  PLUGIN_STATE_BUNDLE,
  `${PLUGIN_BUNDLE_DIRECTORY}/${GATE_BUNDLE}`,
  `${PLUGIN_BUNDLE_DIRECTORY}/${PRECOMMIT_BUNDLE}`,
  PLUGIN_STATE_EXECUTABLE,
  BOOTSTRAP_BUNDLE,
  OPENCODE_PLUGIN_BUNDLE,
];

export type HostName = "claude" | "opencode";

export type HostRow = Readonly<{ host: HostName; manifest: string; commandRoot: string }>;

export type PerHost<Cell extends string> = Readonly<Record<HostName, Cell>>;

export type GateId = (typeof GATE_ROWS)[number]["gate"];

export type GateWiring = "wired" | "none";

export type GateRow = Readonly<{
  gate: string;
  event: string;
  script: string;
  wiring: PerHost<GateWiring>;
  mechanism: PerHost<string>;
}>;

export type RecoveryRow = Readonly<{ gate: string; route: string }>;

export type ToolCapability = "read" | "write" | "role";

export type ToolRow = Readonly<{
  gate: string;
  names: PerHost<string>;
  capability: ToolCapability;
  mandated: "yes" | "no";
}>;

export const HOST_ROWS: readonly HostRow[] = [
  { host: "claude", manifest: "plugin/hooks/hooks.json", commandRoot: "\"${CLAUDE_PLUGIN_ROOT}\"/hooks" },
  { host: "opencode", manifest: "opencode/hooks/routes.ts", commandRoot: "<module-relative>" },
];

export const GATE_ROWS = [
  {
    gate: "commit",
    event: "PreToolUse",
    script: "block-commit-until-green.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "edits",
    event: "PreToolUse",
    script: "block-edits-without-slice.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "unknown",
    event: "PreToolUse",
    script: "block-unknown-tool.sh",
    wiring: { claude: "none", opencode: "wired" },
    mechanism: { claude: "none", opencode: "tool.execute.before" },
  },
  {
    gate: "autocontinue",
    event: "Stop",
    script: "auto-continue.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "native" },
  },
  {
    gate: "statebin",
    event: "SessionStart",
    script: "persist-state-bin.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "native" },
  },
  {
    gate: "stale",
    event: "SessionStart",
    script: "warn-stale-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "experimental.chat.system.transform" },
  },
  {
    gate: "version",
    event: "SessionStart",
    script: "warn-stale-version.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "none" },
  },
  {
    gate: "teardown",
    event: "SessionEnd",
    script: "cleanup-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "dispose" },
  },
  {
    gate: "proddeploy",
    event: "PreToolUse",
    script: "block-prod-deploy.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "reanchor",
    event: "SessionStart",
    script: "reanchor-after-compact.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "event" },
  },
] as const satisfies readonly GateRow[];

export const RECOVERY_ROWS: readonly RecoveryRow[] = [
  { gate: "commit", route: "the deny reads the session's own `mode` and names that mode's own path to green — plan's apply → verify loop, or quick/debug's close step — never a menu of every mode's step, and never the state write that would flip the flag itself." },
  { gate: "edits", route: "the deny names the exact `oso-state` invocation that arms the slice this gate is waiting for — the one thing only this gate knows." },
  { gate: "unknown", route: "an unlisted tool is denied with the exact allowlist this release admits." },
  { gate: "proddeploy", route: "take the run back (`oso-state --session <id> set auto=done`) and run the command from your own terminal — this gate arms only while THIS session's unattended run is still in flight." },
];

export const TOOL_ROWS: readonly ToolRow[] = [
  { gate: "commit", names: { claude: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "task" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "list_mcp_resources" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "list_mcp_resource_templates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "read_mcp_resource" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_search" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_get_observation" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_save" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_update" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_context" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_session_summary" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_current_project" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_save_prompt" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "engram_mem_judge" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", opencode: "context7_resolve-library-id" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "context7_query-docs" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_find_dupes" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_get_cleanup_candidates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_audit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "read" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "grep" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "glob" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "skill" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "todowrite" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "webfetch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "websearch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "question" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "lsp" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "plan_exit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" },
];

export function gateRow(gate: GateId): GateRow {
  const found = GATE_ROWS.find((row) => row.gate === gate);
  if (found === undefined) throw new Error(`no route row names the gate ${gate}`);
  return found;
}
