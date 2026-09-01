import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import {
  buildCapabilityInventory,
  extractHeadings,
  extractInvocations,
  extractStateSpellings,
  extractVerdictTokens,
  isProseSourceFile,
  PROSE_ANCHOR_COMMIT,
  readStateCliVerbs,
  type CapabilityInventory,
} from "../support/prose-inventory.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

type Home = Readonly<{ kind: "gate" | "test" | "prose"; ref: string }>;

type DeclaredDropRow = Readonly<{ axis: "A" | "B" | "C"; item: string; sourceFile: string; reason: string; home: Home }>;

type SectionMapRow =
  | Readonly<{ sourceFile: string; heading: string; disposition: "merged"; destinationFile: string; destinationHeading: string }>
  | Readonly<{ sourceFile: string; heading: string; disposition: "dropped"; reason: string; home: Home }>;

type IndependentCount = Readonly<{ count: number; command: string }>;

type CapabilityInventoryFixture = CapabilityInventory &
  Readonly<{
    independentCounts: Readonly<{
      files: IndependentCount;
      axisA: IndependentCount;
      axisB: IndependentCount;
      axisC: IndependentCount;
      axisD: IndependentCount;
    }>;
  }>;

const FIXTURE_DIRECTORY = "core/test/fixtures/prose";
const FIXTURE_FILE = `${FIXTURE_DIRECTORY}/capability-inventory.json`;
const DECLARED_DROPS_FILE = `${FIXTURE_DIRECTORY}/declared-drops.json`;
const SECTION_MAP_FILE = `${FIXTURE_DIRECTORY}/section-map.json`;
const GATE_DIRECTORY = "core/src/gates/";

function readJson<T>(file: string): T {
  return JSON.parse(readTrackedText(file).text) as T;
}

const fixture = readJson<CapabilityInventoryFixture>(FIXTURE_FILE);
const declaredDrops = readJson<DeclaredDropRow[]>(DECLARED_DROPS_FILE);
const sectionMap = readJson<SectionMapRow[]>(SECTION_MAP_FILE);

const currentTrackedFiles = trackedRepositoryFiles();
const currentTrackedFileSet = new Set(currentTrackedFiles);
const currentProseFiles = currentTrackedFiles.filter(isProseSourceFile);
const currentProseTexts = currentProseFiles.map(readTrackedText);

const liveCliVerbs = readStateCliVerbs(readTrackedText("core/src/state/cli.ts").text);
const liveVerbSet = new Set(liveCliVerbs.verbs);
const liveHandoffSubverbSet = new Set(liveCliVerbs.handoffSubverbs);

const currentStateSpellings = currentProseTexts.flatMap(({ file, text }) => extractStateSpellings(file, text, liveHandoffSubverbSet));
const currentInvocations = currentProseTexts.flatMap(({ file, text }) =>
  extractInvocations(file, text, fixture.extractionRules.axisBRoleNames),
);
const currentVerdictTokens = currentProseTexts.flatMap(({ file, text }) => extractVerdictTokens(file, text));
const currentHeadings = currentProseTexts.flatMap(({ file, text }) => extractHeadings(file, text));

const currentStateKeys = new Set(currentStateSpellings.map((item) => item.key));
const currentInvocationKeys = new Set(currentInvocations.map((item) => item.key));
const currentVerdictKeys = new Set(currentVerdictTokens.map((item) => item.key));

function gateIdExists(id: string): boolean {
  return currentTrackedFileSet.has(`${GATE_DIRECTORY}${id}.ts`);
}

function homeResolves(home: Home, itemText: string): boolean {
  if (home.kind === "gate") return gateIdExists(home.ref);
  if (home.kind === "test") return currentTrackedFileSet.has(home.ref);
  return currentTrackedFileSet.has(home.ref) && readTrackedText(home.ref).text.includes(itemText);
}

function declaredDropFor(axis: DeclaredDropRow["axis"], item: string): DeclaredDropRow | undefined {
  return declaredDrops.find((row) => row.axis === axis && row.item === item);
}

function floorFor(axis: DeclaredDropRow["axis"], fixtureCount: number): number {
  return fixtureCount - declaredDrops.filter((row) => row.axis === axis).length;
}

