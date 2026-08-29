import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { BUNDLE_DIRECTORY, GATE_BUNDLE } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const SPAWNS = 20;
const MEAN_BUDGET_MILLISECONDS = 100;
const BUNDLE = path.join(repositoryRoot, "plugin", BUNDLE_DIRECTORY, GATE_BUNDLE);
const COMMIT_ENVELOPE =
  '{"session_id":"cold-start","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
  '"tool_input":{"command":"git commit -m x"}}';

type ColdStart = Readonly<{ status: number | null; stdout: string; stderr: string; elapsed: number }>;

const coldStarts = withStateSandbox("workspace", (sandbox) =>
  Array.from({ length: SPAWNS }, () => timeOneColdStart(sandbox)),
);
const completed = coldStarts.filter((run) => run.status === 0 && run.stdout === "" && run.stderr === "");
const meanMilliseconds = coldStarts.reduce((total, run) => total + run.elapsed, 0) / coldStarts.length;

provedSomething(
  `${completed.length} of ${SPAWNS} cold start(s) of ${GATE_BUNDLE} ran the gate to its unarmed verdict, so the ` +
    "mean below times a gate that worked rather than one that failed fast",
  completed.length === SPAWNS,
  `only ${completed.length} of ${SPAWNS} spawn(s) reached the unarmed verdict: ` +
    `${firstFailureReport(coldStarts)}`,
);

describe(`one cold start of plugin/${BUNDLE_DIRECTORY}/${GATE_BUNDLE} stays inside the harness budget`, () => {
  test(`the mean of ${SPAWNS} spawns, ${meanMilliseconds.toFixed(1)} ms here, is at most ${MEAN_BUDGET_MILLISECONDS} ms`, () => {
    assert.ok(
      meanMilliseconds <= MEAN_BUDGET_MILLISECONDS,
      `the mean cold start was ${meanMilliseconds.toFixed(1)} ms over ${SPAWNS} spawns, past the ` +
        `${MEAN_BUDGET_MILLISECONDS} ms budget every Bash call on Claude pays`,
    );
  });
});

function timeOneColdStart(sandbox: StateSandbox): ColdStart {
  const started = performance.now();
  const result = spawnSync(process.execPath, [BUNDLE, "commit"], {
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

function firstFailureReport(runs: readonly ColdStart[]): string {
  const failed = runs.find((run) => run.status !== 0 || run.stdout !== "" || run.stderr !== "");
  if (failed === undefined) return "none";
  return `exit ${failed.status}, stdout ${JSON.stringify(failed.stdout)}, stderr ${JSON.stringify(failed.stderr)}`;
}
