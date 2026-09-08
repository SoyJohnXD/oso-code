import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const CODEX_STOP_CERTIFY_OPT_IN = "OSO_CERTIFY_ALLOW_CODEX_STOP_PROBE";
export const CODEX_STOP_PROBE_BOUND_SECONDS = 180;
const CODEX_STOP_HOOK_INVOCATION_CAP = 2;
export const CODEX_STOP_FIRST_MESSAGE = "PROBE_FIRST";
export const CODEX_STOP_CONTINUED_MESSAGE = "PROBE_CONTINUED_7f43";

const STOP_PROMPT =
  `Native continuation probe: respond exactly ${CODEX_STOP_CONTINUED_MESSAGE} and finish. Do not call tools.`;
const CODEX_STOP_FIXTURE_PREFIX = "oso-codex-stop-certify.";
const HOOK_FILE = "stop-hook.mjs";
const EVENTS_FILE = "stop-events.jsonl";
const INHERITED_PROBE_ENVIRONMENT = [
  "PATH",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export type CodexStopProbeExecution = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnFailure: string | undefined;
  stdout: string;
  stderr: string;
  stopEvents: string;
}>;

export type CodexStopObservation = Readonly<{
  index: number;
  event: string;
  active: boolean;
  first: boolean;
  second: boolean;
}>;

export type CodexStopProbeValidation =
  | Readonly<{ kind: "measured"; messages: readonly string[]; stops: readonly CodexStopObservation[] }>
  | Readonly<{ kind: "invalid"; reason: string }>;

export type CodexStopProbeOutcome =
  | Readonly<{ kind: "measured"; messages: readonly string[]; stops: readonly CodexStopObservation[] }>
  | Readonly<{ kind: "not-run"; reason: string }>
  | Readonly<{ kind: "invalid"; reason: string }>;

export function validateCodexStopProbe(execution: CodexStopProbeExecution): CodexStopProbeValidation {
  if (execution.timedOut) return invalid(`codex exec exceeded its ${CODEX_STOP_PROBE_BOUND_SECONDS}-second bound`);
  if (execution.spawnFailure !== undefined) return invalid(`codex exec failed to start: ${execution.spawnFailure}`);
  if (execution.signal !== null) return invalid(`codex exec was terminated by ${execution.signal}`);
  if (execution.status !== 0) return invalid(`codex exec exited ${String(execution.status)}`);

  const stream = parseNativeStream(execution.stdout);
  if (stream.kind === "invalid") return stream;
  if (stream.userMessages !== 0) return invalid("native stream carried additional user input");
  if (stream.messages.length !== 2) return invalid(`native stream carried ${stream.messages.length} agent messages, expected 2`);
  if (stream.messages[0] !== CODEX_STOP_FIRST_MESSAGE || stream.messages[1] !== CODEX_STOP_CONTINUED_MESSAGE) {
    return invalid("native stream did not carry the first response followed by the continuation response");
  }

  const stops = parseStopEvents(execution.stopEvents);
  if (stops.kind === "invalid") return stops;
  if (stops.stops.length !== CODEX_STOP_HOOK_INVOCATION_CAP) {
    return invalid(`Stop hook ran ${stops.stops.length} time(s), expected ${CODEX_STOP_HOOK_INVOCATION_CAP}`);
  }
  const [first, second] = stops.stops;
  if (first?.index !== 1 || first.event !== "Stop" || first.active !== false || first.first !== true || first.second !== false) {
    return invalid("the first Stop observation did not carry the initial response and inactive rail");
  }
  if (second?.index !== 2 || second.event !== "Stop" || second.active !== true || second.first !== false || second.second !== true) {
    return invalid("the second Stop observation did not carry the continuation response and active rail");
  }

  return { kind: "measured", messages: stream.messages, stops: stops.stops };
}

