import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { basenameOf, lexShellCommands, type LexRecord } from "../../src/shell/lexer.ts";
import { provedSomething } from "../support/proved.ts";
import { linesOutsideHeredocBodies } from "../support/shell-heredoc-lines.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const DIRECT_CHILD_GLOBS: readonly { dir: string; ext: string }[] = [
  { dir: "tests", ext: ".sh" },
  { dir: "tests/fixtures", ext: ".sh" },
  { dir: "bootstrap/lib", ext: ".sh" },
  { dir: "tools", ext: ".sh" },
];
const MINIMUM_SCANNED_FILES = 2;
const MINIMUM_SCANNED_FILES_DERIVATION =
  "tests/*.sh, tests/fixtures/*.sh, bootstrap/lib/*.sh and tools/*.sh, measured at C5-S5b: 3 " +
  "(tests/plugin-lint.sh, tests/fixtures/crashing-hook.sh, tools/verify-check-names.sh — bootstrap/lib holds none)";
const OPENCODE_MENTION = /opencode/i;
const CONTINUATION = /\\[ \t]*$/;
const STRIPPABLE_SUFFIX = /_(bin|binary|exe|path|cmd|cli)$/i;

type LogicalUnit = Readonly<{ file: string; startLine: number; text: string }>;

function isDirectChild(file: string, dir: string): boolean {
  return file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes("/");
}

function isScanned(file: string): boolean {
  return DIRECT_CHILD_GLOBS.some(({ dir, ext }) => isDirectChild(file, dir) && file.endsWith(ext));
}

function logicalUnitsIn({ file, text }: TrackedFileText): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  let startLine = 0;
  let joined = "";
  for (const { number, text: lineText } of linesOutsideHeredocBodies(text)) {
    if (startLine === 0) startLine = number;
    const continuation = lineText.match(CONTINUATION);
    joined += continuation ? lineText.slice(0, continuation.index) : lineText;
    if (continuation !== null) continue;
    units.push({ file, startLine, text: joined });
    startLine = 0;
    joined = "";
  }
  if (startLine !== 0) units.push({ file, startLine, text: joined });
  return units;
}

function namesTheOpencodeBinary(word: string): boolean {
  const base = basenameOf(word);
  if (base === "opencode") return true;
  if (!base.includes("$")) return false;
  let name = base
    .slice(base.lastIndexOf("$") + 1)
    .replace(/^\{/, "")
    .replace(/\}$/, "");
  const modifierAt = name.search(/[#%:]/);
  if (modifierAt !== -1) name = name.slice(0, modifierAt);
  for (;;) {
    if (/opencode$/i.test(name)) return true;
    const stripped = name.replace(STRIPPABLE_SUFFIX, "");
    if (stripped === name) return false;
    name = stripped;
  }
}

function argumentBeyondARedirectDescriptor(word: string): boolean {
  return word === "" || /\D/.test(word);
}

function invokesOpencodeDirectly(records: readonly LexRecord[]): boolean {
  let invoked = false;
  let namesTheBinary = false;
  let substituted = false;
  for (const record of records) {
    if (record.kind === "commandWord") {
      namesTheBinary = namesTheOpencodeBinary(record.word);
      if (record.word === "$") substituted = true;
      if (namesTheBinary && substituted) invoked = true;
    } else if (record.kind === "argument") {
      if (basenameOf(record.word) === "opencode" && substituted) invoked = true;
      if (namesTheBinary && argumentBeyondARedirectDescriptor(record.word)) invoked = true;
    } else if (record.kind === "stdinText") {
      if (namesTheBinary) invoked = true;
    }
  }
  return invoked;
}

const scannedFiles = trackedRepositoryFiles().filter(isScanned);

provedSomething(
  `${scannedFiles.length} tracked shell source file(s) under tests/, tests/fixtures/, bootstrap/lib/ and tools/ ` +
    "were read for a direct opencode invocation",
  scannedFiles.length >= MINIMUM_SCANNED_FILES,
  `only ${scannedFiles.length} file(s) were read, under the ${MINIMUM_SCANNED_FILES}-file floor (${MINIMUM_SCANNED_FILES_DERIVATION})`,
);

const sites = scannedFiles
  .map(readTrackedText)
  .flatMap(logicalUnitsIn)
  .filter((unit) => OPENCODE_MENTION.test(unit.text))
  .filter((unit) => invokesOpencodeDirectly(lexShellCommands(unit.text)))
  .map((unit) => `${unit.file}:${unit.startLine}`);

describe(
  "no verification script under tests/, tests/fixtures/, bootstrap/lib/ or tools/ makes the opencode binary its " +
    "own command word — passing it as an argument to a runner that pins HOME, TMPDIR and every XDG directory is " +
    "the only sanctioned shape; a heredoc body fed as stdin to a directly-invoked opencode sits outside this " +
    "port's reach, since the heredoc-body skip this check shares with the contract-header check drops that text " +
    "rather than folding it back into the command it belongs to, and no site in this corpus exercises that shape",
  () => {
    test("no scanned logical command line invokes opencode directly", () => {
      assert.deepEqual(sites, [], sites.join("\n"));
    });
  },
);
