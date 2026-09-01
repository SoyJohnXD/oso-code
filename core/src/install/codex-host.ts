import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SUPPORTED_CODEX_VERSION } from "./pins.ts";
import { firstExecutableOnPath } from "./verify-claude.ts";

const CODEX_BINARY = "codex";
const OSO_PERMISSION_PROFILE = "oso";
const VALIDATION_HOME_PREFIX = ".validate.";

export type HostRun = Readonly<{ ok: boolean; output: string }>;

export type CodexHostProbes = Readonly<{
  version: string | undefined;
  binaryPath: string | undefined;
  acceptsConfig: (codexHome: string, configText: string) => boolean;
  sandbox: (argv: readonly string[]) => HostRun;
  pluginListing: () => HostRun;
}>;

export function pinnedVersionRefusal(found: string | undefined): string {
  const current = found === undefined || found === "" ? "not installed" : found;
  return (
    `Codex CLI must already be ${SUPPORTED_CODEX_VERSION} or newer (found ${current}); ` +
    `run: npm install --global @openai/codex@${SUPPORTED_CODEX_VERSION}`
  );
}

export function versionFieldsOf(versionOutput: string): string {
  return versionOutput
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .join("\n")
    .replace(/\n+$/, "");
}

export function codexHostProbes(environment: NodeJS.ProcessEnv): CodexHostProbes {
  const binaryPath = firstExecutableOnPath(environment, CODEX_BINARY);
  const version = binaryPath === undefined ? undefined : probedVersion(environment);
  return {
    version,
    binaryPath,
    acceptsConfig: (codexHome, configText) => sandboxAcceptsConfig(environment, codexHome, configText),
    sandbox: (argv) => hostRun(environment, ["sandbox", "-P", OSO_PERMISSION_PROFILE, "--", ...argv]),
    pluginListing: () => hostRun(environment, ["plugin", "list", "--json"]),
  };
}

function probedVersion(environment: NodeJS.ProcessEnv): string | undefined {
  const run = spawnSync(CODEX_BINARY, ["--version"], { env: environment, encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return undefined;
  return versionFieldsOf(run.stdout);
}

function hostRun(environment: NodeJS.ProcessEnv, argv: readonly string[]): HostRun {
  const run = spawnSync(CODEX_BINARY, [...argv], { env: environment, encoding: "utf8" });
  if (run.error !== undefined) return { ok: false, output: run.error.message };
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() };
}

function sandboxAcceptsConfig(environment: NodeJS.ProcessEnv, codexHome: string, configText: string): boolean {
  const validationHome = mkdtempSync(path.join(codexHome, VALIDATION_HOME_PREFIX));
  try {
    writeFileSync(path.join(validationHome, "config.toml"), configText, { mode: 0o600 });
    const run = spawnSync(CODEX_BINARY, ["sandbox", "-P", OSO_PERMISSION_PROFILE, "--", "/bin/true"], {
      env: { ...environment, CODEX_HOME: validationHome },
      encoding: "utf8",
    });
    return run.error === undefined && run.status === 0;
  } finally {
    rmSync(validationHome, { recursive: true, force: true });
  }
}
