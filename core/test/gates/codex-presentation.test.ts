import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { PLANPROMPT_GATE } from "../../src/gates/planprompt.ts";
import { resolveCodexTurn } from "../../src/hosts/codex-turn.ts";
import { readEnvelope } from "../../src/hosts/envelope.ts";
import { CodexPresentationFailure, resolveCodexPresentation } from "../../src/hosts/codex-presentation.ts";
import { runApprovePlan, runCapturePlan } from "../../src/state/plan.ts";
import { readValue, sha256Hex, stateFileFor, writeStatePairs } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { repositoryRoot, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const session = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const marker = "<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->";
const turn = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const approvalTurn = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
const invalid = "## S1 — change\n- Depends-on: none\n- Verify: tests pass\n";
const valid = "## S1 — change\n- Depends-on: none\n- Verify: failing-check: regression\n";
const event = (payload: object) => ({ type: "event_msg", payload });
const started = (turnId: string, mode: string) => event({ type: "task_started", turn_id: turnId, collaboration_mode_kind: mode });

function presentation(id: string, document: string): object[] {
  return [
    event({ type: "item_completed", thread_id: session, turn_id: turn, item: { type: "Plan", id: `${turn}-plan`, text: document } }),
    event({ type: "item_completed", thread_id: session, turn_id: turn, item: { type: "AgentMessage", id, phase: "final_answer", content: [{ type: "Text", text: marker }] } }),
    { type: "response_item", payload: { type: "message", role: "assistant", id, phase: "final_answer", content: [{ type: "output_text", text: `<proposed_plan>\n${document}</proposed_plan>\n${marker}` }] } },
  ];
}

type PresentationFixture = { records: object[]; sandbox: StateSandbox; transcript: string; gate: (name: string, input: object, rewrite?: (text: string) => string) => ReturnType<typeof runGate>; stop: (active?: boolean) => ReturnType<typeof runGate>; approve: () => ReturnType<typeof runGate>; approval: () => string | undefined };

function scenario(run: (fixture: PresentationFixture) => void): void {
  withStateSandbox("workspace", (sandbox) => withHookEnvironment(sandbox.hookEnvironment(), () => {
    const transcript = path.join(sandbox.cwd, "rollout.jsonl");
    const records: object[] = [{ type: "session_meta", payload: { id: session, session_id: session, cwd: sandbox.cwd, source: "cli" } }, started(turn, "plan")];
    const gate = (name: string, input: object, rewrite = (text: string) => text) => {
      writeFileSync(transcript, rewrite(records.map((record) => JSON.stringify(record)).join("\n") + "\n"));
      return runGate([name], readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, ...input }), caller));
    };
    run({ records, sandbox, transcript, gate, stop: (active = false) => gate("planstop", { turn_id: turn, last_assistant_message: marker, stop_hook_active: active }), approve: () => gate("planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." }), approval: () => readValue(stateFileFor(sandbox.cwd), "plan_approval") });
  }));
}

test("invalid first and corrected distinct final in the same native turn captures on active retry", () => {
  scenario(({ records, stop, approval }) => {
    records.push(...presentation("first", invalid));
    assert.equal(stop().verdict.kind, "deny");
    records.push(...presentation("corrected", valid));
    assert.equal(stop(true).verdict.kind, "allow");
    assert.equal(approval(), "pending");
  });
});

test("split LF and Unicode document keeps exact wire digest, private binding and approval parity", () => {
  scenario(({ records, stop, approve, approval, sandbox }) => {
    const document = `${valid}Café e\u0301 🚀\n\n`;
    records.push(...presentation("unicode", document));
    assert.equal(stop().verdict.kind, "allow");
    const state = stateFileFor(sandbox.cwd);
    assert.equal(readValue(state, "plan_approval_digest"), sha256Hex(`${JSON.stringify(document).slice(1, -1)}\\n${marker}`));
    assert.equal(readValue(state, "plan_presentation_version"), "1");
    assert.equal(readValue(state, "plan_presentation_turn"), turn);
    assert.equal(readValue(state, "plan_presentation_message"), "unicode");
    assert.equal(readFileSync(readValue(state, "plan_current_file") as string, "utf8"), document);
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "context");
    assert.equal(approval(), "approved");
  });
});

