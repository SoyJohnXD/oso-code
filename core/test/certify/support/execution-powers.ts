import { isRecord } from "./config-fields.ts";

export type ExecutionPower = Readonly<{ label: string; permission: string; target: string }>;

export const EXECUTION_PHASE_POWERS: readonly ExecutionPower[] = [
  { label: "the state command", permission: "bash", target: "oso-state set active_slice=1" },
  { label: "the slice commit", permission: "bash", target: "git commit -m slice" },
  { label: "the slice's own edits", permission: "edit", target: "src/slice.ts" },
];

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/;

function globToRegExp(pattern: string): RegExp {
  const source = Array.from(pattern)
    .map((char) => (char === "*" ? ".*" : char === "?" ? "." : REGEXP_SPECIAL.test(char) ? `\\${char}` : char))
    .join("");
  return new RegExp(`^${source}$`);
}

function resolvedAction(rules: readonly Record<string, unknown>[], permission: string, target: string): string {
  let action = "unruled";
  for (const rule of rules) {
    const rulePermission = rule["permission"];
    if (rulePermission !== permission && rulePermission !== "*") continue;
    const pattern = typeof rule["pattern"] === "string" ? rule["pattern"] : "*";
    if (!globToRegExp(pattern).test(target)) continue;
    const ruleAction = rule["action"];
    if (typeof ruleAction === "string") action = ruleAction;
  }
  return action;
}

export function deniedExecutionPowers(agentDebug: unknown): readonly string[] {
  const permission = isRecord(agentDebug) ? agentDebug["permission"] : undefined;
  const rules = Array.isArray(permission) ? permission.filter(isRecord) : [];
  return EXECUTION_PHASE_POWERS.filter((power) => resolvedAction(rules, power.permission, power.target) !== "allow").map(
    (power) => power.label,
  );
}
