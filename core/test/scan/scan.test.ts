import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { loadScanFixtures, textFilesOf, type ProjectFiles, type ScanFixture } from "../support/scan-fixture.ts";
import {
  repositoryRoot,
  skipUnlessGitSeedsRepositories,
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  withStateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const PROJECT_DIRECTORY = "project";
const BASE_REF = "HEAD";
const FAILING_CHECK_FIXTURE = "comments-license-marker-only-exempts-own-comment.json";
const UNRESOLVABLE_REF = "no-such-ref-in-this-project";

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [
    process.execPath,
    "--experimental-strip-types",
    path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts"),
  ],
};

const fixtures = loadScanFixtures();
const failingCheckFixture = fixtures.find((fixture) => fixture.file === FAILING_CHECK_FIXTURE);

provedSomething(
  `${fixtures.length} scan fixture(s) loaded, at least one expecting a hit and at least one expecting none`,
  fixtures.some((fixture) => fixture.expect.hits.length > 0) &&
    fixtures.some((fixture) => fixture.expect.hits.length === 0),
  `${fixtures.length} fixture(s) loaded, ${fixtures.filter((fixture) => fixture.expect.hits.length > 0).length} of ` +
    "them expecting a hit — a suite whose fixtures all expect the same thing cannot tell a scanner that looks from " +
    "one that never does",
);

provedSomething(
  `${FAILING_CHECK_FIXTURE} is on disk, so the shipped executables below are run against this slice's failing check`,
  failingCheckFixture !== undefined,
  `no fixture file is named ${FAILING_CHECK_FIXTURE}, so the shipped executables were run against nothing`,
);

function writeProjectFiles(repository: string, files: ProjectFiles): void {
  for (const [relativePath, text] of Object.entries(textFilesOf(files))) {
    const target = path.join(repository, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

function scanLinesOf(subject: StateSubject, fixture: ScanFixture): string[] {
  return withStateSandbox("workspace", (sandbox) => {
    const repository = sandbox.seedGitRepository(PROJECT_DIRECTORY, textFilesOf(fixture.committed));
    writeProjectFiles(repository, fixture.worktree);
    const run = sandbox.run(subject, ["scan", fixture.verb, BASE_REF], { cwd: repository });
    assert.equal(run.exit, 0, `${subject.name} exited ${run.exit}: ${run.stderr}`);
    assert.equal(run.stderr, "");
    return run.stdout.split("\n").filter((line) => line !== "");
  });
}

function assertScanMatches(subject: StateSubject, fixture: ScanFixture): void {
  const lines = scanLinesOf(subject, fixture);
  assert.deepEqual(lines.slice(0, -1), [...fixture.expect.hits], `${subject.name} reported different hits`);
  assert.equal(lines.at(-1), fixture.expect.summary, `${subject.name} reported a different coverage summary`);
}

describe(
  `${fixtures.length} scan fixtures, each planted into its own git project and read by oso-state scan from that ` +
    "project's working directory",
  { skip: skipUnlessGitSeedsRepositories() },
  () => {
    for (const fixture of fixtures) {
      test(fixture.name, () => {
        assertScanMatches(CLI_SUBJECT, fixture);
      });
    }
  },
);

describe("a ref the project cannot resolve is refused by name rather than reported as a clean scan", {
  skip: skipUnlessGitSeedsRepositories(),
}, () => {
  test("scan comments against an unknown ref exits 1, writes no report and names the ref git rejected", () => {
    withStateSandbox("workspace", (sandbox) => {
      const repository = sandbox.seedGitRepository(PROJECT_DIRECTORY);
      const run = sandbox.run(CLI_SUBJECT, ["scan", "comments", UNRESOLVABLE_REF], { cwd: repository });
      assert.equal(run.exit, 1);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /^oso-state: scan: git .* exited \d+ in /);
      assert.ok(run.stderr.includes(UNRESOLVABLE_REF), `the refusal never named ${UNRESOLVABLE_REF}: ${run.stderr}`);
    });
  });
});

for (const subject of STATE_SUBJECTS) {
  describe(
    `the shipped ${subject.name} carries the same scan as the source it is bundled from`,
    { skip: skipUnlessSpawnable(subject) || skipUnlessGitSeedsRepositories() },
    () => {
      test(`${FAILING_CHECK_FIXTURE} produces the same hits and coverage through ${subject.name}`, () => {
        assert.ok(failingCheckFixture !== undefined);
        assertScanMatches(subject, failingCheckFixture);
      });
    },
  );
}