test("full transport binds same-id raw/final/Stop without requiring a rendered Plan", () => {
  scenario(({ records, gate, approve, sandbox }) => {
    const document = `${valid}Café\r\n`;
    const message = `${document}\n${marker}\n`;
    records.push(
      event({ type: "item_completed", thread_id: session, turn_id: turn, item: { type: "AgentMessage", id: "full", phase: "final_answer", content: [{ type: "Text", text: message }] } }),
      { type: "response_item", payload: { type: "message", role: "assistant", id: "full", phase: "final_answer", content: [{ type: "output_text", text: message }] } },
    );
    assert.equal(gate("planstop", { turn_id: turn, last_assistant_message: message }).verdict.kind, "allow");
    const state = stateFileFor(sandbox.cwd);
    assert.equal(readValue(state, "plan_approval_digest"), sha256Hex(JSON.stringify(message).slice(1, -1)));
    assert.equal(readFileSync(readValue(state, "plan_current_file") as string, "utf8"), document);
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "context");
  });
});

const corruptions: Readonly<Record<string, (records: object[]) => void>> = {
  "same-id duplicate Plan": (records) => records.splice(2, 0, records[2] as object),
  "same-id duplicate final": (records) => records.splice(4, 0, records[3] as object),
  "same-id duplicate raw": (records) => records.push(records[4] as object),
  "missing raw": (records) => records.pop(),
  "missing final": (records) => records.splice(3, 1),
  "missing Plan": (records) => records.splice(2, 1),
  "new incomplete Plan": (records) => records.push(records[2] as object),
  "foreign Plan turn": (records) => records[2] = event({ type: "item_completed", thread_id: session, turn_id: "foreign", item: { type: "Plan", text: valid } }),
  "foreign Plan session": (records) => records[2] = event({ type: "item_completed", thread_id: "foreign", turn_id: turn, item: { type: "Plan", text: valid } }),
  "raw pairing mismatch": (records) => records[4] = presentation("other", valid)[2] as object,
  "rendered body mismatch": (records) => records[2] = presentation("first", "different\n")[0] as object,
  "Unicode normalization mismatch": (records) => records[2] = presentation("first", valid.normalize("NFD") + "é")[0] as object,
  "multiple blocks": (records) => records[4] = presentation("first", `${valid}</proposed_plan><proposed_plan>\nextra\n`)[2] as object,
  "empty Plan": (records) => records.splice(2, 3, ...presentation("first", "")),
  "unpaired newer raw": (records) => records.push(presentation("other", valid)[2] as object),
};

for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`${name} fails closed without stale fallback`, () => {
    scenario(({ records, stop, approve, approval }) => {
      records.push(...presentation("first", valid));
      corrupt(records);
      assert.notEqual(stop().verdict.kind, "allow");
      records.push(started(approvalTurn, "default"));
      assert.equal(approve().verdict.kind, "deny");
      assert.notEqual(approval(), "approved");
    });
  });
}

test("missing, truncated, conflicting metadata and mismatching Stop identity are bounded refusals", () => {
  for (const rewrite of [(text: string) => text.slice(0, -1), (text: string) => text + '{"type":', (text: string) => text.replace(`"session_id":"${session}"`, '"session_id":"foreign"')]) {
    scenario(({ records, gate }) => {
      records.push(...presentation("first", valid));
      const result = gate("planstop", { turn_id: turn, last_assistant_message: marker }, rewrite);
      assert.notEqual(result.verdict.kind, "allow");
      assert.ok(JSON.stringify(result).length < 2000);
      assert.ok(!JSON.stringify(result).includes("rollout.jsonl"));
    });
  }
  scenario(({ records, gate }) => {
    records.push(...presentation("first", valid));
    assert.equal(gate("planstop", { turn_id: turn, last_assistant_message: `different\n${marker}` }).verdict.kind, "deny");
  });
});

test("missing Verify diagnostics identify the slice and repeated unchanged failure terminates", () => {
  scenario(({ records, stop }) => {
    records.push(...presentation("first", invalid));
    const initial = stop();
    assert.match(initial.stdout, /missing-slice-verify/);
    assert.match(initial.stdout, /Slice S1 must name failing-check: or Verify-exception:/);
    assert.ok(!initial.stdout.includes("Depends-on"));
    const repeated = stop(true);
    assert.equal(JSON.parse(repeated.stdout).continue, false);
  });
});

