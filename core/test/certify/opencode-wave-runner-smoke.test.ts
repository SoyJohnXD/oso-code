import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { before, describe, type TestContext } from "node:test";
import path from "node:path";
import { promisify } from "node:util";
import { firstExecutableOnPath } from "../../src/install/verify-claude.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { isReadableRegularFile } from "../../src/state/store.ts";
import { provedSomething } from "../support/proved.ts";
import { chooseSessionModel, runSessionWithPrompt, type SessionModelChoice } from "./support/behavior-drive.ts";
import { CERTIFY } from "./support/certify-guard.ts";
import { boundFrom } from "./support/drive.ts";
import { notRun } from "./support/not-run.ts";
import { laneCauseFor, laneNotRun, resolveOpenCodeBinaryProbe, type OpenCodeBinaryProbe } from "./support/opencode-binary.ts";
import { WAVE_SMOKE_ROWS_PORTED, waveSmokeRow, waveSmokeRowsRegistered } from "./support/row-count.ts";
import {
  EXPECTED_CHILD_VERDICT,
  waveChildPositiveHolds,
  waveChildVerdictOf,
  waveIsolationBreached,
  waveIsolationIncomplete,
  waveSmokeOutcome,
  type WaveChildFacts,
  type WaveIsolationFacts,
} from "./support/wave-isolation.ts";
import { buildWaveSmokeFixture, removeWaveSmokeFixture, waveSmokeChildEnvironment, type WaveSmokeBuildOutcome, type WaveSmokeChildName, type WaveSmokeFixture } from "./support/wave-smoke-fixture.ts";

const OVERRIDE_ENV_VAR = "OSO_WAVE_SMOKE_OPENCODE_BIN";
const MODEL_OVERRIDE_VAR = "OSO_WAVE_SMOKE_MODEL";
const SKIP_SMOKE_VAR = "OSO_VERIFY_SKIP_SMOKE";
const PREFLIGHT_PROMPT = "Reply with exactly: ready";

const WAVE_SMOKE_BOUND_SECONDS = boundFrom(process.env, "OSO_WAVE_SMOKE_BOUND_SECONDS", 300);
const WAVE_SMOKE_PREFLIGHT_BOUND_SECONDS = boundFrom(process.env, "OSO_WAVE_SMOKE_PREFLIGHT_BOUND_SECONDS", 120);

const execFileAsync = promisify(execFile);

const probe: OpenCodeBinaryProbe | undefined = CERTIFY ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env) : undefined;
const laneCause = laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION);
const nodeOnPathAtStart = CERTIFY ? firstExecutableOnPath(process.env, "node") !== undefined : true;

type ChildDrive = Readonly<{ combinedOutput: string; streamPath: string }>;

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function waveChildPrompt(name: WaveSmokeChildName): string {
  return (
    `Create a file named ${name}-proof.txt inside the current working directory containing the text 'proof-${name}'. ` +
    "Then end your reply with exactly two lines: first 'status: done', then 'verdict: pass'."
  );
}

async function driveWaveChild(binary: string, environment: NodeJS.ProcessEnv, worktree: string, model: string, name: WaveSmokeChildName, streamDirectory: string): Promise<ChildDrive> {
  let stdout = "";
  let stderr = "";
  try {
    const run = await execFileAsync(binary, ["run", "--dir", worktree, "-m", model, "--format", "json", waveChildPrompt(name)], {
      env: environment,
      encoding: "utf8",
      timeout: WAVE_SMOKE_BOUND_SECONDS * 1000,
      maxBuffer: 1024 * 1024 * 16,
    });
    stdout = run.stdout;
    stderr = run.stderr;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    stdout = execError.stdout ?? "";
    stderr = execError.stderr ?? collapsed(execError.message ?? "");
  }
  const combinedOutput = `${stdout}${stderr}`;
  const streamPath = path.join(streamDirectory, `${name}.json`);
  writeFileSync(streamPath, combinedOutput);
  return { combinedOutput, streamPath };
}

function proofContentOf(file: string): string | undefined {
  return isReadableRegularFile(file) ? readFileSync(file, "utf8").trim() : undefined;
}

function childFactsOf(fixture: WaveSmokeFixture, self: WaveSmokeChildName, other: WaveSmokeChildName, drive: ChildDrive): WaveChildFacts {
  return {
    verdict: waveChildVerdictOf(drive.streamPath),
    ownProofMatches: proofContentOf(path.join(fixture.worktrees[self], `${self}-proof.txt`)) === `proof-${self}`,
    crossProofPresent: existsSync(path.join(fixture.worktrees[other], `${self}-proof.txt`)),
    mainProofPresent: existsSync(path.join(fixture.main, `${self}-proof.txt`)),
  };
}

