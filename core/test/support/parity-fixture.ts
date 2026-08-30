import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot, type SeededEntry } from "./state-sandbox.ts";

export const PARITY_FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "state");
const PARITY_SOURCE_SUITE = "tests/hooks-test.sh";

export type SuiteCitation = { file: string; line: number; assertion: string };

export type CitingFixture = { name: string; source: readonly SuiteCitation[] };

export type TextExpectation = string | { contains: readonly string[] };

export type JournalTextExpectation = { journal_texts_in: string };

export type EntryExpectation = TextExpectation | JournalTextExpectation | null;

export type EventExpectation = Readonly<Record<string, string | number | null>>;

export type FixtureExpectation = {
  exit?: number;
  stdout?: TextExpectation;
  stderr?: TextExpectation;
  state_after?: Readonly<Record<string, EntryExpectation>>;
  events_appended?: readonly EventExpectation[];
};

export type ParityFixture = {
  name: string;
  source: readonly SuiteCitation[];
  env: Readonly<Record<string, string>>;
  state_before: Readonly<Record<string, SeededEntry>>;
  cwd: string;
  argv: readonly string[];
  stdin: string;
  expect: FixtureExpectation;
};

export function loadParityFixtures(): ParityFixture[] {
  return readdirSync(PARITY_FIXTURE_DIRECTORY)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => readFixture(path.join(PARITY_FIXTURE_DIRECTORY, entry)));
}

export function readSuiteLines(): string[] {
  return readFileSync(path.join(repositoryRoot, PARITY_SOURCE_SUITE), "utf8").split("\n");
}

export function unresolvedCitations(fixture: CitingFixture, suiteLines: readonly string[]): string[] {
  return fixture.source.flatMap((citation) => {
    if (citation.file !== PARITY_SOURCE_SUITE) {
      return [`${fixture.name}: cites ${citation.file}, which is not ${PARITY_SOURCE_SUITE}`];
    }
    const cited = citation.assertion.split("\n");
    const standing = suiteLines.slice(citation.line - 1, citation.line - 1 + cited.length).join("\n");
    if (standing === citation.assertion) return [];
    return [
      `${fixture.name}: ${citation.file}:${citation.line} now reads\n${standing}\nbut the fixture cites\n${citation.assertion}`,
    ];
  });
}

function readFixture(file: string): ParityFixture {
  const document: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof document !== "object" || document === null) {
    throw new Error(`${file} is not a fixture object`);
  }
  const fixture = document as ParityFixture;
  if (typeof fixture.name !== "string" || fixture.name === "") {
    throw new Error(`${file} carries no fixture name`);
  }
  if (!Array.isArray(fixture.source) || fixture.source.length === 0) {
    throw new Error(`${fixture.name} carries no source citation, so it is not parity evidence`);
  }
  if (!Array.isArray(fixture.argv)) throw new Error(`${fixture.name} carries no argv`);
  if (typeof fixture.expect !== "object" || fixture.expect === null) {
    throw new Error(`${fixture.name} carries no expectation`);
  }
  return fixture;
}
