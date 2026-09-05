import type { Role, RoleChoices, Tier } from "./profile.ts";

export const OPENCODE_CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";
export const CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";

export const OWNED_SKILL_MODES = ["oso-plan", "oso-quick", "oso-debug", "oso-roadmap"] as const;
export const OWNED_SKILL_VERDICT = "deny";
export const OWNED_TASK_PATTERN = "*";
export const OWNED_TASK_VERDICT = "allow";

export const HARNESS_EXTERNAL_DIRECTORIES = ["~/.config/opencode/skill/**", "~/.local/share/opencode/worktree/**"] as const;
export const HARNESS_EXTERNAL_DIRECTORY_VERDICT = "allow";

export const HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT = ["**/.config/opencode/skill/**", "**/.local/state/oso-code/**"] as const;
export const HARNESS_OWNED_TREE_EDIT_VERDICT = "deny";

export const HOST_SURFACES_NO_HARNESS_GRANT_MAY_REACH = [
  "~/.config/opencode/plugin",
  "~/.config/opencode/plugins",
  "~/.config/opencode/bin",
  "~/.config/opencode/hooks",
  "~/.config/opencode/git-hooks",
  "~/.config/opencode/opencode.json",
  "~/.local/state/oso-code",
  "**/.opencode/plugin",
  "**/.opencode/plugins",
] as const;

export type ReachedSurface = Readonly<{ pattern: string; surface: string }>;

export const REACHES_THE_EDIT_CONTROL_BOUNDS: readonly ReachedSurface[] = [
  { pattern: "~/.config/opencode/skill/**", surface: "**/.opencode/plugin" },
  { pattern: "~/.config/opencode/skill/**", surface: "**/.opencode/plugins" },
  { pattern: "~/.local/share/opencode/worktree/**", surface: "**/.opencode/plugin" },
  { pattern: "~/.local/share/opencode/worktree/**", surface: "**/.opencode/plugins" },
];

export type EditRule = Readonly<{ pattern: string; verdict: "allow" | "deny" }>;

export const EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH: readonly EditRule[] = [
  { pattern: "*", verdict: "allow" },
  { pattern: ".config/opencode/**", verdict: "deny" },
  { pattern: "**/.config/opencode/**", verdict: "deny" },
  { pattern: ".opencode/**", verdict: "deny" },
  { pattern: "**/.opencode/**", verdict: "deny" },
  { pattern: ".git/**", verdict: "deny" },
  { pattern: "**/.git/**", verdict: "deny" },
  { pattern: ".local/state/oso-code/**", verdict: "deny" },
  { pattern: "**/.local/state/oso-code/**", verdict: "deny" },
];

export const EDIT_CONTROL_BOUNDING_A_REACH = `edit denied on ${EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter(
  (rule) => rule.verdict === "deny",
)
  .map((rule) => rule.pattern)
  .join(" ")}`;

export const OWNED_PERMISSION_VALUES = {
  question: "allow",
  plan_enter: "allow",
  plan_exit: "allow",
  oso_plan_approve: "ask",
  oso_plan_cancel: "ask",
} as const;

export const OWNED_MCP_NAMES = ["context7", "engram", "fallow"] as const;
export type OwnedMcpName = (typeof OWNED_MCP_NAMES)[number];

export function mcpServerWildcard(server: string): string {
  return `${server}_*`;
}

const SCHEMA_KEY = "$schema";
const PLUGIN_KEY = "plugin";
const PERMISSION_KEY = "permission";
const MCP_KEY = "mcp";
const SKILL_KEY = "skill";
const TASK_KEY = "task";
const EXTERNAL_DIRECTORY_KEY = "external_directory";
const EDIT_KEY = "edit";
const DOOM_LOOP_KEY = "doom_loop";
const HOST_PROMPT_VERDICT = "ask";
const AGENT_KEY = "agent";
const PATH_SEPARATOR = "/";
const SURFACE_AT_ANY_DEPTH_PREFIX = "**/";

const READS_THE_HARNESS_GRANTS_LEAVE_ASKING: readonly Readonly<{ named: string; probedAt: string }>[] = [
  { named: "~/.config/opencode/** beyond skill/", probedAt: "~/.config/opencode/plugin" },
  { named: "~/.local/state/oso-code/**", probedAt: "~/.local/state/oso-code" },
];
const NEVER_PRESERVED_KEYS: readonly string[] = [PERMISSION_KEY, MCP_KEY, PLUGIN_KEY];

