import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { approvePlan, capturePlan, digestOf, repoStateDir } from "./plan.ts";

async function withStateDir(fn: () => void | Promise<void>): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), "oso-plan-state-"));
  const previous = process.env.OSO_STATE_DIR;
  process.env.OSO_STATE_DIR = stateDir;
  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OSO_STATE_DIR;
    } else {
      process.env.OSO_STATE_DIR = previous;
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "oso-plan-test-"));
}

function withTraceCaptured(run: (traced: string[]) => void): void {
  const traced: string[] = [];
  const originalError = console.error;
  const originalStateBin = process.env.OSO_STATE_BIN;
  process.env.OSO_STATE_BIN = join(tmpdir(), "oso-state-that-does-not-exist");
  console.error = (...args: unknown[]) => {
    traced.push(args.map(String).join(" "));
  };
  try {
    run(traced);
  } finally {
    console.error = originalError;
    if (originalStateBin === undefined) {
      delete process.env.OSO_STATE_BIN;
    } else {
      process.env.OSO_STATE_BIN = originalStateBin;
    }
  }
}

test("capture writes the presented snapshot and current.md with the marker and the document digest", async () => {
  const dir = fixtureDir();
  const commonDir = join(dir, "repo", ".git");
  const doc = "# Plan\n\nPhase one.\n";
  const session = "ses-plan";
  try {
    await withStateDir(() => {
      const result = capturePlan(commonDir, session, doc);
      assert.equal(result.digest, digestOf(doc));
      const planDir = repoStateDir(commonDir);
      const presentedContent = readFileSync(join(planDir, `presented-${result.digest}.md`), "utf8");
      const currentContent = readFileSync(join(planDir, "current.md"), "utf8");
      assert.equal(presentedContent, currentContent);
      assert.equal(presentedContent, `<!-- oso-session: ${session} -->\n${doc}`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("approve promotes the presented snapshot to approved when parity holds", async () => {
  const dir = fixtureDir();
  const commonDir = join(dir, "repo", ".git");
  const doc = "# Plan\n\nPhase one.\n";
  const session = "ses-plan";
  try {
    await withStateDir(() => {
      const { digest, presented } = capturePlan(commonDir, session, doc);
      const verdict = approvePlan(commonDir, digest, session);
      assert.equal(verdict.ok, true);
      assert.ok(!existsSync(presented));
      assert.ok(existsSync(join(repoStateDir(commonDir), `approved-${digest}.md`)));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("approve refuses when current.md diverges from the presented snapshot", async () => {
  const dir = fixtureDir();
  const commonDir = join(dir, "repo", ".git");
  const doc = "# Plan\n\nPhase one.\n";
  const session = "ses-plan";
  try {
    await withStateDir(() => {
      const { digest } = capturePlan(commonDir, session, doc);
      appendFileSync(join(repoStateDir(commonDir), "current.md"), "Amended in place.\n");
      const verdict = approvePlan(commonDir, digest, session);
      assert.equal(verdict.ok, false);
      assert.equal(
        verdict.error,
        "the pending plan changed since it was presented; capture it again before approving",
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ownership: a different session cannot approve a pending plan", async () => {
  const dir = fixtureDir();
  const commonDir = join(dir, "repo", ".git");
  const doc = "# Plan\n\nPhase one.\n";
  try {
    await withStateDir(() => {
      capturePlan(commonDir, "ses-owner", doc);
      const verdict = approvePlan(commonDir, digestOf(doc), "ses-other");
      assert.equal(verdict.ok, false);
      assert.equal(verdict.error, "This session has no pending plan to approve.");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a half-written capture is tolerated, traced with its cause, and refused at approval", async () => {
  const dir = fixtureDir();
  const commonDir = join(dir, "repo", ".git");
  const doc = "# Plan\n\nPhase one.\n";
  const session = "ses-plan";
  try {
    await withStateDir(() => {
      mkdirSync(join(repoStateDir(commonDir), "current.md"), { recursive: true });
      withTraceCaptured((traced) => {
        const { digest, presented } = capturePlan(commonDir, session, doc);
        assert.equal(digest, digestOf(doc));
        assert.ok(existsSync(presented));
        assert.ok(!existsSync(join(repoStateDir(commonDir), `approved-${digest}.md`)));
        assert.equal(traced.length, 1);
        const [trace] = traced;
        assert.ok(trace);
        assert.match(trace, /plan\.capture: the plan snapshot is incomplete, so approval will refuse it: EISDIR/);
        const verdict = approvePlan(commonDir, digest, session);
        assert.equal(verdict.ok, false);
        assert.equal(
          verdict.error,
          "the pending plan changed since it was presented; capture it again before approving",
        );
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
