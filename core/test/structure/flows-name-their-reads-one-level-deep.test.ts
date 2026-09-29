import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

type ReadFile = (file: string) => string;

const SKILLS_DIRECTORY = "plugin/skills";
const FLOWS = ["quick", "debug", "roadmap"] as const;
const SECTION_HEADING = "## Files this flow reads";
const ALWAYS_MARKER = /read ALWAYS|\bREAD\b.*\bNOW\b/;
const CONDITIONAL_MARKER = /trigger fires/;
const BACKTICKED_MARKDOWN_PATH = /`([^`]*\/[^`]*\.md)`/g;

const SHARED_READS = [`${SKILLS_DIRECTORY}/_shared/references/claude.md`, `${SKILLS_DIRECTORY}/_shared/reporting.md`];
const EXTRA_READS: Readonly<Record<string, readonly string[]>> = {
  quick: [],
  debug: [],
  roadmap: [`${SKILLS_DIRECTORY}/_shared/unattended.md`, `${SKILLS_DIRECTORY}/plan/references/claude.md`],
};

const flowDirectory = (flow: string) => `${SKILLS_DIRECTORY}/${flow}`;
const wrapperOf = (flow: string) => `${flowDirectory(flow)}/SKILL.md`;
const hostFileOf = (flow: string) => `${flowDirectory(flow)}/references/claude.md`;

function resolveFrom(flow: string, raw: string): string {
  const spelled = raw.replaceAll("<host>", "claude").replaceAll("${CLAUDE_SKILL_DIR}", flowDirectory(flow));
  if (spelled.startsWith("plugin/")) return path.posix.normalize(spelled);
  if (spelled.startsWith("references/")) return path.posix.join(flowDirectory(flow), spelled);
  return path.posix.join(SKILLS_DIRECTORY, spelled);
}

function namedPaths(flow: string, text: string): string[] {
  return [...text.matchAll(BACKTICKED_MARKDOWN_PATH)].map(([, raw]) => resolveFrom(flow, raw ?? ""));
}

function markedAlwaysIn(flow: string, text: string): string[] {
  return text
    .split("\n")
    .filter((line) => ALWAYS_MARKER.test(line) && !CONDITIONAL_MARKER.test(line))
    .flatMap((line) => namedPaths(flow, line));
}

function readsSection(text: string): string {
  const start = text.indexOf(SECTION_HEADING);
  if (start < 0) return "";
  const rest = text.slice(start + SECTION_HEADING.length);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

function requiredReads(flow: string, read: ReadFile): string[] {
  const marked = [...markedAlwaysIn(flow, read(wrapperOf(flow))), ...markedAlwaysIn(flow, read(hostFileOf(flow)))];
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
