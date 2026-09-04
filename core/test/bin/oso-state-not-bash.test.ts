import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { posixRepositoryPath } from "../support/repository-paths.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { subtractDeletedPaths } from "../support/tracked-files.ts";

const selfPath = posixRepositoryPath(fileURLToPath(import.meta.url));

const SCANNABLE_EXTENSIONS = new Set([".sh", ".bash", ".yml", ".yaml", ".ts", ".mjs", ".js"]);
const SCANNABLE_EXTENSIONLESS_PATHS = new Set(["plugin/bin/oso-state", "plugin/git-hooks/pre-commit"]);

const OSO_STATE_PATH_TOKEN = String.raw`"?[A-Za-z0-9_./\$\{\}:-]*plugin/bin/oso-state"?`;
const OSO_STATE_BIN_VAR_TOKEN = String.raw`"?\$\{?OSO_STATE_BIN\}?"?`;
const BASH_TREATMENT_PATTERN = new RegExp(
  String.raw`\bbash[ \t]+(-n[ \t]+)?(${OSO_STATE_PATH_TOKEN}|${OSO_STATE_BIN_VAR_TOKEN})([ \t]|$)`,
);

type LogicalLine = { text: string; startLineNumber: number };

function isScannablePath(relativePath: string): boolean {
  const extension = path.extname(relativePath);
  if (extension !== "") return SCANNABLE_EXTENSIONS.has(extension);
  return SCANNABLE_EXTENSIONLESS_PATHS.has(relativePath);
}

function joinLineContinuations(content: string): LogicalLine[] {
  const logicalLines: LogicalLine[] = [];
  let buffer = "";
  let startLineNumber = 1;
  content.split("\n").forEach((rawLine, index) => {
    if (buffer === "") startLineNumber = index + 1;
    buffer += rawLine;
    if (buffer.endsWith("\\")) {
      buffer = `${buffer.slice(0, -1)} `;
      return;
    }
    logicalLines.push({ text: buffer, startLineNumber });
    buffer = "";
  });
  if (buffer !== "") logicalLines.push({ text: buffer, startLineNumber });
  return logicalLines;
}

function bashTreatmentLineNumbers(content: string): number[] {
  return joinLineContinuations(content)
    .filter((logicalLine) => BASH_TREATMENT_PATTERN.test(logicalLine.text))
    .map((logicalLine) => logicalLine.startLineNumber);
}

function gitLsFiles(...args: readonly string[]): string[] {
  return execFileSync("git", ["ls-files", ...args], { cwd: repositoryRoot, encoding: "utf8" })
    .split("\n")
    .filter((relativePath) => relativePath !== "");
}

function trackedRepositoryFiles(): string[] {
  return subtractDeletedPaths(gitLsFiles(), gitLsFiles("--deleted"));
}

function bashTreatmentViolations(relativePath: string): string[] {
  const content = readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  return bashTreatmentLineNumbers(content).map((lineNumber) => `${relativePath}:${lineNumber}`);
}

test("bashTreatmentLineNumbers flags bash -n against the retired bash path", () => {
  assert.deepEqual(bashTreatmentLineNumbers('bash -n "$SCRIPT_DIR/plugin/bin/oso-state"\n'), [1]);
});

test("bashTreatmentLineNumbers flags bash spawning the state binary env var", () => {
  assert.deepEqual(bashTreatmentLineNumbers('bash "$OSO_STATE_BIN"\n'), [1]);
});

test("bashTreatmentLineNumbers flags a bash -n list split across a line continuation", () => {
  assert.deepEqual(bashTreatmentLineNumbers("bash -n \\\n  plugin/bin/oso-state\n"), [1]);
});

test("bashTreatmentLineNumbers does not flag oso-state invoked directly through its own shebang", () => {
  assert.deepEqual(bashTreatmentLineNumbers('state_bin="${OSO_STATE_BIN:-$HOOK_DIR/../bin/oso-state}"\n"$state_bin" --session x show\n'), []);
});

test("bashTreatmentLineNumbers does not flag prose mentioning both bash and the retired path", () => {
  assert.deepEqual(
    bashTreatmentLineNumbers("On Codex run bash bootstrap/install.sh; plugin/bin/oso-state moved bytes too.\n"),
    [],
  );
});

const scannableTrackedFiles = trackedRepositoryFiles().filter(
  (relativePath) => relativePath !== selfPath && isScannablePath(relativePath),
);

provedSomething(
  "the bash-treatment scan reads at least one tracked, scannable file",
  scannableTrackedFiles.length > 0,
  "git ls-files returned zero scannable tracked files, so the scan below would pass having looked at nothing",
);

test("no tracked file spawns, syntax-checks, or scans plugin/bin/oso-state as a bash source", () => {
  const violations = scannableTrackedFiles.flatMap(bashTreatmentViolations);
  assert.deepEqual(violations, []);
});
