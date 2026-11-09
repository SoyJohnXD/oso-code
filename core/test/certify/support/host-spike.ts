import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StateSandbox } from "../../support/state-sandbox.ts";
import { BEHAVIOR_BAR_SESSION_BOUND_SECONDS, type SessionRun } from "./behavior-drive.ts";
import { isolatedHostEnvironment, type OpenCodeBinaryProbe, type ResolvedProbe } from "./opencode-binary.ts";
import { scriptedPrompt, startScriptedProvider, type ScriptedProvider, type ScriptedProviderRequest } from "./scripted-provider.ts";

const SPIKE_PLUGIN_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "host-spike-plugin.mjs");
const SPIKE_PLUGIN_FILE = "oso-spike.js";
const SCRIPTED_MODEL = "scripted/m";
const FIRST_HOST_WITH_V2_PLUGINS = 2;
const VERSION_PROBE_HOME_PREFIX = "oso-v2-host-version.";
const V2_VERSION_LINE = /^opencode v(\d+)\./m;

export type SpikeNote = Readonly<Record<string, unknown> & { kind: string }>;

export type ExtraPlugin = Readonly<{ remove: () => void }>;

export type SpikeFixture = Readonly<{
  sandbox: StateSandbox;
  environment: NodeJS.ProcessEnv;
  project: string;
  provider: ScriptedProvider;
  writeExtraPlugin: (fileName: string, source: string) => ExtraPlugin;
}>;

export type ScenarioOutcome = Readonly<{
  run: SessionRun;
  notes: readonly SpikeNote[];
  toolResults: readonly string[];
  offeredTools: readonly string[];
  sideEffectExists: (relativePath: string) => boolean;
}>;

function reportedMajorVersion(binary: string): number | undefined {
  const probeHome = mkdtempSync(path.join(tmpdir(), VERSION_PROBE_HOME_PREFIX));
  try {
    const run = spawnSync(binary, ["--version"], { env: isolatedHostEnvironment(process.env, probeHome), encoding: "utf8" });
    const major = V2_VERSION_LINE.exec(run.stdout ?? "")?.[1];
    return major === undefined ? undefined : Number.parseInt(major, 10);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

export function v2LaneCause(probe: OpenCodeBinaryProbe | undefined): string | undefined {
  if (probe === undefined) return undefined;
  if (probe.kind === "unresolved") return probe.reason;
  const major = reportedMajorVersion(probe.binary);
  if (major !== undefined && major >= FIRST_HOST_WITH_V2_PLUGINS) return undefined;
  return `${probe.binary} does not report an opencode v${FIRST_HOST_WITH_V2_PLUGINS} or newer version line, so the v2 plugin contract cannot be driven`;
}

function providerConfig(provider: ScriptedProvider): string {
  const config = {
    provider: {
      scripted: {
        npm: "@ai-sdk/openai-compatible",
        name: "Scripted",
        options: { baseURL: provider.baseURL, apiKey: "scripted" },
        models: { m: { name: "Scripted", tool_call: true, limit: { context: 100000, output: 4000 } } },
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
  mkdirSync(pluginDirectory, { recursive: true });
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

function runStandaloneSession(binary: string, environment: NodeJS.ProcessEnv, project: string, prompt: string): Promise<SessionRun> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["run", "--standalone", "-m", SCRIPTED_MODEL, "--format", "json", prompt], {
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

export async function driveScenario(
  probe: ResolvedProbe,
  fixture: SpikeFixture,
  name: string,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): Promise<ScenarioOutcome> {
  const notesPath = path.join(fixture.sandbox.root, `${name}.notes.jsonl`);
  fixture.provider.drainRequests();
  const run = await runStandaloneSession(
    probe.binary,
    { ...fixture.environment, PWD: fixture.project, OSO_SPIKE_NOTES: notesPath },
    fixture.project,
    scriptedPrompt(toolName, input),
  );
  const requests = fixture.provider.drainRequests();
  return {
    run,
    notes: readNotes(notesPath),
    toolResults: toolResultsOf(requests),
    offeredTools: offeredToolsOf(requests),
    sideEffectExists: (relativePath) => existsSync(path.join(fixture.project, relativePath)),
  };
}

export function notesOfKind(outcome: ScenarioOutcome, kind: string): readonly SpikeNote[] {
  return outcome.notes.filter((note) => note.kind === kind);
}
