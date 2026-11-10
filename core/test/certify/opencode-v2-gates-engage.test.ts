import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { CERTIFY, CERTIFY_GUARD } from "./support/certify-guard.ts";
import { probeRepositoryCommitCount } from "./support/behavior-drive.ts";
import {
  armProject,
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  type DriveOptions,
  MCP_CODEMODE_SERVER_NAME,
  MCP_SERVER_NAME,
  notesOfKind,
  PATCH_TOOL_MODEL,
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

const OVERRIDE_ENV_VAR = "OSO_V2_HOST_SPIKE_OPENCODE_BIN";
const BUNDLE_FILE = "oso-code.js";
const REPOSITORY_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUNDLE_SOURCE = path.join(REPOSITORY_ROOT, "opencode", "dist", BUNDLE_FILE);
const COMMIT_COMMAND = "git commit --allow-empty -m probe";
const DEPLOY_COMMAND = "vercel --prod";
const SEEDED_FILE = "README.seed";
const RED_SLICE = ["mode=plan", "active_slice=4", "verify_green=false"];
const VETO_CODE = "try { return await tools.spike_hidden({ text: 'veto' }); } catch (error) { return 'caught:' + String(error && error.message); }";
const HARNESS_TARGET = (host: SpikeFixture, file = "probe.md"): string => path.join(host.sandbox.home, ".config", "opencode", "skill", file);
const PATCHED_HARNESS_FILE = "patched.md";

function addFilePatch(target: string): string {
  return `*** Begin Patch\n*** Add File: ${target}\n+x\n*** End Patch`;
}

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = v2LaneCause(probe);

function refusalOf(outcome: ScenarioOutcome): string {
  const [result] = outcome.toolResults;
  assert.ok(result !== undefined, outcome.run.stderr);
  try {
    return (JSON.parse(result) as { error?: { message?: string } }).error?.message ?? result;
  } catch {
    return result;
  }
}

describe("the built OpenCode adapter bundle's gates engage on an isolated OpenCode 2 host", () => {
  let fixture: SpikeFixture | undefined;
  let resolved: ResolvedProbe | undefined;
  const outcomes = new Map<string, ScenarioOutcome>();
  const commitCounts = new Map<string, readonly [string, string]>();
  const projects = new Map<string, string>();

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    resolved = resolvedProbeOrThrow(probe);
    const host = await createSpikeFixture();
    fixture = host;
    host.writeExtraPlugin(BUNDLE_FILE, readFileSync(BUNDLE_SOURCE, "utf8"));
    const drive = async (name: string, pairs: readonly string[], tool: string, input: Record<string, unknown>, options: DriveOptions = {}): Promise<void> => {
      const project = host.sandbox.seedGitRepository(name, { [SEEDED_FILE]: "seed\n" });
      projects.set(name, project);
      armProject(host, project, pairs);
      const before = probeRepositoryCommitCount(project);
      outcomes.set(name, await driveScenario(resolved as ResolvedProbe, { ...host, project }, name, tool, input, options));
      commitCounts.set(name, [before, probeRepositoryCommitCount(project)]);
    };
    const awaitingSlice = ["mode=plan"];
    await drive("red-commit", RED_SLICE, "shell", { command: COMMIT_COMMAND, description: "probe" });
    await drive("green-commit", ["mode=plan", "active_slice=4", "verify_green=true"], "shell", { command: COMMIT_COMMAND, description: "probe" });
    await drive("unknown-tool", awaitingSlice, `${MCP_SERVER_NAME}_ping`, {});
    await drive("known-tool", awaitingSlice, "shell", { command: "echo known", description: "probe" });
    await drive("write-unarmed", awaitingSlice, "write", { path: "created.txt", content: "x" });
    await drive("edit-unarmed", awaitingSlice, "edit", { path: SEEDED_FILE, oldString: "seed", newString: "edited" });
    await drive("harness-write", ["mode=quick"], "write", { path: HARNESS_TARGET(host), content: "x" });
    await drive("execute-shell", RED_SLICE, "execute", { code: `return await tools.shell({ command: "${COMMIT_COMMAND}", description: "probe" });` });
    await drive("execute-write", RED_SLICE, "execute", { code: "return await tools.write({ path: 'viaexec.txt', content: 'x' });" });
    await drive("execute-mcp", RED_SLICE, "execute", { code: `return await tools.${MCP_CODEMODE_SERVER_NAME}.ping({});` });
    await drive("execute-veto", RED_SLICE, "execute", { code: VETO_CODE });
    const patchModel = { model: PATCH_TOOL_MODEL };
    await drive("patch-offered", awaitingSlice, "spike_echo", { text: "offered" }, patchModel);
    await drive("patch-unarmed", awaitingSlice, "patch", { patchText: addFilePatch("created.txt") }, patchModel);
    await drive("patch-harness", ["mode=quick"], "patch", { patchText: addFilePatch(HARNESS_TARGET(host, PATCHED_HARNESS_FILE)) }, patchModel);
    await drive("patch-repository", ["mode=quick"], "patch", { patchText: addFilePatch("created.txt") }, patchModel);
    await drive("deploy", ["auto=running", "auto_change=gate-probe"], "shell", { command: DEPLOY_COMMAND, description: "probe" });
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

  function projectOf(name: string): string {
    const project = projects.get(name);
    if (project === undefined) throw new Error(`unreachable: scenario ${name} was expected to have a project`);
    return project;
  }

  test("a commit-shaped shell call is refused with the gate's reason while verify_green is false, and no commit happens", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.match(refusalOf(outcomeOf("red-commit")), /oso-code/);
    const [beforeCount, afterCount] = commitCounts.get("red-commit") ?? [];
    assert.equal(afterCount, beforeCount);
  });

  test("the same commit-shaped shell call passes once verify_green is true, and the commit happens", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const [beforeCount, afterCount] = commitCounts.get("green-commit") ?? [];
    assert.equal(Number(afterCount), Number(beforeCount) + 1, outcomeOf("green-commit").toolResults.join("\n"));
  });

  test("while a plan awaits its slice an unknown tool is refused with the arming message and a known v2 tool passes", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.match(refusalOf(outcomeOf("unknown-tool")), /plan mode is active but no slice is active/);
    assert.deepEqual(outcomeOf("known-tool").toolResults, ["known\n"]);
  });

  test("while a plan awaits its slice, edits through write and edit are refused and change nothing", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.match(refusalOf(outcomeOf("write-unarmed")), /oso-code/);
    assert.equal(existsSync(path.join(projectOf("write-unarmed"), "created.txt")), false);
    assert.match(refusalOf(outcomeOf("edit-unarmed")), /oso-code/);
    assert.equal(readFileSync(path.join(projectOf("edit-unarmed"), SEEDED_FILE), "utf8"), "seed\n");
  });

  test("a write into the installed harness tree is refused naming the tree, and creates nothing", CERTIFY_GUARD, (t) => {
    if (lane(t) || fixture === undefined) return;
    assert.match(refusalOf(outcomeOf("harness-write")), /installed oso-code harness tree/);
    assert.equal(existsSync(HARNESS_TARGET(fixture)), false);
  });

  test("a gpt-* model is offered patch instead of edit and write", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const offered = outcomeOf("patch-offered").offeredTools;
    assert.ok(offered.includes("patch"), offered.join(", "));
    assert.ok(!offered.includes("edit") && !offered.includes("write"), offered.join(", "));
  });

  test("while a plan awaits its slice, a patch call is refused and creates nothing", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.match(refusalOf(outcomeOf("patch-unarmed")), /oso-code/);
    assert.equal(existsSync(path.join(projectOf("patch-unarmed"), "created.txt")), false);
  });

  test("a patch naming a file in the installed harness tree is refused naming the tree, and creates nothing", CERTIFY_GUARD, (t) => {
    if (lane(t) || fixture === undefined) return;
    assert.match(refusalOf(outcomeOf("patch-harness")), /installed oso-code harness tree/);
    assert.equal(existsSync(HARNESS_TARGET(fixture, PATCHED_HARNESS_FILE)), false);
  });

  test("a patch naming a repository file passes when no gate is armed against it, and the file is created", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.equal(existsSync(path.join(projectOf("patch-repository"), "created.txt")), true, outcomeOf("patch-repository").toolResults.join("\n"));
  });

  test("a production-deploy-shaped shell call is refused while an unattended run is armed", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.match(refusalOf(outcomeOf("deploy")), /a production deploy stays with the operator/);
  });

  test("shell and write are not in the execute tool's catalog, so a script cannot commit or write a file through it", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const shellScript = outcomeOf("execute-shell");
    assert.match(shellScript.toolResults.join("\n"), /Unknown tool 'shell'/);
    const [beforeCount, afterCount] = commitCounts.get("execute-shell") ?? [];
    assert.equal(afterCount, beforeCount);
    assert.match(outcomeOf("execute-write").toolResults.join("\n"), /Unknown tool 'write'/);
    assert.equal(existsSync(path.join(projectOf("execute-write"), "viaexec.txt")), false);
  });

  test("the hook fires for the outer execute call with the script text in input.code", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const [outer] = notesOfKind(outcomeOf("execute-shell"), "execute.before");
    assert.equal(outer?.["tool"], "execute");
    assert.match(String((outer?.["input"] as { code?: string }).code), /git commit/);
  });

  test("a tool called from inside execute reaches the hooks under its own id, and an MCP tool with default codemode is reachable only that way", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    const mcp = outcomeOf("execute-mcp");
    assert.deepEqual(notesOfKind(mcp, "execute.before").map((note) => note["tool"]), ["execute", `${MCP_CODEMODE_SERVER_NAME}_ping`]);
    assert.equal(mcp.toolResults.join(""), "pong");
    assert.ok(mcp.offeredTools.includes("execute"));
    assert.ok(!mcp.offeredTools.includes(`${MCP_CODEMODE_SERVER_NAME}_ping`));
  });

  test("a throw inside execute.before for an inner call blocks that call and reaches the script as an error", CERTIFY_GUARD, (t) => {
    if (lane(t)) return;
    assert.deepEqual(outcomeOf("execute-veto").toolResults, ["caught:VETO-REASON"]);
  });
});
