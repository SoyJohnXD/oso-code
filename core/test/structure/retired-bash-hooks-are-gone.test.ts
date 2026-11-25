import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const HOOKS_DIRECTORY = "plugin/hooks/";
const HOOKS_MANIFEST = `${HOOKS_DIRECTORY}hooks.json`;
const RETIRED_SCRIPT_NAMES = [
  "block-commit-until-green",
  "block-edits-without-slice",
  "block-prod-deploy",
  "cleanup-state",
  "lexer",
  "lib",
  "reanchor-after-compact",
  "warn-stale-state",
];
const RETIRED_CITATION = new RegExp(`${HOOKS_DIRECTORY}(${RETIRED_SCRIPT_NAMES.join("|")})\\.sh`);
const SHIPPED_PREFIXES = ["plugin/", "opencode/", "core/src/", "bootstrap/", ".github/"];

function strayHooksDirectoryFiles(files: readonly string[]): string[] {
  return files.filter((file) => file.startsWith(HOOKS_DIRECTORY) && file !== HOOKS_MANIFEST);
}

function retiredScriptCitations({ file, text }: TrackedFileText): string[] {
  return text.split("\n").flatMap((line, index) => (RETIRED_CITATION.test(line) ? [`${file}:${index + 1}`] : []));
}

const trackedFiles = trackedRepositoryFiles();
const shippedFiles = trackedFiles.filter((file) => SHIPPED_PREFIXES.some((prefix) => file.startsWith(prefix)));

provedSomething(
  `${shippedFiles.length} shipped file(s) were scanned and the walk saw ${HOOKS_MANIFEST}`,
  shippedFiles.length > 0 && trackedFiles.includes(HOOKS_MANIFEST),
  "the walk found no shipped file or never reached the hooks manifest, so this check searched nothing",
);

describe("the retired bash hook scripts are gone from the tree", () => {
  test("the hooks directory holds only the manifest", () => {
    assert.deepEqual(strayHooksDirectoryFiles(trackedFiles), []);
  });

  test("no shipped file cites a retired script by its hooks path", () => {
    const citations = shippedFiles.map(readTrackedText).flatMap(retiredScriptCitations);
    assert.deepEqual(citations, [], citations.join("\n"));
  });
});

describe("the scanners flag what they exist to flag", () => {
  test("a re-added script is flagged and the manifest alone passes", () => {
    const files = [HOOKS_MANIFEST, `${HOOKS_DIRECTORY}lib.sh`];
    assert.deepEqual(strayHooksDirectoryFiles(files), [`${HOOKS_DIRECTORY}lib.sh`]);
    assert.deepEqual(strayHooksDirectoryFiles([HOOKS_MANIFEST]), []);
  });

  test("a planted citation is flagged and text without one passes", () => {
    const cites = { file: "synthetic.ts", text: `spawnSync("bash", ["${HOOKS_DIRECTORY}block-prod-deploy.sh"]);` };
    const clean = { file: "synthetic.ts", text: `read ${HOOKS_MANIFEST} and label the gate "block-prod-deploy.sh"` };
    assert.deepEqual(retiredScriptCitations(cites), ["synthetic.ts:1"]);
    assert.deepEqual(retiredScriptCitations(clean), []);
  });
});
