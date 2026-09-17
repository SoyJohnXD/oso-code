import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  BUNDLE_DIRECTORY,
  GATE_BUNDLE,
  OPENCODE_PLUGIN_BUNDLE,
  PRECOMMIT_BUNDLE,
} from "../../src/routes/routes.ts";
import { sha256Hex } from "../../src/state/store.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const HASH_FILE = "bootstrap/hook-hashes.txt";
const DIGEST_LENGTH = 64;
const SEPARATOR = "  ";

type PublishedRow = Readonly<{ digest: string; file: string }>;

const publishedRows = readPublishedRows();

provedSomething(
  `${HASH_FILE} parses into rows this check can compare`,
  publishedRows.length > 0,
  `${HASH_FILE} parsed into ${publishedRows.length} row(s), so this check compared nothing`,
);

describe(`${HASH_FILE} publishes exactly the artifacts core/src/routes/routes.ts wires, in that order`, () => {
  test("every row is a 64-hex digest, two spaces and a repo-relative path", () => {
    for (const line of significantLines()) {
      const digest = line.slice(0, DIGEST_LENGTH);
      assert.match(digest, /^[0-9a-f]{64}$/, `malformed digest in row: ${line}`);
      assert.equal(line.slice(DIGEST_LENGTH, DIGEST_LENGTH + SEPARATOR.length), SEPARATOR, `bad separator: ${line}`);
      const file = line.slice(DIGEST_LENGTH + SEPARATOR.length);
      assert.ok(file !== "" && !file.startsWith("/") && !file.split("/").includes(".."), `unsafe path: ${file}`);
    }
  });

  test("no path is published twice", () => {
    const files = publishedRows.map((row) => row.file);
    assert.deepEqual(files, [...new Set(files)]);
  });

  test("the published coverage and its order equal the artifacts the hosts install", () => {
    assert.deepEqual(
      publishedRows.map((row) => row.file),
      requiredPaths(),
    );
  });

  test("every published digest is the digest of the file it names", () => {
    for (const { digest, file } of publishedRows) {
      assert.equal(sha256Hex(readFileSync(path.join(repositoryRoot, file), "utf8")), digest, `stale digest: ${file}`);
    }
  });
});

function requiredPaths(): string[] {
  return [
    `plugin/${BUNDLE_DIRECTORY}/${GATE_BUNDLE}`,
    `plugin/${BUNDLE_DIRECTORY}/${PRECOMMIT_BUNDLE}`,
    `plugin/${BUNDLE_DIRECTORY}/package.json`,
    "plugin/git-hooks/pre-commit",
    "plugin/hooks/block-commit-until-green.sh",
    "plugin/hooks/block-edits-without-slice.sh",
    "plugin/hooks/warn-stale-state.sh",
    "plugin/hooks/cleanup-state.sh",
    "plugin/hooks/block-prod-deploy.sh",
    "plugin/bin/oso-state",
    "plugin/bin/package.json",
    "plugin/hooks/lib.sh",
    "plugin/hooks/lexer.sh",
    "plugin/hooks/reanchor-after-compact.sh",
    OPENCODE_PLUGIN_BUNDLE,
  ];
}

function significantLines(): string[] {
  return readFileSync(path.join(repositoryRoot, HASH_FILE), "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function readPublishedRows(): PublishedRow[] {
  return significantLines().map((line) => ({
    digest: line.slice(0, DIGEST_LENGTH),
    file: line.slice(DIGEST_LENGTH + SEPARATOR.length),
  }));
}
