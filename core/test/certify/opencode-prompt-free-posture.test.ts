import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { provedSomething } from "../support/proved.ts";
import { chooseSessionModel, runProbeSession, sessionOutcomeDescription, type SessionModelChoice, type SessionRun } from "./support/behavior-drive.ts";
import { CERTIFY, CERTIFY_GUARD } from "./support/certify-guard.ts";
import { configHomeOf, installContractFixture, type ContractFixture } from "./support/contract-fixture.ts";
import { notRun } from "./support/not-run.ts";
import { laneCauseFor, laneNotRun, resolveOpenCodeBinaryProbe, type OpenCodeBinaryProbe } from "./support/opencode-binary.ts";
import { permissionsRequestedIn } from "./support/session-transcript.ts";
import { contractBarSourceSkillNames } from "./support/source-roster.ts";
import { worktreePermissionAutoRejected } from "./support/wave-isolation.ts";

const OVERRIDE_ENV_VAR = "OSO_BEHAVIOR_BAR_OPENCODE_BIN";
const PROBE_SKILL = "oso-plan";
const PROBE_SESSION_ID = "prompt-free-posture-probe";
const PROBE_ARTIFACT = "probe.txt";
const PROBE_WORKTREE_BRANCH = "oso/prompt-free-posture-probe";
const SKILL_HEAD_RECORDS = 2;

const THE_END_STATE_READING =
  "the end-state reading of prompt-free: one headless turn reaching the two paths C0-D5(a) allows and the harness state root the " +
  "shell tool reaches as an advisory argument path, and every permission line the host printed while it ran";

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION);

type PostureProbePaths = Readonly<{ skillFile: string; stateBinary: string; stateRoot: string; worktree: string; artifact: string }>;

function postureProbePathsIn(fixture: ContractFixture, worktree: string): PostureProbePaths {
  const configHome = configHomeOf(fixture);
  return {
    skillFile: path.join(configHome, "skill", PROBE_SKILL, "SKILL.md"),
    stateBinary: path.join(configHome, "bin", "oso-state"),
    stateRoot: path.join(fixture.sandbox.home, ".local", "state", "oso-code"),
    worktree,
    artifact: path.join(worktree, PROBE_ARTIFACT),
  };
}

function oneTurnAcrossTheProbedPaths(paths: PostureProbePaths): string {
  return (
    `head -${SKILL_HEAD_RECORDS} ${paths.skillFile} > ${paths.artifact} && ` +
    `${paths.stateBinary} --session ${PROBE_SESSION_ID} show >> ${paths.artifact}`
  );
}

function hostWorktreeRootIn(fixture: ContractFixture): string {
  return path.join(fixture.sandbox.home, ".local", "share", "opencode", "worktree", PROBE_SESSION_ID);
}

function addWorktree(repository: string, worktree: string): boolean {
  mkdirSync(path.dirname(worktree), { recursive: true });
  const added = spawnSync("git", ["-C", repository, "worktree", "add", "-q", "-b", PROBE_WORKTREE_BRANCH, worktree], { encoding: "utf8" });
  return added.error === undefined && added.status === 0;
}

describe(THE_END_STATE_READING, () => {
  let fixture: ContractFixture | undefined;
  let paths: PostureProbePaths | undefined;
  let setupFailureReason: string | undefined;
  let modelChoice: SessionModelChoice | undefined;
  let session: SessionRun | undefined;

  before(() => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    fixture = installContractFixture(probe);
    if (fixture.exitCode !== 0) return;
    let repository: string;
    try {
      repository = fixture.sandbox.seedGitRepository("posture-probe-repo");
    } catch (error) {
      setupFailureReason = `the probe repository could not be seeded: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const worktree = path.join(hostWorktreeRootIn(fixture), "wt");
    if (!addWorktree(repository, worktree)) {
      setupFailureReason = `git could not add a worktree at ${worktree}, so the host's own worktree root was never reached`;
      return;
    }
    paths = postureProbePathsIn(fixture, worktree);
    modelChoice = chooseSessionModel(probe.binary, fixture.environment);
    if (modelChoice.kind !== "chosen") return;
    session = runProbeSession(probe.binary, fixture.environment, repository, modelChoice.model, oneTurnAcrossTheProbedPaths(paths));
  });

  after(() => {
    fixture?.sandbox.dispose();
  });

  function pathsOrThrow(): PostureProbePaths {
    if (paths === undefined) throw new Error("unreachable: the probe paths were expected");
    return paths;
  }

  function sessionOrThrow(): SessionRun {
    if (session === undefined) throw new Error("unreachable: a driven posture session was expected");
    return session;
  }

  function notRunUnlessSessionDriven(t: TestContext): SessionRun | undefined {
    if (laneNotRun(t, probe, laneCause)) return undefined;
    if (fixture === undefined || fixture.exitCode !== 0) {
      notRun(t, `the contract fixture install failed, so no turn could be driven — ${fixture?.report ?? "the fixture was never installed"}`);
      return undefined;
    }
    if (setupFailureReason !== undefined) {
      notRun(t, setupFailureReason);
      return undefined;
    }
    if (modelChoice === undefined || modelChoice.kind !== "chosen") {
      notRun(t, modelChoice?.kind === "unresolved" ? modelChoice.reason : "the host catalog offered no free model to drive a turn with");
      return undefined;
    }
    return sessionOrThrow();
  }

  function turnNeverLeftTheSessionDirectory(driven: SessionRun): boolean {
    return !existsSync(pathsOrThrow().artifact) && !worktreePermissionAutoRejected([`${driven.stdout}\n${driven.stderr}`]);
  }

  test("the turn read an installed skill, read the harness state root and wrote into a worktree under the host's worktree root", CERTIFY_GUARD, (t) => {
    const driven = notRunUnlessSessionDriven(t);
    if (driven === undefined) return;
    if (turnNeverLeftTheSessionDirectory(driven)) {
      notRun(t, `the turn ran no bash call reaching outside its own directory (${sessionOutcomeDescription(driven)})`);
      return;
    }
    const probed = pathsOrThrow();
    assert.ok(existsSync(probed.artifact), `nothing was written to ${probed.artifact} (${sessionOutcomeDescription(driven)})`);
    const written = readFileSync(probed.artifact, "utf8");
    const skillHead = readFileSync(probed.skillFile, "utf8").split("\n").slice(0, SKILL_HEAD_RECORDS).join("\n");
    assert.ok(written.includes(skillHead), `the installed skill's opening records are absent from ${probed.artifact}: ${written}`);
    assert.ok(written.includes(probed.stateRoot), `the harness state root is absent from ${probed.artifact}: ${written}`);
  });

  test("the host asked the operator for no permission at all while that turn ran", CERTIFY_GUARD, (t) => {
    const driven = notRunUnlessSessionDriven(t);
    if (driven === undefined) return;
    if (turnNeverLeftTheSessionDirectory(driven)) {
      notRun(t, `the turn ran no bash call reaching outside its own directory (${sessionOutcomeDescription(driven)})`);
      return;
    }
    assert.deepEqual(permissionsRequestedIn(driven.stdout, driven.stderr), []);
  });
});

provedSomething(
  `the posture probe drives one turn over ${PROBE_SKILL}'s installed wrapper, the harness state root and a worktree under the host's own worktree root`,
  contractBarSourceSkillNames().includes(PROBE_SKILL),
  `${PROBE_SKILL} is not among the skills this repository ships, so the turn would read an absent file and prompt for nothing`,
);