export function runCodexStopProbe(environment: NodeJS.ProcessEnv, boundSeconds = CODEX_STOP_PROBE_BOUND_SECONDS): CodexStopProbeOutcome {
  const gate = certifyGate(environment);
  if (gate !== undefined) return { kind: "not-run", reason: gate };

  let root: string | undefined;
  try {
    const sourceAuth = authFileFor(environment);
    if (sourceAuth === undefined) return { kind: "not-run", reason: "Codex auth.json is not a readable regular file" };
    root = mkdtempSync(path.join(tmpdir(), CODEX_STOP_FIXTURE_PREFIX));
    const home = path.join(root, "home");
    const codexHome = path.join(home, ".codex");
    const workspace = path.join(root, "workspace");
    const hook = path.join(root, HOOK_FILE);
    const events = path.join(root, EVENTS_FILE);
    for (const directory of [home, codexHome, workspace]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    copyFileSync(sourceAuth, path.join(codexHome, "auth.json"));
    chmodSync(path.join(codexHome, "auth.json"), 0o600);
    writeFileSync(hook, stopHookSource(events), { mode: 0o700 });
    writeFileSync(
      path.join(codexHome, "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node ${hook}` }] }] } }),
      { mode: 0o600 },
    );
    writeFileSync(path.join(codexHome, "config.toml"), "[features]\nhooks = true\n", { mode: 0o600 });
    const fixture = { root, home, codexHome, workspace, events };
    const execution = executeProbe(fixture, environment, boundSeconds);
    return validateCodexStopProbe(execution);
  } catch (error) {
    return { kind: "invalid", reason: `Codex Stop probe setup failed: ${causeText(error)}` };
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

type ProbeFixture = Readonly<{ root: string; home: string; codexHome: string; workspace: string; events: string }>;

type NativeStream =
  | Readonly<{ kind: "parsed"; messages: readonly string[]; userMessages: number }>
  | Readonly<{ kind: "invalid"; reason: string }>;

type StopEvents =
  | Readonly<{ kind: "parsed"; stops: readonly CodexStopObservation[] }>
  | Readonly<{ kind: "invalid"; reason: string }>;

function certifyGate(environment: NodeJS.ProcessEnv): string | undefined {
  if (environment["OSO_CERTIFY"] !== "1") return "OSO_CERTIFY=1 is required for authenticated execution";
  if (environment[CODEX_STOP_CERTIFY_OPT_IN] !== "1") {
    return `${CODEX_STOP_CERTIFY_OPT_IN}=1 is required for the bounded authenticated probe`;
  }
  return undefined;
}

function authFileFor(environment: NodeJS.ProcessEnv): string | undefined {
  const codexHome = environment["CODEX_HOME"] ?? path.join(homedir(), ".codex");
  const candidate = path.join(codexHome, "auth.json");
  if (!existsSync(candidate)) return undefined;
  return lstatSync(candidate).isFile() ? candidate : undefined;
}

function executeProbe(fixture: ProbeFixture, environment: NodeJS.ProcessEnv, boundSeconds: number): CodexStopProbeExecution {
  const probeEnvironment = {
    ...Object.fromEntries(
      INHERITED_PROBE_ENVIRONMENT.flatMap((key) => {
        const value = environment[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    CODEX_HOME: fixture.codexHome,
    XDG_CONFIG_HOME: path.join(fixture.root, "xdg-config"),
    XDG_STATE_HOME: path.join(fixture.root, "xdg-state"),
    XDG_CACHE_HOME: path.join(fixture.root, "xdg-cache"),
  };
  const result = spawnSync(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "--dangerously-bypass-hook-trust",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-C",
      fixture.workspace,
      `Respond exactly ${CODEX_STOP_FIRST_MESSAGE} and finish. Do not call tools, read files, browse, or delegate.`,
    ],
    { env: probeEnvironment, encoding: "utf8", timeout: boundSeconds * 1000 },
  );
  return {
    status: result.status,
    signal: result.signal,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    spawnFailure:
      result.error === undefined || (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
        ? undefined
        : causeText(result.error),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stopEvents: existsSync(fixture.events) ? readFileSync(fixture.events, "utf8") : "",
  };
}

function parseNativeStream(stdout: string): NativeStream {
  const messages: string[] = [];
  let userMessages = 0;
  for (const decoded of decodeJsonlObjects(stdout, "native stream")) {
    if (decoded.kind === "invalid") return decoded;
    const { index, value } = decoded;
    if (value["type"] !== "item.completed") continue;
    const item = value["item"];
    if (!isRecord(item)) return invalid(`native stream line ${index + 1} carried no completed item`);
    if (item["type"] === "agent_message") {
      if (typeof item["text"] !== "string") return invalid(`native stream line ${index + 1} carried no agent text`);
      messages.push(item["text"]);
    }
    if (item["type"] === "user_message") userMessages += 1;
  }
  return { kind: "parsed", messages, userMessages };
}

function parseStopEvents(text: string): StopEvents {
  const stops: CodexStopObservation[] = [];
  for (const decoded of decodeJsonlObjects(text, "Stop observation")) {
    if (decoded.kind === "invalid") return decoded;
    const { index, value } = decoded;
    if (
      typeof value["index"] !== "number" ||
      typeof value["event"] !== "string" ||
      typeof value["active"] !== "boolean" ||
      typeof value["first"] !== "boolean" ||
      typeof value["second"] !== "boolean"
    ) {
      return invalid(`Stop observation line ${index + 1} was incomplete`);
    }
    stops.push({
      index: value["index"],
      event: value["event"],
      active: value["active"],
      first: value["first"],
      second: value["second"],
    });
  }
  return { kind: "parsed", stops };
}

function* decodeJsonlObjects(text: string, stream: string): Generator<
  | Readonly<{ kind: "parsed"; index: number; value: Record<string, unknown> }>
  | Readonly<{ kind: "invalid"; reason: string }>
> {
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      yield invalid(`${stream} line ${index + 1} was not JSON: ${causeText(error)}`);
      return;
    }
    if (!isRecord(value)) {
      yield invalid(`${stream} line ${index + 1} was not an object`);
      return;
    }
    yield { kind: "parsed", index, value };
  }
}

function stopHookSource(events: string): string {
  return `import fs from "node:fs";
import process from "node:process";

const payload = JSON.parse(await readInput());
const eventsFile = ${JSON.stringify(events)};
const existing = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, "utf8").trim() : "";
const index = existing === "" ? 1 : existing.split("\\n").length + 1;
const first = payload.last_assistant_message === ${JSON.stringify(CODEX_STOP_FIRST_MESSAGE)};
const second = payload.last_assistant_message === ${JSON.stringify(CODEX_STOP_CONTINUED_MESSAGE)};
fs.appendFileSync(eventsFile, JSON.stringify({ index, event: payload.hook_event_name, active: payload.stop_hook_active, first, second }) + "\\n");
if (index === 1) {
  process.stderr.write(${JSON.stringify(STOP_PROMPT)});
  process.exit(2);
}
process.stdout.write("{}");

function readInput() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string): Readonly<{ kind: "invalid"; reason: string }> {
  return { kind: "invalid", reason };
}

function causeText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
