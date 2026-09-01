import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { runTomlRegion, TOML_REGION_ACTIONS } from "../../src/install/toml-regions.ts";
import { corpusDocuments, corpusRequests, SHAPES_EXCLUDED_BY_CONSTRUCTION } from "../support/toml-region-corpus.ts";
import {
  THE_ORACLE,
  TOML_REGION_DIFFERENTIAL_FIXTURE,
  type ObservedCase,
  type TomlRegionDifferential,
} from "../support/toml-region-differential.ts";
import { provedSomething } from "../support/proved.ts";

const MINIMUM_DOCUMENTS = 40;
const MINIMUM_CASES = 400;

const differential = JSON.parse(readFileSync(TOML_REGION_DIFFERENTIAL_FIXTURE, "utf8")) as TomlRegionDifferential;
const documents = corpusDocuments();
const textOfShape = new Map(documents.map((entry) => [entry.shape, entry.text]));

provedSomething(
  `${documents.length} config.toml shape(s) driven through ${corpusRequests().length} action invocation(s) recorded ` +
    `${differential.cases.length} case(s) from ${THE_ORACLE}`,
  documents.length >= MINIMUM_DOCUMENTS && differential.cases.length >= MINIMUM_CASES && differential.oracle === THE_ORACLE,
  `the committed corpus holds ${documents.length} shape(s) and ${differential.cases.length} case(s) against a floor of ` +
    `${MINIMUM_DOCUMENTS} and ${MINIMUM_CASES}, so a clean result would prove little`,
);

describe(`core/src/install/toml-regions.ts against ${THE_ORACLE}, replayed from the committed corpus`, () => {
  for (const { named } of corpusRequests()) {
    const cases = differential.cases.filter((entry) => entry.requestName === named);
    test(`${cases.length} shape(s) under ${named} split byte for byte the way the awk splits them`, () => {
      assert.deepEqual(cases.filter(readsDifferentlyFromTheAwk).map(mismatchOf), []);
    });
  }
});

describe("the corpus states what it covers and what it leaves out, and holds itself to both", () => {
  test(`every one of the ${TOML_REGION_ACTIONS.length} actions the awk carries is driven by at least one recorded case`, () => {
    const driven = new Set(differential.cases.map((entry) => entry.request.action));
    assert.deepEqual(TOML_REGION_ACTIONS.filter((action) => !driven.has(action)), []);
  });

  test(`all ${SHAPES_EXCLUDED_BY_CONSTRUCTION.length} excluded shapes are recorded beside the corpus`, () => {
    assert.deepEqual(differential.excluded, SHAPES_EXCLUDED_BY_CONSTRUCTION.map((shape) => shape.named));
  });

  test("every recorded case names a shape the corpus still carries, so a renamed shape cannot go unmeasured", () => {
    const orphaned = [...new Set(differential.cases.map((entry) => entry.shape))].filter((shape) => !textOfShape.has(shape));
    assert.deepEqual(orphaned, []);
  });

  test("the corpus reaches every exit code the awk can answer with, so no refusal path is recorded only as a zero", () => {
    const answered = new Set(differential.cases.map((entry) => entry.observed.exitCode));
    assert.deepEqual([5, 6, 10, 11, 12].filter((code) => !answered.has(code)), []);
  });

  test("at least one shape carries a marker line inside a multiline string, an array and an inline table each", () => {
    const covered = ["multiline basic string", "multiline literal string", "multi-line array", "multi-line inline table"];
    assert.deepEqual(covered.filter((named) => !documents.some((entry) => entry.shape.includes(named))), []);
  });

  test("at least one shape is CRLF, and the awk answers it differently from its LF twin", () => {
    const crlf = differential.cases.filter((entry) => entry.shape.startsWith("a CRLF file carrying one managed region"));
    const lf = differential.cases.filter((entry) => entry.shape === "one managed region between operator text on both sides");
    assert.ok(crlf.length > 0 && lf.length > 0);
    assert.notDeepEqual(crlf.map((entry) => entry.observed.exitCode), lf.map((entry) => entry.observed.exitCode));
  });
});

function readsDifferentlyFromTheAwk(entry: ObservedCase): boolean {
  return JSON.stringify(portOutputOf(entry)) !== JSON.stringify(entry.observed);
}

function mismatchOf(entry: ObservedCase): string {
  return (
    `${entry.requestName} over ${entry.shape}: the port answers ${JSON.stringify(portOutputOf(entry))}, ` +
    `the awk answers ${JSON.stringify(entry.observed)}`
  );
}

function portOutputOf(entry: ObservedCase): unknown {
  const text = textOfShape.get(entry.shape);
  if (text === undefined) return { missingShape: entry.shape };
  return runTomlRegion(text, entry.request);
}
