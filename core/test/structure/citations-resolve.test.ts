import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const SOURCE_EXTENSIONS = new Set(["sh", "ts", "tsx", "js", "mjs", "cjs", "md", "toml", "txt", "ps1", "yml", "yaml"]);
const TARGET_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, "json"]);
const SCANNED_PREFIXES = ["core/", "docs/rewrite/", "tests/", "bootstrap/"];
const SCANNED_EXACT_FILES = new Set(["CHANGELOG.md"]);
const SHORTHAND_ROOTS = ["", "plugin/skills/_shared/"];
const CITATION_PATTERN = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*/g;
const BARE_BASENAME_PATTERN = /(?<![\w./-])[A-Za-z0-9_.-]+\.[A-Za-z0-9]+:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*/g;
const BARE_CONTINUATION_PATTERN = /(?<![\w./-]):\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*/g;

type Citation = Readonly<{ source: string; sourceLine: number; target: string; spec: string }>;
type Resolution = Readonly<{ ok: boolean; resolvedAs?: string }>;

function citationsIn(source: string, text: string): Citation[] {
  const citations: Citation[] = [];
  text.split("\n").forEach((lineText, index) => {
    for (const whole of lineText.match(CITATION_PATTERN) ?? []) {
      const boundary = whole.lastIndexOf(":");
      const target = whole.slice(0, boundary);
      const spec = whole.slice(boundary + 1);
      if (!TARGET_EXTENSIONS.has(extensionOf(target))) continue;
      citations.push({ source, sourceLine: index + 1, target, spec });
    }
  });
  return citations;
}

function resolveCitation(citation: Citation, trackedFiles: ReadonlySet<string>): Resolution {
  for (const root of SHORTHAND_ROOTS) {
    const candidate = `${root}${citation.target}`;
    if (!trackedFiles.has(candidate)) continue;
    if (specFitsWithin(citation.spec, lineCountOf(candidate))) return { ok: true, resolvedAs: candidate };
  }
  return { ok: false };
}

function bareCitationCount(text: string): number {
  let count = 0;
  text.split("\n").forEach((lineText) => {
    for (const whole of lineText.match(BARE_BASENAME_PATTERN) ?? []) {
      if (TARGET_EXTENSIONS.has(extensionOf(whole.slice(0, whole.lastIndexOf(":"))))) count++;
    }
    count += (lineText.match(BARE_CONTINUATION_PATTERN) ?? []).length;
  });
  return count;
}

function extensionOf(file: string): string {
  return file.slice(file.lastIndexOf(".") + 1);
}

function lineCountOf(repoRelativePath: string): number {
  const lines = readFileSync(path.join(repositoryRoot, repoRelativePath), "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function specFitsWithin(spec: string, totalLines: number): boolean {
  return spec.split(",").every((piece) => {
    const [startText, endText] = piece.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return start >= 1 && end >= start && end <= totalLines;
  });
}

function isScanned(file: string): boolean {
  return (
    SOURCE_EXTENSIONS.has(extensionOf(file)) &&
    (SCANNED_EXACT_FILES.has(file) || SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)))
  );
}

const trackedFiles = trackedRepositoryFiles();
const trackedFileSet = new Set(trackedFiles);
const scannedFiles = trackedFiles.filter(isScanned);
const scannedFileTexts = scannedFiles.map(readTrackedText);
const citationsFound = scannedFileTexts.flatMap(({ file, text }) => citationsIn(file, text));
const bareCitationTotal = scannedFileTexts.reduce((total, { text }) => total + bareCitationCount(text), 0);

provedSomething(
  `at least one <repo-file>:<line> citation was found across ${scannedFiles.length} scanned file(s)`,
  citationsFound.length > 0,
  `zero citations were found across ${scannedFiles.length} scanned file(s), so this check compared nothing`,
);

provedSomething(
  `${bareCitationTotal} bare-basename or bare-":line"-continuation citation(s) across the same ` +
    `${scannedFiles.length} scanned file(s) sit outside the path:line form this check recognises, uncounted here`,
  bareCitationTotal > 0,
  "zero bare citations were found, so this check's narrowed name no longer needs the disclaimer",
);

describe(
  "every full `path:line` citation under core/, docs/rewrite/, tests/, bootstrap/ and CHANGELOG.md that this " +
    "check recognises — the `dir/.../file.ext:line` form only, not bare basenames or bare `:line` " +
    "continuations — resolves and is in bounds",
  () => {
    for (const citation of citationsFound) {
      test(`${citation.source}:${citation.sourceLine} cites ${citation.target}:${citation.spec}`, () => {
        assert.ok(
          resolveCitation(citation, trackedFileSet).ok,
          `${citation.target}:${citation.spec} does not exist, cited from ${citation.source}:${citation.sourceLine}`,
        );
      });
    }
  },
);

describe("resolveCitation", () => {
  test("fails a citation whose target file is not in the tree", () => {
    const citation: Citation = { source: "synthetic", sourceLine: 0, target: "core/does/not/exist.ts", spec: "1" };
    assert.equal(resolveCitation(citation, trackedFileSet).ok, false);
  });

  test("fails a citation whose line falls past its target's end", () => {
    const citation: Citation = { source: "synthetic", sourceLine: 0, target: "package.json", spec: "999999" };
    assert.equal(resolveCitation(citation, trackedFileSet).ok, false);
  });

  test("resolves a shorthand citation against a shared skill body", () => {
    const citation: Citation = { source: "synthetic", sourceLine: 0, target: "bodies/debug.md", spec: "19" };
    assert.equal(resolveCitation(citation, trackedFileSet).ok, true);
  });
});
