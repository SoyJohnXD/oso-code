import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StateSandbox } from "../../support/state-sandbox.ts";

export const WAVE_SMOKE_FIXTURE_WORKSPACE = "wave-smoke-fixture";

export type WaveSmokeChildName = "wt1" | "wt2";

const WAVE_SMOKE_PERMISSION_CONFIG = {
  permission: {
    question: "allow",
    plan_enter: "allow",
    plan_exit: "allow",
    bash: { "*": "allow" },
  },
} as const;

export type WaveSmokeFixture = Readonly<{ sandbox: StateSandbox; main: string; worktrees: Readonly<Record<WaveSmokeChildName, string>> }>;

export type WaveSmokeBuildOutcome =
  | Readonly<{ kind: "ready"; fixture: WaveSmokeFixture }>
  | Readonly<{ kind: "failed"; sandbox: StateSandbox | undefined; setupResult: string }>;

function gitOutput(directory: string, args: readonly string[]): Readonly<{ ok: boolean; stdout: string }> {
  const run = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  return { ok: run.error === undefined && run.status === 0, stdout: run.stdout ?? "" };
}

export function buildWaveSmokeFixture(): WaveSmokeBuildOutcome {
  let sandbox: StateSandbox;
  try {
    sandbox = new StateSandbox(WAVE_SMOKE_FIXTURE_WORKSPACE);
  } catch (error) {
    return { kind: "failed", sandbox: undefined, setupResult: `temporary-parent-unavailable:${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    mkdirSync(path.join(sandbox.home, ".config", "opencode"), { recursive: true });
    writeFileSync(path.join(sandbox.home, ".config", "opencode", "opencode.json"), `${JSON.stringify(WAVE_SMOKE_PERMISSION_CONFIG, null, 2)}\n`);
  } catch {
    return { kind: "failed", sandbox, setupResult: "fixture-setup-failed" };
  }

  let main: string;
  try {
    main = sandbox.seedGitRepository("main");
  } catch {
    return { kind: "failed", sandbox, setupResult: "baseline-setup-failed" };
  }
  const baseCommit = gitOutput(main, ["rev-parse", "HEAD"]).stdout.trim();

  const wt1 = path.join(sandbox.root, "wt1");
  const wt2 = path.join(sandbox.root, "wt2");
  const wt1Added = gitOutput(main, ["worktree", "add", "-q", "-b", "oso/wt1", wt1, baseCommit]).ok;
  const wt2Added = gitOutput(main, ["worktree", "add", "-q", "-b", "oso/wt2", wt2, baseCommit]).ok;
  if (!wt1Added || !wt2Added) return { kind: "failed", sandbox, setupResult: "worktree-setup-failed" };

  return { kind: "ready", fixture: { sandbox, main, worktrees: { wt1, wt2 } } };
}

export function removeWaveSmokeFixture(sandbox: StateSandbox | undefined): boolean {
  if (sandbox === undefined) return true;
  sandbox.dispose();
  return !existsSync(sandbox.root);
}

export function waveSmokeChildEnvironment(fixture: WaveSmokeFixture, lane: string): NodeJS.ProcessEnv {
  const home = fixture.sandbox.home;
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_STATE_HOME: path.join(fixture.sandbox.root, `state-${lane}`),
    XDG_CACHE_HOME: path.join(fixture.sandbox.root, `cache-${lane}`),
    XDG_DATA_HOME: path.join(fixture.sandbox.root, `data-${lane}`),
  };
}
