import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export class ScanFailure extends Error {}

export type SourceFile = Readonly<{ file: string; text: string }>;

export type ChangedFile = SourceFile & Readonly<{ addedLines: ReadonlySet<number> }>;

export type ReadFailure = Readonly<{ file: string; cause: string }>;

export type ChangedTree = Readonly<{ files: readonly ChangedFile[]; unreadable: readonly ReadFailure[] }>;

export type SourceTree = Readonly<{ files: readonly SourceFile[]; unreadable: readonly ReadFailure[] }>;

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DIFF_SOURCE_PREFIX = "--- ";
const DIFF_TARGET_PREFIX = "+++ ";
const DIFF_SOURCE_PATH_PREFIX = "a/";
const DIFF_TARGET_PATH_PREFIX = "b/";
const NO_SUCH_FILE = "/dev/null";
const NUL_BYTE = 0;

export function changedFilesSince(cwd: string, ref: string): ChangedTree {
  const repositoryRoot = repositoryRootOf(cwd);
  const resolvedTree = resolveTree(cwd, ref);
  const diffPaths = new Set(pathsListedBy(repositoryRoot, diffArguments(resolvedTree, ["--name-only", "-z"])));
  const diffed = addedLinesByFile(diffOf(repositoryRoot, resolvedTree), diffPaths);
  const untracked = pathsListedBy(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const tree = readTree(repositoryRoot, [...new Set([...diffPaths, ...diffed.keys(), ...untracked])].sort());
  return {
    files: tree.files.map(({ file, text }) => ({ file, text, addedLines: diffed.get(file) ?? everyLineOf(text) })),
    unreadable: tree.unreadable,
  };
}

function trackedAndUntrackedFiles(cwd: string): SourceTree {
  const repositoryRoot = repositoryRootOf(cwd);
  const paths = pathsListedBy(repositoryRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  return readTree(repositoryRoot, [...new Set(paths)].sort());
}

export { trackedAndUntrackedFiles };

function everyLineOf(text: string): ReadonlySet<number> {
  return new Set(text.split("\n").map((_line, index) => index + 1));
}

function readTree(repositoryRoot: string, paths: readonly string[]): SourceTree {
  const files: SourceFile[] = [];
  const unreadable: ReadFailure[] = [];
  for (const file of paths) {
    const result = worktreeTextOf(repositoryRoot, file);
    if (result.kind === "unreadable") unreadable.push(result.failure);
    else files.push({ file, text: result.text });
  }
  return { files, unreadable };
}

function worktreeTextOf(repositoryRoot: string, file: string):
  | Readonly<{ kind: "read"; text: string }>
  | Readonly<{ kind: "unreadable"; failure: ReadFailure }> {
  try {
    const target = confinedRegularFile(repositoryRoot, file);
    const content = readFileSync(target);
    if (content.includes(NUL_BYTE)) return { kind: "unreadable", failure: { file, cause: "binary content contains NUL byte" } };
    return { kind: "read", text: content.toString("utf8") };
  } catch (error) {
    return { kind: "unreadable", failure: { file, cause: causeOf(error) } };
  }
}

function confinedRegularFile(repositoryRoot: string, file: string): string {
  const target = path.resolve(repositoryRoot, file);
  const relative = path.relative(repositoryRoot, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes repository root: ${file}`);
  }
  const segments = relative.split(path.sep);
  let current = repositoryRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`path uses a symbolic link: ${path.relative(repositoryRoot, current)}`);
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error(`path ancestor is not a directory: ${path.relative(repositoryRoot, current)}`);
    }
    if (index === segments.length - 1 && !stats.isFile()) throw new Error(`path is not a regular file: ${file}`);
  }
  return target;
}

function repositoryRootOf(cwd: string): string {
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]).trim();
  try {
    return realpathSync(root);
  } catch (error) {
    throw new ScanFailure(`repository root ${root} could not be read: ${causeOf(error)}`);
  }
}

function resolveTree(cwd: string, ref: string): string {
  if (ref.startsWith("-")) throw new ScanFailure(`scan ref cannot start with '-': ${ref}`);
  const resolved = gitOutput(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{tree}`]).trim();
  if (!/^[0-9a-f]+$/.test(resolved)) throw new ScanFailure(`scan ref did not resolve to one tree object: ${ref}`);
  return resolved;
}

function diffOf(cwd: string, tree: string): string {
  return gitOutput(cwd, diffArguments(tree));
}

function diffArguments(tree: string, options: readonly string[] = []): string[] {
  return [
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    ...options,
    `--src-prefix=${DIFF_SOURCE_PATH_PREFIX}`,
    `--dst-prefix=${DIFF_TARGET_PATH_PREFIX}`,
    tree,
    "--",
  ];
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

function addedLinesByFile(diff: string, diffPaths: ReadonlySet<string>): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  let target: Set<number> | undefined;
  let nextLine = 0;
  let inHunk = false;
  let sourceHeader: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      sourceHeader = undefined;
      target = undefined;
      continue;
    }
    if (!inHunk && line.startsWith(DIFF_SOURCE_PREFIX)) {
      sourceHeader = line.slice(DIFF_SOURCE_PREFIX.length);
      continue;
    }
    if (!inHunk && sourceHeader !== undefined && line.startsWith(DIFF_TARGET_PREFIX)) {
      target = targetLinesIn(byFile, line.slice(DIFF_TARGET_PREFIX.length), diffPaths);
      sourceHeader = undefined;
      continue;
    }
    sourceHeader = undefined;
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      inHunk = true;
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) {
      target?.add(nextLine);
      nextLine += 1;
    } else if (line.startsWith(" ")) {
      nextLine += 1;
    }
  }
  return byFile;
}

function targetLinesIn(byFile: Map<string, Set<number>>, rawTarget: string, diffPaths: ReadonlySet<string>): Set<number> | undefined {
  if (rawTarget === NO_SUCH_FILE) return undefined;
  const file = diffTargetPath(rawTarget);
  if (!diffPaths.has(file)) throw new ScanFailure(`git diff target is absent from its path inventory: ${file}`);
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

function causeOf(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}
