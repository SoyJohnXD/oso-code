import assert from "node:assert/strict";
import { after, before, describe, type TestContext } from "node:test";
import { codexHostProbes } from "../../src/install/codex-host.ts";
import { isAboveTestedVersion, meetsVersionFloor, SUPPORTED_CODEX_VERSION } from "../../src/install/pins.ts";
import { provedSomething } from "../support/proved.ts";
import { CERTIFY, CERTIFY_SKIP_REASON } from "./support/certify-guard.ts";
import {
  codexLoginStatus,
  runIntegratorFixture,
  CODEX_EXEC_SMOKE_BOUND_SECONDS,
  CODEX_LOGIN_STATUS_BOUND_SECONDS,
  type IntegratorExecOutcome,
  type IntegratorMeasuredFacts,
} from "./support/codex-integrator-drive.ts";
import { notRun } from "./support/not-run.ts";
import { CODEX_SMOKE_ROWS_PORTED, codexSmokeRow, codexSmokeRowsRegistered } from "./support/row-count.ts";
import {
  buildIntegratorFixture,
  removeIntegratorFixtureRoot,
  SMOKE_HANDOFF_ATTEMPT,
  SMOKE_HANDOFF_SLICE,
  SMOKE_INTEGRATOR_AGENT_TYPE,
} from "./support/codex-smoke-fixture.ts";

const FULL_ACCESS_OPT_IN_VAR = "OSO_CERTIFY_ALLOW_CODEX_FULL_ACCESS_SMOKE";
const SKIP_SMOKE_VAR = "OSO_VERIFY_SKIP_SMOKE";
const HANDOFF_EXPECTATION = { slice: SMOKE_HANDOFF_SLICE, attempt: SMOKE_HANDOFF_ATTEMPT, agentType: SMOKE_INTEGRATOR_AGENT_TYPE };

type CodexPinRelation = "at-pin" | "above-pin" | "below-floor";

function codexPinRelation(version: string | undefined): CodexPinRelation {
  if (!meetsVersionFloor(version, SUPPORTED_CODEX_VERSION)) return "below-floor";
  return isAboveTestedVersion(version, SUPPORTED_CODEX_VERSION) ? "above-pin" : "at-pin";
}

const host = CERTIFY ? codexHostProbes(process.env) : undefined;

type LoginState =
  | Readonly<{ kind: "skipped" }>
  | Readonly<{ kind: "logged-in" }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

type OptInState = Readonly<{ kind: "granted" }> | Readonly<{ kind: "not-granted"; reason: string }>;

type DriveState = Readonly<{ kind: "not-attempted" }> | Readonly<{ kind: "build-failed"; setupResult: string }> | IntegratorExecOutcome;

codexSmokeRow(
  host === undefined
    ? "the Codex binary this smoke drives is the pinned one"
    : host.version === undefined
      ? "the Codex binary this smoke drives could not be resolved — codex is not on PATH"
      : `the Codex binary this smoke drives measures ${host.version} against the ${SUPPORTED_CODEX_VERSION} pin, relation ${codexPinRelation(host.version)}`,
  (t) => {
    if (!CERTIFY) {
      notRun(t, CERTIFY_SKIP_REASON);
      return;
    }
    if (host?.version === undefined) {
      notRun(t, "codex is not on PATH, so its version could not be measured against the pin");
      return;
    }
    const relation = codexPinRelation(host.version);
    if (relation === "below-floor") {
      notRun(
        t,
        `codex ${host.version} is below the ${SUPPORTED_CODEX_VERSION} floor oso install --host codex refuses, so this lane cannot certify what the product itself refuses to install`,
      );
      return;
    }
    assert.ok(relation === "at-pin" || relation === "above-pin");
  },
);

