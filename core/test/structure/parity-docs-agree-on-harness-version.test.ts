import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const VERSION_PINS = "core/src/install/pins.ts";

type HostParity = Readonly<{
  host: "codex" | "opencode";
  pinPattern: RegExp;
  namePattern: RegExp;
  doc: string;
}>;

const HOSTS: readonly HostParity[] = [
  {
    host: "codex",
    pinPattern: /^export const SUPPORTED_CODEX_VERSION = "(.*)";$/,
    namePattern: /Codex \d+\.\d+\.\d+/g,
    doc: "docs/parity-codex.md",
  },
  {
    host: "opencode",
    pinPattern: /^export const SUPPORTED_OPENCODE_VERSION = "(.*)";$/,
    namePattern: /OpenCode \d+\.\d+\.\d+/g,
    doc: "docs/parity-opencode.md",
  },
];

const FIXED_FILES = [VERSION_PINS, ...HOSTS.map((entry) => entry.doc)];
const MINIMUM_COMBINED_LINES = 40;
const MINIMUM_COMBINED_LINES_DERIVATION = `wc -l across ${FIXED_FILES.join(", ")}, measured at C5-S5b-3: 17 + 22 + 23 = 62`;

type PinLine = Readonly<{ version: string; line: number }>;
type NamedVersion = Readonly<{ text: string; line: number }>;

function wcDashL(text: string): number {
  return text.split("\n").length - 1;
}

function pinLineFor(pinsText: string, pinPattern: RegExp): PinLine | undefined {
  const lines = pinsText.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(pinPattern);
    if (match?.[1] !== undefined) return { version: match[1], line: index + 1 };
  }
  return undefined;
}

function namedVersionsIn(docText: string, namePattern: RegExp): NamedVersion[] {
  return docText
    .split("\n")
    .flatMap((line, index) => [...line.matchAll(namePattern)].map((match) => ({ text: match[0], line: index + 1 })));
}

function lastSpaceDelimitedField(text: string): string {
  return text.slice(text.lastIndexOf(" ") + 1);
}

const trackedFiles = trackedRepositoryFiles();
const trackedFileSet = new Set(trackedFiles);

function fixedFileLineCount(file: string): number {
  return trackedFileSet.has(file) ? wcDashL(readTrackedText(file).text) : 0;
}

const combinedFixedFileLines = FIXED_FILES.reduce((total, file) => total + fixedFileLineCount(file), 0);

provedSomething(
  `${FIXED_FILES.join(", ")} were read with a non-trivial combined line count before being compared for a harness-version disagreement`,
  combinedFixedFileLines >= MINIMUM_COMBINED_LINES,
  `only ${combinedFixedFileLines} combined line(s) were read, under the ${MINIMUM_COMBINED_LINES}-line floor ` +
    `(${MINIMUM_COMBINED_LINES_DERIVATION}), so a truncated read would surface as a missing pin or an unnamed ` +
    "version rather than as the corpus break it actually is",
);

const pinsText = trackedFileSet.has(VERSION_PINS) ? readTrackedText(VERSION_PINS).text : "";

function violationFor(entry: HostParity): string | undefined {
  if (!trackedFileSet.has(entry.doc)) {
    return `${entry.doc} is missing, so no parity ledger states what this repo supports on ${entry.host}`;
  }
  const pin = pinLineFor(pinsText, entry.pinPattern);
  if (pin === undefined) {
    return `no ${entry.host} harness version pin in ${VERSION_PINS} for ${entry.doc} to agree with`;
  }
  const named = namedVersionsIn(readTrackedText(entry.doc).text, entry.namePattern);
  const uniqueTexts = [...new Set(named.map((found) => found.text))].sort();
  if (uniqueTexts.length === 0) {
    return (
      `${entry.doc} names no harness version to compare against the installer pin ${pin.version} ` +
      `at ${VERSION_PINS}:${pin.line}`
    );
  }
  if (uniqueTexts.length === 1) {
    const text = uniqueTexts[0] as string;
    const namedVersion = lastSpaceDelimitedField(text);
    if (namedVersion === pin.version) return undefined;
    const line = named.find((found) => found.text === text)?.line;
    return (
      `${entry.doc}:${line} names ${namedVersion}, which disagrees with the ${pin.version} pin ` +
      `${VERSION_PINS}:${pin.line} states`
    );
  }
  const lines = uniqueTexts.map((text) => named.find((found) => found.text === text)?.line);
  return `${entry.doc} names more than one harness version, at line(s) ${lines.join(", ")}, so it cannot agree on one`;
}

describe(
  "docs/parity-codex.md and docs/parity-opencode.md each name exactly one harness version, agreeing with " +
    `${VERSION_PINS}'s own SUPPORTED_CODEX_VERSION and SUPPORTED_OPENCODE_VERSION pin — this rule reads three ` +
    "fixed paths rather than walking a directory, so the tracked-files-versus-recursion divergence this port's " +
    "siblings disclose does not arise here, and neither host's evaluation is skipped once the other's is decided",
  () => {
    for (const entry of HOSTS) {
      test(`${entry.doc} agrees with ${VERSION_PINS}'s ${entry.host} pin`, () => {
        const violation = violationFor(entry);
        assert.ok(violation === undefined, violation ?? "");
      });
    }
  },
);
