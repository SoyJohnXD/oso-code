import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  heldPlanOf,
  readValue,
  repositoryIdFor,
  sha256Hex,
  stateFileFor,
  stateRootDirectory,
  writeStateValues,
} from "@oso-code/core";
import { planApprovalTool, planCancelTool, PLAN_APPROVAL_TOOL_ID, PLAN_CANCEL_TOOL_ID } from "./approval.ts";
import { deriveRootId } from "./identity.ts";
import { underFixtureHome, underFixtureHomeAsync } from "../../test-support/state-fixture.ts";
import type { OsoToolContext, ToolHost } from "./tool.ts";

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
  base: string;
  repoDir: string;
  commonDir: string;
  owner: string;
  asked: Array<{ action: string; resources: readonly string[]; metadata?: Record<string, unknown> }>;
  host: ToolHost;
}

interface StateRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runStateVerb(fixture: ApprovalFixture, args: readonly string[], amendment = ""): StateRun {
  const result = spawnSync(
    process.execPath,
    [stateBinPathOfThisTree(), "--session", fixture.owner, ...args],
    { cwd: fixture.repoDir, input: amendment, encoding: "utf8", env: { ...process.env } },
  );
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "" };
}

function stateBinPathOfThisTree(): string {
  return fileURLToPath(new URL("../../../plugin/bin/oso-state", import.meta.url));
}

function stateKeyOf(fixture: ApprovalFixture, key: string): string {
  return underFixtureHome(fixture.base, () => readValue(stateFileFor(fixture.repoDir), key) ?? "");
}

function planArtifactsOf(fixture: ApprovalFixture): string {
  return underFixtureHome(fixture.base, () =>
    join(stateRootDirectory(), "plans", repositoryIdFor(stateFileFor(fixture.repoDir))));
}

type Assertion = ApprovalFixture["asked"][number];

function toolHostFor(directory: string, grant: (assertion: Assertion) => Promise<unknown>, asked: Assertion[] = []): ToolHost {
  return {
    permission: {
      assert: async (assertion: Assertion) => {
        asked.push(assertion);
        await grant(assertion);
      },
    },
    directoryOf: async () => directory,
  } as unknown as ToolHost;
}

const CALL = { sessionID: SESSION, agent: "build", messageID: "msg-1", id: "call-1" } as unknown as OsoToolContext;

async function withApprovalFixture(
  grant: (assertion: Assertion) => Promise<unknown>,
  run: (fixture: ApprovalFixture, call: OsoToolContext) => Promise<void>,
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
  const asked: Assertion[] = [];
  try {
    await underFixtureHomeAsync(base, () => run(
      { base, repoDir, commonDir: join(repoDir, ".git"), owner: deriveRootId(repoDir), asked, host: toolHostFor(repoDir, grant, asked) },
      CALL,
    ));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const granted = async (): Promise<undefined> => undefined;

const refused = async (): Promise<never> => {
  throw new Error("The user rejected permission to use this specific tool call.");
};

test("the approval lands only after the host grants the permission it asks for", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    const result = await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    const digest = sha256Hex(PLAN_DOCUMENT);
    assert.equal(result.metadata?.digest, digest);
    assert.ok(existsSync(join(planArtifactsOf(fixture), `approved-${digest}.md`)));
  });
});

test("the permission it asks for is the tool's own id, patterned on the exact document digest and linked to the call", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    assert.deepEqual(fixture.asked, [{
      sessionID: SESSION,
      agent: "build",
      action: PLAN_APPROVAL_TOOL_ID,
      resources: [sha256Hex(PLAN_DOCUMENT)],
      metadata: { digest: sha256Hex(PLAN_DOCUMENT), characters: PLAN_DOCUMENT.length },
      source: { type: "tool", messageID: "msg-1", id: "call-1" },
    }]);
  });
});

