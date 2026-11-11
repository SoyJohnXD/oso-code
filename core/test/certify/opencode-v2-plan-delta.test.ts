import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { sha256Hex } from "../../src/index.ts";
import { probeRootSessionId } from "./support/behavior-drive.ts";
import { CERTIFY_GUARD } from "./support/certify-guard.ts";
import {
  approvePlanBeforehand,
  armProject,
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  driveSequence,
  installAdapterBundle,
  notesOfKind,
  resolveV2Lane,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import { resolvedProbeOrThrow } from "./support/opencode-binary.ts";

const PLAN_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document.\n";
const REVISED_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document, revised.\n## Riesgos\nNone.\n";
const DELTA_OF_THE_REVISION = [
  "Plan delta: 1 changed, 1 added, 0 removed, 0 format-only, 0 unchanged, 0 moved.",
  "changed \"Repaso de cambios\"",
  "  - The whole phase-5 document.",
  "  + The whole phase-5 document, revised.",
  "added \"Riesgos\"",
  "  + ## Riesgos",
  "  + None.",
  "Dropped amendments: none.",
  "",
].join("\n");
const PLAN_APPROVAL_TOOL = "oso_plan_approve";
const ASKING_PROJECT_CONFIG = { "opencode.json": `${JSON.stringify({ permission: { [PLAN_APPROVAL_TOOL]: "ask" } })}\n` };

const { probe, laneCause, laneNotRun } = resolveV2Lane();

type StateFile = Readonly<{ name: string; text: string }>;

type PlanApprovalRun = Readonly<{ outcome: ScenarioOutcome; before: StateFile; after: StateFile; plans: readonly string[] }>;

function stateFileIn(files: Readonly<Record<string, string>>, project: string): StateFile {
  const name = Object.keys(files).find((candidate) => candidate.startsWith(probeRootSessionId(project)));
  if (name === undefined) throw new Error(`no state file for ${project} among ${Object.keys(files).join(", ")}`);
  return { name, text: files[name] ?? "" };
}

function stateFilesOnDisk(stateRoot: string): Record<string, string> {
  const names = readdirSync(stateRoot).filter((name) => name.endsWith(".state"));
  return Object.fromEntries(names.map((name) => [name, readFileSync(path.join(stateRoot, name), "utf8")]));
}

function stateFilesAfterEachCall(outcome: ScenarioOutcome): readonly Record<string, string>[] {
  const notes = notesOfKind(outcome, "execute.after").filter((candidate) => candidate["tool"] === PLAN_APPROVAL_TOOL);
  if (notes.length === 0) throw new Error(`no execute.after note for ${PLAN_APPROVAL_TOOL}: ${outcome.run.stderr}`);
  return notes.map((note) => note["state"] as Record<string, string>);
}

function stateFilesInRun(outcome: ScenarioOutcome): Record<string, string> {
  return stateFilesAfterEachCall(outcome).at(-1) ?? {};
}

function stateKeysOf(state: StateFile, keys: readonly string[]): readonly (string | undefined)[] {
  return keys.map((key) => state.text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]);
}

function approvalPromptsOf(outcome: ScenarioOutcome): readonly unknown[] {
  return notesOfKind(outcome, "permission.evaluate")
    .filter((note) => note["action"] === PLAN_APPROVAL_TOOL)
    .map((note) => note["resources"]);
}

