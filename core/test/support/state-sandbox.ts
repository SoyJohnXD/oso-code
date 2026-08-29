import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type StateSubject = {
  readonly name: string;
  readonly command: readonly string[];
};

export const STATE_SUBJECTS: readonly StateSubject[] = [
  {
    name: "plugin/bin/oso-state",
    command: [path.join(repositoryRoot, "plugin", "bin", "oso-state")],
  },
  {
    name: "node plugin/dist/oso-state.js",
    command: ["node", path.join(repositoryRoot, "plugin", "dist", "oso-state.js")],
  },
];

export type SeededEntry =
  | string
  | { kind: "file"; content: string; aged?: boolean; agedSeconds?: number }
  | { kind: "directory"; aged?: boolean };

export type ObservedEntry =
  | { kind: "file"; content: string }
  | { kind: "directory" }
  | { kind: "absent" };

export type SubjectRun = { exit: number; stdout: string; stderr: string };

const STATE_ROOT = ".local/state/oso-code";
const EVENT_LOG = `${STATE_ROOT}/events.jsonl`;
const WORKTREES = `${STATE_ROOT}/worktrees`;
const PAST_THE_TTL = new Date("2000-01-01T00:00:00Z");
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;
const SEEDED_COMMIT_FILE = "base.txt";
const SEEDED_COMMIT_CONTENT = "base\n";
const WAVE_WORKTREE_INDEX = "1";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function joinForRoot(root: string): typeof path.posix.join {
  return root.includes("\\") ? path.win32.join : path.posix.join;
}

type Escaper = (value: string) => string;

const asIs: Escaper = (value) => value;

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function nativizeRootedPaths(text: string, root: string, escape: Escaper = asIs): string {
  if (root === "") return text;
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixPattern = new RegExp(`${escapedRoot}((?:/[^\\s"'\\\\]+)+)`, "g");
  const join = joinForRoot(root);
  return text.replace(suffixPattern, (_whole, suffix: string) => {
    const segments = suffix.split("/").filter((segment) => segment !== "");
    return escape(join(root, ...segments));
  });
}

const spawnabilityBySubject = new Map<string, boolean>();

function subjectSpawns(subject: StateSubject): boolean {
  const remembered = spawnabilityBySubject.get(subject.name);
  if (remembered !== undefined) return remembered;
  const [command, ...leading] = subject.command;
  const probe =
    command === undefined
      ? undefined
      : spawnSync(command, leading, {
          env: { HOME: tmpdir(), USERPROFILE: tmpdir(), PATH: process.env["PATH"] ?? "" },
          encoding: "utf8",
        });
  const spawns = probe !== undefined && probe.error === undefined;
  spawnabilityBySubject.set(subject.name, spawns);
  return spawns;
}

export function skipUnlessSpawnable(subject: StateSubject): false | string {
  if (subjectSpawns(subject)) return false;
  return `${subject.name} cannot be spawned here, so its behaviour cannot be measured on this platform`;
}

export function unmeasurableSubjectsReport(): string {
  const reasons = STATE_SUBJECTS.map((subject) => `${subject.name}: ${skipUnlessSpawnable(subject)}`);
  return `zero of ${STATE_SUBJECTS.length} configured subjects were measurable\n${reasons.join("\n")}`;
}

function datedAt(seeded: Exclude<SeededEntry, string>): Date | undefined {
  if (seeded.aged === true) return PAST_THE_TTL;
  if (seeded.kind === "directory" || seeded.agedSeconds === undefined) return undefined;
  return new Date(Date.now() - seeded.agedSeconds * 1000);
}

export function skipUnlessGitSeedsRepositories(): false | string {
  const probe = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (probe.error === undefined && probe.status === 0) return false;
  return "git is absent here, so a worktree teardown has no registry to read";
}

function forwardSlashed(value: string): string {
  return value.replaceAll("\\", "/");
}

export function withStateSandbox<T>(workspace: string, use: (sandbox: StateSandbox) => T): T {
  const sandbox = new StateSandbox(workspace);
  try {
    return use(sandbox);
  } finally {
    sandbox.dispose();
  }
}

export class StateSandbox {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly repositoryKey: string;

