import { readFileSync } from "node:fs";
import { JsonParseError, readJsonFile } from "./json.ts";
import { isPlainObject, OWNED_PERMISSION_VALUES, OWNED_SKILL_MODES, OWNED_SKILL_VERDICT, type ConfigDocument } from "./opencode-config.ts";
import { GLOBAL_MARKER_END, GLOBAL_MARKER_START } from "./opencode.ts";
import type { OpenCodeHostProbes } from "./opencode-host.ts";
import { isReadableRegularFile } from "../state/store.ts";

export const OPENCODE_NOT_ON_PATH = "opencode-not-on-path";

export const VERSION_ROW_SKIP = "OpenCode CLI version — opencode is not on PATH, so the installed pin could not be probed";

export const OPERATOR_CONFIG_PROBE = {
  theme: "oso-verify-operator-theme",
  permissionKey: "read",
  permissionVerdict: "allow",
  mcpServerName: "oso-verify-operator-server",
  mcpServerCommand: ["operator-cli"],
} as const;

export const OPERATOR_GLOBAL_PROSE = "oso-verify operator prose the installer must not touch";

export type LocalCheckRowKind = "host" | "config" | "artifact" | "repository";

export type LocalCheckRow = Readonly<{ name: string; kind: LocalCheckRowKind }>;

export const OPENCODE_LOCAL_CHECK_ROWS: readonly LocalCheckRow[] = [
  { name: "OpenCode CLI version", kind: "host" },
  { name: "isolated fixture install", kind: "artifact" },
  { name: "OpenCode config contract", kind: "config" },
  { name: "operator config keys survive an install", kind: "config" },
  { name: "nine skill wrappers and shared bodies installed", kind: "artifact" },
  { name: "agent contracts installed", kind: "artifact" },
  { name: "mode commands installed and routed", kind: "artifact" },
  { name: "plugin entry, modules and routes installed", kind: "artifact" },
  { name: "Engram plugin file installed", kind: "artifact" },
  { name: "global guidance installed", kind: "config" },
  { name: "operator global prose survives an install", kind: "config" },
  { name: "installer-owned targets recorded", kind: "artifact" },
  { name: "published gate bytes as installed", kind: "artifact" },
  { name: "an install outside the named home is refused", kind: "artifact" },
  { name: "OpenCode plugin typecheck", kind: "repository" },
  { name: "OpenCode plugin test suite", kind: "repository" },
  { name: "repository shell syntax", kind: "repository" },
];

export function openCodeVersionStatus(host: OpenCodeHostProbes): string {
  return host.version ?? OPENCODE_NOT_ON_PATH;
}

export function openCodeConfigStatus(configFile: string): string {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "malformed";
  const document = read.value;
  if (!Array.isArray(document["plugin"])) return "malformed";
  const servers = document["mcp"];
  if (servers !== undefined && !isPlainObject(servers)) return "malformed";
  for (const server of Object.values(isPlainObject(servers) ? servers : {})) {
    if (!isPlainObject(server) || "env" in server) return "malformed";
  }
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  const skills = isPlainObject(permission["skill"]) ? permission["skill"] : {};
  if (OWNED_SKILL_MODES.some((mode) => skills[mode] !== OWNED_SKILL_VERDICT)) return "malformed";
  for (const grantBoundTool of ["oso_plan_approve", "oso_plan_cancel"] as const) {
    if (permission[grantBoundTool] !== OWNED_PERMISSION_VALUES[grantBoundTool]) return "malformed";
  }
  return "valid";
}

export function operatorConfigSeed(): ConfigDocument {
  return {
    theme: OPERATOR_CONFIG_PROBE.theme,
    permission: { [OPERATOR_CONFIG_PROBE.permissionKey]: OPERATOR_CONFIG_PROBE.permissionVerdict },
    mcp: {
      [OPERATOR_CONFIG_PROBE.mcpServerName]: {
        type: "local",
        command: [...OPERATOR_CONFIG_PROBE.mcpServerCommand],
        enabled: true,
        environment: {},
      },
    },
  };
}

export function openCodeOperatorKeysStatus(configFile: string): string {
  const read = readConfigDocument(configFile);
  if (read.kind === "missing") return "missing";
  if (read.kind === "unparseable" || !isPlainObject(read.value)) return "dropped";
  const document = read.value;
  if (document["theme"] !== OPERATOR_CONFIG_PROBE.theme) return "dropped";
  const permission = isPlainObject(document["permission"]) ? document["permission"] : {};
  if (permission[OPERATOR_CONFIG_PROBE.permissionKey] !== OPERATOR_CONFIG_PROBE.permissionVerdict) return "dropped";
  const servers = isPlainObject(document["mcp"]) ? document["mcp"] : {};
  const server = servers[OPERATOR_CONFIG_PROBE.mcpServerName];
  if (!isPlainObject(server)) return "dropped";
  if (JSON.stringify(server["command"]) !== JSON.stringify(OPERATOR_CONFIG_PROBE.mcpServerCommand)) return "dropped";
  return "preserved";
}

export function operatorGlobalSeed(): string {
  return `# Personal OpenCode rules\n\n${OPERATOR_GLOBAL_PROSE}\n`;
}

export function openCodeGlobalStatus(globalFile: string, expectedBody: string): string {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const installed = markerRegionBodyOf(readFileSync(globalFile, "utf8"));
  if (installed === undefined) return "malformed";
  return withoutTrailingNewlines(installed) === withoutTrailingNewlines(expectedBody) ? "exact" : "divergent";
}

export function openCodeOperatorGlobalStatus(globalFile: string, seedText: string): string {
  if (!isReadableRegularFile(globalFile)) return "missing";
  const seedRecords = seedText.split("\n").length - 1;
  const head = readFileSync(globalFile, "utf8").split("\n").slice(0, seedRecords).join("\n");
  return `${head}\n` === seedText ? "preserved" : "rewritten";
}

type ConfigRead = Readonly<{ kind: "missing" } | { kind: "unparseable" } | { kind: "parsed"; value: unknown }>;

function readConfigDocument(configFile: string): ConfigRead {
  if (!isReadableRegularFile(configFile)) return { kind: "missing" };
  try {
    return { kind: "parsed", value: readJsonFile(configFile) };
  } catch (error) {
    if (error instanceof JsonParseError) return { kind: "unparseable" };
    throw error;
  }
}

function markerRegionBodyOf(content: string): string | undefined {
  const records = content.split("\n");
  if (records.at(-1) === "") records.pop();
  const body: string[] = [];
  let starts = 0;
  let ends = 0;
  let inside = false;
  for (const record of records) {
    if (record === GLOBAL_MARKER_START) {
      starts += 1;
      inside = true;
      continue;
    }
    if (record === GLOBAL_MARKER_END) {
      ends += 1;
      inside = false;
      continue;
    }
    if (inside) body.push(record);
  }
  if (starts !== 1 || ends !== 1 || inside) return undefined;
  return body.join("\n");
}

function withoutTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}