test("legacy pending refuses Default approval and native Plan supplies the entire preserved replacement", () => {
  scenario(({ records, sandbox, approve, gate }) => {
    runCapturePlan(sandbox.cwd, session, sha256Hex(valid), valid);
    records.push(started(approvalTurn, "default"));
    assert.match(approve().stdout, /compatibility refresh/);
    records.push(started("refresh", "plan"));
    const refresh = gate("planprompt", { turn_id: "refresh", prompt: "Continue" });
    assert.equal(refresh.verdict.kind, "context");
    assert.match(refresh.stdout, /COMPLETE replacement proposed_plan/);
    assert.ok(refresh.stdout.includes(JSON.stringify(valid).slice(1, -1)));
  });
});

test("feedback calls for a complete replacement and cancellation clears outstanding failed authority", () => {
  scenario(({ records, stop, gate, approval }) => {
    records.push(...presentation("first", valid));
    stop();
    records.push(started("feedback", "plan"));
    assert.match(gate("planprompt", { turn_id: "feedback", prompt: "Keep the tests" }).stdout, /COMPLETE replacement proposed_plan/);
    assert.equal(gate("planprompt", { turn_id: "feedback", prompt: "CANCEL OSO PLAN" }).verdict.kind, "context");
    assert.equal(approval(), undefined);
    records.push(started(approvalTurn, "default"));
    assert.equal(gate("planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." }).verdict.kind, "allow");
  });
});

test("partial approved snapshot publication never skips current parity", () => {
  scenario(({ records, stop, transcript, sandbox, approve, approval }) => {
    records.push(...presentation("first", valid));
    stop();
    const state = stateFileFor(sandbox.cwd);
    const presented = readValue(state, "plan_snapshot_file") as string;
    const published = presented.replace("presented-", "approved-");
    renameSync(presented, published);
    writeFileSync(published, "changed\n");
    records.push(started(approvalTurn, "default"));
    const refused = approve();
    assert.equal(refused.verdict.kind, "deny");
    assert.match(refused.stdout, /partial-publication-mismatch/);
    const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: approvalTurn }), caller);
    assert.throws(() => runApprovePlan(sandbox.cwd, session, readValue(state, "plan_approval_digest") as string, () => resolveCodexPresentation(envelope, { precedingApproval: true })), /partially published/);
    assert.equal(approval(), "pending");
  });
});

test("snapshot IO failure cannot revive an older approved document", () => {
  scenario(({ records, stop, sandbox, approve, approval }) => {
    records.push(...presentation("first", valid));
    stop();
    const state = stateFileFor(sandbox.cwd);
    const snapshot = readValue(state, "plan_snapshot_file") as string;
    runApprovePlan(sandbox.cwd, session, readValue(state, "plan_approval_digest") as string);
    const immutable = snapshot.replace("presented-", "approved-");
    const before = readFileSync(immutable, "utf8");
    const current = readValue(state, "plan_current_file") as string;
    rmSync(current);
    mkdirSync(current);
    records.push(...presentation("new", valid + "new\n"));
    assert.equal(stop().verdict.kind, "deny");
    assert.equal(JSON.parse(stop(true).stdout).continue, false);
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "deny");
    assert.notEqual(approval(), "approved");
    assert.equal(readFileSync(immutable, "utf8"), before);
  });
});

test("completed history and approval already consumed do not turn unrelated phrases into controls", () => {
  scenario(({ records, stop, approve, gate, sandbox }) => {
    records.push(...presentation("first", valid));
    stop();
    records.push(started(approvalTurn, "default"));
    approve();
    records.push(started("later", "default"));
    assert.equal(gate("planprompt", { turn_id: "later", prompt: "Implement the plan." }).verdict.kind, "allow");
    writeStatePairs(stateFileFor(sandbox.cwd), ["mode=done"], session);
    records.push(started("finished", "default"));
    assert.equal(gate("planprompt", { turn_id: "finished", prompt: "Implement the plan." }).verdict.kind, "allow");
  });
});

test("valid old and failed newer presentation cannot approve the stale pending document", () => {
  scenario(({ records, stop, approve, approval }) => {
    records.push(...presentation("first", valid));
    assert.equal(stop().verdict.kind, "allow");
    records.push(...presentation("failed", invalid));
    assert.equal(stop().verdict.kind, "deny");
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "deny");
    assert.notEqual(approval(), "approved");
  });
});