const OPENCODE_SESSION_MODEL_FIELDS: Readonly<Record<Tier, string>> = { default: "small_model", strong: "model" };

const OPENCODE_AGENTS_PER_PROFILE_ROLE: Readonly<Record<Role, readonly string[]>> = {
  applier: ["oso-applier"],
  verifier: ["oso-verifier"],
  judges: ["oso-debt-sweep", "oso-doubt-pass", "oso-security-reviewer", "oso-triage"],
};

export const OPENCODE_AGENTS_THE_PROFILE_DRIVES: readonly string[] = Object.values(OPENCODE_AGENTS_PER_PROFILE_ROLE).flat();

export const EVERY_AGENT_ON_THE_HOST_SESSION_MODEL = "every agent runs on the host session model";

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

export function installedAgentModels(existing: unknown): AgentModels {
  const document = isPlainObject(existing) ? existing : {};
  const agents = isPlainObject(document[AGENT_KEY]) ? document[AGENT_KEY] : {};
  const installed: Record<string, string> = {};
  for (const agent of OPENCODE_AGENTS_THE_PROFILE_DRIVES) {
    const spec = agents[agent];
    const model = isPlainObject(spec) ? spec["model"] : undefined;
    if (typeof model === "string") installed[agent] = model;
  }
  return installed;
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
  const preservedKeys = [...foreignKeysOf(document, [], (key) => ownedContainers.includes(key))];

  insertIfMissing(document, SCHEMA_KEY, OPENCODE_CONFIG_SCHEMA_URL);
  createPluginArrayIfAbsent(document);

  const permission = ownedContainer(document, PERMISSION_KEY);
  const ownedPermissionContainers: readonly string[] = [SKILL_KEY, TASK_KEY, EXTERNAL_DIRECTORY_KEY, EDIT_KEY];
  preservedKeys.push(...foreignKeysOf(permission, [PERMISSION_KEY], (name) => name in OWNED_PERMISSION_VALUES || ownedPermissionContainers.includes(name)));

  const skills = ownedContainer(permission, SKILL_KEY);
  preservedKeys.push(...foreignKeysOf(skills, [PERMISSION_KEY, SKILL_KEY], (name) => (OWNED_SKILL_MODES as readonly string[]).includes(name)));
  for (const mode of OWNED_SKILL_MODES) skills[mode] = OWNED_SKILL_VERDICT;

  const delegations = ownedContainer(permission, TASK_KEY);
  preservedKeys.push(...foreignKeysOf(delegations, [PERMISSION_KEY, TASK_KEY], (pattern) => pattern === OWNED_TASK_PATTERN));
  delegations[OWNED_TASK_PATTERN] = OWNED_TASK_VERDICT;

  const externalDirectories = ownedContainer(permission, EXTERNAL_DIRECTORY_KEY);
  const harnessDirectories = HARNESS_EXTERNAL_DIRECTORIES as readonly string[];
  preservedKeys.push(...foreignKeysOf(externalDirectories, [PERMISSION_KEY, EXTERNAL_DIRECTORY_KEY], (pattern) => harnessDirectories.includes(pattern)));
  for (const harnessDirectory of HARNESS_EXTERNAL_DIRECTORIES) externalDirectories[harnessDirectory] = HARNESS_EXTERNAL_DIRECTORY_VERDICT;

  const editRules = ownedContainer(permission, EDIT_KEY);
  const harnessTrees = HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT as readonly string[];
  preservedKeys.push(...foreignKeysOf(editRules, [PERMISSION_KEY, EDIT_KEY], (pattern) => harnessTrees.includes(pattern)));
  for (const harnessTree of HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT) editRules[harnessTree] = HARNESS_OWNED_TREE_EDIT_VERDICT;

  Object.assign(permission, OWNED_PERMISSION_VALUES);

  const servers = ownedContainer(document, MCP_KEY);
  const owned = ownedMcpServers(fallowCommand);
  preservedKeys.push(...foreignKeysOf(servers, [MCP_KEY], (name) => name in owned));
  for (const [name, declaration] of Object.entries(owned)) insertIfMissing(servers, name, declaration);

  if (profileNamesAModel) mergeAgentModels(document, preservedKeys, agentModels);

  return { document, preservedKeys, agentModels };
}

