import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot, type SeededEntry } from "./state-sandbox.ts";

export const PARITY_FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "state");

export type SuiteCitation = { assertion: string };

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

export type RunnableFixture = {
  name: string;
  env: Readonly<Record<string, string>>;
  state_before: Readonly<Record<string, SeededEntry>>;
  cwd: string;
  argv: readonly string[];
  stdin: string;
  expect: FixtureExpectation;
};

export type ParityFixture = RunnableFixture & {
  source: readonly SuiteCitation[];
};

export function loadFixturesFrom<T>(directory: string, parse: (file: string) => T): T[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => parse(path.join(directory, entry)));
}

export function loadParityFixtures(): ParityFixture[] {
  return loadFixturesFrom(PARITY_FIXTURE_DIRECTORY, readFixture);
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
