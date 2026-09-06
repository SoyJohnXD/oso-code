import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { abstractionScanReport } from "../../src/scan/abstraction-scan.ts";
import { commentScanReport } from "../../src/scan/comment-scan.ts";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SHIPPED_COMMENT_SCANNERS = [
  path.join(PROJECT_ROOT, "plugin", "dist", "oso-state.js"),
  path.join(PROJECT_ROOT, "plugin", "bin", "oso-state"),
];

function withRepository(run: (repository: string) => void): void {
  const repository = mkdtempSync(path.join(tmpdir(), "oso-scanner-safety-"));
  try {
    git(repository, ["init", "-q"]);
    git(repository, ["config", "user.email", "tests@oso-code.invalid"]);
    git(repository, ["config", "user.name", "oso-code tests"]);
    run(repository);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
}

function git(repository: string, argv: readonly string[], options: { readonly input?: string } = {}): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8", input: options.input });
}

function commit(repository: string, message: string): void {
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "-qm", message]);
}

describe("scanner input and filesystem boundaries", () => {
  test("rejects an option shaped ref before Git can write its output target", () => {
    withRepository((repository) => {
      writeFileSync(path.join(repository, "base.ts"), "export const base = 1;\n");
      commit(repository, "base");
      const sentinel = path.join(repository, "synthetic-sentinel");

      assert.throws(() => commentScanReport(repository, `--output=${sentinel}`), /scan ref cannot start/);
      assert.equal(existsSync(sentinel), false);
    });
  });

  test("accepts an empty tree ref while suppressing configured external diff helpers", () => {
    withRepository((repository) => {
      writeFileSync(path.join(repository, "base.ts"), "export const base = 1;\n");
      commit(repository, "base");
      const marker = path.join(repository, "diff-helper-ran");
      const helper = path.join(repository, "diff-helper.sh");
      writeFileSync(helper, "#!/bin/sh\nprintf helper > diff-helper-ran\n");
      chmodSync(helper, 0o755);
      git(repository, ["config", "diff.external", helper]);
      writeFileSync(path.join(repository, "added.ts"), "// added\n");
      const emptyTree = git(repository, ["hash-object", "-t", "tree", "--stdin"], { input: "" }).trim();

      const report = commentScanReport(repository, emptyTree);

      assert.match(report, /added\.ts:1: \/\/ added/);
      assert.equal(existsSync(marker), false);
    });
  });

  test("does not execute repository filters or filesystem monitor helpers", () => {
    withRepository((repository) => {
      writeFileSync(path.join(repository, "base.ts"), "export const base = 1;\n");
      commit(repository, "base");
      const marker = path.join(repository, "project-code-ran");
      const helper = path.join(repository, "project-helper.sh");
      writeFileSync(helper, "#!/bin/sh\nprintf executed > project-code-ran\ncat\n");
      chmodSync(helper, 0o755);
      git(repository, ["config", "filter.synthetic.clean", helper]);
      git(repository, ["config", "filter.synthetic.process", helper]);
      git(repository, ["config", "filter.synthetic.required", "true"]);
      git(repository, ["config", "core.fsmonitor", helper]);
      writeFileSync(path.join(repository, ".gitattributes"), "*.ts filter=synthetic\n");
      writeFileSync(path.join(repository, "added.ts"), "// added\n");

      assert.doesNotThrow(() => commentScanReport(repository, "HEAD"));
      assert.equal(existsSync(marker), false);
      assert.doesNotThrow(() => abstractionScanReport(repository, "HEAD"));
      assert.equal(existsSync(marker), false);

      for (const scanner of SHIPPED_COMMENT_SCANNERS) {
        assert.doesNotThrow(() => execFileSync(process.execPath, [scanner, "scan", "comments", "HEAD"], { cwd: repository, encoding: "utf8" }));
        assert.equal(existsSync(marker), false);
      }
    });
  });

  test("normalizes changed and project paths when scanning from a nested cwd", () => {
    withRepository((repository) => {
      const nested = path.join(repository, "sub");
      mkdirSync(nested);
      writeFileSync(path.join(nested, "consumer.ts"), "const usesCreated = created;\n");
      commit(repository, "base");
      writeFileSync(path.join(nested, "added.ts"), "// nested comment\n");
      writeFileSync(path.join(nested, "export.ts"), "export const created = 1;\n");

      const rootCommentReport = commentScanReport(repository, "HEAD");
      const nestedCommentReport = commentScanReport(nested, "HEAD");
      const rootAbstractionReport = abstractionScanReport(repository, "HEAD");
      const nestedAbstractionReport = abstractionScanReport(nested, "HEAD");

      assert.equal(nestedCommentReport, rootCommentReport);
      assert.match(rootCommentReport, /sub\/added\.ts:1: \/\/ nested comment/);
      assert.equal(nestedAbstractionReport, rootAbstractionReport);
      assert.match(rootAbstractionReport, /sub\/export\.ts:1: created is exported with 1 use site outside its declaration/);
    });
  });

  test("does not treat header shaped hunk content as a file path", () => {
    withRepository((repository) => {
      const outside = path.join(path.dirname(repository), `${path.basename(repository)}-outside.sh`);
      writeFileSync(outside, "# synthetic external note\n");
      try {
        writeFileSync(path.join(repository, "example.sh"), "original\n-- placeholder\n");
        commit(repository, "base");
        writeFileSync(path.join(repository, "example.sh"), `original\n++ b/../${path.basename(outside)}\nextra\n`);

        const report = commentScanReport(repository, "HEAD");

        assert.doesNotMatch(report, /synthetic external note/);
        assert.doesNotMatch(report, /\.\.\//);
      } finally {
        rmSync(outside, { force: true });
      }
    });
  });

  test("reports symlinked target and ancestor paths without reading outside bytes", () => {
    withRepository((repository) => {
      const outsideFile = path.join(path.dirname(repository), `${path.basename(repository)}-outside.ts`);
      const outsideDirectory = path.join(path.dirname(repository), `${path.basename(repository)}-outside-directory`);
      mkdirSync(outsideDirectory);
      writeFileSync(outsideFile, "// synthetic external note\n");
      writeFileSync(path.join(outsideDirectory, "safe.ts"), "// synthetic external ancestor note\n");
      try {
        writeFileSync(path.join(repository, "safe.ts"), "export const safe = 1;\n");
        mkdirSync(path.join(repository, "src"));
        writeFileSync(path.join(repository, "src", "safe.ts"), "export const nested = 1;\n");
        commit(repository, "base");
        unlinkSync(path.join(repository, "safe.ts"));
        symlinkSync(outsideFile, path.join(repository, "safe.ts"));
        rmSync(path.join(repository, "src"), { recursive: true, force: true });
        symlinkSync(outsideDirectory, path.join(repository, "src"));

        const report = commentScanReport(repository, "HEAD");

        assert.doesNotMatch(report, /synthetic external/);
        assert.match(report, /safe\.ts \(path uses a symbolic link: safe\.ts\)/);
        assert.match(report, /src\/safe\.ts \(path uses a symbolic link: src\)/);
      } finally {
        rmSync(outsideFile, { force: true });
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });

  test("keeps read causes visible in changed and abstraction coverage", () => {
    withRepository((repository) => {
      writeFileSync(path.join(repository, "broken.ts"), "export const broken = 1;\n");
      commit(repository, "base");
      unlinkSync(path.join(repository, "broken.ts"));
      mkdirSync(path.join(repository, "broken.ts"));

      const commentReport = commentScanReport(repository, "HEAD");
      const abstractionReport = abstractionScanReport(repository, "HEAD");

      assert.match(commentReport, /broken\.ts \(path is not a regular file: broken\.ts\)/);
      assert.match(abstractionReport, /1 project file\(s\) were not read: broken\.ts \(path is not a regular file: broken\.ts\)/);
    });
  });
});
