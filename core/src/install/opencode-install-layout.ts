import path from "node:path";
import { readJsonFile } from "./json.ts";
import type { OpenCodePaths } from "./opencode.ts";
import type { TrustRow } from "./trust.ts";

export type OpenCodeInstallTargets = Readonly<{
  skills: string;
  agents: string;
  commands: string;
  plugin: string;
  hooks: string;
  gitHooks: string;
  stateBin: string;
  dist: string;
  engramPlugin: string;
  impeccableMount: string;
  impeccableOptOut: string;
  ownerRegistry: string;
  restoreExercisedMarker: string;
  planArtifactRoot: string;
  installRecord: string;
}>;

export type OpenCodeInstallRecord = Readonly<{ version: string; manifest: readonly TrustRow[] }>;

export function openCodeInstallTargets(paths: OpenCodePaths): OpenCodeInstallTargets {
  return {
    skills: path.join(paths.configHome, "skill"),
    agents: path.join(paths.configHome, "agent"),
    commands: path.join(paths.configHome, "command"),
    plugin: path.join(paths.configHome, "plugin"),
    hooks: path.join(paths.configHome, "hooks"),
    gitHooks: path.join(paths.configHome, "git-hooks"),
    stateBin: path.join(paths.configHome, "bin"),
    dist: path.join(paths.configHome, "dist"),
    engramPlugin: path.join(paths.configHome, "plugins", "engram.ts"),
    impeccableMount: path.join(paths.homeDirectory, ".agents", "skills", "impeccable"),
    impeccableOptOut: path.join(paths.stateRoot, "impeccable-opt-out"),
    ownerRegistry: path.join(paths.stateRoot, "opencode-install-registry"),
    restoreExercisedMarker: path.join(paths.stateRoot, ".install-restore-verified-opencode"),
    planArtifactRoot: path.join(paths.stateRoot, "plans"),
    installRecord: path.join(paths.configHome, "oso-code-install.json"),
  };
}

export function isOpenCodeInstallRecord(parsed: unknown): parsed is OpenCodeInstallRecord {
  const candidate = parsed as { version?: unknown; manifest?: unknown } | null;
  if (typeof candidate?.version !== "string" || !Array.isArray(candidate.manifest)) return false;
  return candidate.manifest.every((row: { digest?: unknown; file?: unknown } | null) => typeof row?.digest === "string" && typeof row.file === "string");
}

export function harnessManifestOf(repositoryRoot: string): string {
  return path.join(repositoryRoot, "plugin", ".claude-plugin", "plugin.json");
}

export function harnessVersionIn(harnessManifest: string): string {
  const version = (readJsonFile(harnessManifest) as { version?: unknown } | undefined)?.version;
  if (typeof version !== "string" || version === "") throw new Error(`the harness manifest names no version: ${harnessManifest}`);
  return version;
}
