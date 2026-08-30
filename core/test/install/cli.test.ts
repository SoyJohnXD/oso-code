import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { hermeticVerifyEnvironment } from "../support/hermetic-verify-environment.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso.ts");
const cliBundle = path.join(repoRoot, "bootstrap", "oso.js");

const USAGE = `usage: oso <install|verify|repair|purge> --host <claude|codex|opencode> [--yes]

Only the claude host runs real checks/mutations in this slice; every other
host is not yet implemented.
`;

function runCli(argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", cliSource, ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("oso <verb> --host <host> [--yes] usage", () => {
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
    const result = runCli(["purge", "--host", "codex", "--yes"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "oso: purge --host codex is not yet implemented in this slice\n");
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
    ["verify", "codex"],
    ["verify", "opencode"],
    ["install", "codex"],
    ["install", "opencode"],
    ["repair", "codex"],
    ["repair", "opencode"],
    ["purge", "codex"],
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

describe("install|repair|purge --host claude without --yes", () => {
  for (const verb of ["install", "repair", "purge"] as const) {
    test(`${verb} --host claude reaches the real command (not VerbNotImplementedError) and reports it needs --yes rather than prompting`, () => {
      const result = runCli([verb, "--host", "claude"]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, `oso ${verb} --host claude requires --yes in this slice — no interactive confirmation prompt is wired yet\n`);
      assert.equal(result.stderr, "");
    });
  }
});

