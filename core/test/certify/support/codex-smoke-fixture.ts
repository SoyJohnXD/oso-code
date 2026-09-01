import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { codexPathsFor } from "../../../src/install/codex.ts";
import { renderCodexManagedConfig, renderCodexManagedFeatures, resolveFallowMcpCommand } from "../../../src/install/codex-config.ts";
import { firstExecutableOnPath } from "../../../src/install/verify-claude.ts";
import { homeDirectoryFrom, isDirectory, isReadableRegularFile } from "../../../src/state/store.ts";

export const SMOKE_FIXTURE_PREFIX = "oso-codex-smoke";
export const SMOKE_HANDOFF_SLICE = "codex-integrator-smoke";
export const SMOKE_HANDOFF_ATTEMPT = "1";
export const SMOKE_INTEGRATOR_AGENT_TYPE = "oso-integrator";
export const SMOKE_BRANCH = "oso-smoke-slice";

const SMOKE_COMMIT_IDENTITY = ["-c", "core.hooksPath=/dev/null", "-c", "user.name=oso-code", "-c", "user.email=smoke@oso-code.invalid"] as const;

export type IntegratorFixture = Readonly<{
  root: string;
  main: string;
  worktree: string;
  codexHome: string;
  baseCommit: string;
  sliceCommit: string;
}>;

export type FixtureBuildOutcome =
  | Readonly<{ kind: "ready"; fixture: IntegratorFixture }>
  | Readonly<{ kind: "failed"; root: string | undefined; setupResult: string }>;

export function gitOutput(directory: string, args: readonly string[]): Readonly<{ ok: boolean; stdout: string }> {
  const run = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  return { ok: run.error === undefined && run.status === 0, stdout: run.stdout ?? "" };
}

export function removeIntegratorFixtureRoot(root: string | undefined): boolean {
  if (root === undefined) return true;
  rmSync(root, { recursive: true, force: true });
  return !existsSync(root);
}

export function buildIntegratorFixture(environment: NodeJS.ProcessEnv): FixtureBuildOutcome {
  let parent: string;
  try {
    parent = realpathSync(environment["TMPDIR"] ?? "/tmp");
  } catch {
    return { kind: "failed", root: undefined, setupResult: "temporary-parent-unavailable" };
  }

  let root: string;
  try {
    root = mkdtempSync(path.join(parent, `${SMOKE_FIXTURE_PREFIX}.`));
  } catch (error) {
    return { kind: "failed", root: undefined, setupResult: collapsed(error instanceof Error ? error.message : String(error)) };
  }

  const main = path.join(root, "main");
  const worktree = path.join(root, "slice");
  mkdirSync(main, { recursive: true });
  writeFileSync(path.join(main, "baseline.txt"), "baseline\n");
  if (
    !gitOutput(main, ["init", "-q"]).ok ||
    !gitOutput(main, ["add", "baseline.txt"]).ok ||
    !gitOutput(main, [...SMOKE_COMMIT_IDENTITY, "commit", "-qm", "test: create smoke baseline"]).ok
  ) {
    return { kind: "failed", root, setupResult: "baseline-setup-failed" };
  }
  const baseCommit = gitOutput(main, ["rev-parse", "HEAD"]).stdout.trim();

  if (!gitOutput(main, ["worktree", "add", "-qb", SMOKE_BRANCH, worktree]).ok) {
    return { kind: "failed", root, setupResult: "worktree-setup-failed" };
  }

  writeFileSync(path.join(worktree, "integrated.txt"), "integrated by oso-integrator\n");
  if (
    !gitOutput(worktree, ["add", "integrated.txt"]).ok ||
    !gitOutput(worktree, [...SMOKE_COMMIT_IDENTITY, "commit", "-qm", "test: add integrator payload"]).ok
  ) {
    return { kind: "failed", root, setupResult: "slice-setup-failed" };
  }
  const sliceCommit = gitOutput(worktree, ["rev-parse", "HEAD"]).stdout.trim();

  const realPaths = codexPathsFor(homeDirectoryFrom(process.platform, environment), environment);
  const populated = populateSmokeCodexHome(root, environment, realPaths);
  if (populated.kind === "failed") return { kind: "failed", root, setupResult: populated.setupResult };

  return { kind: "ready", fixture: { root, main, worktree, codexHome: populated.codexHome, baseCommit, sliceCommit } };
}

type PopulateOutcome = Readonly<{ kind: "ready"; codexHome: string }> | Readonly<{ kind: "failed"; setupResult: string }>;

function populateSmokeCodexHome(
  smokeRoot: string,
  environment: NodeJS.ProcessEnv,
  realPaths: ReturnType<typeof codexPathsFor>,
): PopulateOutcome {
  const smokeCodexHome = path.join(smokeRoot, "codex-home");
  try {
    mkdirSync(smokeCodexHome, { recursive: true });
    chmodSync(smokeCodexHome, 0o700);
  } catch {
    return { kind: "failed", setupResult: "codex-home-setup-failed" };
  }

  const realAuth = path.join(realPaths.codexHome, "auth.json");
  if (!isReadableRegularFile(realAuth)) return { kind: "failed", setupResult: "codex-auth-missing" };
  try {
    cpSync(realAuth, path.join(smokeCodexHome, "auth.json"));
    chmodSync(path.join(smokeCodexHome, "auth.json"), 0o600);
  } catch {
    return { kind: "failed", setupResult: "codex-auth-copy-failed" };
  }

  const agentsDir = path.join(realPaths.codexHome, "agents");
  const hooksFile = path.join(realPaths.codexHome, "hooks.json");
  if (!isDirectory(agentsDir) || !isReadableRegularFile(hooksFile)) {
    return { kind: "failed", setupResult: "codex-install-incomplete" };
  }
  try {
    cpSync(agentsDir, path.join(smokeCodexHome, "agents"), { recursive: true });
    cpSync(hooksFile, path.join(smokeCodexHome, "hooks.json"));
  } catch {
    return { kind: "failed", setupResult: "codex-payload-copy-failed" };
  }

  try {
    const fallow = resolveFallowMcpCommand(
      smokeCodexHome,
      environment,
      () => npmGlobalPrefixOf(environment),
      (name) => firstExecutableOnPath(environment, name),
    );
    const configText = `${renderCodexManagedConfig(smokeCodexHome, realPaths.runtimeRoot, fallow.command)}\n[features]\n${renderCodexManagedFeatures()}`;
    writeFileSync(path.join(smokeCodexHome, "config.toml"), configText);
    chmodSync(path.join(smokeCodexHome, "config.toml"), 0o600);
  } catch {
    return { kind: "failed", setupResult: "codex-config-render-failed" };
  }

  return { kind: "ready", codexHome: smokeCodexHome };
}

function npmGlobalPrefixOf(environment: NodeJS.ProcessEnv): string | undefined {
  const run = spawnSync("npm", ["prefix", "-g"], { env: environment, encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return undefined;
  const value = run.stdout.trim();
  return value === "" ? undefined : value;
}

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
