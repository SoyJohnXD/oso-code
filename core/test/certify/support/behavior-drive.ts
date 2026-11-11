import { spawnSync } from "node:child_process";
import path from "node:path";
import { sha256Hex } from "../../../src/state/store.ts";
import { boundFrom } from "./drive.ts";

const DEFAULT_SESSION_BOUND_SECONDS = 180;

export const BEHAVIOR_BAR_SESSION_BOUND_SECONDS = boundFrom(
  process.env,
  "OSO_BEHAVIOR_BAR_SESSION_BOUND_SECONDS",
  DEFAULT_SESSION_BOUND_SECONDS,
);

export type SessionRun = Readonly<{
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error: Error | undefined;
}>;

export function probeRootSessionId(probeRepository: string): string {
  return sha256Hex(path.join(probeRepository, ".git")).slice(0, 16);
}

export function probeRepositoryCommitCount(probeRepository: string): string {
  const run = spawnSync("git", ["-C", probeRepository, "rev-list", "--count", "HEAD"], { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return "unreadable";
  return run.stdout.trim();
}
