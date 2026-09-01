import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const TEST_TREE_PREFIX = "core/test/";
const SUPPORT_TREE_PREFIX = "core/test/support/";
const RAW_POINTER_PATTERN = /= "\$\{path\./;

type RawPointerSite = Readonly<{ file: string; line: number; text: string }>;

function rawPointerSitesIn({ file, text }: TrackedFileText): RawPointerSite[] {
  return text
    .split("\n")
    .map((lineText, index) => ({ file, line: index + 1, text: lineText.trim() }))
    .filter((site) => RAW_POINTER_PATTERN.test(site.text));
}

const scanned = trackedRepositoryFiles()
  .filter((file) => file.startsWith(TEST_TREE_PREFIX) && file.endsWith(".ts") && !file.startsWith(SUPPORT_TREE_PREFIX))
  .map(readTrackedText);
const sites = scanned.flatMap(rawPointerSitesIn);

provedSomething(
  `${scanned.length} tracked *.ts file(s) under ${TEST_TREE_PREFIX} outside ${SUPPORT_TREE_PREFIX} were scanned for a native path interpolated raw into a quoted TOML value`,
  scanned.length > 0,
  `only ${scanned.length} file(s) were scanned, so a walk that found nothing would report the same empty result as a clean tree`,
);

describe(
  "a TOML pointer value built from a native path is written through tomlQuote, never interpolated raw between quotes — " +
    "the emitter defect this round fixed; this gate reaches only the `= \"${path.` shape and no further",
  () => {
    test(`no tracked *.ts file under ${TEST_TREE_PREFIX} outside ${SUPPORT_TREE_PREFIX} interpolates a native path raw into a quoted TOML value`, () => {
      assert.deepEqual(sites, [], sites.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });
  },
);
