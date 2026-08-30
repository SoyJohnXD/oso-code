import { homeDirectoryFrom } from "../state/store.ts";
import { installClaude, purgeClaude, repairClaude } from "./claude.ts";
import { verifyClaude } from "./verify-claude.ts";

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [--yes]

Only the claude host runs real checks/mutations in this slice; every other
host is not yet implemented.
`;

const VERBS = ["install", "verify", "repair", "purge"] as const;
type Verb = (typeof VERBS)[number];

const HOSTS = ["claude", "codex", "opencode"] as const;
type Host = (typeof HOSTS)[number];

class UsageError extends Error {}

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

type ParsedArgv = Readonly<{ verb: Verb; host: Host; assumeYes: boolean }>;

export function main(argv: readonly string[], repositoryRoot: string): number {
  try {
    return dispatch(argv, repositoryRoot);
  } catch (error) {
    return report(error);
  }
}

function dispatch(argv: readonly string[], repositoryRoot: string): number {
  const parsed = parseArgv(argv);
  if (parsed.host !== "claude") throw new VerbNotImplementedError(parsed.verb, parsed.host);

  const claudeContext = {
    homeDirectory: homeDirectoryFrom(process.platform, process.env),
    repositoryRoot,
    environment: process.env,
    platform: process.platform,
    assumeYes: parsed.assumeYes,
  };
  const outcome =
    parsed.verb === "verify"
      ? verifyClaude(claudeContext)
      : parsed.verb === "install"
        ? installClaude(claudeContext)
        : parsed.verb === "repair"
          ? repairClaude(claudeContext)
          : purgeClaude(claudeContext);
  process.stdout.write(outcome.report);
  return outcome.exitCode;
}

function report(error: unknown): number {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (error instanceof VerbNotImplementedError) {
    process.stderr.write(`oso: ${error.message}\n`);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso: ${message}\n`);
  return 1;
}

function parseArgv(argv: readonly string[]): ParsedArgv {
  const [verbToken, ...rest] = argv;
  if (!isVerb(verbToken)) throw new UsageError();
  let host: string | undefined;
  let assumeYes = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--host") {
      host = rest[index + 1];
      index += 1;
      continue;
    }
    if (token === "--yes") {
      assumeYes = true;
      continue;
    }
    throw new UsageError();
  }
  if (!isHost(host)) throw new UsageError();
  return { verb: verbToken, host, assumeYes };
}

function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && (VERBS as readonly string[]).includes(value);
}

function isHost(value: string | undefined): value is Host {
  return value !== undefined && (HOSTS as readonly string[]).includes(value);
}
