import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GATE_ROWS } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { posixRepositoryPath } from "../support/repository-paths.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const SHARED_BASH_LIBRARIES = ["lib.sh", "lexer.sh"];
const RETIRED_BASH_BARS = ["opencode-contract-bar.sh", "opencode-behavior-bar.sh", "opencode-verification.sh", "verification-fixtures.sh"];

const UNSCANNED_PREFIXES = ["docs/", "core/test/fixtures/", "plugin/hooks/"];
const THIS_CHECK = posixRepositoryPath(import.meta.filename);
const UNSCANNED_FILES = new Set(["CHANGELOG.md", THIS_CHECK]);

const MINIMUM_SCANNED_FILES = 200;
const MINIMUM_REFERENCES_FOUND = 20;

type DeadBashReference = Readonly<{ file: string; line: number; name: string; text: string }>;

type ResidueClass = "installer" | "shell-library" | "citation" | "shipped-prose" | "identifier";

type Residue = Readonly<{ residue: ResidueClass; keptBy: string }>;

const RESIDUE_BY_FILE: ReadonlyMap<string, Residue> = new Map([
  ["bootstrap/hook-hashes.txt", { residue: "installer", keptBy: "C2-D19: the published trust data those installers compare against" }],
  ["core/test/structure/published-hook-hashes.test.ts", { residue: "installer", keptBy: "C2-D19: asserts that trust data's coverage and order" }],
  ["tests/plugin-lint.sh", { residue: "shell-library", keptBy: "C3-D8(2ii): sources lexer.sh as a shell library, confirmed live independently of the two bars C4-S3 retired" }],
  ["core/test/gates/internal-failure-transport.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance in a case title" }],
  ["core/test/gates/teardown-worktrees.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance in a case title" }],
  ["core/test/port/git-call.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance in a case title" }],
  ["core/test/port/lexer.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance in a case title" }],
  ["opencode/skills/oso-plan/references/opencode.md", { residue: "shipped-prose", keptBy: "C2-D24(4): descriptive shipped prose, classified to C5" }],
  ["core/src/prose/skills/plan/references/opencode.md", { residue: "shipped-prose", keptBy: "C2-D24(4): descriptive shipped prose, classified to C5" }],
  ["core/test/certify/opencode-contract-bar.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance naming the bash bar this suite ported" }],
  ["core/test/certify/opencode-behavior-bar.test.ts", { residue: "citation", keptBy: "Decision 9: line-free provenance naming the bash bar this suite ported" }],
  ["core/test/support/repository-paths.test.ts", { residue: "identifier", keptBy: "C4-S3: a retired path as pure string-transform fixture data, never loaded" }],
]);

const deadBashNames: readonly string[] = [...GATE_ROWS.map((row) => row.script), ...SHARED_BASH_LIBRARIES, ...RETIRED_BASH_BARS];

function pathShapedReferencePattern(names: readonly string[]): RegExp {
  const alternatives = names.map((name) => name.replaceAll(".", "\\.")).join("|");
  return new RegExp(`/(${alternatives})(?![:.\\w-])`, "g");
}

function pathShapedReferencesIn({ file, text }: TrackedFileText, pattern: RegExp): DeadBashReference[] {
  return text.split("\n").flatMap((lineText, index) =>
    [...lineText.matchAll(pattern)].map((match) => ({
      file,
      line: index + 1,
      name: match[1] as string,
      text: lineText.trim(),
    })),
  );
}

function isScanned(file: string): boolean {
  return !UNSCANNED_FILES.has(file) && !UNSCANNED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const referencePattern = pathShapedReferencePattern(deadBashNames);
const scannedFiles = trackedRepositoryFiles().filter(isScanned);
const referencesFound = scannedFiles
  .map(readTrackedText)
  .flatMap((tracked) => pathShapedReferencesIn(tracked, referencePattern));
const referencingFiles = [...new Set(referencesFound.map((reference) => reference.file))].sort();

provedSomething(
  `${scannedFiles.length} tracked file(s) were scanned for a path-shaped reference to one of the ` +
    `${deadBashNames.length} bash gate artifacts`,
  scannedFiles.length >= MINIMUM_SCANNED_FILES,
  `only ${scannedFiles.length} file(s) were scanned, under the ${MINIMUM_SCANNED_FILES} this repository holds, ` +
    "so this check looked at a tree it did not recognise rather than finding nothing",
);

provedSomething(
  `${referencesFound.length} path-shaped reference(s) to a bash gate artifact were found and classified`,
  referencesFound.length >= MINIMUM_REFERENCES_FOUND,
  `only ${referencesFound.length} reference(s) were found, under the ${MINIMUM_REFERENCES_FOUND} the known residue ` +
    "carries, so the scanner stopped matching rather than the residue disappearing",
);

describe(
  "no live path loads, sources, spawns, copies, hashes, manifests or requires a bash gate artifact outside the " +
    "residue this child's ledger keeps",
  () => {
    test("every referencing file is a classified residue", () => {
      const unclassified = referencingFiles.filter((file) => !RESIDUE_BY_FILE.has(file));
      assert.deepEqual(
        unclassified,
        [],
        `live reference(s) to the ported bash:\n${reportOf(referencesFound.filter((reference) => unclassified.includes(reference.file)))}`,
      );
    });

    for (const [file, { residue, keptBy }] of RESIDUE_BY_FILE) {
      test(`${file} still references one, as ${residue} — ${keptBy}`, () => {
        assert.ok(
          referencingFiles.includes(file),
          `${file} no longer references a bash gate artifact, so this allowance is stale and belongs in the diff that removed the reference`,
        );
      });
    }
  },
);

describe("pathShapedReferencesIn separates a dependency from a mention", () => {
  test("finds a sourced shared library", () => {
    const planted = { file: "synthetic.sh", text: '. "$REPO_ROOT/plugin/hooks/lib.sh"' };
    assert.deepEqual(
      pathShapedReferencesIn(planted, pathShapedReferencePattern(deadBashNames)).map((found) => found.name),
      ["lib.sh"],
    );
  });

  test("finds a spawned gate script", () => {
    const planted = { file: "synthetic.ts", text: 'spawnSync("bash", ["plugin/hooks/block-commit-until-green.sh"]);' };
    assert.deepEqual(
      pathShapedReferencesIn(planted, pathShapedReferencePattern(deadBashNames)).map((found) => found.name),
      ["block-commit-until-green.sh"],
    );
  });

  test("passes over a `path:line` citation", () => {
    const planted = { file: "synthetic.ts", text: "read from plugin/hooks/block-prod-deploy.sh:130,134" };
    assert.deepEqual(pathShapedReferencesIn(planted, pathShapedReferencePattern(deadBashNames)), []);
  });

  test("passes over the bare basename routes.ts and the bundles carry as the event log's gate value", () => {
    const planted = { file: "synthetic.ts", text: '  script: "block-commit-until-green.sh",' };
    assert.deepEqual(pathShapedReferencesIn(planted, pathShapedReferencePattern(deadBashNames)), []);
  });
});

function reportOf(references: readonly DeadBashReference[]): string {
  return references.map((reference) => `  ${reference.file}:${reference.line} — ${reference.text}`).join("\n");
}
