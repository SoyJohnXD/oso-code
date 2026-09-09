import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const REMAINING_BASH_SURFACE = "6,851 (Codex 3,432 + OpenCode 2,470 + bootstrap/lib 720 + Claude's engram block 229)";

const CEILINGS = [
  {
    label: "core/src/install",
    prefix: "core/src/install/",
    maximumLines: 9000,
    derivation: `1,678 (measured at C3-S1) + ${REMAINING_BASH_SURFACE} = 8,529`,
  },
  {
    label: "core/test/install",
    prefix: "core/test/install/",
    maximumLines: 8500,
    derivation: "7,994 (measured at S7's arming, by this test's own listing) + 380 (one commit, at C0's measured mean) = 8,374",
  },
  {
    label: "core/src",
    prefix: "core/src/",
    maximumLines: 17500,
    derivation: "14,499 (measured) + 1,800 (C2) + 1,100 (AUTO) = 17,399",
  },
  {
    label: "core/test",
    prefix: "core/test/",
    maximumLines: 27500,
    derivation: "23,088 (measured) + 10 × 380 (nine slices + close) + 550 (C3–C5) = 27,438",
  },
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
  for (const { label, prefix, maximumLines, derivation } of CEILINGS) {
    const files = trackedTypeScriptFilesUnder(prefix);

    provedSomething(
      `${label} counted at least ${MINIMUM_FILES_PER_TREE} tracked *.ts file(s) before summing their lines`,
      files.length >= MINIMUM_FILES_PER_TREE,
      `only ${files.length} tracked *.ts file(s) were found under ${prefix} — a broken walk would also report zero total lines`,
    );

    test(
      `${label} holds ${totalLinesOf(files)} wc -l line(s) across ${files.length} tracked *.ts file(s), at or under its ` +
        `${derivation}, rounded up to the next 500 → ${maximumLines}-line ceiling`,
      () => {
        const total = totalLinesOf(files);
        assert.ok(
          total <= maximumLines,
          `${label} holds ${total} lines across ${files.length} tracked *.ts file(s), over its ${maximumLines}-line ceiling`,
        );
      },
    );
  }
});