  constructor(workspace: string) {
    this.root = mkdtempSync(path.join(tmpdir(), "oso-state-"));
    this.home = path.join(this.root, "home");
    this.cwd = path.join(this.root, workspace);
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.cwd, { recursive: true });
    this.repositoryKey = sha256Hex(this.gitCommonDirectory() || this.cwd);
  }

  expand(text: string): string {
    return this.substitute(text, asIs);
  }

  expandJson(text: string): string {
    return this.substitute(text, jsonEscape);
  }

  private substitute(text: string, escape: Escaper): string {
    const substituted = text
      .replaceAll("{home}", this.home)
      .replaceAll("{cwd}", this.cwd)
      .replaceAll("{repo}", this.repositoryKey)
      .replaceAll("{repoRoot}", repositoryRoot)
      .replace(/\{sha256:([^}]*)\}/g, (_whole, value: string) => sha256Hex(value));
    const nativized = [this.home, this.cwd].reduce(
      (running, root) => nativizeRootedPaths(running, root, escape),
      substituted,
    );
    return [this.home, this.cwd].reduce(
      (running, root) => (root === "" ? running : running.replaceAll(root, escape(root))),
      nativized,
    );
  }

  seed(entries: Readonly<Record<string, SeededEntry>>): void {
    for (const [relativePath, entry] of Object.entries(entries)) {
      const target = path.join(this.home, this.expand(relativePath));
      mkdirSync(path.dirname(target), { recursive: true });
      const seeded = typeof entry === "string" ? { kind: "file" as const, content: entry } : entry;
      if (seeded.kind === "directory") {
        mkdirSync(target, { recursive: true });
        chmodSync(target, OWNER_ONLY_DIRECTORY);
      } else {
        writeFileSync(target, this.expand(seeded.content));
        chmodSync(target, OWNER_ONLY_FILE);
      }
      const dated = datedAt(seeded);
      if (dated !== undefined) utimesSync(target, dated, dated);
    }
  }

  read(relativePath: string): ObservedEntry {
    const target = path.join(this.home, this.expand(relativePath));
    const stats = statSync(target, { throwIfNoEntry: false });
    if (stats === undefined) return { kind: "absent" };
    if (stats.isDirectory()) return { kind: "directory" };
    return { kind: "file", content: readFileSync(target, "utf8") };
  }

  worktreeTreeOf(sessionId: string): string {
    return path.join(this.home, ...WORKTREES.split("/"), sessionId);
  }

  seedGitRepository(relativePath: string): string {
    const repository = path.join(this.home, relativePath);
    mkdirSync(repository, { recursive: true });
    this.git(repository, ["init", "-q"]);
    this.git(repository, ["config", "user.email", "tests@oso-code.invalid"]);
    this.git(repository, ["config", "user.name", "oso-code tests"]);
    this.git(repository, ["config", "commit.gpgsign", "false"]);
    writeFileSync(path.join(repository, SEEDED_COMMIT_FILE), SEEDED_COMMIT_CONTENT);
    this.git(repository, ["add", SEEDED_COMMIT_FILE]);
    this.git(repository, ["commit", "-qm", "base"]);
    return repository;
  }

  seedWaveWorktree(repository: string, sessionId: string): string {
    const worktree = path.join(this.worktreeTreeOf(sessionId), WAVE_WORKTREE_INDEX);
    mkdirSync(path.dirname(worktree), { recursive: true });
    this.git(repository, ["worktree", "add", "-q", "-b", `oso/parallel/${sessionId}`, worktree]);
    return worktree;
  }

  worktreesRegisteredFor(repository: string, sessionId: string): number {
    const listed = this.git(repository, ["worktree", "list", "--porcelain"], { tolerateFailure: true });
    return listed.split("\n").filter((line) => forwardSlashed(line).includes(`/worktrees/${sessionId}/`)).length;
  }

  eventLogLines(): string[] {
    const log = this.read(EVENT_LOG);
    if (log.kind !== "file") return [];
    return log.content.split("\n").filter((line) => line !== "");
  }

  run(
    subject: StateSubject,
    argv: readonly string[],
    options: { stdin?: string; env?: Readonly<Record<string, string>> } = {},
  ): SubjectRun {
    const [command, ...leading] = subject.command;
    if (command === undefined) throw new Error(`subject ${subject.name} names no command`);
    const result = spawnSync(command, [...leading, ...argv.map((argument) => this.expand(argument))], {
      cwd: this.cwd,
      input: options.stdin ?? "",
      env: this.subjectEnvironment(options.env ?? {}),
      encoding: "utf8",
    });
    if (result.error !== undefined) throw result.error;
    if (result.signal !== null) throw new Error(`${subject.name} was killed by ${result.signal}`);
    if (result.status === null) throw new Error(`${subject.name} produced no exit status`);
    return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  private subjectEnvironment(extra: Readonly<Record<string, string>>): Record<string, string> {
    return {
      HOME: this.home,
      USERPROFILE: this.home,
      PATH: process.env["PATH"] ?? "",
      XDG_CONFIG_HOME: path.join(this.home, ".config"),
      XDG_DATA_HOME: path.join(this.home, ".local", "share"),
      XDG_STATE_HOME: path.join(this.home, ".local", "state"),
      XDG_CACHE_HOME: path.join(this.home, ".cache"),
      ...extra,
    };
  }

  private git(repository: string, argv: readonly string[], options: { tolerateFailure?: boolean } = {}): string {
    const run = spawnSync("git", ["-C", repository, ...argv], {
      env: this.subjectEnvironment({}),
      encoding: "utf8",
    });
    if (options.tolerateFailure === true) return run.error === undefined && run.status === 0 ? run.stdout : "";
    if (run.error !== undefined) throw run.error;
    if (run.status !== 0) throw new Error(`git ${argv.join(" ")} in ${repository} exited ${run.status}: ${run.stderr}`);
    return run.stdout;
  }

  private gitCommonDirectory(): string {
    const named = spawnSync("git", ["-C", this.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      env: this.subjectEnvironment({}),
      encoding: "utf8",
    });
    if (named.error !== undefined || named.status !== 0) return "";
    return named.stdout.replace(/\n+$/, "");
  }
}
