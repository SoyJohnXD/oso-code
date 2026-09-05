import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COMMENT_SCAN_LANGUAGES, REFERENCE_COUNT_LANGUAGES } from "../../src/scan/languages.ts";
import { provedSomething } from "../support/proved.ts";
import { loadScanFixtures, type ScanVerb } from "../support/scan-fixture.ts";

const fixtures = loadScanFixtures();

function languagesShownToProduceAHit(verb: ScanVerb): Set<string> {
  return new Set(
    fixtures.filter((fixture) => fixture.verb === verb && fixture.expect.hits.length > 0).map((fixture) => fixture.language),
  );
}

const CLAIMS: ReadonlyArray<readonly [ScanVerb, readonly string[]]> = [
  ["comments", COMMENT_SCAN_LANGUAGES],
  ["abstractions", REFERENCE_COUNT_LANGUAGES],
];

provedSomething(
  "both scans claim at least one language each, read from the source rather than from a copy",
  CLAIMS.every(([, languages]) => languages.length > 0),
  `the source claims ${COMMENT_SCAN_LANGUAGES.length} comment language(s) and ${REFERENCE_COUNT_LANGUAGES.length} ` +
    "reference-count language(s), so an empty claim would pass every case below having demonstrated nothing",
);

describe("a language a scan claims is a language a fixture makes it produce a hit in", () => {
  for (const [verb, languages] of CLAIMS) {
    const demonstrated = languagesShownToProduceAHit(verb);
    for (const language of languages) {
      test(`scan ${verb} claims ${language} and a fixture expects a ${language} hit`, () => {
        assert.ok(
          demonstrated.has(language),
          `scan ${verb} claims ${language}, but no fixture under core/test/fixtures/scan expects a hit in it — ` +
            `the claim rests on a zero nobody produced. Demonstrated: ${[...demonstrated].join(", ") || "none"}`,
        );
      });
    }
  }
});
