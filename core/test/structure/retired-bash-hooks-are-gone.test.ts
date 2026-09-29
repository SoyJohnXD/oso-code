import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { posixRepositoryPath } from "../support/repository-paths.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const RETIRED_HOOKS = ["auto-continue.sh", "persist-state-bin.sh", "warn-stale-version.sh"];
const CITATION = new RegExp(RETIRED_HOOKS.map((name) => name.replaceAll(".", "\\.")).join("|"));

const UNSCANNED_PREFIXES = ["docs/", "core/test/fixtures/", "plugin/dist/", "opencode/dist/", "bootstrap/"];
const UNSCANNED_FILES = new Set(["CHANGELOG.md", "core/src/routes/routes.ts", posixRepositoryPath(import.meta.filename)]);
const SCANNED_FLOOR = 300;

const scannedFiles = trackedRepositoryFiles().filter(
  (file) => !UNSCANNED_FILES.has(file) && !UNSCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)),
);

provedSomething(
  `${scannedFiles.length} file(s) were scanned for citations of the retired hooks`,
  scannedFiles.length >= SCANNED_FLOOR,
  `only ${scannedFiles.length} file(s) were scanned, under the ${SCANNED_FLOOR} floor`,
);

describe("the three retired bash hooks are gone and cited nowhere", () => {
  test("none of the three files exists under plugin/hooks", () => {
    const standing = RETIRED_HOOKS.filter((name) => existsSync(path.join(repositoryRoot, "plugin/hooks", name)));
    assert.deepEqual(standing, []);
  });

  test("no prose or test outside the event-label rows names one of them", () => {
    const citations = scannedFiles
      .map(readTrackedText)
      .flatMap(({ file, text }) => text.split("\n").flatMap((line, index) => (CITATION.test(line) ? [`${file}:${index + 1}`] : [])));
    assert.deepEqual(citations, [], citations.join("\n"));
  });
});
