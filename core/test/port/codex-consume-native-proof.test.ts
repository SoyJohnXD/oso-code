import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  provedSomeSubjectIsMeasurable,
  skipUnlessGitSeedsRepositories,
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  withStateSandbox,
  type StateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const PARENT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const CANONICAL_AGENT_PATH = "/root/child";
const COORDINATES = ["--slice", "slice-native", "--attempt", "1", "--agent-type", "oso-applier"];
const CONSUME = ["handoff", "consume", ...COORDINATES, "--agent-id", CHILD, "--agent-path", CANONICAL_AGENT_PATH];
const RECEIPT_CONTENT =
  "version=1\nhook_session=hook-native\nslice=slice-native\nattempt=1\n" +
  `agent_id=${CHILD}\nagent_type=oso-applier\n`;

function seedRollout(sandbox: StateSandbox, repository: string, agentPath: string): void {
  const sessions = path.join(sandbox.home, ".codex", "sessions");
  mkdirSync(sessions, { recursive: true });
  const record = {
    type: "session_meta",
    payload: {
      id: CHILD,
      parent_thread_id: PARENT,
      agent_path: agentPath,
      agent_role: "oso-applier",
      cwd: repository,
      source: {
        subagent: {
          thread_spawn: { parent_thread_id: PARENT, depth: 1, agent_path: agentPath, agent_role: "oso-applier" },
        },
      },
    },
  };
  writeFileSync(path.join(sessions, "rollout-child.jsonl"), JSON.stringify(record) + "\n");
}

function published(subject: StateSubject, sandbox: StateSandbox, repository: string): void {
  const publish = sandbox.run(
    subject,
    ["handoff", "publish", ...COORDINATES, "--agent-id", CHILD, "--hook-session", "hook-native"],
    { cwd: repository },
  );
  assert.equal(publish.exit, 0, `${subject.name} publish exited ${publish.exit}: ${publish.stderr}`);
}

provedSomeSubjectIsMeasurable();

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: consume's native Codex proof, since no JSON parity fixture can start a real git repository ` +
      "or a rollout for it to read",
    { skip: skipUnlessSpawnable(subject) || skipUnlessGitSeedsRepositories() },
    () => {
      test("consume claims the exact receipt its own native rollout proves, then that same claim is one-shot", () => {
        withStateSandbox("workspace", (sandbox) => {
          const repository = sandbox.seedGitRepository("repo");
          seedRollout(sandbox, repository, CANONICAL_AGENT_PATH);
          published(subject, sandbox, repository);
          const consumed = sandbox.run(subject, CONSUME, { cwd: repository });
          assert.equal(consumed.exit, 0, `${subject.name} consume exited ${consumed.exit}: ${consumed.stderr}`);
          assert.equal(consumed.stdout, RECEIPT_CONTENT);
          const repeated = sandbox.run(subject, CONSUME, { cwd: repository });
          assert.equal(repeated.exit, 1);
          assert.equal(repeated.stdout, "");
        });
      });

      test("consume refuses a claim whose native rollout names a different canonical agent path — the security property that matters most", () => {
        withStateSandbox("workspace", (sandbox) => {
          const repository = sandbox.seedGitRepository("repo");
          seedRollout(sandbox, repository, "/root/other");
          published(subject, sandbox, repository);
          const refused = sandbox.run(subject, CONSUME, { cwd: repository });
          assert.equal(refused.exit, 1);
          assert.equal(refused.stdout, "");
          assert.match(refused.stderr, /agent path does not match/);
        });
      });

      test("consume refuses a claim with no native rollout to prove it at all", () => {
        withStateSandbox("workspace", (sandbox) => {
          const repository = sandbox.seedGitRepository("repo");
          mkdirSync(path.join(sandbox.home, ".codex", "sessions"), { recursive: true });
          published(subject, sandbox, repository);
          const refused = sandbox.run(subject, CONSUME, { cwd: repository });
          assert.equal(refused.exit, 1);
          assert.equal(refused.stdout, "");
          assert.match(refused.stderr, /found 0/);
        });
      });
    },
  );
}