test("a refused permission leaves no approved plan behind", async () => {
  await withApprovalFixture(refused, async (fixture, call) => {
    await assert.rejects(
      () => planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call),
      /rejected permission/,
    );
    assert.equal(fixture.asked.length, 1);
    assert.ok(!existsSync(join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`)));
  });
});

test("a call with no document never reaches the operator", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    const tool = planApprovalTool(fixture.host);
    await assert.rejects(() => tool.execute({ plan: "  " }, call), /needs the plan document/);
    await assert.rejects(() => tool.execute({}, call), /needs the plan document/);
    assert.deepEqual(fixture.asked, []);
  });
});

const HOT_SLICE = "### Slice 3 — the amendment lane\n\n- Goal: cover the hot-slice route.\n";

test("a folder holding several repositories and no git of its own approves a plan and drives the state command", async () => {
  const base = mkdtempSync(join(tmpdir(), "oso-approval-multi-"));
  const parent = join(base, "workspace");
  mkdirSync(parent);
  for (const name of ["alpha", "beta"]) {
    mkdirSync(join(parent, name));
    git(join(parent, name), "init", "-b", "main");
  }
  try {
    await underFixtureHomeAsync(base, async () => {
      await planApprovalTool(toolHostFor(parent, granted)).execute({ plan: PLAN_DOCUMENT }, CALL);
      const owner = deriveRootId(parent);
      assert.notEqual(owner, "");
      const digest = sha256Hex(PLAN_DOCUMENT);
      const artifacts = join(stateRootDirectory(), "plans", repositoryIdFor(stateFileFor(parent)));
      assert.ok(existsSync(join(artifacts, `approved-${digest}.md`)));
      assert.equal(readValue(stateFileFor(parent), "plan_approval"), "approved");
      assert.equal(readValue(stateFileFor(parent), "plan_approval_session"), owner);
      const run = spawnSync(
        process.execPath,
        [stateBinPathOfThisTree(), "--session", owner, "amend-plan", "slice-3"],
        { cwd: parent, input: HOT_SLICE, encoding: "utf8", env: { ...process.env } },
      );
      assert.equal(run.status, 0, run.stderr);
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the approved plan is one the state command can amend in place", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    const approvedSnapshot = join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`);
    const beforeAmendment = readFileSync(approvedSnapshot, "utf8");
    const amendment = runStateVerb(fixture, ["amend-plan", "slice-3"], HOT_SLICE);
    assert.equal(amendment.status, 0, amendment.stderr);
    assert.equal(stateKeyOf(fixture, "plan_revision"), "1");
    assert.equal(stateKeyOf(fixture, "verify_green"), "false");
    assert.match(
      readFileSync(join(planArtifactsOf(fixture), "current.md"), "utf8"),
      /## Execution amendment — slice-3[\s\S]*Classification: in-scope[\s\S]*the amendment lane/,
    );
    assert.equal(readFileSync(approvedSnapshot, "utf8"), beforeAmendment);
  });
});

test("the grant publishes the plan keys the state command amends against, owned by OSO_AGENT", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    const digest = sha256Hex(PLAN_DOCUMENT);
    const artifacts = planArtifactsOf(fixture);
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

test("the approved artifact is the operator's own bytes, the same document every host's plan rail stores", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    const approved = readFileSync(
      join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`),
      "utf8",
    );
    assert.equal(approved, PLAN_DOCUMENT);
    assert.equal(sha256Hex(approved), stateKeyOf(fixture, "plan_approval_digest"));
  });
});

test("the pending approval state is never armed, so the catch-all deny stays inert", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    assert.notEqual(stateKeyOf(fixture, "plan_approval"), "pending");
  });
});

test("abandoning the plan needs the operator's grant and disarms without clearing the run", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    runStateVerb(fixture, ["set", "auto=running", "auto_change=opencode-runtime-parity", "active_slice=4"]);
    const result = await planCancelTool(fixture.host).execute({}, call);
    assert.equal(result.metadata?.digest, sha256Hex(PLAN_DOCUMENT));
    assert.equal(fixture.asked[1]?.action, PLAN_CANCEL_TOOL_ID);
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
    assert.ok(existsSync(join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`)));
  });
});

