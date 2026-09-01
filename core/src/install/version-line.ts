import { collapsedNewlines } from "./verify-claude.ts";

export type VersionLineReading =
  | Readonly<{ kind: "matched"; version: string; discarded: readonly string[] }>
  | Readonly<{ kind: "unmatched"; raw: string }>
  | Readonly<{ kind: "ambiguous"; matches: readonly string[] }>;

export type VersionOutcome = Readonly<{ version: string | undefined; note: string | undefined }>;

export function versionLineReadingOf(rawOutput: string, versionLine: RegExp): VersionLineReading {
  const lines = rawOutput.split("\n").filter((line) => line.trim() !== "");
  const matchingLines = lines.filter((line) => versionLine.test(line));
  if (matchingLines.length === 0) return { kind: "unmatched", raw: rawOutput };
  if (matchingLines.length > 1) return { kind: "ambiguous", matches: matchingLines };
  const matchedLine = matchingLines[0] ?? "";
  const captured = versionLine.exec(matchedLine)?.[1];
  return { kind: "matched", version: captured ?? matchedLine, discarded: lines.filter((line) => line !== matchedLine) };
}

export function versionOutcomeOf(reading: VersionLineReading, versionLineShape: string): VersionOutcome {
  if (reading.kind === "matched") {
    return { version: reading.version, note: reading.discarded.length === 0 ? undefined : extraLinesNote(reading.discarded) };
  }
  if (reading.kind === "unmatched") return { version: undefined, note: unmatchedNote(versionLineShape, reading.raw) };
  return { version: undefined, note: ambiguousNote(versionLineShape, reading.matches) };
}

function extraLinesNote(discarded: readonly string[]): string {
  const first = discarded[0] ?? "";
  const plural = discarded.length === 1 ? "line" : "lines";
  return `the probe printed ${discarded.length} extra ${plural} beyond the version; first: ${collapsedNewlines(first)}`;
}

function unmatchedNote(versionLineShape: string, raw: string): string {
  return `the probe printed no line shaped like ${versionLineShape}; raw output: ${collapsedNewlines(raw)}`;
}

function ambiguousNote(versionLineShape: string, matches: readonly string[]): string {
  return `the probe printed ${matches.length} lines shaped like ${versionLineShape} (ambiguous): ${collapsedNewlines(matches.join("\n"))}`;
}
