import type { Role, RoleChoices, Tier } from "./profile.ts";

export const OPENCODE_CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";
export const CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";

export const OWNED_SKILL_MODES = ["oso-plan", "oso-quick", "oso-debug", "oso-roadmap"] as const;
export const OWNED_SKILL_VERDICT = "deny";
export const OWNED_TASK_PATTERN = "*";
export const OWNED_TASK_VERDICT = "allow";

export const OWNED_PERMISSION_VALUES = {
  question: "allow",
  plan_enter: "allow",
  plan_exit: "allow",
  oso_plan_approve: "ask",
  oso_plan_cancel: "ask",
} as const;

export const OWNED_MCP_NAMES = ["context7", "engram", "fallow"] as const;
export type OwnedMcpName = (typeof OWNED_MCP_NAMES)[number];

export function mcpServerWildcard(server: OwnedMcpName): string {
  return `${server}_*`;
}

const SCHEMA_KEY = "$schema";
const PLUGIN_KEY = "plugin";
const PERMISSION_KEY = "permission";
const MCP_KEY = "mcp";
const SKILL_KEY = "skill";
const TASK_KEY = "task";
const AGENT_KEY = "agent";
const NEVER_PRESERVED_KEYS: readonly string[] = [PERMISSION_KEY, MCP_KEY, PLUGIN_KEY];

const OPENCODE_SESSION_MODEL_FIELDS: Readonly<Record<Tier, string>> = { default: "small_model", strong: "model" };

export const OPENCODE_AGENTS_PER_PROFILE_ROLE: Readonly<Record<Role, readonly string[]>> = {
  applier: ["oso-applier"],
  verifier: ["oso-verifier"],
  judges: ["oso-debt-sweep", "oso-doubt-pass", "oso-security-reviewer", "oso-triage"],
};

export type ConfigDocument = Record<string, unknown>;

export type ConfigRefusalReason =
  | { kind: "config-not-an-object" }
  | { kind: "owned-container-not-an-object"; key: string }
  | { kind: "plugin-not-an-array" };

export class OpenCodeConfigRefusal extends Error {
  readonly reason: ConfigRefusalReason;
  constructor(reason: ConfigRefusalReason) {
    super(refusalMessage(reason));
    this.name = "OpenCodeConfigRefusal";
    this.reason = reason;
  }
}

export type AgentModels = Readonly<Record<string, string>>;

export type MergedOpenCodeConfig = Readonly<{ document: ConfigDocument; preservedKeys: readonly string[]; agentModels: AgentModels }>;

export function openCodeAgentModels(existing: unknown, profileRoles: RoleChoices): AgentModels {
  const document = isPlainObject(existing) ? existing : {};
  const models: Record<string, string> = {};
  for (const [role, agents] of Object.entries(OPENCODE_AGENTS_PER_PROFILE_ROLE) as readonly [Role, readonly string[]][]) {
    const choice = profileRoles[role];
    if (choice === undefined) continue;
    const named = choice.model ?? sessionModelNamed(document, OPENCODE_SESSION_MODEL_FIELDS[choice.tier]);
    if (named === undefined) continue;
    for (const agent of agents) models[agent] = named;
  }
  return models;
}

function sessionModelNamed(document: ConfigDocument, field: string): string | undefined {
  const named = document[field];
  return typeof named === "string" && named !== "" ? named : undefined;
}

export function ownedMcpServers(fallowCommand: string): Readonly<Record<OwnedMcpName, ConfigDocument>> {
  return {
    context7: { type: "remote", url: CONTEXT7_MCP_URL, enabled: true },
    engram: { type: "local", command: ["engram", "mcp", "--tools=agent"], enabled: true, environment: {} },
    fallow: { type: "local", command: [fallowCommand], enabled: true, environment: {} },
  };
}