describe("the authenticated Codex integrator smoke ported from bootstrap/verify-codex.sh's run_authenticated_smoke", () => {
  let loginState: LoginState = { kind: "skipped" };
  let optInState: OptInState | undefined;
  let driveState: DriveState = { kind: "not-attempted" };
  let fixtureRoot: string | undefined;
  let cleanupRemoved: boolean | undefined;

  before(() => {
    if (!CERTIFY) return;
    if (process.env[SKIP_SMOKE_VAR] === "1") {
      loginState = { kind: "skipped" };
      return;
    }
    const login = codexLoginStatus(process.env, CODEX_LOGIN_STATUS_BOUND_SECONDS);
    if (!login.ok) {
      loginState = { kind: "unavailable", reason: login.output === "" ? "codex login status reported no output" : login.output };
      return;
    }
    loginState = { kind: "logged-in" };

    if (process.env[FULL_ACCESS_OPT_IN_VAR] !== "1") {
      optInState = {
        kind: "not-granted",
        reason:
          `${FULL_ACCESS_OPT_IN_VAR} is unset — this row spawns a Codex agent with --sandbox danger-full-access ` +
          "and --dangerously-bypass-hook-trust, authenticated with the operator's own credentials, and refuses " +
          "to run without that explicit opt-in",
      };
      return;
    }
    optInState = { kind: "granted" };

    const built = buildIntegratorFixture(process.env);
    fixtureRoot = built.kind === "ready" ? built.fixture.root : built.root;
    driveState =
      built.kind === "failed"
        ? { kind: "build-failed", setupResult: built.setupResult }
        : runIntegratorFixture(built.fixture, process.env, CODEX_EXEC_SMOKE_BOUND_SECONDS, HANDOFF_EXPECTATION);
    cleanupRemoved = removeIntegratorFixtureRoot(fixtureRoot);
  });

  after(() => {
    if (cleanupRemoved === undefined && fixtureRoot !== undefined) cleanupRemoved = removeIntegratorFixtureRoot(fixtureRoot);
  });

  function notRunUnlessAuthenticated(t: TestContext, gate: string): boolean {
    if (!CERTIFY) {
      notRun(t, CERTIFY_SKIP_REASON);
      return true;
    }
    if (loginState.kind === "skipped") {
      notRun(t, `${gate} — ${SKIP_SMOKE_VAR}=1, so the authenticated Codex smoke was not attempted`);
      return true;
    }
    if (loginState.kind === "unavailable") {
      notRun(t, `${gate} — authentication is unavailable (${loginState.reason})`);
      return true;
    }
    return false;
  }

  function notRunUnlessSmokeAttempted(t: TestContext, gate: string): boolean {
    if (notRunUnlessAuthenticated(t, gate)) return true;
    if (optInState === undefined || optInState.kind === "not-granted") {
      notRun(t, optInState?.reason ?? `${gate} — the opt-in gate was never resolved`);
      return true;
    }
    return false;
  }

  function measuredFactsOrFail(t: TestContext, gate: string): IntegratorMeasuredFacts | undefined {
    if (notRunUnlessSmokeAttempted(t, gate)) return undefined;
    if (driveState.kind === "measured") return driveState;
    if (driveState.kind === "build-failed") {
      assert.fail(`the integrator smoke fixture could not be built, so ${gate} could not be measured: ${driveState.setupResult}`);
    }
    if (driveState.kind === "exec-failed") {
      assert.fail(`the authenticated codex exec did not complete, so ${gate} could not be measured: ${driveState.reason}`);
    }
    throw new Error(`unreachable: ${gate} was gated open but never driven`);
  }

  codexSmokeRow("Codex authentication is a precondition the smoke reproduces before any exec is attempted", (t) => {
    if (notRunUnlessAuthenticated(t, "Codex authentication")) return;
    assert.equal(loginState.kind, "logged-in");
  });

  const measuredFactRows: readonly (readonly [string, string, (facts: IntegratorMeasuredFacts) => boolean])[] = [
    ["the spawned oso-integrator agent's handoff was consumed", "whether the handoff was consumed", (facts) => facts.handoffConsumed],
    [
      "the integrated file exists in the main checkout with the integrator's expected content",
      "the integrated file's content",
      (facts) => facts.integratedFileMatches,
    ],
    ["the slice commit is an ancestor of the main checkout's HEAD", "the ancestor check", (facts) => facts.sliceIsAncestor],
    ["the slice branch is gone from the main checkout", "the branch-gone check", (facts) => facts.branchGone],
    ["the slice worktree is gone from the main checkout", "the worktree-gone check", (facts) => facts.worktreeGone],
  ];

  for (const [name, gate, measured] of measuredFactRows) {
    codexSmokeRow(name, (t) => {
      const facts = measuredFactsOrFail(t, gate);
      if (facts !== undefined) assert.equal(measured(facts), true);
    });
  }

  codexSmokeRow(
    "the integrator smoke fixture's temporary tree is removed after the run, on both the success and the failure path",
    (t) => {
      if (notRunUnlessSmokeAttempted(t, "fixture cleanup")) return;
      assert.equal(cleanupRemoved, true);
    },
  );
});

provedSomething(
  `at least ${CODEX_SMOKE_ROWS_PORTED} row(s) of bootstrap/verify-codex.sh's run_authenticated_smoke were registered in this file`,
  codexSmokeRowsRegistered() >= CODEX_SMOKE_ROWS_PORTED,
  `only ${codexSmokeRowsRegistered()} row(s) were registered, under the ${CODEX_SMOKE_ROWS_PORTED} this slice ported`,
);
