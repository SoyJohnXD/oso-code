import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TomlRegionOutput, TomlRegionRequest } from "../../src/install/toml-regions.ts";
import { corpusDocuments, corpusRequests, SHAPES_EXCLUDED_BY_CONSTRUCTION } from "./toml-region-corpus.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const THE_ORACLE = "bootstrap/lib/toml-regions.awk, run by the awk on this machine over each corpus document";

export const TOML_REGION_DIFFERENTIAL_FIXTURE = path.join(
  repositoryRoot,
  "core",
  "test",
  "fixtures",
  "toml",
  "region-differential.json",
);

const AWK_SCRIPT = path.join(repositoryRoot, "bootstrap", "lib", "toml-regions.awk");

const AWK_VARIABLE_OF: Readonly<Record<string, string>> = {
  startMarker: "start_marker",
  endMarker: "end_marker",
  requireRegion: "require_region",
  featureStartMarker: "feature_start_marker",
  featureEndMarker: "feature_end_marker",
  modelKey: "model_key",
  compactKey: "compact_key",
  modelValue: "model_value",
  compactValue: "compact_value",
  targetHeader: "target_header",
};

export type ObservedCase = Readonly<{ shape: string; requestName: string; request: TomlRegionRequest; observed: TomlRegionOutput }>;

export type TomlRegionDifferential = Readonly<{
  oracle: string;
  awkVersion: string;
  excluded: readonly string[];
  cases: readonly ObservedCase[];
}>;

export function tomlRegionDifferentialFromTheRealAwk(): TomlRegionDifferential {
  const workspace = mkdtempSync(path.join(tmpdir(), "oso-toml-region-"));
  try {
    return {
      oracle: THE_ORACLE,
      awkVersion: awkVersion(),
      excluded: SHAPES_EXCLUDED_BY_CONSTRUCTION.map((shape) => shape.named),
      cases: corpusDocuments().flatMap(({ shape, text }) =>
        corpusRequests().map(({ named, request }) => ({
          shape,
          requestName: named,
          request,
          observed: awkOutputOf(workspace, text, request),
        })),
      ),
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function awkOutputOf(workspace: string, text: string, request: TomlRegionRequest): TomlRegionOutput {
  const inputFile = path.join(workspace, "input.toml");
  const rootFile = path.join(workspace, "root.toml");
  const sectionsFile = path.join(workspace, "sections.toml");
  writeFileSync(inputFile, text);
  writeFileSync(rootFile, "");
  writeFileSync(sectionsFile, "");

  const argv = ["-v", `action=${request.action}`];
  for (const [field, variable] of Object.entries(AWK_VARIABLE_OF)) {
    const value = (request as Record<string, unknown>)[field];
    if (value === undefined) continue;
    argv.push("-v", `${variable}=${typeof value === "boolean" ? (value ? "1" : "0") : String(value)}`);
  }
  if (request.featureText !== undefined) {
    const featureFile = path.join(workspace, "feature-block.toml");
    writeFileSync(featureFile, request.featureText);
    argv.push("-v", `feature_file=${featureFile}`);
  }
  if (request.action === "split") argv.push("-v", `root_file=${rootFile}`, "-v", `sections_file=${sectionsFile}`);
  argv.push("-f", AWK_SCRIPT, inputFile);

  const run = spawnSync("awk", argv, { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  if (run.error !== undefined) throw new Error(`awk could not be spawned as the region oracle: ${run.error.message}`);
  if (run.signal !== null) throw new Error(`awk was killed by ${run.signal} while reading the region oracle`);
  return {
    exitCode: run.status ?? -1,
    stdout: run.stdout,
    root: request.action === "split" ? readFileSync(rootFile, "utf8") : "",
    sections: request.action === "split" ? readFileSync(sectionsFile, "utf8") : "",
  };
}

export function awkVersion(): string {
  const run = spawnSync("awk", ["--version"], { encoding: "utf8" });
  if (run.error !== undefined) throw new Error(`awk could not be spawned to read its own version: ${run.error.message}`);
  const firstLine = `${run.stdout}${run.stderr}`.split("\n")[0] ?? "";
  return firstLine.trim();
}
