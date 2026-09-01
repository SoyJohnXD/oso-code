import { tomlQuote } from "./codex-config.ts";
import { parseTomlDocument, TomlParseError } from "./toml.ts";

const POSIX_SPACE = " \\t\\n\\v\\f\\r";
const TABLE_HEADER = new RegExp(`^[${POSIX_SPACE}]*\\[`);
const FEATURE_MARKER_COMMENT = new RegExp(`^[${POSIX_SPACE}]*#[${POSIX_SPACE}]*oso-code:features:(start|end)`);
const TRAILING_COMMENT = new RegExp(`[${POSIX_SPACE}]*#.*`);
const EVERY_SPACE = new RegExp(`[${POSIX_SPACE}]`, "g");
const OWNED_FEATURE_KEYS = "hooks|multi_agent";

export const UNKNOWN_ACTION_EXIT = 64;
export const REGION_EXIT = 5;
export const FEATURES_EXIT = 6;
export const POINTER_REGION_EXIT = 10;
export const POINTER_ROW_EXIT = 11;
export const DUPLICATE_TABLE_EXIT = 12;

export const TOML_REGION_ACTIONS = [
  "strip",
  "extract",
  "split",
  "root-symbols",
  "features-strip",
  "features-merge",
  "engram-pointers",
  "remove-table",
] as const;

export type TomlRegionAction = (typeof TOML_REGION_ACTIONS)[number];

export type TomlRegionRequest = Readonly<{
  action: string;
  startMarker?: string;
  endMarker?: string;
  requireRegion?: boolean;
  featureStartMarker?: string;
  featureEndMarker?: string;
  featureText?: string;
  modelKey?: string;
  compactKey?: string;
  modelValue?: string;
  compactValue?: string;
  targetHeader?: string;
}>;

export type TomlRegionOutput = Readonly<{ exitCode: number; stdout: string; root: string; sections: string }>;

export function runTomlRegion(text: string, request: TomlRegionRequest): TomlRegionOutput {
  if (!isTomlRegionAction(request.action)) return outputOf(UNKNOWN_ACTION_EXIT, [], [], []);
  const records = recordsOf(text);
  switch (request.action) {
    case "strip":
    case "extract":
      return splitAtMarkers(records, request, request.action);
    case "split":
      return splitRootFromSections(records);
    case "root-symbols":
      return rootSymbols(records);
    case "features-strip":
      return stripFeatureRegion(records, request);
    case "features-merge":
      return mergeFeatureRegion(records, request);
    case "engram-pointers":
      return moveEngramPointers(records, request);
    case "remove-table":
      return removeTable(records, request);
  }
}

export function isTomlRegionAction(value: string): value is TomlRegionAction {
  return (TOML_REGION_ACTIONS as readonly string[]).includes(value);
}

export function recordsOf(text: string): string[] {
  const records = text.split("\n");
  if (records[records.length - 1] === "") records.pop();
  return records;
}

type RootScanner = { stringMode: "" | "multiline-basic" | "multiline-literal"; arrayDepth: number; braceDepth: number };

function newScanner(): RootScanner {
  return { stringMode: "", arrayDepth: 0, braceDepth: 0 };
}

function atRoot(scanner: RootScanner): boolean {
  return scanner.stringMode === "" && scanner.arrayDepth === 0 && scanner.braceDepth === 0;
}

function scanRoot(scanner: RootScanner, text: string): void {
  const length = text.length;
  let cursor = 0;
  while (cursor < length) {
    const triple = text.slice(cursor, cursor + 3);
    if (scanner.stringMode === "multiline-basic") {
      if (triple === '"""' && !escapedBefore(text, cursor)) {
        scanner.stringMode = "";
        cursor += 3;
      } else cursor += 1;
      continue;
    }
    if (scanner.stringMode === "multiline-literal") {
      if (triple === "'''") {
        scanner.stringMode = "";
        cursor += 3;
      } else cursor += 1;
      continue;
    }
    const character = text[cursor];
    if (character === "#") return;
    if (triple === '"""') {
      scanner.stringMode = "multiline-basic";
      cursor += 3;
      continue;
    }
    if (triple === "'''") {
      scanner.stringMode = "multiline-literal";
      cursor += 3;
      continue;
    }
    if (character === '"') {
      cursor = afterBasicString(text, cursor);
      continue;
    }
    if (character === "'") {
      cursor = afterLiteralString(text, cursor);
      continue;
    }
    if (character === "[") scanner.arrayDepth += 1;
    else if (character === "]" && scanner.arrayDepth > 0) scanner.arrayDepth -= 1;
    else if (character === "{") scanner.braceDepth += 1;
    else if (character === "}" && scanner.braceDepth > 0) scanner.braceDepth -= 1;
    cursor += 1;
  }
}

function escapedBefore(text: string, position: number): boolean {
  let count = 0;
  for (let cursor = position - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

function afterBasicString(text: string, openingQuote: number): number {
  let cursor = openingQuote + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === '"') return cursor + 1;
    cursor += 1;
  }
  return cursor;
}

