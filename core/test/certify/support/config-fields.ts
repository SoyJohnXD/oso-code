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
    const permission = isRecord(spec) ? spec["permission"] : undefined;
    const rule = isRecord(permission) ? permission[key] : undefined;
    values.set(name, typeof rule === "string" ? rule : isRecord(rule) ? "allowlist" : "absent");
  }
  return values;
}

export function fieldOf(values: ReadonlyMap<string, string>, name: string): string {
  return values.get(name) ?? "absent";
}

export function topLevelPermissionField(config: unknown, key: string): string {
  const permission = isRecord(config) ? config["permission"] : undefined;
  const value = isRecord(permission) ? permission[key] : undefined;
  return typeof value === "string" ? value : "absent";
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
