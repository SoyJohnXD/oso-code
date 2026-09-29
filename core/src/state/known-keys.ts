const GATE_STATE_KEYS = ["mode", "active_slice", "verify_green"] as const;

export const SETTABLE_STATE_KEYS = [...GATE_STATE_KEYS, "repo_path", "auto", "auto_change", "auto_wait", "roadmap"] as const;

export const KEYS_CLOSE_REMOVES: readonly string[] = [...GATE_STATE_KEYS, "auto_wait"];

const ENUM_VALUES: Readonly<Record<string, readonly string[]>> = {
  mode: ["plan", "quick", "debug"],
  verify_green: ["true", "false"],
  auto: ["running", "parked", "done"],
};

const settableKeys: ReadonlySet<string> = new Set(SETTABLE_STATE_KEYS);
const gateKeys: ReadonlySet<string> = new Set(GATE_STATE_KEYS);

export function setPairRejection(pairs: readonly string[]): string | undefined {
  return pairs.map(pairRejection).find((reason) => reason !== undefined);
}

export function pairsTouchAGateKey(pairs: readonly string[]): boolean {
  return pairs.some((pair) => gateKeys.has(pair.slice(0, pair.indexOf("="))));
}

function pairRejection(pair: string): string | undefined {
  const eq = pair.indexOf("=");
  if (eq === -1) return `${pair} is no key=value pair`;
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  if (!settableKeys.has(key)) return `${key} is not a known key (${SETTABLE_STATE_KEYS.join(", ")})`;
  if (value.includes("\n")) return `the value of ${key} carries a newline`;
  const allowed = ENUM_VALUES[key];
  if (allowed !== undefined && !allowed.includes(value)) return `${key}=${value} is not one of ${allowed.join(", ")}`;
  return undefined;
}
