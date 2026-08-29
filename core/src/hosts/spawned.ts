import type { HostName } from "../routes/routes.ts";
import { readEnvelope, type HookCaller, type HookEnvelope } from "./envelope.ts";

function named(environment: NodeJS.ProcessEnv, variable: string): string {
  const value = environment[variable];
  return value === undefined ? "" : value;
}

export function spawningHost(environment: NodeJS.ProcessEnv): HostName {
  if (named(environment, "OSO_HOST") === "opencode") return "opencode";
  return named(environment, "OSO_AGENT") === "" ? "claude" : "codex";
}

export function spawnedCaller(environment: NodeJS.ProcessEnv): HookCaller {
  return {
    host: spawningHost(environment),
    agentSession: named(environment, "OSO_AGENT"),
    stateBin: named(environment, "OSO_STATE_BIN"),
  };
}

export function spawnedEnvelope(payload: string, environment: NodeJS.ProcessEnv): HookEnvelope {
  return readEnvelope(payload, spawnedCaller(environment));
}
