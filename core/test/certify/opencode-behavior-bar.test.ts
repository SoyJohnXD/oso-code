import assert from "node:assert/strict";
import { after, before, describe, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { provedSomething } from "../support/proved.ts";
import {
  armProbeState,
  chooseSessionModel,
  runSessionWithPrompt,
  sessionOutcomeDescription,
  type SessionModelChoice,
  type SessionRun,
} from "./support/behavior-drive.ts";
import { CERTIFY } from "./support/certify-guard.ts";
import { installContractFixture, type ContractFixture } from "./support/contract-fixture.ts";
import { notRun } from "./support/not-run.ts";
import { laneCauseFor, laneNotRun, resolveOpenCodeBinaryProbe, type OpenCodeBinaryProbe } from "./support/opencode-binary.ts";
import { BEHAVIOR_BAR_ROWS_PORTED, behaviorBarRow, behaviorBarRowsRegistered } from "./support/row-count.ts";
import { approvalPromptOutcome, approvalToolAttempted, approvedPlanArtifacts, sameTurnDeliveryOrder } from "./support/session-transcript.ts";

const OVERRIDE_ENV_VAR = "OSO_BEHAVIOR_BAR_OPENCODE_BIN";
const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
const PLAN_APPROVAL_DOCUMENT = "# Repaso de cambios -- one slice, verified by the behavior bar.";
const APPROVAL_PROMPT = `Call the ${PLAN_APPROVAL_TOOL_ID} tool exactly once with plan set to: ${PLAN_APPROVAL_DOCUMENT}    Then reply with status: done`;
const SAME_TURN_DELIVERY_PROMPT =
  "Reply in ONE turn with two things in this order. First write exactly this line as plain text: milestone: the delivery probe is under way    " +
  "Then, in that same turn, use the bash tool to run exactly this command: echo the delivery probe reached the shell    Then reply with status: done";

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION);

describe("driving a real OpenCode session against the behavior-bar fixture", () => {
  let fixture: ContractFixture | undefined;
  let probeArmFailureReason: string | undefined;
  let probeRepository: string | undefined;
  let modelChoice: SessionModelChoice | undefined;
  let approvalSession: SessionRun | undefined;
  let sameTurnSession: SessionRun | undefined;

  before(async () => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    fixture = installContractFixture(probe);
    if (fixture.exitCode !== 0) return;
    try {
      probeRepository = fixture.sandbox.seedGitRepository("repo");
      armProbeState(fixture, probeRepository);
    } catch (error) {
      probeArmFailureReason = `the probe repository could not be created and armed: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    modelChoice = chooseSessionModel(probe.binary, fixture.environment);
    if (modelChoice.kind !== "chosen") return;
    approvalSession = runSessionWithPrompt(probe.binary, fixture.environment, probeRepository, modelChoice.model, APPROVAL_PROMPT);
    sameTurnSession = runSessionWithPrompt(
      probe.binary,
      fixture.environment,
      probeRepository,
      modelChoice.model,
      SAME_TURN_DELIVERY_PROMPT,
    );
  });

  after(() => {
    fixture?.sandbox.dispose();
  });

  function readyFixtureOrThrow(): ContractFixture {
    if (fixture === undefined || fixture.exitCode !== 0) throw new Error("unreachable: a ready fixture was expected");
    return fixture;
  }

  function approvalSessionOrThrow(): SessionRun {
    if (approvalSession === undefined) throw new Error("unreachable: an approval session run was expected");
    return approvalSession;
  }

  function sameTurnSessionOrThrow(): SessionRun {
    if (sameTurnSession === undefined) throw new Error("unreachable: a same-turn delivery session run was expected");
    return sameTurnSession;
  }

  function notRunUnlessFixtureReady(t: TestContext, gate: string): boolean {
    if (laneNotRun(t, probe, laneCause)) return true;
    if (fixture === undefined || fixture.exitCode !== 0) {
      notRun(t, `the behavior fixture install failed, so ${gate} could not be driven — ${fixture?.report ?? "the fixture was never installed"}`);
      return true;
    }
    return false;
  }

  function notRunUnlessSessionModelChosen(t: TestContext, gate: string): string | undefined {
    if (notRunUnlessFixtureReady(t, gate)) return undefined;
    if (probeArmFailureReason !== undefined) {
      notRun(t, probeArmFailureReason);
      return undefined;
    }
    if (modelChoice === undefined || modelChoice.kind !== "chosen") {
      notRun(t, modelChoice?.kind === "unresolved" ? modelChoice.reason : "the host catalog offered no free model to drive a session with");
      return undefined;
    }
    return modelChoice.model;
  }

  behaviorBarRow(`the host asks the operator to authorize ${PLAN_APPROVAL_TOOL_ID} in a real session`, (t) => {
    const model = notRunUnlessSessionModelChosen(t, `a ${PLAN_APPROVAL_TOOL_ID} session`);
    if (model === undefined) return;
    const session = approvalSessionOrThrow();
    if (!approvalToolAttempted(session.stdout, PLAN_APPROVAL_TOOL_ID)) {
      notRun(t, `the session drove no ${PLAN_APPROVAL_TOOL_ID} call with ${model} (${sessionOutcomeDescription(session)})`);
      return;
    }
    assert.equal(approvalPromptOutcome(session.stdout, session.stderr, PLAN_APPROVAL_TOOL_ID), "asked");
  });

  behaviorBarRow("a refused authorization leaves no approved plan behind", (t) => {
    const model = notRunUnlessSessionModelChosen(t, `a ${PLAN_APPROVAL_TOOL_ID} session`);
    if (model === undefined) return;
    const session = approvalSessionOrThrow();
    if (!approvalToolAttempted(session.stdout, PLAN_APPROVAL_TOOL_ID)) {
      notRun(t, `the session drove no ${PLAN_APPROVAL_TOOL_ID} call with ${model} (${sessionOutcomeDescription(session)})`);
      return;
    }
    assert.equal(approvedPlanArtifacts(readyFixtureOrThrow().sandbox.home), "none");
  });

  behaviorBarRow("text emitted before a same-turn tool call survives the host transcript", (t) => {
    const model = notRunUnlessSessionModelChosen(t, "the same-turn delivery session");
    if (model === undefined) return;
    const session = sameTurnSessionOrThrow();
    const order = sameTurnDeliveryOrder(session.stdout);
    if (order === "no-session" || order === "no-tool-call") {
      notRun(t, `the same-turn delivery session drove no tool call after its text with ${model} (${sessionOutcomeDescription(session)}, ${order})`);
      return;
    }
    assert.equal(order, "text-then-tool");
  });
});

provedSomething(
  `at least ${BEHAVIOR_BAR_ROWS_PORTED} row(s) of tests/opencode-behavior-bar.sh were registered in this file`,
  behaviorBarRowsRegistered() >= BEHAVIOR_BAR_ROWS_PORTED,
  `only ${behaviorBarRowsRegistered()} row(s) were registered, under the ${BEHAVIOR_BAR_ROWS_PORTED} this slice ported`,
);
