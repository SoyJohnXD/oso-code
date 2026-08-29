import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type OpenCodeRoute } from "@oso-code/core";
import {
  assertGateRoutesCompile,
  composeEnvelope,
  composeLifecycleEnvelope,
  matchesTool,
  routeForGate,
  routes,
  runAdvisoryGate,
  runToolGate,
  type ToolExecuteInput,
  type ToolExecuteOutput,
} from "./gates.ts";
import { publishIdentity } from "./identity.ts";
import { stateBinPath } from "./installed-tree.ts";
import { armStateUnder, underFixtureHome } from "../../test-support/state-fixture.ts";

const PRODUCTION_DEPLOY = "vercel --prod";
const A_GATE_CORE_DOES_NOT_KNOW = "frobnicate" as OpenCodeRoute["gate"];
const ARMED_SLICE_SESSION = "ses-armed";

interface Fixture {
  base: string;
  repo: string;
  home: string;
  owner: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "oso-gates-"));
  const repo = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(join(repo, ".git", "objects"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(home, { recursive: true });
  return { base, repo, home, owner: publishIdentity(repo).OSO_AGENT };
}

function inHome<T>(fixture: Fixture, run: () => T): T {
  return underFixtureHome(fixture.home, run);
}

function arm(fixture: Fixture, pairs: readonly string[]): void {
  armAs(fixture, fixture.owner, pairs);
}

function armAs(fixture: Fixture, owner: string, pairs: readonly string[]): void {
  armStateUnder(fixture.home, fixture.repo, owner, pairs);
}

function toolCall(tool: string, args: Record<string, unknown>): [ToolExecuteInput, ToolExecuteOutput] {
  return [{ tool, sessionID: "ses-tool", callID: "call-1" }, { args }];
}

function gateOf(gate: string): OpenCodeRoute {
  const route = routeForGate(routes, gate);
  assert.ok(route !== undefined, `no route names the ${gate} gate`);
  return route;
}

function judgeTool(fixture: Fixture, gate: string, tool: string, args: Record<string, unknown>): {
  kind: string;
  message: string;
} {
  const [input, output] = toolCall(tool, args);
  return inHome(fixture, () =>
    runToolGate(gateOf(gate), { ...input, cwd: fixture.repo }, output));
}

test("the route table the adapter runs is the one core derives, and every matcher in it compiles", () => {
  assert.ok(routes.length > 0, "the adapter was handed no routes at all");
  assert.doesNotThrow(() => assertGateRoutesCompile(routes));
  assert.throws(
    () => assertGateRoutesCompile([{ ...gateOf("commit"), matcher: "(unclosed" }]),
    /\(unclosed/,
  );
});

test("an unarmed repository lets a commit through", () => {
  const fixture = makeFixture();
  try {
    const verdict = judgeTool(fixture, "commit", "bash", { command: "git commit -m x" });
    assert.equal(verdict.kind, "allow");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a red slice denies the commit in-process, carrying the gate's own remedy", () => {
  const fixture = makeFixture();
  try {
    arm(fixture, ["mode=plan", "active_slice=4", "verify_green=false"]);
    const verdict = judgeTool(fixture, "commit", "bash", { command: "git commit -m x" });
    assert.equal(verdict.kind, "deny");
    assert.match(verdict.message, /oso-code/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("an armed unattended run denies a production deploy in-process", () => {
  const fixture = makeFixture();
  try {
    arm(fixture, ["auto=running", "auto_change=gate-probe"]);
    const verdict = judgeTool(fixture, "proddeploy", "bash", { command: PRODUCTION_DEPLOY });
    assert.equal(verdict.kind, "deny");
    assert.match(verdict.message, /a production deploy stays with the operator/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("an edit with no slice armed is denied and names the state write that arms one", () => {
  const fixture = makeFixture();
  try {
    arm(fixture, ["mode=plan", "active_slice=none", "verify_green=false"]);
    const verdict = judgeTool(fixture, "edits", "edit", { filePath: join(fixture.repo, "a.ts") });
    assert.equal(verdict.kind, "deny");
    assert.match(verdict.message, /oso-state/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the unknown-tool gate is handed its route's own allowlist, so a listed tool passes and a stranger does not", () => {
  const fixture = makeFixture();
  try {
    arm(fixture, ["mode=plan", "active_slice=4", "verify_green=false"]);
    assert.equal(judgeTool(fixture, "unknown", "bash", {}).kind, "allow");
    const stranger = judgeTool(fixture, "unknown", "frobnicate", {});
    assert.equal(stranger.kind, "deny");
    assert.match(stranger.message, /OpenCode hook allowlist/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a gate core cannot run blocks the call fail-closed, carrying the gate error core reports", () => {
  const fixture = makeFixture();
  try {
    const [input, output] = toolCall("bash", { command: "git commit -m x" });
    const verdict = inHome(fixture, () =>
      runToolGate({ ...gateOf("commit"), gate: A_GATE_CORE_DOES_NOT_KNOW }, { ...input, cwd: fixture.repo }, output));
    assert.equal(verdict.kind, "block");
    assert.match(verdict.message, /blocked this call instead of opening the gate/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("the stale advisory reaches the host as context, spelling this host's own skill prefix", () => {
  const fixture = makeFixture();
  try {
    armAs(fixture, "another-session", ["mode=plan", "active_slice=4", "verify_green=false"]);
    const outcome = inHome(fixture, () =>
      runAdvisoryGate(gateOf("stale"), { sessionID: "ses-other", directory: fixture.repo, moment: "startup" }));
    assert.equal(outcome.kind, "context");
    assert.match(outcome.kind === "context" ? outcome.text : "", /\/oso-plan/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("a repository with no state at all leaves the stale advisory silent", () => {
  const fixture = makeFixture();
  try {
    const outcome = inHome(fixture, () =>
      runAdvisoryGate(gateOf("stale"), { sessionID: "ses-other", directory: fixture.repo, moment: "startup" }));
    assert.equal(outcome.kind, "silent");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("teardown produces no advisory of its own", () => {
  const fixture = makeFixture();
  try {
    arm(fixture, ["mode=plan"]);
    const outcome = inHome(fixture, () =>
      runAdvisoryGate(gateOf("teardown"), { sessionID: ARMED_SLICE_SESSION, directory: fixture.repo, moment: "end" }));
    assert.equal(outcome.kind, "silent");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("envelope: the bash command line becomes the command the lexer reads", () => {
  const [input, output] = toolCall("bash", { script: "git commit -m x" });
  const envelope = composeEnvelope(input, output);
  assert.equal(envelope.commandLine, "git commit -m x");
  assert.equal(envelope.sessionId, "ses-tool");
  assert.equal(envelope.toolName, "bash");
});

test("envelope: a command-bearing tool without a script keeps its command", () => {
  const envelope = composeEnvelope(...toolCall("apply_patch", { command: "apply_patch x" }));
  assert.equal(envelope.commandLine, "apply_patch x");
});

test("envelope: filePath is the file the edits gate judges, and its absence is the empty name", () => {
  assert.equal(composeEnvelope(...toolCall("edit", { filePath: "/repo/src/a.ts" })).filePath, "/repo/src/a.ts");
  assert.equal(composeEnvelope(...toolCall("edit", {})).filePath, "");
});

test("envelope: cwd falls back to the process working directory", () => {
  const envelope = composeEnvelope({ tool: "bash" }, { args: {} });
  assert.equal(envelope.cwd, process.cwd());
});

test("envelope: the caller it carries names this host, its own root identity and the installed state binary", () => {
  const fixture = makeFixture();
  try {
    const [input, output] = toolCall("bash", {});
    const envelope = composeEnvelope({ ...input, cwd: fixture.repo }, output);
    assert.deepEqual(envelope.caller, {
      host: "opencode",
      agentSession: fixture.owner,
      stateBin: stateBinPath(),
    });
    assert.notEqual(envelope.caller.agentSession, envelope.sessionId);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("lifecycle envelope: the moment becomes the source every SessionStart gate reads, and end names none", () => {
  const startup = composeLifecycleEnvelope({ sessionID: "s", directory: process.cwd(), moment: "startup" });
  const compact = composeLifecycleEnvelope({ sessionID: "s", directory: process.cwd(), moment: "compact" });
  const end = composeLifecycleEnvelope({ sessionID: "s", directory: process.cwd(), moment: "end" });
  assert.deepEqual([startup.source, compact.source, end.source], ["startup", "compact", ""]);
});

test("matcher: an edits matcher applies to the native writers and nothing else", () => {
  const matcher = gateOf("edits").matcher;
  assert.equal(matchesTool(matcher, "edit"), true);
  assert.equal(matchesTool(matcher, "write"), true);
  assert.equal(matchesTool(matcher, "apply_patch"), true);
  assert.equal(matchesTool(matcher, "bash"), false);
  assert.equal(matchesTool(matcher, "read"), false);
});

test("matcher: a catch-all matcher applies to any tool", () => {
  assert.equal(matchesTool(gateOf("unknown").matcher, "anything_else"), true);
});

test("matcher: a matcher no regular expression compiles from is a broken route table, never an empty match set", () => {
  assert.throws(() => matchesTool("(unclosed", "bash"), /gate route table/);
});

test("the state binary the caller names is the operator's own when they publish one, and the plugin's sibling otherwise", () => {
  const published = join(tmpdir(), "published-oso-state");
  const previous = process.env.OSO_STATE_BIN;
  try {
    process.env.OSO_STATE_BIN = published;
    assert.equal(stateBinPath(), published);
    delete process.env.OSO_STATE_BIN;
    assert.equal(stateBinPath(), resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oso-state"));
  } finally {
    restoreEnv("OSO_STATE_BIN", previous);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
