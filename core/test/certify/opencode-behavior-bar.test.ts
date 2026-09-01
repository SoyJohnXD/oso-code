import assert from "node:assert/strict";
import { after, before, describe, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { fixtureShimsIn } from "../../src/install/verify-opencode.ts";
import { provedSomething } from "../support/proved.ts";
import {
  armProbeState,
  BEHAVIOR_BAR_LOAD_BOUND_SECONDS,
  chooseSessionModel,
  probeRepositoryCommitCount,
  probeStateArmedCheck,
  runProbeSession,
  runSessionWithPrompt,
  sessionOutcomeDescription,
  type SessionModelChoice,
  type SessionRun,
} from "./support/behavior-drive.ts";
import { CERTIFY } from "./support/certify-guard.ts";
import { installContractFixture, type ContractFixture } from "./support/contract-fixture.ts";
import {
  DEPLOY_CLI_NAME,
  DEPLOY_PRODUCTION_FLAG,
  deployCliMarkerIn,
  deployCliReached,
  deployCliShadowedByFixture,
  installDeployCliShim,
  type DeployCliShadow,
} from "./support/deploy-shim.ts";
import { gatedCallReport, type GatedCallReport } from "./support/gated-call.ts";
import { notRun } from "./support/not-run.ts";
import { laneCauseFor, laneNotRun, resolveOpenCodeBinaryProbe, type OpenCodeBinaryProbe } from "./support/opencode-binary.ts";
import {
  countHostPluginLoadErrors,
  pluginEntryPathIn,
  readPluginEntry,
  writePluginEntry,
  PLUGIN_ENTRY_THAT_REGISTERS_NOTHING,
  PLUGIN_ENTRY_WITHOUT_A_FUNCTION_EXPORT,
} from "./support/plugin-entry.ts";
import { BEHAVIOR_BAR_ROWS_PORTED, behaviorBarRow, behaviorBarRowsRegistered } from "./support/row-count.ts";
import { approvalPromptOutcome, approvalToolAttempted, approvedPlanArtifacts, sameTurnDeliveryOrder } from "./support/session-transcript.ts";

const OVERRIDE_ENV_VAR = "OSO_BEHAVIOR_BAR_OPENCODE_BIN";
const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
const PLAN_APPROVAL_DOCUMENT = "# Repaso de cambios -- one slice, verified by the behavior bar.";
const APPROVAL_PROMPT = `Call the ${PLAN_APPROVAL_TOOL_ID} tool exactly once with plan set to: ${PLAN_APPROVAL_DOCUMENT}    Then reply with status: done`;
const SAME_TURN_DELIVERY_PROMPT =
  "Reply in ONE turn with two things in this order. First write exactly this line as plain text: milestone: the delivery probe is under way    " +
  "Then, in that same turn, use the bash tool to run exactly this command: echo the delivery probe reached the shell    Then reply with status: done";
const GATED_COMMAND_VERB = "git commit";
const GATED_COMMAND_VERB_WORDS = GATED_COMMAND_VERB.split(" ");
const GATED_COMMAND = `${GATED_COMMAND_VERB} --allow-empty -m probe`;
const COMMIT_GATE_DENY_MARKER = "the session verify is not green";
const DEPLOY_COMMAND = `${DEPLOY_CLI_NAME} ${DEPLOY_PRODUCTION_FLAG}`;
const DEPLOY_COMMAND_WORDS = DEPLOY_COMMAND.split(" ");
const PRODUCTION_BOUNDARY_DENY_MARKER = "a production deploy stays with the operator";

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
  let missingExportLoadErrorCount: number | undefined;
  let gateArmFailureReason: string | undefined;
  let gateSession: SessionRun | undefined;
  let gateSessionReport: GatedCallReport | undefined;
  let commitCountAfterGateSession: string | undefined;
  let deployCliMarker: string | undefined;
  let deployCliResolution: DeployCliShadow | undefined;
  let deployArmFailureReason: string | undefined;
  let deploySession: SessionRun | undefined;
  let deploySessionReport: GatedCallReport | undefined;
  let registersNothingLoadErrorCount: number | undefined;
  let registersNothingArmFailureReason: string | undefined;
  let registersNothingSession: SessionRun | undefined;
  let registersNothingSessionReport: GatedCallReport | undefined;
  let commitCountAfterRegistersNothingSession: string | undefined;

  before(async () => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    fixture = installContractFixture(probe);
    if (fixture.exitCode !== 0) return;

    const pluginEntry = pluginEntryPathIn(fixture);
    const installedPluginEntry = readPluginEntry(pluginEntry);

    try {
      writePluginEntry(pluginEntry, PLUGIN_ENTRY_WITHOUT_A_FUNCTION_EXPORT);
      missingExportLoadErrorCount = countHostPluginLoadErrors(probe.binary, fixture.environment, BEHAVIOR_BAR_LOAD_BOUND_SECONDS);
    } finally {
      writePluginEntry(pluginEntry, installedPluginEntry);
    }

    try {
      probeRepository = fixture.sandbox.seedGitRepository("repo");
      armProbeState(fixture, probeRepository);
    } catch (error) {
      probeArmFailureReason = `the probe repository could not be created and armed: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    modelChoice = chooseSessionModel(probe.binary, fixture.environment);
    if (modelChoice.kind !== "chosen") return;
    const model = modelChoice.model;

    const gateArmed = probeStateArmedCheck(fixture, probeRepository);
    if (gateArmed.kind === "armed") {
      gateSession = runProbeSession(probe.binary, fixture.environment, probeRepository, model, GATED_COMMAND);
      gateSessionReport = gatedCallReport(gateSession.stdout, COMMIT_GATE_DENY_MARKER, GATED_COMMAND_VERB_WORDS);
      commitCountAfterGateSession = probeRepositoryCommitCount(probeRepository);
    } else {
      gateArmFailureReason = gateArmed.reason;
    }

    const shimsDirectory = fixtureShimsIn(fixture.sandbox.root);
    const marker = deployCliMarkerIn(fixture.sandbox.root);
    deployCliMarker = marker;
    installDeployCliShim(shimsDirectory, marker);
    deployCliResolution = deployCliShadowedByFixture(fixture.environment, shimsDirectory);
    if (deployCliResolution.kind === "shadowed") {
      try {
        armProbeState(fixture, probeRepository);
        const deployArmed = probeStateArmedCheck(fixture, probeRepository);
        if (deployArmed.kind === "armed") {
          deploySession = runProbeSession(probe.binary, fixture.environment, probeRepository, model, DEPLOY_COMMAND);
          deploySessionReport = gatedCallReport(deploySession.stdout, PRODUCTION_BOUNDARY_DENY_MARKER, DEPLOY_COMMAND_WORDS);
        } else {
          deployArmFailureReason = deployArmed.reason;
        }
      } catch (error) {
        deployArmFailureReason =
          `the probe repository could not be re-armed for the production-boundary session: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    approvalSession = runSessionWithPrompt(probe.binary, fixture.environment, probeRepository, model, APPROVAL_PROMPT);
    sameTurnSession = runSessionWithPrompt(
      probe.binary,
      fixture.environment,
      probeRepository,
      model,
      SAME_TURN_DELIVERY_PROMPT,
    );

    try {
      writePluginEntry(pluginEntry, PLUGIN_ENTRY_THAT_REGISTERS_NOTHING);
      registersNothingLoadErrorCount = countHostPluginLoadErrors(probe.binary, fixture.environment, BEHAVIOR_BAR_LOAD_BOUND_SECONDS);
      try {
        armProbeState(fixture, probeRepository);
        const registersNothingArmed = probeStateArmedCheck(fixture, probeRepository);
        if (registersNothingArmed.kind === "armed") {
          registersNothingSession = runProbeSession(probe.binary, fixture.environment, probeRepository, model, GATED_COMMAND);
          registersNothingSessionReport = gatedCallReport(registersNothingSession.stdout, COMMIT_GATE_DENY_MARKER, GATED_COMMAND_VERB_WORDS);
          commitCountAfterRegistersNothingSession = probeRepositoryCommitCount(probeRepository);
        } else {
          registersNothingArmFailureReason = registersNothingArmed.reason;
        }
      } catch (error) {
        registersNothingArmFailureReason =
          `the probe repository could not be re-armed for the inert-plugin session: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      writePluginEntry(pluginEntry, installedPluginEntry);
    }
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

  function missingExportLoadErrorCountOrThrow(): number {
    if (missingExportLoadErrorCount === undefined) throw new Error("unreachable: a missing-export host log count was expected");
    return missingExportLoadErrorCount;
  }

  function gateSessionOrThrow(): SessionRun {
    if (gateSession === undefined) throw new Error("unreachable: an armed commit-gate session run was expected");
    return gateSession;
  }

  function gateSessionReportOrThrow(): GatedCallReport {
    if (gateSessionReport === undefined) throw new Error("unreachable: an armed commit-gate session report was expected");
    return gateSessionReport;
  }

  function deploySessionOrThrow(): SessionRun {
    if (deploySession === undefined) throw new Error("unreachable: an armed production-boundary session run was expected");
    return deploySession;
  }

  function deploySessionReportOrThrow(): GatedCallReport {
    if (deploySessionReport === undefined) throw new Error("unreachable: an armed production-boundary session report was expected");
    return deploySessionReport;
  }

  function registersNothingSessionOrThrow(): SessionRun {
    if (registersNothingSession === undefined) throw new Error("unreachable: an inert-plugin session run was expected");
    return registersNothingSession;
  }

  function registersNothingSessionReportOrThrow(): GatedCallReport {
    if (registersNothingSessionReport === undefined) throw new Error("unreachable: an inert-plugin session report was expected");
    return registersNothingSessionReport;
  }

  function registersNothingLoadErrorCountOrThrow(): number {
    if (registersNothingLoadErrorCount === undefined) throw new Error("unreachable: an inert-plugin host log count was expected");
    return registersNothingLoadErrorCount;
  }

  function deployCliMarkerOrThrow(): string {
    if (deployCliMarker === undefined) throw new Error("unreachable: a deploy-CLI marker path was expected");
    return deployCliMarker;
  }

  function commitCountAfterGateSessionOrThrow(): string {
    if (commitCountAfterGateSession === undefined) throw new Error("unreachable: a post-gate-session commit count was expected");
    return commitCountAfterGateSession;
  }

  function commitCountAfterRegistersNothingSessionOrThrow(): string {
    if (commitCountAfterRegistersNothingSession === undefined) {
      throw new Error("unreachable: a post-inert-plugin-session commit count was expected");
    }
    return commitCountAfterRegistersNothingSession;
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

  function notRunUnlessGateSessionReady(t: TestContext): string | undefined {
    const model = notRunUnlessSessionModelChosen(t, "the armed commit-gate session");
    if (model === undefined) return undefined;
    if (gateArmFailureReason !== undefined) {
      notRun(t, gateArmFailureReason);
      return undefined;
    }
    return model;
  }

  function notRunUnlessRegistersNothingSessionReady(t: TestContext): string | undefined {
    const model = notRunUnlessSessionModelChosen(t, "the inert-plugin session");
    if (model === undefined) return undefined;
    if (registersNothingArmFailureReason !== undefined) {
      notRun(t, registersNothingArmFailureReason);
      return undefined;
    }
    return model;
  }

  function notRunUnlessDeploySessionReady(t: TestContext): string | undefined {
    const model = notRunUnlessSessionModelChosen(t, "the armed production-boundary session");
    if (model === undefined) return undefined;
    if (deployCliResolution !== undefined && deployCliResolution.kind === "not-shadowed") {
      notRun(t, deployCliResolution.reason);
      return undefined;
    }
    if (deployArmFailureReason !== undefined) {
      notRun(t, deployArmFailureReason);
      return undefined;
    }
    return model;
  }

  function gatedCallWasNotAttempted(report: GatedCallReport): boolean {
    return report.outcome === "no-session" || report.outcome === "not-attempted" || report.outcome === "mentioned-only";
  }

  function residueReachReason(gatedVerb: string, gate: string, session: SessionRun, outcome: string): string {
    return (
      `the session reached ${gatedVerb} only in a form no shell lexer can decide, which ${gate} allows and logs ` +
      `as a residue by design, so this run measured that known limitation rather than the boundary (${sessionOutcomeDescription(session)}, ${outcome})`
    );
  }

  function notRunUnlessGatedCallAttempted(
    t: TestContext,
    model: string,
    sessionLabel: string,
    session: SessionRun,
    report: GatedCallReport,
    gatedVerbPhrase: string,
  ): boolean {
    if (!gatedCallWasNotAttempted(report)) return false;
    notRun(
      t,
      `the ${sessionLabel} session drove no ${gatedVerbPhrase} tool call with ${model} (${sessionOutcomeDescription(session)}, ${report.outcome})`,
    );
    return true;
  }

  function notRunUnlessGateWasTested(
    t: TestContext,
    gate: string,
    model: string,
    sessionLabel: string,
    session: SessionRun,
    report: GatedCallReport,
    gatedVerbPhrase: string,
  ): boolean {
    if (notRunUnlessGatedCallAttempted(t, model, sessionLabel, session, report, gatedVerbPhrase)) return true;
    if (report.reachForm === "residue") {
      notRun(t, residueReachReason(gatedVerbPhrase, gate, session, report.outcome));
      return true;
    }
    return false;
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

  behaviorBarRow("a plugin entry with no function export is named in the host log", (t) => {
    if (notRunUnlessFixtureReady(t, "the missing-export plugin-load check")) return;
    const count = missingExportLoadErrorCountOrThrow();
    assert.ok(count > 0, `expected the host log to name a "failed to load plugin" line for the missing-export entry, found ${count}`);
  });

  behaviorBarRow("the commit gate refuses the gated tool call in a real session", (t) => {
    const model = notRunUnlessGateSessionReady(t);
    if (model === undefined) return;
    const session = gateSessionOrThrow();
    const report = gateSessionReportOrThrow();
    if (notRunUnlessGateWasTested(t, "the commit gate", model, "armed commit-gate", session, report, GATED_COMMAND_VERB)) return;
    assert.equal(report.outcome, "refused");
  });

  behaviorBarRow("the refused commit never reached the probe repository", (t) => {
    const model = notRunUnlessGateSessionReady(t);
    if (model === undefined) return;
    const session = gateSessionOrThrow();
    const report = gateSessionReportOrThrow();
    if (notRunUnlessGateWasTested(t, "the commit gate", model, "armed commit-gate", session, report, GATED_COMMAND_VERB)) return;
    assert.equal(commitCountAfterGateSessionOrThrow(), "1");
  });

  behaviorBarRow("the production boundary refuses the deploy tool call in a real session", (t) => {
    const model = notRunUnlessDeploySessionReady(t);
    if (model === undefined) return;
    const session = deploySessionOrThrow();
    const report = deploySessionReportOrThrow();
    if (notRunUnlessGateWasTested(t, "the production boundary", model, "armed production-boundary", session, report, DEPLOY_COMMAND)) return;
    assert.equal(report.outcome, "refused");
  });

  behaviorBarRow("the refused deploy never reached the deploy CLI", (t) => {
    const model = notRunUnlessDeploySessionReady(t);
    if (model === undefined) return;
    const session = deploySessionOrThrow();
    const report = deploySessionReportOrThrow();
    if (notRunUnlessGateWasTested(t, "the production boundary", model, "armed production-boundary", session, report, DEPLOY_COMMAND)) return;
    assert.equal(deployCliReached(deployCliMarkerOrThrow()), "untouched");
  });

  behaviorBarRow("a plugin that loads and registers nothing leaves the host log silent", (t) => {
    if (notRunUnlessFixtureReady(t, "the registers-nothing plugin-load check")) return;
    assert.equal(registersNothingLoadErrorCountOrThrow(), 0);
  });

  behaviorBarRow("the observable effect catches a plugin that loads and registers nothing", (t) => {
    const model = notRunUnlessRegistersNothingSessionReady(t);
    if (model === undefined) return;
    const session = registersNothingSessionOrThrow();
    const report = registersNothingSessionReportOrThrow();
    if (notRunUnlessGatedCallAttempted(t, model, "inert-plugin", session, report, GATED_COMMAND_VERB)) return;
    assert.equal(report.outcome, "executed");
  });

  behaviorBarRow("the unguarded commit reached the probe repository", (t) => {
    const model = notRunUnlessRegistersNothingSessionReady(t);
    if (model === undefined) return;
    const session = registersNothingSessionOrThrow();
    const report = registersNothingSessionReportOrThrow();
    if (notRunUnlessGatedCallAttempted(t, model, "inert-plugin", session, report, GATED_COMMAND_VERB)) return;
    assert.equal(commitCountAfterRegistersNothingSessionOrThrow(), "2");
  });
});

provedSomething(
  `at least ${BEHAVIOR_BAR_ROWS_PORTED} row(s) of tests/opencode-behavior-bar.sh were registered in this file`,
  behaviorBarRowsRegistered() >= BEHAVIOR_BAR_ROWS_PORTED,
  `only ${behaviorBarRowsRegistered()} row(s) were registered, under the ${BEHAVIOR_BAR_ROWS_PORTED} this slice ported`,
);