function foreignKeysOf(container: ConfigDocument, containerPath: readonly string[], isInstallerOwned: (name: string) => boolean): readonly string[] {
  return Object.keys(container)
    .filter((name) => !isInstallerOwned(name))
    .map((name) => [...containerPath, name].join("."));
}

function mergeAgentModels(document: ConfigDocument, preservedKeys: string[], agentModels: AgentModels): void {
  const agents = ownedContainer(document, AGENT_KEY);
  preservedKeys.push(...foreignKeysOf(agents, [AGENT_KEY], (name) => name in agentModels));
  for (const [name, model] of Object.entries(agentModels)) ownedContainer(agents, name)["model"] = model;
}

export function hostSurfacesReachedBy(patterns: readonly string[]): readonly ReachedSurface[] {
  return patterns.flatMap((pattern) =>
    HOST_SURFACES_NO_HARNESS_GRANT_MAY_REACH.filter((surface) => grantReachesSurface(pattern, surface)).map((surface) => ({
      pattern,
      surface,
    })),
  );
}

const SURFACES_THE_EDIT_CONTROL_DENIES = [
  ...new Set(
    EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.filter((rule) => rule.verdict === "deny").map((rule) =>
      literalHeadOf(withoutAnyDepthPrefix(rule.pattern)),
    ),
  ),
];

export function editControlDenies(surface: string): boolean {
  return trailingPathsOf(withoutAnyDepthPrefix(surface)).some((trailing) =>
    SURFACES_THE_EDIT_CONTROL_DENIES.some((denied) => isAtOrUnder(trailing, denied)),
  );
}

function withoutAnyDepthPrefix(named: string): string {
  return named.startsWith(SURFACE_AT_ANY_DEPTH_PREFIX) ? named.slice(SURFACE_AT_ANY_DEPTH_PREFIX.length) : named;
}

function literalHeadOf(pattern: string): string {
  const wildcard = pattern.indexOf("*");
  const head = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
  return head.endsWith(PATH_SEPARATOR) ? head.slice(0, -PATH_SEPARATOR.length) : head;
}

const EVERY_WILDCARD_RUN = /\*+/g;
const A_SEGMENT_EVERY_WILDCARD_ADMITS = "any";
const THE_SINGLE_CHARACTER_WILDCARD = /\?/g;
const A_CHARACTER_THE_SINGLE_WILDCARD_ADMITS = "a";
const AT_OR_UNDER_SUFFIX = "/**";
const PATTERN_METACHARACTERS = /[.+^${}()|[\]\\]/g;
const TRAILING_ARGUMENT_WILDCARD = " .*";
const TRAILING_ARGUMENT_MADE_OPTIONAL = "( .*)?";

function grantReachesSurface(grant: string, surface: string): boolean {
  return witnessesBetween(grant, surface).some(
    (witness) => hostPatternMatches(grant, witness) && surfaceCovers(surface, witness),
  );
}

function witnessesBetween(grant: string, surface: string): readonly string[] {
  const underTheGrant = withWildcardsConcreted(grant);
  if (!surface.startsWith(SURFACE_AT_ANY_DEPTH_PREFIX)) return [underTheGrant, surface];
  return [underTheGrant, [underTheGrant, withoutAnyDepthPrefix(surface)].join(PATH_SEPARATOR)];
}

function withWildcardsConcreted(pattern: string): string {
  return pattern
    .replace(EVERY_WILDCARD_RUN, A_SEGMENT_EVERY_WILDCARD_ADMITS)
    .replace(THE_SINGLE_CHARACTER_WILDCARD, A_CHARACTER_THE_SINGLE_WILDCARD_ADMITS);
}

function surfaceCovers(surface: string, witness: string): boolean {
  return hostPatternMatches(surface, witness) || hostPatternMatches(`${surface}${AT_OR_UNDER_SUFFIX}`, witness);
}