test("built installed hooks capture same-turn correction, reject stale approval and preserve immutable artifacts", () => {
  scenario((fixture) => {
    const { records, sandbox } = fixture;
    records.push(...presentation("first", invalid));
    const rejected = installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: marker });
    assert.equal(JSON.parse(rejected.stdout).decision, "block");
    records.push(...presentation("corrected", valid));
    const captured = installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: marker, stop_hook_active: true });
    assert.equal(captured.stdout.trim(), "{}");
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_presentation_message"), "corrected");
    records.push(...presentation("new-failure", invalid));
    assert.equal(JSON.parse(installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: marker }).stdout).decision, "block");
    records.push(started(approvalTurn, "default"));
    const refused = installedGate(fixture, "planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." });
    assert.match(refused.stdout, /not recorded/);
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_approval"), "pending");
  });
});

test("native raw Unicode escape spelling is retained in the split wire digest", () => {
  scenario(({ records, gate, sandbox }) => {
    const document = `${valid}Café\n`;
    records.push(...presentation("escaped", document));
    assert.equal(gate("planstop", { turn_id: turn, last_assistant_message: marker }, (text) => text.replaceAll("é", "\\u00e9")).verdict.kind, "allow");
    const rawPlan = JSON.stringify(document).slice(1, -1).replaceAll("é", "\\u00e9");
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_approval_digest"), sha256Hex(`${rawPlan}\\n${marker}`));
  });
});

test("one host-owned terminal Stop LF preserves its wire digest without changing native final text", () => {
  scenario(({ records, gate, sandbox, approve }) => {
    records.push(...presentation("terminal", valid));
    assert.equal(gate("planstop", { turn_id: turn, last_assistant_message: `${marker}\n` }).verdict.kind, "allow");
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_approval_digest"), sha256Hex(`${JSON.stringify(valid).slice(1, -1)}\\n${marker}\\n`));
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "context");
  });
  scenario(({ records, gate }) => {
    records.push(...presentation("terminal", valid));
    assert.equal(gate("planstop", { turn_id: turn, last_assistant_message: `${marker}\n\n` }).verdict.kind, "deny");
  });
});

test("native pairing validation runs under the existing approval lock", () => {
  scenario(({ records, stop, gate, transcript, sandbox }) => {
    records.push(...presentation("locked", valid));
    stop();
    records.push(started(approvalTurn, "default"));
    gate("planprompt", { turn_id: approvalTurn, prompt: "ordinary" });
    const state = stateFileFor(sandbox.cwd);
    const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: approvalTurn }), caller);
    assert.equal(runApprovePlan(sandbox.cwd, session, readValue(state, "plan_approval_digest") as string, () => {
      assert.equal(existsSync(`${state}.lock`), true);
      return resolveCodexPresentation(envelope, { precedingApproval: true });
    }), 0);
    assert.equal(existsSync(`${state}.lock`), false);
  });
});

test("newer incomplete presentation without another Stop still prevents stale pending or approved resumption", () => {
  for (const approved of [false, true]) scenario(({ records, stop, sandbox, approve, approval }) => {
    records.push(...presentation("old", valid));
    stop();
    if (approved) runApprovePlan(sandbox.cwd, session, readValue(stateFileFor(sandbox.cwd), "plan_approval_digest") as string);
    records.push(presentation("incomplete", valid)[0] as object);
    records.push(started(approvalTurn, "default"));
    assert.equal(approve().verdict.kind, "deny");
    assert.equal(approval(), approved ? "approved" : "pending");
  });
});

test("failed first capture permits native replacement planning and can be cancelled", () => {
  scenario(({ records, stop, gate, approval }) => {
    records.push(...presentation("invalid", invalid));
    stop();
    records.push(started("replacement", "plan"));
    assert.equal(gate("planprompt", { turn_id: "replacement", prompt: "Correct the Verify requirement" }).verdict.kind, "context");
    assert.equal(gate("planprompt", { turn_id: "replacement", prompt: "CANCEL OSO PLAN" }).verdict.kind, "context");
    assert.equal(approval(), undefined);
  });
});

test("Codex presentation-critical hook fields ignore nested tool and user content", () => {
  const envelope = readEnvelope(JSON.stringify({ tool_input: { turn_id: turn, permission_mode: "plan", last_assistant_message: marker, prompt: "Implement the plan.", stop_hook_active: true } }), caller);
  assert.equal(envelope.turnId, "");
  assert.equal(envelope.permissionMode, "");
  assert.equal(envelope.lastAssistantMessage, "");
  assert.equal(envelope.escapedLastAssistantMessage, "");
  assert.equal(envelope.prompt, "");
  assert.equal(envelope.stopHookActive, false);
});