describe("the committed capability-inventory fixture is exactly what its own extraction rules regenerate from the anchor commit", () => {
  test(`the fixture's recorded anchor is ${PROSE_ANCHOR_COMMIT}`, () => {
    assert.equal(fixture.anchorCommit, PROSE_ANCHOR_COMMIT);
  });

  test("rebuilding the inventory from the anchor commit with the committed extraction rules reproduces the committed fixture", () => {
    const { anchorCommit, extractionRules, files, axisA, axisB, axisC, axisD } = fixture;
    assert.deepEqual(buildCapabilityInventory(PROSE_ANCHOR_COMMIT), { anchorCommit, extractionRules, files, axisA, axisB, axisC, axisD });
  });

  test("the anchor commit carries exactly 54/3/9/7/9/7 file(s) across the six source globs, 89 total", () => {
    assert.equal(fixture.files.pluginSkills, 54);
    assert.equal(fixture.files.pluginAgents, 3);
    assert.equal(fixture.files.codexSkills, 9);
    assert.equal(fixture.files.codexAgents, 7);
    assert.equal(fixture.files.opencodeSkills, 9);
    assert.equal(fixture.files.opencodeAgents, 7);
    assert.equal(fixture.files.total, 89);
  });
});

describe("every extractor count is confirmed by a witness derived through a pipeline that never calls buildCapabilityInventory", () => {
  const witnesses: ReadonlyArray<readonly [string, number, IndependentCount]> = [
    ["the source file total", fixture.files.total, fixture.independentCounts.files],
    ["axis A", fixture.axisA.length, fixture.independentCounts.axisA],
    ["axis B", fixture.axisB.length, fixture.independentCounts.axisB],
    ["axis C", fixture.axisC.length, fixture.independentCounts.axisC],
    ["axis D", fixture.axisD.length, fixture.independentCounts.axisD],
  ];
  for (const [label, extracted, witness] of witnesses) {
    test(`${label}'s extracted count (${extracted}) equals its independent witness (${witness.count})`, () => {
      assert.equal(extracted, witness.count, witness.command);
    });
  }
});

provedSomething(
  "the current tree carries at least one tracked source file across the six source globs",
  currentProseFiles.length > 0,
  "zero tracked source files were found across the six source globs in the current tree — every axis below would compare against nothing",
);

provedSomething(
  "core/src/state/cli.ts's own switch carries at least one verb, read at run time rather than from a copy",
  liveVerbSet.size > 0,
  "core/src/state/cli.ts's switch yielded zero verbs, so axis A would resolve every surviving spelling against nothing",
);

describe("axis A — every anchor `oso-state` spelling survives the current tree or is declared dropped, and every surviving spelling resolves to a live CLI verb", () => {
  const floor = floorFor("A", fixture.axisA.length);

  test(`the current tree carries at least ${floor} oso-state spelling(s), axis A's floor`, () => {
    assert.ok(
      currentStateSpellings.length >= floor,
      `the current tree carries ${currentStateSpellings.length} oso-state spelling(s), under axis A's ${floor}-item floor`,
    );
  });

  for (const item of fixture.axisA) {
    const spelling = `oso-state ${item.verb}${item.subverb !== null ? ` ${item.subverb}` : ""}`;
    test(`\`${spelling}\` from ${item.file}:${item.line} survives or is declared dropped`, () => {
      if (currentStateKeys.has(item.key)) {
        assert.ok(liveVerbSet.has(item.verb), `${item.verb} no longer exists in core/src/state/cli.ts's switch`);
        if (item.subverb !== null) {
          assert.ok(
            liveHandoffSubverbSet.has(item.subverb),
            `${item.subverb} no longer exists among core/src/state/cli.ts's handoff subactions`,
          );
        }
        return;
      }
      const drop = declaredDropFor("A", item.key);
      assert.ok(drop !== undefined, `${spelling} is absent from the current tree and carries no declared-drop row`);
      assert.ok(homeResolves(drop.home, item.key), `${spelling}'s declared-drop home ${drop.home.kind}:${drop.home.ref} does not resolve`);
    });
  }
});

describe("axis B — every anchor role-name or `oso-code:<skill>` invocation survives the current tree or is declared dropped", () => {
  const floor = floorFor("B", fixture.axisB.length);

  test(`the current tree carries at least ${floor} invocation(s), axis B's floor`, () => {
    assert.ok(
      currentInvocations.length >= floor,
      `the current tree carries ${currentInvocations.length} invocation(s), under axis B's ${floor}-item floor`,
    );
  });

  for (const item of fixture.axisB) {
    test(`${item.kind === "role" ? item.item : `oso-code:${item.item}`} from ${item.file}:${item.line} survives or is declared dropped`, () => {
      if (currentInvocationKeys.has(item.key)) return;
      const drop = declaredDropFor("B", item.key);
      assert.ok(drop !== undefined, `${item.item} is absent from the current tree and carries no declared-drop row`);
      assert.ok(homeResolves(drop.home, item.item), `${item.item}'s declared-drop home ${drop.home.kind}:${drop.home.ref} does not resolve`);
    });
  }
});