export function mergeOpenCodeConfig(existing: unknown, fallowCommand: string, profileRoles: RoleChoices = {}): MergedOpenCodeConfig {
  const document = parsedConfigObject(existing);
  const agentModels = openCodeAgentModels(document, profileRoles);
  const profileNamesAModel = Object.keys(agentModels).length > 0;
  const ownedContainers = profileNamesAModel ? [...NEVER_PRESERVED_KEYS, AGENT_KEY] : NEVER_PRESERVED_KEYS;
  const preservedKeys = Object.keys(document).filter((key) => !ownedContainers.includes(key));

  insertIfMissing(document, SCHEMA_KEY, OPENCODE_CONFIG_SCHEMA_URL);
  createPluginArrayIfAbsent(document);

  const permission = ownedContainer(document, PERMISSION_KEY);
  preservedKeys.push(
    ...Object.keys(permission)
      .filter((name) => !(name in OWNED_PERMISSION_VALUES) && name !== SKILL_KEY && name !== TASK_KEY)
      .map((name) => `${PERMISSION_KEY}.${name}`),
  );

  const skills = ownedContainer(permission, SKILL_KEY);
  preservedKeys.push(
    ...Object.keys(skills)
      .filter((name) => !(OWNED_SKILL_MODES as readonly string[]).includes(name))
      .map((name) => `${PERMISSION_KEY}.${SKILL_KEY}.${name}`),
  );
  for (const mode of OWNED_SKILL_MODES) skills[mode] = OWNED_SKILL_VERDICT;

  const delegations = ownedContainer(permission, TASK_KEY);
  preservedKeys.push(
    ...Object.keys(delegations)
      .filter((pattern) => pattern !== OWNED_TASK_PATTERN)
      .map((pattern) => `${PERMISSION_KEY}.${TASK_KEY}.${pattern}`),
  );
  delegations[OWNED_TASK_PATTERN] = OWNED_TASK_VERDICT;

  Object.assign(permission, OWNED_PERMISSION_VALUES);

  const servers = ownedContainer(document, MCP_KEY);
  const owned = ownedMcpServers(fallowCommand);
  preservedKeys.push(
    ...Object.keys(servers)
      .filter((name) => !(name in owned))
      .map((name) => `${MCP_KEY}.${name}`),
  );
  for (const [name, declaration] of Object.entries(owned)) insertIfMissing(servers, name, declaration);

  if (profileNamesAModel) mergeAgentModels(document, preservedKeys, agentModels);

  return { document, preservedKeys, agentModels };
}

function mergeAgentModels(document: ConfigDocument, preservedKeys: string[], agentModels: AgentModels): void {
  const agents = ownedContainer(document, AGENT_KEY);
  preservedKeys.push(
    ...Object.keys(agents)
      .filter((name) => !(name in agentModels))
      .map((name) => `${AGENT_KEY}.${name}`),
  );
  for (const [name, model] of Object.entries(agentModels)) ownedContainer(agents, name)["model"] = model;
}

export function hostContractViolationOf(document: unknown): string | undefined {
  if (!isPlainObject(document)) return "the rendered config is not a JSON object";
  if (!Array.isArray(document[PLUGIN_KEY])) return "plugin must be an array";
  const permission = isPlainObject(document[PERMISSION_KEY]) ? document[PERMISSION_KEY] : {};
  if (permission["oso_plan_approve"] !== "ask") return "the plan approval tool must carry permission ask";
  if (permission["oso_plan_cancel"] !== "ask") return "the plan cancel tool must carry permission ask";
  const servers = isPlainObject(document[MCP_KEY]) ? document[MCP_KEY] : {};
  for (const name of OWNED_MCP_NAMES) {
    if (!declaresAnything(servers[name])) return `${name} MCP server is missing`;
  }
  for (const [name, server] of Object.entries(servers)) {
    if (!isPlainObject(server)) return `malformed MCP server: ${name}`;
    if ("env" in server) return `MCP server uses the env key, not environment: ${name}`;
  }
  return undefined;
}

function refusalMessage(reason: ConfigRefusalReason): string {
  switch (reason.kind) {
    case "config-not-an-object":
      return "the existing opencode.json is not a JSON object";
    case "owned-container-not-an-object":
      return `the existing opencode.json holds a non-object "${reason.key}"; fix it and re-run`;
    case "plugin-not-an-array":
      return `the existing opencode.json holds a non-array "${PLUGIN_KEY}"; fix it and re-run`;
  }
}

function parsedConfigObject(existing: unknown): ConfigDocument {
  if (existing === undefined) return {};
  if (!isPlainObject(existing)) throw new OpenCodeConfigRefusal({ kind: "config-not-an-object" });
  return existing;
}

function createPluginArrayIfAbsent(document: ConfigDocument): void {
  const plugins = document[PLUGIN_KEY];
  if (plugins === undefined || plugins === null) {
    document[PLUGIN_KEY] = [];
    return;
  }
  if (!Array.isArray(plugins)) throw new OpenCodeConfigRefusal({ kind: "plugin-not-an-array" });
}

function ownedContainer(container: ConfigDocument, key: string): ConfigDocument {
  const value = container[key];
  if (value === undefined || value === null) {
    const created: ConfigDocument = {};
    container[key] = created;
    return created;
  }
  if (!isPlainObject(value)) throw new OpenCodeConfigRefusal({ kind: "owned-container-not-an-object", key });
  return value;
}

function insertIfMissing(container: ConfigDocument, key: string, value: unknown): void {
  if (key in container) return;
  container[key] = value;
}

export function declaresAnything(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

export function isPlainObject(value: unknown): value is ConfigDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
