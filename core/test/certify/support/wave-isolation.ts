import { spawnSync } from "node:child_process";
import path from "node:path";
import { repositoryRoot } from "../../support/state-sandbox.ts";

export const WAVE_VERDICT_READER = path.join(repositoryRoot, "tools", "read-session-verdict.mjs");
export const EXPECTED_CHILD_VERDICT = "status:done verdict:pass";

const WORKTREE_PERMISSION_AUTO_REJECTED_PATTERN = /permission requested: external_directory.*auto-rejecting/;

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function waveChildVerdictOf(streamPath: string): string {
  const run = spawnSync("node", [WAVE_VERDICT_READER, streamPath], { encoding: "utf8" });
  if (run.error !== undefined) return `unreadable:${collapsed(run.error.message)}`;
  if (run.status !== 0) return `unreadable:${collapsed(run.stderr ?? "")}`;
  return (run.stdout ?? "").trim();
}

export function worktreePermissionAutoRejected(childOutputs: readonly string[]): boolean {
  return childOutputs.some((output) => WORKTREE_PERMISSION_AUTO_REJECTED_PATTERN.test(output));
}

export type WaveChildFacts = Readonly<{ verdict: string; ownProofMatches: boolean; crossProofPresent: boolean; mainProofPresent: boolean }>;

export type WaveIsolationFacts = Readonly<{ wt1: WaveChildFacts; wt2: WaveChildFacts }>;

export function waveChildPositiveHolds(child: WaveChildFacts): boolean {
  return child.verdict === EXPECTED_CHILD_VERDICT && child.ownProofMatches;
}

export function waveIsolationBreached(facts: WaveIsolationFacts): readonly string[] {
  const breached: string[] = [];
  if (facts.wt1.crossProofPresent) breached.push("wt1-has-wt2-proof");
  if (facts.wt2.crossProofPresent) breached.push("wt2-has-wt1-proof");
  if (facts.wt1.mainProofPresent) breached.push("root-has-wt1-proof");
  if (facts.wt2.mainProofPresent) breached.push("root-has-wt2-proof");
  return breached;
}

export function waveIsolationIncomplete(facts: WaveIsolationFacts): readonly string[] {
  const incomplete: string[] = [];
  if (facts.wt1.verdict !== EXPECTED_CHILD_VERDICT) incomplete.push(`wt1-verdict(${facts.wt1.verdict === "" ? "none" : facts.wt1.verdict})`);
  if (facts.wt2.verdict !== EXPECTED_CHILD_VERDICT) incomplete.push(`wt2-verdict(${facts.wt2.verdict === "" ? "none" : facts.wt2.verdict})`);
  if (!facts.wt1.ownProofMatches) incomplete.push("wt1-proof");
  if (!facts.wt2.ownProofMatches) incomplete.push("wt2-proof");
  return incomplete;
}

export type WaveSmokeOutcome = "isolated" | "breached" | "host-refused-the-worktree" | "incomplete";

export function waveSmokeOutcome(facts: WaveIsolationFacts, childOutputs: readonly string[]): WaveSmokeOutcome {
  if (waveIsolationBreached(facts).length > 0) return "breached";
  if (waveIsolationIncomplete(facts).length === 0) return "isolated";
  return worktreePermissionAutoRejected(childOutputs) ? "host-refused-the-worktree" : "incomplete";
}
