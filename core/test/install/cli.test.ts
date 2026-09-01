import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { ArgumentsExcludedError, FLAGS_PER_HOST_AND_VERB, FlagNotOfferedError, parseArgv } from "../../src/install/cli.ts";
import { hermeticVerifyEnvironment } from "../support/hermetic-verify-environment.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso.ts");
const cliBundle = path.join(repoRoot, "bootstrap", "oso.js");

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [flags]

arguments, per host and verb:
  claude    install  --yes --replace-claude-md --no-impeccable --no-git-hook
  claude    verify   (no arguments)
  claude    repair   --yes
  claude    purge    --yes
  codex     install  --yes --no-impeccable --no-git-hook
  codex     verify   (no arguments)
  codex     repair   --yes
  codex     purge    --yes
  opencode  install  --yes --no-impeccable --no-git-hook
  opencode  verify   (no arguments)
  opencode  repair   --yes --list [<backup>]
  opencode  purge    --yes --dry-run --keep-gentle-ai --restore <dir>

A flag offered to a host and verb that does not take it is refused, never ignored.
`;

function runCli(argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", cliSource, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runCliInAFixtureHome(argv: readonly string[], fixtureHome: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", cliSource, ...argv], {
    encoding: "utf8",
    env: hermeticVerifyEnvironment(fixtureHome),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function flagsFor(host: "claude" | "codex" | "opencode", verb: "install" | "verify" | "repair" | "purge"): string[] {
  return FLAGS_PER_HOST_AND_VERB[host][verb].flags.map((spec) => spec.name);
}

describe("oso <verb> --host <host> [flags] usage", () => {
  test("no arguments at all is a usage error", () => {
    const result = runCli([]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
    assert.equal(result.stdout, "");
  });

  test("an unrecognised verb is a usage error", () => {
    const result = runCli(["reinstall", "--host", "claude"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
  });

  test("a known verb with no --host is a usage error", () => {
    const result = runCli(["verify"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
  });

  test("an unrecognised host is a usage error", () => {
    const result = runCli(["verify", "--host", "windows"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
  });

  test("an unrecognised flag is a usage error", () => {
    const result = runCli(["verify", "--host", "claude", "--force"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
  });

  test("the usage text is rendered from the table, so a cell that changes cannot leave the text behind", () => {
    for (const line of ["  opencode  repair   --yes --list [<backup>]", "  claude    verify   (no arguments)"]) {
      assert.ok(USAGE.includes(line), line);
    }
  });
});

describe("the flag table is per host AND verb, populated from each bash script's own case block", () => {
  test("install carries the four flags bootstrap/install.sh takes, and the three its per-host siblings take", () => {
    assert.deepEqual(flagsFor("claude", "install"), ["--yes", "--replace-claude-md", "--no-impeccable", "--no-git-hook"]);
    assert.deepEqual(flagsFor("codex", "install"), ["--yes", "--no-impeccable", "--no-git-hook"]);
    assert.deepEqual(flagsFor("opencode", "install"), ["--yes", "--no-impeccable", "--no-git-hook"]);
  });

  test("verify takes no arguments on any host", () => {
    for (const host of ["claude", "codex", "opencode"] as const) assert.deepEqual(flagsFor(host, "verify"), []);
  });

  test("repair --host opencode carries --list and the one positional backup name the repair verb takes", () => {
    assert.deepEqual(flagsFor("opencode", "repair"), ["--yes", "--list"]);
    assert.equal(FLAGS_PER_HOST_AND_VERB.opencode.repair.positional?.name, "<backup>");
    assert.equal(parseArgv(["repair", "--host", "opencode", "--yes", "snapshot-name"]).positional, "snapshot-name");
  });

  test("purge --host opencode carries all four of its flags, and --restore takes its directory", () => {
    assert.deepEqual(flagsFor("opencode", "purge"), ["--yes", "--dry-run", "--keep-gentle-ai", "--restore"]);
    assert.equal(parseArgv(["purge", "--host", "opencode", "--restore", "/backups/one"]).values.get("--restore"), "/backups/one");
  });

  test("a flag a verb does not take is refused by name, naming the verb as well as the host", () => {
    assert.throws(
      () => parseArgv(["repair", "--host", "codex", "--no-impeccable"]),
      (error: unknown) => error instanceof FlagNotOfferedError && error.flag === "--no-impeccable" && error.verb === "repair",
    );
  });

  test("--replace-claude-md still parses for the one host and verb that takes it", () => {
    assert.ok(parseArgv(["install", "--host", "claude", "--replace-claude-md"]).flags.has("--replace-claude-md"));
    assert.throws(() => parseArgv(["install", "--host", "codex", "--replace-claude-md"]), FlagNotOfferedError);
  });

  test("a refused flag names the host, the verb and the flags that cell does take, on stderr, at exit 1", () => {
    const result = runCli(["install", "--host", "codex", "--replace-claude-md"]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "oso: --replace-claude-md is not a flag the codex host takes for install — it takes --yes, --no-impeccable, --no-git-hook\n",
    );
    assert.equal(result.stdout, "");
  });

  test("a positional offered to a verb that declares none is a usage error rather than a silently ignored token", () => {
    const result = runCli(["purge", "--host", "claude", "some-backup"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, USAGE);
  });

  test("a second backup name is refused with the words the repair verb refuses it with", () => {
    assert.throws(
      () => parseArgv(["repair", "--host", "opencode", "one", "two"]),
      (error: unknown) => error instanceof ArgumentsExcludedError && error.message === "only one backup name may be given",
    );
  });
});

describe("pairwise exclusions are ordered pairs, guarded from one arm and not from both", () => {
  for (const [first, second, message] of [
    ["--restore", "--yes", "--yes cannot be combined with --restore"],
    ["--dry-run", "--yes", "--yes cannot be combined with --dry-run"],
    ["--restore", "--dry-run", "--dry-run cannot be combined with --restore"],
    ["--yes", "--dry-run", "--dry-run cannot be combined with --yes"],
    ["--restore", "--keep-gentle-ai", "--keep-gentle-ai cannot be combined with --restore"],
    ["--yes", "--restore", "--yes cannot be combined with --restore"],
    ["--dry-run", "--restore", "--dry-run cannot be combined with --restore"],
  ] as const) {
    test(`${first} then ${second} is refused with "${message}"`, () => {
      assert.throws(
        () => parseArgv(["purge", "--host", "opencode", ...withValues(first), ...withValues(second)]),
        (error: unknown) => error instanceof ArgumentsExcludedError && error.message === message,
      );
    });
  }

  test("--keep-gentle-ai before --restore is ACCEPTED, which is the asymmetry the bash measures and this port keeps", () => {
    const parsed = parseArgv(["purge", "--host", "opencode", "--keep-gentle-ai", "--restore", "/backups/one"]);
    assert.deepEqual([...parsed.flags].sort(), ["--keep-gentle-ai", "--restore"]);
    assert.equal(parsed.values.get("--restore"), "/backups/one");
  });

  test("--restore twice is refused as a repeat rather than as a pair", () => {
    assert.throws(
      () => parseArgv(["purge", "--host", "opencode", "--restore", "/one", "--restore", "/two"]),
      (error: unknown) => error instanceof ArgumentsExcludedError && error.message === "--restore may be specified only once",
    );
  });

  test("--restore with no directory after it is refused with the arity message, not a silent empty value", () => {
    assert.throws(
      () => parseArgv(["purge", "--host", "opencode", "--restore"]),
      (error: unknown) => error instanceof ArgumentsExcludedError && error.message === "--restore requires a backup directory",
    );
  });
});

describe("oso verify --host claude resolves the repository root the same way from source and from the built bundle", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "oso-cli-repository-root-"));
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  function verifyReportFrom(entry: string, extraArgs: readonly string[], fixtureHome: string): string {
    const environment = hermeticVerifyEnvironment(fixtureHome);
    const result = spawnSync(process.execPath, [...extraArgs, entry, "verify", "--host", "claude"], { env: environment, encoding: "utf8" });
    return result.stdout;
  }

  test("the source entry point's report names no path under core/src/bootstrap", () => {
    const report = verifyReportFrom(cliSource, ["--experimental-strip-types"], mkdtempSync(path.join(sandbox, "home-")));
    assert.doesNotMatch(report, /core[\\/]src[\\/]bootstrap/);
  });

  test("the source entry and the built bundle produce byte-identical reports over the same fixture HOME", () => {
    const fixtureHome = mkdtempSync(path.join(sandbox, "home-"));
    const fromSource = verifyReportFrom(cliSource, ["--experimental-strip-types"], fixtureHome);
    const fromBundle = verifyReportFrom(cliBundle, [], fixtureHome);
    assert.equal(fromSource, fromBundle);
  });
});

describe("every verb of every host reaches its own command, so no host answers a verb with a not-implemented refusal", () => {
  const verbSandbox = mkdtempSync(path.join(tmpdir(), "oso-cli-opencode-"));
  after(() => rmSync(verbSandbox, { recursive: true, force: true }));

  for (const verb of ["install", "verify", "repair", "purge"] as const) {
    test(`${verb} --host opencode reaches the real command rather than a slice pointer`, () => {
      const result = runCliInAFixtureHome([verb, "--host", "opencode"], mkdtempSync(path.join(verbSandbox, "home-")));
      assert.doesNotMatch(result.stderr, /not yet implemented/);
      assert.doesNotMatch(result.stdout, /not yet implemented/);
    });
  }

  test("the CLI carries no not-implemented refusal at all, which is what makes the four above unable to pass vacuously", () => {
    assert.doesNotMatch(readFileSync(path.join(repoRoot, "core", "src", "install", "cli.ts"), "utf8"), /not yet implemented/);
  });
});

describe("install|repair|purge without --yes, on each host and verb this slice implements", () => {
  for (const host of ["claude", "codex"] as const) {
    for (const verb of ["install", "repair", "purge"] as const) {
      test(`${verb} --host ${host} reaches the real command rather than a slice pointer, and reports it needs --yes rather than prompting`, () => {
        const result = runCli([verb, "--host", host]);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, `oso ${verb} --host ${host} requires --yes in this slice — no interactive confirmation prompt is wired yet\n`);
        assert.equal(result.stderr, "");
      });
    }
  }
});

function withValues(flag: string): string[] {
  return flag === "--restore" ? [flag, "/backups/one"] : [flag];
}