function afterLiteralString(text: string, openingQuote: number): number {
  let cursor = openingQuote + 1;
  while (cursor < text.length && text[cursor] !== "'") cursor += 1;
  return cursor + 1;
}

function compactHeader(text: string): string {
  return text.replace(TRAILING_COMMENT, "").replace(EVERY_SPACE, "");
}

function isFeaturesHeader(text: string): boolean {
  return compactHeader(text) === "[features]";
}

function isFeaturesShape(text: string): boolean {
  const compact = compactHeader(text);
  return (
    /^\[\[?features(\]|[.]|$)/.test(compact) ||
    /^\[\[?"features"(\]|[.]|$)/.test(compact) ||
    /^\[\[?'features'(\]|[.]|$)/.test(compact)
  );
}

function namesKeyAtRoot(text: string, keys: string): boolean {
  const withoutComment = text.replace(TRAILING_COMMENT, "");
  const bare = new RegExp(`^[${POSIX_SPACE}]*(${keys})[${POSIX_SPACE}]*([.=])`);
  const quoted = new RegExp(`^[${POSIX_SPACE}]*"(${keys})"[${POSIX_SPACE}]*([.=])`);
  const literal = new RegExp(`^[${POSIX_SPACE}]*'(${keys})'[${POSIX_SPACE}]*([.=])`);
  return bare.test(withoutComment) || quoted.test(withoutComment) || literal.test(withoutComment);
}

function isPointer(text: string, key: string): boolean {
  return new RegExp(`^${key}[${POSIX_SPACE}]*=`).test(text);
}

function isStringPointer(text: string, key: string): boolean {
  return new RegExp(`^${key}[${POSIX_SPACE}]*=[${POSIX_SPACE}]*"[^"]*"[${POSIX_SPACE}]*$`).test(text);
}

function decodedPointerValue(record: string, key: string): string | undefined {
  try {
    const value = parseTomlDocument(record, key)[key];
    return typeof value === "string" ? value : undefined;
  } catch (error) {
    if (error instanceof TomlParseError) return undefined;
    throw error;
  }
}

function outputOf(exitCode: number, stdout: readonly string[], root: readonly string[], sections: readonly string[]): TomlRegionOutput {
  return { exitCode, stdout: printed(stdout), root: printed(root), sections: printed(sections) };
}

function printed(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

function splitAtMarkers(records: readonly string[], request: TomlRegionRequest, action: "strip" | "extract"): TomlRegionOutput {
  const scanner = newScanner();
  const emitted: string[] = [];
  let inside = false;
  let malformed = false;
  let seenStart = 0;
  let seenEnd = 0;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (rootLine && record === request.startMarker) {
      if (inside) malformed = true;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (rootLine && record === request.endMarker) {
      if (!inside) malformed = true;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (action === "strip" ? !inside : inside) emitted.push(record);
    scanRoot(scanner, record);
  }
  const broken =
    malformed || inside || seenStart !== seenEnd || seenStart > 1 || ((request.requireRegion ?? false) && seenStart !== 1);
  return outputOf(broken ? REGION_EXIT : 0, emitted, [], []);
}

function splitRootFromSections(records: readonly string[]): TomlRegionOutput {
  const scanner = newScanner();
  const root: string[] = [];
  const sections: string[] = [];
  let reachedSections = false;
  for (const record of records) {
    if (!reachedSections && atRoot(scanner) && TABLE_HEADER.test(record)) reachedSections = true;
    if (reachedSections) {
      sections.push(record);
      continue;
    }
    root.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(0, [], root, sections);
}

function rootSymbols(records: readonly string[]): TomlRegionOutput {
  const scanner = newScanner();
  const emitted: string[] = [];
  let inTableContext = false;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (rootLine && TABLE_HEADER.test(record)) {
      emitted.push(record);
      inTableContext = true;
      continue;
    }
    if (rootLine && !inTableContext) emitted.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(0, emitted, [], []);
}

type FeatureSection = "" | "features" | "other";

type FeatureScan = Readonly<{
  emitted: string[];
  malformed: boolean;
  inside: boolean;
  seenStart: number;
  seenEnd: number;
  tables: number;
  inserted: boolean;
}>;

function scanFeatureRegion(records: readonly string[], request: TomlRegionRequest, action: "features-strip" | "features-merge"): FeatureScan {
  const scanner = newScanner();
  const emitted: string[] = [];
  const featureLines = request.featureText === undefined ? [] : recordsOf(request.featureText);
  let section: FeatureSection = "";
  let inside = false;
  let malformed = false;
  let seenStart = 0;
  let seenEnd = 0;
  let tables = 0;
  let inserted = false;

  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (action === "features-strip" && rootLine && record === request.featureStartMarker) {
      if (section !== "features" || inside) malformed = true;
      inside = true;
      seenStart += 1;
      continue;
    }
    if (action === "features-strip" && rootLine && record === request.featureEndMarker) {
      if (section !== "features" || !inside) malformed = true;
      inside = false;
      seenEnd += 1;
      continue;
    }
    if (action === "features-strip" && rootLine && FEATURE_MARKER_COMMENT.test(record)) {
      malformed = true;
      continue;
    }
    if (rootLine && TABLE_HEADER.test(record)) {
      if (isFeaturesHeader(record)) {
        tables += 1;
        section = "features";
        if (action === "features-merge") {
          emitted.push(record, ...featureLines);
          inserted = true;
          continue;
        }
      } else {
        if (isFeaturesShape(record)) malformed = true;
        section = "other";
      }
    } else if (rootLine && section === "" && namesKeyAtRoot(record, "features")) {
      malformed = true;
    } else if (rootLine && section === "features" && !inside && namesKeyAtRoot(record, OWNED_FEATURE_KEYS)) {
      malformed = true;
    }
    if (!inside) emitted.push(record);
    scanRoot(scanner, record);
  }
  return { emitted, malformed, inside, seenStart, seenEnd, tables, inserted };
}

function stripFeatureRegion(records: readonly string[], request: TomlRegionRequest): TomlRegionOutput {
  const scan = scanFeatureRegion(records, request, "features-strip");
  const broken =
    scan.malformed ||
    scan.inside ||
    scan.seenStart !== scan.seenEnd ||
    scan.seenStart > 1 ||
    scan.tables > 1 ||
    (scan.seenStart > 0 && scan.tables !== 1);
  return outputOf(broken ? FEATURES_EXIT : 0, scan.emitted, [], []);
}

function mergeFeatureRegion(records: readonly string[], request: TomlRegionRequest): TomlRegionOutput {
  const scan = scanFeatureRegion(records, request, "features-merge");
  if (scan.malformed || scan.tables > 1) return outputOf(FEATURES_EXIT, scan.emitted, [], []);
  if (scan.inserted) return outputOf(0, scan.emitted, [], []);
  const featureLines = request.featureText === undefined ? [] : recordsOf(request.featureText);
  const appended = records.length > 0 ? [""] : [];
  return outputOf(0, [...scan.emitted, ...appended, "[features]", ...featureLines], [], []);
}

function removeTable(records: readonly string[], request: TomlRegionRequest): TomlRegionOutput {
  const scanner = newScanner();
  const emitted: string[] = [];
  let insideTarget = false;
  let seen = 0;
  for (const record of records) {
    const rootLine = atRoot(scanner);
    if (insideTarget && rootLine && TABLE_HEADER.test(record)) insideTarget = false;
    if (!insideTarget && rootLine && record === request.targetHeader) {
      seen += 1;
      insideTarget = true;
      scanRoot(scanner, record);
      continue;
    }
    if (!insideTarget) emitted.push(record);
    scanRoot(scanner, record);
  }
  return outputOf(seen > 1 ? DUPLICATE_TABLE_EXIT : 0, emitted, [], []);
}

function moveEngramPointers(records: readonly string[], request: TomlRegionRequest): TomlRegionOutput {
  const scanner = newScanner();
  const modelKey = request.modelKey ?? "";
  const compactKey = request.compactKey ?? "";
  const pointerRows = new Set<number>();
  let starts = 0;
  let ends = 0;
  let startLine = 0;
  let endLine = 0;
  let modelRows = 0;
  let compactRows = 0;
  let modelLine = 0;
  let compactLine = 0;
  let invalidModel = false;
  let invalidCompact = false;

  records.forEach((record, index) => {
    const number = index + 1;
    const rootLine = atRoot(scanner);
    if (rootLine && record === request.startMarker) {
      starts += 1;
      startLine = number;
    }
    if (rootLine && record === request.endMarker) {
      ends += 1;
      endLine = number;
    }
    if (rootLine && isPointer(record, modelKey)) {
      modelRows += 1;
      modelLine = number;
      pointerRows.add(number);
      if (!isStringPointer(record, modelKey) || decodedPointerValue(record, modelKey) !== request.modelValue) invalidModel = true;
    }
    if (rootLine && isPointer(record, compactKey)) {
      compactRows += 1;
      compactLine = number;
      pointerRows.add(number);
      if (!isStringPointer(record, compactKey) || decodedPointerValue(record, compactKey) !== request.compactValue) invalidCompact = true;
    }
    scanRoot(scanner, record);
  });

  if (modelRows !== 1 || compactRows !== 1 || invalidModel || invalidCompact) return outputOf(POINTER_ROW_EXIT, [], [], []);
  if (starts === 0 && ends === 0 && !(request.requireRegion ?? false)) return outputOf(0, records, [], []);
  if (starts !== 1 || ends !== 1 || startLine >= endLine) return outputOf(POINTER_REGION_EXIT, [], [], []);
  if (modelLine < startLine && compactLine < startLine) return outputOf(0, records, [], []);

  const separatorLine = startLine - 1;
  const skippedSeparator = separatorLine > 0 && records[separatorLine - 1] === "" ? separatorLine : 0;
  const emitted: string[] = [];
  records.forEach((record, index) => {
    const number = index + 1;
    if (pointerRows.has(number) || number === skippedSeparator) return;
    if (number === startLine) {
      emitted.push(`${modelKey} = ${tomlQuote(request.modelValue ?? "")}`, `${compactKey} = ${tomlQuote(request.compactValue ?? "")}`);
    }
    emitted.push(record);
  });
  return outputOf(0, emitted, [], []);
}