describe("axis C — every anchor backticked verdict token survives the current tree VERBATIM or is declared dropped", () => {
  const floor = floorFor("C", fixture.axisC.length);

  test(`the current tree carries at least ${floor} verdict token(s), axis C's floor`, () => {
    assert.ok(
      currentVerdictTokens.length >= floor,
      `the current tree carries ${currentVerdictTokens.length} verdict token(s), under axis C's ${floor}-item floor`,
    );
  });

  for (const item of fixture.axisC) {
    test(`\`${item.token}\` from ${item.file}:${item.line} survives verbatim or is declared dropped`, () => {
      if (currentVerdictKeys.has(item.key)) return;
      const drop = declaredDropFor("C", item.key);
      assert.ok(drop !== undefined, `\`${item.token}\` is absent from the current tree and carries no declared-drop row`);
      assert.ok(homeResolves(drop.home, item.token), `${item.token}'s declared-drop home ${drop.home.kind}:${drop.home.ref} does not resolve`);
    });
  }
});

const anchorHeadingCounts = new Map<string, number>();
const anchorOriginsByHeading = new Map<string, string[]>();
for (const item of fixture.axisD) {
  anchorHeadingCounts.set(item.heading, (anchorHeadingCounts.get(item.heading) ?? 0) + 1);
  const origins = anchorOriginsByHeading.get(item.heading) ?? [];
  if (!origins.includes(item.file)) origins.push(item.file);
  anchorOriginsByHeading.set(item.heading, origins);
}
const currentHeadingCounts = new Map<string, number>();
for (const item of currentHeadings) currentHeadingCounts.set(item.heading, (currentHeadingCounts.get(item.heading) ?? 0) + 1);

describe("axis D — KEPT absorbs min(anchor, current) occurrences of each heading text; a shortfall needs that many section-map rows, each naming one of that heading's own anchor origin files", () => {
  provedSomething(
    "the current tree carries at least one `#{2,4} ` heading line across the six source globs",
    currentHeadings.length > 0,
    "zero headings were found in the current tree, so every anchor heading below would need a row even though nothing actually moved",
  );

  for (const heading of [...anchorHeadingCounts.keys()].sort()) {
    const anchorCount = anchorHeadingCounts.get(heading) as number;
    const currentCount = currentHeadingCounts.get(heading) ?? 0;
    const required = Math.max(0, anchorCount - currentCount);
    const rows = sectionMap.filter((row) => row.heading === heading);
    const origins = anchorOriginsByHeading.get(heading) as string[];

    test(`"${heading}" occurred ${anchorCount} time(s) at the anchor and ${currentCount} time(s) now; ${required} need section-map row(s)`, () => {
      assert.ok(
        rows.length >= required,
        `"${heading}" occurred ${anchorCount} times at the anchor and ${currentCount} times now; ${required} need section-map rows, ${rows.length} present`,
      );
    });

    const namedOrigins = new Set<string>();
    for (const row of rows) {
      test(`"${heading}"'s section-map row for ${row.sourceFile} names one of its own anchor origins, at most once`, () => {
        assert.ok(origins.includes(row.sourceFile), `"${heading}" never appeared in ${row.sourceFile} at the anchor — phantom row`);
        assert.ok(!namedOrigins.has(row.sourceFile), `${row.sourceFile} names "${heading}" more than once in the section-map`);
        namedOrigins.add(row.sourceFile);
      });
      if (row.disposition === "dropped") {
        test(`"${heading}" from ${row.sourceFile} carries a declared home that resolves`, () => {
          assert.ok(homeResolves(row.home, heading), `"${heading}"'s declared home ${row.home.kind}:${row.home.ref} does not resolve`);
        });
        continue;
      }
      test(`"${heading}" from ${row.sourceFile} merges into a heading that exists in ${row.destinationFile}`, () => {
        assert.ok(currentTrackedFileSet.has(row.destinationFile), `${row.destinationFile} does not exist`);
        const destinationHeadings = extractHeadings(row.destinationFile, readTrackedText(row.destinationFile).text);
        assert.ok(
          destinationHeadings.some((candidate) => candidate.heading === row.destinationHeading),
          `"${row.destinationHeading}" is not a heading line in ${row.destinationFile}`,
        );
      });
    }
  }
});

