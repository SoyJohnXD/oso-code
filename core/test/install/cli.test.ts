import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { FLAGS, FLAGS_PER_HOST, FlagNotOfferedError, parseArgv } from "../../src/install/cli.ts";
import { hermeticVerifyEnvironment } from "../support/hermetic-verify-environment.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso.ts");
const cliBundle = path.join(repoRoot, "bootstrap", "oso.js");

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [flags]

flags, per host:
  claude    --yes --replace-claude-md --no-impeccable --no-git-hook
  codex     --yes --no-impeccable --no-git-hook
  opencode  --yes --no-impeccable --no-git-hook

A flag offered to a host that does not take it is refused, never ignored.
The opencode host is not yet implemented.
`;

function runCli(argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", cliSource, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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

  test("--yes is accepted for every verb without changing dispatch", () => {
    const result = runCli(["purge", "--host", "opencode", "--yes"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "oso: purge --host opencode is not yet implemented in this slice\n");
  });
});

describe("Decision 26c's per-host flag table refuses a flag rather than ignoring it", () => {
  test("every flag the table names is spelled by FLAGS, so the usage text cannot drift from the parser", () => {
    assert.deepEqual([...FLAGS], ["--yes", "--replace-claude-md", "--no-impeccable", "--no-git-hook"]);
  });

  test("claude takes all four flags", () => {
    assert.deepEqual([...FLAGS_PER_HOST.claude], [...FLAGS]);
  });

  for (const host of ["codex", "opencode"] as const) {
    test(`${host} takes the same three flags and refuses --replace-claude-md by name`, () => {
      assert.deepEqual([...FLAGS_PER_HOST[host]], ["--yes", "--no-impeccable", "--no-git-hook"]);
      assert.throws(
        () => parseArgv(["install", "--host", host, "--replace-claude-md"]),
        (error: unknown) =>
          error instanceof FlagNotOfferedError &&
          error.flag === "--replace-claude-md" &&
          error.host === host,
      );
    });

    test(`${host} reaches every flag it does take, so the refusal is not a blanket one`, () => {
      const parsed = parseArgv(["install", "--host", host, "--yes", "--no-impeccable", "--no-git-hook"]);
      assert.deepEqual([...parsed.flags].sort(), ["--no-git-hook", "--no-impeccable", "--yes"]);
    });
  }

  test("a refused flag names the host and the flags that host does take, on stderr, at exit 1", () => {
    const result = runCli(["install", "--host", "codex", "--replace-claude-md"]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "oso: --replace-claude-md is not a flag the codex host takes — it takes --yes, --no-impeccable, --no-git-hook\n",
    );
    assert.equal(result.stdout, "");
  });

  test("--replace-claude-md still parses for claude, which is the one host that takes it", () => {
    assert.ok(parseArgv(["install", "--host", "claude", "--replace-claude-md"]).flags.has("--replace-claude-md"));
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

describe("verb/host pairs this slice does not implement", () => {
  for (const [verb, host] of [
    ["verify", "opencode"],
    ["install", "opencode"],
    ["repair", "opencode"],
    ["purge", "opencode"],
  ] as const) {
    test(`${verb} --host ${host} reports not-yet-implemented rather than pretending success`, () => {
      const result = runCli([verb, "--host", host]);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, `oso: ${verb} --host ${host} is not yet implemented in this slice\n`);
      assert.equal(result.stdout, "");
    });
  }
});

describe("install|repair|purge without --yes, on each host this slice implements", () => {
  for (const host of ["claude", "codex"] as const) {
    for (const verb of ["install", "repair", "purge"] as const) {
      test(`${verb} --host ${host} reaches the real command (not VerbNotImplementedError) and reports it needs --yes rather than prompting`, () => {
        const result = runCli([verb, "--host", host]);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, `oso ${verb} --host ${host} requires --yes in this slice — no interactive confirmation prompt is wired yet\n`);
        assert.equal(result.stderr, "");
      });
    }
  }
});

