import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { isPlanRailFailure } from "../../src/gates/planrail.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { PlanFailure, runCapturePlan } from "../../src/state/plan.ts";
import { sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import {
  REPOSITORY_PLANS_DIR,
  repositoryRoot,
  STATE_FILE,
  withStateSandbox,
  type StateSandbox,
} from "../support/state-sandbox.ts";

const SESSION = "test-session";
const PLAN_DOCUMENT_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "plan-documents");
const PLAN_MARKER = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const CAPTURE_REFUSED =
  "oso-code: the approval document or its plan artifacts could not be recorded; execution remains blocked.";
const THE_REFUSAL_SLICE_TWO_EARNS =
  "capture-plan requires slice S2 to name failing-check: or Verify-exception: on its Verify line";
const SLICE_OPENERS_BOTH_DOCUMENTS_CARRY = ["- **S1 —", "- **S2 —", "- **S3 —"];

function planDocument(name: string): string {
  return readFileSync(path.join(PLAN_DOCUMENT_DIRECTORY, `${name}.md`), "utf8");
}

const SLICE_TWO_NAMES_NO_CHECK = planDocument("slice-two-names-no-check");
const EVERY_SLICE_NAMES_ITS_CHECK = planDocument("every-slice-names-its-check");
const AN_EXPAND_CONTRACT_SLICE_NAMES_NO_CHECK = planDocument("an-expand-contract-slice-that-names-no-check");
const A_RECAP_THAT_WRITES_NO_SLICE_BLOCK = planDocument("a-recap-that-writes-no-slice-block");
const THE_ONE_LINE_DOCUMENT_THE_PARITY_FIXTURES_CAPTURE = "Repaso de cambios\nFull slice plan: alpha\n";

provedSomething(
  "the refused document names both tokens in its other slices, so a document-wide search for either would have captured it",
  SLICE_TWO_NAMES_NO_CHECK.includes("failing-check:") && SLICE_TWO_NAMES_NO_CHECK.includes("Verify-exception:"),
  "the refused fixture names neither token anywhere in it, so a per-document reading and a per-slice reading would " +
    "both refuse it and this suite could not tell them apart",
);

provedSomething(
  "the accepted and the refused document open the same three slices, so the Verify line of the second is the only " +
    "thing that separates them",
  SLICE_OPENERS_BOTH_DOCUMENTS_CARRY.every(
    (opener) => SLICE_TWO_NAMES_NO_CHECK.includes(opener) && EVERY_SLICE_NAMES_ITS_CHECK.includes(opener),
  ),
  `one of ${SLICE_OPENERS_BOTH_DOCUMENTS_CARRY.join(", ")} is missing from one of the two documents, so what the ` +
    "refusal answers to is the shape of the document rather than the slice's own Verify line",
);

provedSomething(
  "the recap that writes no slice block still names its slices in prose, so the degrade is measured over a document " +
    "that talks about slices rather than one that never mentions any",
  A_RECAP_THAT_WRITES_NO_SLICE_BLOCK.includes("- S1 —"),
  "the recap fixture names no slice at all, so it proves nothing about a mention that is not a slice block",
);

function captured(sandbox: StateSandbox, document: string): number {
  return withHookEnvironment({ HOME: sandbox.home }, () =>
    runCapturePlan(sandbox.cwd, SESSION, sha256Hex(document), document),
  );
}

function currentPlanOf(sandbox: StateSandbox): string {
  const current = sandbox.read(`${REPOSITORY_PLANS_DIR}/current.md`);
  return current.kind === "file" ? current.content : `<${current.kind}>`;
}

function codexStopPayload(sandbox: StateSandbox, document: string): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: null,
    cwd: sandbox.cwd,
    permission_mode: "plan",
    hook_event_name: "Stop",
    turn_id: "turn-plan-stop",
    stop_hook_active: false,
    last_assistant_message: `${document}\n${PLAN_MARKER}`,
  });
}

describe(
  "core/src/state/plan.ts: capture-plan reads the Verify line of every slice block the document writes and refuses " +
    "the first that names neither of the two tokens plan.md §4 requires, while a document that writes no slice " +
    "block reaches the snapshot exactly as it was handed over",
  () => {
    test("the slice that names neither token is refused by its own name", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.throws(
          () => captured(sandbox, SLICE_TWO_NAMES_NO_CHECK),
          (thrown: unknown) =>
            isPlanRailFailure(thrown) && thrown instanceof PlanFailure && thrown.message === THE_REFUSAL_SLICE_TWO_EARNS,
        );
      });
    });

    test("that refusal writes no snapshot, no operational plan and no state", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.throws(() => captured(sandbox, SLICE_TWO_NAMES_NO_CHECK));
        const presented = `${REPOSITORY_PLANS_DIR}/presented-${sha256Hex(SLICE_TWO_NAMES_NO_CHECK)}.md`;
        assert.equal(sandbox.read(presented).kind, "absent");
        assert.equal(sandbox.read(`${REPOSITORY_PLANS_DIR}/current.md`).kind, "absent");
        assert.equal(sandbox.read(STATE_FILE).kind, "absent");
      });
    });

    test("the Codex Stop gate turns that refusal into a clean block and records the slice it named", () => {
      withStateSandbox("workspace", (sandbox) => {
        const run = withHookEnvironment({ HOME: sandbox.home }, () =>
          runGate(["planstop"], spawnedEnvelope(codexStopPayload(sandbox, SLICE_TWO_NAMES_NO_CHECK), process.env)),
        );
        assert.equal(run.exit, 0);
        assert.equal(run.stdout, `${JSON.stringify({ decision: "block", reason: CAPTURE_REFUSED })}\n`);
        assert.deepEqual(
          run.events.map((event) => event.command),
          [THE_REFUSAL_SLICE_TWO_EARNS],
        );
      });
    });

    test("the MIGRATE slice of §4's expand-contract template is refused by its own name", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.throws(
          () => captured(sandbox, AN_EXPAND_CONTRACT_SLICE_NAMES_NO_CHECK),
          (thrown: unknown) => thrown instanceof PlanFailure && thrown.message === THE_REFUSAL_SLICE_TWO_EARNS,
        );
      });
    });

    test("the same three slices, each naming its check or its exception, are captured", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.equal(captured(sandbox, EVERY_SLICE_NAMES_ITS_CHECK), 0);
        assert.equal(currentPlanOf(sandbox), EVERY_SLICE_NAMES_ITS_CHECK);
      });
    });

    test("a recap that names slices in prose but writes no slice block is captured", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.equal(captured(sandbox, A_RECAP_THAT_WRITES_NO_SLICE_BLOCK), 0);
        assert.equal(currentPlanOf(sandbox), A_RECAP_THAT_WRITES_NO_SLICE_BLOCK);
      });
    });

    test("the one-line document this repository's parity fixtures capture is captured", () => {
      withStateSandbox("workspace", (sandbox) => {
        assert.equal(captured(sandbox, THE_ONE_LINE_DOCUMENT_THE_PARITY_FIXTURES_CAPTURE), 0);
        assert.equal(currentPlanOf(sandbox), THE_ONE_LINE_DOCUMENT_THE_PARITY_FIXTURES_CAPTURE);
      });
    });
  },
);
