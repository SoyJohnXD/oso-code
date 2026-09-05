import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export class ScanFailure extends Error {}

export type SourceFile = Readonly<{ file: string; text: string }>;

export type ChangedFile = SourceFile & Readonly<{ addedLines: ReadonlySet<number> }>;

export type ChangedTree = Readonly<{ files: readonly ChangedFile[]; unreadable: readonly string[] }>;

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DIFF_SOURCE_PREFIX = "--- ";
const DIFF_TARGET_PREFIX = "+++ ";
const DIFF_SOURCE_PATH_PREFIX = "a/";
const DIFF_TARGET_PATH_PREFIX = "b/";
const NO_SUCH_FILE = "/dev/null";
const NUL_BYTE = 0;

export function changedFilesSince(cwd: string, ref: string): ChangedTree {
  const diffed = addedLinesByFile(diffOf(cwd, ref));
  const untracked = pathsListedBy(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const files: ChangedFile[] = [];
  const unreadable: string[] = [];
  for (const file of [...new Set([...diffed.keys(), ...untracked])].sort()) {
    const text = worktreeTextOf(cwd, file);
    if (text === undefined) unreadable.push(file);
    else files.push({ file, text, addedLines: diffed.get(file) ?? everyLineOf(text) });
  }
  return { files, unreadable };
}

export function trackedAndUntrackedFiles(cwd: string): SourceFile[] {
  const paths = pathsListedBy(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  return [...new Set(paths)].sort().flatMap((file) => {
    const text = worktreeTextOf(cwd, file);
    return text === undefined ? [] : [{ file, text }];
  });
}

function everyLineOf(text: string): ReadonlySet<number> {
  return new Set(text.split("\n").map((_line, index) => index + 1));
}

function worktreeTextOf(cwd: string, file: string): string | undefined {
  const content = readBufferOrNothing(path.resolve(cwd, file));
  if (content === undefined || content.includes(NUL_BYTE)) return undefined;
  return content.toString("utf8");
}

function readBufferOrNothing(target: string): Buffer | undefined {
  try {
    return readFileSync(target);
  } catch {
    return undefined;
  }
}

function diffOf(cwd: string, ref: string): string {
  return gitOutput(cwd, [
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    `--src-prefix=${DIFF_SOURCE_PATH_PREFIX}`,
    `--dst-prefix=${DIFF_TARGET_PATH_PREFIX}`,
    ref,
    "--",
  ]);
}

function pathsListedBy(cwd: string, argv: readonly string[]): string[] {
  return gitOutput(cwd, argv)
    .split("\0")
    .filter((entry) => entry !== "");
}

function gitOutput(cwd: string, argv: readonly string[]): string {
  const run = spawnSync("git", [...argv], { cwd, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES });
  if (run.error !== undefined) throw new ScanFailure(`git ${argv.join(" ")} could not run in ${cwd}: ${run.error.message}`);
  if (run.status !== 0) {
    throw new ScanFailure(`git ${argv.join(" ")} exited ${run.status} in ${cwd}: ${run.stderr.trim()}`);
  }
  return run.stdout;
}

function addedLinesByFile(diff: string): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  let target: Set<number> | undefined;
  let nextLine = 0;
  let previousLine = "";
  for (const line of diff.split("\n")) {
    const isTargetHeader = line.startsWith(DIFF_TARGET_PREFIX) && previousLine.startsWith(DIFF_SOURCE_PREFIX);
    previousLine = line;
    if (isTargetHeader) {
      target = targetLinesIn(byFile, line.slice(DIFF_TARGET_PREFIX.length));
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (target === undefined || !line.startsWith("+")) continue;
    target.add(nextLine);
    nextLine += 1;
  }
  return byFile;
}

function targetLinesIn(byFile: Map<string, Set<number>>, rawTarget: string): Set<number> | undefined {
  if (rawTarget === NO_SUCH_FILE) return undefined;
  const file = diffTargetPath(rawTarget);
  const existing = byFile.get(file);
  if (existing !== undefined) return existing;
  const lines = new Set<number>();
  byFile.set(file, lines);
  return lines;
}

function diffTargetPath(rawTarget: string): string {
  if (!rawTarget.startsWith(DIFF_TARGET_PATH_PREFIX)) {
    throw new ScanFailure(`git diff named a target this scan cannot read as a path: ${DIFF_TARGET_PREFIX}${rawTarget}`);
  }
  return rawTarget.slice(DIFF_TARGET_PATH_PREFIX.length);
}
