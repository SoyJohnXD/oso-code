import { readFileSync } from "node:fs";
import path from "node:path";
import { loadFixturesFrom } from "./parity-fixture.ts";
import { repositoryRoot } from "./state-sandbox.ts";

const SCAN_FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "scan");

export type ScanVerb = "comments" | "abstractions";

export type ProjectFiles = Readonly<Record<string, readonly string[]>>;

export type ScanFixture = Readonly<{
  file: string;
  name: string;
  verb: ScanVerb;
  language: string;
  committed: ProjectFiles;
  worktree: ProjectFiles;
  expect: Readonly<{ hits: readonly string[]; summary: string }>;
}>;

export function loadScanFixtures(): ScanFixture[] {
  return loadFixturesFrom(SCAN_FIXTURE_DIRECTORY, readScanFixture);
}

export function textFilesOf(files: ProjectFiles): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([relativePath, lines]) => [relativePath, `${lines.join("\n")}\n`]));
}

function readScanFixture(file: string): ScanFixture {
  const document = JSON.parse(readFileSync(file, "utf8")) as Omit<ScanFixture, "file">;
  if (document.verb !== "comments" && document.verb !== "abstractions") {
    throw new Error(`${file} names no scan verb`);
  }
  if (Object.keys(document.worktree).length === 0) {
    throw new Error(`${document.name} changes no file, so the scan would read an unchanged tree`);
  }
  return { ...document, file: path.basename(file) };
}
