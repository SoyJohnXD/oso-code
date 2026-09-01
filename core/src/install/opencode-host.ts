import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstExecutableOnPath } from "./verify-claude.ts";
import { versionLineReadingOf, versionOutcomeOf, type VersionLineReading } from "./version-line.ts";

export const OPENCODE_BINARY_NAME = "opencode";
export const OPENCODE_VERSION_LINE_SHAPE = "a bare dotted version";
const PROBE_HOME_PREFIX = "oso-opencode-probe.";
const ANSI_SELECT_GRAPHIC_RENDITION = /\u001b\[[0-9;]*m/g;
const POSIX_SPACE_CLASS = /[ \t\n\v\f\r]/g;
const OPENCODE_VERSION_LINE = /^(\d+(?:\.\d+)*)$/;

export type OpenCodeHostProbes = Readonly<{ version: string | undefined; versionNote?: string }>;

export function openCodeHostProbes(environment: NodeJS.ProcessEnv): OpenCodeHostProbes {
  const binaryPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  if (binaryPath === undefined) return { version: undefined };
  const outcome = versionOutcomeOf(probedVersion(environment, binaryPath), OPENCODE_VERSION_LINE_SHAPE);
  return outcome.note === undefined ? { version: outcome.version } : { version: outcome.version, versionNote: outcome.note };
}

export function versionFieldOf(probeOutput: string): VersionLineReading {
  const strippedPerLine = probeOutput
    .replace(ANSI_SELECT_GRAPHIC_RENDITION, "")
    .split("\n")
    .map((line) => line.replace(POSIX_SPACE_CLASS, ""))
    .join("\n");
  return versionLineReadingOf(strippedPerLine, OPENCODE_VERSION_LINE);
}

function probedVersion(environment: NodeJS.ProcessEnv, binaryPath: string): VersionLineReading {
  const probeHome = mkdtempSync(path.join(environment["TMPDIR"] ?? tmpdir(), PROBE_HOME_PREFIX));
  try {
    const run = spawnSync(binaryPath, ["--version"], { env: probeEnvironment(environment, probeHome), encoding: "utf8" });
    return versionFieldOf(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
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
