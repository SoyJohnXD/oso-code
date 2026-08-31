import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTrustManifest, trustDivergences, type TrustDivergence } from "./trust.ts";
import { isReadableRegularFile } from "../state/store.ts";

export const OPENCODE_TRUST_FILE_COUNT = 19;

const CODEX_TRUST_PREFIX = "codex/";

const INSTALLED_TREE_MAP: readonly Readonly<{ published: string; installed: string }>[] = [
  { published: "opencode/dist/oso-code.js", installed: "plugin/oso-code.js" },
  { published: "plugin/dist/", installed: "dist/" },
  { published: "plugin/hooks/", installed: "hooks/" },
  { published: "plugin/git-hooks/", installed: "git-hooks/" },
  { published: "plugin/bin/", installed: "bin/" },
];

export type TrustRootKind = "source" | "installed";

export type OpenCodeTrustReading = Readonly<{ filesRead: number; divergences: readonly TrustDivergence[] }>;

export function openCodeTrustTargetUnder(rootKind: TrustRootKind, root: string, published: string): string | undefined {
  if (rootKind === "source") return path.join(root, ...published.split("/"));
  const mapped = INSTALLED_TREE_MAP.find((row) => row.published === published || (row.published.endsWith("/") && published.startsWith(row.published)));
  if (mapped === undefined) return undefined;
  const relative = mapped.published.endsWith("/") ? `${mapped.installed}${published.slice(mapped.published.length)}` : mapped.installed;
  return path.join(root, ...relative.split("/"));
}

export function openCodeTrustReading(manifestFile: string, rootKind: TrustRootKind, root: string): OpenCodeTrustReading {
  return {
    filesRead: openCodeTrustedFiles(manifestFile).length,
    divergences: trustDivergences(manifestFile, isCodexTrustFile, (published) => openCodeTrustTargetUnder(rootKind, root, published)),
  };
}

export function publishedGateScriptNames(manifestFile: string): string[] {
  return openCodeTrustedFiles(manifestFile)
    .filter((published) => published.startsWith("plugin/hooks/") && published.endsWith(".sh"))
    .map((published) => published.slice("plugin/hooks/".length));
}

export function publishedDistFileNames(manifestFile: string): string[] {
  return openCodeTrustedFiles(manifestFile)
    .filter((published) => published.startsWith("plugin/dist/"))
    .map((published) => published.slice("plugin/dist/".length));
}

export function trustDivergenceLine(divergence: TrustDivergence): string {
  const state = divergence.state;
  return `${divergence.file} ${state.kind === "mismatch" ? state.actual : state.kind}`;
}

function openCodeTrustedFiles(manifestFile: string): string[] {
  if (!isReadableRegularFile(manifestFile)) return [];
  return parseTrustManifest(readFileSync(manifestFile, "utf8"))
    .map((row) => row.file)
    .filter((file) => !isCodexTrustFile(file));
}

function isCodexTrustFile(published: string): boolean {
  return published.startsWith(CODEX_TRUST_PREFIX);
}
