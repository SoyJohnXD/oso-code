export const BUNDLE_DIRECTORY = "dist";
export const GATE_BUNDLE = "gate.js";
export const PRECOMMIT_BUNDLE = "precommit.js";

export type HostName = "claude" | "codex" | "opencode";

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
  { host: "codex", manifest: "codex/hooks/hooks.json", commandRoot: "\"__OSO_HOOKS_DIR__\"" },
  { host: "opencode", manifest: "opencode/hooks/routes.ts", commandRoot: "<module-relative>" },
];

export const GATE_ROWS = [
  {
    gate: "commit",
    event: "PreToolUse",
    script: "block-commit-until-green.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "edits",
    event: "PreToolUse",
    script: "block-edits-without-slice.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "unknown",
    event: "PreToolUse",
    script: "block-unknown-tool.sh",
    wiring: { claude: "none", codex: "wired", opencode: "wired" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "handoff",
    event: "SubagentStop",
    script: "publish-subagent-handoff.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "native" },
  },
  {
    gate: "planstop",
    event: "Stop",
    script: "capture-plan-approval.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "none" },
  },
  {
    gate: "autocontinue",
    event: "Stop",
    script: "auto-continue.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "native" },
  },
  {
    gate: "planprompt",
    event: "UserPromptSubmit",
    script: "approve-plan-token.sh",
    wiring: { claude: "none", codex: "wired", opencode: "none" },
    mechanism: { claude: "none", codex: "subprocess", opencode: "none" },
  },
  {
    gate: "statebin",
    event: "SessionStart",
    script: "persist-state-bin.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "native" },
  },
  {
    gate: "stale",
    event: "SessionStart",
    script: "warn-stale-state.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "experimental.chat.system.transform" },
  },
  {
    gate: "version",
    event: "SessionStart",
    script: "warn-stale-version.sh",
    wiring: { claude: "wired", codex: "none", opencode: "none" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "none" },
  },
  {
    gate: "teardown",
    event: "SessionEnd",
    script: "cleanup-state.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "dispose" },
  },
  {
    gate: "proddeploy",
    event: "PreToolUse",
    script: "block-prod-deploy.sh",
    wiring: { claude: "wired", codex: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "subprocess", opencode: "tool.execute.before" },
  },
  {
    gate: "reanchor",
    event: "SessionStart",
    script: "reanchor-after-compact.sh",
    wiring: { claude: "wired", codex: "none", opencode: "wired" },
    mechanism: { claude: "subprocess", codex: "none", opencode: "event" },
  },
] as const satisfies readonly GateRow[];

export const RECOVERY_ROWS: readonly RecoveryRow[] = [
  { gate: "commit", route: "the deny reads the session's own `mode` and names that mode's own path to green — plan's apply → verify loop, or quick/debug's close step — never a menu of every mode's step, and never the state write that would flip the flag itself." },
  { gate: "edits", route: "the deny names the exact `oso-state` invocation that arms the slice this gate is waiting for — the one thing only this gate knows." },
  { gate: "unknown", route: "this gate denies for two distinct causes and gives each its own way out — a pending plan names Codex's native approval controls; an unlisted tool names the exact allowlist this release actually admits." },
  { gate: "proddeploy", route: "take the run back (`oso-state --session <id> set auto=done`) and run the command from your own terminal — this gate arms only while THIS session's unattended run is still in flight." },
];

export const TOOL_ROWS: readonly ToolRow[] = [
  { gate: "commit", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", codex: "apply_patch", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", codex: "apply_patch", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", codex: "none", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", codex: "none", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "handoff", names: { claude: "none", codex: "explorer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-applier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-verifier", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-integrator", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-doubt-pass", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-debt-sweep", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-triage", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "handoff", names: { claude: "none", codex: "oso-security-reviewer", opencode: "none" }, capability: "role", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "Bash", opencode: "bash" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "apply_patch", opencode: "apply_patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_plan", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "request_user_input", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "Agent", opencode: "task" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationspawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationsend_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationfollowup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationwait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationinterrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "collaborationlist_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "spawn_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_input", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "resume_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "close_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "send_message", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "followup_task", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait_agent", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "interrupt_agent", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_agents", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "wait", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "create_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "get_goal", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "update_goal", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "view_image", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resources", opencode: "list_mcp_resources" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "list_mcp_resource_templates", opencode: "list_mcp_resource_templates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "read_mcp_resource", opencode: "read_mcp_resource" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_gen__imagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "image_genimagegen", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "web__run", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_search", opencode: "engram_mem_search" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_get_observation", opencode: "engram_mem_get_observation" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save", opencode: "engram_mem_save" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_update", opencode: "engram_mem_update" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_context", opencode: "engram_mem_context" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_session_summary", opencode: "engram_mem_session_summary" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_current_project", opencode: "engram_mem_current_project" }, capability: "read", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_save_prompt", opencode: "engram_mem_save_prompt" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__engram__mem_judge", opencode: "engram_mem_judge" }, capability: "write", mandated: "yes" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve-library-id", opencode: "context7_resolve-library-id" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__query-docs", opencode: "context7_query-docs" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__context7__resolve_library_id", opencode: "none" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__find_dupes", opencode: "fallow_find_dupes" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__get_cleanup_candidates", opencode: "fallow_get_cleanup_candidates" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__audit", opencode: "fallow_audit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "read" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "grep" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "glob" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "skill" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "todowrite" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "webfetch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "websearch" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "question" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "lsp" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "plan_exit" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", codex: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" },
];

export function gateRow(gate: GateId): GateRow {
  const found = GATE_ROWS.find((row) => row.gate === gate);
  if (found === undefined) throw new Error(`no route row names the gate ${gate}`);
  return found;
}