export function hostPatternMatches(pattern: string, resource: string): boolean {
  const escaped = pattern.replace(PATTERN_METACHARACTERS, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = escaped.endsWith(TRAILING_ARGUMENT_WILDCARD)
    ? `${escaped.slice(0, -TRAILING_ARGUMENT_WILDCARD.length)}${TRAILING_ARGUMENT_MADE_OPTIONAL}`
    : escaped;
  return new RegExp(`^${expression}$`, "s").test(resource);
}

function trailingPathsOf(candidate: string): readonly string[] {
  const segments = candidate.split(PATH_SEPARATOR);
  return segments.map((_, index) => segments.slice(index).join(PATH_SEPARATOR));
}

function isAtOrUnder(candidate: string, ancestor: string): boolean {
  return ancestor === "" || candidate === ancestor || candidate.startsWith(`${ancestor}${PATH_SEPARATOR}`);
}

export function externalDirectoryGrantsIn(config: unknown): readonly string[] {
  const permission = isPlainObject(config) && isPlainObject(config[PERMISSION_KEY]) ? config[PERMISSION_KEY] : {};
  const rules = isPlainObject(permission[EXTERNAL_DIRECTORY_KEY]) ? permission[EXTERNAL_DIRECTORY_KEY] : {};
  return Object.entries(rules)
    .filter(([, verdict]) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT)
    .map(([pattern]) => pattern);
}

export type HarnessGrantPosture = "as installed" | "narrowed by the operator" | "malformed";

const HOST_PERMISSION_VERDICTS: readonly string[] = ["allow", "ask", "deny"];

export function harnessGrantPostureOf(externalDirectories: ConfigDocument): HarnessGrantPosture {
  const ownedRows = HARNESS_EXTERNAL_DIRECTORIES.map((harnessDirectory) => externalDirectories[harnessDirectory]);
  if (ownedRows.some((verdict) => verdict !== undefined && !isHostVerdict(verdict))) return "malformed";
  const widened = Object.entries(externalDirectories).some(
    ([pattern, verdict]) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT && widensAHarnessGrant(pattern),
  );
  if (widened) return "malformed";
  return ownedRows.every((verdict) => verdict === HARNESS_EXTERNAL_DIRECTORY_VERDICT) ? "as installed" : "narrowed by the operator";
}

function isHostVerdict(verdict: unknown): boolean {
  return typeof verdict === "string" && HOST_PERMISSION_VERDICTS.includes(verdict);
}

function widensAHarnessGrant(pattern: string): boolean {
  return HARNESS_EXTERNAL_DIRECTORIES.some(
    (harnessDirectory) =>
      hostPatternMatches(pattern, withWildcardsConcreted(harnessDirectory)) && !hostPatternMatches(harnessDirectory, withWildcardsConcreted(pattern)),
  );
}

export function remainingPromptsOf(config: unknown): readonly string[] {
  const permission = isPlainObject(config) && isPlainObject(config[PERMISSION_KEY]) ? config[PERMISSION_KEY] : {};
  const spelled = Object.entries(permission).flatMap(([key, rule]) => promptsOfRule(key, rule));
  const unspelledDoomLoop = DOOM_LOOP_KEY in permission ? [] : [DOOM_LOOP_KEY];
  return [...spelled, ...unspelledDoomLoop, ...readsBeyondTheHarnessGrants(permission)].sort();
}

function readsBeyondTheHarnessGrants(permission: ConfigDocument): readonly string[] {
  const rules = isPlainObject(permission[EXTERNAL_DIRECTORY_KEY]) ? Object.entries(permission[EXTERNAL_DIRECTORY_KEY]) : [];
  return READS_THE_HARNESS_GRANTS_LEAVE_ASKING.filter(
    (read) => lastVerdictCovering(rules, read.probedAt) !== HARNESS_EXTERNAL_DIRECTORY_VERDICT,
  ).map((read) => `${EXTERNAL_DIRECTORY_KEY} ${read.named}`);
}

function lastVerdictCovering(rules: readonly (readonly [string, unknown])[], probedAt: string): unknown {
  return rules.filter(([pattern]) => isAtOrUnder(probedAt, literalHeadOf(pattern))).at(-1)?.[1];
}

function promptsOfRule(key: string, rule: unknown): readonly string[] {
  if (rule === HOST_PROMPT_VERDICT) return [key];
  if (!isPlainObject(rule)) return [];
  return Object.entries(rule)
    .filter(([, verdict]) => verdict === HOST_PROMPT_VERDICT)
    .map(([pattern]) => `${key} ${pattern}`);
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