test("built installed hooks approve full and split final/raw pairs", () => {
  for (const split of [false, true]) scenario((fixture) => {
    const { records, sandbox } = fixture;
    const message = split ? marker : `${valid}\n${marker}`;
    const completed = presentation("paired", valid);
    if (split) records.push(...completed);
    else records.push(
      event({ type: "item_completed", thread_id: session, turn_id: turn, item: { type: "AgentMessage", id: "paired", phase: "final_answer", content: [{ type: "Text", text: message }] } }),
      { type: "response_item", payload: { type: "message", role: "assistant", id: "paired", phase: "final_answer", content: [{ type: "output_text", text: message }] } },
    );
    assert.equal(installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: message }).stdout.trim(), "{}");
    records.push(started(approvalTurn, "default"));
    assert.match(installedGate(fixture, "planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." }).stdout, /technical approval gate is open/);
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_approval"), "approved");
  });
});

test("concurrent installed approvals grant the exact pending document only once", () => {
  scenario((fixture) => {
    const { records, sandbox, transcript } = fixture;
    records.push(...presentation("concurrent", valid));
    installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: marker });
    records.push(started(approvalTurn, "default"));
    writeFileSync(transcript, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const hook = path.join(sandbox.home, ".codex", "hooks", "oso-code", "gate.js");
    const input = JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: approvalTurn, prompt: "Implement the plan." });
    const runner = `import { spawn } from 'node:child_process';
      const results = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [${JSON.stringify(hook)}, 'planprompt']);
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => stdout += chunk);
        child.stderr.on('data', chunk => stderr += chunk);
        child.on('error', reject);
        child.on('close', status => resolve({ status, stdout, stderr }));
        child.stdin.end(${JSON.stringify(input)});
      })));
      process.stdout.write(JSON.stringify(results));`;
    const raced = spawnSync(process.execPath, ["--input-type=module", "-e", runner], {
      cwd: sandbox.cwd, encoding: "utf8",
      env: { HOME: sandbox.home, USERPROFILE: sandbox.home, OSO_TASK_ROOT: sandbox.cwd, PATH: process.env["PATH"] ?? "", OSO_AGENT: "1" },
    });
    if (raced.error !== undefined) throw raced.error;
    assert.equal(raced.status, 0, raced.stderr);
    const outcomes = JSON.parse(raced.stdout) as { status: number; stdout: string; stderr: string }[];
    assert.equal(outcomes.filter((outcome) => outcome.stdout.includes("technical approval gate is open")).length, 1);
    assert.ok(outcomes.every((outcome) => outcome.status === 0 && outcome.stderr === ""));
    assert.equal(readValue(stateFileFor(sandbox.cwd), "plan_approval"), "approved");
  });
});

for (const approved of [false, true]) test(`typed approval pairing reason survives ${approved ? "approved" : "pending"} state`, () => {
  scenario(({ records, stop, sandbox, approve }) => {
    records.push(...presentation("old", valid));
    stop();
    if (approved) runApprovePlan(sandbox.cwd, session, readValue(stateFileFor(sandbox.cwd), "plan_approval_digest") as string);
    records.push(presentation("incomplete", valid)[0] as object, started(approvalTurn, "default"));
    const result = approve();
    assert.equal(result.verdict.kind, "deny");
    assert.match(result.stdout, /incomplete-newer-plan/);
    assert.equal(result.events[0]?.command, "incomplete-newer-plan");
    assert.doesNotMatch(result.stdout, /compare-and-set|rollout.jsonl/);
  });
});

test("typed transcript reasons survive native turn resolution", () => {
  for (const [code, rewrite] of [
    ["truncated-transcript", (text: string) => text.slice(0, -1)],
    ["foreign-session", (text: string) => text.replaceAll(session, "dddddddd-dddd-dddd-dddd-dddddddddddd")],
  ] as const) scenario(({ records, gate, transcript, sandbox }) => {
    records.push(...presentation("old", valid));
    gate("planstop", { turn_id: turn, last_assistant_message: marker }, rewrite);
    const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: turn }), caller);
    assert.throws(() => resolveCodexTurn(envelope), (cause: unknown) => cause instanceof CodexPresentationFailure && cause.code === code);
  });
});

