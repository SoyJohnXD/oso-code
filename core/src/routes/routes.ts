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

type ToolCapability = "read" | "write" | "role";

type ToolRow = Readonly<{
  gate: string;
  names: PerHost<string>;
  capability: ToolCapability;
  mandated: "yes" | "no";
}>;

export const HOST_ROWS: readonly HostRow[] = [
  { host: "claude", manifest: "plugin/hooks/hooks.json", commandRoot: "\"${CLAUDE_PLUGIN_ROOT}\"/hooks" },
  { host: "opencode", manifest: "opencode/hooks/routes.ts", commandRoot: "<module-relative>" },
];

export const PRE_TOOL_USE_ROUTE = "pretooluse";

export const GATE_ROWS = [
  {
    gate: "commit",
    event: "PreToolUse",
    script: "block-commit-until-green.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "execute.before" },
  },
  {
    gate: "edits",
    event: "PreToolUse",
    script: "block-edits-without-slice.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "execute.before" },
  },
  {
    gate: "unknown",
    event: "PreToolUse",
    script: "block-unknown-tool.sh",
    wiring: { claude: "none", opencode: "wired" },
    mechanism: { claude: "none", opencode: "execute.before" },
  },
  {
    gate: "autocontinue",
    event: "Stop",
    script: "auto-continue.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "experimental.idle" },
  },
  {
    gate: "statebin",
    event: "SessionStart",
    script: "persist-state-bin.sh",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "create.before" },
  },
  {
    gate: "stale",
    event: "SessionStart",
    script: "warn-stale-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "context" },
  },
  {
    gate: "version",
    event: "SessionStart",
    script: "warn-stale-version.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "context" },
  },
  {
    gate: "teardown",
    event: "SessionEnd",
    script: "cleanup-state.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "cleanup" },
  },
  {
    gate: "proddeploy",
    event: "PreToolUse",
    script: "block-prod-deploy.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "execute.before" },
  },
  {
    gate: "reanchor",
    event: "SessionStart",
    script: "reanchor-after-compact.sh",
    wiring: { claude: "wired", opencode: "wired" },
    mechanism: { claude: "subprocess", opencode: "compaction" },
  },
  {
    gate: "subagentstart",
    event: "SubagentStart",
    script: "in-flight-start",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "event" },
  },
  {
    gate: "subagentstop",
    event: "SubagentStop",
    script: "in-flight-stop",
    wiring: { claude: "wired", opencode: "none" },
    mechanism: { claude: "subprocess", opencode: "event" },
  },
] as const satisfies readonly GateRow[];

const TOOL_ROWS: readonly ToolRow[] = [
  { gate: "commit", names: { claude: "Bash", opencode: "shell" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Edit", opencode: "edit" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "MultiEdit", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "Write", opencode: "write" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "NotebookEdit", opencode: "none" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "mcp__fallow__fix_apply", opencode: "fallow_fix_apply" }, capability: "write", mandated: "no" },
  { gate: "edits", names: { claude: "none", opencode: "patch" }, capability: "write", mandated: "no" },
  { gate: "proddeploy", names: { claude: "Bash", opencode: "shell" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "shell" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "patch" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "subagent" }, capability: "write", mandated: "no" },
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
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_approve" }, capability: "read", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_plan_cancel" }, capability: "write", mandated: "no" },
  { gate: "unknown", names: { claude: "none", opencode: "oso_wave" }, capability: "write", mandated: "no" },
];

export function gateRow(gate: GateId): GateRow {
  const found = GATE_ROWS.find((row) => row.gate === gate);
  if (found === undefined) throw new Error(`no route row names the gate ${gate}`);
  return found;
}

export const PRE_TOOL_USE_EVENT = "PreToolUse";
const UNKNOWN_TOOL_MATCHER = ".*";
const CLAUDE_EXACT_TOOL_LIST = /^[A-Za-z0-9_|]+$/;
const SHAPED_TOOL_NAMES: Readonly<Record<string, PerHost<string>>> = {
  proddeploy: { claude: "mcp__.*deploy.*", opencode: ".*deploy.*" },
  edits: { claude: "none", opencode: ".*fix_apply" },
};

export function gatesWiredFor(host: HostName, event: string): GateRow[] {
  return GATE_ROWS.filter((row) => row.event === event && row.wiring[host] === "wired");
}

export function claudePreToolUseGatesFor(toolName: string): readonly string[] {
  return gatesWiredFor("claude", PRE_TOOL_USE_EVENT)
    .filter((row) => new RegExp(claudeMatcherPattern(matcherFor("claude", row))).test(toolName))
    .map((row) => row.gate);
}

export function claudeMatcherUnion(rows: readonly GateRow[]): string {
  return rows.map((row) => claudeMatcherPattern(matcherFor("claude", row))).join("|");
}

function claudeMatcherPattern(matcher: string): string {
  return CLAUDE_EXACT_TOOL_LIST.test(matcher) ? wholeToolName(matcher) : matcher;
}

export function wholeToolName(alternatives: string): string {
  return `^(?:${alternatives})$`;
}

export function matcherFor(host: HostName, row: GateRow): string {
  if (row.gate === "unknown") return UNKNOWN_TOOL_MATCHER;
  const named = toolNamesFor(host, row.gate);
  const shaped = SHAPED_TOOL_NAMES[row.gate]?.[host] ?? "none";
  return (shaped === "none" ? named : [...named, shaped]).join("|");
}

export function toolNamesFor(host: HostName, gate: string): string[] {
  const named: string[] = [];
  for (const row of TOOL_ROWS) {
    const name = row.names[host];
    if (row.gate !== gate || name === "none" || named.includes(name)) continue;
    named.push(name);
  }
  return named;
}