test("an abandoned plan can neither be amended nor promoted back to approved", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    await planCancelTool(fixture.host).execute({}, call);
    const amendment = runStateVerb(fixture, ["amend-plan", "slice-3"], HOT_SLICE);
    assert.notEqual(amendment.status, 0);
    assert.match(amendment.stderr, /pending or approved plan/);
    const promotion = runStateVerb(fixture, ["approve-plan", sha256Hex(PLAN_DOCUMENT)]);
    assert.notEqual(promotion.status, 0);
    assert.match(promotion.stderr, /not pending/);
    assert.equal(stateKeyOf(fixture, "plan_approval"), "cancelled");
  });
});

test("a refused abandonment leaves the approved plan standing", async () => {
  await withApprovalFixture(async (request) => {
    if (request.action === PLAN_CANCEL_TOOL_ID) {
      throw new Error("The user rejected permission to use this specific tool call.");
    }
    return undefined;
  }, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    await assert.rejects(() => planCancelTool(fixture.host).execute({}, call), /rejected permission/);
    assert.equal(stateKeyOf(fixture, "plan_approval"), "approved");
  });
});

const A_CLAUDE_SESSION = "0f7c2a1e-claude-session";

test("an approved plan whose gates another session now holds is refused and its state left byte-unchanged", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    writeStateValues(fixture.repoDir, A_CLAUDE_SESSION, ["active_slice=2"]);
    const stateFile = stateFileFor(fixture.repoDir);
    const before = readFileSync(stateFile, "utf8");
    await assert.rejects(
      () => planCancelTool(fixture.host).execute({}, call),
      new RegExp(`${PLAN_CANCEL_TOOL_ID} did not abandon the plan: the gates are owned by session ${A_CLAUDE_SESSION}`),
    );
    assert.equal(readFileSync(stateFile, "utf8"), before);
    assert.equal(stateKeyOf(fixture, "session"), A_CLAUDE_SESSION);
  });
});

test("a granted abandonment keeps the owner stamped on the state and logs its event", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await planApprovalTool(fixture.host).execute({ plan: PLAN_DOCUMENT }, call);
    await planCancelTool(fixture.host).execute({}, call);
    assert.equal(stateKeyOf(fixture, "session"), fixture.owner);
    const events = readFileSync(join(stateRootDirectory(), "events.jsonl"), "utf8");
    assert.match(events, new RegExp(`"event":"plan-approval-abandoned".*"session":"${fixture.owner}"`));
  });
});

test("with no approved plan of its own to abandon, the cancel tool never reaches the operator", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await assert.rejects(
      () => planCancelTool(fixture.host).execute({}, call),
      /has no approved plan to abandon/,
    );
    assert.deepEqual(fixture.asked, []);
  });
});

const REVISED_DOCUMENT = "# Repaso de cambios\n\nThe whole phase-5 document, revised.\n## Riesgos\nNone.\n";
const DELTA_OF_THE_REVISION = [
  "Plan delta: 1 changed, 1 added, 0 removed, 0 format-only, 0 unchanged, 0 moved.",
  "changed \"Repaso de cambios\"",
  "  - The whole phase-5 document.",
  "  + The whole phase-5 document, revised.",
  "added \"Riesgos\"",
  "  + ## Riesgos",
  "  + None.",
  "Dropped amendments: none.",
  "",
].join("\n");
const LATER_CALL = { ...CALL, messageID: "msg-2", id: "call-2" } as OsoToolContext;

function present(fixture: ApprovalFixture, plan: string, call: OsoToolContext = CALL) {
  return planApprovalTool(fixture.host).execute({ plan }, call);
}

function stateTextOf(fixture: ApprovalFixture): string {
  return underFixtureHome(fixture.base, () => readFileSync(stateFileFor(fixture.repoDir), "utf8"));
}

