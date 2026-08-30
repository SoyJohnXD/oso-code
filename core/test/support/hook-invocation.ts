import { spawnSync } from "node:child_process";
import type { StateSandbox } from "./state-sandbox.ts";

export type HookCommandLine = Readonly<{ command: string; args: readonly string[] }>;

export type SpawnedRun = Readonly<{ status: number | null; stdout: string; stderr: string }>;

export function commitEnvelopeFor(session: string): string {
  return (
    `{"session_id":"${session}","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",` +
    '"tool_input":{"command":"git commit -m x"}}'
  );
}

export function spawnAsHookHost(sandbox: StateSandbox, hook: HookCommandLine, envelope: string): SpawnedRun {
  const result = spawnSync(hook.command, hook.args, {
    cwd: sandbox.cwd,
    input: sandbox.expandJson(envelope),
    env: {
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      PATH: process.env["PATH"] ?? "",
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "",
    },
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
