import type { SessionRun } from "./behavior-drive.ts";
import { HOST_LOAD_PROBE_ARGS } from "../../../src/install/opencode-load-proof.ts";
import { invokeContractBar } from "./drive.ts";

export function runLoadProbe(
  binary: string,
  environment: NodeJS.ProcessEnv,
  projectDirectory: string | undefined,
  boundSeconds: number,
): SessionRun {
  const probeEnvironment = projectDirectory === undefined ? environment : { ...environment, PWD: projectDirectory };
  const run = invokeContractBar({ binary, environment: probeEnvironment, args: HOST_LOAD_PROBE_ARGS, boundSeconds, projectDirectory });
  return { stdout: run.stdout ?? "", stderr: run.stderr ?? "", status: run.status, signal: run.signal, error: run.error };
}
