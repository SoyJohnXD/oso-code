import { homeDirectoryFrom } from "../state/store.ts";
import { codexHostProbes } from "./codex-host.ts";
import { installClaude, purgeClaude, repairClaude } from "./claude.ts";
import { installCodex, purgeCodex, repairCodex } from "./codex.ts";
import { opencodePathsFor, repairOpenCode } from "./opencode.ts";
import { openCodeHostProbes } from "./opencode-host.ts";
import { installOpenCode } from "./opencode-install.ts";
import { purgeOpenCode } from "./opencode-purge.ts";
import { setProfile, showProfile } from "./profile.ts";
import type { CommandOutcome } from "./report.ts";
import { verifyClaude } from "./verify-claude.ts";
import { verifyCodex } from "./verify-codex.ts";
import { verifyOpenCode } from "./verify-opencode.ts";

const VERBS = ["install", "verify", "repair", "purge"] as const;
type Verb = (typeof VERBS)[number];

const HOSTS = ["claude", "codex", "opencode"] as const;
type Host = (typeof HOSTS)[number];

export type FlagSpec = Readonly<{ name: string; valueMissingMessage?: string }>;
export type OrderedExclusion = Readonly<{ first: string; second: string; message: string }>;
export type PositionalSpec = Readonly<{ name: string; repeatMessage: string }>;
export type VerbArguments = Readonly<{
  flags: readonly FlagSpec[];
  exclusions?: readonly OrderedExclusion[];
  positional?: PositionalSpec;
}>;

const YES: FlagSpec = { name: "--yes" };
const LIST: FlagSpec = { name: "--list" };
const NO_IMPECCABLE: FlagSpec = { name: "--no-impeccable" };
const NO_GIT_HOOK: FlagSpec = { name: "--no-git-hook" };
const REPLACE_CLAUDE_MD: FlagSpec = { name: "--replace-claude-md" };
const DRY_RUN: FlagSpec = { name: "--dry-run" };
const KEEP_GENTLE_AI: FlagSpec = { name: "--keep-gentle-ai" };
const RESTORE: FlagSpec = { name: "--restore", valueMissingMessage: "--restore requires a backup directory" };

const NO_ARGUMENTS: VerbArguments = { flags: [] };
const YES_ONLY: VerbArguments = { flags: [YES] };

const ONE_BACKUP_NAME: PositionalSpec = { name: "<backup>", repeatMessage: "only one backup name may be given" };

const PURGE_OPENCODE_EXCLUSIONS: readonly OrderedExclusion[] = [
  { first: "--restore", second: "--yes", message: "--yes cannot be combined with --restore" },
  { first: "--dry-run", second: "--yes", message: "--yes cannot be combined with --dry-run" },
  { first: "--restore", second: "--dry-run", message: "--dry-run cannot be combined with --restore" },
  { first: "--yes", second: "--dry-run", message: "--dry-run cannot be combined with --yes" },
  { first: "--restore", second: "--keep-gentle-ai", message: "--keep-gentle-ai cannot be combined with --restore" },
  { first: "--restore", second: "--restore", message: "--restore may be specified only once" },
  { first: "--yes", second: "--restore", message: "--yes cannot be combined with --restore" },
  { first: "--dry-run", second: "--restore", message: "--dry-run cannot be combined with --restore" },
];

