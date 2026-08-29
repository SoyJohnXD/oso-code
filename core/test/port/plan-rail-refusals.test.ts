import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type SeededEntry, type StateSandbox } from "../support/state-sandbox.ts";

const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const STATE_FILE = ".local/state/oso-code/{repo}.state";
const WIRE_DOCUMENT = `Repaso\\n${PLAN_MARKER}`;
const DIGEST = sha256Hex(`Repaso de cambios\\nFull slice plan: alpha\\n${PLAN_MARKER}\\n`);
const PRESENTED = `.local/state/oso-code/plans/{repo}/presented-${DIGEST}.md`;
const CURRENT = ".local/state/oso-code/plans/{repo}/current.md";
const DOCUMENT = "Repaso de cambios\nFull slice plan: alpha";

const UNREADABLE = 0o000;
const READABLE_BEYOND_ITS_OWNER = 0o644;
const OWNER_READ_WRITE = 0o600;

const CAPTURE_REFUSED =
  "oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.";
const APPROVAL_REFUSED = "oso-code: the approve request lost its pending compare-and-set; the gate did not change.";

const STOP_PAYLOAD =
  '{"session_id":"test-session","transcript_path":null,"cwd":"{cwd}","permission_mode":"plan",' +
  `"hook_event_name":"Stop","turn_id":"turn-plan-stop","stop_hook_active":false,"last_assistant_message":"${WIRE_DOCUMENT}"}`;

const APPROVE_PAYLOAD =
  '{"session_id":"test-session","transcript_path":null,"cwd":"{cwd}","permission_mode":"default",' +
  '"hook_event_name":"UserPromptSubmit","turn_id":"turn-plan-prompt","prompt":"Implement the plan."}';

const PENDING_STATE =
  "mode=plan\nactive_slice=none\nverify_green=false\nplan_approval=pending\n" +
  `plan_approval_digest=${DIGEST}\nplan_approval_session=test-session\n` +
  `plan_snapshot_file={home}/${PRESENTED}\nplan_current_file={home}/${CURRENT}\n` +
  "plan_revision=0\nsession=test-session\n";

function skipUnlessChmodBites(): false | string {
  if (process.platform !== "win32") return false;
  return "win32 synthesises its own mode bits, so a file chmod'd here reads back with the mode it already had";
}

function judged(
  gate: string,
  payload: string,
  seed: Readonly<Record<string, SeededEntry>>,
  before: (sandbox: StateSandbox) => void = () => {},
): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    before(sandbox);
    const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate([gate], spawnedEnvelope(sandbox.expandJson(payload), process.env)));
    restoreModes(sandbox, Object.keys(seed));
    return run;
  });
}

function restoreModes(sandbox: StateSandbox, relativePaths: readonly string[]): void {
  for (const relativePath of relativePaths) {
    try {
      chmodSync(path.join(sandbox.home, sandbox.expand(relativePath)), OWNER_READ_WRITE);
    } catch {
      continue;
    }
  }
}

function chmodIn(sandbox: StateSandbox, relativePath: string, mode: number): void {
  chmodSync(path.join(sandbox.home, sandbox.expand(relativePath)), mode);
}

describe(
  "core/src/gates/planstop.ts: a capture the state rail refuses denies the Stop and records the cause. MEASURED " +
    "against plugin/hooks/capture-plan-approval.sh:131-135 on 2026-08-28, a cell the G5 carve-out table had " +
    "filled by reading: a state file chmod'd 000 under a permission_mode=plan payload gives exit 0, stdout " +
    '{"decision":"block","reason":"oso-code: the approval document or its plan artifacts could not be ' +
    'recorded; execution remains blocked."}, empty stderr, and one plan-approval-capture-blocked event whose ' +
    "command is the capture error — no transcript attestation is needed to reach it",
  () => {
    test("a state file the rail cannot read denies the Stop", { skip: skipUnlessChmodBites() }, () => {
      const run = judged("planstop", STOP_PAYLOAD, { [STATE_FILE]: "mode=plan\nsession=test-session\n" }, (sandbox) =>
        chmodIn(sandbox, STATE_FILE, UNREADABLE),
      );
      assert.deepEqual(
        { exit: run.exit, stdout: run.stdout, stderr: run.stderr },
        { exit: 0, stdout: `{"decision":"block","reason":"${CAPTURE_REFUSED}"}\n`, stderr: "" },
      );
      assert.equal(run.events[0]?.event, "plan-approval-capture-blocked");
      assert.match(String(run.events[0]?.command), /cannot read state at/);
    });

    test("a state path that is a directory reaches the same denial on every platform", () => {
      const run = judged("planstop", STOP_PAYLOAD, { [STATE_FILE]: { kind: "directory" } });
      assert.equal(run.stdout, `{"decision":"block","reason":"${CAPTURE_REFUSED}"}\n`);
      assert.deepEqual(
        run.events.map((event) => ({ event: event.event, gate: event.gate, hookEvent: event.hookEvent })),
        [{ event: "plan-approval-capture-blocked", gate: "capture-plan-approval.sh", hookEvent: "Stop" }],
      );
    });
  },
);

describe(
  "core/src/gates/planprompt.ts: native approval refuses a pending snapshot that is readable beyond its owner " +
    "(port of plugin/hooks/approve-plan-token.sh:125-129 over core/src/state/plan.ts:125-142, which the suite " +
    "exercises at tests/hooks-test.sh:1908-1919 and skips wherever chmod is a no-op)",
  () => {
    test("a non-private pending snapshot cannot be approved", { skip: skipUnlessChmodBites() }, () => {
      const run = judged(
        "planprompt",
        APPROVE_PAYLOAD,
        { [STATE_FILE]: PENDING_STATE, [PRESENTED]: DOCUMENT, [CURRENT]: DOCUMENT },
        (sandbox) => chmodIn(sandbox, PRESENTED, READABLE_BEYOND_ITS_OWNER),
      );
      assert.equal(run.stdout, `{"decision":"block","reason":"${APPROVAL_REFUSED}"}\n`);
      assert.equal(run.events[0]?.event, "plan-approval-approve-blocked");
    });
  },
);
