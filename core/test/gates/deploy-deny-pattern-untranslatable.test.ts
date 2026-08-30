import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate, type GateRun } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_FILE, STATE_ROOT_THESE_TESTS_SPELL, withStateSandbox } from "../support/state-sandbox.ts";

const ARMED_STATE = "auto=running\nauto_change=rewrite-gates\nsession=test-session\n";
const DENY_PATTERNS_FILE = `${STATE_ROOT_THESE_TESTS_SPELL}/deploy-deny/{repo}.patterns`;

const A_RANGE_PAST_ASCII = "[a-é]uild";
const AN_UNTRANSLATABLE_EQUIVALENCE_CLASS = "[[=+=]]deploy";
const THE_SAME_REACH_IN_ASCII = "[a-z]uild";
const A_RANGE_GREP_EXITS_2_ON = "[z-a]uild";

function payloadRunning(command: string): string {
  return JSON.stringify({
    session_id: "test-session",
    cwd: "{cwd}",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

function judgedAgainst(patterns: string, command: string): GateRun {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({ [STATE_FILE]: ARMED_STATE, [DENY_PATTERNS_FILE]: patterns });
    return withHookEnvironment({ HOME: sandbox.home }, () =>
      runGate(["proddeploy"], spawnedEnvelope(sandbox.expandJson(payloadRunning(command)), process.env)),
    );
  });
}

function eventsOf(run: GateRun): { event: string; command: string }[] {
  return run.events.map((event) => ({ event: event.event, command: String(event.command ?? "") }));
}

describe(
  "core/src/gates/proddeploy.ts: a deploy-deny pattern this reader cannot translate denies the command and " +
    "names the pattern, because an operator's deny pattern that stops biting silently is the fail-open the " +
    "boundary exists to prevent — measured against /usr/bin/grep -E 3.12 under LC_ALL=C on 2026-08-29, where " +
    "each untranslatable pattern below matches the command grep is given",
  () => {
    test("a range reaching past ASCII denies the command grep would have denied", () => {
      const run = judgedAgainst(`${A_RANGE_PAST_ASCII}\n`, "npm run build");
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /is past what the production boundary can read/);
      assert.ok(run.stdout.includes(A_RANGE_PAST_ASCII), `the denial does not name ${A_RANGE_PAST_ASCII}`);
      assert.deepEqual(eventsOf(run), [
        { event: "deploy-deny-pattern-untranslatable", command: A_RANGE_PAST_ASCII },
      ]);
    });

    test("an equivalence class with no locale-independent members denies the same way", () => {
      const run = judgedAgainst(`${AN_UNTRANSLATABLE_EQUIVALENCE_CLASS}\n`, "+deploy now");
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.deepEqual(eventsOf(run), [
        { event: "deploy-deny-pattern-untranslatable", command: AN_UNTRANSLATABLE_EQUIVALENCE_CLASS },
      ]);
    });

    test("the same reach spelled in ASCII denies under the ordinary deny-pattern event", () => {
      const run = judgedAgainst(`${THE_SAME_REACH_IN_ASCII}\n`, "npm run build");
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.deepEqual(eventsOf(run), [{ event: "prod-deploy-denied", command: "npm run build" }]);
    });

    test("a pattern that bites is preferred to an untranslatable one sharing its file", () => {
      const run = judgedAgainst(`${A_RANGE_PAST_ASCII}\n${THE_SAME_REACH_IN_ASCII}\n`, "npm run build");
      assert.deepEqual(eventsOf(run), [{ event: "prod-deploy-denied", command: "npm run build" }]);
    });

    test("a pattern grep itself exits 2 on still matches nothing, so the command reaches the line reader", () => {
      const run = judgedAgainst(`${A_RANGE_GREP_EXITS_2_ON}\n`, "npm run build");
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, events: eventsOf(run) }, {
        exit: 0,
        stdout: "",
        events: [],
      });
    });

    test("an untranslatable pattern in an unarmed repository leaves the turn alone", () => {
      const run = withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [DENY_PATTERNS_FILE]: `${A_RANGE_PAST_ASCII}\n` });
        return withHookEnvironment({ HOME: sandbox.home }, () =>
          runGate(["proddeploy"], spawnedEnvelope(sandbox.expandJson(payloadRunning("npm run build")), process.env)),
        );
      });
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, events: eventsOf(run) }, {
        exit: 0,
        stdout: "",
        events: [],
      });
    });
  },
);
