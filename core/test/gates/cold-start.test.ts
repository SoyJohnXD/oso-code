import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BUNDLE_DIRECTORY, GATE_BUNDLE } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SPAWNS = 20;
const OVERHEAD_BUDGET_FLOOR_MILLISECONDS = 40;
const OVERHEAD_BUDGET_BASELINE_MULTIPLE = 1.5;
const BUNDLE_TREE = path.join(repositoryRoot, "plugin", BUNDLE_DIRECTORY);
const BUNDLE = path.join(BUNDLE_TREE, GATE_BUNDLE);
const EMPTY_ESM_MODULE = "export {};\n";
const COMMIT_ENVELOPE =
  '{"session_id":"cold-start","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
  '"tool_input":{"command":"git commit -m x"}}';

type ColdStart = Readonly<{ status: number | null; stdout: string; stderr: string; elapsed: number }>;

const interleavedPairs = withStateSandbox("workspace", (sandbox) => {
  const baselineModule = seedBareNodeBaseline(sandbox);
  return Array.from({ length: SPAWNS }, () => ({
    bundle: timeOneColdStart(sandbox, BUNDLE),
    baseline: timeOneColdStart(sandbox, baselineModule),
  }));
});
const bundleRuns = interleavedPairs.map((pair) => pair.bundle);
const baselineRuns = interleavedPairs.map((pair) => pair.baseline);
const bundleCompletions = bundleRuns.filter(exitedSilentlyWithZero).length;
const baselineCompletions = baselineRuns.filter(exitedSilentlyWithZero).length;
const bundleMean = meanElapsed(bundleRuns);
const baselineMean = meanElapsed(baselineRuns);
const overhead = bundleMean - baselineMean;
const overheadBudget = Math.max(OVERHEAD_BUDGET_FLOOR_MILLISECONDS, baselineMean * OVERHEAD_BUDGET_BASELINE_MULTIPLE);

provedSomething(
  `${bundleCompletions} of ${SPAWNS} cold start(s) of ${GATE_BUNDLE} ran the gate to its unarmed verdict, so the ` +
    "means below time a gate that worked rather than one that failed fast",
  bundleCompletions === SPAWNS,
  `only ${bundleCompletions} of ${SPAWNS} spawn(s) reached the unarmed verdict: ${firstFailureReport(bundleRuns)}`,
);

provedSomething(
  `${baselineCompletions} of ${SPAWNS} cold start(s) of the do-nothing module beside a copy of ` +
    `plugin/${BUNDLE_DIRECTORY}/package.json exited silently, so the baseline below prices node's own process ` +
    "creation through the loader path the bundle takes rather than a module that never ran",
  baselineCompletions === SPAWNS,
  `only ${baselineCompletions} of ${SPAWNS} baseline spawn(s) exited silently: ${firstFailureReport(baselineRuns)}`,
);

describe(
  `one cold start of plugin/${BUNDLE_DIRECTORY}/${GATE_BUNDLE}, ${bundleMean.toFixed(1)} ms here against the ` +
    `${baselineMean.toFixed(1)} ms bare-node spawn interleaved with it`,
  () => {
    test(
      `the ${overhead.toFixed(1)} ms it adds over bare node is at most the ${overheadBudget.toFixed(1)} ms ` +
        "this run derived from that baseline",
      () => {
        assert.ok(
          overhead <= overheadBudget,
          `${SPAWNS} interleaved spawn pairs measured ${GATE_BUNDLE} at ${bundleMean.toFixed(1)} ms and an empty ` +
            `module spawned the same way at ${baselineMean.toFixed(1)} ms, so parsing the bundle and running the ` +
            `gate cost ${overhead.toFixed(1)} ms — past the ${overheadBudget.toFixed(1)} ms budget this run derived ` +
            `as max(${OVERHEAD_BUDGET_FLOOR_MILLISECONDS} ms, ${OVERHEAD_BUDGET_BASELINE_MULTIPLE} x the measured ` +
            "baseline). Process creation is node's own cost on whatever runner this is and no gate can undercut it; " +
            "the part above it is the port's, and only that part is held here",
        );
      },
    );
  },
);

function seedBareNodeBaseline(sandbox: StateSandbox): string {
  const baselineTree = path.join(sandbox.root, "bare-node-baseline");
  mkdirSync(baselineTree, { recursive: true });
  copyFileSync(path.join(BUNDLE_TREE, "package.json"), path.join(baselineTree, "package.json"));
  const baselineModule = path.join(baselineTree, GATE_BUNDLE);
  writeFileSync(baselineModule, EMPTY_ESM_MODULE);
  return baselineModule;
}

function timeOneColdStart(sandbox: StateSandbox, script: string): ColdStart {
  const started = performance.now();
  const result = spawnSync(process.execPath, [script, "commit"], {
    cwd: sandbox.cwd,
    input: sandbox.expandJson(COMMIT_ENVELOPE),
    env: {
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      PATH: process.env["PATH"] ?? "",
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "",
    },
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, elapsed: performance.now() - started };
}

function meanElapsed(runs: readonly ColdStart[]): number {
  return runs.reduce((total, run) => total + run.elapsed, 0) / runs.length;
}

function exitedSilentlyWithZero(run: ColdStart): boolean {
  return run.status === 0 && run.stdout === "" && run.stderr === "";
}

function firstFailureReport(runs: readonly ColdStart[]): string {
  const failed = runs.find((run) => !exitedSilentlyWithZero(run));
  if (failed === undefined) return "none";
  return `exit ${failed.status}, stdout ${JSON.stringify(failed.stdout)}, stderr ${JSON.stringify(failed.stderr)}`;
}
