import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const SCANNED_PREFIXES = ["plugin/", "codex/", "opencode/", "core/src/prose/"];
const SCANNED_EXTENSIONS = new Set([".md", ".toml"]);
const BANNED_SPELLINGS = ["platform file"];

const FILES_SCANNED_FLOOR = 147;
const FILES_SCANNED_FLOOR_DERIVATION =
  "git ls-files under plugin/, codex/, opencode/, core/src/prose/ filtered to *.md/*.toml at C5-S3: 37 + 24 + 28 + 58 = 147";

const scannedFiles = trackedRepositoryFiles().filter(
  (file) => SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)) && SCANNED_EXTENSIONS.has(path.extname(file)),
);

provedSomething(
  `${scannedFiles.length} tracked *.md/*.toml file(s) were scanned for a banned runtime-prose spelling`,
  scannedFiles.length >= FILES_SCANNED_FLOOR,
  `only ${scannedFiles.length} file(s) were found, under the ${FILES_SCANNED_FLOOR}-file floor (${FILES_SCANNED_FLOOR_DERIVATION})`,
);

const hits = scannedFiles.map(readTrackedText).flatMap(({ file, text }) =>
  text
    .split("\n")
    .flatMap((line, index) => BANNED_SPELLINGS.filter((pattern) => line.includes(pattern)).map((pattern) => `${file}:${index + 1}: "${pattern}"`)),
);

describe("runtime prose carries no banned spelling — a dead term left behind reads as live", () => {
  test("no scanned file carries a banned spelling", () => {
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});
