import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { versionFieldOf } from "../../../src/install/opencode-host.ts";
import { isAboveTestedVersion, meetsVersionFloor } from "../../../src/install/pins.ts";
import { isExecutableRegularFile } from "../../../src/state/store.ts";
import { firstExecutableOnPath } from "../../../src/install/verify-claude.ts";

const OPENCODE_BINARY_NAME = "opencode";
const PROBE_HOME_PREFIX = "oso-contract-bar-binary-probe.";

export type PinRelation = "at-pin" | "above-pin" | "below-floor";

export type OpenCodeBinaryProbe =
  | Readonly<{ kind: "resolved"; binary: string; version: string; relation: PinRelation }>
  | Readonly<{ kind: "unresolved"; reason: string }>;

export type ResolvedProbe = Extract<OpenCodeBinaryProbe, { kind: "resolved" }>;

function candidateBinary(overrideBinary: string | undefined, environment: NodeJS.ProcessEnv): string | undefined {
  if (overrideBinary !== undefined && overrideBinary !== "") return overrideBinary;
  const onPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  if (onPath !== undefined) return onPath;
  const home = environment["HOME"];
  if (home === undefined) return undefined;
  const fallback = path.join(home, ".opencode", "bin", OPENCODE_BINARY_NAME);
  return isExecutableRegularFile(fallback) ? fallback : undefined;
}

function probeEnvironment(environment: NodeJS.ProcessEnv, probeHome: string): NodeJS.ProcessEnv {
  return {
    ...environment,
    HOME: probeHome,
    USERPROFILE: probeHome,
    TMPDIR: probeHome,
    XDG_CONFIG_HOME: path.join(probeHome, ".config"),
    XDG_STATE_HOME: path.join(probeHome, ".local", "state"),
    XDG_CACHE_HOME: path.join(probeHome, ".cache"),
    XDG_DATA_HOME: path.join(probeHome, ".local", "share"),
  };
}

function measuredVersion(binary: string, environment: NodeJS.ProcessEnv): string {
  const probeHome = mkdtempSync(path.join(environment["TMPDIR"] ?? tmpdir(), PROBE_HOME_PREFIX));
  try {
    const run = spawnSync(binary, ["--version"], { env: probeEnvironment(environment, probeHome), encoding: "utf8" });
    return versionFieldOf(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

function relationOf(version: string, pin: string): PinRelation {
  if (!meetsVersionFloor(version, pin)) return "below-floor";
  return isAboveTestedVersion(version, pin) ? "above-pin" : "at-pin";
}

export function resolveOpenCodeBinaryProbe(
  overrideBinary: string | undefined,
  pin: string,
  environment: NodeJS.ProcessEnv,
): OpenCodeBinaryProbe {
  const candidate = candidateBinary(overrideBinary, environment);
  if (candidate === undefined) {
    return {
      kind: "unresolved",
      reason: `no opencode binary named by the override, on PATH, or at ${environment["HOME"] ?? "$HOME"}/.opencode/bin/opencode`,
    };
  }
  if (!isExecutableRegularFile(candidate)) {
    return { kind: "unresolved", reason: `no executable opencode binary at ${candidate}` };
  }
  const version = measuredVersion(candidate, environment);
  return { kind: "resolved", binary: candidate, version, relation: relationOf(version, pin) };
}
