import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const TEST_TREE_PREFIX = "core/test/";
const SUPPORT_TREE_PREFIX = "core/test/support/";
const SPELLING_MODULE = "core/test/support/repository-paths.ts";
const NATIVE_SEPARATOR_PATTERN = /(path\.relative\s*\()|(path\.sep\b)/;

type NativeSpellingSite = Readonly<{ file: string; line: number; text: string }>;

function nativeSpellingSitesIn({ file, text }: TrackedFileText): NativeSpellingSite[] {
  return text
    .split("\n")
    .map((lineText, index) => ({ file, line: index + 1, text: lineText.trim() }))
    .filter((site) => NATIVE_SEPARATOR_PATTERN.test(site.text));
}

const scanned = trackedRepositoryFiles()
  .filter((file) => file.startsWith(TEST_TREE_PREFIX) && file.endsWith(".ts") && !file.startsWith(SUPPORT_TREE_PREFIX))
  .map(readTrackedText);
const sites = scanned.flatMap(nativeSpellingSitesIn);

provedSomething(
  `${scanned.length} tracked *.ts file(s) under ${TEST_TREE_PREFIX} outside ${SUPPORT_TREE_PREFIX} were scanned for a path composed from the native separator`,
  scanned.length > 0,
  `only ${scanned.length} file(s) were scanned, so a walk that found nothing would report the same empty result as a clean tree`,
);

describe(
  `a repo-relative path a case compares against a slash-spelled literal is spelled once by ${SPELLING_MODULE}, never by a ` +
    "native-separator primitive called where the comparison is written — win32 spells one side in backslashes there and " +
    "linux hides it, because on linux the two spellings agree; this gate reaches those primitives by name and no further, " +
    "so a native separator arriving inside a directory entry or an already-joined value is a hand sweep it cannot see",
  () => {
    test(`only ${SUPPORT_TREE_PREFIX} composes a path from the native separator`, () => {
      assert.deepEqual(sites, [], sites.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });

    test(`${SPELLING_MODULE} still composes that spelling, so the allowance above cannot outlive its reason`, () => {
      assert.ok(
        nativeSpellingSitesIn(readTrackedText(SPELLING_MODULE)).length > 0,
        `${SPELLING_MODULE} no longer composes a posix spelling from the native separator, so this gate bans a form nothing provides`,
      );
    });
  },
);
