import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import type { StateSandbox } from "../../support/state-sandbox.ts";

const DEFAULT_INVOKE_BOUND_SECONDS = 30;
const DEFAULT_SERVER_BOUND_SECONDS = 120;
const SERVER_LISTENING_MARKER = "server listening on";

function boundFrom(environment: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const parsed = Number.parseInt(environment[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CONTRACT_BAR_BOUND_SECONDS = boundFrom(process.env, "OSO_CONTRACT_BAR_BOUND_SECONDS", DEFAULT_INVOKE_BOUND_SECONDS);
export const CONTRACT_BAR_SERVER_BOUND_SECONDS = boundFrom(
  process.env,
  "OSO_CONTRACT_BAR_SERVER_BOUND_SECONDS",
  DEFAULT_SERVER_BOUND_SECONDS,
);

export function invokeContractBar(
  binary: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
  boundSeconds: number,
): SpawnSyncReturns<string> {
  return spawnSync(binary, args, { env: environment, encoding: "utf8", timeout: boundSeconds * 1000 });
}

export type RegistrationProbe =
  | Readonly<{ kind: "listed"; toolIds: readonly string[]; workspaceAdapterTypes: readonly string[] }>
  | Readonly<{ kind: "failed"; reason: string }>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not resolve a free loopback port"));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function awaitServerListening(readOutput: () => string, boundSeconds: number): Promise<boolean> {
  const deadline = Date.now() + boundSeconds * 1000;
  while (Date.now() < deadline) {
    if (readOutput().includes(SERVER_LISTENING_MARKER)) return true;
    await sleep(200);
  }
  return readOutput().includes(SERVER_LISTENING_MARKER);
}

function killQuietly(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function stopServer(server: ChildProcess, boundSeconds: number): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  if (server.pid === undefined || !killQuietly(-server.pid)) server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, boundSeconds * 1000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function identifierOf(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && typeof (entry as { type?: unknown }).type === "string") {
    return (entry as { type: string }).type;
  }
  return "";
}

async function fetchIdentifiers(url: string, boundSeconds: number): Promise<readonly string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(boundSeconds * 1000) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`${url} did not respond with a JSON array`);
  return body.map(identifierOf);
}

export async function probeRegistrations(
  binary: string,
  environment: NodeJS.ProcessEnv,
  sandbox: StateSandbox,
): Promise<RegistrationProbe> {
  const repository = sandbox.seedGitRepository("tool-probe-repo");
  const port = await freeLoopbackPort();
  const server = spawn(binary, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: repository,
    env: environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const listening = await awaitServerListening(() => stdout, CONTRACT_BAR_SERVER_BOUND_SECONDS);
    if (!listening) return { kind: "failed", reason: `server-never-listened: ${(stderr || stdout).trim()}` };
    const [toolIds, workspaceAdapterTypes] = await Promise.all([
      fetchIdentifiers(`http://127.0.0.1:${port}/experimental/tool/ids?directory=${repository}`, CONTRACT_BAR_SERVER_BOUND_SECONDS),
      fetchIdentifiers(`http://127.0.0.1:${port}/experimental/workspace/adapter?directory=${repository}`, CONTRACT_BAR_SERVER_BOUND_SECONDS),
    ]);
    return { kind: "listed", toolIds, workspaceAdapterTypes };
  } catch (error) {
    return { kind: "failed", reason: `unreachable: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await stopServer(server, CONTRACT_BAR_SERVER_BOUND_SECONDS);
  }
}
