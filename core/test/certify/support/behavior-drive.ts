import { spawnSync } from "node:child_process";
import path from "node:path";
import { sha256Hex } from "../../../src/state/store.ts";
import { configHomeOf, type ContractFixture } from "./contract-fixture.ts";
import { boundFrom } from "./drive.ts";

const DEFAULT_SESSION_BOUND_SECONDS = 180;
const DEFAULT_LOAD_BOUND_SECONDS = 60;
const FREE_SESSION_MODEL_PATTERN = /^opencode\/.*-free$/;

export const BEHAVIOR_BAR_SESSION_BOUND_SECONDS = boundFrom(
  process.env,
  "OSO_BEHAVIOR_BAR_SESSION_BOUND_SECONDS",
  DEFAULT_SESSION_BOUND_SECONDS,
);
export const BEHAVIOR_BAR_LOAD_BOUND_SECONDS = boundFrom(process.env, "OSO_BEHAVIOR_BAR_LOAD_BOUND_SECONDS", DEFAULT_LOAD_BOUND_SECONDS);

export type SessionRun = Readonly<{
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error: Error | undefined;
}>;

export function sessionOutcomeDescription(run: SessionRun): string {
  if (run.error !== undefined) return `did not complete: ${run.error.message}`;
  if (run.signal !== null) return `did not complete: ${run.signal}`;
  return `exit ${run.status ?? "null"}`;
}

export function probeRootSessionId(probeRepository: string): string {
  return sha256Hex(path.join(probeRepository, ".git")).slice(0, 16);
}

export function armProbeState(fixture: ContractFixture, probeRepository: string): void {
  const stateBinary = path.join(configHomeOf(fixture), "bin", "oso-state");
  const run = spawnSync(
    stateBinary,
    ["--session", probeRootSessionId(probeRepository), "set", "mode=plan", "auto=running"],
    { cwd: probeRepository, env: fixture.environment, encoding: "utf8" },
  );
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`oso-state set mode=plan auto=running exited ${run.status}: ${run.stderr ?? ""}`);
}

export function probeRepositoryCommitCount(probeRepository: string): string {
  const run = spawnSync("git", ["-C", probeRepository, "rev-list", "--count", "HEAD"], { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return "unreadable";
  return run.stdout.trim();
}

export type SessionModelChoice =
  | Readonly<{ kind: "chosen"; model: string }>
  | Readonly<{ kind: "unresolved"; reason: string }>;

export function chooseSessionModel(binary: string, environment: NodeJS.ProcessEnv): SessionModelChoice {
  const override = environment["OSO_BEHAVIOR_BAR_MODEL"];
  if (override !== undefined && override !== "") return { kind: "chosen", model: override };
  const run = spawnSync(binary, ["models"], { env: environment, encoding: "utf8", timeout: BEHAVIOR_BAR_LOAD_BOUND_SECONDS * 1000 });
  if (run.error !== undefined || run.signal !== null) {
    return { kind: "unresolved", reason: `opencode models did not complete: ${run.error?.message ?? run.signal}` };
  }
  if (run.status !== 0) return { kind: "unresolved", reason: `opencode models exited ${run.status}: ${run.stderr ?? ""}` };
  const free = (run.stdout ?? "").split("\n").find((line) => FREE_SESSION_MODEL_PATTERN.test(line));
  if (free === undefined) {
    return { kind: "unresolved", reason: `the host catalog offered no free model to drive a session with:\n${run.stdout ?? ""}` };
  }
  return { kind: "chosen", model: free };
}

export function runSessionWithPrompt(
  binary: string,
  environment: NodeJS.ProcessEnv,
  probeRepository: string,
  model: string,
  prompt: string,
): SessionRun {
  const run = spawnSync(binary, ["run", "--dir", probeRepository, "-m", model, "--format", "json", prompt], {
    env: environment,
    encoding: "utf8",
    timeout: BEHAVIOR_BAR_SESSION_BOUND_SECONDS * 1000,
  });
  return { stdout: run.stdout ?? "", stderr: run.stderr ?? "", status: run.status, signal: run.signal, error: run.error };
}

export function runProbeSession(
  binary: string,
  environment: NodeJS.ProcessEnv,
  probeRepository: string,
  model: string,
  command: string,
): SessionRun {
  return runSessionWithPrompt(
    binary,
    environment,
    probeRepository,
    model,
    `Use the bash tool to run exactly this command: ${command}    Then reply with status: done`,
  );
}
