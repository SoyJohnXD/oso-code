import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const TS_SCAN_PREFIXES = ["core/", "opencode/"];
const SHELL_SCAN_PREFIX = "tests/";
const TS_WINDOW_LINES = 3;
const SHELL_WINDOW_LINES_BEFORE = 2;
const SHELL_WINDOW_LINES_AFTER = 15;

const AUTO_PAIRING_CALLEES = [
  "withHookEnvironment(",
  "underFixtureHome(",
  "underFixtureHomeAsync(",
  "armStateUnder(",
];

const HOME_OBJECT_KEY_PATTERN = /(?<![A-Za-z0-9_$])HOME(?![A-Za-z0-9_$])\s*:/;
const HOME_ENV_ASSIGNMENT_PATTERN = /process\.env(?:\.HOME(?![A-Za-z0-9_$])|\[\s*["']HOME["']\s*\])\s*=(?!=)/;
const USERPROFILE_WORD_PATTERN = /\bUSERPROFILE\b/;

const SHELL_EXPORT_HOME_PATTERN = /\bexport\s+HOME=/;
const SHELL_HOME_NODE_PREFIX_PATTERN = /\bHOME=\S+(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+)*\s+(?:node|oso-state)\b/;
const SHELL_USERPROFILE_PAIRED_PATTERN = /\bUSERPROFILE\s*=|\bexport\s+USERPROFILE\b/;

export type UnpairedHomeSite = Readonly<{ file: string; line: number; text: string }>;

export function stripStringLiterals(lineText: string): string {
  let out = "";
  let quote: string | undefined;
  for (let index = 0; index < lineText.length; index += 1) {
    const character = lineText[index] as string;
    if (quote !== undefined) {
      if (character === "\\") {
        out += "  ";
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = undefined;
        out += character;
        continue;
      }
      out += " ";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      out += character;
      continue;
    }
    out += character;
  }
  return out;
}

function windowOf(lines: readonly string[], index: number, before: number, after: number): string {
  return lines.slice(Math.max(0, index - before), Math.min(lines.length, index + after + 1)).join("\n");
}

export function unpairedTsHomeSites(file: string, text: string): UnpairedHomeSite[] {
  const lines = text.split("\n");
  const sites: UnpairedHomeSite[] = [];
  lines.forEach((lineText, index) => {
    const stripped = stripStringLiterals(lineText);
    const buildsHomeKey = HOME_OBJECT_KEY_PATTERN.test(stripped);
    const assignsProcessEnvHome = HOME_ENV_ASSIGNMENT_PATTERN.test(lineText);
    if (!buildsHomeKey && !assignsProcessEnvHome) return;
    const window = windowOf(lines, index, TS_WINDOW_LINES, TS_WINDOW_LINES);
    const paired =
      USERPROFILE_WORD_PATTERN.test(window) || AUTO_PAIRING_CALLEES.some((callee) => window.includes(callee));
    if (!paired) sites.push({ file, line: index + 1, text: lineText.trim() });
  });
  return sites;
}

export function unpairedShellHomeSites(file: string, text: string): UnpairedHomeSite[] {
  const lines = text.split("\n");
  const sites: UnpairedHomeSite[] = [];
  lines.forEach((lineText, index) => {
    const isSuiteWideExport = SHELL_EXPORT_HOME_PATTERN.test(lineText);
    const isNodeReachingPrefix = SHELL_HOME_NODE_PREFIX_PATTERN.test(lineText);
    if (!isSuiteWideExport && !isNodeReachingPrefix) return;
    const window = windowOf(lines, index, SHELL_WINDOW_LINES_BEFORE, SHELL_WINDOW_LINES_AFTER);
    if (!SHELL_USERPROFILE_PAIRED_PATTERN.test(window)) sites.push({ file, line: index + 1, text: lineText.trim() });
  });
  return sites;
}

function trackedRepositoryFiles(): string[] {
  const listing = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(listing.status, 0, `git ls-files failed: ${listing.stderr}`);
  return listing.stdout.split("\n").filter((line) => line !== "");
}

const trackedFiles = trackedRepositoryFiles();
const tsFiles = trackedFiles.filter(
  (file) => file.endsWith(".ts") && TS_SCAN_PREFIXES.some((prefix) => file.startsWith(prefix)),
);
const shellFiles = trackedFiles.filter((file) => file.startsWith(SHELL_SCAN_PREFIX) && file.endsWith(".sh"));

provedSomething(
  `at least one TypeScript file under ${TS_SCAN_PREFIXES.join(", ")} and one shell file under ` +
    `${SHELL_SCAN_PREFIX} were scanned`,
  tsFiles.length > 0 && shellFiles.length > 0,
  `${tsFiles.length} TypeScript file(s) and ${shellFiles.length} shell file(s) were scanned, so this check ` +
    "compared nothing",
);

const tsFindings = tsFiles.flatMap((file) => unpairedTsHomeSites(file, readFileSync(path.join(repositoryRoot, file), "utf8")));
const shellFindings = shellFiles.flatMap((file) =>
  unpairedShellHomeSites(file, readFileSync(path.join(repositoryRoot, file), "utf8")),
);

describe(
  "core/src/state/store.ts:235's homeDirectoryFrom takes USERPROFILE over HOME on win32, so no tracked " +
    `TypeScript under ${TS_SCAN_PREFIXES.join(", ")} or shell script under ${SHELL_SCAN_PREFIX} may pin a child ` +
    "process's or a fixture's HOME without pairing USERPROFILE beside it, directly or through " +
    `${AUTO_PAIRING_CALLEES.join(", ")}`,
  () => {
    test("every TypeScript site that builds a `HOME:` env key or assigns `process.env.HOME` pairs USERPROFILE", () => {
      assert.deepEqual(tsFindings, [], tsFindings.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });

    test(
      "every tests/*.sh `export HOME=` or `HOME=… node`/`HOME=… oso-state` prefix pairs an " +
        "`export USERPROFILE`/`USERPROFILE=` nearby",
      () => {
        assert.deepEqual(
          shellFindings,
          [],
          shellFindings.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"),
        );
      },
    );
  },
);