describe("the OpenCode wave-runner smoke ported from bootstrap/verify-opencode.sh's run_wave_smoke", () => {
  let skipRequested = false;
  let built: WaveSmokeBuildOutcome | undefined;
  let modelChoice: SessionModelChoice | undefined;
  let preflightFailureReason: string | undefined;
  let wt1Drive: ChildDrive | undefined;
  let wt2Drive: ChildDrive | undefined;
  let facts: WaveIsolationFacts | undefined;
  let cleanupRemoved: boolean | undefined;

  before(async () => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    if (process.env[SKIP_SMOKE_VAR] === "1") {
      skipRequested = true;
      return;
    }
    if (!nodeOnPathAtStart) return;

    built = buildWaveSmokeFixture();
    try {
      if (built.kind !== "ready") return;
      const fixture = built.fixture;
      modelChoice = chooseSessionModel(probe.binary, waveSmokeChildEnvironment(fixture, "catalog"), MODEL_OVERRIDE_VAR, WAVE_SMOKE_PREFLIGHT_BOUND_SECONDS);
      if (modelChoice.kind !== "chosen") return;
      const model = modelChoice.model;

      const preflight = runSessionWithPrompt(probe.binary, waveSmokeChildEnvironment(fixture, "preflight"), fixture.main, model, PREFLIGHT_PROMPT, WAVE_SMOKE_PREFLIGHT_BOUND_SECONDS);
      if (preflight.error !== undefined || preflight.signal !== null || preflight.status !== 0) {
        const foldedOutput = collapsed(`${preflight.stdout}${preflight.stderr}`);
        preflightFailureReason = `a headless session could not start with ${model} (${foldedOutput === "" ? "unavailable" : foldedOutput})`;
        return;
      }

      [wt1Drive, wt2Drive] = await Promise.all([
        driveWaveChild(probe.binary, waveSmokeChildEnvironment(fixture, "wt1"), fixture.worktrees.wt1, model, "wt1", fixture.sandbox.root),
        driveWaveChild(probe.binary, waveSmokeChildEnvironment(fixture, "wt2"), fixture.worktrees.wt2, model, "wt2", fixture.sandbox.root),
      ]);
      facts = { wt1: childFactsOf(fixture, "wt1", "wt2", wt1Drive), wt2: childFactsOf(fixture, "wt2", "wt1", wt2Drive) };
    } finally {
      const sandbox = built === undefined ? undefined : built.kind === "ready" ? built.fixture.sandbox : built.sandbox;
      cleanupRemoved = removeWaveSmokeFixture(sandbox);
    }
  });

  function notRunUnlessSmokeAttempted(t: TestContext, gate: string): boolean {
    if (laneNotRun(t, probe, laneCause)) return true;
    if (skipRequested) {
      notRun(t, `${gate} — ${SKIP_SMOKE_VAR} asked for the skip`);
      return true;
    }
    if (!nodeOnPathAtStart) {
      notRun(t, `${gate} — node is not on PATH, and the child verdicts are read through the plugin's own parser`);
      return true;
    }
    return false;
  }

  function notRunUnlessModelChosen(t: TestContext, gate: string): string | undefined {
    if (notRunUnlessSmokeAttempted(t, gate)) return undefined;
    if (built === undefined || built.kind !== "ready") {
      assert.fail(`the wave smoke fixture could not be built, so ${gate} could not be measured: ${built === undefined ? "the fixture was never attempted" : built.setupResult}`);
    }
    if (modelChoice === undefined || modelChoice.kind !== "chosen") {
      notRun(t, modelChoice?.kind === "unresolved" ? modelChoice.reason : `${gate} — the host catalog offered no free model to drive the two children with`);
      return undefined;
    }
    return modelChoice.model;
  }

  function notRunUnlessChildrenDriven(t: TestContext, gate: string): WaveIsolationFacts | undefined {
    const model = notRunUnlessModelChosen(t, gate);
    if (model === undefined) return undefined;
    if (preflightFailureReason !== undefined) {
      notRun(t, preflightFailureReason);
      return undefined;
    }
    if (facts === undefined) {
      notRun(t, `${gate} — the wave smoke's two children were never driven`);
      return undefined;
    }
    return facts;
  }

  function notRunUnlessPositiveHolds(t: TestContext, gate: string, isolation: WaveIsolationFacts, positiveChild: WaveSmokeChildName): boolean {
    const child = isolation[positiveChild];
    if (!waveChildPositiveHolds(child)) {
      notRun(t, `${gate} — ${positiveChild} never produced its own proof (verdict ${child.verdict === "" ? "none" : child.verdict}), so this absence check would be vacuous`);
      return true;
    }
    return false;
  }

  const POSITIVE_FACT_ROWS: readonly (readonly [string, (isolation: WaveIsolationFacts) => void])[] = [
    ["wt1's session ends with status: done and verdict: pass", (isolation) => assert.equal(isolation.wt1.verdict, EXPECTED_CHILD_VERDICT)],
    ["wt2's session ends with status: done and verdict: pass", (isolation) => assert.equal(isolation.wt2.verdict, EXPECTED_CHILD_VERDICT)],
    ["wt1 writes its own proof file with the expected content inside its own worktree", (isolation) => assert.equal(isolation.wt1.ownProofMatches, true)],
    ["wt2 writes its own proof file with the expected content inside its own worktree", (isolation) => assert.equal(isolation.wt2.ownProofMatches, true)],
  ];

  for (const [name, check] of POSITIVE_FACT_ROWS) {
    waveSmokeRow(name, (t) => {
      const isolation = notRunUnlessChildrenDriven(t, name);
      if (isolation !== undefined) check(isolation);
    });
  }

  const NEGATIVE_FACT_ROWS: readonly (readonly [string, WaveSmokeChildName, (isolation: WaveIsolationFacts) => boolean])[] = [
    ["wt1's worktree carries none of wt2's proof file", "wt2", (isolation) => isolation.wt1.crossProofPresent],
    ["wt2's worktree carries none of wt1's proof file", "wt1", (isolation) => isolation.wt2.crossProofPresent],
    ["the main checkout carries none of wt1's proof file", "wt1", (isolation) => isolation.wt1.mainProofPresent],
    ["the main checkout carries none of wt2's proof file", "wt2", (isolation) => isolation.wt2.mainProofPresent],
  ];

  for (const [name, positiveChild, present] of NEGATIVE_FACT_ROWS) {
    waveSmokeRow(name, (t) => {
      const isolation = notRunUnlessChildrenDriven(t, name);
      if (isolation === undefined || notRunUnlessPositiveHolds(t, name, isolation, positiveChild)) return;
      assert.equal(present(isolation), false);
    });
  }

  waveSmokeRow("the wave-runner smoke isolates worktrees", (t) => {
    if (notRunUnlessSmokeAttempted(t, "the wave-runner isolation check")) return;
    if (built === undefined || built.kind !== "ready") {
      assert.equal(built?.kind === "failed" ? built.setupResult : "fixture-never-attempted", "isolated");
      return;
    }
    const model = notRunUnlessModelChosen(t, "the wave-runner isolation check");
    if (model === undefined) return;
    if (preflightFailureReason !== undefined) {
      notRun(t, preflightFailureReason);
      return;
    }
    if (facts === undefined || wt1Drive === undefined || wt2Drive === undefined) {
      assert.fail("the wave smoke's two children were never driven despite a ready preflight");
      return;
    }
    const outcome = waveSmokeOutcome(facts, [wt1Drive.combinedOutput, wt2Drive.combinedOutput]);
    if (outcome === "host-refused-the-worktree") {
      notRun(t, "the host auto-rejected an external_directory permission for the very worktree each child was pinned to, so no child could write inside the tree the isolation assertions read");
      return;
    }
    const actual = outcome === "isolated" ? "isolated" : outcome === "breached" ? waveIsolationBreached(facts).join(" ") : waveIsolationIncomplete(facts).join(" ");
    assert.equal(actual, "isolated");
  });

  waveSmokeRow("the wave smoke fixture's temporary tree is removed after the run, on both the success and the failure path", (t) => {
    if (notRunUnlessSmokeAttempted(t, "fixture cleanup")) return;
    assert.equal(cleanupRemoved, true);
  });
});

provedSomething(
  `at least ${WAVE_SMOKE_ROWS_PORTED} row(s) of bootstrap/verify-opencode.sh's run_wave_smoke were registered in this file`,
  waveSmokeRowsRegistered() >= WAVE_SMOKE_ROWS_PORTED,
  `only ${waveSmokeRowsRegistered()} row(s) were registered, under the ${WAVE_SMOKE_ROWS_PORTED} this slice ported`,
);
