import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../../../src/index.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../../src/install/pins.ts";
import { StateSandbox } from "../../support/state-sandbox.ts";
import { BEHAVIOR_BAR_SESSION_BOUND_SECONDS, probeRootSessionId, type SessionRun } from "./behavior-drive.ts";
import { CERTIFY } from "./certify-guard.ts";
import {
  isolatedHostEnvironment,
  laneCauseFor,
  laneNotRun,
  resolveOpenCodeBinaryProbe,
  type OpenCodeBinaryProbe,
  type ResolvedProbe,
} from "./opencode-binary.ts";
import {
  scriptedPrompt,
  startScriptedProvider,
  type ScriptedCall,
  type ScriptedProvider,
  type ScriptedProviderRequest,
} from "./scripted-provider.ts";

const SUPPORT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.join(SUPPORT_DIRECTORY, "..", "..", "..", "..");
const OVERRIDE_ENV_VAR = "OSO_V2_HOST_SPIKE_OPENCODE_BIN";
export const ADAPTER_BUNDLE_FILE = "oso-code.js";
const ADAPTER_BUNDLE_SOURCE = path.join(REPOSITORY_ROOT, "opencode", "dist", ADAPTER_BUNDLE_FILE);
const SPIKE_PLUGIN_SOURCE = path.join(SUPPORT_DIRECTORY, "host-spike-plugin.mjs");
const SPIKE_PLUGIN_FILE = "oso-spike.js";
const MCP_STUB_SOURCE = path.join(SUPPORT_DIRECTORY, "mcp-stub.mjs");
export const MCP_SERVER_NAME = "stub";
export const MCP_CODEMODE_SERVER_NAME = "scripted";
const SCRIPTED_MODEL = "scripted/m";
export const PATCH_TOOL_MODEL = "scripted/gpt-5";
const WAVE_AGENT_FILE = "oso-applier.md";
const WAVE_AGENT_CONTRACT = "---\ndescription: Stands in for the oso-applier wave child\nmode: subagent\n---\nRun the assignment you are given.\n";
const STATE_BINARY = path.join(REPOSITORY_ROOT, "plugin", "bin", "oso-state");

export type SpikeNote = Readonly<Record<string, unknown> & { kind: string }>;

export type ExtraPlugin = Readonly<{ remove: () => void }>;

export type SpikeFixture = Readonly<{
  sandbox: StateSandbox;
  environment: NodeJS.ProcessEnv;
  project: string;
  provider: ScriptedProvider;
  writeExtraPlugin: (fileName: string, source: string) => ExtraPlugin;
}>;

export type DriveOptions = Readonly<{ agent?: string; model?: string }>;

export type ScenarioOutcome = Readonly<{
  run: SessionRun;
  notes: readonly SpikeNote[];
  toolResults: readonly string[];
  requests: readonly ScriptedProviderRequest[];
  offeredTools: readonly string[];
  sideEffectExists: (relativePath: string) => boolean;
}>;

export type V2Lane = Readonly<{
  probe: OpenCodeBinaryProbe | undefined;
  laneCause: string | undefined;
  laneNotRun: (t: TestContext) => boolean;
}>;

export function resolveV2Lane(): V2Lane {
  const probe = CERTIFY
    ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
    : undefined;
  const laneCause = laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION);
  return { probe, laneCause, laneNotRun: (t) => laneNotRun(t, probe, laneCause) };
}

export function installAdapterBundle(fixture: SpikeFixture): ExtraPlugin {
  return fixture.writeExtraPlugin(ADAPTER_BUNDLE_FILE, readFileSync(ADAPTER_BUNDLE_SOURCE, "utf8"));
}

export function scenarioOutcomeOf(outcomes: ReadonlyMap<string, ScenarioOutcome>, name: string): ScenarioOutcome {
  const outcome = outcomes.get(name);
  if (outcome === undefined) throw new Error(`unreachable: scenario ${name} was expected to have run`);
  return outcome;
}

