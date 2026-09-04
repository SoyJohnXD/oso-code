import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { isDirectChild } from "../support/repository-paths.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const SCANNED_PREFIXES = ["core/src/", "core/scripts/", "core/test/", "opencode/plugin/"];
const SCANNED_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SHELL_DIRECT_CHILD_GLOBS: readonly { dir: string; ext: string }[] = [
  { dir: "bootstrap", ext: ".sh" },
  { dir: "bootstrap", ext: ".bat" },
  { dir: "bootstrap", ext: ".ps1" },
  { dir: "tools", ext: ".sh" },
  { dir: "plugin/hooks", ext: ".sh" },
  { dir: "tests", ext: ".sh" },
  { dir: "tests/fixtures", ext: ".sh" },
];
const SHELL_EXACT_FILES = new Set(["plugin/bin/oso-state", "plugin/git-hooks/pre-commit"]);
const MINIMUM_SCANNED_FILES = 120;

const COMMENT_OPENING_PATTERN = /\/\/|^[ \t]*\*/;
const SHELL_COMMENT_OPENING_PATTERN = /^[ \t]*(#|[Rr][Ee][Mm][ \t]|::)/;
const DECISION_ID_PATTERN =
  /ADR-[0-9]{4}|docs\/decisions\/[0-9]{4}|[^A-Za-z0-9+]0[01][0-9][0-9](?:[^A-Za-z0-9]|$)|[^A-Za-z0-9][ABDS][0-9]+(?:[^A-Za-z0-9]|$)/;

const LINE_COMMENT = ["/", "/"].join("");

const PLANTED_CITATIONS = [
  `export const PUSHES_WITHOUT_PROGRESS_CAP = 3; ${LINE_COMMENT} ADR-0087 fixed the cap at three`,
  "/**",
  " * D10 keeps a planted citation out of shipped source",
  " */",
];

const PLANTED_LOOKALIKES = [
  `const HEALTH_ENDPOINT = "https:${LINE_COMMENT}example.test/health";`,
  'test("C2-D9 names its decision in a title rather than in a comment", () => {});',
  "/**",
  " * Rounds toward the nearest even byte, which the caller cannot see from the types",
  " */",
];

type DecisionCitation = Readonly<{ file: string; line: number; text: string }>;

function isShellSource(file: string): boolean {
  return SHELL_EXACT_FILES.has(file) || SHELL_DIRECT_CHILD_GLOBS.some(({ dir, ext }) => isDirectChild(file, dir) && file.endsWith(ext));
}

function commentOpeningPatternFor(file: string): RegExp {
  return isShellSource(file) ? SHELL_COMMENT_OPENING_PATTERN : COMMENT_OPENING_PATTERN;
}

function decisionCitationsIn({ file, text }: TrackedFileText): DecisionCitation[] {
  const opening = commentOpeningPatternFor(file);
  return text.split("\n").flatMap((lineText, index) => {
    const match = lineText.match(opening);
    if (match?.index === undefined) return [];
    if (!DECISION_ID_PATTERN.test(lineText.slice(match.index))) return [];
    return [{ file, line: index + 1, text: lineText.trim() }];
  });
}

function isScanned(file: string): boolean {
  const isTypeScriptSource = SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)) && SCANNED_EXTENSIONS.has(path.extname(file));
  return isTypeScriptSource || isShellSource(file);
}

function citationsInPlantedFile(lines: readonly string[]): DecisionCitation[] {
  const directory = mkdtempSync(path.join(tmpdir(), "oso-planted-citation-"));
  try {
    const planted = path.join(directory, "planted.ts");
    writeFileSync(planted, `${lines.join("\n")}\n`);
    return decisionCitationsIn({ file: planted, text: readFileSync(planted, "utf8") });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const scannedFiles = trackedRepositoryFiles().filter(isScanned);
const citationsFound = scannedFiles.map(readTrackedText).flatMap(decisionCitationsIn);

provedSomething(
  `${scannedFiles.length} tracked TypeScript, JavaScript and shipped shell/batch/PowerShell file(s) under ` +
    `${SCANNED_PREFIXES.join(", ")} and plugin/'s shipped executables were read for a decision citation in a comment`,
  scannedFiles.length >= MINIMUM_SCANNED_FILES,
  `only ${scannedFiles.length} file(s) were read, under the ${MINIMUM_SCANNED_FILES} these directories hold, so ` +
    "this check looked at a tree it did not recognise rather than finding nothing",
);

describe(
  "no comment across core/src, core/scripts, core/test, every depth of opencode/plugin, and plugin/'s shipped " +
    "shell, batch and PowerShell executables cites a decision id — a citation scanner rather than a comment " +
    "scanner, because separating a comment from a `//` inside the string and regex literals core/src/shell/lexer.ts " +
    "carries needs a tokeniser this check does not have, and the zero-inline-comment rule stays the operator's, " +
    "held in review",
  () => {
    test("no comment cites a decision id", () => {
      assert.deepEqual(
        citationsFound,
        [],
        citationsFound.map((found) => `${found.file}:${found.line}: ${found.text}`).join("\n"),
      );
    });
  },
);

describe("decisionCitationsIn, read over a planted file this repository does not ship", () => {
  test("flags a trailing `//` comment citing an ADR number and a block-comment line citing a short decision id", () => {
    assert.deepEqual(
      citationsInPlantedFile(PLANTED_CITATIONS).map((found) => found.line),
      [1, 3],
    );
  });

  test("passes over a `//` inside a string literal, a decision id in a test title and a block comment citing none", () => {
    assert.deepEqual(citationsInPlantedFile(PLANTED_LOOKALIKES), []);
  });
});
