import assert from "node:assert/strict";
import { after, before, describe, test, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { CERTIFY, CERTIFY_GUARD } from "./support/certify-guard.ts";
import { CONTRACT_BAR_BOUND_SECONDS } from "./support/drive.ts";
import {
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  notesOfKind,
  v2LaneCause,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import {
  laneNotRun,
  resolveOpenCodeBinaryProbe,
  resolvedProbeOrThrow,
  type OpenCodeBinaryProbe,
  type ResolvedProbe,
} from "./support/opencode-binary.ts";
import { pluginLoadProofOf } from "../../src/install/opencode-load-proof.ts";
import { runLoadProbe } from "./support/plugin-load-proof.ts";

const OVERRIDE_ENV_VAR = "OSO_V2_HOST_SPIKE_OPENCODE_BIN";
const SPIKE_PLUGIN_FILE = "oso-spike.js";
const VETO_REASON = "VETO-REASON";
const DENY_REASON = "DENY-REASON";
const CONSECUTIVE_LOAD_PROBES = 3;

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = v2LaneCause(probe);

describe("an OpenCode 2 host driven through a spike plugin in a fully isolated fixture", () => {
  let fixture: SpikeFixture | undefined;
  let resolved: ResolvedProbe | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    resolved = resolvedProbeOrThrow(probe);
    fixture = await createSpikeFixture();
    const drive = async (name: string, tool: string, input: Readonly<Record<string, unknown>>): Promise<void> => {
      outcomes.set(name, await driveScenario(resolved as ResolvedProbe, fixture as SpikeFixture, name, tool, input));
    };
    await drive("echo", "spike_echo", { text: "hello" });
    await drive("veto", "spike_echo", { text: "veto" });
    await drive("mutate", "spike_echo", { text: "mutate" });
    await drive("assert", "spike_echo", { text: "assert" });
    await drive("shell-allowed", "shell", { command: "echo ENV=$SPIKE_ENV", description: "probe" });
    await drive("shell-denied", "shell", { command: "touch SIDE_EFFECT; echo DENYME", description: "probe" });
    await drive("child", "subagent", {
      agent: "general",
      description: "child work",
      prompt: `SCRIPT spike_echo ${JSON.stringify({ text: "child" })}`,
    });
    await drive("interrupt", "spike_interrupt", {});
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  function lane(t: TestContext): boolean {
    return laneNotRun(t, probe, laneCause);
  }

  function outcomeOf(name: string): ScenarioOutcome {
    const outcome = outcomes.get(name);
    if (outcome === undefined) throw new Error(`unreachable: scenario ${name} was expected to have run`);
    return outcome;
  }

  function fixtureOrThrow(): SpikeFixture {
    if (fixture === undefined) throw new Error("unreachable: a spike fixture was expected");
    return fixture;
  }

  test("a plain default-exported { id, setup } object loads: positive loading evidence, zero failed-to-load lines", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const binary = resolvedProbeOrThrow(probe);
    const run = runLoadProbe(binary.binary, fixtureOrThrow().environment, fixtureOrThrow().project, CONTRACT_BAR_BOUND_SECONDS);
    assert.equal(run.status, 0, run.stderr);
    const proof = pluginLoadProofOf(run.stderr, SPIKE_PLUGIN_FILE);
    assert.equal(proof.loadedLines.length, 1, run.stderr);
    assert.deepEqual(proof.failedLines, []);
  });

  test("debug agents logs the plugin loading line on every one of three consecutive runs", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const binary = resolvedProbeOrThrow(probe);
    for (let attempt = 0; attempt < CONSECUTIVE_LOAD_PROBES; attempt += 1) {
      const run = runLoadProbe(binary.binary, fixtureOrThrow().environment, fixtureOrThrow().project, CONTRACT_BAR_BOUND_SECONDS);
      assert.equal(pluginLoadProofOf(run.stderr, SPIKE_PLUGIN_FILE).loadedLines.length, 1, `attempt ${attempt}: ${run.stderr}`);
    }
  });

  test("a v1-shaped plugin entry is rejected by the host with a failed-to-load line", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const binary = resolvedProbeOrThrow(probe);
    const rejected = fixtureOrThrow().writeExtraPlugin("v1-shaped.js", "export const osoCode = async () => ({ hooks: {} });\n");
    try {
      const run = runLoadProbe(binary.binary, fixtureOrThrow().environment, fixtureOrThrow().project, CONTRACT_BAR_BOUND_SECONDS);
      const proof = pluginLoadProofOf(run.stderr, SPIKE_PLUGIN_FILE);
      assert.equal(proof.failedLines.length, 1, run.stderr);
      assert.ok(proof.failedLines[0]?.includes("v1-shaped.js"));
      assert.equal(proof.loadedLines.length, 1, run.stderr);
    } finally {
      rejected.remove();
    }
  });

  test("a throw inside tool.hook execute.before aborts the tool and the model receives the thrown message as the tool result", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const veto = outcomeOf("veto");
    assert.equal(notesOfKind(veto, "tool.execute").length, 0);
    assert.equal(notesOfKind(veto, "execute.before").length, 1);
    const [result] = veto.toolResults;
    assert.ok(result !== undefined);
    assert.deepEqual(JSON.parse(result), { error: { type: "unknown", message: VETO_REASON }, content: [] });
  });

  test("a mutation of input inside execute.before reaches the tool's execute", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const mutate = outcomeOf("mutate");
    const [executed] = notesOfKind(mutate, "tool.execute");
    assert.ok(executed !== undefined);
    assert.deepEqual(executed["input"], { text: "mutated" });
    assert.deepEqual(mutate.toolResults, ["echo:mutated"]);
  });

  test("permission.hook evaluate fires for a built-in tool whose rule resolves to allow, and effect deny with a message blocks it before any side effect", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const allowed = outcomeOf("shell-allowed");
    const [evaluated] = notesOfKind(allowed, "permission.evaluate");
    assert.ok(evaluated !== undefined);
    assert.equal(evaluated["action"], "shell");
    assert.equal(evaluated["effect"], "allow");
    assert.deepEqual(allowed.toolResults, ["ENV=from-hook\n"]);

    const denied = outcomeOf("shell-denied");
    const [refusal] = denied.toolResults;
    assert.ok(refusal !== undefined);
    assert.deepEqual(JSON.parse(refusal), { error: { type: "permission.rejected", message: DENY_REASON }, content: [] });
    assert.equal(denied.sideEffectExists("SIDE_EFFECT"), false);
    assert.deepEqual(notesOfKind(denied, "permission.evaluate")[0]?.["resources"], ["touch SIDE_EFFECT", "echo DENYME"]);
  });

  test("permission.hook evaluate does not fire for a plugin tool that never asks, and fires with the tool's own session when it calls permission.assert, without prompting", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.equal(notesOfKind(outcomeOf("echo"), "permission.evaluate").length, 0);
    const asserted = outcomeOf("assert");
    const [toolRun] = notesOfKind(asserted, "tool.execute");
    const [evaluated] = notesOfKind(asserted, "permission.evaluate");
    assert.ok(toolRun !== undefined && evaluated !== undefined);
    assert.equal(evaluated["sessionID"], toolRun["sessionID"]);
    assert.equal(evaluated["action"], "spike_assert");
    assert.equal(evaluated["effect"], "allow");
    assert.equal(notesOfKind(asserted, "assert.resolved").length, 1);
  });

  test("the setup cleanup runs once at process shutdown, after the session went idle, never per session", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const child = outcomeOf("child");
    assert.equal(notesOfKind(child, "cleanup").length, 1);
    const kinds = child.notes.map((note) => note.kind);
    assert.equal(kinds.at(-1), "cleanup");
    assert.ok(kinds.lastIndexOf("idle") < kinds.indexOf("cleanup"));
  });

  test("experimental.idle fires once per finished turn, for the child session as well, and not at all after an interrupt", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const echo = outcomeOf("echo");
    assert.equal(notesOfKind(echo, "idle").length, 1);

    const child = outcomeOf("child");
    const idleSessions = notesOfKind(child, "idle").map((note) => note["sessionID"]);
    assert.equal(idleSessions.length, 2);
    assert.equal(new Set(idleSessions).size, 2);
    const [childRun] = notesOfKind(child, "tool.execute");
    assert.ok(childRun !== undefined);
    assert.equal(idleSessions[0], childRun["sessionID"]);
    assert.equal((childRun["session"] as Record<string, unknown>)["parentID"], idleSessions[1]);

    assert.equal(notesOfKind(outcomeOf("interrupt"), "idle").length, 0);
  });

  test("ctx.event.subscribe delivers session.created but no session.idle event exists", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const child = outcomeOf("child");
    const eventTypes = notesOfKind(child, "event").map((note) => note["type"]);
    assert.ok(eventTypes.includes("session.created"));
    assert.ok(!eventTypes.includes("session.idle"));
  });

  test("a tool added through ctx.tool.transform is offered to the model under its bare id, and its ToolContext holds sessionID and agent but no directory", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const echo = outcomeOf("echo");
    assert.ok(echo.offeredTools.includes("spike_echo"));
    assert.ok(!echo.offeredTools.some((name) => name.includes("oso-spike") && name !== "spike_echo"));
    const [toolRun] = notesOfKind(echo, "tool.execute");
    assert.ok(toolRun !== undefined);
    assert.deepEqual(toolRun["toolContextKeys"], ["sessionID", "agent", "messageID", "id", "progress", "signal"]);
    assert.equal(toolRun["agent"], "build");
  });

  test("ctx.session.get({ sessionID }) yields the session directory that the ToolContext lacks", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const echo = outcomeOf("echo");
    const [toolRun] = notesOfKind(echo, "tool.execute");
    assert.ok(toolRun !== undefined);
    const session = toolRun["session"] as { location?: { directory?: string } };
    assert.equal(session.location?.directory, fixtureOrThrow().project);
  });

  test("a tool registered without options.codemode false is hidden behind the codemode execute tool and not offered directly", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const echo = outcomeOf("echo");
    assert.ok(echo.offeredTools.includes("execute"));
    assert.ok(!echo.offeredTools.includes("spike_hidden"));
  });

  test("ctx.session exposes interrupt and no abort; interrupting from inside a tool aborts the tool signal and ends the run", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const interrupt = outcomeOf("interrupt");
    const [setup] = notesOfKind(interrupt, "setup");
    assert.ok(setup !== undefined);
    const methods = setup["sessionMethods"] as readonly string[];
    assert.ok(methods.includes("interrupt"));
    assert.ok(!methods.includes("abort"));
    const [result] = notesOfKind(interrupt, "interrupt.result");
    assert.ok(result !== undefined);
    assert.deepEqual(result["result"], { interrupted: true });
    assert.equal(result["signalAborted"], true);
    assert.equal(interrupt.run.status, 1);
    assert.match(interrupt.run.stdout, /Tool execution interrupted/);
  });

  test("shell.hook create.before carries command, cwd, timeout, shell and env, and an env mutation reaches the spawned command", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const allowed = outcomeOf("shell-allowed");
    const [created] = notesOfKind(allowed, "shell.create.before");
    assert.ok(created !== undefined);
    assert.deepEqual([...(created["keys"] as string[])].sort(), ["command", "cwd", "env", "shell", "timeout"]);
    assert.equal(created["command"], "echo ENV=$SPIKE_ENV");
    assert.equal(created["cwd"], fixtureOrThrow().project);
    assert.deepEqual(allowed.toolResults, ["ENV=from-hook\n"]);
  });

  test("the subagent tool's execute.after payload carries its agent in input.agent and the report in result.output.output, with no model and no background flag", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const [launched] = notesOfKind(outcomeOf("child"), "execute.after").filter((note) => note["tool"] === "subagent");
    assert.ok(launched !== undefined);
    assert.equal(launched["status"], "completed");
    assert.equal((launched["input"] as Record<string, unknown>)["agent"], "general");
    const result = launched["result"] as { output: Record<string, unknown>; metadata: Record<string, unknown> };
    assert.deepEqual(Object.keys(result.output).sort(), ["output", "sessionID", "status"]);
    assert.equal(result.output["status"], "completed");
    assert.equal(result.output["output"], "finished");
    assert.deepEqual(Object.keys(result.metadata).sort(), ["sessionID", "status"]);
  });
});
