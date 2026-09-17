import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./state-sandbox.ts";

export const PROSE_ANCHOR_COMMIT = "1c85baa";

const PROSE_SOURCE_PREFIXES = ["plugin/skills/", "plugin/agents/", "opencode/skills/", "opencode/agents/"] as const;

function isProseSourceFile(file: string): boolean {
  if (file.startsWith("plugin/skills/")) return file.endsWith(".md");
  if (file.startsWith("plugin/agents/")) return !file.slice("plugin/agents/".length).includes("/") && file.endsWith(".md");
  if (file.startsWith("opencode/skills/")) return file.endsWith("/SKILL.md");
  if (file.startsWith("opencode/agents/")) return !file.slice("opencode/agents/".length).includes("/") && file.endsWith(".md");
  return false;
}

export function sourceFilesAtCommit(commit: string): string[] {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", commit, "--", ...PROSE_SOURCE_PREFIXES], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ls-tree ${commit} failed: ${result.stderr}`);
  return result.stdout.split("\n").filter((file) => file !== "" && isProseSourceFile(file)).sort();
}

export function readTextAtCommit(commit: string, file: string): string {
  const result = spawnSync("git", ["show", `${commit}:${file}`], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git show ${commit}:${file} failed: ${result.stderr}`);
  return result.stdout;
}
