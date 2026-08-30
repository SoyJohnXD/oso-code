import {
  BUNDLE_DIRECTORY,
  GATE_BUNDLE,
  GATE_ROWS,
  HOST_ROWS,
  TOOL_ROWS,
  type GateId,
  type GateRow,
  type HostName,
  type PerHost,
} from "./routes.ts";

export {
  BUNDLE_DIRECTORY,
  GATE_BUNDLE,
  OPENCODE_PLUGIN_BUNDLE,
  OPENCODE_PLUGIN_ENTRY,
  PRECOMMIT_BUNDLE,
} from "./routes.ts";

export type ManifestHost = Extract<HostName, "claude" | "codex">;

export const MANIFEST_HOSTS: readonly ManifestHost[] = ["claude", "codex"];

const CLAUDE_PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const CODEX_STATE_MARKER = "OSO_AGENT=1";
const NODE = "node";
const UNKNOWN_TOOL_MATCHER = ".*";
const DEPLOY_SHAPED_TOOL_NAMES: PerHost<string> = {
  claude: "mcp__.*deploy.*",
  codex: "mcp__.*deploy.*",
  opencode: ".*deploy.*",
};

export type OpenCodeHook = "tool.execute.before" | "experimental.chat.system.transform" | "event" | "dispose";

export type OpenCodeRoute = Readonly<{
  hook: OpenCodeHook;
  gate: GateId;
  matcher: string;
  allow: readonly string[];
}>;

const OPENCODE_HOOKS: readonly OpenCodeHook[] = [
  "tool.execute.before",
  "experimental.chat.system.transform",
  "event",
  "dispose",
];

export function openCodeRoutes(): readonly OpenCodeRoute[] {
  return GATE_ROWS.filter((row) => row.wiring.opencode === "wired").map((row) => ({
    hook: openCodeHookNamed(row.mechanism.opencode, row.gate),
    gate: row.gate,
    matcher: matcherFor("opencode", row),
    allow: row.gate === "unknown" ? toolNamesFor("opencode", "unknown") : [],
  }));
}

function openCodeHookNamed(mechanism: string, gate: string): OpenCodeHook {
  const hook = OPENCODE_HOOKS.find((candidate) => candidate === mechanism);
  if (hook === undefined) throw new Error(`gate ${gate} names no OpenCode hook the adapter routes: ${mechanism}`);
  return hook;
}

function claudeGateBundle(): string {
  return `${CLAUDE_PLUGIN_ROOT}/${BUNDLE_DIRECTORY}/${GATE_BUNDLE}`;
}

export function manifestPathOf(host: ManifestHost): string {
  const row = HOST_ROWS.find((candidate) => candidate.host === host);
  if (row === undefined) throw new Error(`no host row names ${host}`);
  return row.manifest;
}

export function renderHooksManifest(host: ManifestHost): string {
  const blocks = eventsWiredFor(host).map((event) => eventLines(host, event));
  return [...["{", '  "hooks": {'], ...commaJoined(blocks), ...["  }", "}"]].join("\n") + "\n";
}

type Handler = Readonly<{ command: string; args?: readonly string[] }>;

function eventsWiredFor(host: ManifestHost): string[] {
  const events: string[] = [];
  for (const row of GATE_ROWS) {
    if (row.wiring[host] !== "wired" || events.includes(row.event)) continue;
    events.push(row.event);
  }
  return events;
}

function gatesWiredFor(host: ManifestHost, event: string): GateRow[] {
  return GATE_ROWS.filter((row) => row.event === event && row.wiring[host] === "wired");
}

function eventLines(host: ManifestHost, event: string): string[] {
  const groups = gatesWiredFor(host, event).map((row) => groupLines(host, row));
  return [`    ${json(event)}: [`, ...commaJoined(groups), "    ]"];
}

function groupLines(host: ManifestHost, row: GateRow): string[] {
  const matcher = matcherFor(host, row);
  return [
    "      {",
    ...(matcher === "" ? [] : [`        ${json("matcher")}: ${json(matcher)},`]),
    `        ${json("hooks")}: [`,
    ...handlerLines(handlerFor(host, row)),
    "        ]",
    "      }",
  ];
}

function handlerLines(handler: Handler): string[] {
  const args = handler.args;
  return [
    "          {",
    `            ${json("type")}: ${json("command")},`,
    `            ${json("command")}: ${json(handler.command)}${args === undefined ? "" : ","}`,
    ...(args === undefined ? [] : [`            ${json("args")}: [${args.map(json).join(", ")}]`]),
    "          }",
  ];
}

function handlerFor(host: ManifestHost, row: GateRow): Handler {
  if (host === "claude") return { command: NODE, args: [claudeGateBundle(), row.gate] };
  const root = HOST_ROWS.find((candidate) => candidate.host === "codex")?.commandRoot ?? "";
  const allow = row.gate === "unknown" ? ` --allow ${json(allowlistFor(host))}` : "";
  return { command: `${CODEX_STATE_MARKER} ${NODE} ${root}/${GATE_BUNDLE} ${row.gate}${allow}` };
}

function matcherFor(host: HostName, row: GateRow): string {
  const named = toolNamesFor(host, row.gate).join("|");
  if (row.gate === "unknown") return UNKNOWN_TOOL_MATCHER;
  if (row.gate === "handoff") return `^(${named})$`;
  if (row.gate === "proddeploy") return `${named}|${DEPLOY_SHAPED_TOOL_NAMES[host]}`;
  return named;
}

function allowlistFor(host: ManifestHost): string {
  return toolNamesFor(host, "unknown").join("|");
}

function toolNamesFor(host: HostName, gate: string): string[] {
  const named: string[] = [];
  for (const row of TOOL_ROWS) {
    const name = row.names[host];
    if (row.gate !== gate || name === "none" || named.includes(name)) continue;
    named.push(name);
  }
  return named;
}

function commaJoined(blocks: readonly (readonly string[])[]): string[] {
  return blocks.flatMap((block, index) => withTrailingComma(block, index < blocks.length - 1));
}

function withTrailingComma(block: readonly string[], needed: boolean): string[] {
  const last = block.length - 1;
  return block.map((line, index) => (needed && index === last ? `${line},` : line));
}

function json(value: string): string {
  return JSON.stringify(value);
}
