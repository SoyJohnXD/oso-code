import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { verifyClaude } from "../../src/install/verify-claude.ts";
import { hermeticVerifyEnvironment } from "../support/hermetic-verify-environment.ts";
import { withUnifiedPathSeparators } from "../support/parity-expectations.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const GRAMMAR_LINE_PATTERN = /^(ok:   |FAIL: |note: |skip: |      |----$|passed: )/;
const OK_CHECK_NAME_PATTERN = /^ok:   (.*) \(.*\)$/;
const FAIL_CHECK_NAME_PATTERN = /^FAIL: ([^—]*) — expected .*/;

function grammarLinesOf(report: string): string[] {
  return report
    .split("\n")
    .filter((line) => GRAMMAR_LINE_PATTERN.test(line))
    .map(withUnifiedPathSeparators);
}

function checkNamesOf(report: string): string[] {
  return report
    .split("\n")
    .flatMap((line) => {
      const ok = OK_CHECK_NAME_PATTERN.exec(line);
      if (ok !== null) return [ok[1] as string];
      const failed = FAIL_CHECK_NAME_PATTERN.exec(line);
      return failed === null ? [] : [(failed[1] as string).replace(/\s+$/, "")];
    })
    .sort();
}

function knownCheckNamesFromSource(): Set<string> {
  const source = readFileSync(path.join(repositoryRoot, "core", "src", "install", "verify-claude.ts"), "utf8");
  return new Set([...source.matchAll(/report\.check\(\s*"([^"]+)"/g)].map((match) => match[1] as string));
}

describe(
  "oso verify --host claude reproduces bootstrap/verify.sh's report over a PATH fixed to /usr/bin:/bin:/usr/local/bin, which reaches neither an installed claude nor an installed bash",
  () => {
    test(
      "a fresh, empty fixture HOME agrees with the bash oracle grammar line for grammar line when bash resolves at that fixed PATH, and otherwise the port's own report still parses to a real, known check-name set so a bash-less run can never silently count zero tests",
      () => {
        const fixtureHome = mkdtempSync(path.join(tmpdir(), "oso-verify-differential-"));
        try {
          const environment = hermeticVerifyEnvironment(fixtureHome);
          const bash = spawnSync("bash", [path.join(repositoryRoot, "bootstrap", "verify.sh")], {
            cwd: repositoryRoot,
            env: environment,
            encoding: "utf8",
          });
          const outcome = verifyClaude({ homeDirectory: fixtureHome, repositoryRoot, environment, platform: process.platform });

          if (bash.error === undefined) {
            assert.deepEqual(grammarLinesOf(outcome.report), grammarLinesOf(bash.stdout));
            assert.equal(outcome.exitCode, bash.status === null ? 1 : bash.status === 0 ? 0 : 1);
            return;
          }

          const known = knownCheckNamesFromSource();
          const names = checkNamesOf(outcome.report);
          assert.ok(
            names.length > 0,
            "the port's report named zero checks, so tools/verify-check-names.sh's grammar found nothing to compare",
          );
          for (const name of names) {
            assert.ok(known.has(name), `${name} is not among verify-claude.ts's own report.check(...) names`);
          }
        } finally {
          rmSync(fixtureHome, { recursive: true, force: true });
        }
      },
    );
  },
);

describe("grammarLinesOf's separator normalization", () => {
  test(
    "treats a win32 path.join Claude Desktop note as identical to bash's literal forward-slash note, the exact divergence measured on windows over an oso-verify-differential-* fixture home's Library/Application Support/Claude",
    () => {
      const fixtureHome = "C:\\Users\\RUNNER~1\\oso-verify-differential-abc";
      const desktopNoteOver = (installed: string): string =>
        `note: Claude Desktop — ${installed}; its Code tab runs the CLI's engine and shares this ~/.claude — CLAUDE.md, MCP servers, hooks, skills and settings — so every check above answers for it too; what no shell can see is whether a running Desktop has loaded them, and the chat tab is a separate surface nothing here writes`;
      const portReport = desktopNoteOver(path.win32.join(fixtureHome, "Library", "Application Support", "Claude"));
      const bashReport = desktopNoteOver(`${fixtureHome}/Library/Application Support/Claude`);
      assert.deepEqual(grammarLinesOf(portReport), grammarLinesOf(bashReport));
    },
  );

  test("does not swallow a genuine value divergence behind the separator normalization", () => {
    const portReport = "FAIL: oso-code plugin installed — expected 1, got 0\n----\npassed: 0, failed: 1\n";
    const bashReport = "FAIL: oso-code plugin installed — expected 1, got 1\n----\npassed: 0, failed: 1\n";
    assert.notDeepEqual(grammarLinesOf(portReport), grammarLinesOf(bashReport));
  });
});
