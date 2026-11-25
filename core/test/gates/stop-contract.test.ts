import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { STATE_FILE, withStateSandbox } from "../support/state-sandbox.ts";

const ARMED_RUN = "auto=running\nauto_change=auto-continuity\nsession=test-session\n";
const STOP_PAYLOAD = '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}';
const REASON_A_SUFFIX_ANCHORED_READER_TAKES = /.*"reason":"(.*)"}$/;

function continuationPush() {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({ [STATE_FILE]: ARMED_RUN });
    return withHookEnvironment({ HOME: sandbox.home }, () =>
      runGate(["autocontinue"], spawnedEnvelope(sandbox.expandJson(STOP_PAYLOAD), process.env)),
    );
  });
}

provedSomething(
  "the Stop push envelope carries a reason a suffix-anchored reader can still take",
  REASON_A_SUFFIX_ANCHORED_READER_TAKES.exec(continuationPush().stdout.trimEnd())?.[1] !== undefined,
  "no reason could be read out of the push envelope, so the field-order claim below compared nothing",
);

describe("core/src/hosts/stop.ts: the Stop push keeps the decision/reason form the pinned client honours", () => {
  test("a continuation push carries the older decision: block form with the reason naming the in-flight run", () => {
    const push = JSON.parse(continuationPush().stdout) as Record<string, unknown>;
    assert.equal(push["decision"], "block");
    assert.match(String(push["reason"]), /this run is unattended and still in flight/);
  });

  test("shouldContinue precedes the reason, so a suffix-anchored reader takes the reason out of the envelope whole", () => {
    const reason = REASON_A_SUFFIX_ANCHORED_READER_TAKES.exec(continuationPush().stdout.trimEnd())?.[1];
    assert.match(String(reason), /wait for that instead\.$/);
  });
});
