import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTrustManifest, trustDivergences, type TrustDivergence, type TrustRow } from "./trust.ts";
import { isReadableRegularFile } from "../state/store.ts";

export const OPENCODE_TRUST_FILE_COUNT = 7;

const INSTALLED_TREE_MAP: readonly Readonly<{ published: string; installed: string }>[] = [
  { published: "opencode/dist/oso-code.js", installed: "plugin/oso-code.js" },
  { published: "plugin/dist/", installed: "dist/" },
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
    filesRead: openCodeTrustRows(manifestFile).length,
    divergences: trustDivergences(manifestFile, isClaudeOnlyShellGate, (published) => openCodeTrustTargetUnder(rootKind, root, published)),
  };
}

export function openCodeTrustRows(manifestFile: string): TrustRow[] {
  if (!isReadableRegularFile(manifestFile)) return [];
  return parseTrustManifest(readFileSync(manifestFile, "utf8")).filter((row) => !isClaudeOnlyShellGate(row.file));
}

export function publishedDistFileNames(manifestFile: string): string[] {
  return openCodeTrustRows(manifestFile)
    .map((row) => row.file)
    .filter((published) => published.startsWith("plugin/dist/"))
    .map((published) => published.slice("plugin/dist/".length));
}

export function trustDivergenceLine(divergence: TrustDivergence): string {
  const state = divergence.state;
  return `${divergence.file} ${state.kind === "mismatch" ? state.actual : state.kind}`;
}

function isClaudeOnlyShellGate(published: string): boolean {
  return published.startsWith("plugin/hooks/") && published.endsWith(".sh");
}
