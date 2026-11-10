import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const DEFAULT_INVOKE_BOUND_SECONDS = 30;

export function boundFrom(environment: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const parsed = Number.parseInt(environment[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CONTRACT_BAR_BOUND_SECONDS = boundFrom(process.env, "OSO_CONTRACT_BAR_BOUND_SECONDS", DEFAULT_INVOKE_BOUND_SECONDS);

type ContractBarInvocation = Readonly<{
  binary: string;
  environment: NodeJS.ProcessEnv;
  args: readonly string[];
  boundSeconds: number;
  projectDirectory?: string;
}>;

export function invokeContractBar(invocation: ContractBarInvocation): SpawnSyncReturns<string> {
  return spawnSync(invocation.binary, invocation.args, {
    env: invocation.environment,
    cwd: invocation.projectDirectory,
    encoding: "utf8",
    timeout: invocation.boundSeconds * 1000,
  });
}
