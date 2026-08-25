import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type Role = "root" | "child" | "none";

export interface IdentityVars {
  OSO_AGENT: string;
}

interface GitMetadata {
  commonDir: string;
  isWorktree: boolean;
}

export function deriveRootId(cwd: string): string {
  const meta = findGitMetadata(cwd);
  return meta === null ? "" : hashId(meta.commonDir);
}

export function commonDirOf(cwd: string): string {
  const meta = findGitMetadata(cwd);
  return meta === null ? "" : meta.commonDir;
}

export function roleOf(cwd: string): Role {
  const meta = findGitMetadata(cwd);
  if (meta === null) {
    return "none";
  }
  return meta.isWorktree ? "child" : "root";
}

export function publishIdentity(cwd: string): IdentityVars {
  return { OSO_AGENT: deriveRootId(cwd) };
}

function findGitMetadata(cwd: string): GitMetadata | null {
  let dir = resolve(cwd);
  for (;;) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      let isDir = false;
      try {
        isDir = statSync(dotGit).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir) {
        if (isRealGitDir(dotGit)) {
          return { commonDir: dotGit, isWorktree: false };
        }
      } else {
        const gitDir = worktreeGitDir(dotGit, dir);
        if (gitDir !== null) {
          return { commonDir: stripWorktreesSuffix(gitDir), isWorktree: true };
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function isRealGitDir(dotGit: string): boolean {
  return existsSync(join(dotGit, "HEAD")) && existsSync(join(dotGit, "objects"));
}

function worktreeGitDir(dotGit: string, baseDir: string): string | null {
  let content: string;
  try {
    content = readFileSync(dotGit, "utf8");
  } catch {
    return null;
  }
  const line = content.split("\n")[0]?.trim() ?? "";
  if (!line.startsWith("gitdir:")) {
    return null;
  }
  const raw = line.slice("gitdir:".length).trim();
  if (raw === "") {
    return null;
  }
  const path = isAbsolute(raw) ? raw : join(baseDir, raw);
  return resolve(path);
}

function stripWorktreesSuffix(gitDir: string): string {
  const marker = `${sep}worktrees${sep}`;
  const idx = gitDir.lastIndexOf(marker);
  if (idx === -1) {
    return gitDir;
  }
  return gitDir.slice(0, idx);
}

function hashId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