export const FLAGS_PER_HOST_AND_VERB: Readonly<Record<Host, Readonly<Record<Verb, VerbArguments>>>> = {
  claude: {
    install: { flags: [YES, REPLACE_CLAUDE_MD, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: YES_ONLY,
    purge: YES_ONLY,
  },
  codex: {
    install: { flags: [YES, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: YES_ONLY,
    purge: YES_ONLY,
  },
  opencode: {
    install: { flags: [YES, NO_IMPECCABLE, NO_GIT_HOOK] },
    verify: NO_ARGUMENTS,
    repair: { flags: [YES, LIST], positional: ONE_BACKUP_NAME },
    purge: { flags: [YES, DRY_RUN, KEEP_GENTLE_AI, RESTORE], exclusions: PURGE_OPENCODE_EXCLUSIONS },
  },
};

const EVERY_DECLARED_FLAG: ReadonlySet<string> = new Set(
  HOSTS.flatMap((host) => VERBS.flatMap((verb) => FLAGS_PER_HOST_AND_VERB[host][verb].flags.map((flag) => flag.name))),
);

const PROFILE_VERB = "profile";

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [flags]
       oso ${PROFILE_VERB} show | set <normal|strong|custom> [--applier|--verifier|--judges <default|strong>[:<model>]]

arguments, per host and verb:
${HOSTS.flatMap((host) => VERBS.map((verb) => `  ${host.padEnd(9)} ${verb.padEnd(8)} ${argumentSummary(FLAGS_PER_HOST_AND_VERB[host][verb])}`)).join("\n")}

A flag offered to a host and verb that does not take it is refused, never ignored.
The ${PROFILE_VERB} verb takes no --host: one profile spans every host, and only a custom names its roles.
`;

class UsageError extends Error {}

export class FlagNotOfferedError extends Error {
  readonly flag: string;
  readonly host: Host;
  readonly verb: Verb;
  constructor(flag: string, host: Host, verb: Verb) {
    const taken = FLAGS_PER_HOST_AND_VERB[host][verb].flags.map((spec) => spec.name);
    const takes = taken.length === 0 ? "no flags at all" : taken.join(", ");
    super(`${flag} is not a flag the ${host} host takes for ${verb} — it takes ${takes}`);
    this.name = "FlagNotOfferedError";
    this.flag = flag;
    this.host = host;
    this.verb = verb;
  }
}

export class ArgumentsExcludedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentsExcludedError";
  }
}

export type ParsedArgv = Readonly<{
  verb: Verb;
  host: Host;
  flags: ReadonlySet<string>;
  values: ReadonlyMap<string, string>;
  positional: string | undefined;
}>;

export function main(argv: readonly string[], repositoryRoot: string): number {
  try {
    return dispatch(argv, repositoryRoot);
  } catch (error) {
    return report(error);
  }
}

function dispatch(argv: readonly string[], repositoryRoot: string): number {
  const outcome = argv[0] === PROFILE_VERB ? runProfile(argv.slice(1), process.cwd()) : runHostVerb(argv, repositoryRoot);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
}

function runProfile(argv: readonly string[], workingDirectory: string): CommandOutcome {
  const [subverb, name, ...roleTokens] = argv;
  if (subverb === "show" && argv.length === 1) return showProfile(workingDirectory, renderedOpenCodeConfigFile());
  if (subverb === "set" && name !== undefined) return setProfile(workingDirectory, name, roleTokens);
  throw new UsageError();
}

function renderedOpenCodeConfigFile(): string {
  return opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env).configFile;
}

function runHostVerb(argv: readonly string[], repositoryRoot: string): CommandOutcome {
  const parsed = parseArgv(argv);
  const homeDirectory = homeDirectoryFrom(process.platform, process.env);
  const context = {
    homeDirectory,
    repositoryRoot,
    environment: process.env,
    platform: process.platform,
    assumeYes: parsed.flags.has("--yes"),
    installImpeccable: !parsed.flags.has("--no-impeccable"),
    installGitHook: !parsed.flags.has("--no-git-hook"),
  };
  return runHost(parsed, context);
}

type CommandContext = Readonly<{
  homeDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  assumeYes: boolean;
  installImpeccable: boolean;
  installGitHook: boolean;
}>;

function runHost(parsed: ParsedArgv, context: CommandContext): { report: string; exitCode: number } {
  switch (parsed.host) {
    case "claude":
      return runClaude(parsed.verb, { ...context, architecture: process.arch, replaceClaudeMd: parsed.flags.has("--replace-claude-md") });
    case "codex":
      return runCodex(parsed.verb, { ...context, host: codexHostProbes(process.env) });
    case "opencode":
      return runOpenCode(parsed, context);
  }
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

function runOpenCode(parsed: ParsedArgv, context: CommandContext): { report: string; exitCode: number } {
  switch (parsed.verb) {
    case "install":
      return installOpenCode({
        homeDirectory: context.homeDirectory,
        repositoryRoot: context.repositoryRoot,
        environment: context.environment,
        platform: context.platform,
        host: openCodeHostProbes(context.environment),
        assumeYes: context.assumeYes,
        installImpeccable: context.installImpeccable,
        installGitHook: context.installGitHook,
      });
    case "verify":
      return verifyOpenCode({
        homeDirectory: context.homeDirectory,
        repositoryRoot: context.repositoryRoot,
        environment: context.environment,
        platform: context.platform,
        host: openCodeHostProbes(context.environment),
      });
    case "repair":
      return repairOpenCode({
        homeDirectory: context.homeDirectory,
        environment: context.environment,
        assumeYes: context.assumeYes,
        listBackups: parsed.flags.has("--list"),
        backupName: parsed.positional,
      });
    case "purge":
      return purgeOpenCode({
        homeDirectory: context.homeDirectory,
        environment: context.environment,
        assumeYes: context.assumeYes,
        dryRun: parsed.flags.has("--dry-run"),
        keepGentleAi: parsed.flags.has("--keep-gentle-ai"),
        restoreFrom: parsed.values.get("--restore"),
      });
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
  const host = hostIn(rest);
  const declared = FLAGS_PER_HOST_AND_VERB[host][verbToken];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let positional: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (token === "--host") {
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      if (declared.positional === undefined) throw new UsageError();
      if (positional !== undefined) throw new ArgumentsExcludedError(declared.positional.repeatMessage);
      positional = token;
      continue;
    }
    const spec = declared.flags.find((candidate) => candidate.name === token);
    if (spec === undefined) {
      if (EVERY_DECLARED_FLAG.has(token)) throw new FlagNotOfferedError(token, host, verbToken);
      throw new UsageError();
    }
    refuseExcluded(declared, flags, token);
    if (spec.valueMissingMessage !== undefined) {
      const value = rest[index + 1];
      if (value === undefined) throw new ArgumentsExcludedError(spec.valueMissingMessage);
      values.set(token, value);
      index += 1;
    }
    flags.add(token);
  }
  return { verb: verbToken, host, flags, values, positional };
}

function refuseExcluded(declared: VerbArguments, seen: ReadonlySet<string>, token: string): void {
  const excluded = (declared.exclusions ?? []).find((rule) => rule.second === token && seen.has(rule.first));
  if (excluded !== undefined) throw new ArgumentsExcludedError(excluded.message);
}

function hostIn(rest: readonly string[]): Host {
  const at = rest.indexOf("--host");
  const host = at === -1 ? undefined : rest[at + 1];
  if (!isHost(host)) throw new UsageError();
  return host;
}

function argumentSummary(declared: VerbArguments): string {
  const flags = declared.flags.map((spec) => (spec.valueMissingMessage === undefined ? spec.name : `${spec.name} <dir>`));
  const positional = declared.positional === undefined ? [] : [`[${declared.positional.name}]`];
  return [...flags, ...positional].join(" ") || "(no arguments)";
}

function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && (VERBS as readonly string[]).includes(value);
}

function isHost(value: string | undefined): value is Host {
  return value !== undefined && (HOSTS as readonly string[]).includes(value);
}
