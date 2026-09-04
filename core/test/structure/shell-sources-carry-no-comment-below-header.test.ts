import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { isDirectChild } from "../support/repository-paths.ts";
import { linesOutsideHeredocBodies, type SourceLine } from "../support/shell-heredoc-lines.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const DIRECT_CHILD_GLOBS: readonly { dir: string; ext: string }[] = [
  { dir: "bootstrap", ext: ".sh" },
  { dir: "bootstrap/lib", ext: ".sh" },
  { dir: "plugin/hooks", ext: ".sh" },
  { dir: "tests", ext: ".sh" },
  { dir: "tests/fixtures", ext: ".sh" },
  { dir: "tools", ext: ".sh" },
];
const EXACT_FILES = new Set(["plugin/git-hooks/pre-commit"]);
const MINIMUM_SCANNED_FILES = 15;
const MINIMUM_SCANNED_FILES_DERIVATION =
  "bootstrap/*.sh, bootstrap/lib/*.sh, plugin/hooks/*.sh, plugin/git-hooks/pre-commit, tests/*.sh, " +
  "tests/fixtures/*.sh and tools/*.sh, measured at C5-S5b: 20";
const COMMENT_LINE = /^[ \t]*#/;
const SHEBANG_LINE = /^#!/;

type CommentSite = Readonly<{ file: string; line: number }>;

function isShellSource(file: string): boolean {
  return EXACT_FILES.has(file) || DIRECT_CHILD_GLOBS.some(({ dir, ext }) => isDirectChild(file, dir) && file.endsWith(ext));
}

function commentsBelowContractHeader({ file, text }: TrackedFileText): CommentSite[] {
  const lines = linesOutsideHeredocBodies(text);
  const first = lines[0] as SourceLine | undefined;
  let headerOpen = first !== undefined && !SHEBANG_LINE.test(first.text);
  const violations: CommentSite[] = [];
  for (const { number, text: lineText } of lines) {
    if (COMMENT_LINE.test(lineText)) {
      if (number !== 1 && !headerOpen) violations.push({ file, line: number });
      continue;
    }
    headerOpen = false;
  }
  return violations;
}

const scannedFiles = trackedRepositoryFiles().filter(isShellSource);

provedSomething(
  `${scannedFiles.length} tracked shell source file(s) were read for a comment below their contract header`,
  scannedFiles.length >= MINIMUM_SCANNED_FILES,
  `only ${scannedFiles.length} file(s) were read, under the ${MINIMUM_SCANNED_FILES}-file floor (${MINIMUM_SCANNED_FILES_DERIVATION})`,
);

const violations = scannedFiles.map(readTrackedText).flatMap(commentsBelowContractHeader);

describe(
  "a shell file states its contract in one comment block above its first line of code or nowhere — a heredoc " +
    "body is skipped rather than read as code or comment, so its own content never closes or reopens the header",
  () => {
    test("no shell source carries a comment below its contract header", () => {
      assert.deepEqual(
        violations,
        [],
        violations.map((site) => `${site.file}:${site.line}`).join("\n"),
      );
    });
  },
);
