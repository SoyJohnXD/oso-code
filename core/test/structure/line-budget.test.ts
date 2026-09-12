import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const REMAINING_BASH_SURFACE = "6,851 (Codex 3,432 + OpenCode 2,470 + bootstrap/lib 720 + Claude's engram block 229)";

const LINE_BUDGETS = [
  {
    label: "core/src/install",
    prefix: "core/src/install/",
    maximumLines: 9000,
    derivedLines: 8529,
    derivation: `1,678 (measured at C3-S1) + ${REMAINING_BASH_SURFACE}`,
  },
  {
    label: "core/test/install",
    prefix: "core/test/install/",
    maximumLines: 8500,
    derivedLines: 8374,
    derivation: "7,994 (measured at S7's arming, by this test's own listing) + 380 (one commit, at C0's measured mean)",
  },
  {
    label: "core/src",
    prefix: "core/src/",
    maximumLines: 17500,
    derivedLines: 17399,
    derivation: "14,499 (measured) + 1,800 (C2) + 1,100 (AUTO)",
  },
  {
    label: "core/test",
    prefix: "core/test/",
    maximumLines: 28500,
    derivedLines: 28353,
    derivation:
      "27,542 (measured at this change's arming, by this test's own listing) + 811 (this change's own nine " +
      "commits and the debt sweep that closed them, this row's rewrite included)",
  },
] as const;

type LineBudget = (typeof LINE_BUDGETS)[number];

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

function groupedLines(lines: number): string {
  return lines.toLocaleString("en-US");
}

function standingAgainstBudget(total: number, { derivation, derivedLines, maximumLines }: LineBudget): string {
  const derived = `its ${derivation} = ${groupedLines(derivedLines)} derivation`;
  const againstDerivation =
    total <= derivedLines
      ? `${groupedLines(derivedLines - total)} under ${derived}`
      : `${groupedLines(total - derivedLines)} past ${derived} and green on the round-up alone`;
  return (
    `${againstDerivation}, and ${groupedLines(maximumLines - total)} under the ` +
    `${groupedLines(maximumLines)}-line ceiling that derivation rounds up to`
  );
}

describe("G4's line budget is measured, not assumed", () => {
  for (const budget of LINE_BUDGETS) {
    const files = trackedTypeScriptFilesUnder(budget.prefix);
    const total = totalLinesOf(files);

    provedSomething(
      `${budget.label} counted at least ${MINIMUM_FILES_PER_TREE} tracked *.ts file(s) before summing their lines`,
      files.length >= MINIMUM_FILES_PER_TREE,
      `only ${files.length} tracked *.ts file(s) were found under ${budget.prefix} — a broken walk would also report zero total lines`,
    );

    test(
      `${budget.label} holds ${groupedLines(total)} wc -l line(s) across ${files.length} tracked *.ts file(s), ` +
        standingAgainstBudget(total, budget),
      () => {
        assert.ok(
          total <= budget.maximumLines,
          `${budget.label} holds ${groupedLines(total)} lines across ${files.length} tracked *.ts file(s), ` +
            `over its ${groupedLines(budget.maximumLines)}-line ceiling`,
        );
      },
    );
  }
});
