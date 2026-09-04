import path from "node:path";
import type { TomlRegionOutput, TomlRegionRequest } from "../../src/install/toml-regions.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const THE_ORACLE = "bootstrap/lib/toml-regions.awk as it stood at 2bc77ad, recorded by the awk version named beside these cases";

export const TOML_REGION_DIFFERENTIAL_FIXTURE = path.join(
  repositoryRoot,
  "core",
  "test",
  "fixtures",
  "toml",
  "region-differential.json",
);

export type ObservedCase = Readonly<{ shape: string; requestName: string; request: TomlRegionRequest; observed: TomlRegionOutput }>;

export type TomlRegionDifferential = Readonly<{
  oracle: string;
  awkVersion: string;
  excluded: readonly string[];
  cases: readonly ObservedCase[];
}>;
