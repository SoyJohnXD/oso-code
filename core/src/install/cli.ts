import { homeDirectoryFrom } from "../state/store.ts";
import { installClaude, purgeClaude, repairClaude } from "./claude.ts";
import { installCodex, purgeCodex, repairCodex } from "./codex.ts";
import { verifyClaude } from "./verify-claude.ts";
import { verifyCodex } from "./verify-codex.ts";

const VERBS = ["install", "verify", "repair", "purge"] as const;
type Verb = (typeof VERBS)[number];

const HOSTS = ["claude", "codex", "opencode"] as const;
type Host = (typeof HOSTS)[number];

export const FLAGS = ["--yes", "--replace-claude-md", "--no-impeccable", "--no-git-hook"] as const;
export type Flag = (typeof FLAGS)[number];

export const FLAGS_PER_HOST: Readonly<Record<Host, readonly Flag[]>> = {
  claude: ["--yes", "--replace-claude-md", "--no-impeccable", "--no-git-hook"],
  codex: ["--yes", "--no-impeccable", "--no-git-hook"],
  opencode: ["--yes", "--no-impeccable", "--no-git-hook"],
};

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [flags]

flags, per host:
${HOSTS.map((host) => `  ${host.padEnd(9)} ${FLAGS_PER_HOST[host].join(" ")}`).join("\n")}

A flag offered to a host that does not take it is refused, never ignored.
The opencode host is not yet implemented.
`;

class UsageError extends Error {}

export class FlagNotOfferedError extends Error {
  readonly flag: string;
  readonly host: Host;
  constructor(flag: string, host: Host) {
    super(`${flag} is not a flag the ${host} host takes — it takes ${FLAGS_PER_HOST[host].join(", ")}`);
    this.name = "FlagNotOfferedError";
    this.flag = flag;
    this.host = host;
  }
}

export class VerbNotImplementedError extends Error {
  readonly verb: Verb;
  readonly host: Host;
  constructor(verb: Verb, host: Host) {
    super(`${verb} --host ${host} is not yet implemented in this slice`);
    this.name = "VerbNotImplementedError";
    this.verb = verb;
    this.host = host;
  }
}

export type ParsedArgv = Readonly<{ verb: Verb; host: Host; flags: ReadonlySet<Flag> }>;

export function main(argv: readonly string[], repositoryRoot: string): number {
  try {
    return dispatch(argv, repositoryRoot);
  } catch (error) {
    return report(error);
  }
}

function dispatch(argv: readonly string[], repositoryRoot: string): number {
  const parsed = parseArgv(argv);
  if (parsed.host === "opencode") throw new VerbNotImplementedError(parsed.verb, parsed.host);

  const context = {
    homeDirectory: homeDirectoryFrom(process.platform, process.env),
    repositoryRoot,
    environment: process.env,
    platform: process.platform,
    assumeYes: parsed.flags.has("--yes"),
    installImpeccable: !parsed.flags.has("--no-impeccable"),
    installGitHook: !parsed.flags.has("--no-git-hook"),
  };
  const outcome =
    parsed.host === "claude"
      ? runClaude(parsed.verb, { ...context, architecture: process.arch, replaceClaudeMd: parsed.flags.has("--replace-claude-md") })
      : runCodex(parsed.verb, context);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
}

function runClaude(verb: Verb, context: Parameters<typeof installClaude>[0]): { report: string; exitCode: number } {
  switch (verb) {
    case "verify":
      return verifyClaude(context);
    case "install":
      return installClaude(context);
    case "repair":
      return repairClaude(context);
    case "purge":
      return purgeClaude(context);
  }
}

function runCodex(verb: Verb, context: Parameters<typeof installCodex>[0]): { report: string; exitCode: number } {
  switch (verb) {
    case "verify":
      return verifyCodex(context);
    case "install":
      return installCodex(context);
    case "repair":
      return repairCodex(context);
    case "purge":
      return purgeCodex(context);
  }
}

function report(error: unknown): number {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso: ${message}\n`);
  return 1;
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const [verbToken, ...rest] = argv;
  if (!isVerb(verbToken)) throw new UsageError();
  let host: string | undefined;
  const offered: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--host") {
      host = rest[index + 1];
      index += 1;
      continue;
    }
    if (!isFlag(token)) throw new UsageError();
    offered.push(token);
  }
  if (!isHost(host)) throw new UsageError();
  const taken = FLAGS_PER_HOST[host];
  for (const flag of offered) {
    if (!taken.includes(flag as Flag)) throw new FlagNotOfferedError(flag, host);
  }
  return { verb: verbToken, host, flags: new Set(offered as Flag[]) };
}

function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && (VERBS as readonly string[]).includes(value);
}

function isHost(value: string | undefined): value is Host {
  return value !== undefined && (HOSTS as readonly string[]).includes(value);
}

function isFlag(value: string | undefined): value is Flag {
  return value !== undefined && (FLAGS as readonly string[]).includes(value);
}