function stateAndArtifactsOf(fixture: ApprovalFixture): Readonly<{ state: string; artifacts: string[][] }> {
  const directory = planArtifactsOf(fixture);
  const artifacts = readdirSync(directory).sort().map((name) => [name, readFileSync(join(directory, name), "utf8")]);
  return { state: stateTextOf(fixture), artifacts };
}

function assertTheRevisionIsPresented(fixture: ApprovalFixture): void {
  assert.deepEqual(
    ["plan_presented_digest", "plan_presented_base", "plan_presented_turn"].map((key) => stateKeyOf(fixture, key)),
    [sha256Hex(REVISED_DOCUMENT), sha256Hex(PLAN_DOCUMENT), "msg-1"],
  );
}

function armSlice(fixture: ApprovalFixture, activeSlice: string): void {
  underFixtureHome(fixture.base, () => writeStateValues(fixture.repoDir, fixture.owner, [`active_slice=${activeSlice}`]));
}

function heldPlanKeysOf(fixture: ApprovalFixture): Record<string, string> {
  const keys = ["mode", "active_slice", "verify_green", "plan_approval", "plan_approval_digest", "plan_snapshot_file",
    "plan_current_file", "plan_revision"];
  return Object.fromEntries(keys.map((key) => [key, stateKeyOf(fixture, key)]));
}

const refusingTheDeltaPrompt = async (assertion: Assertion): Promise<undefined> => {
  if (assertion.metadata?.base !== undefined) await refused();
  return undefined;
};

const refusingTheWholePlanPrompt = async (assertion: Assertion): Promise<undefined> => {
  if (assertion.metadata?.base === undefined) await refused();
  return undefined;
};

test("a changed plan over an approved one returns the harness delta, raises no prompt and leaves the held plan in force", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    const heldBefore = heldPlanKeysOf(fixture);
    const result = await present(fixture, REVISED_DOCUMENT, call);
    assert.deepEqual(fixture.asked.slice(1), []);
    assert.deepEqual(result.metadata, {
      step: "delta",
      digest: sha256Hex(REVISED_DOCUMENT),
      base: sha256Hex(PLAN_DOCUMENT),
      deltaDigest: sha256Hex(DELTA_OF_THE_REVISION),
    });
    assert.ok(String(result.content).endsWith(`\n${DELTA_OF_THE_REVISION}`));
    assert.match(String(result.content), /VERBATIM[\s\S]*LATER turn/);
    assert.deepEqual(heldPlanKeysOf(fixture), heldBefore);
    assertTheRevisionIsPresented(fixture);
  });
});

test("the second call from the same turn is refused without a prompt", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    await present(fixture, REVISED_DOCUMENT, call);
    await assert.rejects(() => present(fixture, REVISED_DOCUMENT, call), /same turn[\s\S]*LATER turn/);
    assert.equal(fixture.asked.length, 1);
  });
});