test("native approval emits bounded transcript reason codes and preserves missing-file causality", () => {
  scenario(({ records, stop, gate, transcript, sandbox }) => {
    records.push(...presentation("old", valid));
    stop();
    records.push(started(approvalTurn, "default"));
    const truncated = gate("planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." }, (text) => text.slice(0, -1));
    assert.match(truncated.stdout, /truncated-transcript/);
    assert.equal(truncated.events[0]?.command, "truncated-transcript");
    assert.doesNotMatch(JSON.stringify(truncated), /rollout.jsonl/);
    rmSync(transcript);
    const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: approvalTurn, prompt: "Implement the plan." }), caller);
    assert.throws(() => resolveCodexTurn(envelope), (cause: unknown) => cause instanceof CodexPresentationFailure && cause.code === "unreadable-transcript" && cause.cause instanceof Error && "code" in cause.cause && cause.cause.code === "ENOENT");
    const missing = runGate(["planprompt"], envelope);
    assert.match(missing.stdout, /unreadable-transcript/);
    assert.equal(missing.events[0]?.command, "unreadable-transcript");
    assert.doesNotMatch(JSON.stringify(missing), /rollout.jsonl/);
  });
});

test("installed native approval preserves the precise pairing refusal", () => {
  scenario((fixture) => {
    fixture.records.push(...presentation("old", valid));
    installedGate(fixture, "planstop", { turn_id: turn, last_assistant_message: marker });
    fixture.records.push(presentation("incomplete", valid)[0] as object, started(approvalTurn, "default"));
    const result = installedGate(fixture, "planprompt", { turn_id: approvalTurn, prompt: "Implement the plan." });
    assert.match(result.stdout, /incomplete-newer-plan/);
    assert.doesNotMatch(result.stdout, /compare-and-set|rollout.jsonl/);
  });
});

test("unexpected transcript failure retains its original cause through turn resolution", () => {
  scenario(({ records, gate, transcript, sandbox }) => {
    records.push(...presentation("old", valid));
    gate("planstop", { turn_id: turn, last_assistant_message: marker });
    const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, turn_id: turn }), caller);
    const original = new Error("unexpected transcript fault");
    Object.defineProperty(envelope, "cwd", { get() { throw original; } });
    assert.throws(() => resolveCodexTurn(envelope), (cause: unknown) => cause === original);
    assert.throws(() => PLANPROMPT_GATE.judge({ envelope, argv: [] }), (cause: unknown) => cause === original);
  });
});

test("typed storage parity reason is not misreported as compare-and-set", () => {
  scenario(({ records, stop, sandbox, approve }) => {
    records.push(...presentation("old", valid));
    stop();
    rmSync(readValue(stateFileFor(sandbox.cwd), "plan_current_file") as string);
    records.push(started(approvalTurn, "default"));
    const result = approve();
    assert.match(result.stdout, /current-plan-unsafe/);
    assert.equal(result.events[0]?.command, "current-plan-unsafe");
    assert.doesNotMatch(result.stdout, /compare-and-set/);
  });
});

function installedGate(fixture: PresentationFixture, name: string, input: object) {
  const { sandbox, records, transcript } = fixture;
  const installed = path.join(sandbox.home, ".codex", "hooks", "oso-code");
  mkdirSync(installed, { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "dist", "gate.js"), path.join(installed, "gate.js"));
  writeFileSync(transcript, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const result = spawnSync(process.execPath, [path.join(installed, "gate.js"), name], {
    cwd: sandbox.cwd,
    input: JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: transcript, ...input }),
    env: { HOME: sandbox.home, USERPROFILE: sandbox.home, OSO_TASK_ROOT: sandbox.cwd, PATH: process.env["PATH"] ?? "", OSO_AGENT: "1" },
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result;
}

const LANE_BY_APPROVAL: readonly (readonly [string, string, RegExp])[] = [
  ["pending", "a plan still awaiting approval", /COMPLETE replacement proposed_plan/],
  ["approved", "a plan already executing", /amend-plan/],
];

for (const [approval, reads, lane] of LANE_BY_APPROVAL) {
  test(`a refused plan control under ${reads} names the lane that reopens execution from there`, () => {
    withStateSandbox("workspace", (sandbox) => withHookEnvironment(sandbox.hookEnvironment(), () => {
      writeStatePairs(stateFileFor(sandbox.cwd), ["mode=plan", `plan_approval=${approval}`, `plan_approval_session=${session}`], session);
      const envelope = readEnvelope(JSON.stringify({ session_id: session, cwd: sandbox.cwd, transcript_path: path.join(sandbox.cwd, "absent.jsonl"), turn_id: approvalTurn, prompt: "Implement the plan." }), caller);
      const { verdict } = runGate(["planprompt"], envelope);
      assert.equal(verdict.kind, "deny");
      if (verdict.kind === "deny") assert.match(verdict.message, lane);
    }));
  });
}
