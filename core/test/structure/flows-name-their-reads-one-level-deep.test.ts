import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILLS_DIRECTORY, hostFileOf, markedAlwaysIn, namedPaths, wrapperOf } from "../support/flow-reads.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;

const FLOWS = ["quick", "debug", "roadmap"] as const;
const SECTION_HEADING = "## Files this flow reads";
const ALWAYS_MARKER = /read ALWAYS|\bREAD\b.*\bNOW\b/;
const CONDITIONAL_MARKER = /trigger fires/;

const SHARED_READS = [`${SKILLS_DIRECTORY}/_shared/references/claude.md`, `${SKILLS_DIRECTORY}/_shared/reporting.md`];
const EXTRA_READS: Readonly<Record<string, readonly string[]>> = {
  quick: [],
  debug: [],
  roadmap: [`${SKILLS_DIRECTORY}/_shared/unattended.md`, `${SKILLS_DIRECTORY}/plan/references/claude.md`],
};

const markedAlways = (flow: string, text: string) =>
  markedAlwaysIn(flow, text, (line) => ALWAYS_MARKER.test(line) && !CONDITIONAL_MARKER.test(line));

function readsSection(text: string): string {
  const start = text.indexOf(SECTION_HEADING);
  if (start < 0) return "";
  const rest = text.slice(start + SECTION_HEADING.length);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

function requiredReads(flow: string, read: ReadFile): string[] {
  const marked = [...markedAlways(flow, read(wrapperOf(flow))), ...markedAlways(flow, read(hostFileOf(flow)))];
  return [...new Set([hostFileOf(flow), ...SHARED_READS, ...(EXTRA_READS[flow] ?? []), ...marked])]
    .filter((file) => file !== wrapperOf(flow))
    .sort();
}

function filesTheWrapperNeverNames(flow: string, read: ReadFile): string[] {
  const named = new Set(namedPaths(flow, readsSection(read(wrapperOf(flow)))));
  return requiredReads(flow, read).filter((file) => !named.has(file));
}

const readFromTree: ReadFile = (file) => readTrackedText(file).text;

const measured = FLOWS.map((flow) => [flow, requiredReads(flow, readFromTree)] as const);

provedSomething(
  "every flow's required reads hold its host file, the shared host file and the reporting contract",
  measured.every(([, files]) => files.length >= SHARED_READS.length + 1),
  `measured only: ${measured.map(([flow, files]) => `${flow}=${files.length}`).join(", ")}`,
);

describe("quick, debug and roadmap name every file they always read directly from their SKILL.md, one level deep", () => {
  for (const flow of FLOWS) {
    test(`${flow} names each always-read file in its "Files this flow reads" section`, () => {
      assert.deepEqual(filesTheWrapperNeverNames(flow, readFromTree), []);
    });
  }
});

const DIDACTIC_FILE = `${SKILLS_DIRECTORY}/_shared/didactic.md`;
const INVOKER_LINE = /invoke it\s+—\s+(.*?),\s+at\b/;

function didacticInvokers(read: ReadFile): string[] {
  const line = read(DIDACTIC_FILE).split("\n").find((candidate) => candidate.includes("invoke it")) ?? "";
  const list = line.match(INVOKER_LINE)?.[1] ?? "";
  return [...list.matchAll(/\b[A-Z]{3,}\b/g)].map(([name]) => (name ?? "").toLowerCase());
}

const didacticEntryOf = (flow: string, read: ReadFile) =>
  readsSection(read(wrapperOf(flow)))
    .split("\n")
    .find((line) => line.includes("`_shared/didactic.md`"));

const didacticCondition = (entry: string) => entry.replace(/^.*?`_shared\/didactic\.md`\s*—\s*/, "");

const didacticFlows = didacticInvokers(readFromTree);

provedSomething(
  "the didactic register names its invokers",
  didacticFlows.length >= 2,
  `measured only: ${didacticFlows.join(", ")}`,
);

describe("every flow that can answer at didactic depth declares the didactic register among its reads", () => {
  for (const flow of didacticFlows) {
    test(`${flow} names _shared/didactic.md in its "Files this flow reads" section`, () => {
      assert.ok(didacticEntryOf(flow, readFromTree), `${flow} never names _shared/didactic.md`);
    });
  }

  test("every such entry states one and the same condition", () => {
    const conditions = didacticFlows.map((flow) => didacticCondition(didacticEntryOf(flow, readFromTree) ?? ""));
    assert.deepEqual([...new Set(conditions)].length, 1, conditions.join(" | "));
  });

  test("a flow whose entry is dropped is reported", () => {
    const mutated: ReadFile = (file) =>
      file === wrapperOf("quick") ? readFromTree(file).replaceAll("`_shared/didactic.md`", "the didactic register") : readFromTree(file);
    assert.equal(didacticEntryOf("quick", mutated), undefined);
  });
});

describe("the checker reports a planted regression", () => {
  test("a wrapper that stops naming the reporting contract is reported", () => {
    const mutated: ReadFile = (file) =>
      file === wrapperOf("quick") ? readFromTree(file).replaceAll("`_shared/reporting.md`", "the reporting contract") : readFromTree(file);
    assert.ok(filesTheWrapperNeverNames("quick", mutated).includes(`${SKILLS_DIRECTORY}/_shared/reporting.md`));
  });

  test("a wrapper without a reads section names nothing", () => {
    const mutated: ReadFile = (file) =>
      file === wrapperOf("debug") ? readFromTree(file).replaceAll(SECTION_HEADING, "## Elsewhere") : readFromTree(file);
    assert.deepEqual(filesTheWrapperNeverNames("debug", mutated), requiredReads("debug", mutated));
  });

  test("a file the host file alone marks read always is reported", () => {
    const planted = `${SKILLS_DIRECTORY}/_shared/planted.md`;
    const mutated: ReadFile = (file) =>
      file === hostFileOf("roadmap") ? `${readFromTree(file)}\nREAD \`_shared/planted.md\` NOW.\n` : readFromTree(file);
    assert.ok(filesTheWrapperNeverNames("roadmap", mutated).includes(planted));
  });
});
