import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstExecutableOnPath } from "./verify-claude.ts";

export const OPENCODE_BINARY_NAME = "opencode";
const PROBE_HOME_PREFIX = "oso-opencode-probe.";
const ANSI_SELECT_GRAPHIC_RENDITION = /\u001b\[[0-9;]*m/g;
const POSIX_SPACE_CLASS = /[ \t\n\v\f\r]/g;

export type OpenCodeHostProbes = Readonly<{ version: string | undefined }>;

export function openCodeHostProbes(environment: NodeJS.ProcessEnv): OpenCodeHostProbes {
  const binaryPath = firstExecutableOnPath(environment, OPENCODE_BINARY_NAME);
  return { version: binaryPath === undefined ? undefined : probedVersion(environment, binaryPath) };
}

export function versionFieldOf(probeOutput: string): string {
  return probeOutput.replace(ANSI_SELECT_GRAPHIC_RENDITION, "").replace(POSIX_SPACE_CLASS, "");
}

function probedVersion(environment: NodeJS.ProcessEnv, binaryPath: string): string {
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
