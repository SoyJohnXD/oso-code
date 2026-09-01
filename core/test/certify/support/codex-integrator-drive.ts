import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isReadableRegularFile } from "../../../src/state/store.ts";
import { boundFrom } from "./drive.ts";
import { gitOutput, SMOKE_BRANCH, type IntegratorFixture } from "./codex-smoke-fixture.ts";
import { integratorHandoffConsumed, type HandoffExpectation } from "./codex-handoff-receipt.ts";

export const CODEX_LOGIN_STATUS_BOUND_SECONDS = boundFrom(process.env, "OSO_CODEX_LOGIN_STATUS_BOUND_SECONDS", 20);
export const CODEX_EXEC_SMOKE_BOUND_SECONDS = boundFrom(process.env, "OSO_CODEX_EXEC_SMOKE_BOUND_SECONDS", 180);

const INTEGRATED_FILE_LINE = "integrated by oso-integrator";

export type LoginProbe = Readonly<{ ok: boolean; output: string }>;

export function codexLoginStatus(environment: NodeJS.ProcessEnv, boundSeconds: number): LoginProbe {
  const run = spawnSync("codex", ["login", "status"], { env: environment, encoding: "utf8", timeout: boundSeconds * 1000 });
  if (run.error !== undefined) return { ok: false, output: collapsed(run.error.message) };
  if (run.signal !== null) return { ok: false, output: `codex login status did not answer within ${boundSeconds}s` };
  return { ok: run.status === 0, output: collapsed(`${run.stdout ?? ""}${run.stderr ?? ""}`) };
}

export type IntegratorMeasuredFacts = Readonly<{
  handoffConsumed: boolean;
  integratedFileMatches: boolean;
  sliceIsAncestor: boolean;
  branchGone: boolean;
  worktreeGone: boolean;
}>;

export type IntegratorExecOutcome =
  | (Readonly<{ kind: "measured" }> & IntegratorMeasuredFacts)
  | Readonly<{ kind: "exec-failed"; reason: string }>;

function integratorPrompt(fixture: IntegratorFixture, expected: HandoffExpectation): string {
  return (
    "Delegate exactly one wave to the custom oso-integrator agent; never merge inline. Select agent_type " +
    `oso-integrator explicitly and launch it with fresh context by setting fork_turns="none" in the v2 spawn ` +
    "arguments beside a task_name; never use a full-history fork. " +
    `Main checkout: ${fixture.main}. BASE REF: ${fixture.baseCommit}. HANDOFF SLICE: ${expected.slice}. ` +
    `HANDOFF ATTEMPT: ${expected.attempt}. The complete wave has one slice, in this order: BRANCH ${SMOKE_BRANCH}, ` +
    `WORKTREE PATH ${fixture.worktree}. Require the integrator to begin its final message with exactly: ` +
    `oso-handoff: v=1 slice=${expected.slice} attempt=${expected.attempt}. Retain the spawned agent id, wait for ` +
    `the report, then run exactly oso-state handoff wait --slice ${expected.slice} --attempt ${expected.attempt} ` +
    `--agent-id <agent-id> --agent-type ${expected.agentType} --timeout 10 and exactly once oso-state handoff ` +
    `consume --slice ${expected.slice} --attempt ${expected.attempt} --agent-id <agent-id> --agent-type ` +
    `${expected.agentType} from the main checkout. Do not quote or summarize the child report in your final response.`
  );
}

export function runIntegratorFixture(
  fixture: IntegratorFixture,
  environment: NodeJS.ProcessEnv,
  boundSeconds: number,
  expected: HandoffExpectation,
): IntegratorExecOutcome {
  const run = spawnSync(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "danger-full-access",
      "--color",
      "never",
      "--dangerously-bypass-hook-trust",
      "-C",
      fixture.main,
      "--add-dir",
      fixture.root,
      integratorPrompt(fixture, expected),
    ],
    { env: { ...environment, CODEX_HOME: fixture.codexHome }, encoding: "utf8", timeout: boundSeconds * 1000 },
  );
  if (run.error !== undefined) return { kind: "exec-failed", reason: `codex exec did not complete: ${collapsed(run.error.message)}` };
  if (run.signal !== null) return { kind: "exec-failed", reason: `codex exec smoke did not answer within ${boundSeconds}s` };
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status !== 0) return { kind: "exec-failed", reason: `codex exec exited ${run.status}: ${collapsed(output)}` };

  return {
    kind: "measured",
    handoffConsumed: integratorHandoffConsumed(output, expected),
    integratedFileMatches: integratedFileHasExpectedLine(fixture.main),
    sliceIsAncestor: gitOutput(fixture.main, ["merge-base", "--is-ancestor", fixture.sliceCommit, "HEAD"]).ok,
    branchGone: !gitOutput(fixture.main, ["show-ref", "--verify", "--quiet", `refs/heads/${SMOKE_BRANCH}`]).ok,
    worktreeGone: worktreeIsGone(fixture.main, fixture.worktree),
  };
}

function integratedFileHasExpectedLine(main: string): boolean {
  const target = path.join(main, "integrated.txt");
  if (!isReadableRegularFile(target)) return false;
  return readFileSync(target, "utf8").split("\n").includes(INTEGRATED_FILE_LINE);
}

function worktreeIsGone(main: string, worktree: string): boolean {
  const listed = gitOutput(main, ["worktree", "list", "--porcelain"]);
  return listed.ok && !listed.stdout.includes(worktree);
}

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
