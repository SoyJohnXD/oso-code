import type {
  EntryExpectation,
  EventExpectation,
  FixtureExpectation,
  JournalTextExpectation,
  TextExpectation,
} from "./parity-fixture.ts";
import type { ObservedEntry, SubjectRun } from "./state-sandbox.ts";

const PRESENT_MARKER = "{present}";

export type ObservedRun = SubjectRun & {
  entries: ReadonlyMap<string, ObservedEntry>;
  eventsAppended: readonly string[];
};

export function expectationMismatches(
  expectation: FixtureExpectation,
  observed: ObservedRun,
  expand: (text: string) => string,
): string[] {
  return [
    ...exitMismatch(expectation.exit, observed.exit),
    ...streamMismatch("stdout", expectation.stdout, observed.stdout, expand),
    ...streamMismatch("stderr", expectation.stderr, observed.stderr, expand),
    ...stateMismatches(expectation.state_after, observed.entries, expand),
    ...eventMismatches(expectation.events_appended, observed.eventsAppended),
  ];
}

function exitMismatch(expected: number | undefined, actual: number): string[] {
  if (expected === undefined || expected === actual) return [];
  return [`exit: expected ${expected}, got ${actual}`];
}

function streamMismatch(
  stream: string,
  expected: TextExpectation | undefined,
  actual: string,
  expand: (text: string) => string,
): string[] {
  if (expected === undefined) return [];
  return textMismatch(stream, expected, actual, expand);
}

function stateMismatches(
  expected: Readonly<Record<string, EntryExpectation>> | undefined,
  entries: ReadonlyMap<string, ObservedEntry>,
  expand: (text: string) => string,
): string[] {
  if (expected === undefined) return [];
  return Object.entries(expected).flatMap(([entryPath, wanted]) => {
    const observed = entries.get(entryPath);
    if (observed === undefined) return [`${entryPath}: the runner never read this path`];
    return entryMismatch(entryPath, wanted, observed, expand);
  });
}

function entryMismatch(
  entryPath: string,
  expected: EntryExpectation,
  observed: ObservedEntry,
  expand: (text: string) => string,
): string[] {
  if (expected === null) {
    return observed.kind === "absent" ? [] : [`${entryPath}: expected nothing, found a ${observed.kind}`];
  }
  if (expected === PRESENT_MARKER) {
    return observed.kind === "absent" ? [`${entryPath}: expected it to be present, found nothing`] : [];
  }
  if (observed.kind !== "file") {
    return [`${entryPath}: expected a file with content, found a ${observed.kind}`];
  }
  if (isJournalTextExpectation(expected)) {
    return journalTextMismatch(entryPath, expected.journal_texts_in, observed.content, expand);
  }
  return textMismatch(entryPath, expected, observed.content, expand);
}

function isJournalTextExpectation(
  expected: TextExpectation | JournalTextExpectation,
): expected is JournalTextExpectation {
  return typeof expected === "object" && "journal_texts_in" in expected;
}

function textMismatch(
  label: string,
  expected: TextExpectation,
  actual: string,
  expand: (text: string) => string,
): string[] {
  const captured = asShellWouldCapture(actual);
  if (typeof expected !== "string") {
    return expected.contains
      .map((fragment) => expand(fragment))
      .filter((fragment) => !pathInsensitiveIncludes(captured, fragment))
      .map((fragment) => `${label}: expected it to carry ${JSON.stringify(fragment)}, got ${JSON.stringify(captured)}`);
  }
  const wanted = asShellWouldCapture(expand(expected));
  if (pathSeparatorsEqual(wanted, captured)) return [];
  return [`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(captured)}`];
}

function journalTextMismatch(
  label: string,
  expected: string,
  actual: string,
  expand: (text: string) => string,
): string[] {
  const wanted = asShellWouldCapture(expand(expected));
  const captured = asShellWouldCapture(journalTextsIn(actual));
  if (pathSeparatorsEqual(wanted, captured)) return [];
  return [`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(captured)}`];
}

function journalTextsIn(content: string): string {
  return content
    .split("\n")
    .map((line) => line.slice(line.indexOf(" ") + 1))
    .join("\n");
}

function eventMismatches(
  expected: readonly EventExpectation[] | undefined,
  appended: readonly string[],
): string[] {
  if (expected === undefined) return [];
  if (appended.length !== expected.length) {
    return [`events: expected ${expected.length} appended, got ${appended.length}: ${appended.join(" | ")}`];
  }
  return expected.flatMap((wanted, index) => eventFieldMismatches(wanted, appended[index] ?? "", index));
}

function eventFieldMismatches(wanted: EventExpectation, line: string, index: number): string[] {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch (cause) {
    return [`event ${index} is not strictly parseable JSON (${String(cause)}): ${line}`];
  }
  return Object.entries(wanted).flatMap(([field, value]) => {
    const present = Object.hasOwn(record, field);
    if (value === null) return present ? [`event ${index}: expected no ${field}, got ${String(record[field])}`] : [];
    if (!present) return [`event ${index}: expected a ${field} field, got ${line}`];
    if (value === PRESENT_MARKER || record[field] === value) return [];
    return [`event ${index}: expected ${field} ${JSON.stringify(value)}, got ${JSON.stringify(record[field])}`];
  });
}

function asShellWouldCapture(text: string): string {
  return text.replace(/\n+$/, "");
}

function withUnifiedPathSeparators(text: string): string {
  return text.replace(/\\+/g, "/");
}

export function pathSeparatorsEqual(expected: string, actual: string): boolean {
  return withUnifiedPathSeparators(expected) === withUnifiedPathSeparators(actual);
}

export function pathInsensitiveIncludes(haystack: string, needle: string): boolean {
  return withUnifiedPathSeparators(haystack).includes(withUnifiedPathSeparators(needle));
}