export function messageTextOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function providerConfig(provider: ScriptedProvider): string {
  const config = {
    model: SCRIPTED_MODEL,
    mcp: {
      servers: {
        [MCP_SERVER_NAME]: { type: "local", command: [process.execPath, MCP_STUB_SOURCE], codemode: false },
        [MCP_CODEMODE_SERVER_NAME]: { type: "local", command: [process.execPath, MCP_STUB_SOURCE] },
      },
    },
    provider: {
      scripted: {
        npm: "@ai-sdk/openai-compatible",
        name: "Scripted",
        options: { baseURL: provider.baseURL, apiKey: "scripted" },
        models: {
          m: { name: "Scripted", tool_call: true, limit: { context: 100000, output: 4000 } },
          "gpt-5": { name: "Scripted patch model", tool_call: true, limit: { context: 100000, output: 4000 } },
        },
      },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function createSpikeFixture(): Promise<SpikeFixture> {
  const sandbox = new StateSandbox("host-spike");
  const provider = await startScriptedProvider();
  const configHome = path.join(sandbox.home, ".config", "opencode");
  const pluginDirectory = path.join(configHome, "plugin");
  const agentDirectory = path.join(configHome, "agent");
  mkdirSync(pluginDirectory, { recursive: true });
  mkdirSync(agentDirectory, { recursive: true });
  writeFileSync(path.join(agentDirectory, WAVE_AGENT_FILE), WAVE_AGENT_CONTRACT);
  writeFileSync(path.join(configHome, "opencode.json"), providerConfig(provider));
  writeFileSync(path.join(pluginDirectory, SPIKE_PLUGIN_FILE), readFileSync(SPIKE_PLUGIN_SOURCE, "utf8"));
  return {
    sandbox,
    environment: isolatedHostEnvironment(process.env, sandbox.home),
    project: sandbox.seedGitRepository("project"),
    provider,
    writeExtraPlugin: (fileName, source) => {
      const target = path.join(pluginDirectory, fileName);
      writeFileSync(target, source);
      return { remove: () => rmSync(target, { force: true }) };
    },
  };
}

export async function disposeSpikeFixture(fixture: SpikeFixture): Promise<void> {
  await fixture.provider.stop();
  fixture.sandbox.dispose();
}

function runStandaloneSession(
  binary: string,
  environment: NodeJS.ProcessEnv,
  project: string,
  prompt: string,
  { agent, model = SCRIPTED_MODEL }: DriveOptions,
): Promise<SessionRun> {
  const agentArguments = agent === undefined ? [] : ["--agent", agent];
  return new Promise((resolve) => {
    const child = spawn(binary, ["run", "--standalone", "-m", model, "--format", "json", ...agentArguments, prompt], {
      cwd: project,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: BEHAVIOR_BAR_SESSION_BOUND_SECONDS * 1000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => resolve({ stdout, stderr, status: null, signal: null, error }));
    child.once("close", (status, signal) => resolve({ stdout, stderr, status, signal, error: undefined }));
  });
}

function readNotes(notesPath: string): readonly SpikeNote[] {
  if (!existsSync(notesPath)) return [];
  return readFileSync(notesPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SpikeNote);
}

function toolResultsOf(requests: readonly ScriptedProviderRequest[]): readonly string[] {
  const final = requests.at(-1);
  return (final?.messages ?? []).filter((message) => message.role === "tool").map((message) => String(message.content));
}

function offeredToolsOf(requests: readonly ScriptedProviderRequest[]): readonly string[] {
  return requests.find((request) => request.offeredTools.length > 0)?.offeredTools ?? [];
}

export function driveScenario(
  probe: ResolvedProbe,
  fixture: SpikeFixture,
  name: string,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  options: DriveOptions = {},
): Promise<ScenarioOutcome> {
  return driveSequence(probe, fixture, name, [{ toolName, input }], options);
}

export async function driveSequence(
  probe: ResolvedProbe,
  fixture: SpikeFixture,
  name: string,
  calls: readonly ScriptedCall[],
  options: DriveOptions = {},
): Promise<ScenarioOutcome> {
  const notesPath = path.join(fixture.sandbox.root, `${name}.notes.jsonl`);
  fixture.provider.drainRequests();
  const run = await runStandaloneSession(
    probe.binary,
    { ...fixture.environment, PWD: fixture.project, OSO_SPIKE_NOTES: notesPath, OSO_SPIKE_STATE_DIRECTORY: path.join(fixture.sandbox.home, ".local", "state", "oso-code") },
    fixture.project,
    calls.map(({ toolName, input }) => scriptedPrompt(toolName, input)).join("\n"),
    options,
  );
  const requests = fixture.provider.drainRequests();
  return {
    run,
    notes: readNotes(notesPath),
    toolResults: toolResultsOf(requests),
    requests,
    offeredTools: offeredToolsOf(requests),
    sideEffectExists: (relativePath) => existsSync(path.join(fixture.project, relativePath)),
  };
}

export function armProject(
  fixture: SpikeFixture,
  project: string,
  pairs: readonly string[],
  session: string = probeRootSessionId(project),
): void {
  const run = spawnSync(STATE_BINARY, ["--session", session, "set", ...pairs], {
    cwd: project,
    env: fixture.environment,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`oso-state set ${pairs.join(" ")} exited ${run.status}: ${run.error?.message ?? ""}${run.stderr}`);
}

export function notesOfKind(outcome: ScenarioOutcome, kind: string): readonly SpikeNote[] {
  return outcome.notes.filter((note) => note.kind === kind);
}

export function approvePlanBeforehand(fixture: SpikeFixture, project: string, document: string): void {
  const session = probeRootSessionId(project);
  const digest = sha256Hex(document);
  for (const verb of [`capture-plan`, `approve-plan`]) {
    const run = spawnSync(STATE_BINARY, ["--session", session, verb, digest], {
      cwd: project,
      env: fixture.environment,
      input: document,
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`oso-state ${verb} exited ${run.status}: ${run.error?.message ?? ""}${run.stderr}`);
  }
}