describe("a re-presented plan on an isolated OpenCode 2 host takes two steps through the built adapter bundle, the test carrying the state between the two host processes one host process keeps in real use", () => {
  let fixture: SpikeFixture | undefined;
  const runs = new Map<string, PlanApprovalRun>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    const resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    installAdapterBundle(host);
    const stateRoot = path.join(host.sandbox.home, ".local", "state", "oso-code");
    const heldPlanProject = (name: string, committed: Readonly<Record<string, string>> = {}): string => {
      const project = host.sandbox.seedGitRepository(name, committed);
      approvePlanBeforehand(host, project, PLAN_DOCUMENT);
      return project;
    };
    const present = async (name: string, project: string): Promise<StateFile> => {
      const before = stateFileIn(stateFilesOnDisk(stateRoot), project);
      const outcome = await driveScenario(resolved, { ...host, project }, name, PLAN_APPROVAL_TOOL, { plan: REVISED_DOCUMENT });
      const after = stateFileIn(stateFilesInRun(outcome), project);
      const plans = readdirSync(path.join(stateRoot, "plans", path.basename(after.name, ".state"))).sort();
      runs.set(name, { outcome, before, after, plans });
      return after;
    };
    const presentInTwoProcesses = async (first: string, second: string, project: string): Promise<void> => {
      const presented = await present(first, project);
      writeFileSync(path.join(stateRoot, presented.name), presented.text, { mode: 0o600 });
      await present(second, project);
    };
    await presentInTwoProcesses("first", "second", heldPlanProject("supersede"));
    const sliced = heldPlanProject("slice");
    armProject(host, sliced, ["active_slice=2"]);
    await present("slice", sliced);
    await presentInTwoProcesses("refused-first", "refused-second", heldPlanProject("refused", ASKING_PROJECT_CONFIG));
    const oneTurn = heldPlanProject("one-turn");
    const beforeOneTurn = stateFileIn(stateFilesOnDisk(stateRoot), oneTurn);
    const twice = { toolName: PLAN_APPROVAL_TOOL, input: { plan: REVISED_DOCUMENT } };
    const oneTurnOutcome = await driveSequence(resolved, { ...host, project: oneTurn }, "one-turn", [twice, twice]);
    const afterOneTurn = stateFileIn(stateFilesInRun(oneTurnOutcome), oneTurn);
    const oneTurnPlans = readdirSync(path.join(stateRoot, "plans", path.basename(afterOneTurn.name, ".state"))).sort();
    runs.set("one-turn", { outcome: oneTurnOutcome, before: beforeOneTurn, after: afterOneTurn, plans: oneTurnPlans });
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  const runOf = (name: string): PlanApprovalRun => {
    const run = runs.get(name);
    if (run === undefined) throw new Error(`unreachable: scenario ${name} was expected to have run`);
    return run;
  };

  test("the first call with a changed plan returns the harness delta, raises no prompt and leaves the approved plan in force", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { outcome, after } = runOf("first");
    const result = outcome.toolResults.join("\n");
    assert.ok(result.endsWith(`\n\n${DELTA_OF_THE_REVISION}`), result);
    assert.match(result, /Relay the delta below to the operator VERBATIM[\s\S]*LATER turn/);
    assert.doesNotMatch(result, /The operator granted/);
    assert.deepEqual(approvalPromptsOf(outcome), []);
    assert.deepEqual(
      stateKeysOf(after, ["plan_approval", "plan_approval_digest", "plan_presented_digest", "plan_presented_base"]),
      ["approved", sha256Hex(PLAN_DOCUMENT), sha256Hex(REVISED_DOCUMENT), sha256Hex(PLAN_DOCUMENT)],
    );
  });

  test("the identical plan from a later turn raises one prompt bound to its digest and supersedes the held plan", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { outcome, after, plans } = runOf("second");
    const digest = sha256Hex(REVISED_DOCUMENT);
    assert.deepEqual(approvalPromptsOf(outcome), [[digest]]);
    assert.match(
      outcome.toolResults.join("\n"),
      new RegExp(`^The operator granted ${PLAN_APPROVAL_TOOL} for the plan document whose digest is ${digest},`
        + `[\\s\\S]*through the delta whose digest is ${sha256Hex(DELTA_OF_THE_REVISION)}\\. The new document superseded the previous plan`),
    );
    assert.deepEqual(stateKeysOf(after, ["plan_approval", "plan_approval_digest", "plan_revision"]), ["approved", digest, "1"]);
    assert.doesNotMatch(after.text, /^plan_presented_/m);
    for (const kept of [sha256Hex(PLAN_DOCUMENT), digest]) assert.ok(plans.includes(`approved-${kept}.md`), plans.join(", "));
  });

  test("an active slice refuses the first call with the state's message, raises no prompt and changes no state byte", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { outcome, before, after } = runOf("slice");
    assert.match(outcome.toolResults.join("\n"), /is refused while 2 is active/);
    assert.deepEqual(approvalPromptsOf(outcome), []);
    assert.deepEqual(after, before);
  });

  test("a supersede prompt the headless host refuses leaves the state exactly as the first call left it", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const first = runOf("refused-first");
    const second = runOf("refused-second");
    assert.deepEqual(approvalPromptsOf(second.outcome), [[sha256Hex(REVISED_DOCUMENT)]]);
    assert.match(second.outcome.toolResults.join("\n"), /cannot ask the user for permission, so the request was rejected/);
    assert.deepEqual(second.after, first.after);
    assert.deepEqual(
      stateKeysOf(second.after, ["plan_approval", "plan_approval_digest", "plan_presented_digest", "plan_presented_base"]),
      ["approved", sha256Hex(PLAN_DOCUMENT), sha256Hex(REVISED_DOCUMENT), sha256Hex(PLAN_DOCUMENT)],
    );
  });

  test("both calls inside one prompt get the delta and then a refusal as the same operator turn, with no prompt raised", CERTIFY_GUARD, (t) => {
    if (laneNotRun(t)) return;
    const { outcome, after, plans } = runOf("one-turn");
    const [delta = "", refusal = ""] = outcome.toolResults;
    assert.equal(outcome.toolResults.length, 2, outcome.toolResults.join("\n"));
    assert.ok(delta.endsWith(`\n\n${DELTA_OF_THE_REVISION}`), delta);
    assert.match(refusal, /same operator turn[\s\S]*operator's next message/);
    assert.deepEqual(approvalPromptsOf(outcome), []);
    const [afterTheFirstCall, afterTheSecondCall] = stateFilesAfterEachCall(outcome);
    assert.deepEqual(afterTheSecondCall, afterTheFirstCall);
    assert.deepEqual(
      stateKeysOf(after, ["plan_approval", "plan_approval_digest", "plan_presented_digest", "plan_presented_base"]),
      ["approved", sha256Hex(PLAN_DOCUMENT), sha256Hex(REVISED_DOCUMENT), sha256Hex(PLAN_DOCUMENT)],
    );
    assert.match(stateKeysOf(after, ["plan_presented_turn"])[0] ?? "", /^msg_/);
    assert.ok(!plans.includes(`approved-${sha256Hex(REVISED_DOCUMENT)}.md`), plans.join(", "));
  });
});