test("the second call from a later turn raises one prompt bound to the new digest, then supersedes the held plan", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    await present(fixture, REVISED_DOCUMENT, call);
    const result = await present(fixture, REVISED_DOCUMENT, LATER_CALL);
    const digest = sha256Hex(REVISED_DOCUMENT);
    const deltaDigest = sha256Hex(DELTA_OF_THE_REVISION);
    assert.deepEqual(fixture.asked.slice(1), [{
      sessionID: SESSION,
      agent: "build",
      action: PLAN_APPROVAL_TOOL_ID,
      resources: [digest],
      metadata: {
        digest,
        characters: REVISED_DOCUMENT.length,
        base: sha256Hex(PLAN_DOCUMENT),
        deltaDigest,
        summary: "Plan delta: 1 changed, 1 added, 0 removed, 0 format-only, 0 unchanged, 0 moved. Dropped amendments: 0.",
      },
      source: { type: "tool", messageID: "msg-2", id: "call-2" },
    }]);
    const held = underFixtureHome(fixture.base, () => heldPlanOf(fixture.repoDir));
    assert.deepEqual(held.kind === "held" && [held.approval, held.digest, held.document], ["approved", digest, REVISED_DOCUMENT]);
    assert.equal(stateKeyOf(fixture, "plan_revision"), "1");
    assert.ok(existsSync(join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`)));
    assert.match(String(result.content), new RegExp(`${deltaDigest}[\\s\\S]*superseded[\\s\\S]*oso/\\{change\\}/plan`));
    assert.deepEqual(result.metadata, { digest, owner: fixture.owner, session: SESSION, base: sha256Hex(PLAN_DOCUMENT), deltaDigest });
  });
});

const UNREADABLE_HELD_SNAPSHOT = {
  name: "an unreadable held snapshot",
  spoil: (fixture: ApprovalFixture) => rmSync(join(planArtifactsOf(fixture), `approved-${sha256Hex(PLAN_DOCUMENT)}.md`)),
  refusedBy: PLAN_APPROVAL_TOOL_ID,
};

const UNCOMPUTABLE_DELTA_CAUSE =
  "current.md amendment \"Execution amendment — slice-9\" carries no metadata block before its text";

const UNCOMPUTABLE_DELTA = {
  name: "a delta the harness cannot compute",
  spoil: (fixture: ApprovalFixture) =>
    appendFileSync(join(planArtifactsOf(fixture), "current.md"), "\n## Execution amendment — slice-9\nno metadata\n"),
  refusedBy: "present-plan",
};

const SECOND_STEP_ROUTES = [{ name: "a computed delta", spoil: () => undefined }, UNCOMPUTABLE_DELTA];

for (const { name, spoil } of SECOND_STEP_ROUTES) {
  test(`a refused prompt over ${name} leaves the state and the held plan exactly as the first step left them`, async () => {
    await withApprovalFixture(refusingTheDeltaPrompt, async (fixture, call) => {
      await present(fixture, PLAN_DOCUMENT, call);
      spoil(fixture);
      await present(fixture, REVISED_DOCUMENT, call);
      const afterTheFirstStep = stateAndArtifactsOf(fixture);
      await assert.rejects(() => present(fixture, REVISED_DOCUMENT, LATER_CALL), /rejected permission/);
      assert.equal(fixture.asked.length, 2);
      assert.deepEqual(stateAndArtifactsOf(fixture), afterTheFirstStep);
    });
  });
}

test("a delta the harness cannot compute takes the two steps with the cause in its place, then supersedes", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    assert.equal(runStateVerb(fixture, ["amend-plan", "slice-3"], HOT_SLICE).status, 0);
    UNCOMPUTABLE_DELTA.spoil(fixture);
    const before = stateAndArtifactsOf(fixture);
    const digest = sha256Hex(REVISED_DOCUMENT);
    const base = sha256Hex(PLAN_DOCUMENT);
    const notice = await present(fixture, REVISED_DOCUMENT, call);
    assert.equal(fixture.asked.length, 1);
    assert.deepEqual(notice.metadata, { step: "delta", digest, base, deltaUnavailable: UNCOMPUTABLE_DELTA_CAUSE });
    assert.ok(String(notice.content).includes(`could not be computed: ${UNCOMPUTABLE_DELTA_CAUSE}.`));
    assert.match(String(notice.content), /delta was unavailable[\s\S]*whole new document[\s\S]*LATER turn/);
    const unpresented = (state: string) => state.split("\n").filter((line) => !line.startsWith("plan_presented_"));
    assert.deepEqual(unpresented(stateTextOf(fixture)), unpresented(before.state));
    const presentedSnapshot = [`presented-${digest}.md`, REVISED_DOCUMENT];
    assert.deepEqual(stateAndArtifactsOf(fixture).artifacts, [...before.artifacts, presentedSnapshot].sort());
    assertTheRevisionIsPresented(fixture);
    const result = await present(fixture, REVISED_DOCUMENT, LATER_CALL);
    assert.deepEqual(fixture.asked[1]?.metadata, {
      digest,
      characters: REVISED_DOCUMENT.length,
      base,
      deltaUnavailable: UNCOMPUTABLE_DELTA_CAUSE,
    });
    const held = underFixtureHome(fixture.base, () => heldPlanOf(fixture.repoDir));
    assert.deepEqual(held.kind === "held" && [held.approval, held.digest, held.document], ["approved", digest, REVISED_DOCUMENT]);
    assert.equal(stateKeyOf(fixture, "plan_revision"), "2");
    assert.ok(existsSync(join(planArtifactsOf(fixture), `approved-${base}.md`)));
    assert.ok(String(result.content).includes(`no delta digest, because the delta could not be computed: ${UNCOMPUTABLE_DELTA_CAUSE}.`));
    assert.deepEqual(result.metadata, {
      digest,
      owner: fixture.owner,
      session: SESSION,
      base,
      deltaUnavailable: UNCOMPUTABLE_DELTA_CAUSE,
    });
  });
});

test("a held plan whose first prompt was refused takes the same two steps and ends approved", async () => {
  await withApprovalFixture(refusingTheWholePlanPrompt, async (fixture, call) => {
    await assert.rejects(() => present(fixture, PLAN_DOCUMENT, call), /rejected permission/);
    assert.equal(stateKeyOf(fixture, "plan_approval"), "pending");
    const delta = await present(fixture, REVISED_DOCUMENT, call);
    assert.equal(delta.metadata?.step, "delta");
    await present(fixture, REVISED_DOCUMENT, LATER_CALL);
    assert.equal(fixture.asked.length, 2);
    assert.deepEqual(
      [stateKeyOf(fixture, "plan_approval"), stateKeyOf(fixture, "plan_approval_digest")],
      ["approved", sha256Hex(REVISED_DOCUMENT)],
    );
  });
});

test("an unreadable held snapshot falls back to the whole plan and names the cause", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    UNREADABLE_HELD_SNAPSHOT.spoil(fixture);
    const result = await present(fixture, REVISED_DOCUMENT, call);
    const digest = sha256Hex(REVISED_DOCUMENT);
    const cause = /the immutable snapshot is missing or unsafe/;
    assert.match(String(result.content), new RegExp(`^The plan delta was unavailable, .*?${cause.source}.*?\\. Tell the operator`));
    assert.match(String(result.metadata?.deltaUnavailable), cause);
    assert.deepEqual(fixture.asked[1]?.metadata, { digest, characters: REVISED_DOCUMENT.length });
    assert.deepEqual(
      [stateKeyOf(fixture, "plan_approval"), stateKeyOf(fixture, "plan_approval_digest")],
      ["approved", digest],
    );
  });
});

test("an active slice refuses the first step with the state's own message and writes nothing", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    armSlice(fixture, "2");
    const before = stateAndArtifactsOf(fixture);
    await assert.rejects(() => present(fixture, REVISED_DOCUMENT, call), /present-plan is refused while 2 is active/);
    assert.equal(fixture.asked.length, 1);
    assert.deepEqual(stateAndArtifactsOf(fixture), before);
  });
});

for (const activeSlice of ["2", "wave-1", "debt-sweep"]) {
  for (const { name, spoil, refusedBy } of [UNREADABLE_HELD_SNAPSHOT, UNCOMPUTABLE_DELTA]) {
    test(`${name} while ${activeSlice} is active is refused before any capture or prompt`, async () => {
      await withApprovalFixture(granted, async (fixture, call) => {
        await present(fixture, PLAN_DOCUMENT, call);
        armSlice(fixture, activeSlice);
        spoil(fixture);
        const before = stateAndArtifactsOf(fixture);
        await assert.rejects(
          () => present(fixture, REVISED_DOCUMENT, call),
          new RegExp(`${refusedBy} is refused while ${activeSlice} is active; close or abandon the active slice first$`),
        );
        assert.equal(fixture.asked.length, 1);
        assert.deepEqual(stateAndArtifactsOf(fixture), before);
      });
    });
  }
}

test("a pending plan presented again while a slice is active is refused before the prompt", async () => {
  await withApprovalFixture(refusingTheWholePlanPrompt, async (fixture, call) => {
    await assert.rejects(() => present(fixture, PLAN_DOCUMENT, call), /rejected permission/);
    armSlice(fixture, "2");
    const before = stateAndArtifactsOf(fixture);
    await assert.rejects(() => present(fixture, PLAN_DOCUMENT, LATER_CALL), /is refused while 2 is active/);
    assert.equal(fixture.asked.length, 1);
    assert.deepEqual(stateAndArtifactsOf(fixture), before);
  });
});

for (const { name, spoil } of SECOND_STEP_ROUTES) {
  test(`a slice armed between the two steps over ${name} refuses the second call before its prompt`, async () => {
    await withApprovalFixture(granted, async (fixture, call) => {
      await present(fixture, PLAN_DOCUMENT, call);
      spoil(fixture);
      await present(fixture, REVISED_DOCUMENT, call);
      armSlice(fixture, "2");
      const before = stateAndArtifactsOf(fixture);
      await assert.rejects(() => present(fixture, REVISED_DOCUMENT, LATER_CALL), /is refused while 2 is active/);
      assert.equal(fixture.asked.length, 1);
      assert.deepEqual(stateAndArtifactsOf(fixture), before);
      assertTheRevisionIsPresented(fixture);
    });
  });
}

test("with no plan held, an active slice still takes today's capture, prompt and approval", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    armSlice(fixture, "2");
    await present(fixture, PLAN_DOCUMENT, call);
    assert.equal(fixture.asked.length, 1);
    assert.deepEqual(
      [stateKeyOf(fixture, "plan_approval"), stateKeyOf(fixture, "plan_approval_digest"), stateKeyOf(fixture, "active_slice")],
      ["approved", sha256Hex(PLAN_DOCUMENT), "none"],
    );
  });
});

test("the document that is already the approved plan raises no prompt and changes nothing", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    const before = stateTextOf(fixture);
    const result = await present(fixture, PLAN_DOCUMENT, LATER_CALL);
    assert.match(String(result.content), /already the approved plan/);
    assert.equal(fixture.asked.length, 1);
    assert.equal(stateTextOf(fixture), before);
  });
});

test("a presentation recorded against another base restarts at the first step", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    await present(fixture, REVISED_DOCUMENT, call);
    underFixtureHome(fixture.base, () =>
      writeStateValues(fixture.repoDir, fixture.owner, [`plan_presented_base=${sha256Hex("a stale base")}`]));
    const result = await present(fixture, REVISED_DOCUMENT, LATER_CALL);
    assert.equal(result.metadata?.step, "delta");
    assert.equal(fixture.asked.length, 1);
    assert.deepEqual(
      [stateKeyOf(fixture, "plan_presented_base"), stateKeyOf(fixture, "plan_presented_turn")],
      [sha256Hex(PLAN_DOCUMENT), "msg-2"],
    );
  });
});

test("a recorded presentation whose snapshot file is gone is never taken for the second call", async () => {
  await withApprovalFixture(granted, async (fixture, call) => {
    await present(fixture, PLAN_DOCUMENT, call);
    await present(fixture, REVISED_DOCUMENT, call);
    const presentedSnapshot = join(planArtifactsOf(fixture), `presented-${sha256Hex(REVISED_DOCUMENT)}.md`);
    rmSync(presentedSnapshot);
    const result = await present(fixture, REVISED_DOCUMENT, LATER_CALL);
    assert.equal(result.metadata?.step, "delta");
    assert.equal(fixture.asked.length, 1);
    assert.equal(readFileSync(presentedSnapshot, "utf8"), REVISED_DOCUMENT);
  });
});
