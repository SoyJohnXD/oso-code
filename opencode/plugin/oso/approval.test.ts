import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planApprovalTool, planCancelTool, PLAN_APPROVAL_TOOL_ID, PLAN_CANCEL_TOOL_ID } from "./approval.ts";
import { deriveRootId } from "./identity.ts";
import { digestOf, repoStateDir } from "./plan.ts";
import type { HostPermissionRequest, PluginToolCall } from "./tool.ts";

const HARNESS_HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugin/hooks");

const PLAN_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document.\n";
const SESSION = "ses-approval";

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Approval Test",
  GIT_AUTHOR_EMAIL: "approval@test.local",
  GIT_COMMITTER_NAME: "Approval Test",
  GIT_COMMITTER_EMAIL: "approval@test.local",
};

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...COMMIT_ENV } });
  assert.equal(result.status, 0, result.stderr ?? "");
}

interface ApprovalFixture {
  repoDir: string;
  commonDir: string;
  owner: string;
  asked: HostPermissionRequest[];
}

interface StateRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runStateVerb(fixture: ApprovalFixture, args: readonly string[], amendment = ""): StateRun {
  const result = spawnSync(
    join(HARNESS_HOOKS_DIR, "..", "bin", "oso-state"),
    ["--session", fixture.owner, ...args],
    { cwd: fixture.repoDir, input: amendment, encoding: "utf8", env: { ...process.env } },
  );
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "" };
}

function stateKeyOf(fixture: ApprovalFixture, key: string): string {
  return runStateVerb(fixture, ["get", key]).stdout;
}

async function withApprovalFixture(
  grant: (request: HostPermissionRequest) => Promise<unknown>,
  run: (fixture: ApprovalFixture, call: PluginToolCall) => Promise<void>,
): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "oso-approval-"));
  const repoDir = join(base, "repo");
  mkdirSync(repoDir);
  git(repoDir, "init", "-b", "main");
  git(repoDir, "config", "user.name", "Approval Test");
  git(repoDir, "config", "user.email", "approval@test.local");
  writeFileSync(join(repoDir, "marker.txt"), "fixture\n");
  git(repoDir, "add", "marker.txt");
  git(repoDir, "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  const previous = {
    OSO_STATE_DIR: process.env.OSO_STATE_DIR,
    OSO_HOOKS_DIR: process.env.OSO_HOOKS_DIR,
    HOME: process.env.HOME,
  };
  process.env.HOME = base;
  process.env.OSO_STATE_DIR = join(base, ".local", "state", "oso-code");
  process.env.OSO_HOOKS_DIR = HARNESS_HOOKS_DIR;
  const asked: HostPermissionRequest[] = [];
  try {
    await run(
      { repoDir, commonDir: join(repoDir, ".git"), owner: deriveRootId(repoDir), asked },
      {
        sessionID: SESSION,
        directory: repoDir,
        ask: (request) => {
          asked.push(request);
          return grant(request);
        },
      },
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(base, { recursive: true, force: true });
  }
}

const granted = async (): Promise<undefined> => undefined;

const refused = async (): Promise<never> => {
  throw new Error("The user rejected permission to use this specific tool call.");
};

test("the approval lands only after the host grants the permission it asks for", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    const result = await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    const digest = digestOf(PLAN_DOCUMENT);
    assert.equal(result.metadata.digest, digest);
    assert.ok(existsSync(join(repoStateDir(fixture.commonDir), `approved-${digest}.md`)));
  });
});

test("the permission it asks for is the tool's own id, patterned on the exact document digest", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    assert.deepEqual(fixture.asked, [{
      permission: PLAN_APPROVAL_TOOL_ID,
      patterns: [digestOf(PLAN_DOCUMENT)],
      always: [],
      metadata: { digest: digestOf(PLAN_DOCUMENT), characters: PLAN_DOCUMENT.length },
    }]);
  });
});

test("an empty always list is what makes every approval prompt, never a grant carried over", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    assert.deepEqual(fixture.asked[0]?.always, []);
  });
});

test("a refused permission leaves no approved plan behind", async () => {
  await withApprovalFixture(refused, async (fixture, call) => {
    await assert.rejects(
      () => planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call),
      /rejected permission/,
    );
    assert.equal(fixture.asked.length, 1);
    assert.ok(!existsSync(join(repoStateDir(fixture.commonDir), `approved-${digestOf(PLAN_DOCUMENT)}.md`)));
  });
});

test("a host that hands the plugin no permission API cannot approve anything", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await assert.rejects(
      () => planApprovalTool().execute({ plan: PLAN_DOCUMENT }, { ...call, ask: undefined }),
      /handed the plugin no permission API/,
    );
    assert.ok(!existsSync(join(repoStateDir(fixture.commonDir), `approved-${digestOf(PLAN_DOCUMENT)}.md`)));
  });
});

test("a call with no session, no repository, or no document never reaches the operator", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    const tool = planApprovalTool();
    await assert.rejects(
      () => tool.execute({ plan: PLAN_DOCUMENT }, { ...call, sessionID: "" }),
      /named no session/,
    );
    await assert.rejects(
      () => tool.execute({ plan: PLAN_DOCUMENT }, { ...call, directory: tmpdir() }),
      /must run inside a git repository/,
    );
    await assert.rejects(() => tool.execute({ plan: "  " }, call), /needs the plan document/);
    await assert.rejects(() => tool.execute({}, call), /needs the plan document/);
    assert.deepEqual(fixture.asked, []);
  });
});

