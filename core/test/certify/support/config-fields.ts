export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentSection(config: unknown): Record<string, unknown> {
  const agent = isRecord(config) ? config["agent"] : undefined;
  return isRecord(agent) ? agent : {};
}

export function agentField(config: unknown, field: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const [name, spec] of Object.entries(agentSection(config))) {
    const value = isRecord(spec) ? spec[field] : undefined;
    values.set(name, typeof value === "string" ? value : "");
  }
  return values;
}

export function agentPermissionField(config: unknown, key: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const [name, spec] of Object.entries(agentSection(config))) {
    values.set(name, verdictOf(permissionRulesOf(spec).find(([ruleKey]) => ruleKey === key)));
  }
  return values;
}

export function agentPermissionVerdicts(config: unknown, toolId: string): ReadonlyMap<string, string> {
  const verdicts = new Map<string, string>();
  for (const [name, spec] of Object.entries(agentSection(config))) {
    const covering = permissionRulesOf(spec).filter(([ruleKey]) => ruleKeyMatches(toolId, ruleKey));
    verdicts.set(name, verdictOf(covering.at(-1)));
  }
  return verdicts;
}

function permissionRulesOf(agentSpec: unknown): readonly (readonly [string, unknown])[] {
  const permission = isRecord(agentSpec) ? agentSpec["permission"] : undefined;
  return isRecord(permission) ? Object.entries(permission) : [];
}

function verdictOf(rule: readonly [string, unknown] | undefined): string {
  const value = rule?.[1];
  return typeof value === "string" ? value : isRecord(value) ? "allowlist" : "absent";
}

const RULE_KEY_METACHARACTERS = /[.+^${}()|[\]\\]/g;
const TRAILING_ARGUMENT_WILDCARD = " .*";

function ruleKeyMatches(toolId: string, ruleKey: string): boolean {
  const escaped = ruleKey.replace(RULE_KEY_METACHARACTERS, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  const expression = escaped.endsWith(TRAILING_ARGUMENT_WILDCARD)
    ? `${escaped.slice(0, -TRAILING_ARGUMENT_WILDCARD.length)}( .*)?`
    : escaped;
  return new RegExp(`^${expression}$`, "s").test(toolId);
}

export function fieldOf(values: ReadonlyMap<string, string>, name: string): string {
  return values.get(name) ?? "absent";
}

function permissionSection(config: unknown): Record<string, unknown> {
  const permission = isRecord(config) ? config["permission"] : undefined;
  return isRecord(permission) ? permission : {};
}

export function topLevelPermissionField(config: unknown, key: string): string {
  const value = permissionSection(config)[key];
  return typeof value === "string" ? value : "absent";
}

export function externalDirectoryRules(config: unknown): ReadonlyMap<string, string> {
  const rules = new Map<string, string>();
  const block = permissionSection(config)["external_directory"];
  if (!isRecord(block)) return rules;
  for (const [pattern, verdict] of Object.entries(block)) rules.set(pattern, verdictOf([pattern, verdict]));
  return rules;
}

export function externalDirectoryVerdict(config: unknown, homeDirectory: string, externalPath: string): string {
  const covering = [...externalDirectoryRules(config)].filter(([pattern]) =>
    ruleKeyMatches(externalPath, homeExpanded(pattern, homeDirectory)),
  );
  return verdictOf(covering.at(-1));
}

const HOME_RELATIVE_PREFIX = "~/";

function homeExpanded(pattern: string, homeDirectory: string): string {
  if (!pattern.startsWith(HOME_RELATIVE_PREFIX)) return pattern;
  return `${homeDirectory}/${pattern.slice(HOME_RELATIVE_PREFIX.length)}`;
}

export function commandAgentRoute(config: unknown, commandName: string): string {
  const command = isRecord(config) ? config["command"] : undefined;
  const spec = isRecord(command) ? command[commandName] : undefined;
  const agent = isRecord(spec) ? spec["agent"] : undefined;
  return typeof agent === "string" ? agent : "absent";
}

export function pluginOrigins(config: unknown): readonly string[] {
  const origins = isRecord(config) ? config["plugin_origins"] : undefined;
  if (!Array.isArray(origins)) return [];
  return origins.flatMap((entry) => (isRecord(entry) && typeof entry["spec"] === "string" ? [entry["spec"]] : []));
}

export function agentShellExactFormViolations(config: unknown): readonly string[] {
  const violations: string[] = [];
  for (const [name, spec] of Object.entries(agentSection(config))) {
    const permission = isRecord(spec) ? spec["permission"] : undefined;
    const allowlist = isRecord(permission) ? permission["bash"] : undefined;
    if (!isRecord(allowlist)) continue;
    for (const form of Object.keys(allowlist)) {
      if (form !== "*" && form.includes("*")) violations.push(`${name}:${form}`);
    }
  }
  return violations;
}

export function skillLocations(document: unknown): ReadonlyMap<string, string> {
  const locations = new Map<string, string>();
  if (!Array.isArray(document)) return locations;
  for (const entry of document) {
    if (!isRecord(entry)) continue;
    const name = entry["name"];
    if (typeof name !== "string") continue;
    const location = entry["location"];
    locations.set(name, typeof location === "string" ? location : "");
  }
  return locations;
}
