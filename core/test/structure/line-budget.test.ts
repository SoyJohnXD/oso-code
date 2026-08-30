import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const CEILINGS = [
  { label: "core/src", prefix: "core/src/", maximumLines: 8000 },
  { label: "core/test", prefix: "core/test/", maximumLines: 12000 },
  { label: "core/src/install", prefix: "core/src/install/", maximumLines: 2500 },
  { label: "core/test/install", prefix: "core/test/install/", maximumLines: 3000 },
] as const;

const MINIMUM_FILES_PER_TREE = 5;

function trackedTypeScriptFilesUnder(prefix: string): string[] {
  return trackedRepositoryFiles().filter((file) => file.startsWith(prefix) && file.endsWith(".ts"));
}

function wcDashL(text: string): number {
  return text.split("\n").length - 1;
}

function totalLinesOf(files: readonly string[]): number {
  return files.map(readTrackedText).reduce((total, { text }) => total + wcDashL(text), 0);
}

describe("G4's line budget is measured, not assumed", () => {
  for (const { label, prefix, maximumLines } of CEILINGS) {
    const files = trackedTypeScriptFilesUnder(prefix);

    provedSomething(
      `${label} counted at least ${MINIMUM_FILES_PER_TREE} tracked *.ts file(s) before summing their lines`,
      files.length >= MINIMUM_FILES_PER_TREE,
      `only ${files.length} tracked *.ts file(s) were found under ${prefix} — a broken walk would also report zero total lines`,
    );

    test(`${label} holds ${totalLinesOf(files)} wc -l line(s) across ${files.length} tracked *.ts file(s), at or under its ${maximumLines}-line ceiling`, () => {
      const total = totalLinesOf(files);
      assert.ok(
        total <= maximumLines,
        `${label} holds ${total} lines across ${files.length} tracked *.ts file(s), over its ${maximumLines}-line ceiling`,
      );
    });
  }
});
