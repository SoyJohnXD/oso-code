import {
  BUNDLE_DIRECTORY,
  claudeMatcherUnion,
  GATE_BUNDLE,
  GATE_ROWS,
  gatesWiredFor,
  HOST_ROWS,
  matcherFor,
  PRE_TOOL_USE_EVENT,
  PRE_TOOL_USE_ROUTE,
  toolNamesFor,
  type GateId,
  type HostName,
} from "./routes.ts";

export {
  BUNDLE_DIRECTORY,
  GATE_BUNDLE,
  OPENCODE_PLUGIN_BUNDLE,
  OPENCODE_PLUGIN_ENTRY,
  PRECOMMIT_BUNDLE,
} from "./routes.ts";

export type ManifestHost = Extract<HostName, "claude">;

export const MANIFEST_HOSTS: readonly ManifestHost[] = ["claude"];

const CLAUDE_PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const NODE = "node";

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

function eventLines(host: ManifestHost, event: string): string[] {
  const rows = gatesWiredFor(host, event);
  const groups =
    event === PRE_TOOL_USE_EVENT
      ? [groupLines(claudeMatcherUnion(rows), handlerFor(PRE_TOOL_USE_ROUTE))]
      : rows.map((row) => groupLines(matcherFor(host, row), handlerFor(row.gate)));
  return [`    ${json(event)}: [`, ...commaJoined(groups), "    ]"];
}

function groupLines(matcher: string, handler: Handler): string[] {
  return [
    "      {",
    ...(matcher === "" ? [] : [`        ${json("matcher")}: ${json(matcher)},`]),
    `        ${json("hooks")}: [`,
    ...handlerLines(handler),
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

function handlerFor(route: string): Handler {
  return { command: NODE, args: [claudeGateBundle(), route] };
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