const HOT_SLICE = "### Slice 3 — the amendment lane\n\n- Goal: cover the hot-slice route.\n";

test("the approved plan is one the state command can amend in place", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    const approvedSnapshot = join(repoStateDir(fixture.commonDir), `approved-${digestOf(PLAN_DOCUMENT)}.md`);
    const beforeAmendment = readFileSync(approvedSnapshot, "utf8");
    const amendment = runStateVerb(fixture, ["amend-plan", "slice-3"], HOT_SLICE);
    assert.equal(amendment.status, 0, amendment.stderr);
    assert.equal(stateKeyOf(fixture, "plan_revision"), "1");
    assert.equal(stateKeyOf(fixture, "verify_green"), "false");
    assert.match(
      readFileSync(join(repoStateDir(fixture.commonDir), "current.md"), "utf8"),
      /## Execution amendment — slice-3[\s\S]*Classification: in-scope[\s\S]*the amendment lane/,
    );
    assert.equal(readFileSync(approvedSnapshot, "utf8"), beforeAmendment);
  });
});

test("the grant publishes the plan keys the state command amends against, owned by OSO_AGENT", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    const digest = digestOf(PLAN_DOCUMENT);
    const artifacts = repoStateDir(fixture.commonDir);
    assert.deepEqual(
      {
        mode: stateKeyOf(fixture, "mode"),
        plan_approval: stateKeyOf(fixture, "plan_approval"),
        plan_approval_digest: stateKeyOf(fixture, "plan_approval_digest"),
        plan_approval_session: stateKeyOf(fixture, "plan_approval_session"),
        plan_snapshot_file: stateKeyOf(fixture, "plan_snapshot_file"),
        plan_current_file: stateKeyOf(fixture, "plan_current_file"),
        plan_revision: stateKeyOf(fixture, "plan_revision"),
      },
      {
        mode: "plan",
        plan_approval: "approved",
        plan_approval_digest: digest,
        plan_approval_session: fixture.owner,
        plan_snapshot_file: join(artifacts, `approved-${digest}.md`),
        plan_current_file: join(artifacts, "current.md"),
        plan_revision: "0",
      },
    );
    assert.equal(deriveRootId(fixture.repoDir), fixture.owner);
  });
});

test("the artifact marker names the same owner the state file records", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    const approved = readFileSync(
      join(repoStateDir(fixture.commonDir), `approved-${digestOf(PLAN_DOCUMENT)}.md`),
      "utf8",
    );
    assert.equal(approved.split("\n", 1)[0], `<!-- oso-session: ${fixture.owner} -->`);
  });
});

test("the pending approval state is never armed, so the catch-all deny stays inert", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    assert.notEqual(stateKeyOf(fixture, "plan_approval"), "pending");
  });
});

test("abandoning the plan needs the operator's grant and disarms without clearing the run", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    runStateVerb(fixture, ["set", "auto=running", "auto_change=opencode-runtime-parity", "active_slice=4"]);
    const result = await planCancelTool().execute({}, call);
    assert.equal(result.metadata.digest, digestOf(PLAN_DOCUMENT));
    assert.equal(fixture.asked[1]?.permission, PLAN_CANCEL_TOOL_ID);
    assert.deepEqual(
      {
        mode: stateKeyOf(fixture, "mode"),
        active_slice: stateKeyOf(fixture, "active_slice"),
        verify_green: stateKeyOf(fixture, "verify_green"),
        plan_approval: stateKeyOf(fixture, "plan_approval"),
        auto: stateKeyOf(fixture, "auto"),
        auto_change: stateKeyOf(fixture, "auto_change"),
      },
      {
        mode: "plan",
        active_slice: "none",
        verify_green: "false",
        plan_approval: "cancelled",
        auto: "running",
        auto_change: "opencode-runtime-parity",
      },
    );
    assert.ok(existsSync(join(repoStateDir(fixture.commonDir), `approved-${digestOf(PLAN_DOCUMENT)}.md`)));
  });
});

test("an abandoned plan can neither be amended nor promoted back to approved", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    await planCancelTool().execute({}, call);
    const amendment = runStateVerb(fixture, ["amend-plan", "slice-3"], HOT_SLICE);
    assert.notEqual(amendment.status, 0);
    assert.match(amendment.stderr, /pending or approved plan/);
    const promotion = runStateVerb(fixture, ["approve-plan", digestOf(PLAN_DOCUMENT)]);
    assert.notEqual(promotion.status, 0);
    assert.match(promotion.stderr, /not pending/);
    assert.equal(stateKeyOf(fixture, "plan_approval"), "cancelled");
  });
});

test("a refused abandonment leaves the approved plan standing", async () => {
  await withApprovalFixture(async (request) => {
    if (request.permission === PLAN_CANCEL_TOOL_ID) {
      throw new Error("The user rejected permission to use this specific tool call.");
    }
    return undefined;
  }, async (fixture, call) => {
    await planApprovalTool().execute({ plan: PLAN_DOCUMENT }, call);
    await assert.rejects(() => planCancelTool().execute({}, call), /rejected permission/);
    assert.equal(stateKeyOf(fixture, "plan_approval"), "approved");
  });
});

test("with no approved plan of its own to abandon, the cancel tool never reaches the operator", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await assert.rejects(
      () => planCancelTool().execute({}, call),
      /has no approved plan to abandon/,
    );
    assert.deepEqual(fixture.asked, []);
  });
});
