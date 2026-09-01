import assert from "node:assert/strict";
import { after, before, describe, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { provedSomething } from "../support/proved.ts";
import { CERTIFY } from "./support/certify-guard.ts";
import { installContractFixture, type ContractFixture } from "./support/contract-fixture.ts";
import { CONTRACT_BAR_BOUND_SECONDS, invokeContractBar, probeRegistrations, type RegistrationProbe } from "./support/drive.ts";
import { notRun } from "./support/not-run.ts";
import { resolveOpenCodeBinaryProbe, type OpenCodeBinaryProbe } from "./support/opencode-binary.ts";
import { CONTRACT_BAR_ROWS_PORTED, contractBarRow, contractBarRowsRegistered } from "./support/row-count.ts";

const OVERRIDE_ENV_VAR = "OSO_CONTRACT_BAR_OPENCODE_BIN";
const SESSION_MODEL_PROVIDER = "opencode";
const SESSION_MODEL_PROVIDER_LINE = /^opencode\//;
const WAVE_TOOL_ID = "oso_wave";
const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
const PLAN_CANCEL_TOOL_ID = "oso_plan_cancel";
const WORKSPACE_ADAPTER_TYPE = "oso-code";

type ResolvedProbe = Extract<OpenCodeBinaryProbe, { kind: "resolved" }>;

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

function laneCauseOf(resolved: ResolvedProbe): string | undefined {
  if (resolved.relation !== "below-floor") return undefined;
  return (
    `opencode ${resolved.version} at ${resolved.binary} is below the ${SUPPORTED_OPENCODE_VERSION} floor oso install --host ` +
    "opencode refuses, so this lane cannot certify what the product itself refuses to install"
  );
}

const laneCause = probe === undefined ? undefined : probe.kind === "unresolved" ? probe.reason : laneCauseOf(probe);

function laneNotRun(t: TestContext): boolean {
  if (probe === undefined) {
    notRun(t, "OSO_CERTIFY is unset, so this row was never driven");
    return true;
  }
  if (laneCause !== undefined) {
    notRun(t, laneCause);
    return true;
  }
  return false;
}

function resolvedProbeOrThrow(): ResolvedProbe {
  if (probe === undefined || probe.kind !== "resolved") throw new Error("unreachable: a resolved probe was expected");
  return probe;
}

contractBarRow(
  probe === undefined
    ? "the OpenCode binary this bar introspects is the pinned one"
    : probe.kind === "resolved"
      ? `the OpenCode binary this bar introspects measures ${probe.version} against the ${SUPPORTED_OPENCODE_VERSION} pin, relation ${probe.relation}`
      : `the OpenCode binary this bar introspects could not be resolved — ${probe.reason}`,
  (t) => {
    if (laneNotRun(t)) return;
    const resolved = resolvedProbeOrThrow();
    assert.ok(resolved.relation === "at-pin" || resolved.relation === "above-pin");
  },
);

describe("the contract fixture install and what the real binary reports once it is ready", () => {
  let fixture: ContractFixture | undefined;
  let registrations: RegistrationProbe | undefined;

  before(async () => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    fixture = installContractFixture(probe);
    if (fixture.exitCode !== 0) return;
    registrations = await probeRegistrations(probe.binary, fixture.environment, fixture.sandbox);
  });

  after(() => {
    fixture?.sandbox.dispose();
  });

  function readyFixtureOrThrow(): ContractFixture {
    if (fixture === undefined || fixture.exitCode !== 0) throw new Error("unreachable: a ready fixture was expected");
    return fixture;
  }

  function notRunUnlessFixtureReady(t: TestContext, gate: string): boolean {
    if (laneNotRun(t)) return true;
    if (fixture === undefined || fixture.exitCode !== 0) {
      notRun(t, `the contract fixture install failed, so ${gate} could not be driven`);
      return true;
    }
    return false;
  }

  function notRunUnlessRegistered(t: TestContext): RegistrationProbe | undefined {
    if (notRunUnlessFixtureReady(t, "the plugin registration")) return undefined;
    if (registrations === undefined || registrations.kind === "failed") {
      notRun(t, registrations?.kind === "failed" ? registrations.reason : "the live server could not be probed");
      return undefined;
    }
    return registrations;
  }

  contractBarRow("contract fixture install", (t) => {
    if (laneNotRun(t)) return;
    assert.equal(fixture?.exitCode, 0, fixture?.report ?? "the fixture was never installed");
  });

  contractBarRow(`the host catalog offers the ${SESSION_MODEL_PROVIDER} provider the session model comes from`, (t) => {
    if (notRunUnlessFixtureReady(t, "the model catalog")) return;
    const resolved = resolvedProbeOrThrow();
    const installed = readyFixtureOrThrow();
    const run = invokeContractBar(resolved.binary, installed.environment, ["models"], CONTRACT_BAR_BOUND_SECONDS);
    if (run.error !== undefined || run.signal !== null) {
      notRun(t, `opencode models did not complete: ${run.error?.message ?? run.signal}`);
      return;
    }
    assert.equal(run.status, 0, run.stderr ?? "");
    const offered = (run.stdout ?? "").split("\n").some((line) => SESSION_MODEL_PROVIDER_LINE.test(line));
    assert.ok(offered, `the host catalog did not offer an opencode/ model:\n${run.stdout ?? ""}`);
  });

  const toolRows = [
    ["wave", WAVE_TOOL_ID],
    ["plan-approval", PLAN_APPROVAL_TOOL_ID],
    ["plan-cancel", PLAN_CANCEL_TOOL_ID],
  ] as const;

  for (const [label, toolId] of toolRows) {
    contractBarRow(`the real binary registers the installed plugin's ${label} tool`, (t) => {
      const listed = notRunUnlessRegistered(t);
      if (listed === undefined || listed.kind !== "listed") return;
      assert.ok(listed.toolIds.includes(toolId), `${toolId} was not among: ${listed.toolIds.join(", ")}`);
    });
  }

  contractBarRow(`the real binary lists the installed plugin's ${WORKSPACE_ADAPTER_TYPE} workspace adapter`, (t) => {
    const listed = notRunUnlessRegistered(t);
    if (listed === undefined || listed.kind !== "listed") return;
    assert.ok(
      listed.workspaceAdapterTypes.includes(WORKSPACE_ADAPTER_TYPE),
      `${WORKSPACE_ADAPTER_TYPE} was not among: ${listed.workspaceAdapterTypes.join(", ")}`,
    );
  });
});

provedSomething(
  `at least ${CONTRACT_BAR_ROWS_PORTED} row(s) of tests/opencode-contract-bar.sh were registered in this file`,
  contractBarRowsRegistered() >= CONTRACT_BAR_ROWS_PORTED,
  `only ${contractBarRowsRegistered()} row(s) were registered, under the ${CONTRACT_BAR_ROWS_PORTED} this slice ported`,
);
