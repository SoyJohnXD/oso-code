import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { sha256Hex } from "../../src/index.ts";
import { probeRootSessionId } from "./support/behavior-drive.ts";
import { CERTIFY_GUARD } from "./support/certify-guard.ts";
import {
  approvePlanBeforehand,
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  installAdapterBundle,
  notesOfKind,
  resolveV2Lane,
  scenarioOutcomeOf,
  type ScenarioOutcome,
  type SpikeFixture,
  type SpikeNote,
} from "./support/host-spike.ts";
import { resolvedProbeOrThrow } from "./support/opencode-binary.ts";
import { scriptedPrompt } from "./support/scripted-provider.ts";

const PLAN_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document.\n";
const OSO_TOOLS = ["oso_wave", "oso_plan_approve", "oso_plan_cancel"];
const CHILD_WORKING_DIRECTORY_CALL = scriptedPrompt("shell", { command: "pwd", description: "where am i" });
const CHILD_APPROVAL_CALL = scriptedPrompt("oso_plan_approve", { plan: PLAN_DOCUMENT });

const { probe, laneCause, laneNotRun } = resolveV2Lane();

function afterNoteOf(outcome: ScenarioOutcome, tool: string): SpikeNote {
  const note = notesOfKind(outcome, "execute.after").find((candidate) => candidate["tool"] === tool);
  if (note === undefined) throw new Error(`no execute.after note for ${tool}: ${outcome.run.stderr}`);
  return note;
}

function stateFilesAfter(outcome: ScenarioOutcome, tool: string): Record<string, string> {
  return afterNoteOf(outcome, tool)["state"] as Record<string, string>;
}

function stateFileOf(files: Record<string, string>, repository: string): string {
  const name = Object.keys(files).find((candidate) => candidate.startsWith(probeRootSessionId(repository)));
  return name === undefined ? "" : (files[name] ?? "");
}

describe("the built OpenCode adapter bundle's tools are callable directly on an isolated OpenCode 2 host", () => {
  let fixture: SpikeFixture | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();
  const projects = new Map<string, string>();
  let worktree = "";

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    const resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    installAdapterBundle(host);
    const seed = (name: string): string => {
      const project = host.sandbox.seedGitRepository(name);
      projects.set(name, project);
      return project;
    };
    const drive = async (name: string, project: string, tool: string, input: Record<string, unknown>): Promise<void> => {
      outcomes.set(name, await driveScenario(resolved, { ...host, project }, name, tool, input));
    };
    await drive("approve", seed("approve"), "oso_plan_approve", { plan: PLAN_DOCUMENT });
    const cancelled = seed("cancel");
    approvePlanBeforehand(host, cancelled, PLAN_DOCUMENT);
    await drive("cancel", cancelled, "oso_plan_cancel", {});
    const waved = seed("wave");
    worktree = host.sandbox.seedWaveWorktree(waved, probeRootSessionId(waved));
    await drive("wave", waved, "oso_wave", { children: [{ worktree, agent: "applier", prompt: CHILD_WORKING_DIRECTORY_CALL }] });
    const setupRepository = seed("setup-repository");
    await drive("foreign", setupRepository, "spike_foreign_session", { directory: seed("session-repository"), text: CHILD_APPROVAL_CALL });
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  const outcomeOf = (name: string): ScenarioOutcome => scenarioOutcomeOf(outcomes, name);

  test("every oso tool is offered to the model under its bare name, not hidden behind the execute tool", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const offered = outcomeOf("approve").offeredTools;
    for (const tool of OSO_TOOLS) assert.ok(offered.includes(tool), `${tool} missing from ${offered.join(", ")}`);
  });

  test("plan approve raises permission.assert for its own action on the digest, and the approval is on the state once it returns", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const approve = outcomeOf("approve");
    const [asked] = notesOfKind(approve, "permission.evaluate");
    assert.equal(asked?.["action"], "oso_plan_approve");
    assert.deepEqual(asked?.["resources"], [sha256Hex(PLAN_DOCUMENT)]);
    assert.match(approve.toolResults.join("\n"), /The operator granted oso_plan_approve/);
    assert.match(stateFileOf(stateFilesAfter(approve, "oso_plan_approve"), projects.get("approve") ?? ""), /^plan_approval=approved$/m);
  });

  test("plan cancel raises permission.assert for its own action, and the state reads cancelled once it returns", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const cancel = outcomeOf("cancel");
    const [asked] = notesOfKind(cancel, "permission.evaluate");
    assert.equal(asked?.["action"], "oso_plan_cancel");
    assert.match(cancel.toolResults.join("\n"), /The operator granted oso_plan_cancel/);
    assert.match(stateFileOf(stateFilesAfter(cancel, "oso_plan_cancel"), projects.get("cancel") ?? ""), /^plan_approval=cancelled$/m);
  });

  test("oso_wave pins its child session to the worktree, the child works there, and its reply comes back in band", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const wave = outcomeOf("wave");
    assert.equal(wave.toolResults.join("\n"), `=== ${worktree} (applier) — no verdict line ===\nfinished`);
    const childShell = notesOfKind(wave, "execute.after").find((note) => note["tool"] === "shell");
    assert.ok(JSON.stringify(childShell?.["result"]).includes(worktree), JSON.stringify(childShell));
  });

  test("a tool called in a session of another directory acts on that session's directory and leaves the process directory's state alone", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const foreign = outcomeOf("foreign");
    const files = stateFilesAfter(foreign, "oso_plan_approve");
    assert.match(stateFileOf(files, projects.get("session-repository") ?? ""), /^plan_approval=approved$/m);
    assert.equal(stateFileOf(files, projects.get("setup-repository") ?? ""), "");
  });
});
