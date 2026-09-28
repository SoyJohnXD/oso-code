import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, runPreToolUseGates, type GateRun } from "../../src/gates/dispatch.ts";
import type { GateDefinition } from "../../src/gates/preflight.ts";
import { PROD_DEPLOY_GATE } from "../../src/gates/proddeploy.ts";
import { gateErrorText } from "../../src/hosts/hook-run.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { renderHooksManifest } from "../../src/routes/render.ts";
import { gateRow, PRE_TOOL_USE_ROUTE } from "../../src/routes/routes.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

const SESSION = "test-session";
const RED_AND_RUNNING = `mode=plan\nactive_slice=none\nverify_green=false\nauto=running\nsession=${SESSION}\n`;
const RUNNING_AND_GREEN = `mode=plan\nverify_green=true\nauto=running\nsession=${SESSION}\n`;
const COMMIT_AND_DEPLOY = "git commit -m x && vercel --prod";
const A_DEPLOY = "vercel --prod";
const THE_JUDGE_BROKE = "the commit judge broke";

type ManifestGroup = Readonly<{ matcher?: string; hooks: readonly Readonly<{ args?: readonly string[] }>[] }>;

const EXACT_TOOL_LIST = /^[A-Za-z0-9_|]+$/;

function claudeCodeMatches(matcher: string | undefined, toolName: string): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (EXACT_TOOL_LIST.test(matcher)) return matcher.split("|").includes(toolName);
  return new RegExp(matcher).test(toolName);
}

function preToolUseGroups(): readonly ManifestGroup[] {
  const document = JSON.parse(renderHooksManifest("claude")) as { hooks: Record<string, ManifestGroup[]> };
  return document.hooks["PreToolUse"] ?? [];
}

function handlersSpawnedFor(toolName: string): number {
  return preToolUseGroups()
    .filter((group) => claudeCodeMatches(group.matcher, toolName))
    .reduce((count, group) => count + group.hooks.length, 0);
}

function bashPayload(command: string): string {
  return JSON.stringify({
    session_id: SESSION,
    cwd: "{cwd}",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

type EnvelopeRunning = (command: string) => ReturnType<typeof spawnedEnvelope>;

function judgedInSandbox(state: string, judge: (envelopeRunning: EnvelopeRunning) => GateRun): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({ [STATE_FILE]: state });
    return withHookEnvironment({ HOME: sandbox.home }, () =>
      judge((command) => spawnedEnvelope(sandbox.expandJson(bashPayload(command)), process.env)),
    );
  });
}

const THROWING_COMMIT_GATE: GateDefinition = {
  gate: "commit",
  errorSubject: "the commit gate",
  judge: () => {
    throw new Error(THE_JUDGE_BROKE);
  },
};

function recordingGate(): Readonly<{ gate: GateDefinition; calls: () => number }> {
  let calls = 0;
  return {
    gate: {
      gate: "edits",
      errorSubject: "the edits gate",
      judge: () => {
        calls += 1;
        return { verdict: { kind: "allow" }, events: [{ event: "recording-gate-ran", session: SESSION }] };
      },
    },
    calls: () => calls,
  };
}

describe("one PreToolUse process per tool call on Claude", () => {
  test("the rendered Claude manifest carries exactly one PreToolUse handler", () => {
    const groups = preToolUseGroups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.hooks.length, 1);
    assert.deepEqual(groups[0]?.hooks[0]?.args?.at(-1), PRE_TOOL_USE_ROUTE);
  });

  for (const toolName of ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "mcp__fallow__fix_apply", "mcp__vercel__deploy"]) {
    test(`a ${toolName} call spawns exactly one node process`, () => {
      assert.equal(handlersSpawnedFor(toolName), 1);
    });
  }

  for (const toolName of ["Read", "TodoWrite", "Grep", "mcp__engram__mem_search"]) {
    test(`a ${toolName} call, which no gate matched before, still spawns nothing`, () => {
      assert.equal(handlersSpawnedFor(toolName), 0);
    });
  }
});

describe("the combined PreToolUse route evaluates every gate in its own guard", () => {
  test("a throwing commit judge still lets proddeploy deny", () => {
    const run = judgedInSandbox(RUNNING_AND_GREEN, (envelopeRunning) =>
      runPreToolUseGates([THROWING_COMMIT_GATE, PROD_DEPLOY_GATE], {
        envelope: envelopeRunning(A_DEPLOY),
        argv: [],
      }),
    );
    assert.equal(run.verdict.kind, "deny");
    assert.equal(run.exit, 0);
    assert.match(run.stdout, /"permissionDecision":"deny"/);
    assert.ok(run.stderr.includes(THE_JUDGE_BROKE), "the commit judge's failure was swallowed");
    assert.deepEqual(
      run.events.map((event) => event.gate),
      [gateRow("proddeploy").script],
    );
  });

  test("a throwing gate with no deny yields that gate's gateError and still runs the others", () => {
    const recording = recordingGate();
    const run = judgedInSandbox(RUNNING_AND_GREEN, (envelopeRunning) =>
      runPreToolUseGates([THROWING_COMMIT_GATE, recording.gate], { envelope: envelopeRunning("npm test"), argv: [] }),
    );
    const single = judgedInSandbox(RUNNING_AND_GREEN, (envelopeRunning) =>
      runPreToolUseGates([THROWING_COMMIT_GATE], { envelope: envelopeRunning("npm test"), argv: [] }),
    );
    assert.equal(recording.calls(), 1);
    assert.deepEqual(run.verdict, { kind: "gateError", subject: THROWING_COMMIT_GATE.errorSubject });
    assert.equal(run.exit, single.exit);
    assert.equal(run.stdout, single.stdout);
    assert.ok(run.stderr.startsWith(gateErrorText(THROWING_COMMIT_GATE.errorSubject)));
    assert.deepEqual(
      run.events.map((event) => event.event),
      ["recording-gate-ran"],
    );
  });

  test("a combined Bash call returns the first deny and keeps every gate's own events and labels", () => {
    const perGate = judgedInSandbox(RED_AND_RUNNING, (envelopeRunning) => {
      const envelope = envelopeRunning(COMMIT_AND_DEPLOY);
      const commit = runGate(["commit"], envelope);
      const proddeploy = runGate(["proddeploy"], envelope);
      return { ...commit, events: [...commit.events, ...proddeploy.events] };
    });
    const combined = judgedInSandbox(RED_AND_RUNNING, (envelopeRunning) =>
      runGate([PRE_TOOL_USE_ROUTE], envelopeRunning(COMMIT_AND_DEPLOY)),
    );
    assert.equal(combined.exit, perGate.exit);
    assert.equal(combined.stdout, perGate.stdout);
    assert.deepEqual(combined.verdict, perGate.verdict);
    assert.deepEqual(combined.events, perGate.events);
    assert.deepEqual(
      combined.events.map((event) => event.gate),
      [gateRow("commit").script, gateRow("proddeploy").script],
    );
  });

  test("an allowed Bash call through the combined route says nothing", () => {
    const run = judgedInSandbox(RUNNING_AND_GREEN, (envelopeRunning) =>
      runGate([PRE_TOOL_USE_ROUTE], envelopeRunning("npm test")),
    );
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, verdict: run.verdict }, {
      exit: 0,
      stdout: "",
      verdict: { kind: "allow" },
    });
  });
});