describe("every declared-drop row carries the axis/item/sourceFile/reason/home schema", () => {
  declaredDrops.forEach((row, index) => {
    test(`declared-drops.json[${index}] carries a well-formed row`, () => {
      assert.ok(row.axis === "A" || row.axis === "B" || row.axis === "C", `row ${index}: axis "${String(row.axis)}" is not A, B, or C`);
      assert.ok(typeof row.item === "string" && row.item !== "", `row ${index}: item is not a non-empty string`);
      assert.ok(typeof row.sourceFile === "string" && row.sourceFile !== "", `row ${index}: sourceFile is not a non-empty string`);
      assert.ok(typeof row.reason === "string" && row.reason !== "", `row ${index}: reason is not a non-empty string`);
      assertHomeShape(row.home, `declared-drops.json[${index}]`);
    });
  });
});

describe("every section-map row carries the sourceFile/heading/disposition schema its disposition requires", () => {
  sectionMap.forEach((row, index) => {
    test(`section-map.json[${index}] carries a well-formed row`, () => {
      assert.ok(typeof row.sourceFile === "string" && row.sourceFile !== "", `row ${index}: sourceFile is not a non-empty string`);
      assert.ok(typeof row.heading === "string" && row.heading !== "", `row ${index}: heading is not a non-empty string`);
      if (row.disposition === "merged") {
        assert.ok(typeof row.destinationFile === "string" && row.destinationFile !== "", `row ${index}: destinationFile is missing`);
        assert.ok(typeof row.destinationHeading === "string" && row.destinationHeading !== "", `row ${index}: destinationHeading is missing`);
        return;
      }
      assert.ok(row.disposition === "dropped", `row ${index}: disposition "${String(row.disposition)}" is not merged or dropped`);
      assert.ok(typeof row.reason === "string" && row.reason !== "", `row ${index}: reason is missing`);
      assertHomeShape(row.home, `section-map.json[${index}]`);
    });
  });
});

function assertHomeShape(home: unknown, context: string): asserts home is Home {
  assert.ok(typeof home === "object" && home !== null, `${context}: home is not an object`);
  const kind = (home as { kind?: unknown }).kind;
  const ref = (home as { ref?: unknown }).ref;
  assert.ok(kind === "gate" || kind === "test" || kind === "prose", `${context}: home.kind "${String(kind)}" is not gate, test, or prose`);
  assert.ok(typeof ref === "string" && ref !== "", `${context}: home.ref is not a non-empty string`);
}

describe("homeResolves", () => {
  const [aGateId] = currentTrackedFiles
    .filter((file) => file.startsWith(GATE_DIRECTORY) && file.endsWith(".ts"))
    .map((file) => file.slice(GATE_DIRECTORY.length, -".ts".length));

  test("resolves a gate home whose id exists under core/src/gates/", () => {
    assert.ok(aGateId !== undefined, "no gate file exists under core/src/gates/ to test against");
    assert.equal(homeResolves({ kind: "gate", ref: aGateId as string }, ""), true);
  });

  test("fails a gate home whose id does not exist under core/src/gates/", () => {
    assert.equal(homeResolves({ kind: "gate", ref: "no-such-gate-id" }, ""), false);
  });

  test("resolves a test home naming a test file that exists", () => {
    assert.equal(homeResolves({ kind: "test", ref: "core/test/structure/line-budget.test.ts" }, ""), true);
  });

  test("fails a test home naming a test file that does not exist", () => {
    assert.equal(homeResolves({ kind: "test", ref: "core/test/structure/does-not-exist.test.ts" }, ""), false);
  });

  test("resolves a prose home naming a file that carries the item verbatim", () => {
    assert.equal(homeResolves({ kind: "prose", ref: "plugin/skills/_shared/rubric.md" }, "Judgment contract"), true);
  });

  test("fails a prose home naming a file that does not carry the item", () => {
    assert.equal(homeResolves({ kind: "prose", ref: "plugin/skills/_shared/rubric.md" }, "no such phrase anywhere in this file"), false);
  });
});
